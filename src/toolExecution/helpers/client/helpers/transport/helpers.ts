import type { AhpTransport, TransportFrame } from "@microsoft/agent-host-protocol/client";
import { parseUnknownJson } from "@jsonrpc";
import { canonicalJsonEqual } from "@tools/helpers/protocol";
import type { LocalToolImplementation } from "../../types";
import { parseToolWire, toolCorrelation, toolInvokeSchema, toolCompleteSchema, toolExecutorCancelSchema, toolAssignmentsChangedSchema } from "../protocol";
import type { ToolInvoke, ToolAssignedReply, ToolAdvertiseReply, ToolExecutorCancel } from "../protocol";
import type { ActiveToolRegistration, StagedToolRegistration } from "./types";

/** One reader owns private messages and forwards ordinary frames to the pinned SDK. */
export class ToolInvocationTransport implements AhpTransport {
  private readonly implementations = new Map<string, ActiveToolRegistration>();
  private readonly staged = new Map<string, { readonly channel: string; readonly registration: StagedToolRegistration }>();
  private readonly queued: ToolInvoke[] = [];
  private readonly seen = new Set<string>();
  private readonly active = new Map<string, { readonly invoke: ToolInvoke; readonly controller: AbortController }>();
  private readonly requests = new Map<string, {
    readonly timer: ReturnType<typeof setTimeout>;
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>();

  private closed = false;
  private sendCount = 0;
  private readonly readers = new Set<(frame: null) => void>();
  private closing: Promise<void> | undefined;

  constructor(private readonly inner: AhpTransport,
    private readonly release: () => void | Promise<void> = inner.close.bind(inner)) {}

  async send(message: Parameters<AhpTransport["send"]>[0]): Promise<void> {
    this.assertOpen();
    if (this.sendCount >= 64) throw new Error("Tool transport send capacity unavailable.");
    this.sendCount += 1;
    try {
      await this.inner.send(message);
    } catch (error) {
      void this.close().catch(() => undefined);
      throw error;
    } finally {
      this.sendCount -= 1;
    }
  }

  async recv(): Promise<TransportFrame | null> {
    for (;;) {
      if (this.closed) return null;
      let frame: TransportFrame | null;
      const ended = Promise.withResolvers<null>();
      this.readers.add(ended.resolve);
      try {
        frame = await Promise.race([this.inner.recv(), ended.promise]);
      } catch (error) {
        void this.close().catch(() => undefined);
        throw error;
      } finally {
        this.readers.delete(ended.resolve);
      }
      if (frame === null || this.isClosed()) {
        void this.close().catch(() => undefined);
        return null;
      }
      const parsed = parseFrame(frame);
      if (!isRecord(parsed) || parsed.jsonrpc !== "2.0") return frame;
      if (typeof parsed.id === "string" && this.requests.has(parsed.id) && !Object.hasOwn(parsed, "method")) {
        const pending = this.requests.get(parsed.id);
        this.requests.delete(parsed.id);
        if (pending !== undefined) {
          clearTimeout(pending.timer);
          if (Object.hasOwn(parsed, "error") || !Object.hasOwn(parsed, "result")) pending.reject(new Error("Tool operation unavailable."));
          else pending.resolve(parsed.result);
        }
        continue;
      }
      if (Object.hasOwn(parsed, "id")) return frame;
      if (parsed.method === "x-ahp/tools/invoke") {
        try {
          this.receiveInvoke(parseToolWire(toolInvokeSchema, parsed.params));
        } catch { /* Invalid private messages cannot execute. */ }
        continue;
      }
      if (parsed.method === "x-ahp/tools/cancel") {
        try {
          const cancel = parseToolWire(toolExecutorCancelSchema, parsed.params);
          const active = this.active.get(cancel.callId);
          if (active !== undefined && sameCorrelation(active.invoke, cancel)) active.controller.abort();
          for (let index = this.queued.length - 1; index >= 0; index -= 1) {
            const queued = this.queued[index];
            if (queued !== undefined && sameCorrelation(queued, cancel)) {
              this.queued.splice(index, 1);
              void this.complete(queued, { error: "execution-failed" });
            }
          }
        } catch { /* Invalid cancellation cannot affect owned work. */ }
        continue;
      }
      if (parsed.method === "x-ahp/tools/assignmentsChanged") {
        try {
          const change = parseToolWire(toolAssignmentsChangedSchema, parsed.params);
          this.implementations.delete(change.channel);
          for (const [token, entry] of this.staged) if (entry.channel === change.channel) this.discard(change.channel, token);
        } catch { /* Invalid hints do not change registrations. */ }
        continue;
      }
      return frame;
    }
  }

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closed = true;
    for (const resolve of this.readers) resolve(null);
    this.readers.clear();
    for (const pending of this.requests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Tool invocation transport closed."));
    }
    this.requests.clear();
    this.implementations.clear();
    this.staged.clear();
    this.queued.length = 0;
    this.closing = Promise.resolve().then(() => this.release());
    for (const entry of this.active.values()) entry.controller.abort();
    return this.closing;
  }

