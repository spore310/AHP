import type { AhpTransport, TransportFrame } from "@microsoft/agent-host-protocol/client";
import type { ProtocolMessage } from "@microsoft/agent-host-protocol";
import { vi } from "vitest";
import { parseUnknownJson } from "@jsonrpc";

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected fixture object");
  return value as Record<string, unknown>;
}

export function frame(message: unknown, kind: TransportFrame["kind"] = "text"): TransportFrame {
  if (kind === "parsed") return { kind, message: message as ProtocolMessage };
  const text = JSON.stringify(message);
  return kind === "text" ? { kind, text } : { kind, data: new TextEncoder().encode(text) };
}

/** One exclusive logical endpoint; retiring it releases the pending reader. */
export class Endpoint implements AhpTransport {
  readonly sent: Record<string, unknown>[] = [];
  readonly incoming: TransportFrame[] = [];
  readonly readers: Array<ReturnType<typeof Promise.withResolvers<TransportFrame | null>>> = [];
  close = vi.fn(() => {
    this.retire();
  });

  readonly detach = vi.fn<() => void | Promise<void>>(() => {
    this.retire();
  });

  retired = false;
  onSend: (message: Record<string, unknown>) => void = () => undefined;

  send(message: Parameters<AhpTransport["send"]>[0]): void {
    if (this.retired) throw new Error("Endpoint retired");
    const parsed = record(typeof message === "string" ? parseUnknownJson(message) : message);
    this.sent.push(parsed);
    this.onSend(parsed);
  }

  recv(): Promise<TransportFrame | null> {
    if (this.retired) return Promise.resolve(null);
    const next = this.incoming.shift();
    if (next !== undefined) return Promise.resolve(next);
    const read = Promise.withResolvers<TransportFrame | null>();
    this.readers.push(read);
    return read.promise;
  }

  push(message: unknown, kind: TransportFrame["kind"] = "text"): void {
    this.pushFrame(frame(message, kind));
  }

  pushFrame(next: TransportFrame): void {
    if (this.retired) throw new Error("Cannot route to retired endpoint");
    const read = this.readers.shift();
    if (read === undefined) this.incoming.push(next);
    else read.resolve(next);
  }

  retire(): void {
    this.retired = true;
    this.incoming.length = 0;
    for (const read of this.readers.splice(0)) read.resolve(null);
  }
}
