import type { ActionEnvelope } from "@microsoft/agent-host-protocol";
import { AhpErrorCodes, JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";

import {
  createActionSequence,
  createSessionsFactory,
  SESSION_URI_PREFIX,
  SessionsError,
  type CatalogueNotification,
  type SessionsFactory,
} from "@sessions";
import { BASELINE_UNSUPPORTED_ACTION_REASON } from "@sessions/helpers/actions";
import { createInMemorySessionRegistry } from "@sessions/helpers/registry";
import { createMockProvider } from "@sessions/mock";

const TEST_NOW = (): Date => new Date("2026-01-02T03:04:05.000Z");
const CLIENT_ID = "client-1";

const sessionUri = (id: string): string => `${SESSION_URI_PREFIX}${id}`;

async function readyFactory(uri = sessionUri("dispatch")): Promise<{
  factory: SessionsFactory;
  uri: string;
  catalogue: CatalogueNotification[];
  envelopes: ActionEnvelope[];
}> {
  const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });
  const catalogue: CatalogueNotification[] = [];
  const envelopes: ActionEnvelope[] = [];
  factory.onCatalogueNotification((notification) => catalogue.push(notification));
  factory.onSessionEnvelope((envelope) => envelopes.push(envelope));
  await factory.createSession({ channel: uri, provider: "mock" });
  return { factory, uri, catalogue, envelopes };
}

describe("dispatchAction: missing target (T15)", () => {
  it("throws owned SessionNotFound without mutating state or emitting events", async () => {
    const { factory, uri, catalogue, envelopes } = await readyFactory();
    const snapshotBefore = structuredClone(factory.getSessionSnapshot(uri));
    const seqBefore = factory.getCurrentServerSeq();
    const catalogueBefore = catalogue.length;
    const envelopesBefore = envelopes.length;
    const missing = sessionUri("missing-target");

    expect(() =>
      factory.dispatchAction({
        channel: missing,
        clientSeq: 1,
        action: { type: "session/titleChanged", title: "Renamed" },
        clientId: CLIENT_ID,
      }),
    ).toThrow(SessionsError);

    try {
      factory.dispatchAction({
        channel: missing,
        clientSeq: 1,
        action: { type: "session/titleChanged", title: "Renamed" },
        clientId: CLIENT_ID,
      });
      throw new Error("expected SessionNotFound");
    } catch (error) {
      expect(error).toMatchObject({
        name: "SessionsError",
        code: AhpErrorCodes.SessionNotFound,
        message: `Session not found: ${missing}`,
      });
    }

    expect(factory.getSessionSnapshot(uri)).toEqual(snapshotBefore);
    expect(factory.getSessionSnapshot(missing)).toBeUndefined();
    expect(factory.getCurrentServerSeq()).toBe(seqBefore);
    expect(catalogue).toHaveLength(catalogueBefore);
    expect(envelopes).toHaveLength(envelopesBefore);
  });
});

describe("dispatchAction: malformed payloads (T12)", () => {
  it("rejects bad title, read, and archive payloads without reducing or emitting", async () => {
    const { factory, uri, catalogue, envelopes } = await readyFactory();
    const snapshotBefore = structuredClone(factory.getSessionSnapshot(uri));
    const seqBefore = factory.getCurrentServerSeq();
    const catalogueBefore = catalogue.length;
    const envelopesBefore = envelopes.length;

    const invalidActions: unknown[] = [
      { type: "session/titleChanged", title: 1 },
      { type: "session/titleChanged" },
      { type: "session/titleChanged", title: null },
      { type: "session/isReadChanged", isRead: "true" },
      { type: "session/isReadChanged", isRead: 1 },
      { type: "session/isReadChanged" },
      { type: "session/isArchivedChanged", isArchived: "false" },
      { type: "session/isArchivedChanged", isArchived: 0 },
      { type: "session/ready" },
      { type: "chat/delta", text: "nope" },
      { type: "unknown/action" },
      null,
      "session/titleChanged",
    ];

    for (const action of invalidActions) {
      expect(() =>
        factory.dispatchAction({
          channel: uri,
          clientSeq: 1,
          action,
          clientId: CLIENT_ID,
        }),
      ).toThrow(SessionsError);

      try {
        factory.dispatchAction({
          channel: uri,
          clientSeq: 1,
          action,
          clientId: CLIENT_ID,
        });
        throw new Error("expected invalid action to throw");
      } catch (error) {
        expect(error).toMatchObject({
          name: "SessionsError",
          code: JsonRpcErrorCodes.InvalidParams,
        });
      }
    }

    expect(factory.getSessionSnapshot(uri)).toEqual(snapshotBefore);
    expect(factory.getCurrentServerSeq()).toBe(seqBefore);
    expect(catalogue).toHaveLength(catalogueBefore);
    expect(envelopes).toHaveLength(envelopesBefore);
  });
});

