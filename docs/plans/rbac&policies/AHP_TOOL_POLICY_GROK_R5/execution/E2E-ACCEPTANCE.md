# User-required end-to-end proof

The user confirmed this R5 bundle as the intended plan and explicitly requires real public-server/tool-client proof for three routes: a client invokes its own supplied tool, a client invokes a server-provided tool, and client A invokes client B's tool. Each must prove verified caller/executor identity, exact server contract/schema and implementation/source binding, resource/route identity and policy authority. Unit tests, private-kernel fixtures, constructor shapes and aggregate green counts alone do not establish this. Preserve all stricter existing criteria.

Required final evidence: real public createAHPServer + actual tool client/pinned SDK over loopback; genuine authenticated identities, exact registered policy/namespace configuration and actual local handler side-effect/result. Assert authorized success alongside denied variants with zero forbidden handler effects and recipient-specific raw-wire/schema/result canaries. Keep canonical/native sequencing and reducer assertions, revocation/URI-reuse/concurrency barriers, namespace-as-ceiling rather than grant, mandatory provider restrictions, and same-harness cross-user isolation. Name each scenario and link its candidate-specific run/log; P12 and P19 remain required checkpoints.

Relevant existing plans: `../TEST_RUNBOOK.md`, `../TEST_COVERAGE.md`, `../SCENARIOS.md`, packetsP07/P12/P18/P19 and POLICY_FACTORY/AUTHORITY/DELIVERY_WIRE/EXECUTION contracts. Historical tool-client end-to-end scope also appears in `docs/plans/tools and session types/APPLICATION_CAPACITY.md`, TASKPLAN.md and packets/WP-09.md; historical passes are not current protected-host proof.

The source-plan ambiguity is resolved: the user named `docs/plans/rbac&policies/AHP_TOOL_POLICY_GROK_R5`. Do not search for a separate source-map plan. Exact registered implementation/source evidence is not remote runtime attestation; client-reported hashes alone are not proof of what remote code ran.

The three-route final proof remains incomplete. The 730-test result and failed
worker launch in [CODEX-CLI-HANDOFF.md](CODEX-CLI-HANDOFF.md) are historical starting
evidence. X05/X06/E05 additions are now present in the packet/runbook/coverage
targets. P06-P11 have subsequent accepted checkpoints; see
[CODEX-CONTINUATION.md](CODEX-CONTINUATION.md) for current candidate status.

P12's `policyIntegration.test.ts` now exercises real self and cross-client
execution and their denial matrices, with classified user/agent identities,
exact registration/source tuples, parent/triage/chat/workspace identities,
mandatory provider and challenge constraints, raw frames, SDK reducers, and
awaited revoke/reconnect/incarnation races. P12 is accepted after independent final review. Full DB-safe
P12-reviewed-validate passes 88 files / 1111 tests and every other gate stage. The [invalidation amendment](P12-invalidation-amendment.md) records a
reproduced stale-advertisement routing defect and its bounded repair. P15's server
route and P19's final integrated rerun remain outstanding.
