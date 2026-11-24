import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { captureValue } from "@jsonrpc/helpers/value/helpers";
import { RepositoryError, type ReplaceData, type StoredSession } from "@persistence";
import type { DurableWorkRepository, StoredWork, WorkFence, WorkIntent } from "@persistence/helpers/durability/workTypes";
import { sameResource } from "@authorization/helpers/context";
import { resolveWorkKind } from "../definitions";
import { captureWorkSelectionInput, createWorkSelectionGraph } from "../selections";
import { WorkError } from "../errors";
import { createWorkFences } from "../executionGuard/helpers";
import { createAuthorityLossMonitor } from "../authorityLoss/helpers";
import { workDetail } from "./views";
import type { WorkAgentContext, WorkCommandOptions, WorkExecutionRef, WorkRequestContext, WorkService } from "./types";

import { workUuid, completionSchema, executionSchema, failureSchema, replacementSchema, submissionSchema } from "../protocol/schemas";
const unavailable = (): never => {
  throw new WorkError("unauthorized", "The work operation is unavailable.");
};
const invalid = (): never => {
  throw new WorkError("invalid", "Invalid work command.");
};

function capture<T>(schema: z.ZodType<T>, input: unknown): T {
  try {
    return schema.parse(captureValue(input, { maxBytes: 512 * 1024, maxDepth: 20, maxKeys: 12000, postgres: true }).value);
  } catch {
    return invalid();
  }
}
function checked<T>(fn: () => T): T {
  try {
    return fn();
  } catch {
    return invalid();
  }
}
function current(caller: WorkRequestContext): boolean {
  const live: unknown = caller.isCurrent();
  return !caller.signal.aborted && live === true;
}
function approved(value: unknown): boolean {
  if (value !== true) void Promise.resolve(value).catch(() => undefined);
  return value === true;
}
/** Facts handed to trusted application callbacks remain detached from the command being committed. */
function immutableFacts<T extends WorkIntent>(value: T): T {
  const copy = structuredClone(value);
  const visit = (entry: unknown) => {
    if (!entry || typeof entry !== "object" || Object.isFrozen(entry)) return;
    Object.freeze(entry);
    for (const child of Object.values(entry)) visit(child);
  };
  visit(copy);
  return copy;
}
function executionFence(caller: WorkRequestContext, id: string, execution?: WorkExecutionRef): WorkFence["execution"] {
  if (!execution) return undefined;
  const command = capture(executionSchema, execution);
  if (command.workId !== capture(workUuid, id)) return invalid();
  const agent = caller as Partial<WorkAgentContext>;
  const actor = caller.context.actor;
  if (!agent.agent || !agent.executionEpoch || actor.kind !== "agent" || agent.agent.actorAgentId !== actor.agentId
    || actor.principal.domainId !== agent.agent.principal.domainId || actor.principal.subject !== agent.agent.principal.subject) return unavailable();
  return { attempt: command.attempt, leaseToken: command.leaseToken, registrationId: agent.agent.registrationId, executionEpoch: agent.executionEpoch };
}

