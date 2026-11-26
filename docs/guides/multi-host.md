# Multi-host deployment

One Agent Hosting Protocol host with one namespace is the default and needs
nothing on this page. Use it when one process is enough.

This guide covers naming a host, choosing namespaces, and running more than
one process: active-passive replicas, independent namespaces, and several
active hosts in one namespace. The [host module](../../src/host/README.md)
is the reference for exact behaviour.

## Choose a topology

| You need | Mode | What you add |
| --- | --- | --- |
| One process | `single` (default) | Nothing. A host name is optional. |
| Availability for one host | `replicated` | Shared durable storage and a membership policy. |
| Separate environments or tenants | `partitioned` | One store and one host per namespace. |
| Horizontal capacity in one namespace | `distributed` | A shared store, a membership policy and an internal listener per host. |

Replication gives availability. It does not add session capacity: one replica
serves at a time. Capacity comes from `distributed` mode, where different
hosts own different sessions.

## Name the host and the namespace

```ts
import { createAHPServer } from "@host";

const server = createAHPServer({
  host: "0.0.0.0", // network interface
  port: 8080,
  sessions,
  topology: { hostId: "support-app" },
});
```

`hostId` is a stable logical name that usually resembles the application.
Keep it the same across restarts and replicas. It is the durable host
identity, so it must equal `sessions.durability.hostId` when storage is
configured.

The namespace defaults to `ahp-namespace:support-app/default`. To choose one:

```ts
topology: { hostId: "support-app", namespace: "production" }
// ahp-namespace:support-app/production

topology: { hostId: "support-tools", namespaceId: "ahp-namespace:support/shared" }
// an explicit identifier that hosts with different names can share
```

Identifiers are lowercase slugs. Anything else is rejected rather than
rewritten. Runnable version: [`examples/host-single.ts`](../../examples/host-single.ts).

## Membership policy and host credentials

Every mode except `single` requires `topology.admission`: a trusted policy and
the host credential.

```ts
import { generateHostCredential } from "@host";

// Run once per host, in your provisioning tooling. Store the secret in your
// secret manager and put the verifier in the policy.
const { credential, verifier } = generateHostCredential("support-tools-a-2026-11");

const policy = {
  namespaceId: "ahp-namespace:support/shared",
  revision: 1,
  members: [
    { hostId: "support-tools-a", credentials: [verifier], endpoints: ["wss://tools-a.internal:7000/"] },
    // one entry per logical host
  ],
};
```

- The policy is the same on every member. Each host holds only its own
  secret. Supply it as a value or as a function your secret provider backs.
- A host credential admits a host to a namespace. It grants no user, agent,
  tool or work permission.
- Raise `revision` for every change. Members still on the old revision are
  stopped by the store and restart with the new configuration.
- Put settings that all members must share, such as work kinds and capacity
  limits, in `admission.configuration`. Two members with one revision and
  different configuration cannot both join.
- To rotate, list the old and the new verifier with overlapping `notBefore`
  and `expiresAt`, roll the secrets, then publish a revision without the old
  one. To revoke immediately, add the credential identifier to
  `revokedCredentialIds` in a new revision.
- Set `requireTls: true` to refuse `ws:` endpoints and to require TLS on the
  internal listener.

## Active-passive replicas

```ts
topology: {
  hostId: "support-app",
  mode: "replicated",
  instanceId: process.env.POD_UID,
  admission: { policy, credential },
}
```

Both replicas use the same `hostId` and the same store. One becomes active.
The other binds its listener, answers probes and refuses protocol traffic
until it takes over.

- `start()` resolves for a standby. Use `status()` or `/readyz` to observe
  activation.
- A standby takes over when the active process exits or loses its database
  session. It restores sessions before it reports ready.
- A process that is frozen keeps its database session, so no takeover happens
  until it resumes or its connection is closed. When it resumes after its
  lease expired it stops itself. There is never a second owner.
- A stopped host exits. Run it under a supervisor that restarts it.

Runnable version: [`examples/host-replicated.ts`](../../examples/host-replicated.ts).

## Independent namespaces

```ts
topology: { hostId: "support-production", mode: "partitioned", namespaceId: "ahp-namespace:support/production", admission }
```

Each namespace has its own store. With PostgreSQL, give each namespace its own
schema:

```ts
import { namespaceSchemaName } from "@host";

createPostgresPersistenceProvider({ connectionString, schema: namespaceSchemaName(namespaceId) });
```

A store is bound to its namespace on first use and refuses a host configured
for another one. Identical session identifiers in two namespaces are
unrelated sessions. To serve several namespaces from one process, create one
server per namespace on its own port.

Runnable version: [`examples/host-partitioned.ts`](../../examples/host-partitioned.ts).

## Several active hosts in one namespace

```ts
topology: {
  hostId: "support-tools-a",
  mode: "distributed",
  namespaceId: "ahp-namespace:support/shared",
  admission: { policy, credential },
  routing: { host: "0.0.0.0", port: 7000, endpoint: "wss://tools-a.internal:7000/", tls, clientTls },
  adoption: "automatic",
}
```

- The host that receives `createSession` owns the new session. A load
  balancer therefore spreads sessions across hosts.
- A client can connect to any host. Requests for a session owned elsewhere
  are routed to its owner. The owner authenticates the caller again and
  applies every permission itself.
- Give each active host its own name. A second instance with the same name is
  refused while the first is live.
- The internal listener must not be reachable by clients. It accepts only
  current members that present a valid proof for that destination.
