# Agents

Authenticated agent identity and ephemeral presence. This module owns the
server-derived principal contract, the static bearer-token authenticator used by
the POC, durable agent registration, and the in-memory presence directory.

The central rule is that an AHP `initialize.clientId` is **never** an identity.
A principal comes only from the WebSocket upgrade handshake; a durable
registration and a live presence binding are separate concepts.

## Files

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | `AuthenticatedPrincipal`, `TrustedHandshakeContext`, `ConnectionAuthenticator`, `PresenceBinding`, `AgentDirectory`, and directory options. |
| `constants.ts` | Default 90-second presence TTL. |
| `helpers/authenticator.ts` | `createStaticTokenAuthenticator`: exact bearer-token lookup from the handshake `Authorization` header. |
| `helpers/directory.ts` | `createAgentDirectory`: durable registration resolution, one live binding per agent, generation fencing, renewal, and connection-scoped release. |
| `helpers/errors.ts` | Sanitized `AgentDirectoryError` codes (`invalid`, `not_found`, `unauthorized`, `conflict`). |
| `index.ts` | Public surface for the module. |

## API

- `createStaticTokenAuthenticator(tokens: ReadonlyMap<string, string>)` — maps an
  exact token to a principal subject. Missing, malformed, repeated, or unknown
  credentials resolve to `undefined`; tokens are never logged or echoed.
- `createAgentDirectory({ registrations, now?, presenceTtlMs? })` —
  - `register(principal, agentKey, displayName?)` resolves the durable row for
    that principal and key.
  - `bindPresence(agentId, principal, connectionId)` creates or returns the
    current binding, denying a different live connection.
  - `renewPresence(binding)` advances only the exact current connection and
    generation.
  - `releasePresence(binding)` and `releaseConnection(connectionId)` remove only
    matching bindings; a late close cannot remove a newer generation.
  - `getOnline(agentId)` and `getByConnection(connectionId)` return only
    unexpired bindings.

## Presence semantics

Presence is process-local. It is not persisted, not shared across hosts, and not
replaced by WebSocket heartbeat. A binding is:

```text
{ agentId, principalSubject, connectionId, generation, expiresAt }
```

Expiry is checked with the injected clock. A new binding for the same agent gets
a higher generation. Releasing an older binding is a no-op. One connection may
hold at most one live agent identity, which keeps `getByConnection` unambiguous
for work authorization.

## Security boundaries

- `clientId`, session payloads, tool metadata, and request JSON cannot supply a
  principal, agent ID, connection ID, or generation.
- A registration is durable, but it does not imply that the agent is online.
- The presence-bind path consults an in-process registration cache refreshed by
  `register`/`getRegistration`; renewals never consult any registration source —
  neither the cache nor the repository. There is no disable path in this slice,
  so directly flipping `enabled` in the database cannot evict live presence: a
  re-newal keeps a disabled registration alive until the connection closes or
  the TTL lapses. Every work mutation re-reads the registration, so claims and
  completions still fail closed. Invalidation belongs with a real
  disable/decommission path.
- Registration rows grow only with unique `(principal, agent_key)` pairs: the
  register handler refuses a connection-level bind conflict before the durable
  write, and same-key registrations are upserts. Two same-principal connections
  registering distinct keys concurrently can each land a row before one fails to
  bind, which stays inside that bound.
- A connection without a valid credential may still use baseline AHP methods;
  authenticated agent/work methods fail closed.
- The static token map is a POC adapter. It is not a production identity
  provider, and tokens must be supplied through environment configuration rather
  than source or logs.

## Testing

| Test | Pins |
| ---- | ---- |
| [`src/tests/agents/authenticator.test.ts`](../tests/agents/authenticator.test.ts) | Bearer parsing, exact token lookup, missing/unknown credentials, repeated headers, and rejection of empty tokens or subjects. |
| [`src/tests/agents/directory.test.ts`](../tests/agents/directory.test.ts) | Stable registration, cross-principal denial, disabled agents, one live binding per agent and connection, generation fencing, expiry, and stale release. |

## Related Documentation

- [`src/websocket/README.md`](../websocket/README.md) — where the handshake is
  authenticated and the methods are exposed.
- [`src/work/README.md`](../work/README.md) — how presence is revalidated before
  work mutations.
- [`docs/architecture/agent-task-lifecycle.md`](../../docs/architecture/agent-task-lifecycle.md)
  — end-to-end agent/work sequence.