  private isClosed(): boolean {
    return this.closed;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Tool invocation transport closed.");
  }

  request(method: string, params: unknown, timeoutMs = 5000): Promise<unknown> {
    this.assertOpen();
    if (this.requests.size >= 64 || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 35_000) throw new Error("Tool request capacity unavailable.");
    const id = `x-ahp-tool:${globalThis.crypto.randomUUID()}`;
    const message = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error("Tool operation timed out."));
      }, timeoutMs);
      this.requests.set(id, { timer, resolve, reject });
      void this.send(message).catch((error: unknown) => {
        const pending = this.requests.get(id);
        this.requests.delete(id);
        if (pending !== undefined) clearTimeout(pending.timer);
        reject(error instanceof Error ? error : new Error("Tool operation send failed."));
      });
    });
  }

  stage(channel: string, token: string, tools: readonly LocalToolImplementation[], view: ToolAssignedReply): void {
    this.assertOpen();
    const retainedChannels = new Set([...this.implementations.keys(), ...[...this.staged.values()].map((entry) => entry.channel)]);
    if (view.channel !== channel || this.staged.size >= 64 || this.staged.has(token)
      || (!retainedChannels.has(channel) && retainedChannels.size >= 128)) throw new Error("Tool registration unavailable.");
    this.staged.set(token, { channel, registration: { view, implementations: new Map(tools.map((tool) => [identity(tool.definition), tool])) } });
  }

  activate(channel: string, token: string, acknowledgement: ToolAdvertiseReply): void {
    this.assertOpen();
    const entry = this.staged.get(token);
    if (entry === undefined || entry.channel !== channel) throw new Error("Tool registration staging was lost.");
    if (!this.implementations.has(channel) && this.implementations.size >= 128) throw new Error("Tool registration unavailable.");
    const view = entry.registration.view;
    if (acknowledgement.channel !== channel || acknowledgement.viewRevision !== view.viewRevision
      || !canonicalJsonEqual(acknowledgement.resource, view.resource) || !canonicalJsonEqual(acknowledgement.connection, view.connection)
      || acknowledgement.tools.length !== view.tools.length
      || !acknowledgement.tools.every((tool, index) => sameTool(tool, view.tools[index]))) throw new Error("Server acknowledged a different tool advertisement.");
    this.implementations.set(channel, { ...entry.registration, acknowledgement });
    this.staged.delete(token);
    this.flush(channel);
  }

  discard(channel: string, token: string): void {
    if (this.staged.get(token)?.channel === channel) this.staged.delete(token);
    this.flush(channel);
  }

  private matches(invoke: ToolInvoke, registration: StagedToolRegistration): boolean {
    const tool = registration.view.tools.find((entry) => identity(entry.contract) === identity(invoke.contract));
    return tool !== undefined && tool.execution !== undefined && tool.purposes.includes("execute") && tool.purposes.includes("advertise")
      && canonicalJsonEqual(tool.execution, invoke.execution) && canonicalJsonEqual(registration.view.resource, invoke.route.origin)
      && canonicalJsonEqual(registration.view.connection, invoke.connection) && registration.implementations.has(identity(invoke.contract));
  }

  private receiveInvoke(invoke: ToolInvoke): void {
    if (this.seen.has(invoke.callId)) return;
    const active = this.implementations.get(invoke.channel);
    const matching = active !== undefined && active.acknowledgement.advertisementId === invoke.advertisementId && this.matches(invoke, active);
    const staging = [...this.staged.values()].some((entry) => entry.channel === invoke.channel && this.matches(invoke, entry.registration));
    if (!matching && !staging) return;
    // Never evict replay tombstones and re-execute an old call on this endpoint.
    if (this.seen.size >= 4096) {
      void this.close().catch(() => undefined);
      return;
    }
    this.seen.add(invoke.callId);
    if (matching) void this.execute(invoke);
    else if (this.queued.length < 64) this.queued.push(invoke);
    else void this.complete(invoke, { error: "execution-failed" });
  }

  private flush(channel: string): void {
    for (let index = this.queued.length - 1; index >= 0; index -= 1) {
      const invoke = this.queued[index];
      if (invoke === undefined || invoke.channel !== channel) continue;
      const active = this.implementations.get(channel);
      if (active !== undefined && active.acknowledgement.advertisementId === invoke.advertisementId && this.matches(invoke, active)) {
        this.queued.splice(index, 1);
        void this.execute(invoke);
      } else if (![...this.staged.values()].some((entry) => entry.channel === channel && this.matches(invoke, entry.registration))) {
        this.queued.splice(index, 1);
        void this.complete(invoke, { error: "execution-failed" });
      }
    }
  }

  private async execute(invoke: ToolInvoke): Promise<void> {
    if (this.closed) return;
    const registration = this.implementations.get(invoke.channel);
    const implementation = registration?.implementations.get(identity(invoke.contract));
    if (registration === undefined || implementation === undefined || registration.acknowledgement.advertisementId !== invoke.advertisementId
      || !this.matches(invoke, registration) || this.active.size >= 64) {
      await this.complete(invoke, { error: "execution-failed" });
      return;
    }
    const controller = new AbortController();
    this.active.set(invoke.callId, { invoke, controller });
    try {
      const output: unknown = await implementation.execute(invoke.input, { ...invoke, key: invoke.contract.key,
        version: invoke.contract.version, signal: controller.signal });
      await this.complete(invoke, { output });
    } catch {
      await this.complete(invoke, { error: "execution-failed" });
    } finally {
      this.active.delete(invoke.callId);
    }
  }

  private async complete(invoke: ToolInvoke, outcome: { readonly output: unknown } | { readonly error: "execution-failed" }): Promise<void> {
    if (this.closed) return;
    const correlation = toolCorrelation(invoke);
    try {
      let completion;
      try {
        completion = parseToolWire(toolCompleteSchema, { ...correlation, ...outcome });
      } catch {
        completion = parseToolWire(toolCompleteSchema, { ...correlation, error: "execution-failed" });
      }
      await this.send(JSON.stringify({ jsonrpc: "2.0", method: "x-ahp/tools/complete", params: completion }));
    } catch { /* A disconnected executor cannot complete its outstanding call. */ }
  }
}
export const identity = (ref: { readonly id: string; readonly key: string; readonly version: number }): string => `${ref.id}\u0000${ref.key}\u0000${String(ref.version)}`;
export function sameTool(left: unknown, right: unknown): boolean {
  if (!isRecord(left) || !isRecord(right)) return false;
  const entries = Object.entries(left);
  return Object.keys(right).length === entries.length && entries.every(([key, value]) => key === "descriptor"
    ? sameTool(value, right[key])
    : canonicalJsonEqual(value, right[key]));
}
function sameCorrelation(invoke: ToolInvoke, cancel: ToolExecutorCancel): boolean {
  return (["version", "callId", "channel", "contract", "route", "execution", "connection", "advertisementId"] as const)
    .every((key) => canonicalJsonEqual(invoke[key], cancel[key]));
}
function parseFrame(frame: TransportFrame): unknown {
  try {
    if (frame.kind === "parsed") return frame.message;
    if (frame.kind === "text") return frame.text.length > 2 * 1024 * 1024 ? undefined : parseUnknownJson(frame.text);
    if (frame.data.byteLength > 2 * 1024 * 1024) return undefined;
    return parseUnknownJson(new TextDecoder("utf-8", { fatal: true }).decode(frame.data));
  } catch {
    return undefined;
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
