import { ACTION_TYPE_SESSION_READY, ACTION_TYPE_SESSION_META_CHANGED, ACTION_TYPE_SESSION_SERVER_TOOLS_CHANGED, ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET, ACTION_TYPE_SESSION_ACTIVE_CLIENT_REMOVED, ACTION_TYPE_SESSION_TITLE_CHANGED, ACTION_TYPE_SESSION_IS_READ_CHANGED, ACTION_TYPE_SESSION_IS_ARCHIVED_CHANGED, ACTION_TYPE_SESSION_CREATION_FAILED } from "@sessions/constants";
import { randomUUID } from "node:crypto";
import type { SessionAction, SessionActiveClient, SessionState, SessionSummary, Snapshot } from "@microsoft/agent-host-protocol";
import { z } from "zod";
import { policyRefSchema } from "@authorization";
import type { LocalDecisionStamp, ResourceRef } from "@authorization";
import { sameResource } from "@authorization/helpers/context";
import { captureToolValue } from "@toolExecution/helpers/action/helpers";
import type { ClientToolRoute } from "@toolExecution/helpers/client/helpers/broker";
import type { ResourceViewCatalogue, ResourceViewOptions, ResourceViewProof, ResourceViewRecipient, ResourceViewRecord, ResourceViewSource } from "./types";

const exact = (value: unknown): boolean => {
  if (value !== true) void Promise.resolve(value).catch(() => undefined);
  return value === true;
};
const deny = (): never => {
  throw new Error("Protected view unavailable");
};
const limits = { maxBytes: 2 * 1024 * 1024, maxDepth: 64, maxKeys: 131072 };
const capture = <T>(value: T): T => captureToolValue(value, limits).value as T;
const clientView = (client: SessionActiveClient): SessionActiveClient => ({ clientId: client.clientId,
  ...(client.displayName === undefined ? {} : { displayName: client.displayName }), tools: [] });

/** Structured metadata projection only. Authored text is covered by resource read permission. */
export function projectSessionView(state: SessionState): SessionState {
  const projected = structuredClone(state);
  projected.activeClients = projected.activeClients.map(clientView);
  if (projected.serverTools !== undefined) projected.serverTools = [];
  if (projected._meta !== undefined) projected._meta = {};
  if (projected.customizations !== undefined) projected.customizations = [];
  if (projected.creationError !== undefined) projected.creationError = { errorType: "creationFailed", message: "Session creation failed" };
  return projected;
}

/** Whitelist native transitions whose projected reducer semantics have been established. */
export function projectSessionViewAction(action: SessionAction): SessionAction {
  switch (action.type) {
    case ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET: return { type: action.type, activeClient: clientView(action.activeClient) };
    case ACTION_TYPE_SESSION_ACTIVE_CLIENT_REMOVED: return { type: action.type, clientId: action.clientId };
    case ACTION_TYPE_SESSION_SERVER_TOOLS_CHANGED: return { type: action.type, tools: [] };
    case ACTION_TYPE_SESSION_META_CHANGED: return { type: action.type, _meta: {} };
    case ACTION_TYPE_SESSION_READY: return { type: action.type };
    case ACTION_TYPE_SESSION_CREATION_FAILED: return { type: action.type, error: { errorType: "creationFailed", message: "Session creation failed" } };
    case ACTION_TYPE_SESSION_TITLE_CHANGED: return { type: action.type, title: action.title };
    case ACTION_TYPE_SESSION_IS_READ_CHANGED: return { type: action.type, isRead: action.isRead };
    case ACTION_TYPE_SESSION_IS_ARCHIVED_CHANGED: return { type: action.type, isArchived: action.isArchived };
    default: return deny();
  }
}

