# Architectural decisions

**Status:** D01–D08 are **Established** for the candidate described in
[HANDOFF.md](HANDOFF.md). Each record states the chosen contract, the source
that implements it, the smaller alternative that was rejected, failure
semantics, and the acceptance criteria that prove it. Evidence is in the
[packet handoffs](handoffs/README.md).

Statuses follow repository guidance: Established, Proposed, Experimental,
Unknown, Deprecated.

## D01 — Identity, naming and namespace selection

**Status:** Established. **Blocks:** H1, H4.

**Contract.** `topology.hostId` is the stable logical host name and equals the
existing durable host identity (`sessions.durability.hostId`); no second name
field exists. `topology.instanceId` identifies one process. A namespace has
one canonical form, `ahp-namespace:<application>/<name>`, with lowercase slug
segments of at most 63 characters. The default is `<hostId>/default`;
`namespace` is a short name under the host name; `namespaceId` is used
verbatim so different host names share a namespace. Supplying both, or a
non-string, is rejected. Nothing is normalized. A public connection belongs to
the namespace of the host endpoint it reached.

**Sources.** `src/host/helpers/namespace/helpers.ts`,
`src/host/helpers/topology/helpers.ts`, `src/host/constants.ts`.

**Legacy mapping.** A host without `topology` acquires its store exactly as
before and leaves the namespace unbound. A store is bound on the first claim
that names a namespace, and only when no other logical host ever used it. A
host name that is not a slug requires an explicit `namespaceId`; an opaque
durable identity is never slugified.

**Rejected.** A URN under an unregistered NID, and a separate display-name
field. The first claims a standard it does not meet; the second duplicates
`hostId`.

**Deletion and reuse.** A namespace is the store it is bound to. The SDK has
no namespace delete operation; removing a namespace is a trusted
administrative action on the store. The store enforces the contract itself:
a bound namespace cannot be renamed, truncated or inserted directly, and its
row cannot be deleted while the store has an unretired session, queued or
leased work, or a live member. A store whose namespace was removed admits no
host. `ahp_recreate_namespace` is the only way to bind it again. It refuses
while anything is active, advances every ownership epoch and removes every
membership, so no earlier membership or ownership token is valid afterwards.
Retired history is kept. A deletion and a recreation take the lock a joining
host holds before they touch the namespace row, are refused outside a read
committed transaction, and act on their own schema whatever the caller's
search path is. A new store bound to
the same identifier starts with fresh generations, epochs and session
incarnations.

**Proof.** H1-01, H1-02, H1-04, H1-08, H4-07, H4-08.

## D02 — Host credential bootstrap and claims

**Status:** Established. **Blocks:** H1, H2, H5.

**Contract.** Trust is rooted in application configuration: a
`NamespacePolicy` with a revision, the member hosts, their Ed25519 public
verifiers with optional validity windows, an instance limit, permitted
infrastructure operations (`serve`, `route`, `adopt`) and exact internal
endpoints. Each host holds only its own seed. The store records the highest
revision and the digest of policy plus declared configuration. A lower
revision cannot join; an equal revision with another digest is refused; a
higher revision supersedes and fences members on the older one. A proof names
namespace, sender host, instance, membership generation, credential,
audience, purpose, policy revision, issue time, nonce and a digest of the
bound content.

**Sources.** `src/host/helpers/admission/helpers.ts`, `types.ts`; the join
transaction in
`src/persistence/helpers/adapters/postgres/helpers/ownership/helpers.ts`.

**Rejected.** One shared namespace secret. Any member could then impersonate
any other, and rotation would be all-or-nothing.

**Failure.** Verification returns nothing and never describes the credential.
An expired or revoked own credential prevents start and reports unready
later.

**Proof.** H1-03, H1-05, H1-06, H1-09, H5-02, H5-03.

## D03 — Trust and failure boundary

**Status:** Established. **Blocks:** H1, H2, H5.

**Contract.** Members of a namespace are trusted components of one
application deployment that share a store. The SDK defends against faulty,
stale, misconfigured and unlisted hosts: wrong audience, wrong namespace,
replaced instance, superseded policy, expired lease, paused owner. It does
not defend against a compromised member with direct database access; that
requires database-level separation outside the SDK. A host credential
authenticates a logical host, not a physical machine.

**Consequence.** The ingress forwards the caller's handshake credential to the
owning host, which is acceptable because any member could have received that
connection from the load balancer.

**Revocation order.** Publish a higher policy revision. The first host that
joins with it updates the store; every member on the older revision fails its
next fenced transaction or heartbeat and stops. Relayed requests from a
removed or stale member are refused by the generation check.

**Proof.** H1-05, H1-06, H2-02, H2-07, H5-02, H5-09, H9-05.

## D04 — Distributed application authorization

**Status:** Established. **Blocks:** H2, H5–H8.

**Contract.** Authoritative owner routing. Every effect on a session runs on
its owning host, whose canonical registry holds that session's bindings. The
existing evaluator is the only policy engine. Local stamps, tokens and
callbacks never cross a process. The owner authenticates the original caller
from the forwarded handshake with its own authenticator and derives all
authority itself.

Shared currentness is one durable value, `host_namespaces.authority_revision`.
Every fenced transaction takes a share lock on the namespace row and fails
while the host has not acknowledged the current revision. A revocation
updates the row, so it waits for transactions already admitted and precedes
every later one. A host that observes a new revision closes all of its
connections, then acknowledges.

