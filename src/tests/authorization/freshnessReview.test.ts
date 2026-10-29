import { afterEach, describe, expect, it, vi } from "vitest";

import { createReferenceAuthorizer } from "@authorization";
import { createToolPolicyFactory } from "@toolPolicy";

const start = 1_700_000_000_000;
const scope = { domainId: "domain", kind: "session", id: "session", instanceId: "instance" };
const route = { origin: scope, targets: [scope] };
const actor = {
  actor: { kind: "user" as const, principal: { domainId: "domain", subject: "ada" } },
  connectionId: "connection",
  authRevision: "auth",
};
const ref = (id: string) => ({ id, revision: 1 });

const direct = (id: string, extra: { readonly requiredPermissions?: readonly string[]; readonly extension?: unknown } = {}) => ({
  id,
  revision: 1,
  ...(extra.extension === undefined ? {} : { extension: extra.extension }),
  operations: {
    invoke: {
      actor: { mode: "direct-grant" as const, actors: ["user" as const] },
      ...(extra.requiredPermissions === undefined ? {} : { requiredPermissions: extra.requiredPermissions }),
    },
  },
  challenge: { required: false },
});

const install = (
  host: ReturnType<typeof createReferenceAuthorizer>,
  bindingId: string,
  policyId: string,
  expiresAt?: string,
) => {
  host.installBinding({
    id: bindingId,
    actor: actor.actor,
    scope,
    roles: [],
    policies: [ref(policyId)],
    authority: { kind: "host-policy", policy: ref(policyId) },
    revision: 1,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  });
};

afterEach(() => {
  vi.useRealTimers();
});

describe("P03 freshness slice", () => {
  it("keeps the captured hook deadline after the options object changes", async () => {
    vi.useFakeTimers();
    const options = {
      policies: createToolPolicyFactory({ policies: [direct("needs", { requiredPermissions: ["blocked"] })] }),
      now: () => start,
      hookDeadlineMs: 60_000,
      permissionEvaluators: { blocked: () => new Promise<"allow">(() => undefined) },
    };
    const host = createReferenceAuthorizer(options);
    options.hookDeadlineMs = 5;
    host.installResource({
      resource: scope, owner: { domainId: "domain", subject: "owner" }, route,
      mandatory: [], externalAuthority: "none",
    });
    install(host, "grant", "needs");
    let settled = false;
    const pending = host.evaluate({
      actor, operation: "invoke", bindingId: "grant", policyRef: ref("needs"), scope, route,
    }).then((decision) => {
      settled = true;
      return decision;
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(59_950);
    expect((await pending).decision.effect).toBe("deny");
  });

  it("keeps the original extension callback when a different registration is rejected", async () => {
    const original = () => "allow" as const;
    const replacement = () => "deny" as const;
    const host = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [direct("extended", { extension: { lane: "chat" } })] }),
      now: () => start,
      caps: { maxExtensionEvaluators: 1 },
    });
    host.installPolicyExtensionEvaluator(ref("extended"), original);
    host.installPolicyExtensionEvaluator(ref("extended"), original);
    expect(() => {
      host.installPolicyExtensionEvaluator(ref("extended"), replacement);
    }).toThrow(/conflict/i);
    host.installResource({
      resource: scope, owner: { domainId: "domain", subject: "owner" }, route,
      mandatory: [], externalAuthority: "none",
    });
    install(host, "grant", "extended");
    expect((await host.evaluate({
      actor, operation: "invoke", bindingId: "grant", policyRef: ref("extended"), scope, route,
    })).decision.effect).toBe("allow");
  });

  it("does not stale a pending allow when a conflicting extension registration is rejected", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = () => "allow" as const;
    const host = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [direct("needs", { requiredPermissions: ["check"], extension: { lane: "chat" } })] }),
      now: () => start,
      permissionEvaluators: { check: () => gate.then(() => "allow" as const) },
    });
    host.installPolicyExtensionEvaluator(ref("needs"), original);
    host.installResource({
      resource: scope, owner: { domainId: "domain", subject: "owner" }, route,
      mandatory: [], externalAuthority: "none",
    });
    install(host, "grant", "needs");
    const pending = host.evaluate({
      actor, operation: "invoke", bindingId: "grant", policyRef: ref("needs"), scope, route,
    });
    expect(() => {
      host.installPolicyExtensionEvaluator(ref("needs"), () => "deny" as const);
    }).toThrow(/conflict/i);
    release?.();
    expect((await pending).decision.effect).toBe("allow");
  });

  it("denies when a mandatory binding expires during its callback", async () => {
    let now = start;
    let advanceClock = false;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [
        direct("allow", { requiredPermissions: ["check"] }),
        direct("restricted", { requiredPermissions: ["check"] }),
      ] }),
      now: () => now,
      permissionEvaluators: {
        check: () => gate.then(() => {
          if (advanceClock) {
            now = start + 1_001;
          }
          return "allow" as const;
        }),
      },
    });
    host.installResource({
      resource: scope, owner: { domainId: "domain", subject: "owner" }, route,
      mandatory: [{ ref: ref("restricted"), applicable: true }], externalAuthority: "none",
    });
    install(host, "grant", "allow");
    install(host, "restriction", "restricted", new Date(start + 1_000).toISOString());
    const pending = host.evaluate({
      actor, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route,
    });
    release?.();
    expect((await pending).decision.effect).toBe("allow");
    advanceClock = true;
    expect((await host.evaluate({
      actor, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route,
    })).decision.effect).toBe("deny");
  });

  it("allows before a positive binding deadline and denies after it expires in a callback", async () => {
    let now = start;
    const host = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [direct("allow", { requiredPermissions: ["check"] })] }),
      now: () => now,
      permissionEvaluators: { check: () => "allow" },
    });
    host.installResource({
      resource: scope, owner: { domainId: "domain", subject: "owner" }, route,
      mandatory: [], externalAuthority: "none",
    });
    install(host, "grant", "allow", new Date(start + 1_000).toISOString());
    expect((await host.evaluate({
      actor, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route,
    })).decision.effect).toBe("allow");
    const deferred = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [direct("allow", { requiredPermissions: ["check"] })] }),
      now: () => now,
      permissionEvaluators: {
        check: () => {
          now = start + 1_001;
          return "allow" as const;
        },
      },
    });
    deferred.installResource({
      resource: scope, owner: { domainId: "domain", subject: "owner" }, route,
      mandatory: [], externalAuthority: "none",
    });
    install(deferred, "grant", "allow", new Date(start + 1_000).toISOString());
    expect((await deferred.evaluate({
      actor, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route,
    })).decision.effect).toBe("deny");
  });
});
