import { JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import type { TrustedHandshakeContext } from "@agents/types";
import { RpcError, parseUnknownJson, type JsonRpcMessage, type JsonRpcParams } from "@jsonrpc";
import type { HostMember } from "@persistence/helpers/durability/types";
import type { JsonRpcHandler, JsonRpcInvocation, WebSocketConnectionContext } from "@websocket/types";
import { HOST_FORWARDED_HEADER, HOST_FORWARDED_MAX_BYTES, HOST_PROOF_HEADER } from "../../constants";
import { bindDigest } from "../admission";
import { openHostLink, routeUnavailable } from "./link";
import { createOrderGate, type OrderGate } from "./order";
import type { ForwardedHandshake, HostLink, HostRouter, HostRouterOptions } from "./types";

const ROOT = "ahp-root://";
const SESSION_SCHEME = "ahp-session:";
const LOCAL = "local";
const ROOT_COUNT_ACTION = "root/activeSessionsChanged";
const HOP_HEADERS = new Set(["host", "connection", "upgrade", "content-length", "transfer-encoding", "keep-alive", "te", "trailer", "proxy-authorization", "proxy-connection"]);
const STICKY_FIELDS = ["callId", "continuationId", "subscriptionId"] as const;
const NEGOTIATION_METHODS: ReadonlySet<string> = new Set(["x-ahp/tools/capabilities", "x-ahp/tools/extensions"]);
const LOCATION_TTL_MS = 2_000;
const LIST_LIMIT = 1_000;

type Key = { readonly sessionUri: string } | { readonly workId: string } | { readonly hostId: string };
interface Route {
  readonly context: WebSocketConnectionContext;
  readonly send: WebSocketConnectionContext["send"];
  readonly links: Map<string, Promise<HostLink>>;
  readonly open: Map<string, HostLink>;
  readonly sticky: Map<string, string>;
  readonly channels: Map<string, string>;
  readonly counts: Map<string, number>;
  readonly gate: OrderGate;
  initialize?: { readonly clientId: string; readonly protocolVersions: readonly string[] };
  agentKey?: string;
  /** Connection-scoped negotiation the caller completed here. Each owner must see the same negotiation. */
  readonly negotiated: Map<string, unknown>;
  rootSubscribed: boolean;
  /** Highest native sequence value already sent on this connection. */
  lastSeq: number;
  closed: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => typeof value === "string" && value.length > 0 ? value : undefined;
const isRouteClosed = (route: Route): boolean => route.closed;

/**
 * Routes each request for a session owned by another host to that owner.
 *
 * The owner authenticates the original caller from the forwarded handshake and
 * evaluates every permission itself. This router forwards frames only: it
 * never forwards a decision, a role, a local proof object or a lease token as
 * authority. A relayed connection is served by the owner's unwrapped method
 * table, so a request is forwarded at most once.
 */
export const createHostRouter = (options: HostRouterOptions & {
  /** Execution epoch of the agent presence bound to a public connection, when one exists. */
  readonly presenceEpoch?: (connectionId: string) => string | undefined;
}): HostRouter => {
  const connect = options.connect ?? openHostLink;
  const handshakes = new Map<string, TrustedHandshakeContext>();
  const routes = new Map<string, Route>();
  const locations = new Map<string, { readonly hostId: string | undefined; readonly at: number }>();
  let members: { readonly rows: readonly HostMember[]; readonly at: number } | undefined;
  let closed = false;
  const isClosed = (): boolean => closed;

  const activeMembers = async (): Promise<readonly HostMember[]> => {
    const coordination = options.coordination();
    if (coordination === undefined) return [];
    if (members === undefined || performance.now() - members.at > LOCATION_TTL_MS) members = { rows: await coordination.members(), at: performance.now() };
    // Destinations come only from membership that trusted policy also lists, at this policy revision.
    return members.rows.filter((member) => member.hostId !== coordination.hostId && member.role === "active" && member.endpoint !== undefined
      && member.policyRevision === options.admission.policy.revision && options.admission.isMember(member.hostId)
      && options.admission.endpointAllowed(member.hostId, member.endpoint));
  };
  const owner = async (key: Key, fresh = false): Promise<string | undefined> => {
    if ("hostId" in key) return key.hostId;
    const coordination = options.coordination();
    if (coordination === undefined) return undefined;
    const id = "sessionUri" in key ? `s:${key.sessionUri}` : `w:${key.workId}`;
    const cached = locations.get(id);
    if (!fresh && cached !== undefined && performance.now() - cached.at <= LOCATION_TTL_MS) return cached.hostId;
    const location = await coordination.locate(key);
    const hostId = location === undefined || location.hostId === coordination.hostId ? undefined : location.hostId;
    if (locations.size >= 4_096) locations.clear();
    locations.set(id, { hostId, at: performance.now() });
    return hostId;
  };
  const keyOf = (route: Route, params: unknown): Key | undefined => {
    if (!isRecord(params)) return undefined;
    for (const field of STICKY_FIELDS) {
      const hostId = route.sticky.get(`${field}:${String(params[field])}`);
      if (hostId !== undefined) return { hostId };
    }
    const channel = text(params.channel);
    if (channel?.startsWith(SESSION_SCHEME)) {
      if (options.isLocal(channel)) return undefined;
      const subscribed = route.channels.get(channel);
      return subscribed === undefined ? { sessionUri: channel } : { hostId: subscribed };
    }
    const scope = Array.isArray(params.scope) ? (params.scope as unknown[])[0] : undefined;
    for (const locator of [params.session, params.resource, isRecord(params.route) ? params.route.origin : undefined, isRecord(scope) ? scope.resource : undefined]) {
      if (isRecord(locator) && locator.kind === "session") {
        const sessionUri = text(locator.id);
        if (sessionUri !== undefined) return options.isLocal(sessionUri) ? undefined : { sessionUri };
      }
    }
    for (const holder of [params, params.execution, params.work]) {
      const workId = isRecord(holder) ? text(holder.workId) : undefined;
      if (workId !== undefined) return { workId };
    }
    return undefined;
  };
  const remember = (route: Route, hostId: string, value: unknown): void => {
    if (!isRecord(value)) return;
    for (const field of STICKY_FIELDS) {
      const id = text(value[field]);
      if (id === undefined) continue;
      if (route.sticky.size >= 1_024) {
        const oldest = route.sticky.keys().next();
        if (!oldest.done) route.sticky.delete(oldest.value);
      }
      route.sticky.set(`${field}:${id}`, hostId);
    }
  };
  const fail = (route: Route): void => {
    if (route.closed) return;
    route.closed = true;
    routes.delete(route.context.connectionId);
    handshakes.delete(route.context.connectionId);
    route.gate.close();
    for (const link of route.open.values()) link.close();
    route.open.clear();
    route.links.clear();
    route.context.close();
  };
  /** Every open link can deliver, including one whose first subscription is still being answered. */
  const sources = (route: Route, except: string): string[] => [LOCAL, ...route.open.keys()].filter((source) => source !== except);
  const confirm = (route: Route, source: string): Promise<void> => {
    if (source === LOCAL) return options.settleLocal(route.context.connectionId);
    const link = route.open.get(source);
    return link === undefined ? Promise.resolve() : link.request("x-ahp-host/sync", { version: 1 }, undefined, true).then(() => undefined);
  };
  /** Sends one notification from a source in an order no client can observe as descending. */
  const emit = (route: Route, source: string, message: JsonRpcMessage, admission?: () => boolean): boolean => {
    if (route.closed) return false;
    const params = "method" in message && message.method === "action" && isRecord(message.params) ? message.params : undefined;
    const seq = typeof params?.serverSeq === "number" ? params.serverSeq : undefined;
    const action = params?.action;
    const count = params?.channel === ROOT && isRecord(action) && action.type === ROOT_COUNT_ACTION && typeof action.activeSessions === "number" ? action.activeSessions : undefined;
    const deliver = (guard?: () => boolean): boolean => {
      if (route.closed) return false;
      // The final check for every sequenced action, whatever path it took: a value at or below one
      // already sent is never delivered. The connection ends and the caller reconciles from snapshots.
      if (seq !== undefined && seq <= route.lastSeq) {
        fail(route);
        return false;
      }
      let outgoing = message;
      if (count !== undefined && params !== undefined && isRecord(action)) {
        // Each owner reports only the sessions it serves that this caller may see. The total is
        // taken when the action is released, so it reflects the order the caller observes.
        route.counts.set(source, count);
        let total = 0;
        for (const value of route.counts.values()) total += value;
        outgoing = { ...message, params: { ...params, action: { ...action, activeSessions: total } } };
      }
      const sent = guard === undefined ? route.send(outgoing) : route.send(outgoing, guard);
      if (sent && seq !== undefined) route.lastSeq = seq;
      return sent;
    };
    if ((seq === undefined || route.open.size === 0) && route.gate.idle()) return deliver(admission);
    // A held notification is admitted now, by the producer's own final guard, because that guard
    // describes this instant. At release only the connection's current security is checked again;
    // the hold is bounded by the order timeout.
    if (admission !== undefined) {
      let admitted = false;
      try {
        admitted = admission();
      } catch { /* Treated as a refusal. */ }
      if (!admitted) return false;
    }
    const release = (): boolean => route.context.isOpen?.() !== false && route.context.isSecurityCurrent?.() !== false && deliver();
    if (seq === undefined || route.open.size === 0) route.gate.push(source, undefined, release, []);
    else route.gate.push(source, seq, release, sources(route, source).map((other) => confirm(route, other)));
    return true;
  };
  const linkFor = (route: Route, hostId: string): Promise<HostLink> => {
    const existing = route.links.get(hostId);
    if (existing !== undefined) return existing;
    if (route.links.size >= options.maxLinksPerConnection) return Promise.reject(routeUnavailable());
    const opening = (async (): Promise<HostLink> => {
      const coordination = options.coordination();
      const handshake = handshakes.get(route.context.connectionId);
      const member = (await activeMembers()).find((row) => row.hostId === hostId);
      const endpoint = member?.endpoint;
      if (coordination === undefined || handshake === undefined || endpoint === undefined || route.initialize === undefined || route.closed || closed) throw routeUnavailable();
      const headers: Record<string, string | string[]> = {};
      for (const [name, value] of Object.entries(handshake.headers)) {
        const lower = name.toLowerCase();
        // The offered subprotocol can carry the caller's credential. Framing headers never do.
        if (value !== undefined && !HOP_HEADERS.has(lower) && !lower.startsWith("x-ahp-host-")
          && (lower === "sec-websocket-protocol" || !lower.startsWith("sec-websocket-"))) headers[lower] = value;
      }
      const forwarded = Buffer.from(JSON.stringify({ v: 1, hop: 1, headers,
        ...(handshake.remoteAddress === undefined ? {} : { remoteAddress: handshake.remoteAddress }) } satisfies ForwardedHandshake)).toString("base64url");
      if (forwarded.length > HOST_FORWARDED_MAX_BYTES) throw routeUnavailable();
      let proof: string;
      try {
        // The proof names this exact destination and binds the forwarded content.
        proof = options.admission.sign({ instanceId: coordination.instanceId, generation: coordination.generation, audience: hostId, purpose: "relay", bind: bindDigest(forwarded) });
      } catch {
        throw routeUnavailable();
      }
      const link = await connect({
        hostId, endpoint, headers: { [HOST_PROOF_HEADER]: proof, [HOST_FORWARDED_HEADER]: forwarded },
        connectTimeoutMs: Math.min(options.requestTimeoutMs, 10_000), requestTimeoutMs: options.requestTimeoutMs, maxPending: options.maxPending,
        ...(options.tls === undefined ? {} : { tls: options.tls }),
        onNotification: (message) => {
          emit(route, hostId, message);
        },
      });
      link.onClose(() => {
        if (route.open.get(hostId) !== link) return;
        // Subscriptions served by that owner are gone. The client reconnects and reconciles from snapshots.
        const subscribed = route.rootSubscribed || [...route.channels.values()].includes(hostId);
        route.open.delete(hostId);
        route.links.delete(hostId);
        route.counts.delete(hostId);
        if (subscribed) fail(route);
      });
      if (isRouteClosed(route) || isClosed()) {
        link.close();
        throw routeUnavailable();
      }
      route.open.set(hostId, link);
      try {
        await link.request("initialize", { channel: ROOT, clientId: route.initialize.clientId, protocolVersions: route.initialize.protocolVersions });
        // The owner negotiates private protocols itself, from the caller's own requests replayed in order.
        for (const [method, params] of route.negotiated) await link.request(method, params);
        const epoch = route.agentKey === undefined ? undefined : options.presenceEpoch?.(route.context.connectionId);
        if (route.agentKey !== undefined && epoch !== undefined) {
          await link.request("x-ahp-host/agents/attach", { version: 1, agentKey: route.agentKey, executionEpoch: epoch });
        }
      } catch (error) {
        link.close();
        throw error instanceof RpcError ? error : routeUnavailable();
      }
      return link;
    })();
    route.links.set(hostId, opening);
    opening.catch(() => {
      if (route.links.get(hostId) === opening) route.links.delete(hostId);
    });
    return opening;
  };
  const call = async (route: Route, hostId: string, method: string, params: unknown, invocation?: JsonRpcInvocation): Promise<unknown> => {
    const link = await linkFor(route, hostId);
    if (invocation?.kind === "notification") {
      link.notify(method, params);
      return null;
    }
    // Frames that arrive from this owner after its reply wait until the caller's reply has been enqueued.
    const settled = invocation === undefined
      ? undefined
      : new Promise<void>((resolve) => {
          invocation.onReplySettled(() => {
            resolve();
          });
        });
    const result = await link.request(method, params, settled);
    remember(route, hostId, result);
    return result;
  };
  /**
   * Records a subscription the owner just answered. If the owner's link closed while the answer was
   * on its way, the owner's side of the subscription is gone: answering would leave the caller
   * subscribed to nothing, so the connection ends and the caller reconnects and reconciles.
   */
  const subscribed = (route: Route, hostId: string, channel: string, before: HostLink | undefined): void => {
    const current = route.open.get(hostId);
    if (current === undefined || (before !== undefined && current !== before)) {
      fail(route);
      throw routeUnavailable();
    }
    route.channels.set(channel, hostId);
  };
  const forward = async (route: Route, key: Key, method: string, params: unknown, invocation: JsonRpcInvocation, local: () => unknown): Promise<unknown> => {
    const channel = isRecord(params) ? text(params.channel) : undefined;
    const served = async (hostId: string): Promise<unknown> => {
      const link = route.open.get(hostId);
      const result = await call(route, hostId, method, params, invocation);
      // Recorded before any later frame from that owner is handled.
      if (channel !== undefined && method === "subscribe") subscribed(route, hostId, channel, link);
      if (channel !== undefined && method === "unsubscribe") route.channels.delete(channel);
      return result;
    };
    const first = await owner(key);
    if (first === undefined) return local();
    try {
      return await served(first);
    } catch (error) {
      // A definite refusal may mean the session moved. Ask the store once more and
      // follow at most one change of owner. Transport failures are never retried.
      if (!(error instanceof RpcError) || error.code === JsonRpcErrorCodes.InternalError) throw error;
      // A subscribed channel is pinned to the owner that answered. After a refusal the store decides again.
      const subject: Key | undefined = !("hostId" in key) ? key : channel?.startsWith(SESSION_SCHEME) === true ? { sessionUri: channel } : undefined;
      if (subject === undefined) throw error;
      const next = await owner(subject, true);
      if (channel !== undefined && route.channels.get(channel) === first && next !== first) route.channels.delete(channel);
      if (next === first) throw error;
      if (next === undefined) return local();
      return served(next);
    }
  };
  const subscribeRoot = async (route: Route, invocation: JsonRpcInvocation): Promise<number> => {
    let total = 0;
    for (const member of await activeMembers()) {
      if (route.counts.has(member.hostId)) continue;
      try {
        const reply = await call(route, member.hostId, "subscribe", { channel: ROOT }, invocation);
        const state = isRecord(reply) && isRecord(reply.snapshot) ? reply.snapshot.state : undefined;
        const count = isRecord(state) && typeof state.activeSessions === "number" ? state.activeSessions : 0;
        route.counts.set(member.hostId, count);
        total += count;
      } catch {
        // An unreachable member contributes nothing rather than failing the caller's own view.
      }
    }
    return total;
  };
  const withRootCount = (route: Route, snapshot: unknown, remote: number): unknown => {
    if (!isRecord(snapshot) || snapshot.resource !== ROOT || !isRecord(snapshot.state)) return snapshot;
    const own = typeof snapshot.state.activeSessions === "number" ? snapshot.state.activeSessions : 0;
    route.counts.set(LOCAL, own);
    return typeof snapshot.state.activeSessions === "number" || remote > 0 ? { ...snapshot, state: { ...snapshot.state, activeSessions: own + remote } } : snapshot;
  };
  const initialize = async (route: Route, handler: JsonRpcHandler, params: JsonRpcParams, context: WebSocketConnectionContext, invocation: JsonRpcInvocation): Promise<unknown> => {
    if (!isRecord(params) || !Array.isArray(params.initialSubscriptions) || typeof params.clientId !== "string" || !Array.isArray(params.protocolVersions)) {
      const result = await handler(params, context, invocation);
      if (isRecord(params) && typeof params.clientId === "string" && Array.isArray(params.protocolVersions)) {
        route.initialize = { clientId: params.clientId, protocolVersions: params.protocolVersions.filter((entry): entry is string => typeof entry === "string") };
      }
      return result;
    }
    const remote: { readonly uri: string; readonly hostId: string }[] = [];
    const local: unknown[] = [];
    for (const uri of params.initialSubscriptions as unknown[]) {
      const hostId = typeof uri === "string" && uri.startsWith(SESSION_SCHEME) && !options.isLocal(uri) ? await owner({ sessionUri: uri }) : undefined;
      if (hostId === undefined || typeof uri !== "string") local.push(uri);
      else remote.push({ uri, hostId });
    }
    const result = await handler({ ...params, initialSubscriptions: local }, context, invocation);
    route.initialize = { clientId: params.clientId, protocolVersions: params.protocolVersions.filter((entry): entry is string => typeof entry === "string") };
    if (!isRecord(result) || !Array.isArray(result.snapshots)) return result;
    const snapshots: unknown[] = [...(result.snapshots as unknown[])];
    // The batch stays all-or-nothing: one refused remote subscription fails initialization.
    for (const { uri, hostId } of remote) {
      // What each owner sends after its snapshot waits until this reply has been enqueued.
      const link = route.open.get(hostId);
      const reply = await call(route, hostId, "subscribe", { channel: uri }, invocation);
      if (!isRecord(reply) || !isRecord(reply.snapshot)) throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Protected view unavailable");
      subscribed(route, hostId, uri, link);
      snapshots.push(reply.snapshot);
    }
    if (local.includes(ROOT)) {
      route.rootSubscribed = true;
      const others = await subscribeRoot(route, invocation);
      return { ...result, snapshots: snapshots.map((snapshot) => withRootCount(route, snapshot, others)) };
    }
    return { ...result, snapshots };
  };
  const list = async (route: Route, handler: JsonRpcHandler, params: JsonRpcParams, context: WebSocketConnectionContext, invocation: JsonRpcInvocation): Promise<unknown> => {
    const remotes = await activeMembers();
    if (remotes.length === 0 || !isRecord(params)) return handler(params, context, invocation);
    const limit = typeof params.limit === "number" && Number.isInteger(params.limit) && params.limit > 0 ? Math.min(params.limit, 100) : undefined;
    let offset = 0;
    if (params.cursor !== undefined) {
      const cursor: unknown = params.cursor;
      let decoded: unknown;
      try {
        // Only a string this host issued can be a cursor.
        decoded = typeof cursor === "string" ? parseUnknownJson(Buffer.from(cursor, "base64url").toString("utf8")) : undefined;
      } catch { /* Rejected below. */ }
      if (!isRecord(decoded) || decoded.v !== 1 || decoded.c !== context.connectionId || typeof decoded.o !== "number" || !Number.isInteger(decoded.o) || decoded.o < 0) {
        throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Invalid listSessions cursor");
      }
      offset = decoded.o;
    }
    // Each owner filters by its own current authority before anything is merged or counted.
    const collect = async (fetch: (page: Record<string, unknown>) => unknown): Promise<Record<string, unknown>[]> => {
      const rows: Record<string, unknown>[] = [];
      let cursor: unknown;
      for (;;) {
        const page = await fetch({ channel: ROOT, limit: 100, ...(cursor === undefined ? {} : { cursor }) });
        if (!isRecord(page) || !Array.isArray(page.items)) return rows;
        for (const item of page.items as unknown[]) if (isRecord(item) && rows.length < LIST_LIMIT) rows.push(item);
        cursor = page.nextCursor;
        if (cursor === undefined || rows.length >= LIST_LIMIT) return rows;
      }
    };
    const groups = await Promise.all([
      collect((page) => handler(page, context, invocation)),
      ...remotes.map((member) => collect((page) => call(route, member.hostId, "listSessions", page)).catch(() => [])),
    ]);
    const merged = groups.flat().sort((left, right) => {
      const a = String(left.modifiedAt);
      const b = String(right.modifiedAt);
      if (a !== b) return a < b ? 1 : -1;
      return String(left.resource) < String(right.resource) ? -1 : 1;
    });
    const page = limit === undefined ? merged.slice(offset) : merged.slice(offset, offset + limit);
    const next = offset + page.length;
    return { items: page, ...(limit !== undefined && next < merged.length
      ? { nextCursor: Buffer.from(JSON.stringify({ v: 1, o: next, c: context.connectionId })).toString("base64url") }
      : {}) };
  };

  return {
    wrapSetup: (adapter) => ({
      async prepare(input) {
        const prepared = await adapter.prepare(input);
        if (prepared !== undefined && !input.signal.aborted) {
          handshakes.set(input.fence.connectionId, input.handshake);
          // A setup that never attaches must not retain the caller's credential.
          input.signal.addEventListener("abort", () => {
            if (!routes.has(input.fence.connectionId)) handshakes.delete(input.fence.connectionId);
          }, { once: true });
        }
        return prepared;
      },
    }),
    attach(context) {
      if (closed || !handshakes.has(context.connectionId)) return;
      const route: Route = { context, send: context.send.bind(context), links: new Map(), open: new Map(), sticky: new Map(), channels: new Map(), counts: new Map(), negotiated: new Map(),
        rootSubscribed: false, lastSeq: 0, closed: false,
        gate: createOrderGate({ timeoutMs: options.orderTimeoutMs, onStalled: () => {
          fail(route);
        } }) };
      routes.set(context.connectionId, route);
      // Locally produced notifications join the same ordered stream as relayed ones.
      context.send = (message, admission) => "method" in message && !("id" in message) ? emit(route, LOCAL, message, admission) : route.send(message, admission);
      context.onClose(() => {
        fail(route);
      });
    },
    wrapHandlers(handlers) {
      const wrapped: Record<string, JsonRpcHandler> = {};
      for (const [method, handler] of Object.entries(handlers)) {
        wrapped[method] = (params, context, invocation) => {
          const route = routes.get(context.connectionId);
          if (route === undefined || route.closed) return handler(params, context, invocation);
          if (method === "initialize") return initialize(route, handler, params, context, invocation);
          if (method === "listSessions") return list(route, handler, params, context, invocation);
          const channel = isRecord(params) ? params.channel : undefined;
          if (channel === ROOT && method === "subscribe") {
            return Promise.resolve(handler(params, context, invocation)).then(async (result) => {
              route.rootSubscribed = true;
              const others = await subscribeRoot(route, invocation);
              return isRecord(result) ? { ...result, snapshot: withRootCount(route, result.snapshot, others) } : result;
            });
          }
          if (NEGOTIATION_METHODS.has(method)) {
            return Promise.resolve(handler(params, context, invocation)).then(async (result) => {
              // Negotiation has no session. It applies to the connection, so every owner link repeats it.
              route.negotiated.set(method, params);
              await Promise.allSettled([...route.open.values()].map((link) => link.request(method, params)));
              return result;
            });
          }
          if (method === "x-ahp/agents/register" || method === "x-ahp/agents/renew") {
            return Promise.resolve(handler(params, context, invocation)).then(async (result) => {
              if (method === "x-ahp/agents/register" && isRecord(params)) route.agentKey = text(params.agentKey);
              const epoch = route.agentKey === undefined ? undefined : options.presenceEpoch?.(context.connectionId);
              // The owning hosts learn the same presence. A refusal there surfaces on the next routed work request.
              if (route.agentKey !== undefined && epoch !== undefined) {
                await Promise.allSettled([...route.open.values()].map((link) => link.request("x-ahp-host/agents/attach", { version: 1, agentKey: route.agentKey, executionEpoch: epoch })));
              }
              return result;
            });
          }
          const key = keyOf(route, params);
          if (key === undefined) return handler(params, context, invocation);
          return forward(route, key, method, params, invocation, () => handler(params, context, invocation));
        };
      }
      return wrapped;
    },
    stats() {
      let links = 0;
      let pending = 0;
      let held = 0;
      for (const route of routes.values()) {
        links += route.open.size;
        held += route.gate.size();
        for (const link of route.open.values()) pending += link.pending();
      }
      return { connections: routes.size, links, pending, held };
    },
    invalidate() {
      locations.clear();
      members = undefined;
    },
    close() {
      closed = true;
      for (const route of [...routes.values()]) fail(route);
      handshakes.clear();
      locations.clear();
    },
  };
};
