import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ResourceRef, ResourceRegistration, ResourceInstallationToken, ScopedPolicyBinding } from "@authorization";
import type { CapturedCreationSecurity } from "../creation/helpers";
import { sameResource } from "@authorization/helpers/context";
import { resourceKey } from "@authorization/helpers/resources";
import { RepositoryError } from "@persistence/types";
import { captureData, captureRef, resourceOrder } from "@persistence/helpers/durability/helpers";
import type { Admission, DurableHost, ResourceRecord, StoredSession } from "@persistence/helpers/durability/types";
import type { ProviderSessionInput, SessionBackend, SessionRecord, SessionsFactoryOptions, SessionsDependencies } from "@sessions/types";
import { encodeState, restoreState } from "../durability/helpers";
import { createInitialSessionState } from "../state";
import type { RuntimeResourceContext, RuntimeResourceHandle, SessionResourceLifecycle } from "../resources/types";
import { projectSessionToolManifest } from "../application/manifest";
import { APPLICATION_META_KEY } from "@tool";
import { ACTION_TYPE_SESSION_READY } from "@sessions/constants";
import { sessionReducer } from "@microsoft/agent-host-protocol";

function unavailable(): never {
  throw new Error("Durable session unavailable.");
}
class ProvisioningUnavailable extends Error {}
interface Live {
  readonly root: ResourceRecord;
  readonly controller: AbortController;
  readonly providerResources: AbortController;
  readonly handles: Map<string, RuntimeResourceHandle>;
  readonly attachments: Map<string, Promise<void>>;
  readonly installations: Map<string, { row: ResourceRecord; token: ResourceInstallationToken }>;
  readonly deferred: Map<string, ResourceRecord>;
  replay?: { children: Set<ResourceRecord>; parents: Set<string> };
  readonly retiring: Set<string>;
  readonly pendingExternal: Set<string>;
  revision: string;
}
function facts(registration: ResourceRegistration) {
  return captureData({ version: 1, route: registration.route, mandatory: registration.mandatory ?? [], ...(registration.allowedRoutes ? { allowedRoutes: registration.allowedRoutes } : {}), externalAuthority: registration.externalAuthority, admission: registration.admission });
}
export function captureProviderLifecycle(provider: SessionRecord["provider"]) {
  const drivers = provider.drivers?.map((driver) => Object.freeze({ key: driver.key, version: driver.version, kind: driver.kind,
    ...(driver.data ? { data: Object.freeze({ parse: driver.data.parse.bind(driver.data) }) } : {}),
    ...(driver.registration ? { registration: driver.registration.bind(driver) } : {}),
    captureRecoveryInput: driver.captureRecoveryInput.bind(driver), ensure: driver.ensure.bind(driver), restore: driver.restore.bind(driver), destroy: driver.destroy.bind(driver) }));
  if (drivers && new Set(drivers.map((d) => JSON.stringify([d.key, d.version]))).size !== drivers.length) throw new Error("Duplicate resource driver.");
  return { ...(drivers ? { drivers: Object.freeze(drivers) } : {}), ...(provider.recovery ? { recovery: Object.freeze({ version: provider.recovery.version, capture: provider.recovery.capture.bind(provider.recovery) }) } : {}),
    ...(provider.restoreSession ? { restoreSession: provider.restoreSession.bind(provider) } : {}), ...(provider.retireSession ? { retireSession: provider.retireSession.bind(provider) } : {}) };
}

