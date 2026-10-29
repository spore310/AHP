import { ACTION_TYPE_SESSION_READY, ACTION_TYPE_SESSION_META_CHANGED, ACTION_TYPE_SESSION_SERVER_TOOLS_CHANGED, ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET, ACTION_TYPE_SESSION_ACTIVE_CLIENT_REMOVED, ACTION_TYPE_SESSION_TITLE_CHANGED, ACTION_TYPE_SESSION_IS_READ_CHANGED, ACTION_TYPE_SESSION_IS_ARCHIVED_CHANGED, ACTION_TYPE_SESSION_CREATION_FAILED } from "@sessions/constants";
import { describe, expect, it, vi } from "vitest";
import { sessionReducer, rootReducer, type SessionAction, type SessionState } from "@microsoft/agent-host-protocol";
import { ACTION_TYPE_ROOT_ACTIVE_SESSIONS_CHANGED, SESSION_LIFECYCLE_CREATING, SESSION_STATUS_IDLE } from "@sessions/constants";
import { createReferenceAuthorizer, type ResourceRef } from "@authorization";
import { createToolPolicyFactory } from "@toolPolicy";
import { createResourceViews, projectSessionView, projectSessionViewAction, type ResourceViewRecipient, type ResourceViewOptions } from "@toolExecution/helpers/views";

const fixture = (options: { reveal?: boolean; challenge?: boolean; admitted?: boolean; mandatory?: boolean; permission?: () => Promise<"allow" | "deny">; resolve?: ResourceViewOptions["resolve"] } = {}) => {
  const policy = { id: "resource-read", revision: 1 };
  const mandatory = { id: "mandatory-read", revision: 1 };
  const sessionType = { key: "view-session", version: 1 };
  const actor = { kind: "user" as const, principal: { domainId: "local", subject: "reader" } };
  const context = { actor, connectionId: "reader", authRevision: "one" };
  const policies = createToolPolicyFactory({ policies: [{ ...policy, operations: {
    discover: { actor: { mode: "direct-grant", actors: ["user"] }, reveal: options.reveal ?? true,
      ...(options.permission === undefined ? {} : { requiredPermissions: ["view"] }) },
  }, challenge: { required: options.challenge ?? false } }, { ...mandatory, operations: { discover: { actor: { mode: "direct-grant", actors: ["user"] }, reveal: true } }, challenge: { required: false } }],
  bindings: [{ sessionType, providerId: "provider-canary", admitted: { policies: [policy], namespaces: [] }, mandatory: options.mandatory === true ? [mandatory] : [] }] });
  const registry = createReferenceAuthorizer({ policies, now: Date.now, ...(options.permission === undefined ? {} : { permissionEvaluators: { view: options.permission } }) });
  registry.installAdmission({ sessionType, providerId: "provider-canary" });
  const records = new Map<string, { resource: ResourceRef; sessionType: typeof sessionType; providerId: string; state: SessionState }>();
  let revision = 0;
  const add = (id: string, granted: boolean) => {
    const resource = { domainId: "local", kind: "session", id: "ahp-session:/" + id, instanceId: String(++revision) };
    const route = { origin: resource, targets: [resource] };
    registry.installResource({ resource, route, owner: actor.principal, externalAuthority: "none", admission: { sessionType, providerId: "provider-canary" } });
    if (granted) registry.installBinding({ id, actor, scope: resource, policies: [policy], roles: [], revision: 1, authority: { kind: "host-policy", policy } });
    const record = { resource, sessionType, providerId: "provider-canary", state: { lifecycle: SESSION_LIFECYCLE_CREATING, status: SESSION_STATUS_IDLE, title: id, provider: "provider-canary", activeClients: [], chats: [],
      _meta: { "x-ahp-application": { toolContracts: [{ name: "SECRET-SCHEMA-CANARY" }] } } } as SessionState };
    records.set(resource.id, record);
    return record;
  };
  const source = {
    record: (uri: string) => records.get(uri),
    captureResourceFence: (resource: ResourceRef) => () => records.get(resource.id)?.resource === resource,
    snapshot: (uri: string) => {
      const record = records.get(uri);
      return record === undefined ? undefined : { resource: uri, fromSeq: revision, state: structuredClone(record.state) };
    },
    catalogue: () => {
      const captured = revision;
      return { fromSeq: captured, current: () => captured === revision, rows: [...records.values()].map((record) => ({ ...record,
        summary: { resource: record.resource.id, provider: record.providerId, title: record.state.title, status: SESSION_STATUS_IDLE, createdAt: "2026-01-01T00:00:00Z", modifiedAt: "2026-01-01T00:00:00Z" } })) };
    },
  };
  const recipient: ResourceViewRecipient = { actor: context, signal: new AbortController().signal, current: () => true, fence: () => true };
  const views = createResourceViews({ registry, policies, admitted: [options.admitted === false ? { id: "other", revision: 1 } : policy],
    resolve: options.resolve ?? (({ resource }) => ({ route: { origin: resource, targets: [resource] } })) }, source);
  return { registry, views, recipient, source, records, add };
};

