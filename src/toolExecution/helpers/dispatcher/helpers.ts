import type { ToolContractDefinition } from "@tools/types";
import type { ToolExecutionBinding } from "@toolPolicy/types";
import type { Awaitable, ToolAction, ToolActionContext } from "../../types";
import { captureToolValue } from "../action/helpers";
import {
  TOOL_DISPATCH_ABSOLUTE, TOOL_DISPATCH_DEFAULTS, ToolDispatchFailure,
  toolDispatchAuthorizationSchema, toolDispatchFactsSchema,
} from "./types";
import type {
  ActiveToolDispatch, ToolDispatchFacts, ToolDispatchFailureCode, ToolDispatchHandle,
  ToolDispatchLimits, ToolDispatchOutcome, ToolDispatchPhase, ToolDispatchRequest,
  ToolDispatcher, ToolDispatcherOptions,
} from "./types";

const contextLimits = { maxBytes: 2 * 1024 * 1024, maxDepth: 64, maxKeys: 131_072 };
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const actionObject = (value: unknown): boolean => typeof value === "object" && value !== null;

function captureContext(
  raw: unknown, callId: string, definition: ToolContractDefinition,
  implementation: ToolExecutionBinding, signal: AbortSignal,
  previous?: ToolActionContext,
): ToolActionContext {
  const safe = captureToolValue(raw, contextLimits).value;
  const parsed = toolDispatchFactsSchema.parse(safe);
  const facts = captureToolValue(parsed, contextLimits).value as ToolDispatchFacts;
  const { authority, caller, executor, resources } = facts;
  const domain = caller.actor.principal.domainId;
  if (facts.callId !== callId || facts.contract.id !== definition.id || facts.contract.revision !== definition.version
    || !same(facts.implementation, implementation) || authority.domainId !== domain
    || resources.origin.domainId !== domain || executor.actor.principal.domainId !== domain
    || resources.targets.some((target) => target.domainId !== domain)
    || !same(authority.actor, caller.actor) || authority.authRevision !== caller.authRevision
    || authority.connectionId !== caller.connectionId || authority.agentGeneration !== caller.agentGeneration
    || authority.delegationRef !== caller.delegationRef || !same(authority.executor, executor)
    || !same(authority.route, resources)) throw new ToolDispatchFailure("invalid-context");
  if (previous !== undefined && (!same(previous.caller, caller) || !same(previous.executor, executor)
    || !same(previous.resources.origin, resources.origin) || !same(previous.implementation, facts.implementation))) {
    throw new ToolDispatchFailure("invalid-context");
  }
  return Object.freeze({ ...facts, signal });
}

function captureLimits(input: Partial<ToolDispatchLimits> | undefined): ToolDispatchLimits {
  const limits = { ...TOOL_DISPATCH_DEFAULTS, ...input };
  if (Object.keys(limits).some((key) => !Object.hasOwn(TOOL_DISPATCH_DEFAULTS, key))) throw new TypeError("Unknown dispatcher limit.");
  for (const key of Object.keys(TOOL_DISPATCH_DEFAULTS) as Array<keyof ToolDispatchLimits>) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > TOOL_DISPATCH_ABSOLUTE[key]) throw new TypeError("Invalid dispatcher limit.");
  }
  return Object.freeze(limits);
}