export function createDurableLifecycle(options: NonNullable<SessionsFactoryOptions["durability"]>, deps: SessionsDependencies, security: CapturedCreationSecurity) {
  const { storage, hostId, maxCallbacks = 32, callbackDeadlineMs = 30000 } = options;
  if (!hostId.trim() || !Number.isSafeInteger(maxCallbacks) || maxCallbacks < 1 || maxCallbacks > 1024
    || !Number.isSafeInteger(callbackDeadlineMs) || callbackDeadlineMs < 1 || callbackDeadlineMs > 300000) throw new Error("Invalid durable host options.");
  let host: DurableHost | undefined;
  let closed = false;
  let withdraw: ((record: SessionRecord) => void) | undefined;
  const outstanding = { lifecycle: 0, cleanup: 0 };
  const deferredReleases: Array<() => void> = [];
  const live = new Map<SessionRecord, Live>();
  const diagnostics = new Map<string, { session: ResourceRef<"session">; reason: string }>();
  function diagnose(session: ResourceRef<"session">, reason: string): void {
    if (!diagnostics.has(session.instanceId) && diagnostics.size >= 256) {
      const oldest = diagnostics.keys().next();
      if (!oldest.done) diagnostics.delete(oldest.value);
    }
    diagnostics.set(session.instanceId, { session, reason });
  }
  const store = () => host?.isOpen() && !closed ? host : unavailable();
  const state = (record: SessionRecord) => live.get(record) ?? unavailable();
  const open = (entry: Live) => !closed && host?.isOpen() === true && !entry.controller.signal.aborted;
  const resourcesOpen = (entry: Live) => open(entry) && !entry.providerResources.signal.aborted;
  const driverFor = (record: SessionRecord, row: Pick<ResourceRecord, "driver" | "ref">) => record.provider.drivers?.find((d) => d.key === row.driver.key && d.version === row.driver.version && d.kind === row.ref.kind) ?? unavailable();
  const context = (r: ResourceRecord, signal: AbortSignal): RuntimeResourceContext => Object.freeze({ resource: captureRef(r.ref), session: captureRef(r.session),
    operationId: r.operationId, recoveryInput: captureData(r.recoveryInput), runtimeMetadata: r.ref.kind === "session" ? captureData(r.runtimeMetadata.receipt ?? {}) : captureData(r.runtimeMetadata), signal });

  async function callback<T>(work: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, late?: (value: T) => Promise<void> | void, lane: keyof typeof outstanding = "lifecycle", pending?: { entry: Live; id: string }): Promise<T> {
    if (outstanding[lane] >= maxCallbacks || parent.aborted) unavailable();
    outstanding[lane]++;
    pending?.entry.pendingExternal.add(pending.id);
    const deadline = new AbortController();
    const signal = AbortSignal.any([parent, deadline.signal]);
    let reject = (): void => undefined;
    const aborted = new Promise<never>((_, fail) => {
      reject = () => {
        fail(new Error("Lifecycle callback cancelled."));
      };
    });
    signal.addEventListener("abort", reject, { once: true });
    const timer = setTimeout(() => {
      deadline.abort();
    }, callbackDeadlineMs);
    const operation = Promise.resolve().then(() => {
      if (signal.aborted) unavailable();
      return work(signal);
    }).then(async (value) => {
      if (signal.aborted) {
        await late?.(value);
        unavailable();
      }
      return value;
    }).finally(() => {
      outstanding[lane]--;
      pending?.entry.pendingExternal.delete(pending.id);
      if (lane === "cleanup") deferredReleases.shift()?.();
    });
    try {
      return await Promise.race([operation, aborted]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", reject);
    }
  }
  function releaseOwned(session: ResourceRef<"session">, operation: () => void | Promise<void>): Promise<void> {
    const release = () => callback(() => Promise.resolve(operation()), new AbortController().signal, undefined, "cleanup");
    if (outstanding.cleanup < maxCallbacks) return release();
    // Each detached handle transfers its single release here. A timed-out callback
    // still owns the slot until it settles, even after the host has stopped.
    deferredReleases.push(() => {
      void release().catch(() => {
        diagnose(session, "Deferred resource release was not confirmed.");
      });
    });
    return Promise.reject(new Error("Resource release awaits a cleanup slot."));
  }
  function childRegistration(record: SessionRecord, row: ResourceRecord): ResourceRegistration {
    const type = record.application ?? unavailable();
    const driver = driverFor(record, row);
    const rules = driver.registration?.(Object.freeze({ resource: captureRef(row.ref), session: captureRef(row.session), parent: captureRef(row.parent ?? unavailable()),
      ...(row.grantParent ? { grantParent: captureRef(row.grantParent) } : {}) }));
    return { resource: row.ref, owner: { domainId: row.ref.domainId, subject: row.owner },
      route: rules?.route ?? { origin: row.session, targets: [row.ref] }, externalAuthority: rules?.externalAuthority ?? "none",
      ...(rules?.allowedRoutes ? { allowedRoutes: rules.allowedRoutes } : {}), ...(rules?.mandatory ? { mandatory: rules.mandatory } : {}),
      ...(row.grantParent ? { grantParent: row.grantParent } : {}),
      admission: { sessionType: { key: type.key, version: type.version }, providerId: record.provider.providerId } };
  }
  function installed(entry: Live, ref: ResourceRef, checked = new Set<string>()): boolean {
    if (sameResource(ref, entry.root.ref)) return resourcesOpen(entry);
    const key = resourceKey(ref);
    if (checked.has(key)) return true;
    const installation = entry.installations.get(key);
    if (!installation || entry.retiring.has(installation.row.operationId) || !security.registry.isResourceInstallationCurrent(installation.token)) return false;
    checked.add(key);
    return [installation.row.parent, installation.row.grantParent].every((parent) => !parent || installed(entry, parent, checked));
  }
  function parentsInstalled(entry: Live, row: ResourceRecord): boolean {
    return [row.parent, row.grantParent].every((parent) => !parent || installed(entry, parent));
  }
  function attachChild(record: SessionRecord, row: ResourceRecord): Promise<void> {
    const entry = state(record);
    if (!resourcesOpen(entry) || entry.retiring.has(row.operationId)) unavailable();
    const attaching = entry.attachments.get(row.operationId);
    if (attaching) return attaching;
    if (entry.handles.has(row.operationId)) return Promise.resolve();
    // Nested creates can be awaited by the parent driver itself. Return their
    // reserved identity now; provisioning starts when both parents are installed.
    if (!parentsInstalled(entry, row)) {
      entry.deferred.set(row.operationId, row);
      return Promise.resolve();
    }
    entry.deferred.delete(row.operationId);
    const operation = Promise.resolve().then(() => installChild(record, row)).finally(() => {
      entry.attachments.delete(row.operationId);
    });
    entry.attachments.set(row.operationId, operation);
    return operation;
  }
  async function installChild(record: SessionRecord, row: ResourceRecord): Promise<void> {
    const entry = state(record);
    const current = () => resourcesOpen(entry) && !entry.retiring.has(row.operationId) && parentsInstalled(entry, row);
    if (!current()) unavailable();
    if (!sameResource(row.session, entry.root.session) || row.ref.domainId !== entry.root.ref.domainId || row.owner !== entry.root.owner
      || row.providerId !== entry.root.providerId || !row.parent || row.ref.kind === "session") unavailable();
    const driver = driverFor(record, row);
    const registration = childRegistration(record, row);
    if (!isDeepStrictEqual(row.registration, facts(registration))) unavailable();
    const token = security.registry.prepareResourceInstallation(registration);
    let handle: RuntimeResourceHandle;
    // Failed initial ensures have no committed receipt. Legacy failed restore
    // rows can still carry their driver's metadata; current restore failures suspend.
    const provisioning = row.lifecycle === "creating" || (row.lifecycle === "failed" && Object.keys(row.runtimeMetadata).length === 0);
    const replay = entry.replay;
    const parentKey = resourceKey(row.ref);
    replay?.parents.add(parentKey);
    try {
      handle = await callback((signal) => provisioning ? driver.ensure(context(row, signal)) : driver.restore(context(row, signal)),
        AbortSignal.any([entry.controller.signal, entry.providerResources.signal]), (h) => h.release("creation-cancelled"), "lifecycle", { entry, id: row.operationId });
    } catch (error) {
      if (current()) {
        diagnose(row.session, "A resource driver did not complete provisioning or restoration.");
        if (!entry.pendingExternal.has(row.operationId)) {
          const next = provisioning ? "failed" : "suspended";
          await store().resources.activate({ ref: row.ref, session: row.session, operationId: row.operationId, expected: row.lifecycle, next }, current);
        }
        if (row.lifecycle === "failed" && provisioning) throw new ProvisioningUnavailable("Resource provisioning unavailable.", { cause: error });
      }
      throw error;
    } finally {
      replay?.parents.delete(parentKey);
    }
    let activated = false;
    try {
      await store().resources.activate({ ref: row.ref, session: row.session, expected: row.lifecycle, next: "active", operationId: row.operationId,
        runtimeMetadata: captureData(handle.metadata) }, current);
      activated = true;
      if (!current()) unavailable();
      security.registry.installResource(registration, token);
      entry.installations.set(resourceKey(row.ref), { row, token });
      entry.handles.set(row.operationId, handle);
    } catch (error) {
      try {
        security.registry.teardownInstalledResource(token);
        if (current() && (activated || (error instanceof Error && error.name === "DurableCommitUncertain"))) await quarantine(record);
      } finally {
        await releaseOwned(row.session, () => handle.release("creation-cancelled"));
      }
      throw error;
    }
    for (const child of entry.deferred.values()) {
      if (parentsInstalled(entry, child)) void attachChild(record, child).catch(() => {
        diagnose(row.session, "A dependent resource has not completed attachment.");
      });
    }
  }
  async function destroy(record: SessionRecord, rows: readonly ResourceRecord[]): Promise<void> {
    const entry = state(record);
    const failures: unknown[] = [];
    for (const row of rows) {
      entry.retiring.add(row.operationId);
      entry.deferred.delete(row.operationId);
      const key = resourceKey(row.ref);
      const installation = entry.installations.get(key);
      if (installation) {
        entry.installations.delete(key);
        security.registry.teardownInstalledResource(installation.token);
      }
    }
    const failedParents: ResourceRef[] = [];
    for (const row of resourceOrder(rows).reverse()) {
      try {
        if (failedParents.some((ref) => sameResource(ref, row.ref)) || entry.pendingExternal.has(row.operationId)) unavailable();
        const signal = new AbortController().signal;
        if (row.ref.kind === "session") {
          const retire = record.provider.retireSession?.bind(record.provider) ?? unavailable();
          await callback((s) => retire(context(row, s)), signal, undefined, "cleanup");
          await store().sessions.finishRetirement(row.session);
        } else {
          const driver = driverFor(record, row);
          await callback((s) => driver.destroy(context(row, s)), signal, undefined, "cleanup");
          await store().resources.finishRetirement(row.session, row.ref);
        }
      } catch (error) {
        for (const p of [row.parent, row.grantParent]) if (p) failedParents.push(p);
        failures.push(error);
      } finally {
        const handle = entry.handles.get(row.operationId);
        entry.handles.delete(row.operationId);
        try {
          if (handle) await releaseOwned(row.session, () => handle.release("resource-retired"));
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length) throw new Error("Durable retirement requires retry.");
  }
  function capability(record: SessionRecord): SessionResourceLifecycle {
    const entry = state(record);
    const root = entry.root;
    const current = () => resourcesOpen(entry);
    const canRead = (row: ResourceRecord) => installed(entry, row.ref)
      || (row.lifecycle === "creating" && entry.pendingExternal.has(row.operationId) && !entry.retiring.has(row.operationId) && parentsInstalled(entry, row));
    const owned = async (ref: ResourceRef) => {
      if (!current()) unavailable();
      const row = await store().resources.get(captureRef(ref));
      if (!current() || !row || !sameResource(row.session, root.session) || !["creating", "active"].includes(row.lifecycle) || !canRead(row)) unavailable();
      return row;
    };
    return Object.freeze<SessionResourceLifecycle>({
      async create(input) {
        if (!current() || input.kind === "session") unavailable();
        const parent = captureRef(input.parent);
        const grantParent = input.grantParent && captureRef(input.grantParent);
        const replay = entry.replay;
        const replayingParent = replay && [parent, grantParent].some((ref) => ref && replay.parents.has(resourceKey(ref)));
        const saved = replayingParent ? [...replay.children].find((child) => child.ref.kind === input.kind && child.ref.id === input.id) : undefined;
        const ref = saved?.ref ?? captureRef({ domainId: root.ref.domainId, kind: input.kind, id: input.id, instanceId: randomUUID() });
        const driver = driverFor(record, { ref, driver: input.driver });
        const data = captureData(input.data ?? {});
        const recoveryInput = captureData(driver.captureRecoveryInput(captureData(input.recoveryInput ?? {})));
        if (saved && replay) {
          if (!saved.parent || !sameResource(saved.parent, parent) || !isDeepStrictEqual(saved.grantParent, grantParent)
            || saved.driver.key !== driver.key || saved.driver.version !== driver.version || !isDeepStrictEqual(saved.recoveryInput, recoveryInput)
            || saved.lifecycle === "retiring") unavailable();
          replay.children.delete(saved);
          await attachChild(record, saved);
          return ref;
        }
        const now = deps.now().toISOString();
        const row: ResourceRecord = { ...root, ref, parent, ...(grantParent ? { grantParent } : {}), driver: { key: driver.key, version: driver.version },
          registration: facts(childRegistration(record, { ...root, ref, parent, grantParent, driver })),
          operationId: randomUUID(), lifecycle: "creating", resourceRevision: "1", dataRevision: "1",
          data: driver.data ? captureData(driver.data.parse(data)) : data, recoveryInput,
          runtimeMetadata: {}, createdAt: now, modifiedAt: now };
        await store().resources.reserve(row, current);
        await attachChild(record, row);
        return ref;
      },
      async readData(ref) {
        const row = await owned(ref);
        return { data: row.data, dataRevision: row.dataRevision };
      },
      async replaceData(input, change, admission = () => true) {
        const ref = captureRef(input);
        const expectedDataRevision = change.expectedDataRevision;
        const data = captureData(change.data);
        const row = await owned(ref);
        const contract = row.ref.kind !== "session" ? driverFor(record, row).data : undefined;
        return store().resources.replaceData(root.session, ref, { data: contract ? captureData(contract.parse(data)) : data, expectedDataRevision },
          () => {
            const allowed: unknown = admission();
            if (allowed !== true) void Promise.resolve(allowed).catch(() => undefined);
            return allowed === true && current() && canRead(row);
          });
      },
      async retire(input) {
        const ref = captureRef(input);
        if (ref.kind === "session") unavailable();
        const rows = await guardedRetirement(record, () => store().resources.beginRetirement(root.session, ref, current));
        await destroy(record, rows);
      },
    });
  }

  function track(record: SessionRecord, root: ResourceRecord, revision: string): Live {
    const entry: Live = { root, revision, controller: new AbortController(), providerResources: new AbortController(),
      handles: new Map(), attachments: new Map(), deferred: new Map(), installations: new Map(), retiring: new Set(), pendingExternal: new Set() };
    live.set(record, entry);
    return entry;
  }
  async function backend(record: SessionRecord, workingDirectories: readonly string[], config: Readonly<Record<string, unknown>>,
    recovery?: { restore: boolean; expected: ResourceRecord["lifecycle"]; current: Admission }): Promise<SessionBackend> {
    const entry = state(record);
    const root = entry.root;
    const resources = capability(record);
    const handle = await callback((signal) => {
      const input: ProviderSessionInput = Object.freeze({ ...context(root, signal), sessionUri: record.sessionUri, workingDirectories, config, resources });
      return recovery?.restore ? (record.provider.restoreSession?.(input) ?? unavailable()) : record.provider.startSession(input);
    }, entry.controller.signal, (b) => b.dispose(), "lifecycle", { entry, id: root.operationId }).catch((error: unknown) => {
      entry.providerResources.abort();
      throw error;
    }).finally(() => entry.replay?.parents.delete(resourceKey(root.ref)));
    try {
      await store().sessions.transition({ ref: root.ref, session: root.session, operationId: root.operationId, expected: recovery?.expected ?? root.lifecycle, next: "active",
        runtimeMetadata: captureData({ receipt: captureData(handle.metadata ?? {}) }) }, () => open(entry) && (recovery === undefined || recovery.current() === true));
      if (!open(entry)) unavailable();
      return handle;
    } catch (error) {
      await quarantine(record, handle);
      throw error;
    }
  }
  async function releaseHandles(entry: Live, backend?: SessionBackend): Promise<void> {
    entry.deferred.clear();
    delete entry.replay;
    let failed = false;
    for (const { token } of entry.installations.values()) {
      try {
        security.registry.teardownInstalledResource(token);
      } catch { failed = true; }
    }
    entry.installations.clear();
    const cleanup = [...entry.handles.values()].reverse().map((h) => () => h.release("host-shutdown"));
    entry.handles.clear();
    if (backend) cleanup.push(() => backend.dispose());
    for (const operation of cleanup) {
      try {
        await releaseOwned(entry.root.session, operation);
      } catch {
        failed = true;
      }
    }
    if (failed) {
      diagnose(entry.root.session, "A process-local release has not been confirmed.");
      throw new Error("Resource release failed.");
    }
  }
  async function release(record: SessionRecord): Promise<void> {
    const entry = live.get(record);
    if (!entry) return;
    entry.controller.abort();
    live.delete(record);
    const backend = record.backend;
    delete record.backend;
    await releaseHandles(entry, backend);
  }
  async function guardedRetirement(record: SessionRecord, begin: () => Promise<readonly ResourceRecord[]>) {
    try {
      return await begin();
    } catch (error) {
      if (error instanceof Error && error.name === "DurableCommitUncertain") await quarantine(record);
      throw error;
    }
  }
  function releaseBackend(record: SessionRecord, backend: SessionBackend): Promise<void> {
    return releaseOwned(record.resource ?? unavailable(), () => backend.dispose());
  }
  async function quarantine(record: SessionRecord, detachedBackend?: SessionBackend): Promise<void> {
    const entry = live.get(record);
    const detached = entry && detachedBackend === record.backend ? undefined : detachedBackend;
    try {
      if (entry) {
        entry.controller.abort();
        try {
          if (deps.sessions.get(record.sessionUri) === record) deps.sessions.delete(record.sessionUri);
          withdraw?.(record);
          diagnose(entry.root.session, "Storage acknowledgement unavailable. Recover this incarnation before use.");
        } finally {
          await release(record);
        }
      }
    } finally {
      if (detached) await releaseBackend(record, detached);
    }
  }
  const departing = new Set<string>();
  /** Sessions whose retirement has started here. A retirement is final: such a session is never moved. */
  const retiringSessions = new Set<string>();
  const busy = (instanceId: string): boolean => departing.has(instanceId) || retiringSessions.has(instanceId)
    || [...live.values()].some((entry) => entry.root.session.instanceId === instanceId);
  type Install = (record: SessionRecord, owner: string, bindings: readonly ScopedPolicyBinding[], current: () => boolean) => void;
  /** Restores one stored session this host owns. A failed restoration suspends it and returns nothing. */
  async function recover(s: StoredSession, install: Install, teardown: (record: SessionRecord) => void): Promise<SessionRecord | undefined> {
    const root = await store().resources.get(s.ref) ?? unavailable();
    let record: SessionRecord | undefined;
    try {
      const type = deps.application?.catalogue.resolveExisting(s.type) ?? unavailable();
      const provider = deps.providers.get(s.providerId) ?? unavailable();
      if (type.definition.id !== s.type.id || !isDeepStrictEqual(type.definition.work ?? [], s.type.workManifest ?? [])
        || type.definition.providerId !== s.providerId || root.driver.key !== provider.providerId
        || root.driver.version !== provider.recovery?.version || root.owner !== s.owner || root.providerId !== s.providerId) unavailable();
      const registration: ResourceRegistration = { resource: s.ref, owner: { domainId: s.ref.domainId, subject: s.owner }, route: { origin: s.ref, targets: [s.ref] }, externalAuthority: "none",
        admission: { sessionType: { key: s.type.key, version: s.type.version }, providerId: s.providerId } };
      if (!isDeepStrictEqual(root.registration, facts(registration))) unavailable();
      const view = s.lifecycle === "retiring"
        ? createInitialSessionState({ providerId: s.providerId, title: "", workingDirectories: [] })
        : restoreState(s.providerId, s.state);
      const tools = type.definition.tools;
      record = { resource: captureRef(s.ref), sessionUri: s.ref.id, provider, createdAt: s.createdAt, modifiedAt: s.modifiedAt, serverSeq: s.lastServerSeq,
        state: { ...view, _meta: { [APPLICATION_META_KEY]: projectSessionToolManifest(s.type, type.tools, tools) } },
        application: { typeId: s.type.id, key: s.type.key, version: s.type.version, config: {}, tools } };
      const entry = track(record, root, s.stateRevision);
      const children = resourceOrder(await store().resources.listSession(s.ref));
      for (const child of children) {
        if (child.ref.kind !== "session" && child.lifecycle !== "retired") {
          driverFor(record, child);
          for (const parent of [child.parent, child.grantParent]) {
            if (parent && !children.some((r) => sameResource(r.ref, parent) && r.lifecycle !== "retired")) unavailable();
          }
          if (!sameResource(child.session, s.ref) || child.ref.domainId !== s.ref.domainId || child.owner !== s.owner
            || child.providerId !== s.providerId || !isDeepStrictEqual(child.registration, facts(childRegistration(record, child)))) unavailable();
        }
      }
      if (s.lifecycle === "retiring") {
        await destroy(record, await store().sessions.beginRetirement(s.ref, () => open(entry)));
        await release(record);
        return undefined;
      }
      const approval = type.policy?.restoration ?? unavailable();
      const approved = await callback((signal) => approval.prepare({ session: structuredClone(s), signal }), entry.controller.signal);
      if (!approved) unavailable();
      const current = () => open(entry) && (approved.isCurrent() as unknown) === true;
      if (!current()) unavailable();
      install(record, s.owner, approved.bindings, current);
      const restore = Object.hasOwn(root.runtimeMetadata, "receipt");
      let expected = root.lifecycle;
      if (!restore && (expected === "failed" || expected === "suspended")) {
        await store().sessions.transition({ ref: s.ref, session: s.ref, operationId: root.operationId, expected, next: "creating" }, current);
        expected = "creating";
      }
      entry.replay = { children: new Set(children.filter((row) => row.ref.kind !== "session" && row.lifecycle !== "retired")),
        parents: new Set(restore ? [] : [resourceKey(root.ref)]) };
      const restoredBackend = await backend(record, view.workingDirectories ?? [], {}, { restore, expected, current });
      record.backend = restoredBackend;
      const remaining = resourceOrder(await store().resources.listSession(s.ref));
      const retiring = remaining.filter((child) => child.lifecycle === "retiring");
      if (retiring.length) await destroy(record, retiring);
      const unavailableParents: ResourceRef[] = [];
      for (const child of remaining) {
        if (child.ref.kind === "session" || child.lifecycle === "retired") continue;
        if (child.lifecycle === "retiring" || entry.handles.has(child.operationId)) continue;
        if ([child.parent, child.grantParent].some((parent) => parent && unavailableParents.some((ref) => sameResource(ref, parent)))) {
          unavailableParents.push(child.ref);
          continue;
        }
        try {
          await attachChild(record, child);
        } catch (error) {
          if (!(error instanceof ProvisioningUnavailable)) throw error;
          unavailableParents.push(child.ref);
        }
      }
      delete entry.replay;
      record.state = sessionReducer(record.state, { type: ACTION_TYPE_SESSION_READY });
      if (!approved.isCurrent()) unavailable();
      return record;
    } catch (error) {
      if (!host?.isOpen() || (error instanceof RepositoryError && error.code === "database")) throw new Error("Storage unavailable during recovery.", { cause: error });
      let cleanupFailed = false;
      if (record) {
        try {
          teardown(record);
        } catch { cleanupFailed = true; }
        if (deps.sessions.get(s.ref.id) === record) deps.sessions.delete(s.ref.id);
        try {
          await release(record);
        } catch { cleanupFailed = true; }
      }
      if (s.lifecycle !== "retiring") {
        const current = await store().resources.get(s.ref) ?? unavailable();
        await store().sessions.transition({ ref: s.ref, session: s.ref, expected: current.lifecycle, next: "suspended", operationId: root.operationId }, () => !closed);
      }
      diagnose(s.ref, cleanupFailed ? "Recovery failed and process-local release was not confirmed." : "Check exact type, provider, drivers and restoration approval.");
    }
    return undefined;
  }
  let install: Install | undefined;
  return {
    closeAdmission() {
      closed = true;
      for (const entry of live.values()) entry.controller.abort();
    },
    backend, release, releaseBackend, quarantine, inspect: () => structuredClone([...diagnostics.values()]),
    isOpen: () => !closed && host?.isOpen() === true,
    purge: (ref: ResourceRef<"session">, cutoff: string) => store().sessions.purge(ref, cutoff),
    async reserve(prepared: { record: SessionRecord; config: Readonly<Record<string, unknown>> }, registration: ResourceRegistration, admission: Admission) {
      const { record } = prepared;
      const ref = captureRef(record.resource ?? unavailable());
      const binding = record.application ?? unavailable();
      const recovery = record.provider.recovery ?? unavailable();
      const definition = deps.application?.catalogue.resolveExisting(binding).definition ?? unavailable();
      const type = { id: binding.typeId, key: binding.key, version: binding.version, workManifest: definition.work ?? [] };
      const root: ResourceRecord = { ref, session: ref, owner: registration.owner.subject, providerId: record.provider.providerId,
        registration: facts(registration), operationId: randomUUID(), driver: { key: record.provider.providerId, version: recovery.version }, lifecycle: "creating",
        data: {}, dataRevision: "1", resourceRevision: "1", recoveryInput: captureData(recovery.capture(prepared.config)), runtimeMetadata: {}, createdAt: record.createdAt, modifiedAt: record.modifiedAt };
      await store().sessions.reserve({ ref, type, owner: root.owner, providerId: root.providerId, lifecycle: "creating", state: encodeState(record.state),
        stateRevision: "1", graphRevision: "1", lastServerSeq: 0, createdAt: record.createdAt, modifiedAt: record.modifiedAt }, root, admission);
      if (!closed) track(record, root, "1");
    },
    async attachmentFailed(record: SessionRecord) {
      const entry = live.get(record);
      if (!entry || !open(entry)) return;
      try {
        await store().sessions.transition({ ref: entry.root.ref, session: entry.root.session, expected: "creating", next: "suspended", operationId: entry.root.operationId }, () => open(entry));
      } finally {
        diagnose(entry.root.session, "Creation authority installation failed. Fresh restoration approval is required.");
        await release(record);
      }
    },
    async fail(record: SessionRecord) {
      const entry = state(record);
      const root = entry.root;
      entry.providerResources.abort();
      await releaseHandles(entry).catch(() => { /* The unconfirmed cleanup is diagnosed by releaseHandles. */ });
      await store().sessions.transition({ ref: root.ref, session: root.session, expected: "creating", next: "failed", operationId: root.operationId }, () => open(entry));
    },
    async commit(record: SessionRecord, staged: SessionRecord, admission: Admission, quarantineOnUnknown = true) {
      const entry = state(record);
      try {
        entry.revision = await store().sessions.commitState({ ref: entry.root.session, expectedRevision: entry.revision, state: encodeState(staged.state),
          modifiedAt: staged.modifiedAt, serverSeq: staged.serverSeq }, () => open(entry) && admission() === true);
      } catch (error) {
        if (quarantineOnUnknown && error instanceof Error && error.name === "DurableCommitUncertain") await quarantine(record);
        throw error;
      }
    },
    async retire(record: SessionRecord, hide: () => void, admission: Admission) {
      const entry = state(record);
      const instanceId = entry.root.session.instanceId;
      // Marked before the first await: a transfer that arrives while the retirement commits is refused
      // before it withdraws anything, instead of tearing down the handles this retirement still needs.
      retiringSessions.add(instanceId);
      try {
        const rows = await guardedRetirement(record, () => store().sessions.beginRetirement(entry.root.session, () => !closed && live.get(record) === entry && admission() === true));
        entry.controller.abort();
        hide();
        try {
          await destroy(record, rows);
        } finally {
          await release(record);
        }
      } finally {
        retiringSessions.delete(instanceId);
      }
    },
    /**
     * Restores sessions this host owns that are not live yet, for example after
     * another host transferred them here or this host adopted them.
     */
    async recoverOwned(onRestored?: (record: SessionRecord) => void): Promise<readonly SessionRecord[]> {
      const restore = install ?? unavailable();
      const teardown = withdraw ?? unavailable();
      const recovered: SessionRecord[] = [];
      let failure: unknown;
      let after: string | undefined;
      const absent = (ref: ResourceRef<"session">): boolean => {
        const present = deps.sessions.get(ref.id);
        // Owned in the store and absent from the registry also describes a session that is
        // being retired, or that is between its local withdrawal and its durable move.
        return !(present?.resource && sameResource(present.resource, ref)) && !busy(ref.instanceId);
      };
      for (;;) {
        const page: readonly StoredSession[] = await store().sessions.listRecoverable(after);
        if (!page.length) break;
        for (const listed of page) {
          const from = after;
          after = listed.ref.instanceId;
          if (!absent(listed.ref)) continue;
          // An earlier restoration on this page can take as long as a provider callback. The page is
          // stale by then, so each session is read again and restored only if this host still owns it,
          // it is not retired, and nothing started serving or moving it in the meantime.
          const owned = await store().sessions.listRecoverable(from);
          const s = owned.find((row) => sameResource(row.ref, listed.ref));
          if (s === undefined || !absent(s.ref)) continue;
          try {
            const record = await recover(s, restore, teardown);
            if (record) {
              recovered.push(record);
              // Reported as each one is restored: a failure later in the same pass must not hide it.
              try {
                onRestored?.(record);
              } catch { /* The session is restored and live whatever its observer does. */ }
            }
          } catch (error) {
            // One session that cannot be settled does not hold back the others. The caller retries the pass.
            if (!host?.isOpen() || closed) throw error;
            // A storage failure can interrupt a restoration after its record was built. That record is
            // withdrawn and released here, so the next pass finds the session absent and tries again
            // instead of skipping it as busy.
            for (const [partial, entry] of [...live]) {
              if (entry.root.session.instanceId !== s.ref.instanceId) continue;
              try {
                teardown(partial);
              } catch { /* Released below either way. */ }
              if (deps.sessions.get(partial.sessionUri) === partial) deps.sessions.delete(partial.sessionUri);
              await release(partial).catch(() => undefined);
            }
            diagnose(s.ref, "Restoration did not complete. It is retried on the next reconciliation.");
            failure ??= error;
          }
        }
      }
      if (failure !== undefined) throw new Error("Durable session recovery is incomplete.", { cause: failure });
      return recovered;
    },
    /**
     * Moves one live session to another host in two steps. This call validates
     * the target and withdraws the session locally without retiring anything
     * durable; `withdrawn` is called once the session is no longer served here.
     * The returned function releases the local handles and moves durable
     * ownership. Only the first step needs the host's write slot: a slow
     * provider release never delays other sessions' writes.
     */
    async relocate(record: SessionRecord, toHostId: string, withdrawn: () => void): Promise<() => Promise<void>> {
      const entry = state(record);
      const ref = captureRef(entry.root.session);
      const coordination = store().coordination ?? unavailable();
      // Nothing is torn down for a move the store would refuse. The store checks again in its own transaction.
      const target = (await coordination.members()).find((member) => member.hostId === toHostId && member.role === "active");
      const providers: unknown = target?.capabilities.providers;
      if (toHostId === coordination.hostId || !Array.isArray(providers) || !providers.includes(record.provider.providerId) || !open(entry)
        || retiringSessions.has(ref.instanceId) || live.get(record) !== entry) unavailable();
      departing.add(ref.instanceId);
      try {
        entry.controller.abort();
        if (deps.sessions.get(record.sessionUri) === record) deps.sessions.delete(record.sessionUri);
        // From here the session is no longer served by this process, whatever follows.
        withdrawn();
        withdraw?.(record);
      } catch (error) {
        // Nothing stays half withdrawn: the handles are released and the caller restores the session.
        await release(record).catch(() => undefined);
        departing.delete(ref.instanceId);
        throw error;
      }
      return async () => {
        try {
          await release(record);
          await coordination.transfer(ref, toHostId);
        } finally {
          departing.delete(ref.instanceId);
        }
      };
    },
    async start(restore: Install, seed: (n: number) => void, lost: () => void, teardown: (record: SessionRecord) => void) {
      install = restore;
      withdraw = teardown;
      host = await storage.acquire(hostId, () => {
        closed = true;
        lost();
      });
      if (closed) {
        await host.release();
        unavailable();
      }
      seed(host.serverSeq);
      let after: string | undefined;
      for (;;) {
        const page: readonly StoredSession[] = await store().sessions.listRecoverable(after);
        if (!page.length) break;
        for (const s of page) {
          after = s.ref.instanceId;
          await recover(s, install, teardown);
        }
      }
    },
    async stop() {
      closed = true;
      let failed = false;
      for (const record of [...live.keys()]) {
        try {
          await release(record);
        } catch {
          failed = true;
        }
      }
      await host?.release();
      if (failed) throw new Error("Resource shutdown failed.");
    },
  };
}