describe("P10 recipient view projections", () => {
  it("V04 a timed-out list cannot publish a cursor when its resolver eventually settles", async () => {
    vi.useFakeTimers();
    try {
      const gate = Promise.withResolvers<undefined>();
      const f = fixture({ resolve: async ({ resource }) => {
        await gate.promise;
        return { route: { origin: resource, targets: [resource] } };
      } });
      f.add("one", true);
      f.add("two", true);
      const pending = f.views.list(f.recipient, { channel: "ahp-root://", limit: 1 }).catch(() => undefined);
      await vi.advanceTimersByTimeAsync(5001);
      expect(await pending).toBeUndefined();
      expect(f.views.stats().active).toBe(1);
      gate.resolve(undefined);
      await vi.waitFor(() => {
        expect(f.views.stats().active).toBe(0);
      });
      expect(f.views.stats().cursors).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("V04 disposal between catalogue authorization and list publication cannot recreate cursors", async () => {
    const f = fixture();
    f.add("one", true);
    f.add("two", true);
    const recipient = { ...f.recipient, current: () => {
      queueMicrotask(() => {
        f.views.dispose();
      });
      return true;
    } };
    await expect(f.views.list(recipient, { channel: "ahp-root://", limit: 1 })).rejects.toThrow();
    expect(f.views.stats().cursors).toBe(0);
  });
  it("V04 timed-out view resolution retains its bounded admission slot until actual settlement", async () => {
    vi.useFakeTimers();
    try {
      const gate = Promise.withResolvers<undefined>();
      const f = fixture({ resolve: async ({ resource }) => {
        await gate.promise;
        return { route: { origin: resource, targets: [resource] } };
      } });
      const record = f.add("one", true);
      const pending = Array.from({ length: 64 }, () => f.views.snapshot(f.recipient, record.resource.id).catch(() => undefined));
      expect(f.views.stats().active).toBe(64);
      await expect(f.views.snapshot(f.recipient, record.resource.id)).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(5001);
      await Promise.all(pending);
      expect(f.views.stats().active).toBe(64);
      gate.resolve(undefined);
      await vi.waitFor(() => {
        expect(f.views.stats().active).toBe(0);
      });
      f.views.dispose();
      await expect(f.views.snapshot(f.recipient, record.resource.id)).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("V04 ordinary source callbacks never run after aggregate freshness", async () => {
    const f = fixture();
    const record = f.add("one", true);
    const proof = await f.views.snapshot(f.recipient, record.resource.id);
    const read = vi.spyOn(f.source, "record").mockImplementation(() => {
      f.registry.teardown(record.resource);
      return record;
    });
    expect(f.views.current(f.recipient, [proof])).toBe(true);
    expect(read).not.toHaveBeenCalled();
    f.records.delete(record.resource.id);
    expect(f.views.current(f.recipient, [proof])).toBe(false);
  });
  it("V02/V05 projects every supported metadata transition with the actual SDK reducer", () => {
    let canonical: SessionState = { lifecycle: SESSION_LIFECYCLE_CREATING, provider: "mock", title: "title", status: SESSION_STATUS_IDLE, activeClients: [], chats: [] };
    let projected = projectSessionView(canonical);
    const tool = { name: "SCHEMA-CANARY", inputSchema: { type: "object", description: "SCHEMA-CANARY" } };
    const actions = [
      { type: ACTION_TYPE_SESSION_READY },
      { type: ACTION_TYPE_SESSION_META_CHANGED, _meta: { "x-ahp-application": { toolContracts: [tool] } } },
      { type: ACTION_TYPE_SESSION_SERVER_TOOLS_CHANGED, tools: [tool] },
      { type: ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET, activeClient: { clientId: "one", tools: [tool] } },
      { type: ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET, activeClient: { clientId: "one", displayName: "One", tools: [tool] } },
      { type: ACTION_TYPE_SESSION_TITLE_CHANGED, title: "authored SCHEMA-CANARY remains text" },
      { type: ACTION_TYPE_SESSION_IS_READ_CHANGED, isRead: true }, { type: ACTION_TYPE_SESSION_IS_ARCHIVED_CHANGED, isArchived: true },
      { type: ACTION_TYPE_SESSION_ACTIVE_CLIENT_REMOVED, clientId: "one" },
      { type: ACTION_TYPE_SESSION_CREATION_FAILED, error: { errorType: "SCHEMA-CANARY", message: "SCHEMA-CANARY" } },
    ] as SessionAction[];
    for (const action of actions) {
      canonical = sessionReducer(canonical, action);
      projected = sessionReducer(projected, projectSessionViewAction(action));
      expect(projected).toEqual(projectSessionView(canonical));
      expect(JSON.stringify({ ...projected, title: "" })).not.toContain("SCHEMA-CANARY");
    }
    expect(projected.title).toBe("authored SCHEMA-CANARY remains text");
    expect(canonical.serverTools).toEqual([tool]);
  });

  it("V01/V02/V06 requires actual grants and projects copies without canonical mutation", async () => {
    const f = fixture();
    const allowed = f.add("allowed", true);
    const hidden = f.add("hidden", false);
    await expect(f.views.snapshot(f.recipient, hidden.resource.id)).rejects.toThrow("Protected view unavailable");
    const proof = await f.views.snapshot(f.recipient, allowed.resource.id);
    expect(proof.current()).toBe(true);
    expect(f.views.current(f.recipient, [proof])).toBe(true);
    expect(f.views.current({ ...f.recipient }, [proof])).toBe(false);
    expect(f.views.current(f.recipient, [{ ...proof }])).toBe(false);
    expect(Object.isFrozen(proof)).toBe(true);
    expect(Object.isFrozen(proof.stamps)).toBe(true);
    expect(JSON.stringify(proof.value)).not.toContain("SECRET-SCHEMA-CANARY");
    expect(JSON.stringify(f.source.snapshot(allowed.resource.id))).toContain("SECRET-SCHEMA-CANARY");
    const other = { ...f.recipient, actor: { ...f.recipient.actor, actor: { ...f.recipient.actor.actor, principal: { domainId: "local", subject: "other" } } } };
    await expect(f.views.snapshot(other, allowed.resource.id)).rejects.toThrow();
  });

  for (const denied of [{ reveal: false }, { challenge: true }, { admitted: false }, { mandatory: true }, { permission: () => Promise.resolve("deny" as const) }]) {
    it("V01 denies absent resource disclosure consent or challenge/permission denial " + JSON.stringify(denied), async () => {
      const f = fixture(denied);
      const record = f.add("one", true);
      await expect(f.views.snapshot(f.recipient, record.resource.id)).rejects.toThrow();
    });
  }
  it("V01 denies provider substitution and a resolver that changes the canonical origin", async () => {
    const f = fixture();
    const record = f.add("one", true);
    record.providerId = "not-admitted";
    await expect(f.views.snapshot(f.recipient, record.resource.id)).rejects.toThrow();
    const substituted = fixture({ resolve: ({ resource }) => ({ route: { origin: { ...resource, instanceId: "substituted" }, targets: [resource] } }) });
    const other = substituted.add("two", true);
    await expect(substituted.views.snapshot(substituted.recipient, other.resource.id)).rejects.toThrow();
  });

  it("V03 filters before counts and opaque pagination; actor and stale catalogue cursors deny", async () => {
    const f = fixture();
    f.add("one", true);
    f.add("HIDDEN-ROW-CANARY", false);
    f.add("two", true);
    const root = await f.views.snapshot(f.recipient, "ahp-root://");
    expect(root.value.state).toEqual({ agents: [], activeSessions: 2 });
    expect(rootReducer({ agents: [], activeSessions: 0 }, { type: ACTION_TYPE_ROOT_ACTIVE_SESSIONS_CHANGED, activeSessions: 2 })).toEqual(root.value.state);
    const page = await f.views.list(f.recipient, { channel: "ahp-root://", limit: 1 });
    expect(page.value.items.map((row) => row.title)).toEqual(["one"]);
    expect(JSON.stringify(page.value)).not.toContain("HIDDEN");
    expect(page.value.nextCursor).toMatch(/^[a-f0-9-]{36}$/);
    await expect(f.views.list({ ...f.recipient }, { channel: "ahp-root://", cursor: page.value.nextCursor })).rejects.toThrow();
    const next = await f.views.list(f.recipient, { channel: "ahp-root://", cursor: page.value.nextCursor });
    expect(next.value.items.map((row) => row.title)).toEqual(["two"]);
    const stale = await f.views.list(f.recipient, { channel: "ahp-root://", limit: 1 });
    f.add("three", true);
    expect(stale.current()).toBe(false);
    await expect(f.views.list(f.recipient, { channel: "ahp-root://", cursor: stale.value.nextCursor })).rejects.toThrow();
  });

  it("V04 denies a stale resource incarnation and revocation during asynchronous permission", async () => {
    const waiting: { value?: Promise<"allow"> } = {};
    const f = fixture({ permission: () => waiting.value ?? Promise.resolve("allow") });
    const record = f.add("one", true);
    const proof = await f.views.snapshot(f.recipient, record.resource.id);
    const gate = Promise.withResolvers<"allow">();
    waiting.value = gate.promise;
    const pending = f.views.snapshot(f.recipient, record.resource.id);
    await Promise.resolve();
    await Promise.resolve();
    f.registry.teardown(record.resource);
    gate.resolve("allow");
    await expect(pending).rejects.toThrow();
    expect(proof.current()).toBe(false);
    f.records.delete(record.resource.id);
    f.add("one", true);
    expect(proof.current()).toBe(false);
  });

  it("V04 a final recipient callback revocation cannot pass an already prepared proof", async () => {
    const f = fixture();
    const record = f.add("one", true);
    let revoke = false;
    const recipient = { ...f.recipient, current: () => {
      if (revoke) f.registry.teardown(record.resource);
      return true;
    } };
    const proof = await f.views.snapshot(recipient, record.resource.id);
    revoke = true;
    expect(proof.current()).toBe(false);
  });
});
