import assert from "node:assert/strict";
import { z } from "zod";
import { createLegacyConnectionIdentityAdapter, type ConnectionAuthenticator } from "@agents";
import { createExamplePolicyAdmission, createInMemoryEchoRegistration } from "@application";
import { createReferenceAuthorizer, createResourceOperations, type ExecutorRevision, type PolicyActorRef,
  type ResourceRef, type SecurityComposition, type TrustedRequestContext } from "@authorization";
import { createPersistence } from "@persistence";
import { createSessionConfig, createSessionTypeCatalogue, defineApplicationSession, ToolAccessLevel } from "@sessions";
import { mockProvider } from "@sessions/mock";
import { createApprovedArtifactSource, createToolResultProjection, type ChallengeAdapter } from "@toolExecution";
import { createToolAdmission, createToolPolicyFactory, type ToolExecutionBinding, type ToolExecutionPolicyBase, type ToolOperation } from "@toolPolicy";
import { createToolCatalogue, defineToolContract, type ToolContractDefinition } from "@tools";
import { createAHPServer, type ConnectionFence } from "@websocket";
import { createExamplePersistence } from "./persistence";

export const channel = "ahp-session:/review";
const domainId = "demo";
const sessionType = { key: "example.review", version: 1 };
const policy = { id: "example.review-access", revision: 1 };
const providerPolicy = { id: "example.review-provider", revision: 1 };
const challengePolicy = { id: "example.review-challenge", revision: 1 };
const activationPolicy = { id: "example.review-activation", revision: 1 };
const projectionPolicy = { id: "example.review-projection", revision: 1 };
const operations = ["discover", "invoke", "advertise", "execute", "propose", "approve", "publish"] as const;
const roles = {
  "senior": ["discover", "invoke", "advertise", "execute", "propose", "publish", "activate", "project"],
  "junior": ["discover", "invoke", "advertise", "execute"],
  "pm": ["discover", "approve"],
  "observer": ["discover"],
  "host-action": ["execute"],
};
export type Subject = Exclude<keyof typeof roles, "host-action">;

export function actorFor(subject: keyof typeof roles): PolicyActorRef {
  const principal = { domainId, subject };
  return subject === "junior" ? { kind: "agent", principal, agentId: "review-agent" } : { kind: "user", principal };
}

function rule(role: string, reveal = false) {
  return { actor: { mode: "roles" as const, actors: { user: { anyOf: [role] }, agent: { anyOf: [role] } } }, ...(reveal ? { reveal } : {}) };
}

const definitions = [
  { ...policy, challenge: { required: false }, operations: Object.fromEntries(operations.map((name) => [name, rule(name, name === "discover")])) },
  { ...challengePolicy, challenge: { required: true }, operations: { invoke: rule("invoke") } },
  { ...activationPolicy, challenge: { required: false }, operations: { publish: rule("activate") } },
  { ...projectionPolicy, challenge: { required: false }, operations: { invoke: rule("project") } },
] satisfies readonly ToolExecutionPolicyBase[];

const provider = { ...providerPolicy, challenge: { required: false }, operations: Object.fromEntries(operations.map((name) => [name,
  { actor: { mode: "direct-grant", actors: ["user", "agent"] },
    ...(name === "discover" ? { reveal: true } : {}), ...(name === "invoke" ? { requiredPermissions: ["review-provider-consent"] } : {}) }])),
} satisfies ToolExecutionPolicyBase;

export const clientTool = defineToolContract({ id: "10000000-0000-4000-8000-000000000001", key: "review.inspect", version: 1,
  name: "inspect", schemaDialect: "draft-07", inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false } });
const clientImplementation = { location: "client", suppliedBy: "client", implementation: "client-owned", implementationId: "review.inspect.local" } as const;

export function selector(definition: ToolContractDefinition) {
  const { id, key, version } = definition;
  return { id, key, version };
}

const proof = "demo-approval";
const challenge: ChallengeAdapter = {
  begin: ({ callId }) => ({ continuationId: callId, expiresAt: new Date(Date.now() + 30_000).toISOString(), presentation: { kind: "wait" } }),
  verify: ({ continuationId, proofRef }) => proofRef === proof
    ? { status: "verified", continuationId }
    : { status: "denied", code: "demo-approval-required" },
};
export const demoProof = proof;

