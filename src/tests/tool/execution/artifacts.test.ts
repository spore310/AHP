import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createApprovedArtifactSource, loadVerifiedArtifact, MAX_ARTIFACT_BYTES } from "@tool/helpers/execution/helpers/artifacts";
import { createCodingHarness } from "./fixtures";

const bytes = new TextEncoder().encode("inert fixture artifact");
const implementation = createCodingHarness()[0];
if (implementation === undefined) throw new Error("Missing fixture implementation.");
const { id, key, version } = implementation.definition;
const artifact = { contract: { id, key, version }, source: { id: "trusted-source", revision: 7 },
  descriptor: { artifactId: "fixture-artifact", publisherId: "trusted-publisher", contractRevision: version,
    implementationRevision: 5, runtime: "fixture", platform: "test", digest: createHash("sha256").update(bytes).digest("hex"), verificationRef: "approved-fixture" } };

it("F01/F03 verifies the pinned digest, runtime and trusted verifier before handing exact bytes to the explicit loader", async () => {
  const verify = vi.fn(() => true), load = vi.fn(() => implementation);
  const encoded = Buffer.from(bytes).toString("base64");
  const loader = { runtime: "fixture", platform: "test", verify, load };
  await expect(loadVerifiedArtifact(artifact, btoa("other"), loader, () => true)).resolves.toBeUndefined();
  await expect(loadVerifiedArtifact(artifact, encoded, { ...loader, runtime: "other" }, () => true)).resolves.toBeUndefined();
  await expect(loadVerifiedArtifact(artifact, encoded, { ...loader, verify: () => false }, () => true)).resolves.toBeUndefined();
  expect(load).not.toHaveBeenCalled();
  await expect(loadVerifiedArtifact(artifact, encoded, loader, () => true)).resolves.toBe(implementation);
  expect(verify).toHaveBeenCalledOnce();
  expect(load).toHaveBeenCalledWith(artifact, bytes);
});

it("F01/F02 trusts registered metadata only and rejects an oversized or revoked source before delivery", async () => {
  const read = vi.fn(() => new Uint8Array(MAX_ARTIFACT_BYTES + 1));
  const options = { read, approve: (candidate: typeof artifact) => candidate.descriptor.publisherId === "trusted-publisher" };
  const source = createApprovedArtifactSource(options);
  source.register(artifact);
  expect(() => {
    source.register({ ...artifact, descriptor: { ...artifact.descriptor, artifactId: "try-replace" } });
  }).toThrow();
  expect(source.find({ ...artifact.contract, version: version + 1 }, artifact.source)).toBeUndefined();
  const registered = source.find(artifact.contract, artifact.source);
  if (registered === undefined) throw new Error("Missing registered artifact.");
  const signal = new AbortController().signal;
  expect(await source.read(artifact, signal, () => true)).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
  expect(await source.read(registered, signal, () => true)).toBeUndefined();
  expect(read).toHaveBeenCalledOnce();
  const foreign = createApprovedArtifactSource(options);
  foreign.register({ ...artifact, descriptor: { ...artifact.descriptor, publisherId: "foreign" } });
  const wrongPublisher = foreign.find(artifact.contract, artifact.source);
  if (wrongPublisher === undefined) throw new Error("Missing foreign fixture.");
  expect(await foreign.read(wrongPublisher, signal, () => true)).toBeUndefined();
  expect(read).toHaveBeenCalledOnce();
});
