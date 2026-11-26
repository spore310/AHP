import { describe, expect, it } from "vitest";
import assert from "node:assert/strict";
import {
  bindDigest, createHostAdmission, generateHostCredential,
  type HostAdmission, type HostAdmissionOptions, type HostCredential, type NamespaceMemberPolicy, type NamespacePolicy,
} from "@host";
import { parseUnknownJson } from "@jsonrpc";

type GeneratedCredential = ReturnType<typeof generateHostCredential>;

const namespaceId = "ahp-namespace:support-app/shared";
const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const MINUTE = 60_000;
/** Largest accepted difference between a proof's issue time and the verifier's clock. */
const MAX_SKEW_MS = 30_000;
const iso = (at: number): string => new Date(at).toISOString();
const relayOf = (content: string) => ({ purpose: "relay", bind: bindDigest(content), operation: "route" }) as const;
const expectedRelay = relayOf("x");

const createClock = (start = T0) => {
  let at = start;
  return {
    now: (): number => at,
    set(value: number): void {
      at = value;
    },
  };
};

const member = (hostId: string, generated: GeneratedCredential, extra: Partial<NamespaceMemberPolicy> = {}): NamespaceMemberPolicy =>
  ({ hostId, credentials: [generated.verifier], ...extra });

/** Three logical hosts in one namespace, each holding only its own secret, on one injectable clock. */
const createFixture = (edit: (policy: NamespacePolicy) => NamespacePolicy = (policy) => policy) => {
  const a = generateHostCredential("host-a-key");
  const b = generateHostCredential("host-b-key");
  const c = generateHostCredential("host-c-key");
  const policy = edit({ namespaceId, revision: 1, members: [member("host-a", a), member("host-b", b), member("host-c", c)] });
  const clock = createClock();
  const admit = (hostId: string, credential: HostAdmissionOptions["credential"], from: NamespacePolicy = policy): HostAdmission =>
    createHostAdmission({ hostId, policy: from, credential, now: clock.now });
  return { a, b, c, policy, clock, admit, hostA: admit("host-a", a.credential), hostB: admit("host-b", b.credential), hostC: admit("host-c", c.credential) };
};

const relay = (signer: HostAdmission, audience: string, content = "x"): string =>
  signer.sign({ instanceId: `${signer.hostId}-instance`, generation: "1", audience, purpose: "relay", bind: bindDigest(content) });

/** Re-encodes a proof's claims with changes and keeps the original signature. */
const tamper = (proof: string, change: Record<string, unknown>): string => {
  const [payload, signature] = proof.split(".");
  assert.ok(payload !== undefined && signature !== undefined);
  const claims = parseUnknownJson(Buffer.from(payload, "base64url").toString("utf8"));
  assert.ok(typeof claims === "object" && claims !== null);
  return `${Buffer.from(JSON.stringify({ ...claims, ...change })).toString("base64url")}.${signature}`;
};

const thrownBy = (action: () => unknown): unknown => {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the action to throw.");
};

describe("host admission membership", () => {
  it("H1-03 lets two logical hosts in one namespace policy verify each other's proofs", () => {
    const { hostA, hostB } = createFixture();
    expect(hostA.namespaceId).toBe(namespaceId);
    expect(hostB.namespaceId).toBe(namespaceId);
    expect(hostA.isMember("host-b")).toBe(true);
    expect(hostB.isMember("host-a")).toBe(true);

    const fromA = hostA.sign({ instanceId: "instance-a", generation: "1", audience: "host-b", purpose: "relay", bind: bindDigest("x") });
    expect(hostB.verify(fromA, { purpose: "relay", bind: bindDigest("x"), operation: "route" }))
      .toEqual({ hostId: "host-a", instanceId: "instance-a", generation: "1", credentialId: "host-a-key" });

    const fromB = hostB.sign({ instanceId: "instance-b", generation: "7", audience: "host-a", purpose: "relay", bind: bindDigest("x") });
    expect(hostA.verify(fromB, { purpose: "relay", bind: bindDigest("x"), operation: "route" }))
      .toEqual({ hostId: "host-b", instanceId: "instance-b", generation: "7", credentialId: "host-b-key" });
  });

  it("H1-03 refuses to construct an admission for a host the policy does not list", () => {
    const { admit, hostA, a } = createFixture();
    const outsider = generateHostCredential("host-d-key");
    expect(hostA.isMember("host-d")).toBe(false);
    expect(() => admit("host-d", outsider.credential)).toThrow(/not a member/u);
    // Holding a listed member's credential does not make another host name a member.
    expect(() => admit("host-d", a.credential)).toThrow(/not a member/u);
  });

  it("H1-03 refuses a host presenting another member's credential", () => {
    const { admit, a, b } = createFixture();
    // Another member's credential identifier with this host's own secret.
    expect(() => admit("host-a", { id: b.credential.id, secret: a.credential.secret })).toThrow(/not valid for this namespace member/u);
    // Another member's complete credential.
    expect(() => admit("host-a", b.credential)).toThrow(/not valid for this namespace member/u);
    // This host's own identifier with another member's secret.
    expect(() => admit("host-a", { id: a.credential.id, secret: b.credential.secret })).toThrow(/not valid for this namespace member/u);
    expect(() => admit("host-a", () => b.credential)).toThrow(/not valid for this namespace member/u);
  });

  it("H1-03 refuses a credential whose secret does not match the listed public key", () => {
    const { admit, a } = createFixture();
    const unrelated = generateHostCredential("host-a-key");
    expect(unrelated.credential.id).toBe(a.credential.id);
    expect(() => admit("host-a", unrelated.credential)).toThrow(/not valid for this namespace member/u);
    expect(() => admit("host-a", { id: "unlisted-key", secret: a.credential.secret })).toThrow(/not valid for this namespace member/u);
    expect(() => admit("host-a", { id: a.credential.id, secret: "not-a-seed" })).toThrow(/Invalid host credential/u);
    expect(admit("host-a", a.credential).credentialId()).toBe("host-a-key");
  });
});

