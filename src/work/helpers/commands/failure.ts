import { z } from "zod";
import { isPortableText } from "@persistence";
import type { WorkAuthorityLossOptions, WorkServiceHooks } from "../authorityLoss/types";

const fallback = Object.freeze({ code: "execution_failed", summary: "Work execution failed." });
const result = z.strictObject({ code: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/),
  summary: z.string().trim().min(1).max(512).refine((s) => isPortableText(s) && !/\p{Cc}/u.test(s)) });

/** A timeout ends the public wait. Only callback settlement returns its capacity. */
export function createFailureFormatter(options?: Pick<WorkAuthorityLossOptions, "hooks" | "deadlineMs" | "maxPending">) {
  const callback = options?.hooks.formatFailure?.bind(options.hooks);
  const pending = new Set<AbortController>();
  let closed = false;
  return {
    async format(input: Omit<Parameters<NonNullable<WorkServiceHooks["formatFailure"]>>[0], "signal">, signal: AbortSignal) {
      if (!callback || closed || signal.aborted || pending.size >= (options?.maxPending ?? 32)) return fallback;
      const controller = new AbortController();
      pending.add(controller);
      const combined = AbortSignal.any([controller.signal, signal]);
      const stop = Promise.withResolvers<typeof fallback>();
      const abort = () => {
        stop.resolve(fallback);
      };
      combined.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => {
        controller.abort();
      }, options?.deadlineMs ?? 5000);
      try {
        const settled = Promise.resolve().then(() => callback(Object.freeze({ ...input, reported: Object.freeze({ ...input.reported }), signal: combined })))
          .then((output) => result.safeParse(output).data ?? fallback).catch(() => fallback).finally(() => pending.delete(controller));
        return await Promise.race([settled, stop.promise]);
      } finally {
        clearTimeout(timer);
        combined.removeEventListener("abort", abort);
      }
    },
    close() {
      closed = true;
      for (const controller of pending) controller.abort();
    },
  };
}