/** One canonical policy path for native resource reads and embedding projections. */
export function createResourceViews(options: ResourceViewOptions, source: ResourceViewSource) {
  const registry = options.registry;
  const policies = options.policies;
  if (!exact(registry.usesPolicyFactory(policies)) || options.admitted.length < 1 || options.admitted.length > 128) throw new TypeError("Invalid resource view authority");
  const admitted = options.admitted.map((ref) => policyRefSchema.parse(ref));
  const resolve = options.resolve.bind(options);
  const select = policies.select.bind(policies);
  const read = registry.readBindings.bind(registry);
  const evaluate = registry.evaluate.bind(registry);
  const matches = registry.matchesAll.bind(registry);
  const captureFence = registry.captureFence.bind(registry);
  let disposed = false;
  let active = 0;
  const issued = new WeakMap<object, ResourceViewRecipient>();
  const cursors = new Map<string, { recipient: ResourceViewRecipient; proof: ResourceViewProof<readonly SessionSummary[]>; offset: number; expires: number }>();
  const live = (recipient: ResourceViewRecipient): boolean => !disposed && !recipient.signal.aborted;
  const makeProof = <T>(recipient: ResourceViewRecipient, value: T, stamps: readonly LocalDecisionStamp[], authorityFence: () => boolean, owned: () => boolean, basis: readonly ResourceRef[]): ResourceViewProof<T> => {
    const capturedStamps = Object.freeze([...stamps]);
    const proof = Object.freeze({
      value: capture(value), stamps: capturedStamps, basis: capture(basis),
      fence: () => exact(authorityFence()) && exact(owned()) && live(recipient),
      current: () => {
        try {
          return live(recipient) && exact(recipient.current()) && exact(owned())
            && matches(capturedStamps, recipient.actor) && exact(authorityFence()) && exact(owned()) && live(recipient) && exact(recipient.fence());
        } catch {
          return false;
        }
      },
    });
    issued.set(proof, recipient);
    return proof;
  };
  const mapProof = <T, U>(recipient: ResourceViewRecipient, proof: ResourceViewProof<T>, value: U): ResourceViewProof<U> => {
    const mapped = Object.freeze({ ...proof, value: capture(value) });
    issued.set(mapped, recipient);
    return mapped;
  };
  const authorize = async (recipient: ResourceViewRecipient, record: ResourceViewRecord): Promise<LocalDecisionStamp | undefined> => {
    if (!live(recipient) || record.resource.domainId !== recipient.actor.actor.principal.domainId) return undefined;
    const binding = read({ actor: recipient.actor.actor, scope: record.resource });
    if (binding.bindings.length > 128) return deny();
    const resolution = capture<ClientToolRoute>(await resolve({ actor: recipient.actor, resource: record.resource, signal: recipient.signal }));
    if (!sameResource(resolution.route.origin, record.resource)) return deny();
    const selected = await select({ sessionType: record.sessionType, providerId: record.providerId,
      context: { actor: recipient.actor, resource: record.resource, session: record.resource, input: null } });
    if (selected.effect !== "selected") return undefined;
    const alternatives = selected.alternatives.filter((ref) => admitted.some((allowed) => allowed.id === ref.id && allowed.revision === ref.revision));
    let attempts = 0;
    for (const entry of binding.bindings) for (const ref of alternatives) {
      if (!entry.policies.some((candidate) => candidate.id === ref.id && candidate.revision === ref.revision)) continue;
      attempts += 1;
      if (attempts > 128) return deny();
      const proof = await evaluate({ actor: recipient.actor, operation: "discover", bindingId: entry.id, policyRef: ref,
        scope: record.resource, route: resolution.route,
        ...(resolution.externalProofs === undefined ? {} : { externalProofs: resolution.externalProofs }),
        ...(resolution.mandatoryBindings === undefined ? {} : { mandatoryBindings: resolution.mandatoryBindings }) });
      if (!live(recipient)) return deny();
      if (proof.decision.effect === "allow" && proof.decision.reveal && !proof.decision.challengeRequired) return proof.stamp;
    }
    return undefined;
  };
  const run = async <T>(recipient: ResourceViewRecipient, work: (pending: () => boolean) => Promise<T>): Promise<T> => {
    if (!live(recipient) || active >= 64) return deny();
    active += 1;
    let waiting = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = Promise.resolve().then(() => work(() => waiting && live(recipient))).finally(() => {
      active -= 1;
    });
    try {
      return await Promise.race([pending, new Promise<never>((_yes, no) => {
        timer = setTimeout(() => {
          no(new Error("Protected view unavailable"));
        }, 5000);
      })]);
    } finally {
      waiting = false;
      clearTimeout(timer);
    }
  };
  const catalogue = async (recipient: ResourceViewRecipient, basis: ResourceViewCatalogue): Promise<ResourceViewProof<readonly SessionSummary[]>> => {
    if (basis.rows.length > 128) return deny();
    const fence = captureFence();
    const stamps: LocalDecisionStamp[] = [];
    const rows: SessionSummary[] = [];
    for (const row of basis.rows) {
      const current = source.record(row.summary.resource);
      if (current === undefined || !sameResource(current.resource, row.resource)) return deny();
      const stamp = await authorize(recipient, row);
      if (stamp !== undefined) {
        stamps.push(stamp);
        rows.push(row.summary);
      }
    }
    const proof = makeProof(recipient, rows, stamps, fence, basis.current.bind(basis), basis.rows.map((row) => row.resource));
    if (!proof.current()) return deny();
    return proof;
  };
  const snapshot = (recipient: ResourceViewRecipient, uri: string): Promise<ResourceViewProof<Snapshot>> => run(recipient, async () => {
    if (uri === "ahp-root://") {
      const basis = source.catalogue();
      const proof = await catalogue(recipient, basis);
      return mapProof(recipient, proof, { resource: uri, state: { agents: [], activeSessions: proof.value.length }, fromSeq: basis.fromSeq });
    }
    const record = source.record(uri);
    if (record === undefined) return deny();
    const owned = source.captureResourceFence(record.resource);
    const fence = captureFence();
    const stamp = await authorize(recipient, record);
    if (stamp === undefined) return deny();
    const state = source.snapshot(uri);
    if (state === undefined) return deny();
    const proof = makeProof(recipient, { ...state, state: projectSessionView(state.state) }, [stamp], fence, owned, [record.resource]);
    if (!proof.current()) return deny();
    return proof;
  });
  return Object.freeze({
    snapshot,
    current: (recipient: ResourceViewRecipient, proofs: readonly ResourceViewProof<unknown>[]): boolean => {
      try {
        return proofs.every((proof) => issued.get(proof) === recipient && proof.current()) && matches(proofs.flatMap((proof) => [...proof.stamps]), recipient.actor)
          && proofs.every((proof) => proof.fence()) && live(recipient) && exact(recipient.fence());
      } catch {
        return false;
      }
    },
    authorize: (recipient: ResourceViewRecipient, record: ResourceViewRecord) => run(recipient, async () => {
      const owned = source.captureResourceFence(record.resource);
      const fence = captureFence();
      const stamp = await authorize(recipient, record);
      if (stamp === undefined) return deny();
      const proof = makeProof(recipient, null, [stamp], fence, owned, [record.resource]);
      if (!proof.current()) return deny();
      return proof;
    }),
    catalogue: (recipient: ResourceViewRecipient, basis = source.catalogue()) => run(recipient, () => catalogue(recipient, basis)),
    list: (recipient: ResourceViewRecipient, params: unknown) => run(recipient, async (pending) => {
      const parsed = z.object({ channel: z.literal("ahp-root://"), limit: z.number().int().min(1).max(100).optional(), cursor: z.uuid().optional() }).parse(params);
      const now = Date.now();
      for (const [id, cursor] of cursors) if (cursor.expires <= now) cursors.delete(id);
      const prior = parsed.cursor === undefined ? undefined : cursors.get(parsed.cursor);
      if (parsed.cursor !== undefined && (prior === undefined || prior.recipient !== recipient || !prior.proof.current())) return deny();
      const proof = prior?.proof ?? await catalogue(recipient, source.catalogue());
      if (!pending() || !proof.current()) return deny();
      const offset = prior?.offset ?? 0;
      const end = Math.min(proof.value.length, offset + (parsed.limit ?? 100));
      let nextCursor: string | undefined;
      if (end < proof.value.length) {
        if (cursors.size >= 128) return deny();
        nextCursor = randomUUID();
      }
      const reply = mapProof(recipient, proof, { items: proof.value.slice(offset, end), ...(nextCursor === undefined ? {} : { nextCursor }) });
      if (nextCursor !== undefined) cursors.set(nextCursor, { recipient, proof, offset: end, expires: now + 30000 });
      if (parsed.cursor !== undefined) cursors.delete(parsed.cursor);
      return reply;
    }),
    forget: (recipient: ResourceViewRecipient): void => {
      for (const [id, cursor] of cursors) if (cursor.recipient === recipient) cursors.delete(id);
    },
    dispose: (): void => {
      disposed = true;
      cursors.clear();
    },
    stats: () => ({ active, cursors: cursors.size }),
  });
}