- `transferSession(uri, hostId)` moves one session. `drain({ transferTo })`
  moves all of a host's sessions before it stops.
- Retirement is final and wins over a move. A session that is being retired
  is not transferred or adopted, and a session that is being moved cannot be
  retired until the move has finished.
- If `transferSession` rejects, read the session's location before retrying.
  The store may have committed the move even though its acknowledgement was
  lost. Exactly one host serves the session either way.
- With `adoption: "automatic"`, a surviving host takes over the sessions of a
  member whose lease is free and whose membership expired. Without it, call
  `adoptSessions(hostId)`.
- A client whose subscription ran through a host that stopped is
  disconnected. It reconnects and subscribes again.
- `revokeNamespaceAuthority()` makes every host close its connections, so all
  callers authenticate again.

Session providers must be able to restore a session on another host. A
provider that keeps state in one process or on one local disk cannot be
transferred or adopted; restoration fails and the session is suspended.

A provider that creates something outside the process must create it at most
once per `operationId`. When a host stops after the provider created the
resource and before the host recorded it, the next owner calls `startSession`
again with the same `operationId`. A provider that ignores the key creates a
second resource in that case. The SDK cannot detect or prevent that.

A restore callback that does not settle within `callbackDeadlineMs` leaves
the session suspended on its new owner. A later reconciliation or a restart
tries again. A result that arrives after the deadline is disposed and never
makes the session ready.

A tool call whose executor disconnected stays counted in
`toolExecutionStats()` on the owning host, exactly as on a single host. The
caller's wait ends at once. The host does not claim that the remote execution
stopped.

Runnable version: [`examples/host-distributed.ts`](../../examples/host-distributed.ts).

## Probes and shutdown

With a topology, the public listener answers three paths.

| Path | 200 when | Use as |
| --- | --- | --- |
| `/livez` | The host has not stopped. | Liveness |
| `/startupz` | The listener is bound and startup passed its first phase. | Startup |
| `/readyz` | The host owns its lease, finished recovery and admits traffic. | Readiness |

A standby is alive and not ready. Do not restart a process because `/readyz`
fails. An active host that loses its database ownership connection stops and
fails `/livez`, so its supervisor starts a fresh instance.

Call `drain()` on `SIGTERM`. Allow a termination grace period longer than the
transport shutdown timeout of 5 seconds per listener plus any transfers.

## TLS between hosts

```ts
admission: { policy, credential, requireTls: true },
routing: {
  host: "0.0.0.0", port: 7000, endpoint: "wss://tools-a.internal:7000/",
  tls: { key, cert },        // the internal listener
  clientTls: { ca },         // what this host trusts when it dials another member
},
```

With `requireTls`, a `ws:` endpoint in the policy and an internal listener
without TLS are both refused before anything listens. A host that cannot
verify another member's certificate does not send it the caller's request.
The caller gets the generic routing error, with no certificate detail.

## PostgreSQL

- Apply every migration, including `0005_host_coordination`, to each
  namespace schema. Stop existing hosts first. See the
  [migration notes](../../database/migrations/README.md).
- A store's namespace cannot be renamed. It cannot be removed while it has
  sessions that are not retired, queued or leased work, or live members. To
  reuse a schema after removing its namespace, an administrator calls
  `ahp_recreate_namespace`. Earlier memberships and ownership are then refused.
- Each host holds one ownership connection and a transaction pool, plus a
  small pool for registrations. Size the server for
  `hosts x (1 + maxConnections)` and that pool.
- All members of a namespace need the same clock source only through the
  database: lease expiry uses the database clock.

## Run the live example

[`examples/host/docker-compose.yaml`](../../examples/host/docker-compose.yaml)
starts PostgreSQL, a load balancer and eight host processes that cover all
four topologies. The driver exercises them through public endpoints, kills,
pauses and stops containers, and checks authoritative state in PostgreSQL.

```sh
docker compose -f examples/host/docker-compose.yaml up --build -d
pnpm exec vite-node examples/host/acceptance.ts
docker compose -f examples/host/docker-compose.yaml down -v
```

The example credentials are generated at startup and exist only in a
container volume. The control ports are example scaffolding, published on
loopback, and are not part of the SDK.

## Run on Kubernetes

[`examples/host/kubernetes/`](../../examples/host/kubernetes/README.md) has
manifests for the single, replicated and distributed topologies and a driver
that applies them to a cluster and checks them through real pods.

```sh
docker compose -f examples/host/docker-compose.yaml build tools-a
minikube image load ahp-multi-host-example:local postgres:17.12-bookworm
pnpm exec vite-node examples/host/kubernetes/acceptance.ts
```

The SDK does not call the Kubernetes API. The manifests only map SDK settings
onto pods: the pod name is the host name in a StatefulSet, the pod UID is the
instance, and the three probes are the three health paths.

A standby replica is never ready, so Kubernetes reports a `replicated`
Deployment as one available replica of two. Give it `maxUnavailable: 100%`,
or an update cannot remove the old active pod. The example README explains
both points.

## Limits

- Members of a namespace share a store and are trusted parts of one
  deployment. The SDK does not isolate a compromised member.
- The owning host receives the caller's handshake credential in order to
  authenticate it. Use TLS on internal links.
- Sessions are not rebalanced automatically.
- The measured overhead of routing a write through another host was under one
  millisecond at the median on one machine. No throughput claim is made.

## Related documentation

- [Host module](../../src/host/README.md)
- [PostgreSQL setup and conformance](postgresql.md)
- [Acceptance evidence](../plans/host/AHP_Multi_Host_Plan/ACCEPTANCE.md)