describe("host proof verification", () => {
  it("H1-05 returns only the authenticated host identity", () => {
    const { hostA, hostB } = createFixture();
    const verified = hostB.verify(relay(hostA, "host-b"), expectedRelay);
    assert.ok(verified);
    expect(Object.keys(verified).sort()).toEqual(["credentialId", "generation", "hostId", "instanceId"]);
    expect(verified).toEqual({ hostId: "host-a", instanceId: "host-a-instance", generation: "1", credentialId: "host-a-key" });
    expect(Object.isFrozen(verified)).toBe(true);
    for (const authority of ["roles", "role", "actor", "user", "userId", "principal", "subject", "permissions", "scopes", "session", "operations"]) {
      expect(verified).not.toHaveProperty(authority);
    }
  });

  it("H1-05 refuses a proof addressed to another audience", () => {
    const { hostA, hostB, hostC } = createFixture();
    const proof = relay(hostA, "host-c");
    expect(hostB.verify(proof, expectedRelay)).toBeUndefined();
    expect(hostC.verify(proof, expectedRelay)).toMatchObject({ hostId: "host-a" });
  });

  it("H1-05 refuses a proof issued for another namespace with the same keys", () => {
    const { admit, policy, a, hostA, hostB } = createFixture();
    const elsewhere = admit("host-a", a.credential, { ...policy, namespaceId: "ahp-namespace:support-app/other" });
    expect(elsewhere.credentialId()).toBe(hostA.credentialId());
    expect(hostB.verify(relay(elsewhere, "host-b"), expectedRelay)).toBeUndefined();
    expect(hostB.verify(relay(hostA, "host-b"), expectedRelay)).toMatchObject({ hostId: "host-a" });
  });

  it("H1-05 refuses a proof presented for another purpose", () => {
    const { hostA, hostB } = createFixture();
    const probe = hostA.sign({ instanceId: "instance-a", generation: "1", audience: "host-b", purpose: "probe", bind: bindDigest("x") });
    expect(hostB.verify(probe, expectedRelay)).toBeUndefined();
    // The refusal consumed nothing: the same proof is valid for the purpose it was issued for.
    expect(hostB.verify(probe, { ...expectedRelay, purpose: "probe" })).toMatchObject({ hostId: "host-a" });
  });

  it("H1-05 refuses a proof bound to other content", () => {
    const { hostA, hostB } = createFixture();
    const proof = relay(hostA, "host-b", "x");
    expect(hostB.verify(proof, relayOf("y"))).toBeUndefined();
    expect(hostB.verify(proof, { ...expectedRelay, bind: "" })).toBeUndefined();
    expect(hostB.verify(proof, relayOf("x"))).toMatchObject({ hostId: "host-a" });
  });

  it.each([
    ["the host name of another member", { hostId: "host-c" }],
    ["the credential identifier of another member", { credentialId: "host-c-key" }],
    ["the host name and credential identifier of another member", { hostId: "host-c", credentialId: "host-c-key" }],
    ["another runtime instance", { instanceId: "host-a-instance-2" }],
    ["another generation", { generation: "2" }],
    ["another audience", { audience: "host-c" }],
    ["an added authority claim", { roles: ["admin"] }],
  ])("H1-05 refuses a payload tampered with %s under the original signature", (_label, change) => {
    const { hostA, hostB, hostC } = createFixture();
    const proof = relay(hostA, "host-b");
    // The helper re-encodes faithfully, so only the stated change invalidates the proof.
    expect(tamper(proof, {})).toBe(proof);
    const forged = tamper(proof, change);
    expect(forged).not.toBe(proof);
    expect(hostB.verify(forged, expectedRelay)).toBeUndefined();
    expect(hostC.verify(forged, expectedRelay)).toBeUndefined();
    expect(hostB.verify(proof, expectedRelay)).toMatchObject({ hostId: "host-a", credentialId: "host-a-key" });
  });

  it("H1-05 refuses a self-issued proof signed by a key the policy does not list", () => {
    const { admit, policy, b, c, hostA, hostB } = createFixture();
    // The forger reuses host-a's name and credential identifier with its own key pair.
    const forgedKey = generateHostCredential("host-a-key");
    const forger = admit("host-a", forgedKey.credential, { ...policy, members: [member("host-a", forgedKey), member("host-b", b), member("host-c", c)] });
    expect(forger.hostId).toBe("host-a");
    expect(forger.credentialId()).toBe(hostA.credentialId());
    expect(hostB.verify(relay(forger, "host-b"), expectedRelay)).toBeUndefined();
    expect(hostB.verify(relay(hostA, "host-b"), expectedRelay)).toMatchObject({ hostId: "host-a" });
  });

  it("H1-05 refuses a proof whose credential belongs to a different host than the claimed one", () => {
    const { admit, policy, b, c, hostB, hostC } = createFixture();
    // host-c signs with its own genuine, listed key while claiming to be host-a.
    const impersonator = admit("host-a", c.credential, { ...policy, members: [member("host-a", c), member("host-b", b)] });
    expect(impersonator.hostId).toBe("host-a");
    expect(impersonator.credentialId()).toBe("host-c-key");
    expect(hostB.verify(relay(impersonator, "host-b"), expectedRelay)).toBeUndefined();
    // The same key is accepted when it speaks for the host that owns it.
    expect(hostB.verify(relay(hostC, "host-b"), expectedRelay)).toMatchObject({ hostId: "host-c", credentialId: "host-c-key" });
  });

  it("H1-05 refuses a proof issued under a different policy revision", () => {
    const { admit, policy, a, b, hostB } = createFixture();
    const next = { ...policy, revision: 2 };
    const upgradedA = admit("host-a", a.credential, next);
    const upgradedB = admit("host-b", b.credential, next);
    const proof = relay(upgradedA, "host-b");
    expect(hostB.verify(proof, expectedRelay)).toBeUndefined();
    expect(upgradedB.verify(relay(admit("host-a", a.credential), "host-b"), expectedRelay)).toBeUndefined();
    expect(upgradedB.verify(proof, expectedRelay)).toMatchObject({ hostId: "host-a" });
  });

  it("H1-05 refuses a proof from the verifier's own host name", () => {
    const { admit, a, hostA } = createFixture();
    const proof = relay(hostA, "host-a");
    expect(hostA.verify(proof, expectedRelay)).toBeUndefined();
    // Another replica of the same logical host is not a peer either.
    expect(admit("host-a", a.credential).verify(proof, expectedRelay)).toBeUndefined();
  });

  it("H1-05 accepts a proof once and refuses its replay", () => {
    const { hostA, hostB } = createFixture();
    const proof = relay(hostA, "host-b");
    expect(hostB.verify(proof, expectedRelay)).toMatchObject({ hostId: "host-a" });
    expect(hostB.verify(proof, expectedRelay)).toBeUndefined();
    expect(hostB.verify(proof, expectedRelay)).toBeUndefined();
    // A fresh proof for the same content is a new statement.
    expect(hostB.verify(relay(hostA, "host-b"), expectedRelay)).toMatchObject({ hostId: "host-a" });
  });

  it("H1-05 refuses a proof outside the accepted clock skew", () => {
    const { hostA, hostB, clock } = createFixture();
    const proof = relay(hostA, "host-b");
    clock.set(T0 + MAX_SKEW_MS + 1);
    expect(hostB.verify(proof, expectedRelay)).toBeUndefined();
    clock.set(T0 - MAX_SKEW_MS - 1);
    expect(hostB.verify(proof, expectedRelay)).toBeUndefined();
    clock.set(T0 + MAX_SKEW_MS);
    expect(hostB.verify(proof, expectedRelay)).toMatchObject({ hostId: "host-a" });
  });

  it("H1-05 refuses a member whose operations exclude routing", () => {
    const { hostA, hostB } = createFixture((policy) => ({ ...policy,
      members: policy.members.map((entry) => (entry.hostId === "host-a" ? { ...entry, operations: ["serve"] } : entry)) }));
    expect(hostB.allows("host-a", "route")).toBe(false);
    expect(hostB.allows("host-a", "serve")).toBe(true);
    expect(hostB.allows("host-c", "route")).toBe(true);
    const proof = relay(hostA, "host-b");
    expect(hostB.verify(proof, expectedRelay)).toBeUndefined();
    expect(hostB.verify(proof, { ...expectedRelay, operation: "adopt" })).toBeUndefined();
    expect(hostB.verify(proof, { ...expectedRelay, operation: "serve" })).toMatchObject({ hostId: "host-a" });
  });

  it("H1-05 returns undefined for malformed, non-string and oversized proofs without throwing", () => {
    const { hostA, hostB } = createFixture();
    const proof = relay(hostA, "host-b");
    const [payload, signature] = proof.split(".");
    assert.ok(payload !== undefined && signature !== undefined);
    const encode = (value: string): string => Buffer.from(value).toString("base64url");
    const malformed: readonly unknown[] = [
      "", ".", "..", "not-a-proof", "a.b", "a.b.c", payload, `${payload}.`, `.${signature}`, `${proof}.`, `${proof}.extra`, ` ${proof}`,
      `${payload}.${signature.slice(0, -4)}`, `${payload}.${encode("signature")}`, `${payload}.!!!`,
      `${encode("not json")}.${signature}`, `${encode("null")}.${signature}`, `${encode("[]")}.${signature}`, `${encode("{}")}.${signature}`,
      `${encode("{\"hostId\":\"host-a\"}")}.${signature}`, `${signature}.${payload}`,
      undefined, null, 0, 42, true, {}, [], [proof], { proof }, Buffer.from(proof), Symbol("proof"), () => proof,
      "x".repeat(8_192), `${proof}${"A".repeat(8_192)}`, `${"A".repeat(8_192)}.${signature}`,
    ];
    const accepted = malformed.filter((candidate) => hostB.verify(candidate, expectedRelay) !== undefined);
    expect(accepted.map((candidate) => (typeof candidate === "string" ? JSON.stringify(candidate.replace(proof, "<proof>")) : typeof candidate))).toEqual([]);
    // A genuine signature over oversized claims is still refused.
    const oversized = hostA.sign({ instanceId: "i".repeat(8_192), generation: "1", audience: "host-b", purpose: "relay", bind: bindDigest("x") });
    expect(hostB.verify(oversized, expectedRelay)).toBeUndefined();
    // None of the refusals consumed or poisoned the genuine proof.
    expect(hostB.verify(proof, expectedRelay)).toMatchObject({ hostId: "host-a" });
  });

  it("H1-05 refuses a genuine proof whose signature is not canonically encoded", () => {
    const { hostA, hostB } = createFixture();
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const respellings: readonly (readonly [string, (proof: string) => string])[] = [
      ["trailing space", (proof) => `${proof} `],
      ["trailing newline", (proof) => `${proof}\n`],
      ["inner whitespace", (proof) => `${proof.slice(0, -8)} ${proof.slice(-8)}`],
      ["one padding character", (proof) => `${proof}=`],
      ["two padding characters", (proof) => `${proof}==`],
      ["a character outside the alphabet", (proof) => `${proof}!`],
      // A 64-byte signature leaves four unused bits in its last character.
      ["unused trailing bits", (proof) => `${proof.slice(0, -1)}${alphabet.charAt(alphabet.indexOf(proof.slice(-1)) + 1)}`],
    ];
    const accepted = respellings.filter(([, respell]) => {
      const proof = relay(hostA, "host-b");
      const respelled = respell(proof);
      assert.notEqual(respelled, proof);
      return hostB.verify(respelled, expectedRelay) !== undefined;
    }).map(([label]) => label);
    expect(accepted).toEqual([]);
  });
});

