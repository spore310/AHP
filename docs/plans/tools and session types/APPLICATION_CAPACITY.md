# Application capacity follow-up

Status: implemented and validated against `ba6ba17` plus the uncommitted working tree. This follow-up closes the four reviewed application gaps and adds client-executed invocation; it does not claim every scenario in the original 100-case plan is complete.

## Accepted scope

The user requested the four application gaps from the review be closed:

- public descriptor projection;
- created sessions list their full visible tool contracts;
- clients can advertise only those exact contracts;
- the default application composes typed sessions.

The user then expanded acceptance to an actual end-to-end tool call and result, not visibility alone. This amends the earlier declarations-only boundary for this follow-up. It does **not** authorize persistence, server-side filesystem tools, a model runtime, or Pi execution on the server.

## Ownership and flow

- Sessions own creation-time type/role policy, pinned tool refs, manifest reads, and atomic advertisement admission before reduction.
- Tools own immutable contracts, trusted-schema validation, descriptor projection, and bounded exact JSON comparison.
- Application owns the inert `code-review` and `coding` examples and default host policy.
- The AHP binding owns a namespaced client-executed invocation broker; `@toolClient` exposes the public SDK adapter. The server validates/routes calls; registered local client handlers execute them. These are application extensions, not new standard AHP methods. Luna implemented the broker, adapter and narrow deferred-request seam; lead review/integration added and reran the acceptance regressions.

Expected flow: public application composition -> native typed create -> session snapshot manifest -> exact client advertisement -> validated invocation routing -> local implementation -> validated result returned only to caller.

## Invariants and threats

- Neither a manifest nor an advertisement is an executor or authenticated permission grant.
- Full contract-bearing schema content survives parsing. A revision/name/schema mismatch rejects the entire advertisement without a reducer mutation or accepted event.
- Missing/untyped manifest reads return `undefined`. Reads allocate no sequence numbers and expose no normalized application config.
- Tool policy is captured per factory; manifests and snapshots are detached. Caller mutations cannot change authoritative session state.
- Invocation correlation must be owned by actual connections, not claimed client IDs. Inputs/results must not be broadcast to observers.
- Invalid input, unavailable/ambiguous executors, forged results, invalid output, timeout and disconnect must settle safely. No automatic retries of possibly executed calls.
- Existing unauthenticated/presence limitations remain explicit. No SQL, Redis, durable write or replay is introduced.

## Verification gates

Use focused factory/parser tests plus real `AhpClient`/`WebSocketTransport` connections on loopback ephemeral ports. End-to-end acceptance must observe a matching manifest on creator and observer, an accepted allowed advertisement, a rejected changed/unassigned one with unchanged state, an actual local handler execution and its returned result. Negative checks use a causal barrier rather than a silent timeout.

## Final evidence

- Public APIs: `toAhpToolDefinition`, `getSessionToolManifest`, `createBaselineSessionApplication`, `connectToolClient`, `joinSession`, and `callTool`.
- `src/tests/websocket/toolInvocation.test.ts`: ten real-socket tests cover matching SDK manifests, exact advertisement echo, local execution/result round trips, observer privacy, schema/admission rejection, outsider calls, forged/stale/ambiguous executors, disconnect/URI reuse, concurrent self-calls, capacity/release, large manifests, and empty registration.
- `src/tests/websocket/deferred.test.ts`: isolates a throwing completion matcher without breaking queued ordinary requests.
- `src/tests/toolClient/transport.test.ts` and `src/tests/toolClient.test.ts`: request-shaped/wrong-version invocation never executes a local handler; UUID string IDs correlate simultaneous requests.
- `src/tests/toolClient/connection.test.ts`: initialization failure closes the actual socket before server cleanup.
- Factory tests cover captured policy, detached manifests/state, role-hidden contracts, full schema preservation, config separation, and atomic denial.
- Lead-rerun `pnpm validate`: PASS — 31 test files, 230 tests; lint, typecheck, documentation mapping (77 source files), and production build all passed. Independent within-team implementation/review feedback came from Luna; this was not a sealed two-reviewer audit.

Limits: authentication/session authorization and persistence remain deferred. The 30-second broker timeout is implemented; actual elapsed-time expiry is not a separate end-to-end test. Handlers execute on clients; no filesystem implementation or model/Pi runtime is bundled. A handler must not await ordinary AHP requests on its own socket while its call is pending (documented in the client README).

The user authorized commits after final validation. No push was requested.
