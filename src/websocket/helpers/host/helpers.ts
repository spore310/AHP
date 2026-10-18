import type { AddressInfo } from "node:net";

import { createActionSequence, createSessionsFactory } from "@sessions";
import type { SessionsFactory } from "@sessions/types";

import { createWebSocketServer } from "../server";
import { createAHPBinding } from "../ahp";
import type { AHPServerHandle, AHPServerOptions } from "./types";

const collectFailure = (failures: unknown[], error: unknown): void => {
  failures.push(error);
};

/**
 * Compose one sequence allocator, session factory, AHP binding, and transport.
 *
 * Callers do not register methods or fan-out listeners. `stop()` is terminal
 * and attempts every cleanup even when one fails.
 */
export const createAHPServer = (options: AHPServerOptions): AHPServerHandle => {
  const sequence = options.sessions.sequence ?? createActionSequence();
  const sessions: SessionsFactory = createSessionsFactory({
    ...options.sessions,
    sequence,
  });
  const binding = createAHPBinding(sessions, () => undefined);
  const transport = createWebSocketServer({
    host: options.host,
    port: options.port,
    path: options.path,
    handlers: binding.handlers,
    onConnection: (context) => {
      binding.onConnection(context);
    },
    beforeDispatch: (dispatch) => {
      binding.beforeDispatch(dispatch);
    },
  });
  let stopped = false;

  const stop = async (): Promise<void> => {
    if (stopped) {
      await transport.stop();
      return;
    }
    stopped = true;
    const failures: unknown[] = [];
    try {
      await transport.stop();
    } catch (error) {
      collectFailure(failures, error);
    }
    try {
      binding.dispose();
    } catch (error) {
      collectFailure(failures, error);
    }
    try {
      await sessions.dispose();
    } catch (error) {
      collectFailure(failures, error);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "AHP host shutdown failed");
    }
  };

  return {
    sessions,
    start: async (): Promise<AddressInfo> => {
      if (stopped) {
        throw new Error("AHP host cannot be started after shutdown has begun.");
      }
      try {
        return await transport.start();
      } catch (error) {
        await stop();
        throw error;
      }
    },
    stop,
  };
};
