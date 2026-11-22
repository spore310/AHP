# P04 preflight — pending accepted P03

Read-only preflight by `w8:p3`; no P03 inspection/writes/tests. Orchestrator gate: conditional PASS with the initial-authority integration question below unresolved until P03 APIs are accepted. No P04 execution.

## Current path and preserved ownership

`websocket/helpers/host/helpers.ts` currently sources handshake authentication only from agentWork. `websocket/helpers/server.ts` pauses a socket for authentication, then establishes a subject-only connection. `websocket/helpers/ahp/helpers.ts:initialize` builds full initialSubscriptions snapshots and commits subscriptions after reply. `attachConnection` mints connectionId. AgentDirectory presence generation is a different lifecycle. Durable work keys principals by subject.

Add an optional host-level security composition independent of agentWork/DB. Do not widen the existing ConnectionAuthenticator. One new identity source or an explicit adapter over the exact same old authenticator with a configured domain is allowed; two conflicting sources fail at construction. Preserve original owner-only work semantics and principal subject projection only under one configured domain (or separately verified globally unambiguous subjects); do not collapse arbitrary domain-qualified identities.

Keep pause/held frames, deferred completion correlation, subscription reply commit and close cleanup. Extend setup until identity, actual actor and explicitly prepared initial authority settle or time out. Late completion after disconnect/replacement cannot attach. Missing presence does not imply human; clientId/roles/kind in wire intent do not establish actor identity.

## Lead decisions

- Host-local `setupDeadlineMs` may default to accepted `asyncHookDeadlineMs`; validate a finite cap. Do not add competing P01 limit authority.
- `maxInitialSubscriptions` is a separate finite P04-local count, not maxPolicyRefs. Current initialize array has no count cap.
- Transport connection generation is separate from agent presence generation and immutable for that connection.
- No raw protected snapshot before setup barrier. Authentication alone does not authorize a full snapshot after the barrier; P10 projection remains unfinished. Basic safe initialize/ping can remain public, but no default user/grant or legacy protected-data fallback.
- P03 helper signatures are pending. Prefer accepted injectable ports, not new transport-owned authorization logic.

## Open integration question

`BindingResolver.read` requires a resource scope and grant revision. Initial setup cannot invent an unscoped grant read or manufacture a host resource/grant. Resolve an explicit trusted scope/setup seam against accepted P03 authority APIs before writing P04. Missing initial authority denies protected data. If an additional P04-local setup adapter is necessary, document its exact input/output/freshness and one-source identity contract first.

## I01–I05 evidence

I01: park identity/authority resolution; send immediate initialSubscriptions; zero protected data/effects before setup. I02: fake security with no agentWork or DB still works. I03: spoofed clientId/kind/role and missing presence cannot create user/admin. I04: conflicting authenticators reject; exact explicit bridge works; bad credential contained to connection. I05: disconnect before auth completes, release late, verify no old admission; replacement/rebind has distinct connection-generation fence. Bound setup time/count and preserve all existing close/frame-handling regressions.