describe("dispatchAction: clientSeq non-coercion (T13)", () => {
  it("rejects missing, null, string, fractional, boolean, unsafe, and negative values", async () => {
    const { factory, uri, catalogue, envelopes } = await readyFactory();
    const snapshotBefore = structuredClone(factory.getSessionSnapshot(uri));
    const seqBefore = factory.getCurrentServerSeq();
    const catalogueBefore = catalogue.length;
    const envelopesBefore = envelopes.length;
    const action = { type: "session/titleChanged", title: "Renamed" };

    const invalidSeqs: unknown[] = [
      undefined,
      null,
      "1",
      "1.0",
      1.5,
      true,
      false,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      -1,
    ];

    for (const clientSeq of invalidSeqs) {
      try {
        factory.dispatchAction({
          channel: uri,
          clientSeq,
          action,
          clientId: CLIENT_ID,
        });
        throw new Error(`expected clientSeq ${String(clientSeq)} to throw`);
      } catch (error) {
        expect(error).toMatchObject({
          name: "SessionsError",
          code: JsonRpcErrorCodes.InvalidParams,
        });
      }
    }

    expect(factory.getSessionSnapshot(uri)).toEqual(snapshotBefore);
    expect(factory.getCurrentServerSeq()).toBe(seqBefore);
    expect(catalogue).toHaveLength(catalogueBefore);
    expect(envelopes).toHaveLength(envelopesBefore);
  });

  it("accepts the SDK starting value and other non-negative safe integers", async () => {
    const { factory, uri } = await readyFactory();

    const first = factory.dispatchAction({
      channel: uri,
      clientSeq: 1,
      action: { type: "session/titleChanged", title: "One" },
      clientId: CLIENT_ID,
    });
    const second = factory.dispatchAction({
      channel: uri,
      clientSeq: 0,
      action: { type: "session/titleChanged", title: "Zero" },
      clientId: CLIENT_ID,
    });

    expect(first.origin).toEqual({ clientId: CLIENT_ID, clientSeq: 1 });
    expect(second.origin).toEqual({ clientId: CLIENT_ID, clientSeq: 0 });
    expect(factory.getSessionSnapshot(uri)?.state.title).toBe("Zero");
  });
});

describe("dispatchAction: valid-but-unsupported baseline actions", () => {
  it("validates the pinned payload, does not reduce, and does not emit an accepted envelope", async () => {
    const { factory, uri, catalogue, envelopes } = await readyFactory();
    const snapshotBefore = structuredClone(factory.getSessionSnapshot(uri));
    const seqBefore = factory.getCurrentServerSeq();
    const catalogueBefore = catalogue.length;
    const envelopesBefore = envelopes.length;

    const rejected = factory.dispatchAction({
      channel: uri,
      clientSeq: 4,
      action: {
        type: "session/workingDirectorySet",
        directory: "file:///workspace",
      },
      clientId: CLIENT_ID,
    });

    expect(rejected.rejectionReason).toBe(BASELINE_UNSUPPORTED_ACTION_REASON);
    expect(rejected.serverSeq).toBe(seqBefore + 1);
    expect(factory.getCurrentServerSeq()).toBe(seqBefore + 1);
    expect(factory.getSessionSnapshot(uri)).toEqual(snapshotBefore);
    expect(catalogue).toHaveLength(catalogueBefore);
    expect(envelopes).toHaveLength(envelopesBefore);
  });
});

