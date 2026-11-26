# Host

`@host` composes one Agent Hosting Protocol host: the session factory, the AHP
binding, the WebSocket transport, optional agent work, and the topology the
host runs in. `createAHPServer` is the only server factory.

Without a `topology` option the host behaves exactly as the single-process
host always has: no membership, no probes, no routing and no coordination
beyond the durable store's own ownership lease.

## Files

| File | Responsibility |
| --- | --- |
| `index.ts` | Public surface: `createAHPServer`, topology and admission types, namespace helpers, routing primitives and constants. |
| `types.ts` | `AHPServerOptions`, `AHPServerHandle`, `HostTopologyOptions`, `HostRoutingOptions`, `HostStatus` and agent-work options. |
| `constants.ts` | Namespace scheme, internal protocol version and headers, probe paths, lease and routing defaults. |
| `helpers/server/index.ts` | Entry point for the server factory. |
| `helpers/server/helpers.ts` | `createAHPServer`: validates composition, wires sessions, binding, transport, routing, lifecycle phases, probes, drain and shutdown. |
| `helpers/work/index.ts` | Entry point for hosted work composition. |
| `helpers/work/helpers.ts` | Composes work authorization, exact agent mappings, lease-loss handling and private tool guards. |
| `helpers/topology/index.ts` | Entry point for topology capture. |
| `helpers/topology/helpers.ts` | `captureHostTopology`: resolves mode, namespace and instance identity, rejects unsafe combinations and builds the storage membership claim. |
| `helpers/namespace/index.ts` | Entry point for namespace identifiers. |
| `helpers/namespace/helpers.ts` | Canonical namespace identifiers: slug validation, formatting, parsing, default resolution and the derived schema name. |
| `helpers/admission/index.ts` | Entry point for host admission. |
| `helpers/admission/types.ts` | `NamespacePolicy`, `HostCredential`, proof claims and the `HostAdmission` contract. |
| `helpers/admission/helpers.ts` | `createHostAdmission` and `generateHostCredential`: trusted policy capture, Ed25519 proofs, validity windows, revocation and replay refusal. |
| `helpers/routing/index.ts` | Entry point for host-to-host routing. |
| `helpers/routing/types.ts` | `HostLink`, `HostLinkFactory`, router options and the forwarded-handshake shape. |
| `helpers/routing/link.ts` | `openHostLink`: one bounded JSON-RPC link to another host over WebSocket, with deadlines and in-order frame handling. |
| `helpers/routing/listener.ts` | `createRelayListener`: the internal endpoint that admits relayed connections after verifying the sending host and the original caller. |
| `helpers/routing/router.ts` | `createHostRouter`: resolves a session's owner, forwards requests, merges catalogue views and feeds the order gate. |
| `helpers/routing/order.ts` | `createOrderGate`: releases notifications from several owners in ascending namespace sequence. |

## Identities

These terms are distinct and are never substituted for one another.

| Term | Meaning |
| --- | --- |
| `host` (option) | Network interface the public listener binds. |
| `topology.hostId` | Stable logical host name, such as `support-app`. Replicas share it. It equals `sessions.durability.hostId`. |
| `topology.instanceId` | One running process. Defaults to a random value. It is never a credential. |
| Membership generation | Store-assigned value, unique per join. A restarted instance never reuses one. |
| Host namespace | Application-chosen scope that a logical store, its hosts and its sessions belong to. |
| Policy namespace | `NamespaceRef` in `@authorization`: a grouping of admitted policy definitions. Unrelated to host namespaces. |
| Security domain | `domainId` of principals and resources. Unchanged by topology. |
| Ownership epoch | Fencing counter of a logical host's lease. Advances on every activation and on adoption. |
| Session ownership epoch | Counter on one session that advances when its owning host changes. |

Session incarnations, connection generations and work execution epochs keep
their existing meanings in `@sessions`, `@websocket` and `@work`.

## Namespaces

A namespace identifier has one canonical form:
`ahp-namespace:<application>/<name>`. Both segments are lowercase slugs of at
most 63 characters. Validation never rewrites its input, so two different
strings cannot become one identity.

- With no namespace option the host uses `ahp-namespace:<hostId>/default`.
- `namespace: "production"` expands under the host's own name.
- `namespaceId` is used verbatim, which is how different host names share one
  namespace.
- Supplying both, or any non-string value, is rejected.
- A host name that is not a slug needs an explicit `namespaceId`. An existing
  opaque durable host identity is never turned into a slug.

