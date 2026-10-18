import type { AgentInfo } from "@microsoft/agent-host-protocol";

import { SessionStartError } from "@/sessions/helpers/errors";
import type { SessionBackend, SessionProvider } from "@/sessions/types";

import type { MockProviderOptions } from "./types";

/** Provider id the mock session type registers under. */
export const MOCK_PROVIDER_ID = "mock";

const MOCK_AGENT_INFO: AgentInfo = {
  provider: MOCK_PROVIDER_ID,
  displayName: "Mock Agent",
  description: "Deterministic in-process agent used to prove the session factory contract.",
  models: [],
};

/**
 * Creates the built-in mock session type.
 *
 * It holds no state and completes immediately, so the factory and its contracts
 * can be exercised without a real agent SDK. `failCreation` makes it reject
 * deterministically for failure-path coverage.
 */
export function createMockProvider(options: MockProviderOptions = {}): SessionProvider {
  return {
    providerId: MOCK_PROVIDER_ID,
    agentInfo: MOCK_AGENT_INFO,
    startSession: (): Promise<SessionBackend> => {
      if (options.failCreation !== undefined) {
        return Promise.reject(new SessionStartError(options.failCreation));
      }

      // Nothing is held between start and dispose, so disposal is a no-op.
      return Promise.resolve({ dispose: (): void => undefined });
    },
  };
}

/** Default mock provider for hosts that have no real agent yet. */
export const mockProvider: SessionProvider = createMockProvider();
