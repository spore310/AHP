import { canonicalJsonEqual } from "@tool/helpers/protocol/helpers/descriptors";
import { approvedArtifactSchema, MAX_ARTIFACT_BYTES, MAX_ARTIFACT_ENCODING } from "./types";
import type { ApprovedArtifact, ApprovedArtifactLoader, ApprovedArtifactSource, ArtifactSourceOptions } from "./types";

const encode = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
};

async function matchesDigest(bytes: Uint8Array, digest: string): Promise<boolean> {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("") === digest;
}

function capture(artifact: ApprovedArtifact): ApprovedArtifact {
  const checked = approvedArtifactSchema.parse(artifact);
  if (checked.contract.version !== checked.descriptor.contractRevision) throw new TypeError("Artifact contract revision does not match.");
  Object.freeze(checked.contract);
  Object.freeze(checked.source);
  Object.freeze(checked.descriptor);
  return Object.freeze(checked);
}

/** The SDK transports bounded bytes. Source lookup and publisher trust belong to the host. */
export function createApprovedArtifactSource(options: ArtifactSourceOptions): ApprovedArtifactSource {
  const approve = options.approve.bind(options), read = options.read.bind(options);
  const entries = new Map<string, ApprovedArtifact>();
  let reading = 0;
  return Object.freeze<ApprovedArtifactSource>({
    register(raw) {
      const artifact = capture(raw);
      if (entries.size >= 128 || entries.has(artifact.descriptor.artifactId) || [...entries.values()].some((entry) =>
        canonicalJsonEqual(entry.contract, artifact.contract) && canonicalJsonEqual(entry.source, artifact.source))) throw new TypeError("Artifact registration unavailable.");
      entries.set(artifact.descriptor.artifactId, artifact);
    },
    find: (contract, source) => [...entries.values()].find((entry) => canonicalJsonEqual(entry.contract, contract) && canonicalJsonEqual(entry.source, source)),
    async read(artifact, signal, current) {
      const live = (): boolean => !signal.aborted && current() && entries.get(artifact.descriptor.artifactId) === artifact;
      if (reading >= 8 || !live()) return undefined;
      reading += 1;
      try {
        const approval: unknown = await approve(artifact, signal);
        if (approval !== true || !live()) return undefined;
        const source = await read(artifact, signal);
        if (!live() || !(source instanceof Uint8Array) || source.byteLength === 0 || source.byteLength > MAX_ARTIFACT_BYTES) return undefined;
        const bytes = Uint8Array.from(source);
        if (!(await matchesDigest(bytes, artifact.descriptor.digest)) || !live()) return undefined;
        return encode(bytes);
      } catch {
        return undefined;
      } finally {
        reading -= 1;
      }
    },
  });
}

/** Check the same owned bytes the explicit application loader receives. */
export async function loadVerifiedArtifact(raw: ApprovedArtifact, encoded: string, loader: ApprovedArtifactLoader, current: () => boolean) {
  const artifact = capture(raw);
  if (artifact.descriptor.runtime !== loader.runtime || artifact.descriptor.platform !== loader.platform
    || encoded.length === 0 || encoded.length > MAX_ARTIFACT_ENCODING || !current()) return undefined;
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  if (bytes.length === 0 || bytes.length > MAX_ARTIFACT_BYTES || !(await matchesDigest(bytes, artifact.descriptor.digest)) || !current()) return undefined;
  const verified: unknown = await loader.verify(artifact, Uint8Array.from(bytes));
  if (verified !== true || !current()) return undefined;
  const implementation = await loader.load(artifact, bytes);
  return current() ? implementation : undefined;
}