**Boundary.** A mutation admitted before the revocation may commit. No
notification is required for the fence. Bytes already sent are not recalled.
A notification held for ordering is admitted by its producer's guard when
produced and rechecked against connection security when released. An owner
that observes a revocation closes its relayed connections too. An ingress
that has not observed it yet therefore loses its links: a request it had not
forwarded fails, and a subscription whose answer was still on its way is not
delivered, because the ingress never answers a subscription over a link that
has closed.

**Sources.** `lock()` in the PostgreSQL ownership helper; `guard` in
`src/persistence/helpers/durability/memory.ts`; `authorityRevoked` in
`src/host/helpers/server/helpers.ts`.

**Rejected.** A shared SQL grant store. It would duplicate the registry and
need its own invalidation protocol.

**Proof.** H2-04, H2-05, H2-06, H5-06, H9-05.

## D05 — Storage scope, ownership schema and migration

**Status:** Established. **Blocks:** H2, H4, H7.

**Contract.** Scope is carried by the adapter instance: one namespace is one
logical store, and with PostgreSQL one schema. No row-level tenancy. Migration
`0005_host_coordination` adds `host_namespaces`, `host_members`,
`host_events`, a `lease_slot` per logical host, and `owner_host_id` plus
`ownership_epoch` on `sessions`.

- Lease: a session-level advisory lock keyed by `(lease_slot, host_state
  relation)`. Activation advances `ownership_epoch` after admitted
  transactions end.
- Fence: every transaction locks its host row at the acquired epoch. A locked
  session read admits only the owning host. `sessions_owner_fence` rejects any
  other session write.
- Lock order: the caller's host row, namespace row (share), session row,
  registration row, work rows. Transfer and adoption take the session row
  exclusively. A revocation takes the host row and then the namespace row
  exclusively. Adoption additionally takes the previous owner's host row, but
  never waits for it: it tests that owner's lease without waiting and locks
  the row with `NOWAIT`.
- Membership uses the database clock; renew and release are conditional on
  the exact generation.

**Migration.** Forward only, populated stores preserved, sessions attributed
to the single existing host. The migration refuses to run while a pre-0005
host holds the store. Afterwards `host_state_guard` refuses a pre-0005
binary. No down migration.

**Rejected.** Removing the single-row index without a guard, and shared-table
tenancy.

**Proof.** H2-01, H2-02, H2-03, H2-09, H2-10, H4-01, H4-09.

## D06 — Native ordering and durable event recovery

**Status:** Established. **Blocks:** H6, H7, H9.

**Findings.** The pinned client keeps one `serverSeq` per connection as a
maximum and applies every envelope. This host does not implement `reconnect`;
clients fall back to `initialize`. A snapshot's `fromSeq` must be below every
later action on that channel.

**Contract.** In an exclusive store the sequence is unchanged. In a shared
store every value comes from the PostgreSQL sequence `host_server_seq`,
obtained inside the host's ordered write slot, so any later allocation in the
namespace is greater. A channel has one owner, so `fromSeq` stays valid, and
a new owner continues above the old values.

A connection fed by several owners uses an order gate. An action is released
when every other source confirmed it already sent everything committed before
the confirmation, and no source holds a lower value. Nothing is renumbered.
A source that does not confirm within `orderTimeoutMs` ends the connection.

Durable events are identifier-only rows written in the transaction they
describe. Readers advance by transaction id below the snapshot horizon, each
with its own cursor. `LISTEN` is a wakeup and polling is the fallback. More
than 512 pending rows, or retention beyond the cursor, delivers a reset.

**Sources.** `src/host/helpers/routing/order.ts`, `router.ts`;
`createReservedActionSequence`; the event reader in the ownership helper.

**Rejected.** Renumbering at the ingress, and a cursor over the identity
column alone.

**Proof.** H6-01 to H6-11.

## D07 — Internal routing trust and outcomes

**Status:** Established. **Blocks:** H5, H8.

**Contract.** A WebSocket link per public connection and destination, on a
separate internal listener. The upgrade carries the signed proof and the
forwarded handshake. Destinations come from live membership that the policy
lists at the same revision. The owner verifies the proof, the current member
generation, then the caller. Relayed connections use the unwrapped method
table: one hop at most. Internal methods exist only on the internal listener.

Each link bounds pending requests, applies one deadline per request, and
closes on a missed deadline. A definite refusal allows one fresh owner lookup
and one retry on a new owner. A failure after the request left the process is
an unknown outcome and is not retried; callers reconcile with a read or an
idempotent `requestKey`.

**Sources.** `src/host/helpers/routing/link.ts`, `listener.ts`, `router.ts`.

**Rejected.** Forwarding a decision or serialized context, and client-chosen
destinations.

**Not provided.** An in-memory link adapter. Tests use loopback sockets.

**Proof.** H5-01 to H5-10.

## D08 — Provider recovery and placement

**Status:** Established. **Blocks:** H3, H7, H9.

**Contract.** A member declares the session providers it can restore. A
transfer targets only a live, active member that declares the session's
provider. Adoption moves only sessions whose provider the adopter declares,
and only when the previous owner's lease is free and its membership expired.
A new session belongs to the host that created it. There is no automatic
rebalance.

Restoration on the new owner uses the existing recovery path: the same
provisioning keys, driver and manifest checks, and fresh restoration
approval. A driver or version mismatch, or a provider that cannot reach its
state, fails restoration and suspends the session with a diagnostic.
Database fencing cannot stop an external process that is already running;
providers that need that must fence externally.

**Sources.** `transfer` and `adopt` in the coordination helpers;
`recoverOwned` and `handoff` in `src/sessions/helpers/recovery/helpers.ts`.

**Proof.** H3-07, H3-08, H7-01 to H7-09.

## Planning gate

No decision is open. Residual limitations are listed in
[HANDOFF.md](HANDOFF.md) and in each packet handoff.
