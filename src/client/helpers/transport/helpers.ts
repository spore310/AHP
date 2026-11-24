import type { AhpTransport, TransportFrame } from "@microsoft/agent-host-protocol/client";
import { parseUnknownJson } from "@jsonrpc";
import { captureValue } from "@jsonrpc/value";
import type { ClientLifetime, ExtensionRpcClient, ExtensionRpcOptions } from "../../types";

function checkMethod(method: string): void {
  if (typeof method !== "string" || method.length > 128 || !/^x-ahp\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/u.test(method)) throw new Error("Invalid extension method.");
}
function notice(run: () => unknown): void {
  try {
    void Promise.resolve(run()).catch(() => undefined);
  } catch { /* Listener exceptions cannot interrupt the shared reader or release. */ }
}
export class ClientTransport implements AhpTransport, ExtensionRpcClient, ClientLifetime {
  private readonly ending = new AbortController();
  readonly signal = this.ending.signal;
  private readonly requests = new Map<string, { timer: ReturnType<typeof setTimeout>; resolve(value: unknown): void; reject(error: Error): void }>();
  private readonly lateReleases = new Map<string, (response: unknown) => unknown>();
  private readonly cleanups = new Set<() => void>();
  private readonly listeners = new Map<string, (params: unknown) => unknown>();
  private readonly readers = new Set<(frame: null) => void>();
  private closed = false;
  private sendCount = 0;
  private closing: Promise<void> | undefined;
  constructor(private readonly inner: AhpTransport, private readonly release: () => void | Promise<void> = inner.close.bind(inner)) {}
  send(message: Parameters<AhpTransport["send"]>[0]): Promise<void> {
    return this.write(message, "native");
  }

  private async write(message: Parameters<AhpTransport["send"]>[0], origin: "native" | "extension"): Promise<void> {
    this.assertOpen();
    if (this.sendCount >= 64) {
      // The pinned SDK tears down its native client on any failed write.
      if (origin === "native") void this.close().catch(() => undefined);
      throw new Error("Client transport send capacity unavailable.");
    }
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
      if (typeof parsed.id === "string" && parsed.id.startsWith("x-ahp-rpc:") && !Object.hasOwn(parsed, "method")) {
        const pending = this.requests.get(parsed.id);
        if (pending !== undefined) {
          clearTimeout(pending.timer);
          if (Object.hasOwn(parsed, "error") || !Object.hasOwn(parsed, "result")) pending.reject(new Error("Extension operation unavailable."));
          else pending.resolve(parsed.result);
        } else {
          const release = this.lateReleases.get(parsed.id);
          this.lateReleases.delete(parsed.id);
          if (release && !Object.hasOwn(parsed, "error") && Object.hasOwn(parsed, "result")) notice(() => release(parsed.result));
        }
        continue;
      }
      if (Object.hasOwn(parsed, "id")) return frame;

      const listener = typeof parsed.method === "string" ? this.listeners.get(parsed.method) : undefined;
      if (!listener) return frame;
      notice(() => listener(parsed.params));
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = Promise.resolve().then(() => this.release());
    this.closed = true;
    const cleanup = [...this.cleanups];
    this.ending.abort();
    this.cleanups.clear();
    for (const release of cleanup) notice(release);
    this.listeners.clear();
    this.lateReleases.clear();
    for (const stop of this.readers) stop(null);
    this.readers.clear();
    return this.closing;
  }

  addCleanup(cleanup: () => void): () => void {
    this.assertOpen();
    if (this.cleanups.size >= 128 || this.cleanups.has(cleanup)) throw new Error("Client cleanup unavailable.");
    this.cleanups.add(cleanup);
    return () => {
      this.cleanups.delete(cleanup);
    };
  }

  onNotification(method: string, receive: (params: unknown) => unknown): () => void {
    this.assertOpen();
    checkMethod(method);
    if (this.listeners.has(method) || this.listeners.size >= 64) throw new Error("Extension observer unavailable.");
    this.listeners.set(method, receive);
    return () => {
      if (this.listeners.get(method) === receive) this.listeners.delete(method);
    };
  }

  private isClosed(): boolean { return this.closed; }
  private assertOpen(): void {
    if (this.closed) throw new Error("Client transport closed.");
  }

  private prepare(method: string, params: unknown, options: ExtensionRpcOptions) {
    this.assertOpen();
    checkMethod(method);
    const timeout = options.timeoutMs ?? 5000;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 35000) throw new RangeError("Invalid extension timeout.");
    const signal = options.signal ? AbortSignal.any([this.signal, options.signal]) : this.signal;
    if (signal.aborted) throw new Error("Extension request cancelled.");
    const value = captureValue(params, { maxBytes: 2 * 1024 * 1024, maxDepth: 64, maxKeys: 131072 }).value;
    return { timeout, signal, value };
  }

  request(method: string, params: unknown, options: ExtensionRpcOptions = {}): Promise<unknown> {
    const { timeout, signal, value } = this.prepare(method, params, options);
    const releaseLate = options.releaseLate;
    if (this.requests.size >= 64 || (releaseLate && this.requests.size + this.lateReleases.size >= 64)) throw new Error("Extension request capacity unavailable.");
    const id = "x-ahp-rpc:" + globalThis.crypto.randomUUID();
    const message = JSON.stringify({ jsonrpc: "2.0", id, method, params: value });
    return new Promise((resolve, reject) => {
      const cancel = (reason: string) => {
        if (releaseLate && !this.closed) this.lateReleases.set(id, releaseLate);
        this.requests.get(id)?.reject(new Error(reason));
      };
      const abort = () => {
        cancel(this.closed ? "Client transport closed." : "Extension request cancelled.");
      };
      const timer = setTimeout(() => {
        cancel("Extension operation timed out.");
      }, timeout);
      const clear = () => {
        this.requests.delete(id);
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      };
      this.requests.set(id, { timer, resolve(response) {
        clear();
        resolve(response);
      }, reject(error) {
        clear();
        reject(error);
      } });
      signal.addEventListener("abort", abort, { once: true });
      void this.write(message, "extension").catch((error: unknown) => this.requests.get(id)?.reject(error instanceof Error ? error : new Error("Extension send failed.")));
    });
  }

  async notify(method: string, params: unknown, options: ExtensionRpcOptions = {}): Promise<void> {
    const { timeout, signal, value } = this.prepare(method, params, options);
    const stopped = Promise.withResolvers<never>();
    const abort = () => {
      stopped.reject(new Error(this.closed ? "Client transport closed." : "Extension notification cancelled."));
    };
    const timer = setTimeout(() => {
      stopped.reject(new Error("Extension operation timed out."));
    }, timeout);
    signal.addEventListener("abort", abort, { once: true });
    try {
      await Promise.race([this.write(JSON.stringify({ jsonrpc: "2.0", method, params: value }), "extension"), stopped.promise]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
}
function parseFrame(frame: TransportFrame): unknown {
  try {
    if (frame.kind === "parsed") return captureValue(frame.message, { maxBytes: 2 * 1024 * 1024, maxDepth: 64, maxKeys: 131072 }).value;
    if (frame.kind === "text") {
      if (frame.text.length > 2 * 1024 * 1024 || new TextEncoder().encode(frame.text).byteLength > 2 * 1024 * 1024) return undefined;
      return parseUnknownJson(frame.text);
    }
    if (frame.data.byteLength > 2 * 1024 * 1024) return undefined;
    return parseUnknownJson(new TextDecoder("utf-8", { fatal: true }).decode(frame.data));
  } catch {
    return undefined;
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
