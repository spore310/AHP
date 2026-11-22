# P12 protected client-execution candidate

Status: ACCEPTED P12 X01-X06 after full DB-safe gate and independent final PASS.
Base accepted P11: `8189e1da3d4abb64594aa01dc271d8f27b24f2e4`.
Current Git HEAD `cc796c9` is an automatic intermediate checkpoint, not P12
acceptance. The candidate includes its changes plus the current scoped worktree.
Lead owns writes/runtime; `p06_review` owns independent read-only review.

## Implementation and proof boundary

`policyIntegration.test.ts` uses public `createAHPServer`, both production public
tool-client entrypoints, and pinned Microsoft SDK WebSocket transport. No binding
kernel substitution or policy allow-all adapter is used. Test-only credential,
actor, resource, grant, registration and provider adapters are explicit authority.
Distinct credential subjects classify actual user/agent contexts. Agent bindings
carry canonical parentGrantId lineage, agent ID/generation and delegation reference.
ClientId text cannot supply those facts.

One `createCodingHarness` export supplies read/summary/write/terminal contracts.
Trusted registrations bind exact contract/schema/version, implementation/location,
registration/source revisions, source path/export and source-file SHA-256. Intended
handler/results and zero competing handlers are observed. This is fixture source
binding, not remote code attestation or a client-reported hash accepted as authority.

The triage origin is a real typed native session. Its distinct chat target has a
grant parent naming another real native session; the workspace is a separate
required-provider target. Sessions cannot themselves have grant parents. Broader
parent assignments do not replace triage assignments or mandatory target policies.

The P12 tests found stale private advertisements after assignment invalidation.
The reviewed [amendment](P12-invalidation-amendment.md) adds a readiness epoch,
independent of captured in-flight ownership: new and not-yet-enqueued calls need
a current private acknowledgement; already-enqueued work retains existing fences,
status/cancel authorization, exact completion and draining cleanup. No public wire
shape or policy authority changed.

## Acceptance mapping

All names below are in `src/tests/websocket/policyIntegration.test.ts`. Every
`X05/X06 %s` test runs separately for self and distinct cross-client connections.

| Criterion | Concrete test evidence |
| --- | --- |
| X01 | `one harness preserves distinct senior, junior and PM user/agent inventories, private results and SDK views`: real classified identities/lineage, different private inventories, read/summary success, guessed write/terminal denial, foreign status absence, parent revoke, independent senior control. |
| X01 / SCENARIOS section5 | `grants issued after initialization give the agent only an explicit subset and parent revocation suppresses its parked call`: native reads remain allowed but both tool inventories start empty; actual parent issuance gives read+summary, explicit child delegation gives read only, undelegated summary denies. Parent revoke during the child's invoke-only barrier suppresses the call and empties both inventories while the native connection stays usable. |
| X02 | Same test plus `broader parent-session authority cannot replace triage-chat assignments or its mandatory constraint`: native parent view has write/invoke while triage does not; denied replacement/advertisement and mandatory chat revocation with intact parent grant. |
| X03 | Same test feeds actual public snapshots/events to pinned sessionReducer, checks canonical serverSeq and repeated snapshot equality. Per-peer raw init/snapshot/action/private/error/status captures contain allowed positive canaries and exclude restricted descriptors/schemas/input/output/source metadata. Current full gate also reruns P10 policyEgress/policyProjection and P11 public toolProtocolV2 tests for queued native publication, replacement snapshots, final status fences and exact completion correlation. |
| X04 | `P12-reviewed-validate.log`: lint/typecheck, 88 files / 1111 tests, 199 source mappings, production build, CHECK_EXIT 0. No database/migrations, persistence or work implementation changes. |
| X05 | All self cases in the matrix below; actual caller and executor are the same authenticated connection/generation but independent invoke/execute assignments. |
| X06 | All cross cases below; caller junior-agent and executor senior-agent are distinct actual authenticated connections. A's attempted local registration is rejected; B alone runs and returns the validated result. |

## Public route matrix

