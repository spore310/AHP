# Configuration examples and naming intent

**Status:** the shapes below were the planning sketches. The implemented
configuration is documented in the [multi-host guide](../../../guides/multi-host.md)
and runs in `examples/host-single.ts`, `examples/host-replicated.ts`,
`examples/host-partitioned.ts`, `examples/host-distributed.ts` and
`examples/host/`. Where a sketch differs from the implementation, the
implementation is authoritative:

- `coordination`, `events.transport` and `routing.transport` are not separate
  options. Coordination and events come from the durable storage adapter, and
  routing takes `{ host, port, endpoint }` with an optional `connect` adapter.
- `authentication` is `admission: { policy, credential }`.
- `strategy` is implied by the mode.

## Default — ./examples/host-single.ts (proposed)

Use the existing server factory through its proposed new owning module. The `host` field keeps its current network meaning. The logical host name belongs to the host configuration, not to a second server-building API.

```ts
import { createAHPServer } from "@host";

const server = createAHPServer({
  host: "0.0.0.0",
  port: 8080,
  sessions, // existing application/session configuration
  topology: {
    hostId: "support-app",
    // mode defaults to single; one namespace derives from this stable name.
  },
});
```

Omitting the advanced configuration keeps the one-host default. An existing durable store keeps its configured identity; adding a friendly name must never silently allocate a new store or rewrite resource IDs.

## Application-defined and shared namespaces

Apps can select names such as `production`, `staging` or a project-specific scope. The SDK captures one canonical namespace ID. If it accepts short names, it expands them through the chosen app prefix exactly once; raw short names and full identifiers must not form two competing identity systems.
A useful documentation-only shape is `urn:example:ahp:support-app:production`. The fixed prefix, host/app slug and chosen namespace component are readable, while membership policy controls who may join. RFC 6963 reserves `urn:example:` for examples; select the actual production convention under D01. A colon prefix does not establish nested authorization or ownership.
The same explicit canonical namespace must work for `support-api` and `support-tools` host IDs. Deriving the default from a host name is a convenience, not a rule that every namespace belongs permanently to that name.

## Active-passive — ./examples/host-replicated.ts (proposed)

```ts
const topology = {
  mode: "replicated",
  strategy: "active-passive",
  hostId: "support-app",
  namespaceId: configuredNamespaceId,
  instanceId: configuredInstanceId,
  authentication: configuredHostAuthentication,
  coordination: postgresCoordination,
};
```

Replicas share the logical host and namespace, while each running instance is distinct. Only the active owner accepts ordinary AHP traffic. Health observation must remain available to the standby. Secret retrieval and configuration policy are application-owned; a pod UID alone is not authentication.

## Partitioned namespaces — ./examples/host-partitioned.ts (proposed)

```ts
const productionHost = {
  mode: "partitioned",
  hostId: "support-production",
  namespaceId: productionNamespaceId,
};

const stagingHost = {
  mode: "partitioned",
  hostId: "support-staging",
  namespaceId: stagingNamespaceId,
};
```

Trusted configuration binds each namespace to the appropriate persistence/authorization scope and host admission. Complete production construction includes the compatible adapters and credentials required by its topology. Using two labels against the same unscoped repositories is not isolation.
An advanced one-process/multiple-namespace configuration may reuse the same allocation contract. Do not introduce a separate 'tenant manager' just to support this case, and do not use ambient mutable namespace selection.

## Shared namespace — ./examples/host-distributed.ts (proposed)

```ts
const topology = {
  mode: "distributed",
  hostId: "support-tools",
  namespaceId: configuredSharedNamespaceId,
  instanceId: configuredInstanceId,
  authentication: configuredHostAuthentication,
  coordination: postgresCoordination,
  routing: {
    strategy: "session-owner",
    transport: internalHostTransport,
  },
  events: {
    transport: distributedEventTransport,
  },
};
```

A second permitted host can use a different hostId and credential with the same shared namespace. Each session still has one owner. An ingress host routes to that owner; the user/agent still needs current application permission.
All referenced adapter/authentication variables are application composition inputs, not hidden SDK globals or APIs claimed to exist today. Choose exact names only after the reuse and current-contract review.

## Kubernetes mapping

| Deployment input | SDK meaning |
| --- | --- |
| Application-configured stable name | Logical host identity; keep it stable across pod replacement. |
| Application-configured namespace | SDK coordination/data scope; independent of the Kubernetes Namespace object's name. |
| Pod UID or equivalent runtime value | Instance identifier input; identity proof still comes from configured authentication. |
| Secret/provider integration | Supplies host credentials without logging or embedding them in source. |
| Startup/liveness/readiness endpoints | Distinct operational contracts from H3. |
| Service/load balancer | Distributes new connections; internal routing and ownership still enforce correctness. |
| Termination grace period | Must cover the documented bounded drain/cleanup behavior. |

The deployment example defaults to one replica. Multiple replicas require the explicitly selected supported mode. No Kubernetes API client, controller or namespace provisioning is required inside @host.