One public connection belongs to the namespace of the host it reached. A
process that serves several namespaces runs one `createAHPServer` per
namespace, each with its own endpoint, store and security composition.

A namespace's logical store is bound to it on first use. PostgreSQL stores use
one schema per namespace; `namespaceSchemaName` derives it. A host configured
for another namespace cannot acquire the store.

## Topology modes

| Mode | Store | Behaviour |
| --- | --- | --- |
| `single` | Exclusive | One host. Admission is optional. Storage is optional. |
| `replicated` | Exclusive | Replicas share `hostId`. One holds the lease; the others wait as standbys. |
| `partitioned` | Exclusive | One host serves one explicitly named namespace. |
| `distributed` | Shared | Several host names are active. Each session has exactly one owning host. |

`captureHostTopology` rejects, before any listener exists: a mode other than
`single` without durable storage or admission; `partitioned` without an
explicit namespace; routing outside `distributed`; `distributed` without
routing or protected connection setup; a host name that differs from the
durable host identity; a policy for another namespace; and an advertised
endpoint the policy does not list.

Only one instance of a host name is active at a time, in every mode. In
`distributed` mode a second instance with the same `hostId` is refused while
the first is live; only `replicated` mode waits as a standby. Scale out with
distinct host names.

The policy must permit a host to `serve` before it can start, and
`transferSession` refuses a target the policy does not permit to serve.

## Admission

Membership policy is application configuration and the only root of trust. A
`NamespacePolicy` lists each member host, its public verifiers, optional
validity windows, an instance limit, permitted infrastructure operations and
the exact internal endpoints it may advertise. Every member is configured with
the same policy and its own secret.

- A host credential is an Ed25519 seed. Only its host holds it, so no member
  can impersonate another.
- `revision` orders configurations. The store records the highest revision and
  its digest. A lower revision cannot join. A different policy with the same
  revision is refused. A higher revision supersedes, and members still on the
  older one are fenced at their next transaction or heartbeat.
- The digest also covers `admission.configuration`, so application settings
  that every member must share, such as work kinds and capacity limits, cannot
  differ within one revision.
- Rotation lists an old and a new verifier with overlapping windows. A
  credential function is read on every use.
- `revokedCredentialIds` refuses a credential. A host whose own credential is
  expired or revoked cannot start, and reports unready if it expires later.

A verified host is an infrastructure fact only. It carries no user, agent,
role or session authority.

## Lifecycle and probes

`status()` reports the phase: `idle`, `starting`, `standby`, `recovering`,
`active`, `draining` or `stopped`.

- In every mode except `replicated`, `start()` acquires ownership, restores
  owned sessions, then binds the listener.
- In `replicated` mode `start()` binds the listener first and resolves while
  the instance may still be a standby. Activation continues in the background.
- With a topology, the public listener answers `GET /livez`, `/startupz` and
  `/readyz`. A standby and a recovering host are alive and unready. Only a
  stopped host fails liveness.
- A host that loses its database ownership connection stops, in any phase,
  because it can no longer prove membership or ownership.
- Upgrades are refused with `503` unless the host is ready.
- Losing ownership, an expired membership lease, or a superseded policy
  revision stops the host. A supervisor starts a fresh instance.
- `drain()` reports unready, marks the member draining, optionally transfers
  its sessions, then stops. It retires nothing durable.
- `stop()` and `drain()` are idempotent.

## Routing

In `distributed` mode a request for a session that another host owns is
forwarded to that owner over an internal link and the reply returns on the
caller's original connection.

- The owner is read from the store. Destinations come only from live
  membership that the policy also lists, at the same policy revision.
- The ingress signs a proof for that exact destination and binds the
  caller's original handshake headers into it.
- The owner verifies the proof, checks that the sender is a current member
  generation, then authenticates the caller with its own authenticator and
  builds a normal connection. The sender's opinion of the caller is never
  read.
- A relayed connection is served by the unwrapped method table, so a request
  is forwarded at most once.
- `x-ahp-host/*` methods exist only on the internal listener.
- A definite refusal triggers one fresh owner lookup and at most one retry on
  a new owner. A transport failure after the request left the process is
  reported as an unknown outcome and is never retried.
- Each link has a bounded pending table and one deadline per request. A
  missed deadline closes the link.
- When an owner's link closes while a caller holds a subscription through it,
  the caller's connection is closed so it reconnects and reconciles. The same
  happens when the link closes before a subscription's answer has been handed
  to the caller: the answer is dropped, never delivered for a subscription
  that no longer exists on the owner.