/** Compose one real public host. All credentials, data, and adapters here are local examples. */
export function createReviewHost(mode: "direct" | "namespace", lifecycle?: {
  readonly durability: NonNullable<import("@sessions").SessionsFactoryOptions["durability"]>;
  readonly provider: import("@sessions").SessionProvider;
  readonly restoration?: import("@sessions").SessionTypePolicyRegistration["restoration"];
  readonly persistence?: import("@persistence").PersistenceProvider;
  readonly nativeWrites?: import("@websocket").NativeSessionWrites;
}) {
  const { admitted, namespaces } = createExamplePolicyAdmission(mode, definitions);
  const rules = { admitted, mandatory: [providerPolicy] };
  const policies = createToolPolicyFactory({ policies: [...definitions, provider], namespaces,
    bindings: [{ sessionType, providerId: mockProvider.providerId, ...rules }] });
  let providerAllowsInvoke = true;
  const registry = createReferenceAuthorizer({ policies, now: Date.now,
    permissionEvaluators: { "review-provider-consent": () => providerAllowsInvoke ? "allow" : "deny" } });
  const admission = createToolAdmission({ registry, policies, activationPolicies: [activationPolicy] });
  const persistence = createPersistence(lifecycle?.persistence ?? createExamplePersistence().provider);
  const bytes = new TextEncoder().encode("example review artifact");
  const artifacts = createApprovedArtifactSource({ approve: ({ descriptor }) => descriptor.publisherId === "demo-publisher", read: () => bytes });
  const serverTool = createInMemoryEchoRegistration();
  const allTools = [clientTool, serverTool.definition];
  for (const tool of allTools) registry.installTool(tool);
  const schema = { type: "object", properties: {} } as const;
  const type = defineApplicationSession({ ...sessionType, id: "20000000-0000-4000-8000-000000000001", providerId: mockProvider.providerId,
    work: [{ kind: "code.review", maxAttempts: 3 }],
    configSchema: schema, config: createSessionConfig({ schema, parser: z.object({}).strict() }),
    tools: allTools.map((ref) => ({ ref, access: ToolAccessLevel.Standard })), policy: { rules,
      ...(lifecycle?.restoration ? { restoration: lifecycle.restoration } : {}),
      creation: { capability: { key: "example.create-review", revision: 1 }, prepare: ({ request }) => Promise.resolve(
        request.caller.actor.principal.subject === "senior"
          ? { effect: "allow", request, bootstrap: { kind: "none" }, validUntil: Date.now() + 30_000, isCurrent: () => true, release: () => undefined }
          : { effect: "deny", release: () => undefined },
      ) } } });

  const authenticator: ConnectionAuthenticator = { authenticate: ({ headers }) => {
    const token = headers["sec-websocket-protocol"];
    const subject = typeof token === "string" && token.startsWith("demo-") ? token.slice(5) : "";
    return Promise.resolve(subject !== "host-action" && Object.hasOwn(roles, subject) ? { subject } : undefined);
  } };
  const composition: SecurityComposition = {
    identity: createLegacyConnectionIdentityAdapter({ authenticator, domainId }),
    actors: { resolve: ({ principal, connectionId, authRevision }) => Promise.resolve({ actor: actorFor(principal.subject as Subject),
      connectionId, authRevision, ...(principal.subject === "junior" ? { agentGeneration: 1, delegationRef: "demo-junior-delegation" } : {}) }) },
    bindings: { read: () => Promise.resolve([]) },
    resources: { resolve: () => Promise.reject(new Error("No initial scope needed.")) },
    freshness: { current: () => Promise.resolve({ domainId, revision: 1, invalidated: false }), invalidate: () => Promise.resolve() },
    policies: { evaluate: () => Promise.resolve({ effect: "deny", code: "use-canonical-registry" }) },
    grants: { prepare: () => Promise.reject(new Error("Use example host grants.")), commit: () => {
      throw new Error("Use example host grants.");
    }, rollback: () => undefined, revoke: () => Promise.resolve() },
  };

  const executorContext: TrustedRequestContext = { actor: actorFor("host-action"), connectionId: "example-local-executor", authRevision: "demo" };
  const connections = new Map<string, { readonly context: TrustedRequestContext; readonly fence: ConnectionFence }>();
  let origin: ResourceRef<"session">;
  const routeFor = (resource: ResourceRef) => ({ route: { origin: resource, targets: [resource] } });
  const liveResource = (ref: ResourceRef): boolean => host.sessions.authorization?.getResource(ref.id)?.instanceId === ref.instanceId;
  let projectionSeq = 0;
  const resources = createResourceOperations({ registry, policies,
    kinds: [{ kind: "session", resolve: ({ id }) => host.sessions.authorization?.getResource(id), current: liveResource, fence: liveResource }],
    types: [{ kind: "session", type: sessionType, providerId: mockProvider.providerId, operations: [{ name: "title", purpose: "invoke", policies: [projectionPolicy],
      validate: (payload) => typeof payload === "object" && payload !== null && "value" in payload && typeof payload.value === "string",
      async commitDurable(payload, request, admissionCheck) {
        if (typeof payload !== "object" || payload === null || !("value" in payload) || typeof payload.value !== "string") return false;
        projectionSeq += 1;
        const envelope = await host.sessions.dispatchAction({ channel: request.target.id, clientId: "demo-projector", clientSeq: projectionSeq,
          action: { type: "session/titleChanged", title: payload.value }, admission: admissionCheck });
        return envelope.rejectionReason === undefined;
      } }] }],
  });
  const projection = createToolResultProjection({ resources, project: (output, context) => context.contract.id === serverTool.definition.id
    ? { target: context.resources.origin, operation: "title", payload: output }
    : undefined });
  const dispatcher = { challenge: { adapter: challenge }, projection };

  const catalogue = createSessionTypeCatalogue({ tools: createToolCatalogue({ definitions: allTools }), types: [type.registration] });
  const host = createAHPServer({ host: "127.0.0.1", port: 0,
    ...(lifecycle?.nativeWrites ? { nativeWrites: lifecycle.nativeWrites } : {}),
    sessions: { ...(lifecycle ? { durability: lifecycle.durability } : {}), providers: [lifecycle?.provider ?? mockProvider], creationSecurity: { registry, policies }, toolAdmission: admission,
      application: { catalogue, defaultType: sessionType } },
    protectedViews: { registry, policies, admitted: [policy], resolve: ({ resource }) => routeFor(resource) },
    toolExecution: { registry, policies, dispatcher, artifacts, resolve: ({ origin: resource }) => routeFor(resource),
      registrations: [{ definition: clientTool, source: { id: "demo-client", revision: 1 }, revision: 1, implementation: clientImplementation }] },
    serverToolExecution: { registry, policies, dispatcher, resolve: ({ origin: resource }) => routeFor(resource), registrations: [serverTool],
      executor: { context: executorContext, generation: 1, current: () => true, fence: () => true } },
    agentWork: { authenticator, registrations: persistence.registrations, work: persistence.work, allowedKinds: new Set(["code.review"]), dispose: () => persistence.dispose() },
    security: { composition, workDomainId: domainId, initialAuthority: { prepare: ({ context, fence }) => {
      connections.set(context.connectionId, { context, fence });
      return Promise.resolve({ scopes: [], allowGlobalSequence: true, validUntil: Date.now() + 60_000,
        isCurrent: () => connections.has(context.connectionId), release: () => { connections.delete(context.connectionId); } });
    } } },
  });

  const assignment = (subject: keyof typeof roles, definition: ToolContractDefinition) => ({ resource: origin, route: routeFor(origin).route,
    recipient: actorFor(subject), contract: selector(definition), bindingId: "demo-" + subject });
  const allowTool = (subject: keyof typeof roles, definition: ToolContractDefinition, purposes: readonly ToolOperation[], needsChallenge = false): void => {
    for (const purpose of purposes) registry.installToolAssignment({ ...assignment(subject, definition), operation: purpose,
      policyRef: purpose === "invoke" && needsChallenge ? challengePolicy : policy });
  };
  const allowExecutor = (subject: keyof typeof roles, definition: ToolContractDefinition, executor: ExecutorRevision, implementation: ToolExecutionBinding): void => {
    registry.installExecutorAssignment({ ...assignment(subject, definition), operation: "execute", policyRef: policy, executor, implementation });
  };
  const connection = (subject: Subject) => {
    const found = [...connections.values()].find(({ context }) => context.actor.principal.subject === subject);
    assert.ok(found, "Expected a live example connection");
    return found;
  };
  const allowJuniorExecutor = (definition: ToolContractDefinition, implementation: ToolExecutionBinding = clientImplementation, registrationRevision = 1): void => {
    const { context, fence } = connection("junior");
    allowExecutor("junior", definition, { actor: context.actor, connectionId: fence.connectionId, generation: fence.connectionGeneration, registrationRevision }, implementation);
  };
  const provision = async (workingDirectories?: readonly string[]): Promise<void> => {
    const authorization = host.sessions.authorization;
    assert.ok(authorization);
    const context: TrustedRequestContext = { actor: actorFor("senior"), connectionId: "demo-session-setup", authRevision: "demo" };
    await authorization.createSession({ channel, ...(workingDirectories ? { workingDirectories } : {}) }, { context, connectionId: context.connectionId, connectionGeneration: 1,
      validUntil: Date.now() + 30_000, signal: new AbortController().signal, isCurrent: () => true });
    const resource = authorization.getResource(channel);
    assert.ok(resource);
    origin = resource;
    for (const [subject, scopedRoles] of Object.entries(roles) as [keyof typeof roles, string[]][]) registry.installBinding({
      id: "demo-" + subject, actor: actorFor(subject), scope: origin, roles: scopedRoles,
      policies: [policy, providerPolicy, challengePolicy, projectionPolicy, activationPolicy], revision: 1,
      authority: subject === "junior"
        ? { kind: "delegation", issuer: actorFor("senior"), parentGrantId: "demo-senior" }
        : { kind: "host-policy", policy },
    });
    allowTool("senior", clientTool, ["discover", "invoke"], true);
    allowTool("junior", clientTool, ["discover", "invoke", "advertise"], true);
    allowTool("pm", clientTool, ["discover"]);
    allowTool("senior", serverTool.definition, ["discover", "invoke"]);
    allowExecutor("host-action", serverTool.definition, { actor: executorContext.actor, connectionId: executorContext.connectionId, generation: 1,
      registrationRevision: serverTool.revision }, serverTool.implementation);
  };

  return { host, catalogue, artifacts, bytes, serverTool, connection, provision, registry, allowTool, allowJuniorExecutor,
    origin: () => origin, consent: (allow: boolean): void => { providerAllowsInvoke = allow; },
    stop: async (): Promise<void> => {
      resources.dispose();
      await host.stop();
    },
  };
}
