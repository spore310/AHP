import { describe, expect, it } from "vitest";

import { parseUnknownJson } from "@jsonrpc";

import {
  POLICY_LIMIT_ABSOLUTE,
  POLICY_LIMIT_DEFAULTS,
  policyLimitsSchema,
  scopedPolicyBindingSchema,
  securitySubjectRefSchema,
  trustedRequestContextSchema,
  type PolicyActorRef,
  type PolicyScopeRules,
  type ResourceRef,
  type SecuritySubjectRef,
} from "@authorization";
import {
  policyDecisionSchema,
  toolActorPolicySchema,
  toolActorRuleSchema,
  toolExecutionBindingSchema,
  toolExecutionPolicyManifestSchema,
  toolPolicyNamespaceManifestSchema,
  type ToolActorPolicy,
  type ToolExecutionBinding,
  type ToolExecutionPolicy,
  type ToolExecutionPolicyBase,
} from "@toolPolicy";
import {
  ToolAction,
  challengePresentationSchema,
  type ToolActionContext,
  type ValidationResult,
} from "@toolExecution";

type ReviewRole = "reviewer" | "editor";
type TerminalRole = "operator" | "observer";

interface ChatExtension {
  readonly lane: "chat";
}

interface TerminalExtension {
  readonly lane: "pty";
}

const reviewPolicy = {
  id: "chat.review",
  revision: 1,
  operations: {
    discover: {
      actor: { mode: "roles", actors: { user: { anyOf: ["reviewer"] } } },
      reveal: true,
    },
    invoke: {
      actor: { mode: "roles", actors: { user: { anyOf: ["reviewer"] }, agent: { anyOf: [] } } },
    },
  },
  challenge: { required: false },
  extension: { lane: "chat" },
} satisfies ToolExecutionPolicy<ReviewRole, ChatExtension>;

const terminalPolicy = {
  id: "terminal.input",
  revision: 2,
  operations: {
    execute: {
      actor: { mode: "direct-grant", actors: ["user"] },
    },
  },
  challenge: { required: true },
  extension: { lane: "pty" },
} satisfies ToolExecutionPolicy<TerminalRole, TerminalExtension>;

const policies: readonly ToolExecutionPolicy[] = [reviewPolicy, terminalPolicy];
const bases: readonly ToolExecutionPolicyBase[] = policies;

const subject = (value: string): SecuritySubjectRef => ({
  domainId: "local",
  subject: value,
});

const user = (value: string): PolicyActorRef => ({
  kind: "user",
  principal: subject(value),
});

const resource = (kind: string, id: string, instanceId: string): ResourceRef => ({
  domainId: "local",
  kind,
  id,
  instanceId,
});

/** Contract fixture: missing or empty role branches admit nobody. */
const roleBranchAdmits = (
  branch: { readonly anyOf: readonly string[] } | undefined,
  held: readonly string[],
): boolean => branch !== undefined && branch.anyOf.some((role) => held.includes(role));

const actorPolicyAdmits = (
  policy: ToolActorPolicy,
  kind: "user" | "agent",
  held: readonly string[],
): boolean => roleBranchAdmits(kind === "user" ? policy.user : policy.agent, held);

