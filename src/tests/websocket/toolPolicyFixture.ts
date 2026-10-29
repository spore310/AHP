import { WebSocketTransport } from "@microsoft/agent-host-protocol/ws";
import { z } from "zod";
import { createReferenceAuthorizer, type SecurityComposition, type TrustedRequestContext } from "@authorization";
import type { ToolAssignmentRecord } from "@authorization/helpers/evaluate";
import { createToolPolicyFactory, type ToolOperation } from "@toolPolicy";
import { createSessionConfig, createSessionTypeCatalogue, defineApplicationSession, ToolAccessLevel } from "@sessions";
import { createMockProvider } from "@sessions/mock";
import { createToolCatalogue, type ToolContractDefinition } from "@tools";
import { createAHPServer, type ConnectionFence } from "@websocket";

export const toolPolicyChannel = "ahp-session:/capacity";
export const connectPolicyTransport = (url: string, token = "fixture") => WebSocketTransport.connect(url, { protocols: "r5-" + token });

/** Real credential validation, canonical sessions/assignments and SDK transport; callers still select the internal kernel explicitly. */
export async function createToolPolicyHost(definitions: readonly ToolContractDefinition[], options: {
  readonly roles?: Readonly<Record<string, readonly ToolOperation[]>>;
  readonly permission?: () => Promise<"allow" | "deny">;
  readonly challenge?: boolean;
  readonly onSecurityCheck?: (context: TrustedRequestContext) => void;
  readonly registryNow?: () => number;
} = {}) {
  const roles = options.roles ?? { fixture: ["invoke", "advertise", "execute"] };
  const policy = { id: "fixture.tools", revision: 1 };
  const sessionType = { key: "test.echo-session", version: 1 };
  const rules = { admitted: { policies: [policy], namespaces: [] }, mandatory: [] };
  const policies = createToolPolicyFactory({ policies: [{ ...policy, operations: Object.fromEntries(["invoke", "advertise", "execute"].map((operation) => [operation,
    { actor: { mode: "roles", actors: { user: { anyOf: [operation] } } }, ...(options.permission === undefined ? {} : { requiredPermissions: ["fixture-check"] }) }])),
  challenge: { required: options.challenge ?? false } }], bindings: [{ sessionType, providerId: "mock", ...rules }] });
  const registry = createReferenceAuthorizer({ policies, now: options.registryNow ?? Date.now,
    ...(options.permission === undefined ? {} : { permissionEvaluators: { "fixture-check": options.permission } }) });
  const registrations = definitions.map((definition) => ({ definition, revision: 1, source: { id: "fixture-source-" + definition.key, revision: 1 },
    implementation: { location: "client" as const, suppliedBy: "client" as const, implementation: "client-owned" as const, implementationId: "fixture-implementation-" + definition.key } }));
  for (const definition of definitions) registry.installTool(definition);
  const schema = { type: "object" as const, properties: {} };
  const type = defineApplicationSession({ id: "22222222-2222-4222-8222-222222222222", ...sessionType, providerId: "mock", configSchema: schema,
    config: createSessionConfig({ schema, parser: z.object({}).strict() }), tools: definitions.map((ref) => ({ ref, access: ToolAccessLevel.Standard })),
    policy: { rules, creation: { capability: { key: "fixture.create", revision: 1 }, prepare: ({ request }) => Promise.resolve(
      request.caller.actor.principal.subject !== "creator"
        ? { effect: "deny", release: () => undefined }
        : {
            effect: "allow", request, bootstrap: { kind: "none" }, validUntil: Date.now() + 30000, isCurrent: () => true, release: () => undefined,
          }) } } });
  const contexts = new Map<string, { readonly context: TrustedRequestContext; readonly fence: ConnectionFence; readonly tuples: ToolAssignmentRecord[]; readonly released: Promise<void> }>();
  const installConnection = (context: TrustedRequestContext, fence: ConnectionFence): ToolAssignmentRecord[] => {
    const scope = host.sessions.authorization?.getResource(toolPolicyChannel);
    if (scope === undefined) throw new Error("Fixture session not created");
    const route = { origin: scope, targets: [scope] };
    const tuples: ToolAssignmentRecord[] = [];
    for (const registration of registrations) {
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
    actors: { resolve: (input) => Promise.resolve({ actor: { kind: "user", principal: input.principal }, connectionId: input.connectionId, authRevision: input.authRevision }) },
    bindings: { read: () => Promise.resolve([]) }, resources: { resolve: () => Promise.reject(new Error("No initial scope lookup")) },
    freshness: { current: () => Promise.resolve({ domainId: "local", revision: 1, invalidated: false }), invalidate: () => Promise.resolve() },
    policies: { evaluate: () => Promise.resolve({ effect: "deny", code: "not-used" }) },
    grants: { prepare: () => Promise.reject(new Error("No grant issuance")), commit: () => {
      throw new Error("No grant issuance");
    }, rollback: () => undefined, revoke: () => Promise.resolve() },
  };
  const host = createAHPServer({ host: "127.0.0.1", port: 0, path: "/capacity",
    sessions: { providers: [createMockProvider()], application: { catalogue: createSessionTypeCatalogue({ tools: createToolCatalogue({ definitions }), types: [type.registration] }), defaultType: sessionType }, creationSecurity: { registry, policies } },
    toolExecution: { registry, policies, registrations, resolve: ({ origin }) => ({ route: { origin, targets: [origin] } }), dispatcher: { limits: { shutdownWaitMs: 20 } } },
    security: { composition, initialAuthority: { prepare: ({ context, fence }) => {
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
    const route = { origin: scope, targets: [scope] };
    for (const [subject, actorRoles] of Object.entries(roles)) {
      const actor = { kind: "user" as const, principal: { domainId: "local", subject } };
      const bindingId = "fixture-grant-" + subject;
      registry.installBinding({ id: bindingId, actor, scope, roles: actorRoles, policies: [policy], revision: 1, authority: { kind: "host-policy", policy } });
      for (const definition of definitions) for (const operation of ["invoke", "advertise"] as const) registry.installToolAssignment({ resource: scope, route, recipient: actor,
        contract: { id: definition.id, key: definition.key, version: definition.version }, operation, bindingId, policyRef: policy });
    }
    for (const record of contexts.values()) {
      record.tuples.splice(0, record.tuples.length, ...installConnection(record.context, record.fence));
    }
  };
  await recreate();
  return { host, registry, policies, contexts, registrations, recreate, policy };
}
