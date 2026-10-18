import { parseUnknownJson } from "@jsonrpc";
import WebSocket from "ws";

const frameToText = (data: WebSocket.RawData): string => {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return data.toString("utf8");
};

/** Correlates JSON-RPC responses by id and retains notifications separately. */
export class FrameLog {
  readonly frames: unknown[] = [];
  private waiters: Array<() => void> = [];

  constructor(socket: WebSocket) {
    socket.on("message", (data) => {
      this.frames.push(parseUnknownJson(frameToText(data)));
      const pending = this.waiters;
      this.waiters = [];
      for (const wake of pending) {
        wake();
      }
    });
  }

  waitFor(predicate: (frame: unknown) => boolean, timeoutMs = 1_000): Promise<unknown> {
    const existing = this.frames.find(predicate);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter !== check);
        reject(new Error("timed out waiting for a matching frame"));
      }, timeoutMs);
      const check = (): void => {
        const found = this.frames.find(predicate);
        if (found === undefined) {
          this.waiters.push(check);
          return;
        }
        clearTimeout(timer);
        resolve(found);
      };
      this.waiters.push(check);
    });
  }
}

export const responseWithId = (id: number | string) => (frame: unknown): boolean => (
  typeof frame === "object"
  && frame !== null
  && "id" in frame
  && frame.id === id
);

export const methodFrame = (method: string) => (frame: unknown): boolean => (
  typeof frame === "object"
  && frame !== null
  && "method" in frame
  && frame.method === method
);
