import type { AddressInfo } from "node:net";

import { createActionSequence, createSessionsFactory } from "@sessions";
import type { SessionsFactory } from "@sessions/types";

import { createWebSocketServer } from "../server";
import { createAHPBinding } from "../ahp";
import type { AHPServerHandle, AHPServerOptions } from "./types";

const HOST_STOPPED = "AHP host cannot be started after shutdown has begun.";
const HOST_SESSIONS_STOPPED = "AHP host sessions cannot be used after shutdown has begun.";

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

  const assertSessionsOpen = (): void => {
    if (stopped) {
      throw new Error(HOST_SESSIONS_STOPPED);
    }
  };

  const hostedSessions: SessionsFactory = {
    createSession: (params: unknown): Promise<void> => {
      if (stopped) {
        return Promise.reject(new Error(HOST_SESSIONS_STOPPED));
      }
      return sessions.createSession(params);
    },
    getSessionSnapshot: (sessionUri: string) => sessions.getSessionSnapshot(sessionUri),
    listSessionSnapshots: () => sessions.listSessionSnapshots(),
    getCurrentServerSeq: () => sessions.getCurrentServerSeq(),
    listAgents: () => sessions.listAgents(),
    dispatchAction: (params) => {
      assertSessionsOpen();
      return sessions.dispatchAction(params);
    },
    onCatalogueNotification: (listener) => sessions.onCatalogueNotification(listener),
    onSessionEnvelope: (listener) => sessions.onSessionEnvelope(listener),
    dispose: () => sessions.dispose(),
  };

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
    sessions: hostedSessions,
    start: async (): Promise<AddressInfo> => {
      if (stopped) {
        throw new Error(HOST_STOPPED);
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
