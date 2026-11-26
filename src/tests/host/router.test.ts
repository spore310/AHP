import assert from "node:assert/strict";
import { afterEach, describe, expect, it } from "vitest";
import {
  bindDigest, createHostAdmission, createHostRouter, generateHostCredential,
  type HostAdmission, type HostLink, type HostLinkFactory, type HostLinkOptions, type NamespacePolicy,
} from "@host";
import { routeOutcomeUnknown, routeUnavailable } from "@host/helpers/routing/link";
import type { HostRouter } from "@host/helpers/routing/types";
import { RpcError, parseUnknownJson, type JsonRpcMessage } from "@jsonrpc";
import type { HostCoordination, HostMember, SessionLocation } from "@persistence/helpers/durability/types";
import type { PreparedConnectionSetup } from "@websocket/helpers/security/types";
import type { JsonRpcHandlers, JsonRpcInvocation, ReplySettlement, WebSocketConnectionContext } from "@websocket/types";

const NAMESPACE = "ahp-namespace:support-app/shared";
const POLICY_REVISION = 4;
const CONNECTION = "connection-1";
const PROOF = "x-ahp-host-proof";
const FORWARDED = "x-ahp-host-forwarded";
const SYNC = "x-ahp-host/sync";
const ENDPOINTS: Readonly<Record<string, string>> = { "host-b": "ws://b.test/", "host-c": "ws://c.test/" };
const INITIALIZE = { channel: "ahp-root://", clientId: "c", protocolVersions: ["1.0.0"] };
const REFUSAL_CODE = -32600;
const REFUSAL_MESSAGE = "Protected view unavailable";

type Locator = Parameters<HostCoordination["locate"]>[0];
type LinkScript = (params: unknown) => Promise<unknown>;
type Outcome = { readonly status: "resolved"; readonly value: unknown } | { readonly status: "rejected"; readonly error: unknown };
interface LinkRequest { readonly method: string; readonly params: unknown; readonly after: Promise<void> | undefined; readonly ordered: boolean }
interface FakeLink extends HostLink {
  readonly requests: LinkRequest[];
  readonly notifies: { readonly method: string; readonly params: unknown }[];
  /** How many times the router closed this link. */
  closes(): number;
}
interface FixtureOptions {
  readonly members?: (rows: readonly HostMember[]) => readonly HostMember[];
  readonly maxLinksPerConnection?: number;
  readonly handshakeHeaders?: Readonly<Record<string, string>>;
  readonly local?: readonly string[];
}

const routers: HostRouter[] = [];
afterEach(() => {
  for (const router of routers.splice(0)) router.close();
});

const sessionUri = (name: string): string => `ahp-session:/${name}`;
const deferred = (): { readonly promise: Promise<void>; readonly resolve: () => void } => {
  const { promise, resolve } = Promise.withResolvers<undefined>();
  return { promise, resolve: () => {
    resolve(undefined);
  } };
};
/** Observes a promise at once, so a later rejection always has a handler. */
const settled = (promise: Promise<unknown>): Promise<Outcome> =>
  promise.then((value): Outcome => ({ status: "resolved", value }), (error: unknown): Outcome => ({ status: "rejected", error }));
const rejection = (outcome: Outcome): RpcError => {
  assert.ok(outcome.status === "rejected", "expected a rejection");
  assert.ok(outcome.error instanceof RpcError, "expected an RpcError");
  return outcome.error;
};
/** Runs every queued microtask and callback. Nothing here waits on a clock. */
const turn = async (rounds = 3): Promise<void> => {
  for (let round = 0; round < rounds; round += 1) await new Promise((resolve) => setImmediate(resolve));
};
const member = (hostId: string, extra: Partial<HostMember> = {}): HostMember => {
  const endpoint = ENDPOINTS[hostId];
  return { hostId, instanceId: `${hostId}-instance`, generation: "1", role: "active", capabilities: {}, policyRevision: POLICY_REVISION,
    ...(endpoint === undefined ? {} : { endpoint }), ...extra };
};
const location = (uri: string, hostId: string): SessionLocation =>
  ({ session: { domainId: "support", kind: "session", id: uri, instanceId: "1" }, hostId, ownershipEpoch: "1", lifecycle: "active" });