describe("action sequence cursor (T20)", () => {
  it("does not rewind after multiple sessions, clear/reuse, or another producer; current() does not allocate", async () => {
    const sequence = createActionSequence();
    let nextCalls = 0;
    const watched: typeof sequence = {
      next: (): number => {
        nextCalls += 1;
        return sequence.next();
      },
      current: (): number => sequence.current(),
    };

    const factory = createSessionsFactory({
      providers: [createMockProvider()],
      now: TEST_NOW,
      sequence: watched,
    });
    const envelopes: ActionEnvelope[] = [];
    factory.onSessionEnvelope((envelope) => envelopes.push(envelope));

    expect(factory.getCurrentServerSeq()).toBe(0);
    const currentCallsBefore = nextCalls;
    expect(factory.getCurrentServerSeq()).toBe(0);
    expect(nextCalls).toBe(currentCallsBefore);

    const firstUri = sessionUri("seq-first");
    const secondUri = sessionUri("seq-second");
    await factory.createSession({ channel: firstUri, provider: "mock" });
    await factory.createSession({ channel: secondUri, provider: "mock" });

    expect(envelopes.map((envelope) => envelope.serverSeq)).toEqual([1, 2, 3, 4]);
    expect(factory.getCurrentServerSeq()).toBe(4);

    const produced = watched.next();
    expect(produced).toBe(5);
    expect(factory.getCurrentServerSeq()).toBe(5);

    await factory.dispose();
    expect(factory.getCurrentServerSeq()).toBe(6);
    expect(envelopes.map((envelope) => envelope.serverSeq)).toEqual([1, 2, 3, 4, 6]);

    const reusedEnvelopes: ActionEnvelope[] = [];
    factory.onSessionEnvelope((envelope) => reusedEnvelopes.push(envelope));
    const reused = sessionUri("seq-reused");
    await factory.createSession({ channel: reused, provider: "mock" });
    expect(factory.getCurrentServerSeq()).toBe(8);
    expect(reusedEnvelopes.map((envelope) => envelope.serverSeq)).toEqual([7, 8]);
    expect(reusedEnvelopes[0]?.serverSeq).toBeGreaterThan(6);
  });
});

describe("summary projection (T21)", () => {
  it("projects rename, read, and archive into catalogue summaries and keeps the active count truthful", async () => {
    const { factory, uri, catalogue, envelopes } = await readyFactory();

    expect(factory.listSessionSnapshots()).toHaveLength(1);
    expect(envelopes.at(-1)?.action).toEqual({
      type: "root/activeSessionsChanged",
      activeSessions: 1,
    });

    factory.dispatchAction({
      channel: uri,
      clientSeq: 1,
      action: { type: "session/titleChanged", title: "Renamed session" },
      clientId: CLIENT_ID,
    });
    expect(factory.getSessionSnapshot(uri)?.state.title).toBe("Renamed session");

    factory.dispatchAction({
      channel: uri,
      clientSeq: 2,
      action: { type: "session/isReadChanged", isRead: true },
      clientId: CLIENT_ID,
    });
    expect(factory.getSessionSnapshot(uri)?.state.status).toBe(1 | 32);

    factory.dispatchAction({
      channel: uri,
      clientSeq: 3,
      action: { type: "session/isArchivedChanged", isArchived: true },
      clientId: CLIENT_ID,
    });
    expect(factory.getSessionSnapshot(uri)?.state.status).toBe(1 | 32 | 64);

    const summaryChanges = catalogue.filter(
      (notification) => notification.method === "root/sessionSummaryChanged",
    );
    expect(summaryChanges.map((notification) => notification.params.changes)).toEqual([
      { modifiedAt: TEST_NOW().toISOString() },
      { title: "Renamed session" },
      { status: 1 | 32 },
      { status: 1 | 32 | 64 },
    ]);

    const secondUri = sessionUri("dispatch-second");
    await factory.createSession({ channel: secondUri, provider: "mock" });
    expect(factory.listSessionSnapshots()).toHaveLength(2);
    expect(
      envelopes.filter((envelope) => envelope.channel === "ahp-root://").at(-1),
    ).toMatchObject({
      action: { type: "root/activeSessionsChanged", activeSessions: 2 },
    });

    const accepted = envelopes.filter((envelope) => envelope.rejectionReason === undefined);
    expect(accepted.map((envelope) => envelope.serverSeq)).toEqual(
      accepted.map((envelope) => envelope.serverSeq).sort((left, right) => left - right),
    );
  });
});

describe("sessions factory: registryFactory", () => {
  it("invokes the registry factory once per sessions factory", async () => {
    let calls = 0;
    const factory = createSessionsFactory({
      providers: [createMockProvider()],
      now: TEST_NOW,
      registryFactory: () => {
        calls += 1;
        return createInMemorySessionRegistry();
      },
    });

    expect(calls).toBe(1);
    await factory.createSession({ channel: sessionUri("registry-once"), provider: "mock" });
    await factory.dispose();
    expect(calls).toBe(1);
  });
});
