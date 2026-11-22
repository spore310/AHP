import { AhpClient, type AhpTransport } from "@microsoft/agent-host-protocol/client";
import { sessionReducer, rootReducer, type RootState, type RootAction, type SessionState, type SessionAction } from "@microsoft/agent-host-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { AHPServerHandle, WebSocketConnectionContext } from "@websocket";
import { createToolPolicyHost, connectPolicyTransport, toolPolicyChannel as channel } from "./toolPolicyFixture";
import { FrameLog, responseWithId } from "./helpers";
import { contract } from "../toolExecution/fixtures";
import { toAhpToolDefinition } from "@tools";

// Observe the real supported binding; do not substitute the private kernel.
const contexts = vi.hoisted(() => new Map<string, WebSocketConnectionContext>());
vi.mock("@websocket/helpers/ahp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@websocket/helpers/ahp")>();
  return { ...actual, createAHPBinding: (...args: Parameters<typeof actual.createAHPBinding>) => {
    const binding = actual.createAHPBinding(...args);
    return { ...binding, onConnection: (context: WebSocketConnectionContext) => {
      contexts.set(context.connectionId, context);
      binding.onConnection(context);
    } };
  } };
});
const actionWithTitle = (title: string) => (frame: unknown): boolean => typeof frame === "object" && frame !== null
  && "method" in frame && frame.method === "action" && JSON.stringify(frame).includes(title);

const hosts: AHPServerHandle[] = [];
const sockets: WebSocket[] = [];
const clients: AhpClient[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await Promise.all(clients.splice(0).map((client) => client.shutdown()));
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
});
const setup = async (options: Parameters<typeof createToolPolicyHost>[1] = {}) => {
  const f = await createToolPolicyHost([{ ...contract, description: "HIDDEN-SCHEMA-CANARY" }], { ...options, protectedViews: true,
    roles: options.roles ?? { reader: ["discover"], stranger: [] } });
  hosts.push(f.host);
  const address = await f.host.start();
  const url = "ws://127.0.0.1:" + String(address.port) + "/capacity";
  const raw = async (token: string) => {
    const socket = new WebSocket(url, "r5-" + token);
    sockets.push(socket);
    const frames = new FrameLog(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    let id = 0;
    const request = (method: string, params: unknown) => {
      const next = ++id;
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: next, method, params }));
      return frames.waitFor(responseWithId(next));
    };
    const initialize = (uris: string[] = []) => request("initialize", { channel: "ahp-root://", clientId: token, protocolVersions: ["1.0.0"], initialSubscriptions: uris });
    return { socket, frames, request, initialize };
  };
  return { ...f, url, raw };
};

