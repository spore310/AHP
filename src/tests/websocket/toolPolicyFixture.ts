import { WebSocketTransport } from "@microsoft/agent-host-protocol/ws";
import { z } from "zod";
import { createReferenceAuthorizer, type SecurityComposition, type TrustedRequestContext, type ResourceRef, type ReferenceAuthorizer, type PolicyActorRef } from "@authorization";
import type { ToolAssignmentRecord } from "@authorization/helpers/evaluate";
import { createToolPolicyFactory, type ToolOperation } from "@toolPolicy";
import { createSessionConfig, createSessionTypeCatalogue, defineApplicationSession, ToolAccessLevel } from "@sessions";
import { createMockProvider } from "@sessions/mock";
import { createToolCatalogue, type ToolContractDefinition } from "@tools";
import { createAHPServer, type ConnectionFence } from "@websocket";
import type { ClientToolBrokerOptions, ClientToolRegistration, ClientToolRoute } from "@toolExecution/helpers/client/helpers/broker";
import type { CompiledToolPolicy } from "@toolPolicy/helpers/factory";

export const toolPolicyChannel = "ahp-session:/capacity";
export const connectPolicyTransport = (url: string, token = "fixture") => WebSocketTransport.connect(url, { protocols: "r5-" + token });

/** Real credential validation, canonical sessions/assignments and SDK transport. Only historical suites explicitly substitute the internal kernel. */
export async function createToolPolicyHost(definitions: readonly ToolContractDefinition[], options: {
  readonly roles?: Readonly<Record<string, readonly ToolOperation[]>>;
  readonly permission?: () => Promise<"allow" | "deny">;
  readonly challenge?: boolean;
  readonly onSecurityCheck?: (context: TrustedRequestContext) => void;
  readonly registryNow?: () => number;
  readonly securityNow?: () => number;
  readonly protectedViews?: boolean;
  readonly creatorView?: boolean;
  readonly toolDiscovery?: readonly string[];
  /** Trusted fixture classification, independent of public clientId and request data. */
  readonly actors?: Readonly<Record<string, { readonly actor: PolicyActorRef; readonly agentGeneration?: number; readonly delegationRef?: string; readonly parentSubject?: string }>>;
  readonly registrations?: readonly ClientToolRegistration[];
  readonly additionalPolicies?: readonly CompiledToolPolicy[];
  readonly permissionEvaluators?: Parameters<typeof createReferenceAuthorizer>[0]["permissionEvaluators"];
  readonly assignment?: (subject: string, registration: ClientToolRegistration, operation: ToolOperation) => boolean;
  readonly route?: (origin: ResourceRef) => ClientToolRoute;
  readonly resolve?: ClientToolBrokerOptions["resolve"];
  readonly configureResources?: (registry: ReferenceAuthorizer, scope: ResourceRef, sessionType: { readonly key: string; readonly version: number }) => void;
} = {}) {
  const roles = options.roles ?? { fixture: ["invoke", "advertise", "execute"] };
  const policy = { id: "fixture.tools", revision: 1 };
  const sessionType = { key: "test.echo-session", version: 1 };
  const rules = { admitted: { policies: [policy], namespaces: [] }, mandatory: [] };
  const policies = createToolPolicyFactory({ policies: [{ ...policy, operations: Object.fromEntries(["discover", "invoke", "advertise", "execute"].map((operation) => [operation,
    { actor: { mode: "roles", actors: { user: { anyOf: [operation] }, ...(options.actors === undefined ? {} : { agent: { anyOf: [operation] } }) } }, ...(operation === "discover" ? { reveal: true } : {}), ...(options.permission === undefined ? {} : { requiredPermissions: ["fixture-check"] }) }])),
  challenge: { required: options.challenge ?? false } }, ...(options.additionalPolicies ?? [])], bindings: [{ sessionType, providerId: "mock", ...rules }] });
  const registry = createReferenceAuthorizer({ policies, now: options.registryNow ?? Date.now,
    permissionEvaluators: { ...options.permissionEvaluators, ...(options.permission === undefined ? {} : { "fixture-check": options.permission }) } });
  const registrations = options.registrations ?? definitions.map((definition) => ({ definition, revision: 1, source: { id: "fixture-source-" + definition.key, revision: 1 },
    implementation: { location: "client" as const, suppliedBy: "client" as const, implementation: "client-owned" as const, implementationId: "fixture-implementation-" + definition.key } }));
  for (const definition of definitions) registry.installTool(definition);
  const schema = { type: "object" as const, properties: {} };
  const type = defineApplicationSession({ id: "22222222-2222-4222-8222-222222222222", ...sessionType, providerId: "mock", configSchema: schema,
    config: createSessionConfig({ schema, parser: z.object({}).strict() }), tools: definitions.map((ref) => ({ ref, access: ToolAccessLevel.Standard })),
    policy: { rules,
      ...(options.creatorView === true
        ? { creatorBootstrap: { id: "fixture-view-bootstrap", revision: 1, bindings: [{ key: "read", purpose: "admitted" as const,
            roles: ["discover"], policies: [policy], authority: { kind: "host-policy" as const, policy }, maxLifetimeMs: 60000 }] } }
        : {}),
      creation: { capability: { key: "fixture.create", revision: 1 }, prepare: ({ request }) => Promise.resolve(
        request.caller.actor.principal.subject !== "creator"
          ? { effect: "deny", release: () => undefined }
          : {
              effect: "allow", request, bootstrap: options.creatorView === true
                ? { kind: "template", id: "fixture-view-bootstrap", revision: 1, bindings: [{ key: "read", lifetimeMs: 60000 }] }
                : { kind: "none" }, validUntil: Date.now() + 30000, isCurrent: () => true, release: () => undefined,
            }) } } });
  const contexts = new Map<string, { readonly context: TrustedRequestContext; readonly fence: ConnectionFence; readonly tuples: ToolAssignmentRecord[]; readonly released: Promise<void> }>();
  const installConnection = (context: TrustedRequestContext, fence: ConnectionFence): ToolAssignmentRecord[] => {
    const scope = host.sessions.authorization?.getResource(toolPolicyChannel);
    if (scope === undefined) throw new Error("Fixture session not created");
    const route = options.route?.(scope).route ?? { origin: scope, targets: [scope] };
    const tuples: ToolAssignmentRecord[] = [];
    for (const registration of registrations) {
      if (options.assignment?.(context.actor.principal.subject, registration, "execute") === false) continue;
      const tuple: ToolAssignmentRecord = { resource: scope, route, recipient: context.actor,
        contract: { id: registration.definition.id, key: registration.definition.key, version: registration.definition.version },
        operation: "execute", bindingId: "fixture-grant-" + context.actor.principal.subject, policyRef: policy,
        executor: { actor: context.actor, connectionId: context.connectionId, generation: fence.connectionGeneration, registrationRevision: registration.revision },
        implementation: registration.implementation };
      registry.installExecutorAssignment(tuple);
      tuples.push(tuple);
    }
    return tuples;
  };
  const composition: SecurityComposition = {
    identity: { authenticate: ({ headers }) => {
      const credential = headers["sec-websocket-protocol"];
      const token = typeof credential === "string" && credential.startsWith("r5-") ? credential.slice(3) : undefined;
      return Promise.resolve(token !== undefined && Object.hasOwn(roles, token) ? { domainId: "local", subject: token } : undefined);
    } },
    actors: { resolve: (input) => {
      const classified = options.actors?.[input.principal.subject];
      return Promise.resolve({ actor: classified?.actor ?? { kind: "user", principal: input.principal },
        connectionId: input.connectionId, authRevision: input.authRevision,
        ...(classified?.agentGeneration === undefined ? {} : { agentGeneration: classified.agentGeneration }),
        ...(classified?.delegationRef === undefined ? {} : { delegationRef: classified.delegationRef }) });
    } },
    bindings: { read: () => Promise.resolve([]) }, resources: { resolve: () => Promise.reject(new Error("No initial scope lookup")) },
    freshness: { current: () => Promise.resolve({ domainId: "local", revision: 1, invalidated: false }), invalidate: () => Promise.resolve() },
    policies: { evaluate: () => Promise.resolve({ effect: "deny", code: "not-used" }) },
    grants: { prepare: () => Promise.reject(new Error("No grant issuance")), commit: () => {
      throw new Error("No grant issuance");
    }, rollback: () => undefined, revoke: () => Promise.resolve() },
  };
  const host = createAHPServer({ host: "127.0.0.1", port: 0, path: "/capacity",
    ...(options.protectedViews === true
      ? { protectedViews: { registry, policies, admitted: [policy],
          resolve: ({ resource }: { resource: import("@authorization").ResourceRef }) => options.route?.(resource) ?? ({ route: { origin: resource, targets: [resource] } }) } }
      : {}),
    sessions: { providers: [createMockProvider()], application: { catalogue: createSessionTypeCatalogue({ tools: createToolCatalogue({ definitions }), types: [type.registration] }), defaultType: sessionType }, creationSecurity: { registry, policies } },
    toolExecution: { registry, policies, registrations, resolve: options.resolve ?? (({ origin }) => options.route?.(origin) ?? ({ route: { origin, targets: [origin] } })), dispatcher: { limits: { shutdownWaitMs: 20 } } },
    security: { composition, ...(options.securityNow === undefined ? {} : { now: options.securityNow }), initialAuthority: { prepare: ({ context, fence }) => {
      const releaseSignal = Promise.withResolvers<undefined>();
      const record = { context, fence, tuples: installConnection(context, fence), released: releaseSignal.promise };
      contexts.set(context.connectionId, record);
      return Promise.resolve({ scopes: [], allowGlobalSequence: true, validUntil: Date.now() + 60000,
        isCurrent: () => {
          options.onSecurityCheck?.(context);
          return contexts.get(context.connectionId) === record;
        },
        release: () => {
          contexts.delete(context.connectionId);
          for (const tuple of record.tuples) registry.removeExecutorAssignment(tuple);
          releaseSignal.resolve(undefined);
        } });
    } } },
  });
  const recreate = async () => {
    const context: TrustedRequestContext = { actor: { kind: "user", principal: { domainId: "local", subject: "creator" } }, connectionId: "fixture-creator", authRevision: "fixture-auth" };
    await host.sessions.authorization?.createSession({ channel: toolPolicyChannel, config: { "x-ahp-session-type": type.header } },
      { context, connectionId: context.connectionId, connectionGeneration: 1, validUntil: Date.now() + 30000, signal: new AbortController().signal, isCurrent: () => true });
    const scope = host.sessions.authorization?.getResource(toolPolicyChannel);
    if (scope === undefined) throw new Error("Fixture creation failed");
    options.configureResources?.(registry, scope, sessionType);
    const route = options.route?.(scope).route ?? { origin: scope, targets: [scope] };
    for (const [subject, actorRoles] of Object.entries(roles)) {
      const actor = options.actors?.[subject]?.actor ?? { kind: "user" as const, principal: { domainId: "local", subject } };
      const bindingId = "fixture-grant-" + subject;
      const parent = options.actors?.[subject]?.parentSubject;
      const issuer = parent === undefined ? undefined : options.actors?.[parent]?.actor ?? { kind: "user" as const, principal: { domainId: "local", subject: parent } };
      registry.installBinding({ id: bindingId, actor, scope, roles: actorRoles, policies: [policy], revision: 1,
        authority: parent === undefined || issuer === undefined ? { kind: "host-policy", policy } : { kind: "delegation", issuer, parentGrantId: "fixture-grant-" + parent } });
      const operations: readonly ToolOperation[] = options.toolDiscovery?.includes(subject) === true ? ["discover", "invoke", "advertise"] : ["invoke", "advertise"];
      for (const registration of registrations) for (const operation of operations) {
        if (options.assignment?.(subject, registration, operation) === false) continue;
        const definition = registration.definition;
        registry.installToolAssignment({ resource: scope, route, recipient: actor,
          contract: { id: definition.id, key: definition.key, version: definition.version }, operation, bindingId, policyRef: policy });
      }
    }
    for (const record of contexts.values()) {
      record.tuples.splice(0, record.tuples.length, ...installConnection(record.context, record.fence));
    }
  };
  await recreate();
  return { host, registry, policies, contexts, registrations, recreate, policy, sessionHeader: type.header };
}
