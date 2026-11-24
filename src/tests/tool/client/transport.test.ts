import type { AhpTransport, TransportFrame } from "@microsoft/agent-host-protocol/client";
import { expect, it, vi } from "vitest";

import { parseUnknownJson } from "@jsonrpc";
import { z } from "zod";
import { defineToolContract } from "@tool";
import { ClientTransport } from "@client/transport";
import { ToolTestEndpoint } from "./inputEndpoint";
import { privateWireFixture } from "../execution/privateWireFixture";

const definition = defineToolContract({
  id: "11111111-1111-4111-8111-111111111111",
  key: "test.echo",
  version: 1,
  name: "echo",
  schemaDialect: "draft-07",
  inputSchema: { type: "object" },
});

it("does not execute a request-shaped invoke frame", async () => {
  const requestFrame: TransportFrame = {
    kind: "text",
    text: JSON.stringify({
      jsonrpc: "2.0",
      id: "not-a-notification",
      method: "x-ahp/tools/invoke",
      params: { callId: "call-id", channel: "ahp-session:/test", key: definition.key, version: 1, input: {} },
    }),
  };
  const inbound: TransportFrame[] = [requestFrame];
  const sent: Array<unknown> = [];
  const inner: AhpTransport = {
    send: (message) => {
      sent.push(message);
    },
    recv: () => Promise.resolve(inbound.shift() ?? null),
    close: () => undefined,
  };
  const transport = new ToolTestEndpoint(inner);
  const execute = vi.fn(() => ({ ok: true }));
  transport.tools.stage("ahp-session:/test", "registration", [{ definition, execute }], privateWireFixture(definition, "ahp-session:/test").assigned);
  transport.tools.activate("ahp-session:/test", "registration", privateWireFixture(definition, "ahp-session:/test").acknowledgement);

  await expect(transport.recv()).resolves.toEqual(requestFrame);
  expect(execute).not.toHaveBeenCalled();
  expect(sent).toEqual([]);
  await transport.close();
});

it("routes notifications and cancelled private replies on the SDK reader while forwarding native frames", async () => {
  const inbound: TransportFrame[] = [];
  const sent: string[] = [];
  const transport = new ClientTransport({ recv: () => Promise.resolve(inbound.shift() ?? null),
    send(message) {
      if (typeof message === "string") sent.push(message);
    }, close() {} });
  const method = "x-ahp/work/changed";
  const heard = vi.fn();
  const rejecting = () => Promise.reject(new Error("observer failed"));
  const remove = transport.onNotification(method, rejecting);
  expect(() => transport.onNotification(method, heard)).toThrow();
  const releases: unknown[] = [], signal = new AbortController();
  const released = (response: unknown) => {
    releases.push(response);
    return Promise.reject(new Error("release failed"));
  };
  const pending = transport.request("x-ahp/work/subscribe", {}, { timeoutMs: 1000, signal: signal.signal, releaseLate: released });
  signal.abort();
  await expect(pending).rejects.toThrow("cancelled");
  const id = z.object({ id: z.string() }).parse(parseUnknownJson(sent[0] ?? "null"));
  const frame = (body: object): TransportFrame => ({ kind: "text", text: JSON.stringify({ jsonrpc: "2.0", ...body }) });
  const native = frame({ method: "action", params: { announced: true } });
  inbound.push(frame({ method, params: { revision: "2" } }), frame({ id: id.id, result: { subscriptionId: "late-id" } }), native);
  expect(await transport.recv()).toEqual(native);
  await new Promise<void>((resolve) => setImmediate(resolve));
  remove();
  transport.onNotification(method, heard);
  inbound.push(frame({ method, params: { revision: "3" } }), native);
  expect(await transport.recv()).toEqual(native);
  expect(heard).toHaveBeenCalledExactlyOnceWith({ revision: "3" });
  expect(releases).toEqual([{ subscriptionId: "late-id" }]);
  const close = vi.fn(() => {
    void transport.close();
  });
  transport.addCleanup(close);
  await transport.close();
  expect(close).toHaveBeenCalledOnce();
});
