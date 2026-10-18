import type {
  ActionEnvelope,
  CreateSessionParams as AhpCreateSessionParams,
  SessionAction,
  SessionAddedParams as AhpSessionAddedParams,
  SessionSummaryChangedParams as AhpSessionSummaryChangedParams,
} from "@microsoft/agent-host-protocol";
import { sessionReducer } from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";

import {
  createSessionParamsSchema,
  createSessionsFactory,
  createSequenceAllocator,
  SESSION_URI_PREFIX,
  type CatalogueNotification,
} from "@sessions";
import {
  ACTION_TYPE_SESSION_CREATION_FAILED,
  ACTION_TYPE_SESSION_READY,
  SESSION_LIFECYCLE_CREATING,
  SESSION_STATUS_IDLE,
} from "@sessions/constants";
import { createMockProvider } from "@sessions/mock";

const TEST_NOW = (): Date => new Date("2026-01-02T03:04:05.000Z");

const sessionUri = (id: string): string => `${SESSION_URI_PREFIX}${id}`;

/** The runtime enum objects the protocol package ships alongside its types. */
interface AhpRuntimeEnums {
  readonly SessionLifecycle: Record<string, string>;
  readonly SessionStatus: Record<string, number>;
  readonly ActionType: Record<string, string>;
}

async function loadAhpRuntimeEnums(): Promise<AhpRuntimeEnums> {
  const moduleNamespace: unknown = await import("@microsoft/agent-host-protocol");

  return moduleNamespace as AhpRuntimeEnums;
}

// Wire fixtures typed with the Microsoft protocol package. The types stay
// linked at compile time (see `CreateSessionMicrosoftConformance` in
// `src/sessions/createSession/types.ts`); the assertions prove our schema
// accepts them at runtime.
const minimalParams: AhpCreateSessionParams = {
  channel: sessionUri("fixture-minimal"),
};

const fullParams: AhpCreateSessionParams = {
  channel: sessionUri("fixture-full"),
  provider: "mock",
  workingDirectories: ["file:///workspace"],
  config: { model: "x" },
  activeClient: { clientId: "client-1", displayName: "Client", tools: [] },
  progressToken: "token-1",
  _meta: { trace: "abc" },
};

describe("createSession Microsoft wire conformance", () => {
  it("accepts minimal createSession params", () => {
    expect(createSessionParamsSchema.safeParse(minimalParams).success).toBe(true);
  });

  it("accepts fully-populated createSession params", () => {
    expect(createSessionParamsSchema.safeParse(fullParams).success).toBe(true);
  });
});

describe("protocol literal mirrors", () => {
  it("match the values the protocol package ships at runtime", async () => {
    const runtime = await loadAhpRuntimeEnums();

    expect(runtime.SessionLifecycle.Creating).toBe(SESSION_LIFECYCLE_CREATING);
    expect(runtime.SessionStatus.Idle).toBe(SESSION_STATUS_IDLE);
    expect(runtime.ActionType.SessionReady).toBe(ACTION_TYPE_SESSION_READY);
    expect(runtime.ActionType.SessionCreationFailed).toBe(ACTION_TYPE_SESSION_CREATION_FAILED);
  });
});

describe("catalogue notification conformance", () => {
  it("emits notifications shaped as the protocol declares", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });
    const catalogue: CatalogueNotification[] = [];
    factory.onCatalogueNotification((notification) => catalogue.push(notification));
    const uri = sessionUri("catalogue-shape");

    await factory.createSession({ channel: uri, provider: "mock" });

    const added = catalogue[0];
    if (added?.method !== "root/sessionAdded") {
      throw new Error("expected the first notification to be root/sessionAdded");
    }
    const addedParams: AhpSessionAddedParams = added.params;
    expect(addedParams.summary.resource).toBe(uri);

    const changed = catalogue[1];
    if (changed?.method !== "root/sessionSummaryChanged") {
      throw new Error("expected the second notification to be root/sessionSummaryChanged");
    }
    const changedParams: AhpSessionSummaryChangedParams = changed.params;
    expect(changedParams.session).toBe(uri);
  });
});

