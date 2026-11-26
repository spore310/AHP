import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type { DurableHost, DurableStorage, HostClaim, HostEventDelivery } from "@persistence";
import { createWorkSessionFixture } from "./work";

const claim = (namespaceId: string, instanceId: string, overrides: Partial<HostClaim> = {}): HostClaim => ({
  namespaceId, instanceId, shared: true, policy: { revision: 1, digest: "digest-1" }, capabilities: { providers: ["test"] }, leaseMs: 2_000, ...overrides });
const until = async (check: () => boolean, label: string): Promise<void> => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (check()) return;
    await delay(10);
  }
  assert.fail(`Timed out waiting for ${label}.`);
};

/**
 * Transitions every coordination-capable storage adapter must implement
 * identically. `fresh` returns a new handle onto one new, empty, shared store
 * for each call within a scenario, so two "hosts" never share process state
 * through the adapter object itself.
 */
export async function assertHostCoordinationConformance(fresh: () => Promise<() => DurableStorage>): Promise<void> {
  const namespaceId = "ahp-namespace:conformance/shared";
  const hosts: DurableHost[] = [];
  const acquire = async (storage: DurableStorage, hostId: string, input: HostClaim, onLost: () => void = () => undefined): Promise<DurableHost> => {
    const host = await storage.acquire(hostId, onLost, input);
    hosts.push(host);
    return host;
  };
  const release = async (): Promise<void> => {
    for (const host of hosts.splice(0).reverse()) await host.release().catch(() => undefined);
  };

  // H2-01 H1-03 H1-10: membership, namespace binding and store mode.
  {
    const open = await fresh();
    const a = await acquire(open(), "host-a", claim(namespaceId, "a-1"));
    const coordination = a.coordination;
    assert.ok(coordination);
    assert.deepEqual([coordination.hostId, coordination.instanceId, coordination.namespaceId, coordination.shared], ["host-a", "a-1", namespaceId, true]);
    // The same instance identity cannot join twice, and a replica cannot take a held lease.
    await assert.rejects(open().acquire("host-a", () => undefined, claim(namespaceId, "a-1")));
    await assert.rejects(open().acquire("host-a", () => undefined, claim(namespaceId, "a-2")));
    assert.deepEqual((await coordination.members()).map((member) => [member.hostId, member.instanceId, member.role]), [["host-a", "a-1", "active"]]);
    // A different logical host shares the namespace. A different namespace or store mode does not.
    const b = await acquire(open(), "host-b", claim(namespaceId, "b-1"));
    await assert.rejects(open().acquire("host-c", () => undefined, claim("ahp-namespace:conformance/other", "c-1")));
    await assert.rejects(open().acquire("host-c", () => undefined, claim(namespaceId, "c-1", { shared: false })));
    await assert.rejects(open().acquire("host-c", () => undefined));
    // H1-09: one trusted configuration per revision; a lower revision never joins.
    await assert.rejects(open().acquire("host-c", () => undefined, claim(namespaceId, "c-1", { policy: { revision: 1, digest: "other" } })));
    await assert.rejects(open().acquire("host-c", () => undefined, claim(namespaceId, "c-1", { policy: { revision: 0, digest: "digest-0" } })));
    assert.equal((await coordination.members()).length, 2);
    assert.equal(await coordination.isCurrentMember("host-b", "b-1", b.coordination?.generation ?? ""), true);
    assert.equal(await coordination.isCurrentMember("host-b", "b-1", "999999"), false);
    assert.equal(await coordination.isCurrentMember("host-b", "b-2", b.coordination?.generation ?? ""), false);
    assert.notEqual(a.coordination.generation, b.coordination?.generation);
    // H1-06 H2-02: an instance limit counts live instances, and a released membership frees its place.
    await assert.rejects(open().acquire("host-d", () => undefined, claim(namespaceId, "d-1", { maxInstances: 0 })));
    await b.release();
    assert.equal(await coordination.isCurrentMember("host-b", "b-1", b.coordination?.generation ?? ""), false);
    const again = await acquire(open(), "host-b", claim(namespaceId, "b-1"));
    assert.equal(BigInt(again.epoch), BigInt(b.epoch) + 1n);
    assert.notEqual(again.coordination?.generation, b.coordination?.generation);
    assert.equal(b.isOpen(), false);
    await release();
  }

  // H3-02 H3-03: a standby waits for the lease and takes over with a new epoch.
  {
    const open = await fresh();
    const active = await acquire(open(), "host-a", claim(namespaceId, "a-1", { shared: false, maxInstances: 2 }));
    let waiting = false;
    const controller = new AbortController();
    const pending = open().acquire("host-a", () => undefined, claim(namespaceId, "a-2", { shared: false, maxInstances: 2,
      standby: { signal: controller.signal, retryMs: 20, onStandby: () => {
        waiting = true;
      } } }));
    await until(() => waiting, "standby");
    assert.deepEqual((await active.coordination?.members())?.map((member) => member.role).sort(), ["active", "standby"]);
    // A third instance exceeds the limit while both are live.
    await assert.rejects(open().acquire("host-a", () => undefined, claim(namespaceId, "a-3", { shared: false, maxInstances: 2 })));
    const { ref } = await createWorkSessionFixture(active);
    await active.release();
    const successor = await pending;
    hosts.push(successor);
    assert.equal(BigInt(successor.epoch), BigInt(active.epoch) + 1n);
    assert.equal(active.isOpen(), false);
    assert.deepEqual((await successor.sessions.listRecoverable()).map((session) => session.ref), [ref]);
    // A cancelled standby leaves no membership behind.
    const cancelled = new AbortController();
    const abandoned = open().acquire("host-a", () => undefined, claim(namespaceId, "a-4", { shared: false, maxInstances: 2, standby: { signal: cancelled.signal, retryMs: 20 } }));
    await delay(50);
    cancelled.abort();
    await assert.rejects(abandoned);
    assert.deepEqual((await successor.coordination?.members())?.map((member) => member.instanceId), ["a-2"]);
    await release();
  }

  // H7-01 H7-03 H7-04 H2-03: one owner per session, transfer, adoption and old-owner fencing.
  {
    const open = await fresh();
    const a = await acquire(open(), "host-a", claim(namespaceId, "a-1"));
    const b = await acquire(open(), "host-b", claim(namespaceId, "b-1"));
    const c = await acquire(open(), "host-c", claim(namespaceId, "c-1", { capabilities: { providers: ["other-provider"] } }));
    const ca = a.coordination;
    const cb = b.coordination;
    const cc = c.coordination;
    assert.ok(ca && cb && cc);
    const first = await createWorkSessionFixture(a);
    const second = await createWorkSessionFixture(a);
    const third = await createWorkSessionFixture(b);
    const owned = async (host: DurableHost) => (await host.sessions.listRecoverable()).map((session) => session.ref.instanceId).sort();
    assert.deepEqual(await owned(a), [first.ref.instanceId, second.ref.instanceId].sort());
    assert.deepEqual(await owned(b), [third.ref.instanceId]);
    assert.deepEqual(await owned(c), []);
    const commit = (host: DurableHost, ref: typeof first.ref, expectedRevision: string, serverSeq: number) => host.sessions.commitState({ ref, expectedRevision, state: { by: host.epoch }, serverSeq,
      modifiedAt: new Date().toISOString() }, () => true);
    const seq = async (host: DurableHost): Promise<number> => (await host.coordination?.allocateServerSeq(1) ?? [0])[0] ?? 0;
    // A member cannot write another member's session, whatever identifiers it supplies.
    await assert.rejects(commit(b, first.ref, "1", await seq(b)));
    await assert.rejects(b.sessions.transition({ ref: first.ref, session: first.ref, operationId: first.root.operationId, expected: "active", next: "suspended" }, () => true));
    await assert.rejects(b.sessions.beginRetirement(first.ref, () => true));
    assert.equal((await a.sessions.get(first.ref))?.stateRevision, "1");
    assert.deepEqual(await ca.locate({ sessionUri: first.ref.id }), { session: first.ref, hostId: "host-a", ownershipEpoch: "1", lifecycle: "active" });
    assert.equal(await ca.locate({ sessionUri: "ahp-session:/missing" }), undefined);

    // Placement is authoritative: a target without the provider, an unknown target and a live owner are refused.
    await assert.rejects(ca.transfer(first.ref, "host-c"));
    await assert.rejects(ca.transfer(first.ref, "host-missing"));
    await assert.rejects(cb.transfer(first.ref, "host-b"));
    await assert.rejects(cb.adopt("host-a"));
    // H4-06: a draining member is not a placement target, whatever a caller believes about its load.
    await cb.setRole("draining");
    await assert.rejects(ca.transfer(first.ref, "host-b"));
    await cb.setRole("active");
    assert.equal((await ca.locate({ sessionUri: first.ref.id }))?.hostId, "host-a");

    const deliveries: HostEventDelivery[] = [];
    const stop = cb.subscribeEvents((delivery) => {
      deliveries.push(delivery);
    });
    const stale = await seq(a);
    await ca.transfer(first.ref, "host-b");
    // The previous owner is fenced by the same commit that moved the session.
    await assert.rejects(commit(a, first.ref, "1", stale));
    assert.deepEqual(await ca.locate({ sessionUri: first.ref.id }), { session: first.ref, hostId: "host-b", ownershipEpoch: "2", lifecycle: "active" });
    assert.equal(await commit(b, first.ref, "1", await seq(b)), "2");
    assert.deepEqual(await owned(a), [second.ref.instanceId]);
    await until(() => deliveries.some((delivery) => delivery.type === "event" && delivery.event.topic === "ownership" && delivery.event.kind === "transferred"
      && delivery.event.entityId === "host-b" && delivery.event.session?.instanceId === first.ref.instanceId), "ownership event");
    stop();

    // Adoption needs a provably free lease, and takes only sessions the adopter can restore.
    assert.deepEqual(await ca.orphanedOwners(), []);
    await a.release();
    assert.deepEqual(await cb.orphanedOwners(), ["host-a"]);
    assert.deepEqual(await cc.adopt("host-a"), []);
    const [left, right] = await Promise.allSettled([cb.adopt("host-a"), cb.adopt("host-a")]);
    const adopted = [left, right].flatMap((result) => result.status === "fulfilled" ? result.value : []);
    assert.deepEqual(adopted.map((location) => [location.session.instanceId, location.hostId, location.ownershipEpoch]), [[second.ref.instanceId, "host-b", "2"]]);
    assert.deepEqual(await owned(b), [first.ref.instanceId, second.ref.instanceId, third.ref.instanceId].sort());
    assert.deepEqual(await cb.orphanedOwners(), []);
    // The former owner restarts into a store where it owns nothing, with an epoch beyond the fence.
    const restarted = await acquire(open(), "host-a", claim(namespaceId, "a-2"));
    assert.ok(BigInt(restarted.epoch) >= BigInt(a.epoch) + 2n);
    assert.deepEqual(await owned(restarted), []);
    await release();
  }

  // H2-04 H2-05 H6-05: namespace revocation and the shared sequence.
  {
    const open = await fresh();
    const revoked: Record<string, number[]> = { a: [], b: [] };
    const a = await acquire(open(), "host-a", claim(namespaceId, "a-1", { onAuthorityRevoked: (revision) => revoked.a?.push(revision) }));
    const b = await acquire(open(), "host-b", claim(namespaceId, "b-1", { onAuthorityRevoked: (revision) => revoked.b?.push(revision) }));
    const ca = a.coordination;
    const cb = b.coordination;
    assert.ok(ca && cb);
    const values = [...await ca.allocateServerSeq(2), ...await cb.allocateServerSeq(2), ...await ca.allocateServerSeq(1)];
    assert.deepEqual([...values].sort((x, y) => x - y), values);
    assert.equal(new Set(values).size, values.length);
    await assert.rejects(ca.allocateServerSeq(0));
    const mine = await createWorkSessionFixture(b);
    assert.equal(await ca.revokeAuthority(), 1);
    assert.equal(ca.authorityRevision(), 1);
    // No notification is needed: the next fenced transaction on any member observes the revocation and fails closed.
    await assert.rejects(b.sessions.commitState({ ref: mine.ref, expectedRevision: "1", state: {}, serverSeq: (await cb.allocateServerSeq(1))[0] ?? 0, modifiedAt: new Date().toISOString() }, () => true),
      (error: unknown) => error instanceof Error);
    assert.equal((await b.sessions.get(mine.ref))?.stateRevision, "1");
    assert.deepEqual(revoked.b, [1]);
    await assert.rejects(createWorkSessionFixture(a));
    assert.deepEqual(revoked.a, [1]);
    // An acknowledgement cannot run ahead of what the store recorded.
    cb.acknowledgeAuthority(7);
    await assert.rejects(createWorkSessionFixture(b));
    cb.acknowledgeAuthority(1);
    ca.acknowledgeAuthority(1);
    assert.equal(await b.sessions.commitState({ ref: mine.ref, expectedRevision: "1", state: {}, serverSeq: (await cb.allocateServerSeq(1))[0] ?? 0, modifiedAt: new Date().toISOString() }, () => true), "2");
    await createWorkSessionFixture(a);
    // H2-05: a member that joins after the revocation starts from the current revision.
    const later = await acquire(open(), "host-c", claim(namespaceId, "c-1"));
    await createWorkSessionFixture(later);
    await release();
  }

  // H1-09 H8-05: a newer trusted configuration fences members still on the older one.
  {
    const open = await fresh();
    let lost = 0;
    const old = await acquire(open(), "host-a", claim(namespaceId, "a-1"), () => {
      lost += 1;
    });
    const session = await createWorkSessionFixture(old);
    const next = await acquire(open(), "host-b", claim(namespaceId, "b-1", { policy: { revision: 2, digest: "digest-2" } }));
    await assert.rejects(old.sessions.commitState({ ref: session.ref, expectedRevision: "1", state: {}, serverSeq: (await next.coordination?.allocateServerSeq(1) ?? [0])[0] ?? 0,
      modifiedAt: new Date().toISOString() }, () => true));
    await until(() => lost === 1 && !old.isOpen(), "stale member fenced");
    await assert.rejects(open().acquire("host-a", () => undefined, claim(namespaceId, "a-2")));
    const rejoined = await acquire(open(), "host-a", claim(namespaceId, "a-2", { policy: { revision: 2, digest: "digest-2" } }));
    assert.deepEqual((await rejoined.sessions.listRecoverable()).map((row) => row.ref), [session.ref]);
    await release();
  }

  // H4-02: an exclusive store stays exclusive.
  {
    const open = await fresh();
    const only = await acquire(open(), "host-a", claim(namespaceId, "a-1", { shared: false }));
    await assert.rejects(open().acquire("host-b", () => undefined, claim(namespaceId, "b-1", { shared: false })));
    await assert.rejects(open().acquire("host-b", () => undefined, claim(namespaceId, "b-1")));
    await assert.rejects(only.coordination?.allocateServerSeq(1) ?? Promise.reject(new Error("missing")));
    const session = await createWorkSessionFixture(only);
    await assert.rejects(only.coordination?.transfer(session.ref, "host-b") ?? Promise.reject(new Error("missing")));
    await only.release();
    // Once stopped it may become shared, and its sessions keep their owner.
    const shared = await acquire(open(), "host-a", claim(namespaceId, "a-2"));
    const joined = await acquire(open(), "host-b", claim(namespaceId, "b-1"));
    assert.deepEqual((await shared.sessions.listRecoverable()).map((row) => row.ref), [session.ref]);
    assert.deepEqual(await joined.sessions.listRecoverable(), []);
    assert.equal((await joined.coordination?.locate({ sessionUri: session.ref.id }))?.hostId, "host-a");
    await release();
  }
}