describe("host credential rotation, expiry and revocation", () => {
  const T1 = T0 + 10 * MINUTE;
  const T2 = T0 + 20 * MINUTE;

  /** host-a rotates from an expiring credential to a new one whose validity overlaps it during [T1, T2). */
  const createRotation = () => {
    const older = generateHostCredential("host-a-2025");
    const newer = generateHostCredential("host-a-2026");
    const b = generateHostCredential("host-b-key");
    const peer = member("host-b", b);
    const windowed: NamespacePolicy = { namespaceId, revision: 1, members: [
      { hostId: "host-a", credentials: [{ ...older.verifier, expiresAt: iso(T2) }, { ...newer.verifier, notBefore: iso(T1) }] }, peer,
    ] };
    // The same keys without validity windows: mints proofs a correctly configured signer would refuse to issue.
    const unbounded: NamespacePolicy = { namespaceId, revision: 1, members: [{ hostId: "host-a", credentials: [older.verifier, newer.verifier] }, peer] };
    const clock = createClock();
    const admit = (hostId: string, credential: HostAdmissionOptions["credential"], policy: NamespacePolicy): HostAdmission =>
      createHostAdmission({ hostId, policy, credential, now: clock.now });
    return { older, newer, b, windowed, unbounded, clock, admit, verifier: admit("host-b", b.credential, windowed) };
  };

  it("H1-06 rotates a provider-supplied credential across an overlapping validity window without a restart", () => {
    const { older, newer, windowed, clock, admit, verifier } = createRotation();
    let held: HostCredential = older.credential;
    const signer = admit("host-a", () => held, windowed);
    const accepted = (): string | undefined => verifier.verify(relay(signer, "host-b"), expectedRelay)?.credentialId;

    // Before the new credential becomes valid only the old one is usable.
    clock.set(T1 - 1);
    expect(signer.credentialId()).toBe("host-a-2025");
    expect(accepted()).toBe("host-a-2025");
    held = newer.credential;
    expect(signer.isCurrent()).toBe(false);
    expect(() => relay(signer, "host-b")).toThrow(/not valid for this namespace member/u);

    // During the overlap both verify.
    for (const at of [T1, T1 + MINUTE, T2 - 1]) {
      clock.set(at);
      held = older.credential;
      expect(signer.isCurrent()).toBe(true);
      expect(accepted()).toBe("host-a-2025");
      held = newer.credential;
      expect(signer.isCurrent()).toBe(true);
      expect(signer.credentialId()).toBe("host-a-2026");
      expect(accepted()).toBe("host-a-2026");
    }

    // From the expiry instant only the new one is usable.
    clock.set(T2);
    held = older.credential;
    expect(signer.isCurrent()).toBe(false);
    expect(() => relay(signer, "host-b")).toThrow(/not valid for this namespace member/u);
    held = newer.credential;
    expect(signer.isCurrent()).toBe(true);
    expect(accepted()).toBe("host-a-2026");
  });

  it("H1-06 refuses an expiring credential exactly from expiresAt at the verifier", () => {
    const { older, unbounded, clock, admit, verifier } = createRotation();
    const issuer = admit("host-a", older.credential, unbounded);
    clock.set(T2 - 1);
    const lastValid = relay(issuer, "host-b");
    const carriedOver = relay(issuer, "host-b");
    expect(verifier.verify(lastValid, expectedRelay)).toMatchObject({ hostId: "host-a", credentialId: "host-a-2025" });
    // Validity is judged on the verifier's clock: a proof issued a millisecond earlier is refused at the boundary.
    clock.set(T2);
    expect(verifier.verify(carriedOver, expectedRelay)).toBeUndefined();
    expect(verifier.verify(relay(issuer, "host-b"), expectedRelay)).toBeUndefined();
    clock.set(T2 + 1);
    expect(verifier.verify(relay(issuer, "host-b"), expectedRelay)).toBeUndefined();
    clock.set(T2 + MINUTE);
    expect(verifier.verify(relay(issuer, "host-b"), expectedRelay)).toBeUndefined();
  });

  it("H1-06 refuses a new credential before notBefore and accepts it exactly from notBefore", () => {
    const { newer, unbounded, clock, admit, verifier } = createRotation();
    const issuer = admit("host-a", newer.credential, unbounded);
    clock.set(T0);
    expect(verifier.verify(relay(issuer, "host-b"), expectedRelay)).toBeUndefined();
    clock.set(T1 - 1);
    const early = relay(issuer, "host-b");
    expect(verifier.verify(early, expectedRelay)).toBeUndefined();
    clock.set(T1);
    expect(verifier.verify(early, expectedRelay)).toMatchObject({ hostId: "host-a", credentialId: "host-a-2026" });
    expect(verifier.verify(relay(issuer, "host-b"), expectedRelay)).toMatchObject({ hostId: "host-a", credentialId: "host-a-2026" });
  });

  it("H1-06 stops a signer whose own credential expired", () => {
    const { older, newer, windowed, clock, admit, verifier } = createRotation();
    const signer = admit("host-a", older.credential, windowed);
    clock.set(T2 - 1);
    expect(signer.isCurrent()).toBe(true);
    expect(verifier.verify(relay(signer, "host-b"), expectedRelay)).toMatchObject({ credentialId: "host-a-2025" });
    clock.set(T2);
    expect(signer.isCurrent()).toBe(false);
    expect(() => relay(signer, "host-b")).toThrow(/not valid for this namespace member/u);
    expect(() => signer.credentialId()).toThrow(/not valid for this namespace member/u);
    // Expiry also prevents a restart with the old credential; the new one starts normally.
    expect(() => admit("host-a", older.credential, windowed)).toThrow(/not valid for this namespace member/u);
    expect(admit("host-a", newer.credential, windowed).isCurrent()).toBe(true);
    // A credential that is not yet valid cannot start a host either.
    clock.set(T1 - 1);
    expect(() => admit("host-a", newer.credential, windowed)).toThrow(/not valid for this namespace member/u);
    expect(signer.isCurrent()).toBe(true);
  });

  it("H1-06 refuses a credential revoked by a new policy revision", () => {
    const { older, newer, b, unbounded, admit } = createRotation();
    const revoking: NamespacePolicy = { ...unbounded, revision: 2, revokedCredentialIds: ["host-a-2025"] };
    const verifier = admit("host-b", b.credential, revoking);
    // The revoked holder still signs under the same revision without the revocation list.
    const holder = admit("host-a", older.credential, { ...unbounded, revision: 2 });
    expect(verifier.verify(relay(holder, "host-b"), expectedRelay)).toBeUndefined();
    expect(() => admit("host-a", older.credential, revoking)).toThrow(/not valid for this namespace member/u);
    expect(() => admit("host-a", () => older.credential, revoking)).toThrow(/not valid for this namespace member/u);
    // The member's other credential and the previous revision are unaffected.
    expect(verifier.verify(relay(admit("host-a", newer.credential, revoking), "host-b"), expectedRelay)).toMatchObject({ hostId: "host-a", credentialId: "host-a-2026" });
    expect(admit("host-b", b.credential, unbounded).verify(relay(admit("host-a", older.credential, unbounded), "host-b"), expectedRelay))
      .toMatchObject({ credentialId: "host-a-2025" });
  });

  it("H1-06 never places a secret in a thrown error", () => {
    const { older, newer, b, windowed, unbounded, clock, admit } = createRotation();
    const unrelated = generateHostCredential("host-a-2025");
    const expiring = admit("host-a", older.credential, windowed);
    const secrets = [older, newer, b, unrelated].map((generated) => generated.credential.secret);
    const failures: readonly (() => unknown)[] = [
      () => admit("host-a", unrelated.credential, windowed),
      () => admit("host-a", b.credential, windowed),
      () => admit("host-a", { id: "host-a-2025", secret: newer.credential.secret }, windowed),
      () => admit("host-z", older.credential, windowed),
      () => admit("host-a", newer.credential, windowed),
      () => admit("host-a", older.credential, { ...unbounded, revision: 2, revokedCredentialIds: ["host-a-2025"] }),
      () => admit("host-a", { id: "host-a-2025", secret: `${older.credential.secret}A` }, windowed),
      () => admit("host-a", { id: "host-a-2025", secret: older.credential.secret.slice(1) }, windowed),
      () => admit("host-a", { id: older.credential.secret, secret: older.credential.secret }, windowed),
      // A secret pasted into trusted policy by mistake is rejected without being echoed.
      () => admit("host-a", older.credential, { ...windowed, members: [{ hostId: "host-a", credentials: [{ ...older.verifier, ...older.credential }] }] }),
      () => admit("host-a", older.credential, { ...windowed, members: [{ hostId: "host-a", credentials: [{ id: "host-a-2025", publicKey: `${older.credential.secret}A` }] }] }),
      () => {
        clock.set(T2);
        return relay(expiring, "host-b");
      },
      () => expiring.credentialId(),
    ];
    for (const failure of failures) {
      const error = thrownBy(failure);
      const rendered = [String(error), error instanceof Error ? error.message : "", error instanceof Error ? error.stack ?? "" : "", JSON.stringify(error)];
      for (const secret of secrets) {
        for (const text of rendered) expect(text.includes(secret)).toBe(false);
      }
    }
  });
});