describe("session state replay conformance", () => {
  it("reaches the factory's state by replaying envelopes through the protocol reducer", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });
    const envelopes: ActionEnvelope[] = [];
    factory.onSessionEnvelope((envelope) => envelopes.push(envelope));
    const uri = sessionUri("replay");

    // The client observes the creating snapshot before the backend settles.
    const creation = factory.createSession({ channel: uri, provider: "mock" });
    const creatingSnapshot = factory.getSessionSnapshot(uri);
    expect(creatingSnapshot?.state.lifecycle).toBe("creating");
    expect(creatingSnapshot?.fromSeq).toBe(0);

    await creation;

    const finalSnapshot = factory.getSessionSnapshot(uri);
    if (creatingSnapshot === undefined || finalSnapshot === undefined) {
      throw new Error("expected the session to be registered after createSession");
    }
    expect(finalSnapshot.fromSeq).toBe(1);
    expect(finalSnapshot.state.lifecycle).toBe("ready");
    const sessionEnvelopes = envelopes.filter((envelope) => envelope.channel === uri);
    expect(sessionEnvelopes).toHaveLength(1);

    // A client that starts from the creating snapshot and applies every emitted
    // session action must land exactly on the server's authoritative state.
    let mirrored = creatingSnapshot.state;
    for (const envelope of sessionEnvelopes) {
      mirrored = sessionReducer(mirrored, envelope.action as SessionAction);
    }

    expect(mirrored).toEqual(finalSnapshot.state);
  });
});

describe("action sequence allocator", () => {
  it("numbers actions across sessions from one gap-free connection stream", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });
    const envelopes: ActionEnvelope[] = [];
    factory.onSessionEnvelope((envelope) => envelopes.push(envelope));
    const firstUri = sessionUri("seq-first");
    const secondUri = sessionUri("seq-second");

    await factory.createSession({ channel: firstUri, provider: "mock" });
    await factory.createSession({ channel: secondUri, provider: "mock" });

    expect(envelopes.map((envelope) => envelope.serverSeq)).toEqual([1, 2, 3, 4]);
    expect(envelopes.map((envelope) => envelope.channel)).toEqual([
      firstUri,
      "ahp-root://",
      secondUri,
      "ahp-root://",
    ]);

    // A single connection-wide cursor selects actions after seq 1 regardless of
    // which session produced them.
    const afterFirst = envelopes.filter((envelope) => envelope.serverSeq > 1);
    expect(afterFirst.map((envelope) => envelope.serverSeq)).toEqual([2, 3, 4]);
    expect(afterFirst[2]?.channel).toBe("ahp-root://");
  });

  it("uses an injected allocator instead of a per-factory one", async () => {
    const factory = createSessionsFactory({
      providers: [createMockProvider()],
      now: TEST_NOW,
      nextServerSeq: createSequenceAllocator(100),
    });
    const envelopes: ActionEnvelope[] = [];
    factory.onSessionEnvelope((envelope) => envelopes.push(envelope));

    await factory.createSession({ channel: sessionUri("injected-seq") });

    expect(envelopes[0]?.serverSeq).toBe(100);
    expect(envelopes[1]?.serverSeq).toBe(101);
  });

  it("keeps catalogue notifications outside the numbered action stream", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });
    const catalogue: CatalogueNotification[] = [];
    const envelopes: ActionEnvelope[] = [];
    factory.onCatalogueNotification((notification) => catalogue.push(notification));
    factory.onSessionEnvelope((envelope) => envelopes.push(envelope));
    const uri = sessionUri("catalogue-outside-stream");

    await factory.createSession({ channel: uri, provider: "mock" });

    expect(catalogue.map((notification) => notification.method)).toEqual([
      "root/sessionAdded",
      "root/sessionSummaryChanged",
    ]);
    // Catalogue events follow their own protocol shape: they carry no action
    // envelope and never consume the connection-wide sequence.
    for (const notification of catalogue) {
      expect(notification).not.toHaveProperty("serverSeq");
    }
    expect(envelopes.map((envelope) => envelope.serverSeq)).toEqual([1, 2]);
    expect(factory.getSessionSnapshot(uri)?.fromSeq).toBe(1);
  });
});
