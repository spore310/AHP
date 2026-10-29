import { describe, expect, it } from "vitest";

import {
  POLICY_LIMIT_DEFAULTS,
  createReferenceAuthorizer,
  type PolicyActorRef,
  type ResourceRef,
  type ScopedPolicyBinding,
  type TrustedRequestContext,
} from "@authorization";
import { createToolPolicyFactory, type ToolOperation } from "@toolPolicy";

const NOW = 1_700_000_000_000;

const subject = (value: string, domainId = "local") => ({ domainId, subject: value });

const user = (value: string, domainId = "local"): PolicyActorRef => ({
  kind: "user",
  principal: subject(value, domainId),
});

const resource = (
  instanceId: string,
  domainId = "local",
  kind = "session",
  id = `ahp-session:/${instanceId}`,
): ResourceRef => ({ domainId, kind, id, instanceId });

const actorContext = (value: string, domainId = "local"): TrustedRequestContext => ({
  actor: user(value, domainId),
  connectionId: `connection-${value}`,
  authRevision: "auth-1",
});

const policy = (
  id: string,
  operation: ToolOperation,
  actor: { readonly mode: "direct-grant"; readonly actors: readonly ("user" | "agent")[] }
    | { readonly mode: "roles"; readonly actors: { readonly user?: { readonly anyOf: readonly string[] }; readonly agent?: { readonly anyOf: readonly string[] } } },
  extra: { readonly reveal?: boolean; readonly requiredPermissions?: readonly string[]; readonly challenge?: boolean } = {},
) => ({
  id,
  revision: 1,
  operations: {
    [operation]: {
      actor,
      ...(extra.reveal === undefined ? {} : { reveal: extra.reveal }),
      ...(extra.requiredPermissions === undefined ? {} : { requiredPermissions: extra.requiredPermissions }),
    },
  },
  challenge: { required: extra.challenge === true },
});

const binding = (
  id: string,
  actor: string,
  scope: ResourceRef,
  policies: readonly { readonly id: string; readonly revision: number }[],
  roles: readonly string[] = [],
  expiresAt?: string,
): ScopedPolicyBinding => ({
  id,
  actor: user(actor, scope.domainId),
  scope,
  roles,
  policies,
  authority: { kind: "host-policy", policy: policies[0] ?? { id: "none", revision: 1 } },
  revision: 1,
  ...(expiresAt === undefined ? {} : { expiresAt }),
});

const routeFor = (scope: ResourceRef) => ({ origin: scope, targets: [scope] });

const authorizerFor = (
  policies: readonly ReturnType<typeof policy>[],
  now: () => number = () => NOW,
  permissionEvaluators?: Parameters<typeof createReferenceAuthorizer>[0]["permissionEvaluators"],
) => createReferenceAuthorizer({
  policies: createToolPolicyFactory({ policies }),
  now,
  permissionEvaluators,
});

