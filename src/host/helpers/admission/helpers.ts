import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { parseUnknownJson } from "@jsonrpc";
import { HOST_PROOF_MAX_BYTES, HOST_PROOF_MAX_SKEW_MS, HOST_PROTOCOL_VERSION, HOST_REPLAY_CACHE_SIZE } from "../../constants";
import { isHostSlug, parseNamespaceId } from "../namespace";
import type { HostAdmission, HostAdmissionOptions, HostCredential, HostOperation, HostProofClaims, NamespacePolicy, VerifiedHost } from "./types";

const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
const OPERATIONS: readonly HostOperation[] = ["serve", "route", "adopt"];
const identifier = z.string().min(1).max(256).regex(/^[\w.:-]+$/u);
const key32 = z.string().regex(/^[\w-]{43}$/u);
const instant = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const policySchema = z.strictObject({
  namespaceId: z.string(),
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  members: z.array(z.strictObject({
    hostId: z.string().refine(isHostSlug),
    credentials: z.array(z.strictObject({ id: identifier, publicKey: key32, notBefore: instant.optional(), expiresAt: instant.optional() })).min(1).max(8),
    maxInstances: z.number().int().min(1).max(1024).optional(),
    endpoints: z.array(z.string().max(2048)).max(16).optional(),
    operations: z.array(z.enum(["serve", "route", "adopt"])).optional(),
  })).min(1).max(256),
  revokedCredentialIds: z.array(identifier).max(1024).optional(),
});
const proofSchema = z.strictObject({
  v: z.literal(HOST_PROTOCOL_VERSION), namespaceId: z.string(), hostId: z.string(), instanceId: z.string().min(1).max(512),
  generation: z.string().regex(/^[0-9]{1,18}$/u), credentialId: identifier, audience: z.string(), purpose: z.enum(["relay", "probe"]),
  policyRevision: z.number().int(), issuedAt: z.number().int(), nonce: z.string().min(16).max(64), bind: z.string().regex(/^[0-9a-f]{64}$/u),
});

const privateKey = (secret: string): KeyObject => {
  const seed = Buffer.from(secret, "base64url");
  if (seed.length !== 32 || seed.toString("base64url") !== secret) throw new TypeError("Invalid host credential.");
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: "der", type: "pkcs8" });
};
const publicKey = (encoded: string): KeyObject => createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(encoded, "base64url")]), format: "der", type: "spki" });
const rawPublic = (key: KeyObject): string => (key.type === "public" ? key : createPublicKey(key))
  .export({ format: "der", type: "spki" }).subarray(SPKI_ED25519.length).toString("base64url");

/** Binds arbitrary forwarded content into a proof without placing it in the signed claims. */
export const bindDigest = (content: string): string => createHash("sha256").update(content).digest("hex");

/**
 * Creates one host-specific credential. The secret is an Ed25519 seed that only
 * its host holds; trusted namespace policy lists the matching public verifier,
 * so no member can impersonate another by knowing a shared namespace secret.
 */
export const generateHostCredential = (id: string = randomUUID()): { readonly credential: HostCredential; readonly verifier: { readonly id: string; readonly publicKey: string } } => {
  const pair = generateKeyPairSync("ed25519");
  const secret = pair.privateKey.export({ format: "der", type: "pkcs8" }).subarray(PKCS8_ED25519.length).toString("base64url");
  return { credential: { id: identifier.parse(id), secret }, verifier: { id, publicKey: rawPublic(pair.publicKey) } };
};

/**
 * Captures trusted namespace membership policy and this host's own credential.
 *
 * The policy comes from application configuration and is the only root of
 * trust: a joining host cannot register a verifier, extend its own claims or
 * change who may share the namespace. Verification failures return `undefined`
 * and never describe the credential.
 */
