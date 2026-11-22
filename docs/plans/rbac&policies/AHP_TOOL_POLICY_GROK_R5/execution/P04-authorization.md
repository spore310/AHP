# P04 execution authorization / resolved plan amendment

**Lead plan gate: PASS with this amendment. Execute P04 only.** The user reaffirmed completion of P04–P19 in dependency order. P03 remains accepted; its 56-file manifest is the baseline. Sol w8:p4 is the sole P04 production/test/owning-README writer; lead owns scope decisions, ledger and integration; Luna w8:p3 reviews the stable candidate. No parallel production edits.

Read `P04-plan.md` together with this amendment and `P04-plan-review.md`. The independent review's REVISE finding is resolved by adopting its precise structural migration, not by deferring a failing gate or adding an unsafe mode. The remaining plan requirements, I01–I05 obligations and exclusions remain binding.

## Approved contracts and source scope

Approve the additive P04-local setup interfaces and explicitly proven one-source legacy identity bridge proposed in sections 2–3 of the plan. Initial seeds select existing exact scopes and grant revisions; scoped binding reads do not issue/install grants. Final connection attachment is synchronous and fenced after all asynchronous preparation. The seed/currentness/release contract is an explicit trusted adapter obligation, not a remote atomicity claim.

Approve the narrow `connection.ts` amendment to reserve and attach the actual connection ID/generation before authentication; preserve its frame pump, completion correlation, reply settlement and close algorithms. Approve owning public export changes and new internal security/identity modules listed in section 6. P01–P03 shared contracts, persistence/work stores, owner semantics, dependencies and environment wiring remain read-only unless a new exact amendment is approved.

## Resolved public/kernel migration

1. Isolate existing canonical AHP behavior under an internal supporting module, e.g. `src/websocket/helpers/ahp/helpers/kernel/`. This is not a second runtime or an additional public mode; the public facade delegates to this same canonical implementation only for admitted routes.
2. Keep `createAHPBinding` and `createAHPConnectionModule`, if retained, as the **safe facade**. No public/root/module barrel may export the raw kernel, raw factory alias, bypass capability, or unsafe option. Local file exports needed by the facade/tests are internal, not supported public APIs.
3. Public host and public AHP binding fail closed without security as well as with security. Safe minimal initialize/ping remain supported only after the explicit current shared-cursor permission required by the accepted `P04-sequence-resolution.md` amendment. No-security or missing approval cannot successfully initialize: the pinned native response necessarily includes the genuine global sequence. Authentication/setup readiness alone never permits that cursor, raw initial subscriptions, session/root/list/count snapshots, creation/actions or legacy tool delivery. P04 contains no recipient projector, so those native protected routes stay unavailable until their later packet adds actual authorization/projection. Work-extension routes retain their separate explicit principal/domain/owner/presence checks; no generic prefix fallback may accidentally admit tool/session routes.
4. The generic websocket transport remains generic for application-provided handlers. Its supported AHP exports cannot select the raw kernel. No security guarantee attempts to sandbox arbitrary trusted application JavaScript.
5. Prevent protected getters, pending subscriptions, backend calls and buffered egress, not merely redact their final serialized output. Preserve invocation-kind and successful-reply commit semantics. Never send a raw canonical payload simply because the setup promise resolved.

## Exact test migration permission

The anonymous full-disclosure expectations conflict with the accepted replacement behavior. Preserve their canonical/protocol/lifecycle assertions **unchanged**, but explicitly classify their scope as internal compatibility, not public product authorization:

- `src/tests/websocket/ahp.test.ts`: canonical snapshots/subscriptions, sequencing, buffering, reply settlement and lifecycle cases may construct the private kernel directly.
- `src/tests/websocket/sdk.test.ts`: old shared-session/two-SDK canonical compatibility cases may use the internal kernel harness. They do not certify the new protected host.
- `src/tests/websocket/toolInvocation.test.ts`: existing canonical broker/descriptor/correlation assertions may use that same internal kernel. No duplicate broker or allow-all policy fixture.

Additional source-confirmed migration scope approved after implementation intake: `agentWork.binding.test.ts`, `agentWork.disposal.test.ts`, and `sessionTypeCapacity.test.ts` may use the same internal canonical test construction for their existing create/dispose/type-capacity assertions. Preserve all assertions and evidence labels. `agentWork.integration.test.ts` is now approved for an isolated, file-local Vitest module-factory substitution of the host's `@websocket/helpers/ahp` binding import with the private kernel. The actual host constructor, sessions/sequencing, AgentDirectory, owner registry, WorkService, hostedSessions facade and stop/disposal code remain real and unchanged; every assertion is preserved. Label this INTERNAL canonical host-wiring evidence, not public protected-host integration. The same file-local construction seam is permitted in the already authorized SDK/tool/capacity compatibility suites when required. No global test setup mock, production raw constructor/flag/export, or dependency on this substitution in the new public-security suite. Run internal and unmocked public suites together to verify isolation; the real public suite must independently cover no-config denial, exact bridge/domain rules and work-principal behavior.

Backward-compatible context amendment: new generation/security/currentness fields may be optional on the legacy `WebSocketConnectionContext` interface, so old trusted unit fixtures need not fabricate authority. Real transport always supplies generation and currentness; the safe facade treats missing fences/currentness as no protected authority.

Only imports/construction/helper wiring and evidence labels needed for this classification may change; do not delete, skip, relax or rewrite expected protected outcomes to get green. Split or retain any already-public security/work cases on the public facade. If other files require migration, report the exact paths/assumptions before editing them.

Add real public-facade/public-host network tests in `policyInitialization.test.ts`: no-config denial and safe initialize/ping positives; safe configured identity+exact initial binding setup without DB; protected output still denied after successful setup; both parked identity and parked authority; no public kernel export/raw option; currentness, cancellation, time/count limits and all required I01–I05 distinguishing controls. Preserve explicit trusted user and verified registered-agent positive controls and do not infer human from absent presence.

This is structural containment plus replacement public tests, not simply relabeling an externally selectable raw path as trusted. The old internal tests prove canonical mechanics only. P12 must still add actual authorized SDK multi-client/reducer evidence on the integrated public host. All applicable tests and the full P04 gate must pass; no intentional-RED carryover is authorized.

## Execution and stop conditions

Sol should update its plan's formerly unresolved section 4/write set to reference these accepted decisions, then implement in the ordered slices already specified. Capture focused RED/GREEN results and all actual failures. Use the exact DB-safe child exclusions already recorded in P03 logs; no secrets in evidence. Run targeted lint, focused tests/typecheck, documentation mapping and full `pnpm validate`. No dependencies, live DB/services, deploy, commits, models/accounts or children.

Return `P04-worker-handoff.md`, actual checks log, source/test changes and precise I01–I05 evidence. Freeze files and actively notify w8:p2; do not start P05. After two failed repairs of one criterion stop that repair loop with a minimal reproducer. Any necessary public contract change beyond this amendment must be raised before implementation. Lead integrates, verifies exact scope/hash, and obtains Luna's independent final review before P04 acceptance; only then is P05 assigned.
