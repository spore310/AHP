import type {
  AgentRegistrationRecord,
  DurableSessionInput,
  PersistenceProvider,
  WorkItemRecord,
} from "@persistence/types";

/** Test-only setup surface for running repository semantics against a provider. */
export interface PersistenceConformanceFixture {
  readonly provider: PersistenceProvider;
  readonly registrations: Map<string, AgentRegistrationRecord>;
  readonly sessions: Map<string, DurableSessionInput>;
  readonly work: Map<string, WorkItemRecord>;
  seedRegistration(record: AgentRegistrationRecord): void;
  seedSession(session: DurableSessionInput): void;
  setNow(now: number): void;
  isDisposed(): boolean;
}

export type PersistenceConformanceFixtureFactory
  = () => PersistenceConformanceFixture | Promise<PersistenceConformanceFixture>;