/** One local lifecycle owner. Canonical public admission is supplied by the host adapter. */
export function createToolDispatcher(options: ToolDispatcherOptions = {}): ToolDispatcher {
  const limits = captureLimits(options.limits);
  const now = options.now === undefined ? Date.now.bind(Date) : options.now.bind(options);
  const jobs = new Map<string, ActiveToolDispatch>();
  const usedActions = new WeakSet<object>();
  let closed = false;
  let retainedOutputBytes = 0;
  let lastTime = Number.NEGATIVE_INFINITY;
  const clock = (): number => {
    const value = now();
    if (!Number.isFinite(value) || value < lastTime) throw new ToolDispatchFailure("invalid-clock");
    lastTime = value;
    return value;
  };
  const admissionFailure = (callId: string): ToolDispatchFailureCode | undefined => {
    if (closed) return "closed";
    if (jobs.has(callId)) return "duplicate-call";
    if (jobs.size >= limits.maxInFlight) return "capacity";
    return undefined;
  };

  function dispatch<TInput, TOutput, TPrepared = void>(request: ToolDispatchRequest<TInput, TOutput, TPrepared>): ToolDispatchHandle<TOutput> {
    const callId = request.callId;
    const result = Promise.withResolvers<ToolDispatchOutcome<TOutput>>();
    const settled = Promise.withResolvers<ToolDispatchOutcome<TOutput>>();
    const controller = new AbortController();
    let phase: ToolDispatchPhase = "admission";
    let effectPossible = false;
    let cleanupFailures = 0;
    let primary: { readonly code: ToolDispatchFailureCode; readonly phase: ToolDispatchPhase } | undefined;
    let delivered = false;
    let finished = false;
    let reservedBytes = 0;
    let deadline = 0;
    let context: ToolActionContext | undefined;
    let currentPort: ((context: ToolActionContext) => unknown) | undefined;
    const primaryCode = (): ToolDispatchFailureCode | undefined => primary?.code;
    const failure = (): ToolDispatchOutcome<TOutput> => Object.freeze({
      status: "failed", code: primary?.code ?? "action-failed", phase: primary?.phase ?? phase,
      effectPossible, cleanupFailures,
    });
    const publish = (outcome: ToolDispatchOutcome<TOutput>): void => {
      if (delivered) return;
      delivered = true;
      result.resolve(outcome);
    };
    const interrupt = (code: "timeout" | "cancelled"): void => {
      if (finished) return;
      primary ??= { code, phase };
      controller.abort();
      publish(failure());
    };
    const handle: ToolDispatchHandle<TOutput> = Object.freeze({
      result: result.promise, settled: settled.promise, cancel: () => {
        interrupt("cancelled");
      },
    });
    const immediate = (code: ToolDispatchFailureCode): ToolDispatchHandle<TOutput> => {
      primary = { code, phase };
      finished = true;
      const outcome = failure();
      publish(outcome);
      settled.resolve(outcome);
      return handle;
    };
    const unavailable = admissionFailure(callId);
    if (unavailable !== undefined) return immediate(unavailable);
    if (typeof callId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(callId)) return immediate("invalid-input");
    let input: TInput;
    const registration = request.registration;
    try {
      const value = captureToolValue(request.input, { maxBytes: limits.maxInputBytes, maxDepth: limits.maxJsonDepth, maxKeys: limits.maxJsonKeys }).value;
      if (!registration.validateInput(value)) return immediate("invalid-input");
      input = value;
      deadline = clock() + limits.timeoutMs;
    } catch (error) {
      return immediate(error instanceof ToolDispatchFailure ? error.code : "invalid-input");
    }
    // Validators and the injected clock can reenter. No callback may separate
    // this recheck from the local slot installation.
    const changedAdmission = admissionFailure(callId);
    if (changedAdmission !== undefined) return immediate(changedAdmission);
    jobs.set(callId, { cancel: () => {
      handle.cancel();
    }, settled: settled.promise, draining: () => delivered && !finished });
    const upstream = request.signal;
    const upstreamAbort = (): void => {
      interrupt("cancelled");
    };
    upstream?.addEventListener("abort", upstreamAbort, { once: true });
    if (upstream?.aborted === true) interrupt("cancelled");
    const timer = setTimeout(() => {
      interrupt("timeout");
    }, limits.timeoutMs);

    const live = (): void => {
      const code = primaryCode();
      if (code !== undefined) throw new ToolDispatchFailure(code);
      const time = clock();
      if (time >= deadline) interrupt("timeout");
      if (closed || controller.signal.aborted) interrupt("cancelled");
      const afterCallbacks = primaryCode();
      if (afterCallbacks !== undefined) throw new ToolDispatchFailure(afterCallbacks);
    };

    const deliveryGuard = (): void => {
      live();
      const verdict: unknown = context === undefined ? false : currentPort?.(context);
      if (verdict !== true) {
        void Promise.resolve(verdict).catch(() => undefined);
        throw new ToolDispatchFailure("stale");
      }
      if (closed || controller.signal.aborted) throw new ToolDispatchFailure("cancelled");
    };

    async function run(): Promise<void> {
      let action: ToolAction<TInput, TOutput, TPrepared> | undefined;
      let cleanupAction: (() => Awaitable<void>) | undefined;
      let prepared: TPrepared | undefined;
      let success: { readonly output: TOutput } | undefined;
      let preparing = false;
      const cleanups: Array<() => Awaitable<void>> = [];
      try {
        const ports = request.ports;
        const resolve = ports.resolve.bind(ports);
        const coarse = ports.coarse.bind(ports);
        const authorize = ports.authorize.bind(ports);
        const current = ports.current.bind(ports);
        currentPort = current;
        const guard = (): void => {
          live();
          if (context === undefined) throw new ToolDispatchFailure("invalid-context");
          let verdict: unknown;
          try {
            verdict = current(context);
          } catch {
            throw new ToolDispatchFailure("stale");
          }
          if (verdict !== true) {
            void Promise.resolve(verdict).catch(() => undefined);
            throw new ToolDispatchFailure("stale");
          }
          // No clock/adapter callback after the final currentness decision.
          if (closed || controller.signal.aborted) throw new ToolDispatchFailure(primary?.code ?? "cancelled");
        };
        const step = async <T>(next: ToolDispatchPhase, callback: () => Awaitable<T>, bounded = true): Promise<T> => {
          phase = next;
          live();
          const endsAt = clock() + limits.hookTimeoutMs;
          const hookTimer = bounded
            ? setTimeout(() => {
                interrupt("timeout");
              }, limits.hookTimeoutMs)
            : undefined;
          try {
            if (context !== undefined) guard();
            const value = await callback();
            if (bounded && clock() >= endsAt) interrupt("timeout");
            live();
            return value;
          } finally {
            if (hookTimer !== undefined) clearTimeout(hookTimer);
          }
        };
        phase = "context";
        const initial = await step("context", () => resolve(input, controller.signal));
        context = captureContext(initial, callId, registration.definition, registration.implementation, controller.signal);
        guard();
        const coarseAllowed: unknown = await step("coarse", () => coarse(context as ToolActionContext, input));
        guard();
        if (coarseAllowed !== true) throw new ToolDispatchFailure("denied");
        action = registration.create();
        if (!actionObject(action) || usedActions.has(action)) throw new ToolDispatchFailure("action-reused");
        usedActions.add(action);
        const authenticate = action.authenticate?.bind(action);
        const validate = action.validate?.bind(action);
        const prepare = action.prepare?.bind(action);
        const execute = action.execute.bind(action);
        const cleanup = action.cleanup?.bind(action);
        cleanupAction = cleanup === undefined ? undefined : () => cleanup(context as ToolActionContext, prepared);
        guard();
        if (authenticate !== undefined) {
          await step("authenticate", () => authenticate(context as ToolActionContext, input));
          guard();
        }
        if (validate !== undefined) {
          const normalized = await step("validate", () => validate(input, context as ToolActionContext));
          guard();
          if (normalized !== undefined) {
            const captured = captureToolValue(normalized, { maxBytes: limits.maxInputBytes + 128, maxDepth: limits.maxJsonDepth + 1, maxKeys: limits.maxJsonKeys + 2 }).value;
            if (typeof captured !== "object" || captured === null || Array.isArray(captured)
              || !Object.hasOwn(captured, "kind") || !Object.hasOwn(captured, "input") || Object.keys(captured).length !== 2
              || !("kind" in captured) || captured.kind !== "normalized" || !("input" in captured)) throw new ToolDispatchFailure("invalid-input");
            const value = captureToolValue(captured.input, { maxBytes: limits.maxInputBytes, maxDepth: limits.maxJsonDepth, maxKeys: limits.maxJsonKeys }).value;
            if (!registration.validateInput(value)) throw new ToolDispatchFailure("invalid-input");
            input = value;
          }
        }
        const resolved = await step("context", () => resolve(input, controller.signal));
        context = captureContext(resolved, callId, registration.definition, registration.implementation, controller.signal, context);
        guard();
        const rawAuthorization = await step("authorize", () => authorize(context as ToolActionContext, input));
        const authorization = toolDispatchAuthorizationSchema.parse(captureToolValue(rawAuthorization, contextLimits).value);
        const decision = authorization.decision;
        const facts: ToolDispatchFacts = {
          caller: context.caller, executor: context.executor, resources: context.resources,
          contract: context.contract, implementation: context.implementation, callId,
          authority: authorization.authority,
        };
        context = captureContext(facts, callId, registration.definition, registration.implementation, controller.signal, context);
        guard();
        if (decision.effect !== "allow") throw new ToolDispatchFailure("denied");
        if (decision.challengeRequired) throw new ToolDispatchFailure("challenge-required");
        if (prepare !== undefined) {
          preparing = true;
          effectPossible = true;
          try {
            await step("prepare", async () => {
              prepared = await prepare(input, context as ToolActionContext, {
                onCleanup: (callback) => {
                  if (!preparing || typeof callback !== "function") throw new TypeError("Cleanup registration is closed.");
                  cleanups.push(callback);
                },
              });
            });
          } finally {
            preparing = false;
          }
          guard();
        }
        effectPossible = true;
        const rawOutput = await step("execute", () => execute(input, context as ToolActionContext, prepared), false);
        guard();
        phase = "output";
        const output = captureToolValue(rawOutput, { maxBytes: limits.maxOutputBytes, maxDepth: limits.maxJsonDepth, maxKeys: limits.maxJsonKeys });
        if (!registration.validateOutput(output.value)) throw new ToolDispatchFailure("invalid-output");
        if (retainedOutputBytes + output.bytes > limits.maxRetainedOutputBytes) throw new ToolDispatchFailure("result-capacity");
        reservedBytes = output.bytes;
        retainedOutputBytes += reservedBytes;
        success = { output: output.value };
        guard();
      } catch (error) {
        primary ??= { code: error instanceof ToolDispatchFailure
          ? error.code
          : phase === "context"
            ? "invalid-context"
            : phase === "output"
              ? "invalid-output"
              : phase === "validate" ? "invalid-input" : "action-failed", phase };
      } finally {
        phase = "cleanup";
        preparing = false;
        if (cleanupAction !== undefined) {
          try {
            await cleanupAction();
          } catch {
            cleanupFailures += 1;
          }
        }
        for (const callback of cleanups.reverse()) {
          try {
            await callback();
          } catch {
            cleanupFailures += 1;
          }
        }
        cleanups.length = 0;
        if (cleanupFailures > 0) primary ??= { code: "cleanup-failed", phase };
        phase = "delivery";
        if (primary === undefined) {
          try {
            deliveryGuard();
          } catch (error) {
            primary = { code: error instanceof ToolDispatchFailure ? error.code : "stale", phase };
          }
        }
        clearTimeout(timer);
        upstream?.removeEventListener("abort", upstreamAbort);
        retainedOutputBytes -= reservedBytes;
        finished = true;
        jobs.delete(callId);
        const outcome: ToolDispatchOutcome<TOutput> = primary === undefined && success !== undefined
          ? Object.freeze({ status: "succeeded", output: success.output, cleanupFailures: 0 as const })
          : failure();
        publish(outcome);
        settled.resolve(outcome);
      }
    }
    void run();
    return handle;
  }

  return Object.freeze({
    dispatch,
    stats: () => ({ active: jobs.size, draining: [...jobs.values()].filter((job) => job.draining()).length, retainedOutputBytes }),
    shutdown: async () => {
      closed = true;
      for (const job of jobs.values()) job.cancel();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all([...jobs.values()].map((job) => job.settled)),
          new Promise<undefined>((resolve) => {
            timer = setTimeout(() => {
              resolve(undefined);
            }, limits.shutdownWaitMs);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      return { draining: jobs.size };
    },
  });
}
