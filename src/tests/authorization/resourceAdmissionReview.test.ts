import { describe, expect, it } from "vitest";

import { createReferenceAuthorizer } from "@authorization";
import { createToolPolicyFactory } from "@toolPolicy";

const resource = { domainId: "domain", kind: "session", id: "session", instanceId: "instance" };
const route = { origin: resource, targets: [resource] };
const actor = {
  actor: { kind: "user" as const, principal: { domainId: "domain", subject: "ada" } },
  connectionId: "connection",
  authRevision: "auth",
};
const registration = {
  resource,
  owner: { domainId: "domain", subject: "owner" },
  route,
  externalAuthority: "none" as const,
};
const ref = (id: string) => ({ id, revision: 1 });
const admission = (key: string) => ({ sessionType: { key, version: 1 }, providerId: "host" });
const policy = (id: string) => ({
  id,
  revision: 1,
  operations: { invoke: { actor: { mode: "direct-grant" as const, actors: ["user" as const] } } },
  challenge: { required: false },
});
const request = (id: string) => ({
  actor,
  operation: "invoke" as const,
  bindingId: `${id}-grant`,
  policyRef: ref(id),
  scope: resource,
  route,
});

const fixture = (linked: boolean) => {
  const host = createReferenceAuthorizer({
    policies: createToolPolicyFactory({
      policies: [policy("inside"), policy("outside")],
      bindings: [
        { ...admission("restricted"), admitted: { policies: [ref("inside")], namespaces: [] }, mandatory: [] },
        { ...admission("broad"), admitted: { policies: [ref("inside"), ref("outside")], namespaces: [] }, mandatory: [] },
      ],
    }),
    now: () => 1_700_000_000_000,
  });
  host.installAdmission(admission("restricted"));
  host.installAdmission(admission("broad"));
  host.installResource({ ...registration, ...(linked ? { admission: admission("restricted") } : {}) });
  for (const id of ["inside", "outside"]) {
    host.installBinding({
      id: `${id}-grant`, actor: actor.actor, scope: resource, roles: [], policies: [ref(id)],
      authority: { kind: "host-policy", policy: ref(id) }, revision: 1,
    });
  }
  return host;
};

describe("resource admission association", () => {
  it("rejects omitted admission on a linked resource without widening or invalidating current authority", async () => {
    const host = fixture(true);
    const allowed = await host.evaluate(request("inside"));
    expect(allowed.decision.effect).toBe("allow");
    expect((await host.evaluate(request("outside"))).decision.effect).toBe("deny");
    expect(() => {
      host.installResource(registration);
    }).toThrow(/admission/i);
    expect(host.matches(allowed.stamp, actor)).toBe(true);
    expect((await host.evaluate(request("outside"))).decision.effect).toBe("deny");
  });

  it("rejects a different admission and keeps identical linked reinstall idempotent", async () => {
    const host = fixture(true);
    const allowed = await host.evaluate(request("inside"));
    expect(allowed.decision.effect).toBe("allow");
    host.installResource({ ...registration, admission: admission("restricted") });
    expect(host.matches(allowed.stamp, actor)).toBe(true);
    expect(() => {
      host.installResource({ ...registration, admission: admission("broad") });
    }).toThrow(/admission/i);
    expect(host.matches(allowed.stamp, actor)).toBe(true);
    expect((await host.evaluate(request("outside"))).decision.effect).toBe("deny");
  });

  it("preserves explicit unlinked direct grants without manufacturing namespace authority", async () => {
    const host = fixture(false);
    const allowed = await host.evaluate(request("outside"));
    expect(allowed.decision.effect).toBe("allow");
    host.installResource(registration);
    expect(host.matches(allowed.stamp, actor)).toBe(true);
  });
});
