import { expect, it } from "vitest";
import { createReferenceAuthorizer, type ResourceRef, type TrustedRequestContext } from "@authorization";
import { createToolAdmission, createToolPolicyFactory } from "@toolPolicy";
import { TOOL_SCHEMA_DIALECT } from "@tools";

it("Q02 rejects collisions, bounds pending proposals per actor and releases expired reservations", async () => {
  const ref = { id: "proposal.policy", revision: 1 };
  const actor: TrustedRequestContext = { actor: { kind: "user", principal: { domainId: "test", subject: "creator" } }, connectionId: "socket", authRevision: "auth" };
  const origin: ResourceRef<"session"> = { domainId: "test", kind: "session", id: "ahp-session:/proposal", instanceId: "first" };
  const sessionType = { key: "test.session", version: 1 };
  const policies = createToolPolicyFactory({ policies: [{ ...ref, challenge: { required: false },
    operations: { propose: { actor: { mode: "roles", actors: { user: { anyOf: ["author"] } } } } } }],
  bindings: [{ sessionType, providerId: "fixture", admitted: { policies: [ref], namespaces: [] }, mandatory: [] }] });
  let time = Date.now();
  const registry = createReferenceAuthorizer({ policies, now: () => time });
  registry.installResource({ resource: origin, owner: actor.actor.principal, route: { origin, targets: [origin] }, mandatory: [], externalAuthority: "none" });
  registry.installBinding({ id: "proposal-author", actor: actor.actor, scope: origin, roles: ["author"], policies: [ref],
    revision: 1, authority: { kind: "host-policy", policy: ref } });
  const service = createToolAdmission({ registry, policies, activationPolicies: [], now: () => time });
  const scope = { actor, origin, sessionType, providerId: "fixture", signal: new AbortController().signal, current: () => true, fence: () => true };
  const definition = (index: number) => ({ id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`, key: `tool.item${String(index)}`, version: 1,
    name: `item${String(index)}`, schemaDialect: TOOL_SCHEMA_DIALECT, inputSchema: { type: "object", properties: {} } });
  const propose = (index: number) => service.manage(scope, { operation: "propose", definition: definition(index) });
  expect((await propose(1))?.receipt.status).toBe("proposed");
  expect(await propose(1)).toBeUndefined();
  for (let index = 2; index <= 8; index += 1) expect((await propose(index))?.receipt.status).toBe("proposed");
  expect(await propose(9)).toBeUndefined();
  time += 300_000;
  expect((await propose(1))?.receipt.status).toBe("proposed");
  expect(registry.getContract(definition(1).id)).toBeUndefined();
});