describe("authorization contracts", () => {
  it("K01 no built-in role or implicit grant", () => {
    expect(bases.map((policy) => policy.id)).toEqual(["chat.review", "terminal.input"]);
    expect(policies[0]).toBe(reviewPolicy);
    expect(policies[1]).toBe(terminalPolicy);

    const missing = toolActorPolicySchema.parse({});
    const emptied = toolActorPolicySchema.parse({ user: {}, agent: { anyOf: [] } });
    expect(actorPolicyAdmits(missing, "user", ["admin", "anonymous"])).toBe(false);
    expect(actorPolicyAdmits(missing, "agent", ["admin"])).toBe(false);
    expect(actorPolicyAdmits(emptied, "user", ["reviewer"])).toBe(false);
    expect(actorPolicyAdmits(emptied, "agent", ["operator"])).toBe(false);
    expect(emptied.user?.anyOf).toEqual([]);
    expect(emptied.agent?.anyOf).toEqual([]);

    expect(toolActorRuleSchema.safeParse({ actors: ["user"] }).success).toBe(false);
    expect(toolActorRuleSchema.safeParse({
      mode: "direct-grant",
      actors: [],
    }).success).toBe(true);
    expect(toolActorRuleSchema.safeParse({
      mode: "roles",
      actors: { anyOf: ["admin"] },
    }).success).toBe(false);

    const binding = scopedPolicyBindingSchema.parse({
      id: "grant-1",
      actor: user("ada"),
      scope: resource("session", "ahp-session:/ada", "instance-1"),
      authority: { kind: "host-policy", policy: { id: "chat.review", revision: 1 } },
      revision: 1,
    });
    expect(binding.roles).toEqual([]);
    expect(binding.policies).toEqual([]);
    expect(actorPolicyAdmits({ user: { anyOf: binding.roles } }, "user", ["reviewer"])).toBe(false);
    const rules: PolicyScopeRules = {
      admitted: { policies: [], namespaces: [] },
      mandatory: [],
    };
    expect(rules.admitted.policies).toEqual([]);
    expect(rules.mandatory).toEqual([]);
  });

  it("K02 one typed portable contract boundary", () => {
    const caller = trustedRequestContextSchema.parse({
      actor: user("ada"),
      connectionId: "connection-1",
      authRevision: "auth-1",
    });
    const executor = {
      actor: {
        kind: "agent" as const,
        principal: subject("ada"),
        agentId: "agent-1",
      },
      connectionId: "executor-connection",
      generation: 3,
      registrationRevision: 7,
    };
    const origin = resource("chat", "ahp-chat:/triage", "chat-instance");
    const target = resource("terminal", "ahp-terminal:/prod", "terminal-instance");
    const binding: ToolExecutionBinding = {
      location: "client",
      suppliedBy: "client",
      implementation: "client-owned",
      implementationId: "impl-1",
    };
    const context: ToolActionContext = {
      caller,
      executor,
      resources: { origin, targets: [target] },
      contract: { id: "workspace.read-file", revision: 1 },
      implementation: binding,
      callId: "call-1",
      signal: new AbortController().signal,
      authority: {
        domainId: "local",
        actor: user("ada"),
        authRevision: "auth-1",
        connectionId: "connection-1",
        agentGeneration: 3,
        executor,
        route: { origin, targets: [target] },
        relationshipRevision: 4,
        policyRevisions: [{ id: "terminal.input", revision: 2 }],
        grantRevision: 5,
      },
    };

    class ReadAction extends ToolAction<{ readonly path: string }, { readonly ok: true }, { readonly handle: number }> {
      override execute(
        input: { readonly path: string },
        actionContext: ToolActionContext,
        prepared: { readonly handle: number } | undefined,
      ): { readonly ok: true } {
        expect(prepared).toBeUndefined();
        expect(actionContext.caller.connectionId).not.toBe(actionContext.executor.connectionId);
        expect(input.path).toBe("README.md");
        return { ok: true };
      }
    }

    const action = new ReadAction();
    const normalized: ValidationResult<{ readonly path: string }> = {
      kind: "normalized",
      input: { path: "README.md" },
    };
    expect(normalized.kind).toBe("normalized");
    expect(action.execute(normalized.input, context, undefined)).toEqual({ ok: true });
    expect(context.caller.actor).not.toBe(context.executor);
    expect(context.resources.origin.instanceId).not.toBe(context.resources.targets[0]?.id);
    expect(context.authority.route.targets).toHaveLength(1);
    expect(context.executor.registrationRevision).toBe(7);
    expect(context.authority.agentGeneration).toBe(3);
    expect(securitySubjectRefSchema.parse(subject("ada")).subject).toBe("ada");
  });

  it("K03 malformed policy and config values fail deterministically", () => {
    expect(policyDecisionSchema.safeParse({ effect: "permit", code: "no" }).success).toBe(false);
    expect(policyDecisionSchema.safeParse({ effect: "allow", reveal: true }).success).toBe(false);
    expect(policyDecisionSchema.safeParse({ effect: "deny" }).success).toBe(false);
    expect(policyDecisionSchema.safeParse({
      effect: "allow",
      reveal: false,
      challengeRequired: true,
    }).success).toBe(true);

    for (const revision of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(toolExecutionPolicyManifestSchema.safeParse({
        id: "chat.review",
        revision,
        operations: {},
        challenge: { required: false },
      }).success).toBe(false);
    }

    const polluted = parseUnknownJson(
      "{\"id\":\"chat.review\",\"revision\":1,\"operations\":{},\"challenge\":{\"required\":false},\"__proto__\":{\"admin\":true},\"constructor\":{\"prototype\":{\"admin\":true}}}",
    );
    expect(toolExecutionPolicyManifestSchema.safeParse(polluted).success).toBe(false);

    const nested: Record<string, unknown> = { leaf: true };
    let cursor = nested;
    for (let depth = 0; depth < POLICY_LIMIT_DEFAULTS.extensionDepth + 2; depth += 1) {
      const next: Record<string, unknown> = { child: cursor };
      cursor = next;
    }
    expect(toolExecutionPolicyManifestSchema.safeParse({
      id: "chat.review",
      revision: 1,
      operations: {},
      challenge: { required: false },
      extension: cursor,
    }).success).toBe(false);

    expect(toolExecutionBindingSchema.safeParse({
      location: "server",
      suppliedBy: "server",
      implementation: "client-owned",
      implementationId: "impl-1",
    }).success).toBe(false);
    expect(toolExecutionBindingSchema.safeParse({
      location: "client",
      suppliedBy: "client",
      implementation: "approved-artifact",
      artifactRef: "artifact-1",
    }).success).toBe(false);
    expect(toolExecutionBindingSchema.safeParse({
      location: "client",
      suppliedBy: "server",
      implementation: "host",
      implementationId: "host-1",
    }).success).toBe(false);

    expect(toolPolicyNamespaceManifestSchema.safeParse({
      name: "workspace",
      revision: 1,
      policies: [{ id: "chat.review", revision: 1 }],
      resolve: () => [],
    }).success).toBe(false);

    expect(policyLimitsSchema.safeParse({
      ...POLICY_LIMIT_DEFAULTS,
      namespaceIncludeDepth: 2,
    }).success).toBe(true);
    expect(policyLimitsSchema.safeParse({
      ...POLICY_LIMIT_DEFAULTS,
      delegationDepth: 0,
    }).success).toBe(false);
    expect(policyLimitsSchema.safeParse({
      ...POLICY_LIMIT_DEFAULTS,
      aggregateResultBudgetBytes: Number.POSITIVE_INFINITY,
    }).success).toBe(false);
    expect(policyLimitsSchema.safeParse({
      ...POLICY_LIMIT_DEFAULTS,
      pendingChallengesPerHost: POLICY_LIMIT_ABSOLUTE.pendingChallengesPerHost + 1,
    }).success).toBe(false);
    expect(policyLimitsSchema.parse({}).namespaceIncludeDepth).toBe(POLICY_LIMIT_DEFAULTS.namespaceIncludeDepth);
    expect(challengePresentationSchema.safeParse({ kind: "redirect", url: "javascript:alert(1)" }).success).toBe(false);
    expect(challengePresentationSchema.safeParse({ kind: "wait", message: "continue" }).success).toBe(true);
  });
});