describe("reference authorization", () => {
  it("A01 no authority is the default", async () => {
    const scope = resource("empty");
    const host = authorizerFor([policy("direct.read", "invoke", { mode: "direct-grant", actors: ["user"] }, { reveal: true })]);
    host.installResource({
      resource: scope,
      owner: subject("senior"),
      route: routeFor(scope),
      mandatory: [],
      externalAuthority: "none",
    });
    const missing = await host.evaluate({
      actor: actorContext("ada"),
      operation: "invoke",
      policyRef: { id: "direct.read", revision: 1 },
      bindingId: "missing",
      scope,
      route: routeFor(scope),
      mandatory: [],
    });
    expect(missing.decision).toEqual({ effect: "deny", code: "missing-authority" });
    expect((await host.projectAssignments({
      actor: actorContext("ada"),
      purpose: "invoke",
      recipient: "caller",
      scope,
      route: routeFor(scope),
      tools: [],
      harnessName: "shared-harness",
    })).admitted).toEqual([]);

    const direct = authorizerFor([policy("direct.read", "invoke", { mode: "direct-grant", actors: ["user"] })]);
    direct.installResource({
      resource: scope,
      owner: subject("senior"),
      route: routeFor(scope),
      mandatory: [],
      externalAuthority: "none",
    });
    direct.installBinding(binding("grant-ada", "ada", scope, [{ id: "direct.read", revision: 1 }], []));
    const allowed = await direct.evaluate({
      actor: actorContext("ada"),
      operation: "invoke",
      policyRef: { id: "direct.read", revision: 1 },
      bindingId: "grant-ada",
      scope,
      route: routeFor(scope),
      mandatory: [],
    });
    expect(allowed.decision).toMatchObject({ effect: "allow", reveal: false, challengeRequired: false });
    expect(direct.owner(scope)).toEqual(subject("senior"));
  });

  it("A02 valid scope-specific grant plus all constraints", async () => {
    const scope = resource("chat-1", "local", "chat", "ahp-chat:/chat-1");
    const other = resource("chat-2", "local", "chat", "ahp-chat:/chat-2");
    const host = authorizerFor([
      policy("app.review", "invoke", { mode: "roles", actors: { user: { anyOf: ["reviewer"] } } }),
      policy("provider.deny", "invoke", { mode: "roles", actors: { user: { anyOf: ["operator"] } } }),
      policy("needs.eval", "invoke", { mode: "direct-grant", actors: ["user"] }, { requiredPermissions: ["workspace.read"] }),
    ]);
    host.installResource({
      resource: scope,
      owner: subject("senior"),
      route: routeFor(scope),
      mandatory: [{ ref: { id: "provider.deny", revision: 1 }, applicable: true }],
      externalAuthority: "none",
    });
    host.installResource({
      resource: other,
      owner: subject("senior"),
      route: routeFor(other),
      mandatory: [],
      externalAuthority: "none",
    });
    host.installBinding(binding("app", "ada", scope, [{ id: "app.review", revision: 1 }], ["reviewer"]));
    host.installBinding(binding("provider", "ada", scope, [{ id: "provider.deny", revision: 1 }], ["observer"]));
    const denied = await host.evaluate({
      actor: actorContext("ada"),
      operation: "invoke",
      policyRef: { id: "app.review", revision: 1 },
      bindingId: "app",
      scope,
      route: routeFor(scope),
      mandatory: [{ id: "provider.deny", revision: 1 }],
    });
    expect(denied.decision).toEqual({ effect: "deny", code: "mandatory-deny" });

    const missingEvaluator = authorizerFor([
      policy("needs.eval", "invoke", { mode: "direct-grant", actors: ["user"] }, { requiredPermissions: ["workspace.read"] }),
    ]);
    missingEvaluator.installResource({
      resource: scope,
      owner: subject("senior"),
      route: routeFor(scope),
      mandatory: [],
      externalAuthority: "none",
    });
    missingEvaluator.installBinding(binding("eval", "ada", scope, [{ id: "needs.eval", revision: 1 }]));
    expect((await missingEvaluator.evaluate({
      actor: actorContext("ada"),
      operation: "invoke",
      policyRef: { id: "needs.eval", revision: 1 },
      bindingId: "eval",
      scope,
      route: routeFor(scope),
      mandatory: [],
    })).decision).toEqual({ effect: "deny", code: "missing-evaluator" });

    const expired = authorizerFor([policy("direct.read", "invoke", { mode: "direct-grant", actors: ["user"] })]);
    expired.installResource({
      resource: scope,
      owner: subject("senior"),
      route: routeFor(scope),
      mandatory: [],
      externalAuthority: "none",
    });
    expired.installBinding(binding(
      "old",
      "ada",
      scope,
      [{ id: "direct.read", revision: 1 }],
      [],
      new Date(NOW - 1_000).toISOString(),
    ));
    expect((await expired.evaluate({
      actor: actorContext("ada"),
      operation: "invoke",
      policyRef: { id: "direct.read", revision: 1 },
      bindingId: "old",
      scope,
      route: routeFor(scope),
      mandatory: [],
    })).decision).toEqual({ effect: "deny", code: "expired" });

    const scoped = authorizerFor([policy("direct.read", "invoke", { mode: "direct-grant", actors: ["user"] })]);
    scoped.installResource({
      resource: scope,
      owner: subject("senior"),
      route: routeFor(scope),
      mandatory: [],
      externalAuthority: "none",
    });
    scoped.installResource({
      resource: other,
      owner: subject("senior"),
      route: routeFor(other),
      mandatory: [],
      externalAuthority: "none",
    });
    scoped.installBinding(binding("one", "ada", scope, [{ id: "direct.read", revision: 1 }]));
    expect((await scoped.evaluate({
      actor: actorContext("ada"),
      operation: "invoke",
      policyRef: { id: "direct.read", revision: 1 },
      bindingId: "one",
      scope: other,
      route: routeFor(other),
      mandatory: [],
    })).decision.effect).toBe("deny");
  });

  it("A03 no grant-fragment synthesis", async () => {
    const left = resource("left");
    const right = resource("right");
    const host = authorizerFor([
      policy("left.read", "invoke", { mode: "direct-grant", actors: ["user"] }),
      policy("right.exec", "execute", { mode: "direct-grant", actors: ["user"] }),
    ]);
    for (const scope of [left, right]) {
      host.installResource({
        resource: scope,
        owner: subject("senior"),
        route: routeFor(scope),
        mandatory: [],
        externalAuthority: "none",
      });
    }
    host.installBinding(binding("left-grant", "ada", left, [{ id: "left.read", revision: 1 }]));
    host.installBinding(binding("right-grant", "ada", right, [{ id: "right.exec", revision: 1 }]));
    expect((await host.evaluate({
      actor: actorContext("ada"),
      operation: "execute",
      policyRef: { id: "right.exec", revision: 1 },
      bindingId: "left-grant",
      scope: left,
      route: routeFor(left),
      mandatory: [],
    })).decision).toEqual({ effect: "deny", code: "missing-authority" });
  });

  it("A06 reusable harness does not share authority", async () => {
    const scope = resource("shared");
    const host = authorizerFor([
      policy("ada.tool", "invoke", { mode: "direct-grant", actors: ["user"] }, { reveal: true }),
      policy("bob.tool", "invoke", { mode: "direct-grant", actors: ["user"] }, { reveal: true }),
    ]);
    host.installResource({
      resource: scope,
      owner: subject("senior"),
      route: routeFor(scope),
      mandatory: [],
      externalAuthority: "none",
    });
    host.installTool({
      id: "11111111-1111-4111-8111-111111111111",
      key: "workspace.read-file",
      version: 1,
      name: "read_file",
      schemaDialect: "draft-07",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
    });
    host.installBinding(binding("ada-grant", "ada", scope, [{ id: "ada.tool", revision: 1 }]));
    host.installBinding(binding("bob-grant", "bob", scope, [{ id: "bob.tool", revision: 1 }]));
    for (const recipient of ["ada", "bob"]) {
      host.installToolAssignment({
        resource: scope,
        route: routeFor(scope),
        recipient: actorContext(recipient).actor,
        contract: { id: "11111111-1111-4111-8111-111111111111", key: "workspace.read-file", version: 1 },
        operation: "invoke",
        bindingId: `${recipient}-grant`,
        policyRef: { id: `${recipient}.tool`, revision: 1 },
      });
    }
    const ada = await host.projectAssignments({
      actor: actorContext("ada"),
      purpose: "invoke",
      recipient: "caller",
      scope,
      route: routeFor(scope),
      mandatory: [],
      harnessName: "same-model",
      tools: [{
        contractId: "11111111-1111-4111-8111-111111111111",
        policyRef: { id: "ada.tool", revision: 1 },
        bindingId: "ada-grant",
      }],
    });
    const bob = await host.projectAssignments({
      actor: actorContext("bob"),
      purpose: "invoke",
      recipient: "caller",
      scope,
      route: routeFor(scope),
      mandatory: [],
      harnessName: "same-model",
      tools: [{
        contractId: "11111111-1111-4111-8111-111111111111",
        policyRef: { id: "bob.tool", revision: 1 },
        bindingId: "bob-grant",
      }],
    });
    expect(ada.decisions[0]?.decision.effect).toBe("allow");
    expect(bob.decisions[0]?.decision.effect).toBe("allow");
    expect(ada.stamps[0]?.authority.actor).not.toEqual(bob.stamps[0]?.authority.actor);
    const adaStamp = ada.stamps[0];
    if (adaStamp === undefined) {
      throw new Error("Missing decision stamp.");
    }
    expect(host.matches(adaStamp, actorContext("bob"))).toBe(false);
  });

  it("denies a replaced binding after an evaluator await", async () => {
    const scope = resource("late");
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = authorizerFor(
      [policy("needs.eval", "invoke", { mode: "direct-grant", actors: ["user"] }, { requiredPermissions: ["workspace.read"] })],
      () => NOW,
      {
        "workspace.read": () => gate.then(() => "allow" as const),
      },
    );
    host.installResource({
      resource: scope,
      owner: subject("senior"),
      route: routeFor(scope),
      mandatory: [],
      externalAuthority: "none",
    });
    host.installBinding(binding("live", "ada", scope, [{ id: "needs.eval", revision: 1 }]));
    const pending = host.evaluate({
      actor: actorContext("ada"),
      operation: "invoke",
      policyRef: { id: "needs.eval", revision: 1 },
      bindingId: "live",
      scope,
      route: routeFor(scope),
      mandatory: [],
    });
    host.teardown(scope);
    release?.();
    expect((await pending).decision).toEqual({ effect: "deny", code: "stale" });
  });

  it("denies the same instance in another domain and an expired external proof", async () => {
    const scope = resource("same", "local");
    const foreign = resource("same", "other");
    const host = authorizerFor([policy("direct.read", "invoke", { mode: "direct-grant", actors: ["user"] })]);
    host.installResource({
      resource: scope,
      owner: subject("senior"),
      route: routeFor(scope),
      mandatory: [],
      externalAuthority: "required",
    });
    host.installBinding(binding("grant", "ada", scope, [{ id: "direct.read", revision: 1 }]));
    expect((await host.evaluate({
      actor: actorContext("ada"),
      operation: "invoke",
      policyRef: { id: "direct.read", revision: 1 },
      bindingId: "grant",
      scope: foreign,
      route: routeFor(foreign),
      mandatory: [],
      external: { revision: "ext-1", validUntil: NOW + 1_000 },
    })).decision.effect).toBe("deny");
    expect((await host.evaluate({
      actor: actorContext("ada"),
      operation: "invoke",
      policyRef: { id: "direct.read", revision: 1 },
      bindingId: "grant",
      scope,
      route: routeFor(scope),
      mandatory: [],
      external: { revision: "ext-1", validUntil: NOW - 1 },
    })).decision).toEqual({ effect: "deny", code: "external-expired" });
    const fresh = await host.evaluate({
      actor: actorContext("ada"),
      operation: "invoke",
      policyRef: { id: "direct.read", revision: 1 },
      bindingId: "grant",
      scope,
      route: routeFor(scope),
      mandatory: [],
      external: { revision: "ext-1", validUntil: NOW + POLICY_LIMIT_DEFAULTS.challengeLifetimeSeconds * 1000 },
    });
    expect(fresh.decision.effect).toBe("allow");
    host.invalidateExternal("ext-1");
    expect(host.matches(fresh.stamp, actorContext("ada"))).toBe(false);
  });
});
