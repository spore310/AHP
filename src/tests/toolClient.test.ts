import type { AhpTransport, TransportFrame } from "@microsoft/agent-host-protocol/client";
import { describe, expect, it, vi } from "vitest";

import { parseUnknownJson } from "@jsonrpc";
import { defineToolContract } from "@tools";
import { ToolInvocationTransport } from "@toolClient/transport";
import { privateWireFixture } from "./toolExecution/privateWireFixture";

const definition = defineToolContract({
  id: "11111111-1111-4111-8111-111111111111",
  key: "example.echo",
  version: 1,
  name: "echo",
  schemaDialect: "draft-07",
  inputSchema: { type: "object" },
});

class FakeTransport implements AhpTransport {
  readonly sent: Array<Parameters<AhpTransport["send"]>[0]> = [];
  private readonly incoming: TransportFrame[] = [];
  private readonly readers: Array<(frame: TransportFrame | null) => void> = [];

  send(message: Parameters<AhpTransport["send"]>[0]): void {
    this.sent.push(message);
  }

  recv(): Promise<TransportFrame | null> {
    const frame = this.incoming.shift();
    if (frame !== undefined) return Promise.resolve(frame);
    return new Promise((resolve) => this.readers.push(resolve));
  }

  close(): Promise<void> {
    for (const resolve of this.readers.splice(0)) resolve(null);
    return Promise.resolve();
  }

  push(message: unknown): void {
    const frame: TransportFrame = { kind: "text", text: JSON.stringify(message) };
    const resolve = this.readers.shift();
    if (resolve === undefined) this.incoming.push(frame);
    else resolve(frame);
  }
}

function sentMessage(message: Parameters<AhpTransport["send"]>[0]): Record<string, unknown> {
  const text = typeof message === "string" ? message : JSON.stringify(message);
  const parsed = parseUnknownJson(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Expected an object JSON-RPC message.");
  }
  return parsed as Record<string, unknown>;
}

describe("tool invocation SDK transport", () => {
  it("uses isolated UUID string request IDs and correlates multiple calls", async () => {
    const inner = new FakeTransport();
    const transport = new ToolInvocationTransport(inner);
    const first = transport.request("x-ahp/tools/dispatch", { version: 2, channel: "ahp-session:/example", contract: { id: definition.id, key: definition.key, version: 1 }, input: {} });
    const second = transport.request("x-ahp/tools/dispatch", { version: 2, channel: "ahp-session:/example", contract: { id: definition.id, key: definition.key, version: 1 }, input: {} });
    const requests = inner.sent.map(sentMessage).filter((message) => message.method === "x-ahp/tools/dispatch");
    const firstId = requests[0]?.id;
    const secondId = requests[1]?.id;
    expect(firstId).toEqual(expect.stringMatching(/^x-ahp-tool:[0-9a-f-]{36}$/));
    expect(secondId).toEqual(expect.stringMatching(/^x-ahp-tool:[0-9a-f-]{36}$/));
    expect(firstId).not.toBe(secondId);

    const reader = transport.recv();
    inner.push({ jsonrpc: "2.0", id: firstId, result: { result: "first" } });
    inner.push({ jsonrpc: "2.0", id: secondId, result: { result: "second" } });
    inner.push({ jsonrpc: "2.0", method: "ordinary", params: {} });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { result: "first" },
      { result: "second" },
    ]);
    const ordinary = await reader;
    expect(ordinary?.kind).toBe("text");
    if (ordinary?.kind === "text") expect(ordinary.text).toContain("ordinary");
    await transport.close();
  });

  it("executes only valid JSON-RPC 2.0 invoke notifications", async () => {
    const inner = new FakeTransport();
    const transport = new ToolInvocationTransport(inner);
    const execute = vi.fn(() => ({ result: "executed" }));
    transport.stage("ahp-session:/example", "registration", [{ definition, execute }], privateWireFixture(definition, "ahp-session:/example").assigned);
    transport.activate("ahp-session:/example", "registration", privateWireFixture(definition, "ahp-session:/example").acknowledgement);

    const invokeParams = privateWireFixture(definition, "ahp-session:/example").invoke();
    const requestShaped: TransportFrame = {
      kind: "text",
      text: JSON.stringify({ jsonrpc: "2.0", id: "request", method: "x-ahp/tools/invoke", params: invokeParams }),
    };
    inner.push(parseUnknownJson(requestShaped.text));
    await expect(transport.recv()).resolves.toEqual(requestShaped);
    expect(execute).not.toHaveBeenCalled();

    const wrongVersion: TransportFrame = {
      kind: "text",
      text: JSON.stringify({ jsonrpc: "1.0", method: "x-ahp/tools/invoke", params: invokeParams }),
    };
    inner.push(parseUnknownJson(wrongVersion.text));
    await expect(transport.recv()).resolves.toEqual(wrongVersion);
    expect(execute).not.toHaveBeenCalled();

    const completionSent = Promise.withResolvers<undefined>();
    const originalSend = inner.send.bind(inner);
    vi.spyOn(inner, "send").mockImplementation((message) => {
      const parsed = sentMessage(message);
      if (parsed.method === "x-ahp/tools/complete") completionSent.resolve(undefined);
      originalSend(message);
    });
    inner.push({ jsonrpc: "2.0", method: "x-ahp/tools/invoke", params: invokeParams });
    inner.push({ jsonrpc: "2.0", method: "ordinary", params: {} });
    const ordinary = await transport.recv();
    expect(ordinary?.kind).toBe("text");
    if (ordinary?.kind === "text") expect(ordinary.text).toContain("ordinary");
    await completionSent.promise;
    expect(execute).toHaveBeenCalledOnce();
    await transport.close();
  });
});
