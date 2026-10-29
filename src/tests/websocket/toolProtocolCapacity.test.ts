import { afterEach, expect, it, vi } from "vitest";
import { createPrivateToolProtocol } from "@websocket/helpers/ahp/helpers/toolProtocol";
import type { PrivateToolProtocol } from "@websocket/helpers/ahp/helpers/toolProtocol";
import type { JsonRpcInvocation, ReplySettlement, WebSocketConnectionContext } from "@websocket/types";
import { parseToolWire, toolAssignedReplySchema } from "@toolExecution/helpers/client/helpers/protocol";

// Adapter-state bounds only. These deterministic ports are not policy/public-host proof.
const services: PrivateToolProtocol[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
});
const context = (id: number): WebSocketConnectionContext => ({ connectionId: "connection-" + String(id),
  connectionGeneration: 1, send: () => true, close: vi.fn(), onClose: () => undefined });
const setup = () => {
  const service = createPrivateToolProtocol({ ready: () => true, fence: () => true,
    assignment: (context, channel) => Promise.resolve({ value: {
      resource: { domainId: "local", kind: "session", id: channel, instanceId: channel },
      connection: { id: context.connectionId, generation: 1 }, tools: [],
    }, current: () => true, fence: () => true,
    advertise: () => ({ tools: [], current: () => true, commit: () => true, release: () => undefined }) }),
    dispatch: () => {
      throw new Error("Not an execution test");
    }, onInvalidate: () => () => undefined,
  });
  services.push(service);
  const call = async (method: string, params: { version: number; channel?: string; viewRevision?: string; contracts?: [] }, peer: WebSocketConnectionContext) => {
    const handler = service.handlers["x-ahp/tools/" + method];
    if (handler === undefined) throw new Error("Missing handler");
    const listeners: Array<(settlement: ReplySettlement) => void> = [];
    let guard = () => true;
    const invocation: JsonRpcInvocation = { kind: "request", guardReply: (callback) => {
      guard = callback;
    }, onReplySettled: (listener) => {
      listeners.push(listener);
    } };
    const reply: unknown = await handler(params, peer, invocation);
    return { reply, finish: (sent = true) => {
      const responseSent = sent && guard();
      for (const listener of listeners) listener({ responseSent, outcome: responseSent ? "success" : "failure" });
      return responseSent;
    } };
  };
  return { service, call };
};

it("reserves the final negotiation slot before concurrent responses settle", async () => {
  const { service, call } = setup();
  const peers = Array.from({ length: 1026 }, (_, index) => context(index));
  for (const peer of peers.slice(0, 1023)) expect((await call("capabilities", { version: 2 }, peer)).finish()).toBe(true);
  const first = peers[1023], second = peers[1024], occupied = peers[0];
  if (first === undefined || second === undefined || occupied === undefined) throw new Error("Missing peers");
  const pending = await call("capabilities", { version: 2 }, first);
  await expect(call("capabilities", { version: 2 }, second)).rejects.toThrow("unavailable");
  pending.finish(false);
  expect((await call("capabilities", { version: 2 }, second)).finish()).toBe(true);
  expect((await call("capabilities", { version: 2 }, occupied)).finish()).toBe(true);
  await expect(call("capabilities", { version: 2 }, first)).rejects.toThrow("unavailable");
  service.forget(occupied);
  expect((await call("capabilities", { version: 2 }, first)).finish()).toBe(true);
});

it("refreshes at per-peer/global view capacity and preserves prior views on failed acknowledgement", async () => {
  const { call } = setup();
  const peers = Array.from({ length: 9 }, (_, index) => context(index));
  let firstRevision = "";
  const channel = "ahp-session:/view-0";
  for (const peer of peers) expect((await call("capabilities", { version: 2 }, peer)).finish()).toBe(true);
  for (const peer of peers.slice(0, 8)) for (let index = 0; index < 128; index += 1) {
    const response = await call("assigned", { version: 2, channel: "ahp-session:/view-" + String(index) }, peer);
    expect(response.finish()).toBe(true);
    if (peer === peers[0] && index === 0) firstRevision = parseToolWire(toolAssignedReplySchema, response.reply).viewRevision;
  }
  const first = peers[0], extra = peers[8];
  if (first === undefined || extra === undefined) throw new Error("Missing peers");
  await expect(call("assigned", { version: 2, channel }, extra)).rejects.toThrow("unavailable");
  const failed = await call("assigned", { version: 2, channel }, first);
  failed.finish(false);
  expect((await call("advertise", { version: 2, channel, viewRevision: firstRevision, contracts: [] }, first)).finish()).toBe(true);
  const refreshed = await call("assigned", { version: 2, channel }, first);
  expect(refreshed.finish()).toBe(true);
  expect(parseToolWire(toolAssignedReplySchema, refreshed.reply).viewRevision).not.toBe(firstRevision);
  await expect(call("advertise", { version: 2, channel, viewRevision: firstRevision, contracts: [] }, first)).rejects.toThrow("unavailable");
  const pending = [];
  for (let index = 0; index < 64; index += 1) pending.push(await call("assigned", { version: 2, channel }, first));
  await expect(call("assigned", { version: 2, channel }, first)).rejects.toThrow("unavailable");
  for (const response of pending) response.finish(false);
  expect((await call("assigned", { version: 2, channel }, first)).finish()).toBe(true);
});