describe("P10 public host protected native egress", () => {
  it("V04 a failed repeated snapshot closes the old view after suppressing an in-flight event", async () => {
    let armed = false;
    let calls = 0;
    const eventEntered = Promise.withResolvers<undefined>();
    const snapshotEntered = Promise.withResolvers<undefined>();
    const event = Promise.withResolvers<"allow">();
    const snapshot = Promise.withResolvers<"deny">();
    const f = await setup({ permission: () => {
      if (!armed) return Promise.resolve("allow");
      calls += 1;
      if (calls === 1) {
        eventEntered.resolve(undefined);
        return event.promise;
      }
      if (calls === 2) {
        snapshotEntered.resolve(undefined);
        return snapshot.promise;
      }
      return Promise.resolve("allow");
    } });
    const reader = await f.raw("reader");
    await reader.initialize([channel]);
    armed = true;
    f.host.sessions.dispatchAction({ channel, clientId: "host", clientSeq: 1, action: { type: "session/titleChanged", title: "SUPPRESSED-EVENT-CANARY" } });
    await eventEntered.promise;
    const repeated = reader.request("subscribe", { channel }).catch(() => undefined);
    await snapshotEntered.promise;
    event.resolve("allow");
    // Released event work consists only of promise continuations. Drain that turn
    // before rejecting the separate snapshot; no wall-clock sleep selects the race.
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(reader.frames.frames.some(actionWithTitle("SUPPRESSED-EVENT-CANARY"))).toBe(false);
    snapshot.resolve("deny");
    await repeated;
    await vi.waitFor(() => {
      expect(reader.socket.readyState).toBe(WebSocket.CLOSED);
    });
  });
  for (const budget of ["count", "bytes"] as const) {
    it("V04 bounded " + budget + " closes a stalled delivery queue without flushing protected payloads", async () => {
      let armed = false;
      const entered = Promise.withResolvers<undefined>();
      const release = Promise.withResolvers<"allow">();
      const f = await setup({ permission: () => {
        if (armed) {
          entered.resolve(undefined);
          return release.promise;
        }
        return Promise.resolve("allow");
      } });
      const reader = await f.raw("reader");
      await reader.initialize([channel]);
      const closed = new Promise<void>((resolve) => reader.socket.once("close", () => {
        resolve();
      }));
      armed = true;
      const title = "QUEUE-SECRET-CANARY" + (budget === "bytes" ? "x".repeat(900000) : "");
      f.host.sessions.dispatchAction({ channel, clientId: "host", clientSeq: 1, action: { type: "session/titleChanged", title } });
      await entered.promise;
      const count = budget === "bytes" ? 4 : 260;
      for (let index = 2; index <= count; index += 1) f.host.sessions.dispatchAction({ channel, clientId: "host", clientSeq: index, action: { type: "session/titleChanged", title } });
      await closed;
      release.resolve("allow");
      expect(JSON.stringify(reader.frames.frames)).not.toContain("QUEUE-SECRET-CANARY");
    });
  }
  it("V03/V05 a real SDK root subscriber stays connected through an authorized canonical addition", async () => {
    const f = await setup({ creatorView: true, roles: { creator: ["discover"] } });
    const inner = await connectPolicyTransport(f.url, "creator");
    const wire: string[] = [];
    const transport: AhpTransport = { send: (message) => {
      inner.send(typeof message === "string" ? message : JSON.stringify(message));
    },
    close: () => inner.close(), recv: async () => {
      const frame = await inner.recv();
      if (frame?.kind === "text") wire.push(frame.text);
      return frame;
    } };
    const client = new AhpClient(transport);
    clients.push(client);
    client.connect();
    const initialized = await client.initialize({ clientId: "creator", protocolVersions: ["1.0.0"], initialSubscriptions: ["ahp-root://"] });
    const before = initialized.snapshots[0]?.state as RootState;
    expect(before).toEqual({ agents: [], activeSessions: 1 });
    const added = "ahp-session:/second-visible";
    await client.request("createSession", { channel: added, config: { "x-ahp-session-type": f.sessionHeader } });
    // The server sends this after canonical create/count publication. Its reply is
    // a causal ingress barrier; the repeated snapshot is the reducer comparison.
    await client.ping();
    const next = await client.subscribe("ahp-root://");
    const actions = wire.map((line) => JSON.parse(line) as { method?: string; params?: { channel?: string; action?: RootAction; summary?: { resource: string } } });
    expect(actions.some((frame) => frame.method === "root/sessionAdded" && frame.params?.summary?.resource === added)).toBe(true);
    const counts = actions.filter((frame) => frame.method === "action" && frame.params?.channel === "ahp-root://").map((frame) => frame.params?.action).filter((action): action is RootAction => action !== undefined);
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.reduce((state, action) => rootReducer(state, action), before)).toEqual(next.result.snapshot?.state);
    expect(next.result.snapshot?.state).toEqual({ agents: [], activeSessions: 2 });
    expect(wire.join("")).not.toContain("HIDDEN-SCHEMA-CANARY");
    f.host.sessions.dispatchAction({ channel, clientId: "host", clientSeq: 1, action: { type: "session/titleChanged", title: "Reordered first session" } });
    f.registry.invalidateExternal("catalogue-order-check");
    f.registry.drainInvalidations();
    await client.ping();
    expect((await client.subscribe("ahp-root://")).result.snapshot?.state).toEqual({ agents: [], activeSessions: 2 });
  });
  for (const outcome of ["allow", "deny"] as const) {
    it("V04 an abandoned invalidation refresh cannot revive or close an unsubscribed view: " + outcome, async () => {
      let armed = false;
      let blocked = false;
      const entered = Promise.withResolvers<undefined>();
      const release = Promise.withResolvers<"allow" | "deny">();
      const f = await setup({ permission: () => {
        if (armed && !blocked) {
          blocked = true;
          entered.resolve(undefined);
          return release.promise;
        }
        return Promise.resolve("allow");
      } });
      const reader = await f.raw("reader");
      await reader.initialize([channel]);
      armed = true;
      f.registry.invalidateExternal("refresh-check");
      f.registry.drainInvalidations();
      await entered.promise;
      reader.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "unsubscribe", params: { channel } }));
      await reader.request("ping", { channel: "ahp-root://" });
      release.resolve(outcome);
      expect(await reader.request("subscribe", { channel })).toMatchObject({ result: { snapshot: { resource: channel } } });
      f.host.sessions.dispatchAction({ channel, clientId: "host", clientSeq: 1, action: { type: "session/titleChanged", title: "REFRESH-DRAIN-BARRIER" } });
      await reader.frames.waitFor(actionWithTitle("REFRESH-DRAIN-BARRIER"));
      expect(reader.socket.readyState).toBe(WebSocket.OPEN);
    });
  }
  it("V03/V04 permission-only root membership gain closes the view without a fabricated native event", async () => {
    const f = await setup();
    const stranger = await f.raw("stranger");
    expect(await stranger.initialize(["ahp-root://"])).toMatchObject({ result: { snapshots: [{ state: { activeSessions: 0 } }] } });
    const scope = f.host.sessions.authorization?.getResource(channel);
    const actor = [...f.contexts.values()].find((record) => record.context.actor.principal.subject === "stranger")?.context.actor;
    if (scope === undefined || actor === undefined) throw new Error("Missing actual authority");
    const closed = new Promise<void>((resolve) => stranger.socket.once("close", () => {
      resolve();
    }));
    f.registry.installBinding({ id: "new-resource-read", actor, scope, roles: ["discover"], policies: [f.policy], revision: 1, authority: { kind: "host-policy", policy: f.policy } });
    f.registry.drainInvalidations();
    await closed;
    expect(JSON.stringify(stranger.frames.frames)).not.toContain(channel);
  });
  it("V02/V06 canonical advertisements stay internal in snapshots and accepted action frames", async () => {
    const f = await setup();
    const reader = await f.raw("reader");
    await reader.initialize([channel]);
    const registration = f.registrations[0];
    if (registration === undefined) throw new Error("Missing registration");
    const activeClient = { clientId: "trusted-host-advertiser", tools: [toAhpToolDefinition(registration.definition)] };
    const envelope = f.host.sessions.dispatchAction({ channel, clientId: activeClient.clientId, clientSeq: 1, action: { type: "session/activeClientSet", activeClient } });
    expect(envelope.rejectionReason).toBeUndefined();
    await reader.frames.waitFor((frame) => typeof frame === "object" && frame !== null && "method" in frame && frame.method === "action");
    expect(await reader.request("subscribe", { channel })).toMatchObject({ result: { snapshot: { state: { activeClients: [{ clientId: activeClient.clientId, tools: [] }] } } } });
    expect(JSON.stringify(reader.frames.frames)).not.toContain("HIDDEN-SCHEMA-CANARY");
    expect(JSON.stringify(f.host.sessions.getSessionSnapshot(channel)?.state.activeClients)).toContain("HIDDEN-SCHEMA-CANARY");
    reader.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "dispatchAction", params: { channel, clientSeq: 2,
      action: { type: "session/activeClientSet", activeClient: { clientId: "reader", tools: [{ name: "MALICIOUS-ECHO-CANARY" }] } } } }));
    await reader.request("ping", { channel: "ahp-root://" });
    expect(JSON.stringify(reader.frames.frames)).not.toContain("MALICIOUS-ECHO-CANARY");
    expect(f.host.sessions.getSessionSnapshot(channel)?.state.activeClients).toEqual([activeClient]);
  });
  for (const transition of ["unsubscribe", "resnapshot"] as const) {
    it("V04 an awaited event cannot cross " + transition + " ownership or regress the SDK view", async () => {
      let armed = false;
      let blocked = false;
      const entered = Promise.withResolvers<undefined>();
      const release = Promise.withResolvers<"allow">();
      const f = await setup({ permission: () => {
        if (armed && !blocked) {
          blocked = true;
          entered.resolve(undefined);
          return release.promise;
        }
        return Promise.resolve("allow");
      } });
      const reader = await f.raw("reader");
      await reader.initialize([channel]);
      armed = true;
      f.host.sessions.dispatchAction({ channel, clientId: "host", clientSeq: 1, action: { type: "session/titleChanged", title: "STALE-EVENT-CANARY" } });
      await entered.promise;
      if (transition === "unsubscribe") {
        reader.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "unsubscribe", params: { channel } }));
        await reader.request("ping", { channel: "ahp-root://" });
      }
      f.host.sessions.dispatchAction({ channel, clientId: "host", clientSeq: 2, action: { type: "session/titleChanged", title: "new snapshot" } });
      const snapshot = await reader.request("subscribe", { channel });
      expect(snapshot).toMatchObject({ result: { snapshot: { state: { title: "new snapshot" } } } });
      release.resolve("allow");
      f.host.sessions.dispatchAction({ channel, clientId: "host", clientSeq: 3, action: { type: "session/titleChanged", title: "QUEUE-DRAIN-BARRIER" } });
      await reader.frames.waitFor(actionWithTitle("QUEUE-DRAIN-BARRIER"));
      expect(reader.frames.frames.some(actionWithTitle("STALE-EVENT-CANARY"))).toBe(false);
    });
  }
  for (const boundary of ["snapshot", "repeated snapshot", "action"] as const) {
    it("V04 final transport setup revocation prevents " + boundary + " disclosure", async () => {
      let inSend = false;
      let revoked = false;
      const f = await setup({ onSecurityCheck: () => {
        if (!inSend || revoked) return;
        revoked = true;
        const scope = f.host.sessions.authorization?.getResource(channel);
        if (scope !== undefined) f.registry.removeBinding({ bindingId: "fixture-grant-reader", scope, revision: 1 });
      } });
      const reader = await f.raw("reader");
      await reader.initialize(boundary === "snapshot" ? [] : [channel]);
      const record = [...f.contexts.values()].find((entry) => entry.context.actor.principal.subject === "reader");
      const context = record === undefined ? undefined : contexts.get(record.context.connectionId);
      if (context === undefined) throw new Error("Missing actual transport context");
      const original = context.send.bind(context);
      vi.spyOn(context, "send").mockImplementation((...args) => {
        const message = args[0];
        inSend = boundary !== "action" ? "result" in message && JSON.stringify(message.result).includes(channel) : "method" in message && message.method === "action";
        try {
          return original(...args);
        } finally {
          inSend = false;
        }
      });
      if (boundary !== "action") {
        expect(await reader.request("subscribe", { channel })).toMatchObject({ error: { message: "Protected reply unavailable" } });
        if (boundary === "repeated snapshot") await vi.waitFor(() => {
          expect(reader.socket.readyState).toBe(WebSocket.CLOSED);
        });
      } else {
        const closed = new Promise<void>((resolve) => reader.socket.once("close", () => {
          resolve();
        }));
        f.host.sessions.dispatchAction({ channel, clientId: "host", clientSeq: 1, action: { type: "session/titleChanged", title: "FINAL-SEND-CANARY" } });
        await closed;
        expect(reader.frames.frames.some(actionWithTitle("FINAL-SEND-CANARY"))).toBe(false);
      }
      expect(revoked).toBe(true);
    });
  }
  it("V01 denied initial and mixed batches disclose nothing; a retry cannot retain denied subscriptions", async () => {
    const f = await setup();
    const stranger = await f.raw("stranger");
    expect(await stranger.request("initialize", { channel: "ahp-root://", clientId: "reader", protocolVersions: ["1.0.0"], initialSubscriptions: ["ahp-root://", channel] })).toMatchObject({ error: { message: "Protected view unavailable" } });
    expect(JSON.stringify(stranger.frames.frames)).not.toContain("HIDDEN-SCHEMA-CANARY");
    expect(await stranger.initialize(["ahp-root://"])).toMatchObject({ result: { snapshots: [{ state: { agents: [], activeSessions: 0 } }] } });
    expect(await stranger.request("subscribe", { channel })).toMatchObject({ error: { message: "Protected view unavailable" } });
    expect(await stranger.request("listSessions", { channel: "ahp-root://" })).toMatchObject({ result: { items: [] } });
    f.host.sessions.dispatchAction({ channel, clientId: "host", clientSeq: 1, action: { type: "session/titleChanged", title: "HIDDEN-TITLE-CANARY" } });
    await stranger.request("ping", { channel: "ahp-root://" });
    expect(JSON.stringify(stranger.frames.frames)).not.toContain("HIDDEN-TITLE-CANARY");
  });

  it("V02/V03 allowed root and repeated snapshots omit raw schemas and provider catalogue", async () => {
    const f = await setup();
    const reader = await f.raw("reader");
    expect(await reader.initialize(["ahp-root://", channel])).toMatchObject({ result: { snapshots: [{ state: { agents: [], activeSessions: 1 } }, { state: { _meta: {}, activeClients: [] } }] } });
    expect(await reader.request("subscribe", { channel })).toMatchObject({ result: { snapshot: { resource: channel, state: { _meta: {} } } } });
    expect(await reader.request("listSessions", { channel: "ahp-root://" })).toMatchObject({ result: { items: [{ resource: channel, provider: "mock" }] } });
    expect(JSON.stringify(reader.frames.frames)).not.toContain("HIDDEN-SCHEMA-CANARY");
    expect(JSON.stringify(f.host.sessions.getSessionSnapshot(channel))).toContain("HIDDEN-SCHEMA-CANARY");
  });

  it("V05/V07 actual SDK transport and reducer observe permitted authored text with genuine sequence", async () => {
    const f = await setup();
    const inner = await connectPolicyTransport(f.url, "reader");
    const wire: string[] = [];
    const transport: AhpTransport = { send: (message) => {
      inner.send(typeof message === "string" ? message : JSON.stringify(message));
    }, close: () => inner.close(), recv: async () => {
      const frame = await inner.recv();
      if (frame?.kind === "text") wire.push(frame.text);
      return frame;
    } };
    const client = new AhpClient(transport);
    clients.push(client);
    client.connect();
    const initialized = await client.initialize({ clientId: "reader", protocolVersions: ["1.0.0"], initialSubscriptions: [channel] });
    const before = initialized.snapshots[0]?.state as SessionState;
    const events = client.events();
    const delivered = events.next();
    const envelope = f.host.sessions.dispatchAction({ channel, clientId: "host", clientSeq: 1, action: { type: "session/titleChanged", title: "Authored HIDDEN-SCHEMA-CANARY" } });
    const received = await delivered;
    expect(received.done).toBe(false);
    const raw = wire.map((line) => JSON.parse(line) as { method?: string; params?: { action: SessionAction; serverSeq: number } }).find((message) => message.method === "action");
    expect(raw?.params?.serverSeq).toBe(envelope.serverSeq);
    const after = await client.subscribe(channel);
    expect(sessionReducer(before, raw?.params?.action as SessionAction)).toEqual(after.result.snapshot?.state);
    expect(JSON.stringify(wire)).toContain("Authored HIDDEN-SCHEMA-CANARY");
  });

  it("V04 revocation while an initial permission awaits drops snapshots and all buffered content", async () => {
    const gate = Promise.withResolvers<"allow">();
    let waiting = false;
    const entered = Promise.withResolvers<undefined>();
    const f = await setup({ permission: () => {
      if (waiting) {
        entered.resolve(undefined);
        return gate.promise;
      }
      return Promise.resolve("allow");
    } });
    const reader = await f.raw("reader");
    waiting = true;
    const response = reader.initialize([channel]);
    await entered.promise;
    f.host.sessions.dispatchAction({ channel, clientId: "host", clientSeq: 1, action: { type: "session/titleChanged", title: "BUFFERED-SECRET-CANARY" } });
    const scope = f.host.sessions.authorization?.getResource(channel);
    if (scope === undefined) throw new Error("Missing resource");
    expect(f.registry.removeBinding({ bindingId: "fixture-grant-reader", scope, revision: 1 })).toBe(true);
    gate.resolve("allow");
    expect(await response).toMatchObject({ error: { message: "Protected view unavailable" } });
    expect(JSON.stringify(reader.frames.frames)).not.toContain("BUFFERED-SECRET-CANARY");
    expect(JSON.stringify(reader.frames.frames)).not.toContain("HIDDEN-SCHEMA-CANARY");
  });
});
