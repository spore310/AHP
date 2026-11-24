import { sameResource } from "@authorization/helpers/context";
import type { AgentDirectory } from "@agents";
import type { DurableHost } from "@persistence";
import type { WorkInspection } from "@persistence/helpers/durability/workTypes";
import type { SessionsFactory } from "@sessions/types";
import { createWorkService, WorkError, type RegisteredAgentIdentity, type WorkAgentContext } from "@work";
import { createWorkAuthorizer } from "@work/helpers/authorization";
import { lostWorkPolicy } from "@work/helpers/authorityLoss/helpers";
import type { WorkAuthorityLossReason } from "@work/helpers/authorityLoss/types";
import { createWorkSelectionGraph } from "@work/helpers/selections";
import { isDeepStrictEqual } from "node:util";
import { workConnection } from "../ahp/workContext";
import type { AHPBindingOptions } from "../ahp/types";
import type { WebSocketConnectionContext } from "../../types";
import type { AHPServerOptions } from "./types";

function unavailable(): never {
  throw new WorkError("unauthorized", "Work authority unavailable.");
}

export function createHostedWork(options: AHPServerOptions, sessions: SessionsFactory, agents: AgentDirectory,
  lease: () => DurableHost | undefined, stopped: () => boolean) {
  const settings = options.agentWork;
  const security = options.sessions.creationSecurity;
  const catalogue = options.sessions.application?.catalogue;
  const auth = sessions.authorization;
  if (!settings || !security || !catalogue || !auth || !settings.ceiling || !sessions.durability) return undefined;
  const workDomain = options.security?.workDomainId;
  const mappings = structuredClone(settings.agentMappings ?? []);
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
  async function worker(connection: WebSocketConnectionContext): Promise<WorkAgentContext> {
    const base = workConnection(connection);
    const actor = base.context.actor;
    const bound = agents.getByConnection(connection.connectionId);
    const key = agentKey(connection);
    if (actor.kind !== "agent" || !key || !bound || bound.principalSubject !== actor.principal.subject) return unavailable();
    const record = await agents.getRegistration(bound.agentId);
    if (!record?.enabled || !record.executionEpoch || record.domainId !== actor.principal.domainId || record.principalSubject !== bound.principalSubject
      || record.agentKey !== key || record.id !== bound.agentId) return unavailable();
    const presence = agents.capturePresenceFence?.(bound, record.executionEpoch) ?? unavailable();
    const fence = () => !stopped() && !base.signal.aborted && !!lease()?.isOpen() && connection.isOpen?.() === true && presence();
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
    if (value.session.lifecycle !== "active" || !createWorkSelectionGraph(row.session.domainId, value.session, value.resources)
      .hasActivePositiveScope(row.scope, value.session.graphRevision)) return lost("resource-unavailable");
    if (Date.parse(row.lease.expiresAt) <= value.databaseTime) return lost("authority-expired");
    const presence = agents.getOnline(registration.id);
    const connection = presence && connections.get(presence.connectionId);
    if (!connection || !connection.isSecurityCurrent?.()) return lost("connection-lost");
    const caller = await worker(connection);
    return await lostWorkPolicy(() => authorizer.prepare(caller, "renew", row, row)) ? lost("policy-changed") : undefined;
  }
  const service = createWorkService({ repository: () => host().work, resolveType, async prepare(caller, operation, intent, row, execution) {
    const supplied = caller as Partial<WorkAgentContext>;
    if (!supplied.agent) return authorizer.prepare(caller, operation, intent, row, execution);
    const connection = connections.get(caller.context.connectionId) ?? unavailable();
    const actual = await worker(connection);
    if (!isDeepStrictEqual(caller.context, actual.context) || !isDeepStrictEqual(actual.agent, supplied.agent)
      || supplied.executionEpoch !== actual.executionEpoch) return unavailable();
    const approval = await authorizer.prepare({ ...actual, signal: AbortSignal.any([caller.signal, actual.signal]) }, operation, intent, row, execution);
    const fence = () => actual.fence?.() === true && approval.fence();
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
  return { service, prepareToolWork, prepareResourceWork, binding: { agentKey, get: service.get.bind(service), changed: service.authorityChanged.bind(service) },
    connected(connection: WebSocketConnectionContext) {
      connections.set(connection.connectionId, connection);
      connection.onClose(() => {
        connections.delete(connection.connectionId);
        service.authorityChanged();
      });
    },
    start() {
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
