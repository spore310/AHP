import { DEFAULT_WEBSOCKET_TRANSPORT_LIMITS } from "../constants";
import type { WebSocketTransportLimits } from "../types";

// Server frames are unmasked. Leave room for one maximum-size close frame.
const FRAME_HEADER_BYTES = 10;
const CLOSE_FRAME_BYTES = 127;

export function captureTransportLimits(overrides?: Partial<WebSocketTransportLimits>): WebSocketTransportLimits {
  const limits = { ...DEFAULT_WEBSOCKET_TRANSPORT_LIMITS, ...overrides };
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1)
    || limits.maxPendingSetups > limits.maxConnections
    || limits.maxBufferedOutputBytes <= FRAME_HEADER_BYTES + CLOSE_FRAME_BYTES) {
    throw new TypeError("Invalid WebSocket transport limits.");
  }
  return Object.freeze(limits);
}

/** Each successful reservation owns its release, including across asynchronous cleanup. */
export function createCapacity(limit: number) {
  let used = 0;
  return (): (() => void) | undefined => {
    if (used >= limit) return undefined;
    used += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      used -= 1;
    };
  };
}

export function canBufferFrame(bufferedBytes: number, payloadBytes: number, limit: number): boolean {
  return bufferedBytes <= limit - payloadBytes - FRAME_HEADER_BYTES - CLOSE_FRAME_BYTES;
}