const action = (serverSeq: number, channel: string): JsonRpcMessage =>
  ({ jsonrpc: "2.0", method: "action", params: { channel, serverSeq, action: { type: "x" } } });
const refusal = (from: string): RpcError => new RpcError(REFUSAL_CODE, REFUSAL_MESSAGE, { from });
const decodeForwarded = (value: string | undefined): unknown => {
  assert.ok(value !== undefined, "no forwarded handshake");
  return parseUnknownJson(Buffer.from(value, "base64url").toString("utf8"));
};

/**
 * Host A's router over fakes: a real admission policy for three hosts, a scripted
 * ownership store, scripted links instead of sockets, and one attached public connection.
 */
const createFixture = async (options: FixtureOptions = {}) => {
  const credentials = { a: generateHostCredential("host-a-key"), b: generateHostCredential("host-b-key"), c: generateHostCredential("host-c-key") };
  const policy: NamespacePolicy = { namespaceId: NAMESPACE, revision: POLICY_REVISION, members: [
    { hostId: "host-a", credentials: [credentials.a.verifier] },
    { hostId: "host-b", credentials: [credentials.b.verifier], endpoints: ["ws://b.test/"] },
    { hostId: "host-c", credentials: [credentials.c.verifier], endpoints: ["ws://c.test/"] },
  ] };
  const admit = (hostId: string, key: keyof typeof credentials): HostAdmission => createHostAdmission({ hostId, policy, credential: credentials[key].credential });
  const admissions = { a: admit("host-a", "a"), b: admit("host-b", "b"), c: admit("host-c", "c") };

  // The ownership store. A paused lookup is answered by the test instead of by the store.
  const store = new Map<string, string>();
  const lookups: Locator[] = [];
  const pausedLookups: Promise<SessionLocation | undefined>[] = [];
  const rows = (options.members ?? ((defaults) => defaults))([member("host-a"), member("host-b"), member("host-c")]);
  const coordination: Pick<HostCoordination, "hostId" | "instanceId" | "generation" | "members" | "locate"> = {
    hostId: "host-a", instanceId: "host-a-instance", generation: "7",
    members: () => Promise.resolve(rows),
    locate: (target) => {
      lookups.push(target);
      const paused = pausedLookups.shift();
      if (paused !== undefined) return paused;
      const hostId = "sessionUri" in target ? store.get(target.sessionUri) : undefined;
      return Promise.resolve(hostId === undefined || !("sessionUri" in target) ? undefined : location(target.sessionUri, hostId));
    },
  };

  // Links. Every request is recorded, then answered by the script for its method.
  const connects: HostLinkOptions[] = [];
  const links = new Map<string, FakeLink>();
  const scripts = new Map<string, LinkScript>();
  const connectFailures = new Map<string, Error>();
  const connect: HostLinkFactory = (linkOptions) => {
    connects.push(linkOptions);
    const failure = connectFailures.get(linkOptions.hostId);
    if (failure !== undefined) return Promise.reject(failure);
    const closeHandlers: (() => void)[] = [];
    let closes = 0;
    let pending = 0;
    const link: FakeLink = {
      hostId: linkOptions.hostId, requests: [], notifies: [],
      isOpen: () => closes === 0,
      pending: () => pending,
      closes: () => closes,
      request(method, params, after, ordered = false) {
        link.requests.push({ method, params, after, ordered });
        const script = scripts.get(`${linkOptions.hostId} ${method}`);
        const reply = script === undefined ? Promise.resolve(method === "initialize" ? {} : { from: linkOptions.hostId, method }) : script(params);
        pending += 1;
        return reply.finally(() => {
          pending -= 1;
        });
      },
      notify(method, params) {
        link.notifies.push({ method, params });
        return true;
      },
      onClose(handler) {
        closeHandlers.push(handler);
      },
      close() {
        closes += 1;
        for (const handler of closeHandlers.splice(0)) handler();
      },
    };
    links.set(linkOptions.hostId, link);
    return Promise.resolve(link);
  };

  // What this host committed for the connection. A paused confirmation is resolved by the test.
  const settles: string[] = [];
  const pausedSettles: Promise<void>[] = [];
  const local = new Set(options.local ?? []);
  const router = createHostRouter({
    admission: admissions.a, coordination: () => coordination as HostCoordination,
    isLocal: (uri) => local.has(uri),
    settleLocal: (connectionId) => {
      settles.push(connectionId);
      return pausedSettles.shift() ?? Promise.resolve();
    },
    connect, requestTimeoutMs: 5_000, maxPending: 16, maxLinksPerConnection: options.maxLinksPerConnection ?? 8, orderTimeoutMs: 5_000,
  });
  routers.push(router);

  // The public connection.
  const frames: JsonRpcMessage[] = [];
  const closeHandlers: (() => void)[] = [];
  let contextCloses = 0;
  const context: WebSocketConnectionContext = {
    connectionId: CONNECTION,
    send: (message) => {
      frames.push(message);
      return true;
    },
    onClose: (handler) => {
      closeHandlers.push(handler);
    },
    close: () => {
      contextCloses += 1;
    },
    isOpen: () => true,
    isSecurityCurrent: () => true,
  };
  const preparedStub = { isCurrent: () => true, release: () => undefined } as PreparedConnectionSetup;
  const prepared = await router.wrapSetup({ prepare: () => Promise.resolve(preparedStub) }).prepare({
    handshake: { headers: options.handshakeHeaders ?? { authorization: "Bearer user-token" } },
    fence: { connectionId: CONNECTION, connectionGeneration: 1 }, authRevision: "r", signal: new AbortController().signal,
  });
  assert.equal(prepared, preparedStub);
  router.attach(context);

  // The local method table. Each handler records that this host served the request itself.
  const localCalls: { readonly method: string; readonly params: unknown }[] = [];
  const serveLocally = (method: string) => (params: unknown): unknown => {
    localCalls.push({ method, params });
    return { local: method };
  };
  const handlers: JsonRpcHandlers = {
    initialize: () => ({ protocolVersion: "1.0.0", serverSeq: 0, snapshots: [] }),
    fetchTurns: serveLocally("fetchTurns"),
    subscribe: serveLocally("subscribe"),
  };
  const wrapped = router.wrapHandlers(handlers);
  /** One public request. `settle` simulates the transport enqueueing its reply. */
  const invoke = (method: string, params: Record<string, unknown>): { readonly reply: Promise<unknown>; readonly settle: () => void } => {
    const listeners: ((settlement: ReplySettlement) => void)[] = [];
    const invocation: JsonRpcInvocation = {
      kind: "request",
      onReplySettled(listener) {
        listeners.push(listener);
      },
      guardReply() { /* No final veto in this fixture. */ },
    };
    const handler = wrapped[method];
    assert.ok(handler !== undefined, `no handler for ${method}`);
    // A handler may answer synchronously, with a promise, or by throwing.
    const reply = new Promise<unknown>((resolve) => {
      resolve(handler(params, context, invocation));
    });
    return { reply, settle: () => {
      for (const listener of listeners.splice(0)) listener({ outcome: "success", responseSent: true });
    } };
  };
  /** One public request whose reply is enqueued as soon as it is produced. */
  const request = (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const { reply, settle } = invoke(method, params);
    return reply.finally(settle);
  };
  await expect(request("initialize", INITIALIZE)).resolves.toEqual({ protocolVersion: "1.0.0", serverSeq: 0, snapshots: [] });

  return {
    admissions, router, context, store, lookups, connects, frames, settles, localCalls, invoke, request,
    link: (hostId: string): FakeLink => {
      const link = links.get(hostId);
      assert.ok(link !== undefined, `no link to ${hostId}`);
      return link;
    },
    /** How many times that method was sent to that host, over every link. */
    sends: (hostId: string, method: string): number => links.get(hostId)?.requests.filter((entry) => entry.method === method).length ?? 0,
    script: (hostId: string, method: string, reply: LinkScript): void => {
      scripts.set(`${hostId} ${method}`, reply);
    },
    failConnect: (hostId: string, error: Error): void => {
      connectFailures.set(hostId, error);
    },
    pauseNextLookup: (answer: Promise<SessionLocation | undefined>): void => {
      pausedLookups.push(answer);
    },
    pauseNextSettle: (confirmation: Promise<void>): void => {
      pausedSettles.push(confirmation);
    },
    /** Delivers a notification as if that owner had sent it on its link. */
    notifyFrom: (hostId: string, message: JsonRpcMessage): void => {
      const linkOptions = connects.findLast((entry) => entry.hostId === hostId);
      assert.ok(linkOptions !== undefined, `no link to ${hostId}`);
      linkOptions.onNotification(message);
    },
    contextCloses: (): number => contextCloses,
  };
};

