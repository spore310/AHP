import { describe, expect, it } from "vitest";

import type {
  PersistenceProvider,
  PersistenceRepositories,
} from "@persistence/types";
import {
  RepositoryError,
  type AgentRegistrationRecord,
  type AgentRegistrationRepository,
  type DurableSessionInput,
  type DurableSessionRepository,
  type RepositoryErrorCode,
  type WorkClaimInput,
  type WorkItemRecord,
  type WorkLeaseRecord,
  type WorkRepository,
  type WorkStatus,
} from "@persistence/types";

/** Compile-time assertion helpers (never assigned; types only). */
type Expect<T extends true> = T;
/** Requires `true` for a passing assertion. */
type ExactKeys<T, Expected extends keyof T> = [
  Extract<keyof T, Expected>,
] extends [Expected]
  ? [Exclude<keyof T, Expected>] extends [never]
      ? true
      : false
  : false;

const UUID = "018f4d1e-6a7b-7c8d-9e0f-1a2b3c4d5e6f";

/** Every surface the contract forbids on the provider/user boundary. */
type ProhibitedPersistenceBoundaryKeys
  = | "pool"
    | "query"
    | "connect"
    | "connectAsync"
    | "transaction"
    | "transactionClient"
    | "client"
    | "engine"
    | "orm"
    | "model"
    | "schema"
    | "dialect"
    | "adapter"
    | "sql";

type RegistrationsKeyCheck = ExactKeys<
  PersistenceProvider,
  keyof PersistenceRepositories | "dispose"
>;

type NoProhibitedProviderMembers = [
  Extract<keyof PersistenceProvider, ProhibitedPersistenceBoundaryKeys>,
] extends [never]
  ? true
  : false;

type NoIndexSignature = string extends keyof PersistenceProvider ? false : true;

type RepositoryErrorCodes = RepositoryErrorCode;
type ErrorCodeCheck = [
  RepositoryErrorCodes,
] extends ["conflict" | "not_found" | "unauthorized" | "database"]
  ? ["conflict" | "not_found" | "unauthorized" | "database"] extends [RepositoryErrorCodes]
      ? true
      : false
  : false;

type WorkStatusValues = WorkStatus;
type WorkStatusCheck = [
  WorkStatusValues,
] extends [
  "queued" | "leased" | "completed" | "failed" | "cancelled",
]
  ? ["queued" | "leased" | "completed" | "failed" | "cancelled"] extends [WorkStatusValues]
      ? true
      : false
  : false;

type SessionOptionalFieldCheck = SessionOptionalFieldsOf;
type SessionOptionalFieldsOf
  = "sessionTypeId" extends keyof DurableSessionInput
    ? "sessionTypeKey" extends keyof DurableSessionInput
      ? "sessionTypeVersion" extends keyof DurableSessionInput
        ? true
        : false
      : false
    : false;

type WorkItemOptionalFieldCheck
  = "targetAgentId" extends keyof WorkItemRecord
    ? "leaseAgentId" extends keyof WorkItemRecord
      ? "leaseToken" extends keyof WorkItemRecord
        ? "leaseExpiresAt" extends keyof WorkItemRecord
          ? "result" extends keyof WorkItemRecord
            ? true
            : false
          : false
        : false
      : false
    : false;

type SentinelCheck = {
  registrationMiss: AgentRegistrationRepository["getById"] extends (
    id: string,
  ) => Promise<AgentRegistrationRecord | undefined>
    ? true
    : false;
  sessionMiss: DurableSessionRepository["get"] extends (
    sessionUri: string,
  ) => Promise<DurableSessionInput | undefined>
    ? true
    : false;
  workMiss: WorkRepository["get"] extends (input: {
    readonly workId: string;
    readonly principalSubject: string;
  }) => Promise<WorkItemRecord | null>
    ? true
    : false;
  claimMiss: WorkRepository["claim"] extends (
    input: WorkClaimInput,
  ) => Promise<WorkLeaseRecord | null>
    ? true
    : false;
  fencedCompletionMiss: WorkRepository["complete"] extends (
    input: {
      readonly agentId: string;
      readonly principalSubject: string;
      readonly workId: string;
      readonly token: string;
      readonly result: unknown;
    },
  ) => Promise<boolean>
    ? true
    : false;
  sessionDelete: DurableSessionRepository["delete"] extends (
    sessionUri: string,
  ) => Promise<boolean>
    ? true
    : false;
};

type ProviderShapeCheck = {
  registrations: PositionalOf<PersistenceProvider["registrations"], AgentRegistrationRepository>;
  sessions: PositionalOf<PersistenceProvider["sessions"], DurableSessionRepository>;
  work: PositionalOf<PersistenceProvider["work"], WorkRepository>;
  dispose: PositionalOf<PersistenceProvider["dispose"], () => Promise<void>>;
};
type PositionalOf<A, B> = [A] extends [B]
  ? [B] extends [A]
      ? true
      : false
  : false;

const fixtureError = (operation: string): Error =>
  new Error(
    `Contract fixture does not implement ${operation}; the P01 packet freezes shapes only.`,
  );

/** Explicit unused-method stubs — each rejects at call time. No `any`, no unsafe casts. */
const throwRegistrations = (): AgentRegistrationRepository => ({
  register: () => Promise.reject(fixtureError("registrations.register")),
  getById: () => Promise.resolve(undefined),
});

