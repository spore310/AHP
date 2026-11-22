import type { AhpTransport, TransportFrame } from "@microsoft/agent-host-protocol/client";
import { expect, it, vi } from "vitest";

import { defineToolContract } from "@tools";
import { ToolInvocationTransport } from "@toolClient/transport";
import { privateWireFixture } from "../toolExecution/privateWireFixture";

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
  const transport = new ToolInvocationTransport(inner);
  const execute = vi.fn(() => ({ ok: true }));
  transport.stage("ahp-session:/test", "registration", [{ definition, execute }], privateWireFixture(definition, "ahp-session:/test").assigned);
  transport.activate("ahp-session:/test", "registration", privateWireFixture(definition, "ahp-session:/test").acknowledgement);

  await expect(transport.recv()).resolves.toEqual(requestFrame);
  expect(execute).not.toHaveBeenCalled();
  expect(sent).toEqual([]);
  await transport.close();
});