describe("host router", () => {
  it("H5-01 routes by owner and returns the owner's reply; local sessions never leave the host", async () => {
    const here = sessionUri("here");
    const mine = sessionUri("mine");
    const there = sessionUri("there");
    const fixture = await createFixture({ local: [here] });

    // A session this process serves is answered here without asking anyone.
    await expect(fixture.request("fetchTurns", { channel: here })).resolves.toEqual({ local: "fetchTurns" });
    expect(fixture.lookups).toEqual([]);
    // So is one the store assigns to this logical host.
    fixture.store.set(mine, "host-a");
    await expect(fixture.request("fetchTurns", { channel: mine })).resolves.toEqual({ local: "fetchTurns" });
    expect(fixture.localCalls).toEqual([{ method: "fetchTurns", params: { channel: here } }, { method: "fetchTurns", params: { channel: mine } }]);
    expect(fixture.connects).toEqual([]);

    // A session owned by host B is answered by host B.
    fixture.store.set(there, "host-b");
    fixture.script("host-b", "fetchTurns", () => Promise.resolve({ turns: ["from-b"] }));
    const routed = fixture.invoke("fetchTurns", { channel: there, limit: 5 });
    await expect(routed.reply).resolves.toEqual({ turns: ["from-b"] });
    expect(fixture.localCalls).toHaveLength(2);
    expect(fixture.lookups).toEqual([{ sessionUri: mine }, { sessionUri: there }]);
    const link = fixture.link("host-b");
    expect(link.requests.map((entry) => entry.method)).toEqual(["initialize", "fetchTurns"]);
    expect(link.requests[0]?.params).toEqual(INITIALIZE);
    expect(link.requests[1]?.params).toEqual({ channel: there, limit: 5 });
    expect(link.requests[1]?.ordered).toBe(false);

    // The link was dialled at the policy's endpoint with the caller's own handshake and a proof for host B alone.
    expect(fixture.connects).toHaveLength(1);
    const dialled = fixture.connects[0];
    assert.ok(dialled !== undefined);
    expect(dialled.hostId).toBe("host-b");
    expect(dialled.endpoint).toBe("ws://b.test/");
    expect(Object.keys(dialled.headers).sort()).toEqual([FORWARDED, PROOF]);
    const forwarded = dialled.headers[FORWARDED];
    const proof = dialled.headers[PROOF];
    assert.ok(forwarded !== undefined && proof !== undefined);
    expect(decodeForwarded(forwarded)).toEqual({ v: 1, hop: 1, headers: { authorization: "Bearer user-token" } });
    const expected = { purpose: "relay", bind: bindDigest(forwarded), operation: "route" } as const;
    // Another member, or other forwarded content, does not accept this proof.
    expect(fixture.admissions.c.verify(proof, expected)).toBeUndefined();
    expect(fixture.admissions.b.verify(proof, { ...expected, bind: bindDigest(`${forwarded}x`) })).toBeUndefined();
    expect(fixture.admissions.b.verify(proof, expected)).toEqual({ hostId: "host-a", instanceId: "host-a-instance", generation: "7", credentialId: "host-a-key" });

    // What host B sends after its reply is held until this caller's reply has been enqueued.
    const after = link.requests[1]?.after;
    assert.ok(after !== undefined);
    let released = false;
    void after.then(() => {
      released = true;
    });
    await turn();
    expect(released).toBe(false);
    routed.settle();
    await turn();
    expect(released).toBe(true);

    // The next request for that owner reuses the link: no second dial and no second initialize.
    await expect(fixture.request("fetchTurns", { channel: there })).resolves.toEqual({ turns: ["from-b"] });
    expect(fixture.connects).toHaveLength(1);
    expect(fixture.sends("host-b", "initialize")).toBe(1);
    expect(fixture.sends("host-b", "fetchTurns")).toBe(2);
    expect(fixture.localCalls).toHaveLength(2);
  });

  it("H5-04 a stale location is followed at most once", async () => {
    const moved = sessionUri("moved");
    /** A lookup that was paused returns host B after the session has moved, and host B refuses. */
    const routeWithStaleLookup = async (current: string, prepare: (fixture: Awaited<ReturnType<typeof createFixture>>) => void) => {
      const fixture = await createFixture();
      fixture.store.set(moved, "host-b");
      fixture.script("host-b", "fetchTurns", () => Promise.reject(refusal("host-b")));
      prepare(fixture);
      const paused = Promise.withResolvers<SessionLocation | undefined>();
      fixture.pauseNextLookup(paused.promise);
      const reply = settled(fixture.request("fetchTurns", { channel: moved }));
      // The lookup is in flight. Ownership changes underneath it.
      expect(fixture.lookups).toEqual([{ sessionUri: moved }]);
      expect(fixture.connects).toEqual([]);
      fixture.store.set(moved, current);
      paused.resolve(location(moved, "host-b"));
      return { fixture, outcome: await reply };
    };

    // The session moved to host C: one fresh lookup, one more send, C's reply.
    const followed = await routeWithStaleLookup("host-c", (fixture) => {
      fixture.script("host-c", "fetchTurns", () => Promise.resolve({ turns: ["from-c"] }));
    });
    expect(followed.outcome).toEqual({ status: "resolved", value: { turns: ["from-c"] } });
    expect(followed.fixture.lookups).toEqual([{ sessionUri: moved }, { sessionUri: moved }]);
    expect(followed.fixture.connects.map((entry) => entry.hostId)).toEqual(["host-b", "host-c"]);
    expect(followed.fixture.sends("host-b", "fetchTurns")).toBe(1);
    expect(followed.fixture.sends("host-c", "fetchTurns")).toBe(1);
    expect(followed.fixture.localCalls).toEqual([]);

    // Host C refuses as well: the caller gets that refusal and there is no third attempt.
    const refusedTwice = await routeWithStaleLookup("host-c", (fixture) => {
      fixture.script("host-c", "fetchTurns", () => Promise.reject(refusal("host-c")));
    });
    const second = rejection(refusedTwice.outcome);
    expect(second.code).toBe(REFUSAL_CODE);
    expect(second.message).toBe(REFUSAL_MESSAGE);
    expect(second.data).toEqual({ from: "host-c" });
    expect(refusedTwice.fixture.lookups).toHaveLength(2);
    expect(refusedTwice.fixture.connects.map((entry) => entry.hostId)).toEqual(["host-b", "host-c"]);
    expect(refusedTwice.fixture.sends("host-b", "fetchTurns")).toBe(1);
    expect(refusedTwice.fixture.sends("host-c", "fetchTurns")).toBe(1);
    expect(refusedTwice.fixture.localCalls).toEqual([]);

    // The fresh lookup still names host B: its refusal is the answer and nothing is sent again.
    const unchanged = await routeWithStaleLookup("host-b", () => undefined);
    const first = rejection(unchanged.outcome);
    expect(first.code).toBe(REFUSAL_CODE);
    expect(first.message).toBe(REFUSAL_MESSAGE);
    expect(first.data).toEqual({ from: "host-b" });
    expect(unchanged.fixture.lookups).toHaveLength(2);
    expect(unchanged.fixture.connects.map((entry) => entry.hostId)).toEqual(["host-b"]);
    expect(unchanged.fixture.sends("host-b", "fetchTurns")).toBe(1);
    expect(unchanged.fixture.localCalls).toEqual([]);
  });

  it("H5-05 a transport failure or unknown outcome is never retried", async () => {
    const target = sessionUri("uncertain");
    const failures: Record<string, { readonly error: RpcError; readonly arrange: (fixture: Awaited<ReturnType<typeof createFixture>>, error: RpcError) => void; readonly sent: number }> = {
      "the reply was lost after the request left": { error: routeOutcomeUnknown(), sent: 1, arrange: (fixture, error) => {
        fixture.script("host-b", "fetchTurns", () => Promise.reject(error));
      } },
      "the link closed before the request left": { error: routeUnavailable(), sent: 1, arrange: (fixture, error) => {
        fixture.script("host-b", "fetchTurns", () => Promise.reject(error));
      } },
      "the owner could not be reached": { error: routeUnavailable(), sent: 0, arrange: (fixture, error) => {
        fixture.failConnect("host-b", error);
      } },
    };
    for (const [label, failure] of Object.entries(failures)) {
      const fixture = await createFixture();
      fixture.store.set(target, "host-b");
      failure.arrange(fixture, failure.error);
      const reply = settled(fixture.request("fetchTurns", { channel: target }));
      // A fresh lookup would now name another owner. It must not be asked.
      fixture.store.set(target, "host-c");
      const error = rejection(await reply);
      expect(error.message, label).toBe(failure.error.message);
      expect(error.code, label).toBe(failure.error.code);
      expect(fixture.lookups, label).toEqual([{ sessionUri: target }]);
      expect(fixture.connects.map((entry) => entry.hostId), label).toEqual(["host-b"]);
      expect(fixture.sends("host-b", "fetchTurns"), label).toBe(failure.sent);
      expect(fixture.sends("host-c", "fetchTurns"), label).toBe(0);
      expect(fixture.localCalls, label).toEqual([]);
    }
    expect(routeOutcomeUnknown().message).toBe("Routed request outcome unknown");
  });

  it("H5-09 only listed, live, same-revision members are dialled", async () => {
    const target = sessionUri("elsewhere");
    const replaceB = (extra: Partial<HostMember>) => (rows: readonly HostMember[]): readonly HostMember[] =>
      rows.map((row) => row.hostId === "host-b" ? { ...row, ...extra } : row);
    const scenarios: Record<string, { readonly owner: string; readonly members: NonNullable<FixtureOptions["members"]> }> = {
      "a live host that trusted policy does not list": { owner: "host-x", members: (rows) => [...rows, member("host-x", { endpoint: "ws://x.test/" })] },
      "an endpoint that differs from the policy's": { owner: "host-b", members: replaceB({ endpoint: "ws://attacker.test/" }) },
      "another member's listed endpoint": { owner: "host-b", members: replaceB({ endpoint: "ws://c.test/" }) },
      "a member on another policy revision": { owner: "host-b", members: replaceB({ policyRevision: POLICY_REVISION + 1 }) },
      "a draining member": { owner: "host-b", members: replaceB({ role: "draining" }) },
      "a standby member": { owner: "host-b", members: replaceB({ role: "standby" }) },
      "a listed member with no live instance": { owner: "host-b", members: (rows) => rows.filter((row) => row.hostId !== "host-b") },
    };
    for (const [label, scenario] of Object.entries(scenarios)) {
      const fixture = await createFixture({ members: scenario.members });
      fixture.store.set(target, scenario.owner);
      const error = rejection(await settled(fixture.request("fetchTurns", { channel: target })));
      expect(error.message, label).toBe(routeUnavailable().message);
      expect(error.code, label).toBe(routeUnavailable().code);
      expect(fixture.connects, label).toEqual([]);
      // The request is not served from this host's own view either.
      expect(fixture.localCalls, label).toEqual([]);
      expect(fixture.router.stats(), label).toEqual({ connections: 1, links: 0, pending: 0, held: 0 });
    }
    // The same request reaches a member that satisfies every condition.
    const fixture = await createFixture();
    fixture.store.set(target, "host-b");
    await expect(fixture.request("fetchTurns", { channel: target })).resolves.toEqual({ from: "host-b", method: "fetchTurns" });
    expect(fixture.connects.map((entry) => entry.endpoint)).toEqual(["ws://b.test/"]);
  });

  it("H5-07 bounds links per connection", async () => {
    const onB = sessionUri("on-b");
    const onC = sessionUri("on-c");
    const bounded = await createFixture({ maxLinksPerConnection: 1 });
    bounded.store.set(onB, "host-b");
    bounded.store.set(onC, "host-c");
    await expect(bounded.request("fetchTurns", { channel: onB })).resolves.toEqual({ from: "host-b", method: "fetchTurns" });
    expect(bounded.router.stats()).toEqual({ connections: 1, links: 1, pending: 0, held: 0 });

    const refused = rejection(await settled(bounded.request("fetchTurns", { channel: onC })));
    expect(refused.message).toBe(routeUnavailable().message);
    expect(bounded.connects.map((entry) => entry.hostId)).toEqual(["host-b"]);
    expect(bounded.localCalls).toEqual([]);
    // The link that exists is unaffected.
    await expect(bounded.request("fetchTurns", { channel: onB })).resolves.toEqual({ from: "host-b", method: "fetchTurns" });
    expect(bounded.router.stats()).toEqual({ connections: 1, links: 1, pending: 0, held: 0 });

    // Closing the router closes every link of every connection and leaves nothing counted.
    const fixture = await createFixture();
    fixture.store.set(onB, "host-b");
    fixture.store.set(onC, "host-c");
    await fixture.request("fetchTurns", { channel: onB });
    const slow = Promise.withResolvers<unknown>();
    fixture.script("host-c", "fetchTurns", () => slow.promise);
    const inFlight = settled(fixture.request("fetchTurns", { channel: onC }));
    await turn();
    expect(fixture.router.stats()).toEqual({ connections: 1, links: 2, pending: 1, held: 0 });
    fixture.router.close();
    expect(fixture.link("host-b").closes()).toBe(1);
    expect(fixture.link("host-c").closes()).toBe(1);
    expect(fixture.contextCloses()).toBe(1);
    expect(fixture.router.stats()).toEqual({ connections: 0, links: 0, pending: 0, held: 0 });
    fixture.router.close();
    expect(fixture.link("host-b").closes()).toBe(1);
    expect(fixture.contextCloses()).toBe(1);
    slow.resolve("late");
    await inFlight;
    expect(fixture.router.stats()).toEqual({ connections: 0, links: 0, pending: 0, held: 0 });
  });

  it("H5-08 H5-03 forwarded headers never include hop-by-hop, framing or client-supplied internal headers", async () => {
    const target = sessionUri("elsewhere");
    const fixture = await createFixture({ handshakeHeaders: {
      "host": "public.example", "connection": "Upgrade", "upgrade": "websocket", "Transfer-Encoding": "chunked",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13",
      "x-ahp-host-proof": "forged", "x-ahp-host-forwarded": "forged", "X-AHP-Host-Role": "forged",
      "sec-websocket-protocol": "demo-x", "cookie": "a=b", "authorization": "Bearer user-token",
    } });
    fixture.store.set(target, "host-b");
    await fixture.request("fetchTurns", { channel: target });
    const dialled = fixture.connects[0];
    assert.ok(dialled !== undefined);
    const forwarded = dialled.headers[FORWARDED];
    const proof = dialled.headers[PROOF];
    assert.ok(forwarded !== undefined && proof !== undefined);
    expect(decodeForwarded(forwarded)).toEqual({ v: 1, hop: 1, headers: {
      "sec-websocket-protocol": "demo-x", "cookie": "a=b", "authorization": "Bearer user-token",
    } });
    // The internal headers on the link are this host's own, never the caller's.
    expect(Object.keys(dialled.headers).sort()).toEqual([FORWARDED, PROOF]);
    expect(forwarded).not.toBe("forged");
    expect(proof).not.toBe("forged");
    expect(fixture.admissions.b.verify(proof, { purpose: "relay", bind: bindDigest(forwarded), operation: "route" })?.hostId).toBe("host-a");
  });

  it("H6-05 actions from the local host and a remote owner are released in ascending order", async () => {
    const remote = sessionUri("r");
    const local = sessionUri("l");
    /** One public connection that already has a link to host B and has sent 11 then 12. */
    const afterOrderedRelease = async () => {
      const fixture = await createFixture({ local: [local] });
      fixture.store.set(remote, "host-b");
      await fixture.request("fetchTurns", { channel: remote });
      const link = fixture.link("host-b");
      const remoteConfirms = deferred();
      const localConfirms = deferred();
      fixture.script("host-b", SYNC, () => remoteConfirms.promise.then(() => ({ version: 1 })));
      fixture.pauseNextSettle(localConfirms.promise);

      // This host produced 12. Host B produced 11, and it arrives second.
      expect(fixture.context.send(action(12, local))).toBe(true);
      fixture.notifyFrom("host-b", action(11, remote));
      await turn();
      // Each waits for the other source to confirm it holds nothing older.
      expect(fixture.frames).toEqual([]);
      expect(link.requests.at(-1)).toMatchObject({ method: SYNC, params: { version: 1 }, ordered: true });
      expect(fixture.sends("host-b", SYNC)).toBe(1);
      expect(fixture.settles).toEqual([CONNECTION]);
      expect(fixture.router.stats()).toEqual({ connections: 1, links: 1, pending: 1, held: 2 });

      // 12 is confirmed, but the lower 11 is not: nothing may pass it.
      remoteConfirms.resolve();
      await turn();
      expect(fixture.frames).toEqual([]);
      localConfirms.resolve();
      await turn();
      // Ascending, and exactly as produced: no value is renumbered.
      expect(fixture.frames).toEqual([action(11, remote), action(12, local)]);
      expect(fixture.router.stats()).toEqual({ connections: 1, links: 1, pending: 0, held: 0 });
      expect(fixture.contextCloses()).toBe(0);
      return { fixture, link };
    };

    // A later remote action above the last one sent is delivered.
    const ascending = await afterOrderedRelease();
    ascending.fixture.notifyFrom("host-b", action(13, remote));
    await turn();
    expect(ascending.fixture.frames).toEqual([action(11, remote), action(12, local), action(13, remote)]);
    expect(ascending.fixture.contextCloses()).toBe(0);

    // One that is not above it ends the connection instead of being delivered.
    for (const stale of [12, 5]) {
      const { fixture, link } = await afterOrderedRelease();
      fixture.notifyFrom("host-b", action(stale, remote));
      await turn();
      expect(fixture.frames, String(stale)).toEqual([action(11, remote), action(12, local)]);
      expect(fixture.contextCloses(), String(stale)).toBe(1);
      expect(link.closes(), String(stale)).toBe(1);
      expect(fixture.router.stats(), String(stale)).toEqual({ connections: 0, links: 0, pending: 0, held: 0 });
    }
  });
});
