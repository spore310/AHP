import { expect, it } from "vitest";
import { createScopedToolPolicyExample } from "@application";
import { createReferenceAuthorizer, type ResourceRef } from "@authorization";
import { channel, createCodingHarness, createPolicyIntegrationFixture } from "./websocket/policyIntegrationFixture";

it.each(["direct", "namespace"] as const)("D01 %s example admits explicit policy, starts without grants and preserves owner/agent identity", async (mode) => {
  const example = createScopedToolPolicyExample(mode);
  const registry = createReferenceAuthorizer({ policies: example.policies, now: Date.now,
    permissionEvaluators: { "example-provider-consent": () => "deny" } });
  const origin: ResourceRef = { domainId: "example", id: "ahp-session:/triage", kind: "session", instanceId: "new" };
  const actor = { actor: example.juniorAgent, connectionId: "junior-socket", authRevision: "auth" };
  const route = { origin, targets: [origin] };
  registry.installResource({ resource: origin, owner: example.seniorOwner, route, externalAuthority: "none",
    mandatory: example.mandatory.map((ref) => ({ ref, applicable: true })) });
  expect(registry.owner(origin)).toEqual(example.seniorOwner);
  expect(registry.readBindings({ actor: actor.actor, scope: origin }).bindings).toEqual([]);
  const selected = await example.policies.select({ sessionType: example.sessionType, providerId: example.providerId,
    context: { actor, resource: origin, input: null } });
  expect(selected).toMatchObject({ effect: "selected", alternatives: [{ id: "example.tools", revision: 1 }] });
  expect(example.roles.projectManager).toEqual(["triage"]);
});

it("D01/Z01 real namespace SDK setup grants a junior agent one assigned call and a mandatory provider can deny it", async () => {
  const armed = { value: false };
  const f = await createPolicyIntegrationFixture({ mode: "cross", host: { admissionMode: "namespace" },
    providerBarrier: { armed, reached: () => undefined, decide: () => Promise.resolve("deny") } });
  try {
    const executor = await f.connect(f.executor), junior = await f.connect(f.caller), observer = await f.connect("observer");
    const tool = createCodingHarness()[0];
    if (tool === undefined) throw new Error("Missing example handler.");
    const { id, key, version } = tool.definition;
    const contract = { id, key, version };
    await executor.client.joinSession(channel, [tool]);
    expect((await observer.assigned()).tools).toEqual([]);
    expect(await observer.client.dispatchTool(channel, contract, { path: "namespace-is-only-admission" })).toMatchObject({ status: "denied" });
    await expect(junior.client.callTool(channel, contract, { path: "triage" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:triage:7" });
    armed.value = true;
    expect(await junior.client.dispatchTool(channel, contract, { path: "provider-denied" })).toMatchObject({ status: "denied" });
    expect(tool.execute).toHaveBeenCalledOnce();
  } finally {
    await f.stop();
  }
});