export const createHostAdmission = (options: HostAdmissionOptions): HostAdmission => {
  const policy: NamespacePolicy = structuredClone(policySchema.parse(options.policy));
  parseNamespaceId(policy.namespaceId);
  const now = options.now ?? Date.now;
  const revoked = new Set(policy.revokedCredentialIds ?? []);
  const hosts = new Map<string, NamespacePolicy["members"][number]>();
  const credentialOwners = new Map<string, string>();
  for (const member of policy.members) {
    if (hosts.has(member.hostId)) throw new TypeError("Duplicate namespace member.");
    hosts.set(member.hostId, member);
    for (const credential of member.credentials) {
      // One credential identifies exactly one logical host.
      if (credentialOwners.has(credential.id)) throw new TypeError("Duplicate host credential identifier.");
      credentialOwners.set(credential.id, member.hostId);
      publicKey(credential.publicKey);
    }
    for (const endpoint of member.endpoints ?? []) {
      const url = new URL(endpoint);
      if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash) throw new TypeError("Invalid host endpoint.");
      if (options.requireTls === true && url.protocol !== "wss:") throw new TypeError("Host endpoints must use TLS.");
    }
  }
  const digest = createHash("sha256").update(JSON.stringify([policy, options.configuration ?? null])).digest("hex");
  const self = hosts.get(options.hostId);
  if (!self) throw new TypeError("This host is not a member of the configured namespace.");
  const supply = typeof options.credential === "function" ? options.credential : (): HostCredential => options.credential as HostCredential;
  const usable = (hostId: string, credentialId: string, at: number): string | undefined => {
    const verifier = hosts.get(hostId)?.credentials.find((entry) => entry.id === credentialId);
    if (!verifier || revoked.has(credentialId)) return undefined;
    if ((verifier.notBefore !== undefined && at < Date.parse(verifier.notBefore)) || (verifier.expiresAt !== undefined && at >= Date.parse(verifier.expiresAt))) return undefined;
    return verifier.publicKey;
  };
  /** The current secret, checked against trusted policy every time it is used. */
  const current = (): { readonly id: string; readonly key: KeyObject } => {
    const credential = supply();
    const key = privateKey(credential.secret);
    if (usable(options.hostId, credential.id, now()) !== rawPublic(key)) throw new TypeError("The host credential is not valid for this namespace member.");
    return { id: credential.id, key };
  };
  const allows = (hostId: string, operation: HostOperation): boolean => {
    const member = hosts.get(hostId);
    return member !== undefined && (member.operations ?? OPERATIONS).includes(operation);
  };
  const seen = new Map<string, number>();
  const firstUse = (nonce: string, at: number): boolean => {
    if (seen.has(nonce)) return false;
    // Entries are in insertion order, which is expiry order.
    for (const [entry, expires] of seen) {
      if (expires > at) break;
      seen.delete(entry);
    }
    // Forgetting an unexpired nonce would let it be replayed, so a full cache refuses new proofs.
    if (seen.size >= HOST_REPLAY_CACHE_SIZE) return false;
    seen.set(nonce, at + 2 * HOST_PROOF_MAX_SKEW_MS);
    return true;
  };
  current();
  return Object.freeze<HostAdmission>({
    namespaceId: policy.namespaceId, hostId: options.hostId, policy: Object.freeze({ revision: policy.revision, digest }),
    ...(self.maxInstances === undefined ? {} : { maxInstances: self.maxInstances }),
    credentialId: () => current().id,
    isCurrent() {
      try {
        current();
        return true;
      } catch {
        return false;
      }
    },
    allows,
    isMember: (hostId) => hosts.has(hostId),
    endpointAllowed: (hostId, endpoint) => hosts.get(hostId)?.endpoints?.includes(endpoint) === true,
    sign(claims) {
      const credential = current();
      const payload = Buffer.from(JSON.stringify({ v: HOST_PROTOCOL_VERSION, namespaceId: policy.namespaceId, hostId: options.hostId, instanceId: claims.instanceId,
        generation: claims.generation, credentialId: credential.id, audience: claims.audience, purpose: claims.purpose, policyRevision: policy.revision,
        issuedAt: now(), nonce: randomUUID(), bind: claims.bind } satisfies HostProofClaims)).toString("base64url");
      return `${payload}.${sign(null, Buffer.from(payload), credential.key).toString("base64url")}`;
    },
    verify(proof, expected): VerifiedHost | undefined {
      try {
        if (typeof proof !== "string" || proof.length > HOST_PROOF_MAX_BYTES) return undefined;
        const [payload, signature, extra] = proof.split(".");
        if (!payload || !signature || extra !== undefined) return undefined;
        // One proof has exactly one spelling: lenient decoders must not create a second accepted form.
        const signed = Buffer.from(signature, "base64url");
        if (signed.length !== 64 || signed.toString("base64url") !== signature || Buffer.from(payload, "base64url").toString("base64url") !== payload) return undefined;
        const claims = proofSchema.parse(parseUnknownJson(Buffer.from(payload, "base64url").toString("utf8")));
        const at = now();
        // Every binding must match trusted local configuration before the signature is considered.
        if (claims.namespaceId !== policy.namespaceId || claims.audience !== options.hostId || claims.purpose !== expected.purpose
          || claims.policyRevision !== policy.revision || claims.bind !== expected.bind || Math.abs(at - claims.issuedAt) > HOST_PROOF_MAX_SKEW_MS
          || claims.hostId === options.hostId || credentialOwners.get(claims.credentialId) !== claims.hostId || !allows(claims.hostId, expected.operation)) return undefined;
        const verifier = usable(claims.hostId, claims.credentialId, at);
        if (verifier === undefined || !verify(null, Buffer.from(payload), publicKey(verifier), signed)) return undefined;
        if (!firstUse(claims.nonce, at)) return undefined;
        return Object.freeze({ hostId: claims.hostId, instanceId: claims.instanceId, generation: claims.generation, credentialId: claims.credentialId });
      } catch {
        return undefined;
      }
    },
  });
};