export function createWorkService(options: WorkCommandOptions): WorkService {
  const heads = createWorkFences();
  let closed = false;
  const monitor = options.authorityLoss && createAuthorityLossMonitor({ ...options.authorityLoss,
    repository: options.repository.bind(options), mutate: heads.mutate.bind(heads) });
  const limits = Object.freeze({ ...(options.limits ?? { session: 1000, host: 10000 }) });
  const selectionLimits = Object.freeze({ ...options.selectionLimits });
  if (![limits.session, limits.host].every((v) => Number.isSafeInteger(v) && v > 0)) return invalid();
  function registeredKind(session: StoredSession, name: string) {
    const type = options.resolveType(session.type);
    if (type.definition.id !== session.type.id || type.definition.version !== session.type.version || type.definition.key !== session.type.key
      || type.definition.providerId !== session.providerId || !isDeepStrictEqual(type.definition.work ?? [], session.type.workManifest ?? [])) return unavailable();
    return checked(() => resolveWorkKind(type, name));
  }
  async function authorized<T>(caller: WorkRequestContext, op: Parameters<WorkCommandOptions["prepare"]>[1], intent: WorkIntent,
    row: StoredWork | undefined, run: (admit: () => boolean) => Promise<T>): Promise<T> {
    if (closed || !current(caller)) return unavailable();
    const facts = immutableFacts(intent);
    const approval = await options.prepare(caller, op, facts, row && immutableFacts(row));
    const admit = () => {
      const permitted: unknown = approval.isCurrent();
      return approved(permitted) && current(caller) && !closed && (approval.fence === undefined || approved(approval.fence()));
    };
    let transferred = false;
    try {
      if (!admit()) return unavailable();
      const result = await run(admit);
      if (!admit()) return unavailable();
      if (caller.retainReply) {
        caller.retainReply({ isCurrent: admit, release: () => {
          approval.release();
        } });
        transferred = true;
      }
      return result;
    } catch (err) {
      if (err instanceof RepositoryError && err.code === "conflict") throw new WorkError("conflict", "Work state or capacity changed.");
      throw err;
    } finally { if (!transferred) approval.release(); }
  }
  async function lookup(caller: WorkRequestContext, id: string) {
    if (!current(caller)) return unavailable();
    const store = options.repository();
    const domainId = caller.context.actor.principal.domainId;
    const row = await store.get(domainId, capture(workUuid, id));
    if (!row || !current(caller)) return undefined;
    const graph = await store.graph(domainId, row.session);
    if (!graph || !current(caller)) return undefined;
    return { store, row, graph, kind: registeredKind(graph.session, row.kind) };
  }
  /** A read or terminal acknowledgement can disclose existence until its retained reply is delivered. */
  async function observedReply<T>(caller: WorkRequestContext, id: string, operation: "read" | "cancel", answer: (row: StoredWork) => T,
    candidate?: { readonly store: DurableWorkRepository; readonly row: StoredWork }): Promise<T> {
    if (!current(caller)) return unavailable();
    const head = heads.capture(id);
    let observation: { current(): boolean; release(): void } | undefined;
    const release = () => {
      head.release();
      observation?.release();
    };
    const transfer = { retained: false };
    try {
      const store = candidate?.store ?? options.repository();
      const domain = caller.context.actor.principal.domainId;
      const session = candidate?.row.session ?? (await store.get(domain, id))?.session ?? unavailable();
      const durable = store.observe?.(session, id) ?? unavailable();
      observation = durable;
      const inspected = await store.inspect(domain, id);
      if (!inspected || !sameResource(inspected.row.session, session) || !head.current() || !durable.current()) return unavailable();
      const { row } = inspected;
      if (operation === "cancel" && (inspected.session.lifecycle !== "active" || row.status === "queued" || row.status === "leased")) return unavailable();
      registeredKind(inspected.session, row.kind);
      const guarded: WorkRequestContext = { ...caller, isCurrent: () => current(caller) && head.current() && durable.current(),
        retainReply: caller.retainReply && ((receipt) => {
          caller.retainReply?.({ isCurrent: receipt.isCurrent.bind(receipt), release() {
            try {
              receipt.release();
            } finally {
              release();
            }
          } });
          transfer.retained = true;
        }) };
      return await authorized(guarded, operation, row, row, () => Promise.resolve(answer(row)));
    } finally { if (!transfer.retained) release(); }
  }
  function requireAnchors(row: StoredWork, graph: import("@persistence/helpers/durability/workTypes").WorkGraph) {
    if (!createWorkSelectionGraph(row.session.domainId, graph.session, graph.resources, selectionLimits)
      .hasActivePositiveScope(row.scope, graph.session.graphRevision)) return unavailable();
    return graph.session.graphRevision;
  }
  async function settle(caller: WorkAgentContext, execution: WorkExecutionRef, input: z.infer<typeof completionSchema> | z.infer<typeof failureSchema>) {
    const proof = executionFence(caller, execution.workId, execution);
    const { row, store, kind, graph } = await lookup(caller, execution.workId) ?? unavailable();
    const graphRevision = requireAnchors(row, graph);
    const data = input.data && { expectedDataRevision: input.data.expectedDataRevision, data: checked(() => kind.parseData(input.data?.data)) };
    const operation = "retryable" in input
      ? { status: "failed" as const, retryable: input.retryable, code: "worker_failure", summary: "Work execution failed.", data }
      : { status: "completed" as const, result: checked(() => kind.parseResult(input.result)), data };
    return authorized(caller, operation.status === "completed" ? "complete" : "fail", row, row,
      (admit) => heads.mutate(row.id, () => store.settle({ id: row.id, session: row.session, revision: row.revision, execution: proof, graphRevision }, operation, admit)));
  }
  return {
    authorityChanged() { monitor?.signal(); },
    async authorityIdle() { await monitor?.idle(); },
    close() {
      closed = true;
      heads.close();
      monitor?.close();
    },
    async prepareExecutionGuard(caller, execution, route, input = null) {
      const command = capture(executionSchema, execution);
      const proof = executionFence(caller, command.workId, command) ?? unavailable();
      const targets = structuredClone(route.targets.length ? route.targets : [route.origin]);
      const origin = structuredClone(route.origin);
      const operation = { route: structuredClone(route), input: captureValue(input, { maxBytes: 512 * 1024, maxDepth: 20, maxKeys: 12000, postgres: true }).value };
      const head = heads.capture(command.workId);
      const start = performance.now();
      let approval: Awaited<ReturnType<typeof options.prepare>> | undefined;
      let storageGuard: { current(): boolean; release(): void } | undefined;
      try {
        if (!current(caller)) return unavailable();
        const store = options.repository();
        const domain = caller.context.actor.principal.domainId;
        const candidate = await store.get(domain, command.workId);
        if (!candidate) return unavailable();
        const durable = store.observe?.(candidate.session, command.workId) ?? unavailable();
        storageGuard = durable;
        const observed = await store.inspect(domain, command.workId);
        if (!observed || !head.current() || !current(caller) || observed.session.lifecycle !== "active") return unavailable();
        const { row, registration, session, resources } = observed;
        const lease = row.lease;
        if (row.status !== "leased" || !lease || !registration?.enabled || registration.id !== proof.registrationId
          || registration.key !== caller.agent.agentKey || registration.subject !== caller.agent.principal.subject
          || registration.epoch !== proof.executionEpoch || lease.executionEpoch !== proof.executionEpoch || lease.registrationId !== proof.registrationId
          || lease.attempt !== proof.attempt || lease.leaseToken !== proof.leaseToken) return unavailable();
        registeredKind(session, row.kind);
        const deadline = start + Date.parse(lease.expiresAt) - observed.databaseTime;
        const selection = createWorkSelectionGraph(session.ref.domainId, session, resources, selectionLimits);
        const belongs = resources.some((r) => r.ref.domainId === origin.domainId && r.ref.instanceId === origin.instanceId
          && r.ref.kind === origin.kind && r.ref.id === origin.id && r.lifecycle === "active");
        if (!belongs || !selection.hasActivePositiveScope(row.scope, session.graphRevision)
          || !targets.every((ref) => selection.selected(ref, row.scope, session.graphRevision))) return unavailable();
        approval = await options.prepare(caller, "renew", immutableFacts(row), immutableFacts(row), operation);
        const permitted = approval;
        const fence = () => head.current() && durable.current() && !caller.signal.aborted && performance.now() < deadline
          && (caller.fence === undefined || approved(caller.fence())) && (permitted.fence === undefined || approved(permitted.fence()));
        const check = () => current(caller) && approved(permitted.isCurrent()) && fence();
        if (!check()) return unavailable();
        let released = false;
        return { current: check, fence, release() {
          if (!released) {
            released = true;
            head.release();
            durable.release();
            permitted.release();
          }
        } };
      } catch (error) {
        head.release();
        storageGuard?.release();
        approval?.release();
        throw error;
      }
    },
    async submit(caller, input) {
      if (!current(caller)) return unavailable();
      const captured = capture(submissionSchema, input);
      const selections = checked(() => captureWorkSelectionInput({ scope: captured.scope,
        ...(captured.session && { session: captured.session }), ...(captured.announce && { announce: captured.announce }) }, selectionLimits));
      const anchor = selections.session ?? selections.scope.find((entry) => entry.include)?.resource ?? invalid();
      const submitter = structuredClone(caller.context.actor);
      const store = options.repository();
      let sessionInstance: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const graph = await store.graph(submitter.principal.domainId, anchor, { kind: captured.kind, requestKey: captured.requestKey, submitter });
        if (!graph || !current(caller) || (sessionInstance !== undefined && graph.session.ref.instanceId !== sessionInstance)) return unavailable();
        sessionInstance = graph.session.ref.instanceId;
        const previous = graph.previous;
        const kind = registeredKind(graph.session, captured.kind);
        const rules = checked(() => createWorkSelectionGraph(submitter.principal.domainId, graph.session, graph.resources, selectionLimits).normalize(selections, previous));
        const intent: WorkIntent = { session: rules.session, submitter, kind: captured.kind, requestKey: captured.requestKey,
          input: checked(() => kind.parseInput(captured.input)), submittedData: checked(() => kind.parseData(captured.data === undefined ? {} : captured.data)),
          maxAttempts: kind.descriptor.maxAttempts, priority: captured.priority ?? 0, targetAgentId: captured.targetAgentId ?? null, scope: rules.scope, announce: rules.announce };
        const observation = previous && (store.observe?.(previous.session, previous.id) ?? unavailable());
        const state = { changed: false, retained: false };
        const replayCaller: WorkRequestContext = observation
          ? { ...caller, isCurrent: () => current(caller) && observation.current(),
              retainReply: caller.retainReply && ((receipt) => {
                caller.retainReply?.({ isCurrent: receipt.isCurrent.bind(receipt), release() {
                  try {
                    receipt.release();
                  } finally {
                    observation.release();
                  }
                } });
                state.retained = true;
              }) }
          : caller;
        try {
          const result = await authorized(replayCaller, "submit", intent, previous, (admit) =>
            store.submit(intent, rules.graphRevision, limits, (locked) => {
              state.changed = locked?.id !== previous?.id || locked?.revision !== previous?.revision;
              return !state.changed && admit();
            }));
          return { id: result.id };
        } catch (error) {
          if ((!state.changed && observation?.current() !== false) || !current(caller)
            || (error instanceof RepositoryError && error.code !== "conflict")) throw error;
        } finally {
          if (!state.retained) observation?.release();
        }
      }
      return unavailable();
    },
    async get(caller, id) {
      try {
        return await observedReply(caller, capture(workUuid, id), "read", workDetail);
      } catch (error) {
        if (error instanceof WorkError && (error.code === "unauthorized" || error.code === "stale")) return null;
        throw error;
      }
    },
    async cancel(caller, id) {
      const candidate = await lookup(caller, id) ?? unavailable();
      const { row, store } = candidate;
      if (row.status !== "queued" && row.status !== "leased") return observedReply(caller, row.id, "cancel", () => undefined, candidate);
      await authorized(caller, "cancel", row, row, (admit) =>
        heads.mutate(row.id, () => store.disposition({ id: row.id, session: row.session, revision: row.revision }, "cancel", admit)));
    },
    async updateData(caller, id, change, execution) {
      const input = capture(replacementSchema, change);
      const proof = executionFence(caller, id, execution);
      if ("agent" in caller && !proof) return unavailable();
      const { row, store, kind, graph } = await lookup(caller, id) ?? unavailable();
      const graphRevision = proof && requireAnchors(row, graph);
      const parsed: ReplaceData = { expectedDataRevision: input.expectedDataRevision, data: checked(() => kind.parseData(input.data)) };
      return authorized(caller, "updateData", row, row, (admit) => heads.mutate(row.id, () => store.replaceData({ id: row.id, session: row.session, revision: row.revision, execution: proof, graphRevision }, parsed, admit)));
    },
    async complete(caller, execution, command) { await settle(caller, execution, capture(completionSchema, command)); },
    async fail(caller, execution, command) { return { status: (await settle(caller, execution, capture(failureSchema, command))).status }; },
  };
}
