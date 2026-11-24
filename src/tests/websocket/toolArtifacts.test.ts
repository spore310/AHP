import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createApprovedArtifactSource, type ChallengeAdapter } from "@tool/execution";
import { channel, createCodingHarness, createPolicyIntegrationFixture } from "./policyIntegrationFixture";

const fixtures: Array<Awaited<ReturnType<typeof createPolicyIntegrationFixture>>> = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop()));
});

async function start(sourceReader?: () => Promise<Uint8Array>) {
  const implementation = createCodingHarness()[0];
  if (implementation === undefined) throw new Error("Missing artifact fixture handler.");
  const definition = implementation.definition;
  const contract = { id: definition.id, key: definition.key, version: definition.version };
  const bytes = new TextEncoder().encode("ARTIFACT-BYTES-CANARY");
  const source = { id: "artifact-source", revision: 7 };
  const descriptor = { artifactId: "ARTIFACT-REFERENCE-CANARY", publisherId: "ARTIFACT-PUBLISHER-CANARY", contractRevision: contract.version,
    implementationRevision: 5, runtime: "fixture", platform: "test", digest: createHash("sha256").update(bytes).digest("hex"), verificationRef: "approved" };
  const read = vi.fn(sourceReader ?? (() => Promise.resolve(bytes)));
  const artifacts = createApprovedArtifactSource({ read, approve: () => true });
  artifacts.register({ contract, source, descriptor });
  const adapter: ChallengeAdapter = { begin: () => ({ continuationId: "artifact-local-challenge", expiresAt: new Date(Date.now() + 20000).toISOString(), presentation: { kind: "wait" } }),
    verify: () => ({ status: "verified", continuationId: "artifact-local-challenge" }) };
  const f = await createPolicyIntegrationFixture({ mode: "cross", host: { artifacts, invokeChallenge: true, dispatcher: { challenge: { adapter } },
    registrations: [{ definition, source, revision: 5, implementation: { location: "client", suppliedBy: "server", implementation: "approved-artifact", artifactRef: descriptor.artifactId } }] } });
  fixtures.push(f);
  const load = vi.fn(() => implementation);
  const loader = { runtime: descriptor.runtime, platform: descriptor.platform, verify: vi.fn(() => true), load };
  return { ...f, bytes, descriptor, read, contract, implementation, loader, load };
}

it("F02/F03/F04 delivers only to the assigned executor and uses the normal challenge and execution path", async () => {
  const f = await start();
  const observer = await f.connect("observer"), executor = await f.connect(f.executor), caller = await f.connect(f.caller);
  await observer.request("x-ahp/tools/extensions", { version: 1 });
  const view = await observer.assigned();
  expect(await observer.request("x-ahp/tools/artifact", { version: 1, channel, viewRevision: view.viewRevision, contract: f.contract })).toMatchObject({ result: { status: "unavailable" } });
  expect(f.read).not.toHaveBeenCalled();
  const assigned = await executor.assigned();
  await expect(executor.advertise(assigned.viewRevision, [f.contract])).rejects.toThrow();
  expect(f.read).not.toHaveBeenCalled();
  await expect(executor.client.joinSession(channel, [f.implementation])).rejects.toThrow("verified loader");
  await expect(executor.client.loadApprovedTool(channel, f.contract, { ...f.loader, verify: () => false })).rejects.toThrow("verified");
  expect(f.load).not.toHaveBeenCalled();
  await executor.client.loadApprovedTool(channel, f.contract, f.loader);
  expect(f.load).toHaveBeenCalledOnce();
  const receipt = await caller.client.dispatchTool(channel, f.contract, { path: "approved-artifact" });
  if (receipt.status !== "challenge-required") throw new Error("Missing execution challenge.");
  expect(f.implementation.execute).not.toHaveBeenCalled();
  expect(await caller.client.resumeTool(receipt.continuationId, "fixture-proof")).toMatchObject({ status: "accepted" });
  await vi.waitFor(async () => {
    expect(await caller.client.statusTool(receipt.callId)).toMatchObject({ status: "completed", output: { value: "P12-HANDLER-RESULT:coding.read:approved-artifact:7" } });
  });
  expect(f.implementation.execute).toHaveBeenCalledOnce();
  for (const peer of [observer, caller]) {
    await peer.client.connection.protocol.ping();
    expect(JSON.stringify(peer.received)).not.toMatch(/ARTIFACT-REFERENCE-CANARY|ARTIFACT-PUBLISHER-CANARY/);
    expect(JSON.stringify(peer.received)).not.toContain(Buffer.from(f.bytes).toString("base64"));
  }
});

it("F02 rechecks the exact recipient after a parked read and drops bytes after revocation", async () => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<Uint8Array>();
  const f = await start(() => {
    entered.resolve(undefined);
    return release.promise;
  });
  const executor = await f.connect(f.executor);
  const loading = executor.client.loadApprovedTool(channel, f.contract, f.loader).then(() => "loaded", () => "denied");
  await entered.promise;
  const scope = f.host.sessions.authorization?.getResource(channel);
  if (scope === undefined) throw new Error("Missing artifact scope.");
  expect(f.registry.removeBinding({ scope, bindingId: "fixture-grant-" + f.executor, revision: 1 })).toBe(true);
  release.resolve(f.bytes);
  expect(await loading).toBe("denied");
  expect(f.load).not.toHaveBeenCalled();
  expect(JSON.stringify(executor.received)).not.toContain(Buffer.from(f.bytes).toString("base64"));
});

it.each([["verify", "shutdown"], ["load", "EOF"]] as const)("rejects active and queued joins while %s is parked during %s", async (step, ending) => {
  const f = await start();
  const executor = await f.connect(f.executor);
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>();
  const loader = { ...f.loader, async verify() {
    if (step === "verify") {
      entered.resolve(undefined);
      await release.promise;
    }
    return true;
  }, load: vi.fn(async () => {
    if (step === "load") {
      entered.resolve(undefined);
      await release.promise;
    }
    return f.implementation;
  }) };
  const states: string[] = [];
  const observe = (job: Promise<void>) => job.then(() => states.push("fulfilled"), () => states.push("rejected"));
  const active = observe(executor.client.loadApprovedTool(channel, f.contract, loader));
  await entered.promise;
  const queued = observe(executor.client.joinSession(channel, []));
  try {
    if (ending === "shutdown") await executor.client.shutdown();
    else {
      await executor.transport.close();
      await executor.closed;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(states).toEqual(["rejected", "rejected"]);
  } finally {
    release.resolve(undefined);
    await Promise.all([active, queued]);
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(loader.load).toHaveBeenCalledTimes(step === "load" ? 1 : 0);
  expect(executor.sent).not.toContainEqual(expect.objectContaining({ method: "x-ahp/tools/advertise" }));
  expect(f.implementation.execute).not.toHaveBeenCalled();
});