describe("namespace policy digest and endpoints", () => {
  const a = generateHostCredential("host-a-key");
  const b = generateHostCredential("host-b-key");
  const c = generateHostCredential("host-c-key");
  const base: NamespacePolicy = { namespaceId, revision: 1, members: [member("host-a", a), member("host-b", b), member("host-c", c)] };
  const now = (): number => T0;
  const admitB = (policy: NamespacePolicy, extra: Partial<HostAdmissionOptions> = {}): HostAdmission =>
    createHostAdmission({ hostId: "host-b", policy, credential: b.credential, now, ...extra });
  const withHostA = (entry: NamespaceMemberPolicy): NamespacePolicy => ({ ...base, members: [entry, member("host-b", b), member("host-c", c)] });

  it("H1-09 gives every member built from the same policy the same revision and digest", () => {
    const fromA = createHostAdmission({ hostId: "host-a", policy: base, credential: a.credential, now });
    const fromB = admitB(base);
    const fromCopy = createHostAdmission({ hostId: "host-c", policy: structuredClone(base), credential: () => c.credential, now: () => T0 + MINUTE });
    expect(fromA.policy.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(fromB.policy).toEqual(fromA.policy);
    expect(fromCopy.policy).toEqual(fromA.policy);
    expect(fromA.policy.revision).toBe(1);
    expect(admitB(base).policy.digest).toBe(fromB.policy.digest);
  });

  it("H1-09 changes the digest and not the revision when any member or credential changes", () => {
    const replacement = generateHostCredential("host-a-key");
    const additional = generateHostCredential("host-a-next");
    const joining = generateHostCredential("host-d-key");
    const variants: readonly (readonly [string, NamespacePolicy])[] = [
      ["an added member", { ...base, members: [...base.members, member("host-d", joining)] }],
      ["a removed member", { ...base, members: [member("host-a", a), member("host-b", b)] }],
      ["a renamed member", { ...base, members: [member("host-a", a), member("host-b", b), member("host-z", c)] }],
      ["a replaced public key", withHostA(member("host-a", replacement))],
      ["a renamed credential", withHostA({ hostId: "host-a", credentials: [{ ...a.verifier, id: "host-a-renamed" }] })],
      ["an added credential", withHostA({ hostId: "host-a", credentials: [a.verifier, additional.verifier] })],
      ["a credential expiry", withHostA({ hostId: "host-a", credentials: [{ ...a.verifier, expiresAt: iso(T0 + MINUTE) }] })],
      ["a credential start", withHostA({ hostId: "host-a", credentials: [{ ...a.verifier, notBefore: iso(T0 - MINUTE) }] })],
      ["a revoked credential", { ...base, revokedCredentialIds: ["host-c-key"] }],
      ["an instance bound", withHostA(member("host-a", a, { maxInstances: 2 }))],
      ["an endpoint", withHostA(member("host-a", a, { endpoints: ["wss://host-a.internal:7443/relay"] }))],
      ["restricted operations", withHostA(member("host-a", a, { operations: ["serve", "route"] }))],
      ["another namespace", { ...base, namespaceId: "ahp-namespace:support-app/other" }],
    ];
    const baseline = admitB(base).policy;
    const digests = new Map<string, string>([[baseline.digest, "the unchanged policy"]]);
    for (const [label, policy] of variants) {
      const { revision, digest } = admitB(policy).policy;
      expect(revision, label).toBe(baseline.revision);
      expect(digest, label).toMatch(/^[0-9a-f]{64}$/u);
      expect(digests.get(digest), `${label} collides`).toBeUndefined();
      digests.set(digest, label);
      // The same change is the same digest for another member.
      expect(admitB(structuredClone(policy)).policy.digest, label).toBe(digest);
    }
    expect(digests.size).toBe(variants.length + 1);
  });

  it("H8-05 folds the declared application configuration into the digest and not the revision", () => {
    const declared = { allowedKinds: ["review"], defaultMaxActiveClaims: 3 };
    const baseline = admitB(base).policy;
    const configured = admitB(base, { configuration: declared }).policy;
    expect(configured.revision).toBe(baseline.revision);
    expect(configured.digest).not.toBe(baseline.digest);
    // Every member declaring the same configuration agrees.
    expect(createHostAdmission({ hostId: "host-a", policy: base, credential: a.credential, now, configuration: structuredClone(declared) }).policy).toEqual(configured);
    const differing = [
      { allowedKinds: ["triage"], defaultMaxActiveClaims: 3 },
      { allowedKinds: ["review", "triage"], defaultMaxActiveClaims: 3 },
      { allowedKinds: ["review"], defaultMaxActiveClaims: 4 },
      { allowedKinds: ["review"] },
      {},
      "review",
    ].map((configuration) => admitB(base, { configuration }).policy);
    for (const policy of differing) expect(policy.revision).toBe(baseline.revision);
    expect(new Set([baseline.digest, configured.digest, ...differing.map((policy) => policy.digest)]).size).toBe(differing.length + 2);
  });

  it("H1-09 rejects a duplicate member host name", () => {
    const again = generateHostCredential("host-a-second");
    expect(() => admitB({ ...base, members: [...base.members, member("host-a", again)] })).toThrow(/Duplicate namespace member/u);
    expect(() => admitB({ ...base, members: [member("host-b", b), member("host-b", again)] })).toThrow(/Duplicate namespace member/u);
  });

  it("H1-09 rejects a credential identifier listed more than once", () => {
    const again = generateHostCredential("host-a-key");
    // Across members, with the same and with a different key, and within one member.
    expect(() => admitB(withHostA({ hostId: "host-a", credentials: [{ ...a.verifier, id: "host-c-key" }] }))).toThrow(/Duplicate host credential identifier/u);
    expect(() => admitB({ ...base, members: [member("host-a", a), member("host-b", b), member("host-c", a)] })).toThrow(/Duplicate host credential identifier/u);
    expect(() => admitB({ ...base, members: [member("host-a", a), member("host-b", b), member("host-c", again)] })).toThrow(/Duplicate host credential identifier/u);
    expect(() => admitB(withHostA({ hostId: "host-a", credentials: [a.verifier, again.verifier] }))).toThrow(/Duplicate host credential identifier/u);
  });

  it.each([
    ["an https scheme", "https://host-a.internal:7443/relay"],
    ["an http scheme", "http://host-a.internal:7443/relay"],
    ["a file scheme", "file:///var/run/host-a.sock"],
    ["an embedded user name and password", "wss://relay:hunter2@host-a.internal:7443/relay"],
    ["an embedded user name", "wss://relay@host-a.internal:7443/relay"],
    ["an embedded password", "wss://:hunter2@host-a.internal:7443/relay"],
    ["a fragment", "wss://host-a.internal:7443/relay#fragment"],
    ["no scheme", "host-a.internal:7443"],
    ["a relative path", "/relay"],
    ["no characters", ""],
  ])("H1-09 rejects a member endpoint with %s", (_label, endpoint) => {
    expect(() => admitB(withHostA(member("host-a", a, { endpoints: [endpoint] })))).toThrow(TypeError);
    expect(() => admitB(withHostA(member("host-a", a, { endpoints: ["wss://host-a.internal:7443/relay", endpoint] })))).toThrow(TypeError);
    expect(() => admitB(withHostA(member("host-a", a, { endpoints: [endpoint] })), { requireTls: true })).toThrow(TypeError);
  });

  it("H1-09 rejects a plaintext endpoint when TLS is required", () => {
    const plaintext = withHostA(member("host-a", a, { endpoints: ["ws://host-a.internal:7443/relay"] }));
    const encrypted = withHostA(member("host-a", a, { endpoints: ["wss://host-a.internal:7443/relay"] }));
    expect(() => admitB(plaintext, { requireTls: true })).toThrow(/must use TLS/u);
    expect(() => admitB(withHostA(member("host-a", a, { endpoints: ["wss://host-a.internal:7443/relay", "ws://host-a.internal:7443/relay"] })), { requireTls: true }))
      .toThrow(/must use TLS/u);
    expect(admitB(plaintext).endpointAllowed("host-a", "ws://host-a.internal:7443/relay")).toBe(true);
    expect(admitB(plaintext, { requireTls: false }).endpointAllowed("host-a", "ws://host-a.internal:7443/relay")).toBe(true);
    expect(admitB(encrypted, { requireTls: true }).endpointAllowed("host-a", "wss://host-a.internal:7443/relay")).toBe(true);
  });

  it("H1-09 allows only the exact endpoint listed for that host", () => {
    const listed = "wss://host-a.internal:7443/relay";
    const peerEndpoint = "wss://host-b.internal:7443/relay";
    const admission = admitB({ ...base, members: [member("host-a", a, { endpoints: [listed] }), member("host-b", b, { endpoints: [peerEndpoint] }), member("host-c", c)] });
    expect(admission.endpointAllowed("host-a", listed)).toBe(true);
    expect(admission.endpointAllowed("host-b", peerEndpoint)).toBe(true);
    for (const near of [
      `${listed}/`, "wss://host-a.internal:7443/", "wss://host-a.internal:7443", "wss://host-a.internal/relay", "wss://host-a.internal:7444/relay",
      "wss://HOST-A.internal:7443/relay", "WSS://host-a.internal:7443/relay", "wss://host-a.internal:7443/Relay", "wss://host-a.internal:7443/%72elay",
      "wss://host-a.internal:7443/relay?x=1", "wss://host-a.internal:7443/relay#", "wss://host-a.internal:7443/x/../relay", "wss://host-a.internal.:7443/relay",
      "ws://host-a.internal:7443/relay", ` ${listed}`, `${listed} `, "wss://host-a.internal:7443/rela", "",
    ]) {
      expect(admission.endpointAllowed("host-a", near), near).toBe(false);
    }
    // An endpoint is allowed for the host that lists it and for no other.
    expect(admission.endpointAllowed("host-b", listed)).toBe(false);
    expect(admission.endpointAllowed("host-a", peerEndpoint)).toBe(false);
    expect(admission.endpointAllowed("host-c", listed)).toBe(false);
    expect(admission.endpointAllowed("host-c", "")).toBe(false);
    expect(admission.endpointAllowed("host-z", listed)).toBe(false);
  });
});