| Requirement | Test-name fragment and distinguishing assertions |
| --- | --- |
| Positive identity/contract/source/resource/route | `executes the approved harness with actual identity, source and full mandatory route`: exact actual host context/generation, contract, registration/source revisions, implementation, full origin/chat/workspace route; validated result; observer canaries; zero A/other handler calls. |
| Missing/invalid authentication | `rejects missing and invalid credentials before initialized tool authority`: separate raw sockets, initialize and dispatch error replies, raw hidden-canary absence and zero registered-handler effects. |
| Independent caller/executor grants | `independently requires caller invoke and executor receive grants`: remove exact receive tuple; restore it; then remove caller invoke role while restoring exact assignment rows. Both deny before handler delivery. |
| Forged identity/authority and selectors | `denies forged authority, contract/source/location and route selectors without local effects`: actor/role/owner/grant/provider/executor, contract ID/version/schema, implementation/source/revisions/location, origin/target and invalid-input variants plus denied legacy alias. Successful call afterward controls handler reachability. |
| Local schema/output contract | `rejects local contract/schema substitution and validates the selected handler output`: local ID/version/descriptor/input/output-schema substitutions cannot join; invalid actual output becomes failure without output disclosure; valid later output succeeds. |
| Exact executable tuple | `client refuses substituted source, implementation and connection tuples on actual host invocations`: mutate actual inbound frame source/revision/registration/implementation/location/connection ID/generation/contract version/origin incarnation. No local callback. Exact original correlation is used only for explicit cancelled-call cleanup, not positive execution proof. |
| Origin/target/provider proof | `rejects altered trusted routes and absent provider proof with otherwise valid grants`: missing/expired/wrong-incarnation provider proofs; omitted chat/workspace; substituted/retired origin and targets. Positive before/after controls and no denied input delivery. |
| Mandatory provider refusal | `obeys mandatory provider denial despite otherwise valid caller and executor grants`: observed allow-deny-allow evaluator decisions and exact handler counts. |
| Missing required evaluator | `denies an absent required invoke evaluator despite live native views and an active executor`: required invoke-only evaluator is omitted, provider approval remains installed, native reads and real advertisement succeed, exact invoke denies with zero input/handler delivery. Runs both routes. |
| Missing mandatory binding | `denies when the caller loses the mandatory chat constraint binding`: completed positive before removal, denied dispatch/closed connection barrier, no extra effect/input. |
| Unsatisfied challenge | `denies an unsatisfied required challenge before any assigned tool view` preserves raw failed-connection captures. `reaches a required invoke challenge with a real independently authorized executor` activates a real nonchallenged advertisement and requires challenge only on exact invoke tuples; invoke-specific permission evaluation is observed, dispatch denies and handler stays untouched. |
| Awaited revocation | `revocation during an awaited decision denies without executing the quarantined call`: caller/workspace/invoke-specific reached/release barrier, canonical grant removal, released allow verdict, zero extra execution/input and finally-drained adapter promises. |
| Stale/replacement connection | `cannot reroute a parked call onto a replacement executor connection`: hold actual route resolution, close exact connection, reconnect same actor with new ID/generation and handler, release old decision. Old call denies; replacement sees no old input; new call succeeds once. |
| Same URI/new incarnation | `rejects a parked call after the same session URI acquires a new incarnation`: dispose/recreate canonical session during held resolution; old endpoints close, new instance/handlers do not receive old call; new call succeeds. |
| Assignment/advertisement invalidation | `retires invalidated advertisements before selection and after awaited resolution`: invalidate unrelated grant while resolution awaits; hint observed, old and newly attempted calls deny; fresh acknowledgement restores execution. |
| In-flight ownership | `preserves exact in-flight cancellation and cleanup after advertisement invalidation`: handler is already running, fresh status remains running, cancellation signals exact executor, capacity stays draining until actual completion, then clears; late output not disclosed. |

## Validation and review evidence

All runtime checks use `Invoke-DbSafeCheck.ps1`, with DB/auth/provider environment
values removed in the child. No live persistence, installs or external provider
were used. Full gate is on the current formatted candidate, not the old 730-test
snapshot. P12 adds 37 tests to accepted P11's 1074 tests.

Important preserved RED logs: `P12-auth-provider-first.log` (wrong close assumption),
`P12-selector-grants-first.log` (immutable fixture binding replacement),
`P12-negatives-first.log` (unrefined barriers), `P12-parent-diagnostic.log` and
`P12-parent-post-close-diagnostic.log` (locating stale advertisement routing),
`P12-invalidation-routing-red.log` / `P12-invalidation-narrow-red.log` (accepted
lost call), `P12-parent-fixture-first.log` (sessions cannot have grant parents).
Subsequent positive logs and the full gate preserve the corrections.

Independent plan review PASS; independent amendment plan/implementation PASS.
Reviewer inspected epoch readiness and final enqueue, active ownership, and the
earlier baseline/barrier/challenge corrections without running tests or editing.
First whole-packet review verified all13 hashes in P12-review-candidate.sha256
(SHA256 2aa46329eb122422d5c452ac5297eb4f5479c5dbd3c8ea4fcff42f098f21dc5f) and required
the two rows above: post-init strict child subset and absent invoke evaluator.
Those three added tests pass in P12-review-gaps-first.log. The first full gate
and 34-test packet run are prior-candidate evidence; refreshed full validation now passes in P12-reviewed-validate.log: 88 files /
1111 tests, 199 mappings, lint/typecheck/build CHECK_EXIT0. Independent final p06_review PASS verifies all15 hashes of
P12-revised-candidate.sha256 (SHA256
115999024c75681308e0250b44a40c8f60d3444b0470795c71d36b5325808edb), both new rows,
the unchanged production repair, scoped docs and all X01-X06 requirements.
P12-revised-packet-focused.log also passes all37 tests. Reviewer ran no tests.
Final acceptance-record hashes are in P12-final-candidate.sha256.

P12 does not prove server-provided execution (P15/E05), challenge continuation
success (P13), artifact execution, or P19's final integrated three-route proof.
The goal remains active beyond this packet and all normal checkpoint pushes.