const throwSessions = (): DurableSessionRepository => ({
  ensure: () => Promise.reject(fixtureError("sessions.ensure")),
  get: () => Promise.resolve(undefined),
  delete: () => Promise.reject(fixtureError("sessions.delete")),
});

const throwWork = (): WorkRepository => ({
  submit: () => Promise.reject(fixtureError("work.submit")),
  claim: () => Promise.resolve(null),
  renew: () => Promise.reject(fixtureError("work.renew")),
  complete: () => Promise.resolve(false),
  fail: () => Promise.reject(fixtureError("work.fail")),
  cancel: () => Promise.reject(fixtureError("work.cancel")),
  get: () => Promise.reject(fixtureError("work.get")),
  reconcileExpired: () => Promise.reject(fixtureError("work.reconcileExpired")),
  hasDependentWork: () => Promise.reject(fixtureError("work.hasDependentWork")),
});

const repositories: PersistenceRepositories = {
  registrations: throwRegistrations(),
  sessions: throwSessions(),
  work: throwWork(),
};

const provider: PersistenceProvider = {
  ...repositories,
  dispose: () => Promise.reject(fixtureError("dispose")),
};

/** One exported conjunction of every compile-time freeze assertion. */
export type PersistenceProviderContractFreeze = Expect<
  [
    RegistrationsKeyCheck,
    NoProhibitedProviderMembers,
    NoIndexSignature,
    ErrorCodeCheck,
    WorkStatusCheck,
    SessionOptionalFieldCheck,
    WorkItemOptionalFieldCheck,
    SentinelCheck extends {
      registrationMiss: true;
      sessionMiss: true;
      workMiss: true;
      claimMiss: true;
      fencedCompletionMiss: true;
      sessionDelete: true;
    }
      ? true
      : false,
    ProviderShapeCheck extends {
      registrations: true;
      sessions: true;
      work: true;
      dispose: true;
    }
      ? true
      : false,
  ] extends [true, true, true, true, true, true, true, true, true]
    ? true
    : false
>;

describe("persistence provider contract (P01 freeze)", () => {
  it("bundles exactly the three repository namespaces plus one dispose method", () => {
    expect(Object.keys(provider).sort()).toEqual(["dispose", "registrations", "sessions", "work"]);
  });

  it("exposes the repository namespaces with the frozen operation sets", () => {
    expect(Object.keys(provider.registrations).sort()).toEqual(["getById", "register"]);
    expect(Object.keys(provider.sessions).sort()).toEqual(["delete", "ensure", "get"]);
    expect(Object.keys(provider.work).sort()).toEqual([
      "cancel",
      "claim",
      "complete",
      "fail",
      "get",
      "hasDependentWork",
      "reconcileExpired",
      "renew",
      "submit",
    ]);
  });

  it("preserves the C01 absence sentinels on the stubbed operations", async () => {
    await expect(provider.registrations.getById(UUID)).resolves.toBe(undefined);
    await expect(provider.sessions.get("ahp-session:/fixture")).resolves.toBe(undefined);
    await expect(provider.work.claim({
      agentId: UUID,
      principalSubject: "alice",
      sessionUri: "ahp-session:/fixture",
      kinds: ["code.patch"],
    })).resolves.toBe(null);
    await expect(provider.work.complete({
      agentId: UUID,
      principalSubject: "alice",
      workId: UUID,
      token: UUID,
      result: {},
    })).resolves.toBe(false);
  });

  it("does not leak a driver boundary: no pool/query/transaction/ORM member resolves", () => {
    for (const key of [
      "pool",
      "query",
      "connect",
      "transaction",
      "engine",
      "orm",
      "model",
      "schema",
    ] as const) {
      expect(key in provider, `provider must not expose "${key}"`).toBe(false);
    }
  });

  it("keeps the single RepositoryError identity and its four codes", () => {
    for (const code of ["conflict", "not_found", "unauthorized", "database"] as const) {
      const error = new RepositoryError(code, "fixture");
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("RepositoryError");
      expect(error.code).toBe(code);
    }
  });

  it("throws from explicitly unused fixture methods instead of faking success", async () => {
    await expect(provider.dispose()).rejects.toThrow(/^Contract fixture does not implement dispose/);
    await expect(provider.registrations.register({
      principalSubject: "alice",
      agentKey: "agent-1",
    })).rejects.toThrow(/^Contract fixture does not implement registrations\.register/);
    await expect(provider.sessions.ensure({
      sessionUri: "ahp-session:/fixture",
      ownerPrincipalSubject: "alice",
      providerId: "mock-provider",
      createdAt: "2026-10-22T00:00:00.000Z",
      modifiedAt: "2026-10-22T00:00:00.000Z",
      lastServerSeq: 1,
      durableState: {},
    })).rejects.toThrow(/^Contract fixture does not implement sessions\.ensure/);
    await expect(provider.work.submit({
      session: {
        sessionUri: "ahp-session:/fixture",
        ownerPrincipalSubject: "alice",
        providerId: "mock-provider",
        createdAt: "2026-10-22T00:00:00.000Z",
        modifiedAt: "2026-10-22T00:00:00.000Z",
        lastServerSeq: 1,
        durableState: {},
      },
      requestKey: "key-1",
      kind: "code.patch",
      input: {},
    })).rejects.toThrow(/^Contract fixture does not implement work\.submit/);
  });
});
