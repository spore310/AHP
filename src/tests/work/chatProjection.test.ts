import { MessageKind } from "@microsoft/agent-host-protocol";
import { expect, it, vi } from "vitest";
import { createWorkChatProjection } from "@work/helpers/chatProjection";
import type { WorkChatProjectionInput, WorkChatMessage } from "@work/helpers/chatProjection";

function input(): WorkChatProjectionInput {
  const session = { domainId: "demo", kind: "session" as const, id: "room", instanceId: crypto.randomUUID() };
  const id = crypto.randomUUID(), at = new Date(0).toISOString();
  return { chat: { ...session, kind: "chat", id: "chat" }, signal: new AbortController().signal,
    recipient: { actor: { kind: "user", principal: { domainId: "demo", subject: "reader" } }, connectionId: "reader", authRevision: "1" },
    event: { version: 1, session, workId: id, revision: "2", type: "completed", occurredAt: at },
    work: { id, session, revision: "2", createdAt: at, updatedAt: at, kind: "review", status: "completed", priority: 0 } };
}
it("hands only a bounded system notification to the consuming application", async () => {
  const deliver = vi.fn();
  const f = input();
  const projection = createWorkChatProjection({ deliver });
  await expect(projection.present(f, () => true)).resolves.toBe(true);
  expect(deliver.mock.calls[0]?.[0]).toEqual({ text: "review: completed", origin: { kind: MessageKind.SystemNotification }, _meta: { workId: f.work.id, revision: "2" } });
  const forged = createWorkChatProjection({ adapter: { project: () => ({ text: "untrusted", origin: { kind: MessageKind.User } } as unknown as WorkChatMessage) }, deliver });
  await expect(forged.present(f, () => true)).resolves.toBe(false);
  expect(deliver).toHaveBeenCalledOnce();
});
it("rechecks the recipient after an asynchronous formatter and discards withdrawn output", async () => {
  const entered = Promise.withResolvers<undefined>();
  const finish = Promise.withResolvers<WorkChatMessage>();
  const deliver = vi.fn();
  const projection = createWorkChatProjection({ deliver, adapter: { project() {
    entered.resolve(undefined);
    return finish.promise;
  } } });
  let allowed = true;
  const result = projection.present(input(), () => allowed);
  await entered.promise;
  allowed = false;
  finish.resolve({ origin: { kind: MessageKind.SystemNotification }, text: "reviewed" });
  expect(await result).toBe(false);
  expect(deliver).not.toHaveBeenCalled();
});

it("bounds a formatter that ignores a deadline and never delivers its late output", async () => {
  vi.useFakeTimers();
  const parked = Promise.withResolvers<WorkChatMessage>();
  const project = vi.fn(() => parked.promise), deliver = vi.fn();
  const projection = createWorkChatProjection({ adapter: { project }, deliver, maxPending: 1, timeoutMs: 10 });
  try {
    const first = projection.present(input(), () => true);
    await vi.advanceTimersByTimeAsync(11);
    expect(await first).toBe(false);
    expect(await projection.present(input(), () => true)).toBe(false);
    expect(project).toHaveBeenCalledOnce();
    projection.dispose();
    parked.resolve({ text: "late", origin: { kind: MessageKind.SystemNotification } });
    await vi.advanceTimersByTimeAsync(100);
    expect(deliver).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("rejects oversized output and prevents a formatter's edits from altering the authorized handoff", async () => {
  const f = input();
  const deliver = vi.fn();
  const message = { origin: { kind: MessageKind.SystemNotification } } as const;
  const large = createWorkChatProjection({ deliver, adapter: { project: () => ({ ...message, text: "x".repeat(3000) }) } });
  expect(await large.present(f, () => true)).toBe(false);
  const guarded = createWorkChatProjection({ deliver, adapter: { project(facts) {
    Object.assign(facts.recipient.actor.principal, { subject: "changed" });
    return { ...message, text: "Reviewed" };
  } } });
  expect(await guarded.present(f, () => true)).toBe(true);
  expect(deliver.mock.calls[0]?.[1]).toMatchObject({ recipient: { actor: { principal: { subject: "reader" } } } });
  expect(f.recipient.actor.principal.subject).toBe("reader");
});
