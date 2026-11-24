import { sameResource } from "@authorization/helpers/context";
import { createAgentWorkConfig, type AgentDirectory } from "@agents";
import { RepositoryError, type DurableHost } from "@persistence";
import type { WorkInspection } from "@persistence/helpers/durability/workTypes";
import type { SessionsFactory } from "@sessions/types";
import { createWorkService, WorkError, type RegisteredAgentIdentity, type WorkAgentContext } from "@work";
import { createWorkAuthorizer } from "@work/helpers/authorization";
import { createSchedulingStamp } from "@work/helpers/claims/admission";
import { lostWorkPolicy } from "@work/helpers/authorityLoss/helpers";
import type { WorkAuthorityLossReason } from "@work/helpers/authorityLoss/types";
import { createWorkSelectionGraph } from "@work/helpers/selections";
import { isDeepStrictEqual } from "node:util";
import { workConnection } from "../ahp/workContext";
import { initialSchedulingFence } from "../security/helpers";
import type { AHPBindingOptions } from "../ahp/types";
import type { WebSocketConnectionContext } from "../../types";
import type { AHPServerOptions } from "./types";

function unavailable(): never {
  throw new WorkError("unauthorized", "Work authority unavailable.");
}

export function createHostedWork(options: AHPServerOptions, sessions: SessionsFactory, agents: AgentDirectory,
  lease: () => DurableHost | undefined, stopped: () => boolean, diagnostic: (event: import("@work").WorkDiagnosticEvent, correlationId?: string) => void) {
  const settings = options.agentWork;
  const security = options.sessions.creationSecurity;
  const catalogue = options.sessions.application?.catalogue;
  const auth = sessions.authorization;
  if (!settings || !security || !catalogue || !auth || !settings.ceiling || !sessions.durability) return undefined;
  const workDomain = options.security?.workDomainId;
  const registry = security.registry;
  const mappings = structuredClone(settings.agentMappings ?? []);
  const hostKinds = [...settings.allowedKinds];
  const securityNow = options.security?.now ?? Date.now;
  const configuration = createAgentWorkConfig(settings.configuration, () => {
    service.authorityChanged();
  });
  const kindAllowed = (identity: RegisteredAgentIdentity, kind: string) => configuration.resolve(identity).allowedKinds?.includes(kind) !== false;
  const actorKeys = new Set<string>();
  const registrationKeys = new Set<string>();
  for (const item of mappings) {
    const actorKey = JSON.stringify([item.domainId, item.subject, item.actorAgentId]);
    const registration = JSON.stringify([item.domainId, item.subject, item.agentKey]);
    if (actorKeys.has(actorKey) || registrationKeys.has(registration)) throw new TypeError("Ambiguous agent mapping.");
    actorKeys.add(actorKey);
    registrationKeys.add(registration);
  }
  const host = () => {
    const value = lease();
    return value?.isOpen() && !stopped() ? value : unavailable();
  };
  const resolveType = auth.resolveWorkType.bind(auth);
  const authorizer = createWorkAuthorizer({ registry: security.registry, policies: security.policies,
    allowedKinds: [...settings.allowedKinds], ceiling: settings.ceiling, resolveType, session: (ref) => host().sessions.get(ref),
    resource: (ref) => host().resources.get(ref),
    sampleLease: (fence) => host().work.sampleLease(fence),
    isSessionCurrent: (ref, operation) => {
      const actual = auth.getResource(ref.id);
      return !!actual && sameResource(actual, ref) && !auth.isSettling(ref.id) && (operation === "read" || auth.isReady(ref)) && !!lease()?.isOpen() && !stopped();
    } });
  const connections = new Map<string, WebSocketConnectionContext>();
  function agentKey(connection: WebSocketConnectionContext) {
    const actor = connection.security?.context.actor;
    if (actor?.kind !== "agent" || actor.principal.domainId !== workDomain || connection.isSecurityCurrent?.() !== true) return undefined;
    const configured = mappings.find((m) => m.domainId === workDomain && m.subject === actor.principal.subject && m.actorAgentId === actor.agentId);
    if (configured) return configured.agentKey;
    if (registrationKeys.has(JSON.stringify([workDomain, actor.principal.subject, actor.agentId]))) return undefined;
    return actor.agentId;
  }
  async function worker(connection: WebSocketConnectionContext, scheduling = false): Promise<WorkAgentContext> {
    const base = workConnection(connection);
    const actor = base.context.actor;
    const bound = agents.getByConnection(connection.connectionId);
    const key = agentKey(connection);
    if (actor.kind !== "agent" || !key || !bound || bound.principalSubject !== actor.principal.subject) return unavailable();
    const record = await agents.getRegistration(bound.agentId);
    if (!record?.enabled || !record.executionEpoch || bound.executionEpoch !== record.executionEpoch || record.domainId !== actor.principal.domainId || record.principalSubject !== bound.principalSubject
      || record.agentKey !== key || record.id !== bound.agentId) return unavailable();
    const presence = agents.capturePresenceFence?.(bound, record.executionEpoch) ?? unavailable();
    const owner = host();
    const setup = connection.security ?? unavailable();
    const initial = scheduling ? initialSchedulingFence(setup, registry.captureFence()) ?? unavailable() : undefined;
    const deadline = performance.now() + setup.validUntil - securityNow();
    const fence = () => !stopped() && !base.signal.aborted && lease() === owner && connection.security === setup
      && performance.now() < deadline && connection.isOpen?.() === true && presence() && initial?.() !== false;
    const isCurrent = () => !stopped() && !!lease()?.isOpen() && base.isCurrent()
      && agents.getByConnection(connection.connectionId)?.generation === bound.generation
      && agents.getOnline(bound.agentId)?.connectionId === connection.connectionId;
    if (!isCurrent()) return unavailable();
    return { ...base, isCurrent, fence, agent: { principal: actor.principal, actorAgentId: actor.agentId, agentKey: key, registrationId: record.id },
      executionEpoch: record.executionEpoch };
  }
  async function assess(value: WorkInspection) {
    const { row, registration } = value;
    if (!registration || !row.lease) return undefined;
    const executor: RegisteredAgentIdentity = { principal: { domainId: row.session.domainId, subject: registration.subject },
      registrationId: registration.id, agentKey: registration.key, actorAgentId: mappings.find((m) => m.domainId === row.session.domainId
        && m.subject === registration.subject && m.agentKey === registration.key)?.actorAgentId ?? registration.key };
    const lost = (reason: WorkAuthorityLossReason) => ({ reason, executor });
    if (!registration.enabled || row.lease.executionEpoch !== registration.epoch) return lost("registration-disabled");
    if (!kindAllowed(executor, row.kind)) return lost("policy-changed");
    if (value.session.lifecycle !== "active" || !createWorkSelectionGraph(row.session.domainId, value.session, value.resources)
      .hasActivePositiveScope(row.scope, value.session.graphRevision)) return lost("resource-unavailable");
    if (Date.parse(row.lease.expiresAt) <= value.databaseTime) return lost("authority-expired");
    const presence = agents.getOnline(registration.id);
    const connection = presence && connections.get(presence.connectionId);
    if (!connection || !connection.isSecurityCurrent?.()) return lost("connection-lost");
    const caller = await worker(connection);
    return await lostWorkPolicy(() => authorizer.prepare(caller, "renew", row, row)) ? lost("policy-changed") : undefined;
  }
  async function authenticateAgent(caller: WorkAgentContext, scheduling = false): Promise<WorkAgentContext> {
    const connection = connections.get(caller.context.connectionId) ?? unavailable();
    const actual = await worker(connection, scheduling);
    if (!isDeepStrictEqual(caller.context, actual.context) || !isDeepStrictEqual(actual.agent, caller.agent)
      || caller.executionEpoch !== actual.executionEpoch) return unavailable();
    return { ...actual, signal: AbortSignal.any([caller.signal, actual.signal]), retainReply: caller.retainReply?.bind(caller) };
  }
  const service = createWorkService({ repository: () => host().work, resolveType, authenticateAgent: (caller) => authenticateAgent(caller, true),
    scheduling: { allowedKinds: hostKinds, configuration, leaseMs: settings.leaseMs,
      admission(caller, approval, operation, kind, revision) {
        // Only the reauthenticated worker and the host's prepared approval reach this hook.
        const presence = caller.fence?.bind(caller) ?? unavailable();
        const policy = approval.fence?.bind(approval) ?? unavailable();
        const identity = caller.agent;
        return createSchedulingStamp((locking) => {
          const current = configuration.resolve(identity);
          return presence() && policy() && (!locking || operation === "renew" || current.revision === revision) && current.allowedKinds?.includes(kind) !== false;
        });
      } }, onDiagnostic: diagnostic,
    async prepare(caller, operation, intent, row, execution) {
      const supplied = caller as Partial<WorkAgentContext>;
      if (!supplied.agent) return authorizer.prepare(caller, operation, intent, row, execution);
      const actual = await authenticateAgent(caller as WorkAgentContext);
      if (!kindAllowed(actual.agent, intent.kind)) return unavailable();
      const approval = await authorizer.prepare(actual, operation, intent, row, execution);
      const fence = () => actual.fence?.() === true && kindAllowed(actual.agent, intent.kind) && approval.fence();
      return { isCurrent: () => actual.isCurrent() && approval.isCurrent() && fence(), fence, release: approval.release.bind(approval) };
    },
    authorityLoss: settings.hooks && { hooks: settings.hooks, deadlineMs: settings.hookDeadlineMs, maxPending: settings.maxPendingHooks, assess } });
  const unsubscribe = security.registry.onInvalidate(service.authorityChanged.bind(service));
  let timer: ReturnType<typeof setInterval> | undefined;
  const prepareToolWork: NonNullable<AHPBindingOptions["prepareToolWork"]> = async (connection, context, execution, route, input, signal) => {
    const agent = await worker(connection);
    if (!isDeepStrictEqual(agent.context, context)) return unavailable();
    return service.prepareExecutionGuard({ ...agent, signal: AbortSignal.any([signal, agent.signal]) }, execution, route, input);
  };
  const prepareResourceWork: import("@toolExecution").ToolWorkPreparation = (caller, execution, route, input, signal) => {
    const connection = connections.get(caller.connectionId) ?? unavailable();
    return prepareToolWork(connection, caller, execution, route, input, signal);
  };
  function bindingFailed(error: unknown) {
    if (error instanceof RepositoryError && error.code === "outcome_unknown") diagnostic("storageOutcomeUnknown", error.correlationId);
    else diagnostic(error instanceof RepositoryError && error.code === "database" ? "storageFailed" : "bindingFailed");
  }
  return { service, configuration, prepareToolWork, prepareResourceWork, binding: { agentKey, worker, service, bindingFailed, get: service.get.bind(service), changed: service.authorityChanged.bind(service) },
    connected(connection: WebSocketConnectionContext) {
      connections.set(connection.connectionId, connection);
      connection.onClose(() => {
        connections.delete(connection.connectionId);
        service.authorityChanged();
      });
    },
    async start() {
      // Startup does a bounded pass. Normal claims continue per-session reconciliation.
      const durable = host();
      for (const session of (await durable.sessions.listRecoverable()).slice(0, 32)) {
        if (session.lifecycle === "active") await durable.work.expireExhausted(session.ref, 32);
      }
      if (settings.hooks?.onLeaseAuthorityLost && !timer) {
        service.authorityChanged();
        timer = setInterval(service.authorityChanged.bind(service), Math.max(30000, 2 * (settings.hookDeadlineMs ?? 5000)));
        timer.unref();
      }
    },
    close() {
      clearInterval(timer);
      unsubscribe();
      service.close();
      connections.clear();
    },
  };
}
