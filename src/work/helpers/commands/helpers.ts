import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { captureValue } from "@jsonrpc/helpers/value/helpers";
import { RepositoryError, type ReplaceData, type StoredSession } from "@persistence";
import type { StoredWork, WorkFence, WorkIntent } from "@persistence/helpers/durability/workTypes";
import { resolveWorkKind } from "../definitions";
import { captureWorkSelectionInput, createWorkSelectionGraph } from "../selections";
import { WorkError } from "../errors";
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
    if (!current(caller)) return unavailable();
    const facts = immutableFacts(intent);
    const approval = await options.prepare(caller, op, facts, row && immutableFacts(row));
    const admit = () => {
      const permitted: unknown = approval.isCurrent();
      return permitted === true && current(caller);
    };
    try {
      if (!admit()) return unavailable();
      const result = await run(admit);
      if (!admit()) return unavailable();
      return result;
    } catch (err) {
      if (err instanceof RepositoryError && err.code === "conflict") throw new WorkError("conflict", "Work state or capacity changed.");
      throw err;
    } finally { approval.release(); }
  }
  async function lookup(caller: WorkRequestContext, id: string) {
    if (!current(caller)) return unavailable();
    const store = options.repository();
    const domainId = caller.context.actor.principal.domainId;
    const row = await store.get(domainId, capture(workUuid, id));
    if (!row || !current(caller)) return undefined;
    const graph = await store.graph(domainId, row.session);
    if (!graph || !current(caller)) return undefined;
    return { store, row, kind: registeredKind(graph.session, row.kind) };
  }
  async function settle(caller: WorkAgentContext, execution: WorkExecutionRef, input: z.infer<typeof completionSchema> | z.infer<typeof failureSchema>) {
    const proof = executionFence(caller, execution.workId, execution);
    const { row, store, kind } = await lookup(caller, execution.workId) ?? unavailable();
    const data = input.data && { expectedDataRevision: input.data.expectedDataRevision, data: checked(() => kind.parseData(input.data?.data)) };
    const operation = "retryable" in input
      ? { status: "failed" as const, retryable: input.retryable, code: "worker_failure", summary: "Work execution failed.", data }
      : { status: "completed" as const, result: checked(() => kind.parseResult(input.result)), data };
    return authorized(caller, operation.status === "completed" ? "complete" : "fail", row, row,
      (admit) => store.settle({ id: row.id, session: row.session, revision: row.revision, execution: proof }, operation, admit));
  }
  return {
    async submit(caller, input) {
      if (!current(caller)) return unavailable();
      const captured = capture(submissionSchema, input);
      const selections = checked(() => captureWorkSelectionInput({ scope: captured.scope,
        ...(captured.session && { session: captured.session }), ...(captured.announce && { announce: captured.announce }) }, selectionLimits));
      const anchor = selections.session ?? selections.scope.find((entry) => entry.include)?.resource ?? invalid();
      const submitter = structuredClone(caller.context.actor);
      const store = options.repository();
      const graph = await store.graph(submitter.principal.domainId, anchor, { kind: captured.kind, requestKey: captured.requestKey, submitter });
      if (!graph || !current(caller)) return unavailable();
      const kind = registeredKind(graph.session, captured.kind);
      const rules = checked(() => createWorkSelectionGraph(submitter.principal.domainId, graph.session, graph.resources, selectionLimits).normalize(selections, graph.previous));
      const intent: WorkIntent = { session: rules.session, submitter, kind: captured.kind, requestKey: captured.requestKey,
        input: checked(() => kind.parseInput(captured.input)), submittedData: checked(() => kind.parseData(captured.data === undefined ? {} : captured.data)),
        maxAttempts: kind.descriptor.maxAttempts, priority: captured.priority ?? 0, targetAgentId: captured.targetAgentId ?? null, scope: rules.scope, announce: rules.announce };
      const result = await authorized(caller, "submit", intent, graph.previous, (admit) => store.submit(intent, rules.graphRevision, limits, admit));
      return { id: result.id };
    },
    async get(caller, id) {
      try {
        const found = await lookup(caller, id);
        if (!found) return null;
        return await authorized(caller, "read", found.row, found.row, () => Promise.resolve(workDetail(found.row)));
      } catch (error) {
        if (error instanceof WorkError && error.code === "unauthorized") return null;
        throw error;
      }
    },
    async updateData(caller, id, change, execution) {
      const input = capture(replacementSchema, change);
      const proof = executionFence(caller, id, execution);
      const { row, store, kind } = await lookup(caller, id) ?? unavailable();
      const parsed: ReplaceData = { expectedDataRevision: input.expectedDataRevision, data: checked(() => kind.parseData(input.data)) };
      return authorized(caller, "updateData", row, row, (admit) => store.replaceData({ id: row.id, session: row.session, revision: row.revision, execution: proof }, parsed, admit));
    },
    async complete(caller, execution, command) { await settle(caller, execution, capture(completionSchema, command)); },
    async fail(caller, execution, command) { return { status: (await settle(caller, execution, capture(failureSchema, command))).status }; },
  };
}
