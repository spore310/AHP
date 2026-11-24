import { MessageKind } from "@microsoft/agent-host-protocol";
import { z } from "zod";
import { sameResource } from "@authorization/helpers/context";
import { captureValue } from "@jsonrpc/value";
import type { WorkChatMessage, WorkChatPresentation, WorkChatProjectionInput, WorkChatProjectionOptions } from "./types";

function printable(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) return false;
  }
  return true;
}
const message = z.strictObject({ text: z.string().min(1).max(2048).refine(printable),
  origin: z.strictObject({ kind: z.literal(MessageKind.SystemNotification) }), _meta: z.record(z.string(), z.unknown()).optional() });

export function createWorkChatProjection(options: WorkChatProjectionOptions): WorkChatPresentation & { dispose(): void } {
  const pending = new Set<AbortController>();
  const limit = options.maxPending ?? 32, timeout = options.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64 || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 5000) throw new RangeError("Invalid chat projection limits.");
  const project = options.adapter?.project.bind(options.adapter);
  const deliver: (value: WorkChatMessage, input: WorkChatProjectionInput) => unknown = options.deliver.bind(options);
  let closed = false;
  return {
    async present(input, authorized) {
      if (closed || pending.size >= limit || input.signal.aborted) return false;
      const { event, work, chat, recipient } = input;
      if (!z.literal("chat").safeParse(chat.kind).success || event.workId !== work.id || event.revision !== work.revision || !sameResource(event.session, work.session)
        || chat.domainId !== work.session.domainId || recipient.actor.principal.domainId !== chat.domainId) return false;
      const controller = new AbortController();
      pending.add(controller);
      const signal = AbortSignal.any([input.signal, controller.signal]);
      const stopped = Promise.withResolvers<undefined>();
      const cancel = () => {
        stopped.resolve(undefined);
      };
      signal.addEventListener("abort", cancel, { once: true });
      const deadline = performance.now() + timeout;
      const timer = setTimeout(() => {
        controller.abort();
      }, timeout);
      const current = () => !closed && !signal.aborted && performance.now() < deadline;
      const active = () => current() && authorized() && current();
      let started = false;
      try {
        if (!active()) return false;
        const detached = structuredClone({ chat, event, work, recipient });
        const facts = { ...structuredClone(detached), signal };
        const operation = Promise.resolve().then(() => {
          if (!active()) return undefined;
          return project
            ? project(facts)
            : { text: work.kind + ": " + work.status, origin: { kind: MessageKind.SystemNotification },
                _meta: { workId: work.id, revision: work.revision } };
        }).finally(() => pending.delete(controller));
        started = true;
        const result = await Promise.race([operation, stopped.promise]);
        if (!result || !active()) return false;
        const value: WorkChatMessage = message.parse(captureValue(result, { maxBytes: 8192, maxDepth: 8, maxKeys: 128, postgres: true }).value);
        if (!active()) return false;
        const delivery: unknown = deliver(value, { ...detached, signal });
        void Promise.resolve(delivery).catch(() => undefined);
        return true;
      } catch { return false; } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        controller.abort();
        if (!started) pending.delete(controller);
      }
    },
    dispose() {
      closed = true;
      for (const controller of pending) controller.abort();
    },
  };
}