- `initialize` subscriptions, `subscribe`, `listSessions` and the root
  session count are merged across owners. Each owner filters by its own
  current authority first.

`routing.tls` makes the internal listener a TLS listener and
`routing.clientTls` sets what this host trusts when it dials another member.
With `admission.requireTls`, a `ws:` endpoint in the policy and an internal
listener without TLS are refused at construction. A link whose certificate
cannot be verified is never opened: the caller's request is not sent and the
caller receives the generic routing error.

Agent presence stays with the host that owns the socket. The ingress attaches
that presence to the owner for the relayed connection. The owner accepts it
only when the caller it authenticated is that agent and the claimed execution
epoch equals the durable registration's current one.

Work requests are routed by their session locator or work identifier. A work
request that names only a non-session resource is handled locally.

## Ordering

In a shared namespace the store allocates every native sequence value, so a
later allocation on any host is greater than every earlier one. A host
obtains its values inside its ordered write slot.

A connection that has a link to another owner passes actions through an
order gate. An action is released only after every other source confirms it
has already sent everything it committed, and no other source holds a lower
value. No action is renumbered. A source that cannot confirm within
`orderTimeoutMs` (10 seconds by default) ends the connection.

A confirmation waits behind that owner's in-flight relayed request on the
same link and behind its ordered writes, so one slow request on an owner can
delay, and after the timeout disconnect, callers that also receive from other
owners.

As a final check, an action whose value is not above the last one sent on the
connection is never delivered. The connection is closed and the caller
reconciles from snapshots.

A notification held by the gate is admitted by its producer's final guard at
the moment it is produced. On release only the connection's current security
is checked again.

## Ownership changes

- `transferSession` withdraws the session locally, then moves durable
  ownership in one transaction. A refused move restores the session locally.
- `adoptSessions` takes over a host's sessions only when its lease is free and
  it has no live member. Only sessions whose provider the adopter declares are
  taken. `adoption: "automatic"` runs this for orphaned owners. After a crash
  the previous owner's membership stays live until its lease expires, so
  adoption and a restart with the same instance identity wait that long.
- A transfer validates its target before anything is torn down. If it fails
  after the local withdrawal, the session is restored on its owner.
- Retirement and transfer exclude each other. A session whose retirement has
  started is not moved, and a session that is being moved is not retired
  until the move ends. A retirement that started always completes.
- A transfer whose acknowledgement is lost rejects. The store decides the
  owner: if it committed the move the new owner restores the session,
  otherwise the previous owner does. The caller reads the location to learn
  which.
- A restore callback that exceeds `callbackDeadlineMs` suspends the session
  on its owner. A result that arrives later is disposed and publishes
  nothing. The next reconciliation or restart tries again.
- A distributed host reconciles what it owns with what it serves every two
  seconds after a failed restoration, so a transient failure is retried. Each
  session is read again immediately before it is restored, so a session that
  was retired or moved while another one was being restored is skipped. One
  session that cannot be restored does not hold back the others.
- A transfer that fails restores the session on its owner. If that
  restoration fails too, the reconciliation above restores it.
- A reconciliation pass announces every session it restored, even when it
  ends with a failure for another one. A restoration interrupted by a storage
  failure leaves nothing half built behind, so the next pass tries it again.
- A transfer holds the host's write slot only while it withdraws the session.
  Releasing provider handles and the durable move run outside it, so a slow
  provider does not delay other sessions' writes.
- The receiving host restores a session from durable facts and fresh
  restoration approval. No grant, proof or handle is copied.
- `revokeNamespaceAuthority` records a durable revision. Each host closes its
  connections and acknowledges; fenced transactions on a host fail until it
  has.

## Limits

- Hostile-member isolation is out of scope. Members of a namespace share a
  store and are trusted components of one deployment.
- A caller's handshake credential is forwarded to the owning host.
- Forwarded handshake headers are limited to 8 KiB encoded.
- The WebSocket adapter is the only link transport provided.
- Sessions are not rebalanced automatically.
- A provider must be able to restore a session on another host for transfer
  or adoption to succeed. A failed restoration suspends the session.

## Related documentation

- [Multi-host guide](../../docs/guides/multi-host.md)
- [Persistence](../persistence/README.md)
- [WebSocket transport](../websocket/README.md)
- [Multi-host plan and acceptance](../../docs/plans/host/AHP_Multi_Host_Plan/README.md)
