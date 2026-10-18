import type { SessionRecord, SessionRegistry } from "@/sessions/types";

/**
 * Creates the in-memory {@link SessionRegistry}.
 *
 * This is the only session store while the capability has no persistence: it
 * tracks live sessions for uniqueness enforcement and snapshot/event fan-out.
 * A durable store implements the same contract later.
 */
export function createInMemorySessionRegistry(): SessionRegistry {
  const sessions = new Map<string, SessionRecord>();

  return {
    get size(): number {
      return sessions.size;
    },
    has: (sessionUri: string): boolean => sessions.has(sessionUri),
    add: (record: SessionRecord): void => {
      sessions.set(record.sessionUri, record);
    },
    get: (sessionUri: string): SessionRecord | undefined => sessions.get(sessionUri),
    delete: (sessionUri: string): boolean => sessions.delete(sessionUri),
    records: (): SessionRecord[] => [...sessions.values()],
    clear: (): void => {
      sessions.clear();
    },
  };
}
