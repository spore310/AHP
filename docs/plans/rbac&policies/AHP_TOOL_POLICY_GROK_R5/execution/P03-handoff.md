# P03 accepted handoff

**VERIFIED FOR PACKET / ACCEPTED by lead.** The bounded P03 recovery is complete. P04 is dependency-eligible but not implemented by this acceptance. This is not a shared-host privacy or production-release certification.

## Exact candidate

- Base: `agentIdentity@22fa7955b8e43839e041228f647f26e00762ebbe` plus accepted predecessors and uncommitted P03 changes. No commit was made.
- Accepted manifest: `P03-accepted.sha256`, **56 files**, copied from the exact reviewed candidate after every path hash was reverified.
- Manifest SHA-256: `fa567a9c5558f0c3250d4460ab35846bb7a9e4f6bd818fbf520176cf27c98497`.
- Verification timestamp: `2026-10-26T12:40:31.410Z` (host clock).
- Most new source/tests and the supplied plan bundle remain untracked. Preserve unrelated work and pre-existing `nul`; Git diff alone does not identify this candidate.

## Delivered boundary

A bounded per-host reference authorizer owns domain-qualified resource identity/ownership, trusted scoped bindings, installed direct/namespace admission ceilings, all mandatory route restrictions, permission and extension evaluation, expiry/invalidation stamps and synchronous local freshness.

Private assignment projections require exact registered canonical contract, policy/binding, resource/route, recipient and purpose. Execute uses a separate approved implementation/executor registry with full identity/connection/generation/registration fences; caller identity is retained separately. Canonical descriptor materialization verifies issued provenance and every contributing current decision. Reveal is discovery-only and cannot grant membership or execution.

Inputs/registries have independently validated limits. Captured options and snapshots cannot be widened by later mutation. Identical installs preserve capacity/currentness; immutable conflicts reject. Resource teardown cleans instance/route-bound assignments. Once linked, a resource admission association cannot be omitted or replaced by reinstall.

Trusted installation is not P06 issuance. External proofs are trusted in-process adapter facts, not wire credentials. No transport/session/work wiring, durable ownership relaxation, database access or production inference was added.

## Acceptance evidence

| Criterion | Actual evidence | Result / limits |
| --- | --- | --- |
| A01 no authority by default; direct grants | Named A01 in `src/tests/authorization/evaluate.test.ts`, direct/no-namespace controls in `admissionInputReview.test.ts` | PASS; no synthetic role or user |
| A02 complete scoped path and all constraints | Named A02 plus mandatory permission/extension/target, proof and callback cases in authorization review/completion suites | PASS |
| A03 no fragment synthesis | Named A03, exact pair and selected mandatory alternative tests | PASS; no fallback after chosen denial |
| A04 reveal never grants | Named A04 in `src/tests/toolPolicy/assignments.test.ts`, exact assignment/canonical/provenance tests | PASS |
| A05 caller/executor purposes | Named A05 plus full execute positive/mismatch matrix in `assignmentCompletionReview.test.ts` | PASS; original caller remains currentness context |
| A06 reusable harness isolation | Named A06 with both exact installed private assignments; cross-actor and cross-host tests | PASS |
| Bounded input/registries, async capture/freshness, proof deadlines and invalidation | Full A/B1–B10 mapping in `P03-sol-coverage-handoff.md` | PASS; 48 owned cases and concrete positive controls |
| Original seven RED security regressions | `evaluateReview.test.ts`; preserved assertions | PASS |
| Callback/mandatory-expiry lifecycle | `freshnessReview.test.ts`; prior RED and strengthened positive/timer controls | PASS |
| Linked admission cannot be dropped/replaced | `resourceAdmissionReview.test.ts` | Pre-fix 2 intended RED / 1 positive; final 3 PASS |
| Full repository gate | Lead `pnpm validate` with logged child DB/auth/provider variable exclusions | **exit 0: 68 files / 533 tests; lint, typecheck, docs mapping (151 sources), build passed** |
| Independent final review | Luna `P03-luna-final-review.md`, then `P03-luna-admission-recheck.md` | One material P1 reproduced/fixed; narrow recheck PASS; lead owns final acceptance |
| Exact-candidate integration | Lead reverified all 56 manifest entries after review | PASS |

Final execution log: `P03-admission-link-validate.log`. Earlier green 530-test log: `P03-takeover-final-validate.log`. Admission-link RED: `P03-admission-link-red.log`. Sol's final lint and exact 48-name preservation: `P03-sol-lint-handoff.md` and `P03-sol-coverage-checks.log`. Historical failed gates/reviews remain evidence, not current acceptance state.

## Shared-file amendment and scope audit

Only the explicitly documented dependency-only amendment in `P03-schema-import-amendment.md` affects accepted shared implementation: `src/toolPolicy/helpers/validation/helpers.ts` imports authorization constants/validation leaves rather than the root barrel. This allows reuse of the existing execution-binding schema without a cycle. No schema behavior, limits, or public P01/P02 types changed. Reconstructing the old import block reproduced its accepted SHA-256 exactly.

Other accepted-baseline differences are the authorized authorization/toolPolicy owning indexes and READMEs. The obsolete unused P03 context checker/types were removed; public LocalDecisionStamp refers to the actual evaluator, with one authoritative currentness path. No dependency, host/work/transport/DB files changed in P03.

## Next packet / residual limits

P04 may now be assigned against this frozen boundary. Its existing preflight still requires an explicit trusted scoped setup seam: no unscoped BindingResolver reads, manufactured grants, conflicting authenticators or subject-only multi-domain work collapse. Protected initialization must wait for authority setup and fence late completions. P10–P12 privacy work remains mandatory; authenticated alone is not permission to disclose raw snapshots.

No workers retain unresolved assignments from this bounded recovery. Existing panes are Luna w8:p3 and Sol w8:p4; lead w8:p2 owns onward sequencing. The user-authorized remaining dependency sequence is not claimed complete by this handoff.
