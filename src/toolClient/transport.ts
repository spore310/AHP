import type { AhpTransport, TransportFrame } from "@microsoft/agent-host-protocol/client";

import { parseUnknownJson } from "@jsonrpc";

import type { LocalToolImplementation } from "./types";

interface InvokeParams {
  readonly callId: string;
  readonly channel: string;
  readonly key: string;
  readonly version: number;
  readonly input: unknown;
}

/** Intercepts the opt-in extension while forwarding all standard SDK frames. */
export class ToolInvocationTransport implements AhpTransport {
  private readonly implementations = new Map<string, Map<string, LocalToolImplementation>>();
  private readonly stagedImplementations = new Map<string, Map<string, Map<string, LocalToolImplementation>>>();
  private readonly queuedInvocations: InvokeParams[] = [];
  private readonly requests = new Map<string, {
    readonly timer: ReturnType<typeof setTimeout>;
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>();

  constructor(private readonly inner: AhpTransport) {}

  async send(message: Parameters<AhpTransport["send"]>[0]): Promise<void> {
    await this.inner.send(message);
  }

  async recv(): Promise<TransportFrame | null> {
    for (;;) {
      const frame = await this.inner.recv();
      if (frame === null) {
        this.rejectRequests("Tool invocation transport closed.");
        return null;
      }
      if (frame.kind !== "text") return frame;
      const parsed: unknown = parseFrame(frame.text);
      if (!isRecord(parsed)) return frame;
      if ((typeof parsed.id === "string" || typeof parsed.id === "number") && this.requests.has(String(parsed.id))) {
        const requestId = String(parsed.id);
        const pending = this.requests.get(requestId);
        this.requests.delete(requestId);
        if (pending !== undefined) {
          clearTimeout(pending.timer);
          if (isRecord(parsed.error)) pending.reject(new Error("Tool invocation failed."));
          else pending.resolve(parsed.result);
        }
        continue;
      }
      if (parsed.jsonrpc !== "2.0" || Object.hasOwn(parsed, "id") || parsed.method !== "x-ahp/tools/invoke") return frame;
      const invoke = parseInvoke(parsed.params);
      if (invoke === undefined) continue;
      const identity = refKey(invoke.key, invoke.version);
      const hasActiveImplementation = this.implementations.get(invoke.channel)?.has(identity) === true;
      const hasStagedImplementation = [...(this.stagedImplementations.get(invoke.channel)?.values() ?? [])]
        .some((candidate) => candidate.has(identity));
      if (!hasActiveImplementation && hasStagedImplementation && this.queuedInvocations.length < 64) {
        this.queuedInvocations.push(invoke);
      } else {
        void this.execute(invoke);
      }
    }
  }

  async close(): Promise<void> {
    this.rejectRequests("Tool invocation transport closed.");
    await this.inner.close();
  }

  requestCall(params: { readonly channel: string; readonly key: string; readonly version: number; readonly input: unknown }): Promise<unknown> {
    const id = `x-ahp-tool-call:${globalThis.crypto.randomUUID()}`;
    const message = JSON.stringify({ jsonrpc: "2.0", id, method: "x-ahp/tools/call", params });
    return new Promise<unknown>((resolve, reject) => {
      const requestKey = id;
      const timer = setTimeout(() => {
        this.requests.delete(requestKey);
        reject(new Error("Tool invocation timed out."));
      }, 35_000);
      this.requests.set(requestKey, { timer, resolve, reject });
      void Promise.resolve(this.inner.send(message)).catch((error: unknown) => {
        const pending = this.requests.get(requestKey);
        this.requests.delete(requestKey);
        if (pending !== undefined) clearTimeout(pending.timer);
        reject(error instanceof Error ? error : new Error("Tool invocation send failed."));
      });
    });
  }

  private rejectRequests(message: string): void {
    for (const [id, pending] of this.requests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
      this.requests.delete(id);
    }
  }

  stage(channel: string, token: string, tools: readonly LocalToolImplementation[]): void {
    const staged = this.stagedImplementations.get(channel) ?? new Map<string, Map<string, LocalToolImplementation>>();
    staged.set(token, new Map(tools.map((tool) => [refKey(tool.definition.key, tool.definition.version), tool])));
    this.stagedImplementations.set(channel, staged);
  }

  activate(channel: string, token: string): void {
    const staged = this.stagedImplementations.get(channel);
    if (staged === undefined) throw new Error("Tool registration staging was lost.");
    const candidate = staged.get(token);
    if (candidate === undefined) throw new Error("Tool registration staging was lost.");
    this.implementations.set(channel, candidate);
    staged.delete(token);
    if (staged.size === 0) this.stagedImplementations.delete(channel);
    this.flushQueuedInvocations(channel);
  }

  discard(channel: string, token: string): void {
    const staged = this.stagedImplementations.get(channel);
    staged?.delete(token);
    if (staged !== undefined && staged.size === 0) this.stagedImplementations.delete(channel);
    this.flushQueuedInvocations(channel);
  }

  private flushQueuedInvocations(channel: string): void {
    const retained: InvokeParams[] = [];
    for (const invoke of this.queuedInvocations) {
      if (invoke.channel === channel) void this.execute(invoke);
      else retained.push(invoke);
    }
    this.queuedInvocations.splice(0, this.queuedInvocations.length, ...retained);
  }

  private async execute(invoke: InvokeParams): Promise<void> {
    const identity = refKey(invoke.key, invoke.version);
    const implementation = this.implementations.get(invoke.channel)?.get(identity);
    let completion: Record<string, unknown>;
    if (implementation === undefined) {
      completion = { callId: invoke.callId, channel: invoke.channel, key: invoke.key, version: invoke.version, error: "Tool implementation unavailable." };
    } else {
      try {
        const output: unknown = await implementation.execute(invoke.input, {
          callId: invoke.callId,
          channel: invoke.channel,
          key: invoke.key,
          version: invoke.version,
        });
        completion = { callId: invoke.callId, channel: invoke.channel, key: invoke.key, version: invoke.version, output };
      } catch {
        completion = { callId: invoke.callId, channel: invoke.channel, key: invoke.key, version: invoke.version, error: "Tool execution failed." };
      }
    }
    try {
      await this.inner.send({ jsonrpc: "2.0", method: "x-ahp/tools/complete", params: completion });
    } catch {
      // A disconnected executor cannot complete its outstanding call.
    }
  }
}

const refKey = (key: string, version: number): string => `${key}@${String(version)}`;

function parseInvoke(value: unknown): InvokeParams | undefined {
  if (!isRecord(value)) return undefined;
  const { callId, channel, key, version } = value;
  if (typeof callId !== "string" || typeof channel !== "string" || typeof key !== "string"
    || typeof version !== "number" || !Number.isSafeInteger(version) || !("input" in value)) {
    return undefined;
  }
  return { callId, channel, key, version, input: value.input };
}

function parseFrame(value: string): unknown {
  try {
    return parseUnknownJson(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
