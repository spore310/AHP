import { captureToolValue } from "@toolExecution/helpers/value";
import type { ChallengeContinuation } from "@toolExecution/types";
import { challengeContinuationSchema, challengeVerificationSchema } from "./types";
import type { ToolChallengeHandle, ToolChallengeLimits, ToolChallengeOptions, ToolChallenges } from "./types";

const defaults: ToolChallengeLimits = { maxPending: 64, maxPerActor: 16, maxMetadataBytes: 4096, maxProofBytes: 1024, ttlMs: 30000, hookTimeoutMs: 5000 };
const maximum: ToolChallengeLimits = { maxPending: 1024, maxPerActor: 256, maxMetadataBytes: 16384, maxProofBytes: 4096, ttlMs: 120000, hookTimeoutMs: 60000 };

/** Memory-only adapter ownership. A terminal result never implies adapter termination. */
export function createToolChallenges(options: ToolChallengeOptions, now: () => number, fenceNow: () => number): ToolChallenges {
  const limits = { ...defaults, ...options.limits };
  if (Object.keys(limits).some((key) => !Object.hasOwn(defaults, key))) throw new TypeError("Unknown challenge limit.");
  for (const key of Object.keys(defaults) as Array<keyof ToolChallengeLimits>) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > maximum[key]) throw new TypeError("Invalid challenge limit.");
  }
  const begin = options.adapter.begin.bind(options.adapter);
  const verify = options.adapter.verify.bind(options.adapter);
  const cancel = options.adapter.cancel?.bind(options.adapter);
  const approve = options.approvePresentation?.bind(options);
  const records = new Set<ToolChallengeHandle>();
  const actors = new Map<string, number>();
  let closed = false;
  let lastTime = Number.NEGATIVE_INFINITY;
  const read = (clock: () => number): number => {
    const time = clock();
    if (!Number.isFinite(time) || time < lastTime) throw new TypeError("Invalid challenge clock.");
    lastTime = time;
    return time;
  };
  const invalidate = (): void => {
    for (const record of [...records]) record.cancel();
  };
  return Object.freeze<ToolChallenges>({
    open(request) {
      const { context } = request;
      const actor = JSON.stringify(context.caller.actor);
      const current = request.current.bind(request);
      const time = read(now);
      if (closed || context.signal.aborted || records.size >= limits.maxPending || (actors.get(actor) ?? 0) >= limits.maxPerActor) return undefined;
      let deadline = Math.min(request.deadline, time + limits.ttlMs);
      if (!Number.isFinite(deadline) || deadline <= time) return undefined;
      const ready = Promise.withResolvers<ChallengeContinuation | undefined>();
      const verified = Promise.withResolvers<boolean>();
      const settled = Promise.withResolvers<undefined>();
      let state: "beginning" | "pending" | "verifying" | "consumed" | "cancelled" = "beginning";
      let operationDeadline = Math.min(deadline, time + limits.hookTimeoutMs);
      let adapterId: string | undefined;
      let cancelStarted = false;
      let work = 0;
      let released = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const terminal = (): boolean => state === "consumed" || state === "cancelled";
      const release = (): void => {
        if (released || !terminal() || work !== 0) return;
        released = true;
        records.delete(handle);
        const count = (actors.get(actor) ?? 1) - 1;
        if (count === 0) actors.delete(actor);
        else actors.set(actor, count);
        clearTimeout(timer);
        context.signal.removeEventListener("abort", abort);
        settled.resolve(undefined);
      };
      const invokeCancel = (): void => {
        if (cancelStarted || adapterId === undefined || cancel === undefined) return;
        cancelStarted = true;
        work += 1;
        const id = adapterId;
        void Promise.resolve().then(() => cancel(id)).catch(() => undefined).finally(() => {
          work -= 1;
          release();
        });
      };
      const finish = (success: boolean): void => {
        if (terminal()) return;
        state = success ? "consumed" : "cancelled";
        clearTimeout(timer);
        ready.resolve(undefined);
        verified.resolve(success);
        if (!success) invokeCancel();
        release();
      };
      const abort = (): void => {
        finish(false);
      };
      const stopped = (): boolean => closed || context.signal.aborted;
      const live = (expected: typeof state): boolean => {
        try {
          const activeDeadline = expected === "pending" ? deadline : Math.min(deadline, operationDeadline);
          if (state !== expected || closed || context.signal.aborted || read(now) >= activeDeadline) return false;
          const verdict: unknown = current();
          if (verdict !== true) {
            void Promise.resolve(verdict).catch(() => undefined);
            return false;
          }
          return read(fenceNow) < activeDeadline && state === expected && !stopped();
        } catch {
          return false;
        }
      };
      const run = async <T>(callback: () => T | Promise<T>): Promise<T | undefined> => {
        work += 1;
        let hookTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          hookTimer = setTimeout(abort, limits.hookTimeoutMs);
          return await callback();
        } catch {
          finish(false);
          return undefined;
        } finally {
          clearTimeout(hookTimer);
          work -= 1;
          release();
        }
      };
      const handle: ToolChallengeHandle = Object.freeze({
        ready: ready.promise, verified: verified.promise, settled: settled.promise,
        cancel: abort,
        pendingFence: () => {
          try {
            return read(fenceNow) < deadline && state === "pending" && !stopped();
          } catch {
            return false;
          }
        },
        fence: () => {
          try {
            return read(fenceNow) < deadline && state === "consumed" && !closed && !context.signal.aborted;
          } catch {
            return false;
          }
        },
        async resume(proofRef: string) {
          if (!live("pending")) {
            if (!terminal() && state !== "verifying") finish(false);
            return false;
          }
          if (typeof proofRef !== "string" || proofRef.length === 0 || proofRef.length > limits.maxProofBytes
            || new TextEncoder().encode(proofRef).byteLength > limits.maxProofBytes) {
            finish(false);
            return false;
          }
          // Consume the sole attempt synchronously, before the trusted callback or any await.
          operationDeadline = Math.min(deadline, read(fenceNow) + limits.hookTimeoutMs);
          state = "verifying";
          const running = run(async () => {
            if (!live("verifying") || adapterId === undefined) {
              finish(false);
              return;
            }
            const result = challengeVerificationSchema.parse(captureToolValue(await verify({ continuationId: adapterId, proofRef }),
              { maxBytes: limits.maxMetadataBytes, maxDepth: 4, maxKeys: 16 }).value);
            if (result.status !== "verified" || result.continuationId !== adapterId || !live("verifying")) {
              finish(false);
              return;
            }
            finish(true);
          });
          void running;
          return verified.promise;
        },
      });
      records.add(handle);
      actors.set(actor, (actors.get(actor) ?? 0) + 1);
      timer = setTimeout(abort, Math.max(1, deadline - time));
      context.signal.addEventListener("abort", abort, { once: true });
      // Work reserves its slot synchronously; begin may invoke reentrant host callbacks.
      void run(async () => {
        if (!live("beginning")) {
          finish(false);
          return;
        }
        const raw = await begin(context);
        const result = challengeContinuationSchema.parse(captureToolValue(raw,
          { maxBytes: limits.maxMetadataBytes, maxDepth: 4, maxKeys: 16 }).value);
        adapterId = result.continuationId;
        if (terminal()) {
          invokeCancel();
          return;
        }
        const presentation = result.presentation;
        if (presentation.kind === "redirect") {
          const url = new URL(presentation.url);
          if (url.username !== "" || url.password !== "") {
            finish(false);
            return;
          }
        }
        if (presentation.kind !== "wait" || presentation.message !== undefined) {
          const approved: unknown = approve?.(presentation);
          if (approved !== true) {
            void Promise.resolve(approved).catch(() => undefined);
            finish(false);
            return;
          }
        }
        deadline = Math.min(deadline, Date.parse(result.expiresAt));
        if (!live("beginning")) {
          finish(false);
          return;
        }
        const continuation = Object.freeze({ continuationId: crypto.randomUUID(), expiresAt: new Date(deadline).toISOString(), presentation });
        clearTimeout(timer);
        timer = setTimeout(abort, Math.max(1, deadline - read(fenceNow)));
        if (!live("beginning")) {
          finish(false);
          return;
        }
        state = "pending";
        ready.resolve(continuation);
      });
      return handle;
    },
    invalidate,
    dispose() {
      closed = true;
      invalidate();
    },
    stats: () => ({ pending: records.size }),
  });
}
