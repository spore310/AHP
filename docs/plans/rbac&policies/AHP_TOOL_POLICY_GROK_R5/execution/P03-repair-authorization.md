# P03 repair execution authorization

**Plan gate: PASS / PLAN READY. Implementation: authorized, not yet verified.**

Lead inspected and accepts `P03-repair-plan-addendum-review.md`. Execute `P03-repair-plan-v2.md` plus `P03-repair-plan-addendum.md`; the addendum governs the six corrected boundaries. This authorization supersedes their historical plan-only/implementation-paused language. It does not accept the P03 candidate or authorize P04.

## Ownership and scope

- Sole production writer: **w8:p4**. Reviewer w8:p3 is idle until a separate final-review assignment.
- Allowed production files: P03 helpers under `src/authorization/helpers/{context,resources,bindings,evaluate}/` and `src/toolPolicy/helpers/assignments/`, their owning indexes, and corresponding module READMEs. Keep established helpers/types/index organization; no monolithic replacement outside these owners.
- Allowed tests: `src/tests/authorization/evaluate.test.ts`, `src/tests/authorization/evaluateReview.test.ts`, `src/tests/toolPolicy/assignments.test.ts`, focused new P03 review/regression files in those test directories, and owning README source maps where required.
- Lead transfers execution ownership of `evaluateReview.test.ts` to the writer for API adaptation and stronger fixtures. Preserve all seven security expectations and real pre-expiry allows. No skipped tests, removed denials or deny-all substitutes.
- Allowed result artifacts: `execution/P03-repair-handoff.md`, `execution/P03-repair-validate.log`, and narrowly named P03 repair check logs under this bundle.
- Lead alone owns the ledger, orchestrator handoff, acceptance record and manifest. Do not edit those or start the next packet.

No P01 shared types/schemas/constants or P02 compiler edits without an exact amendment request. No host/session/work/transport/DB changes, dependency upgrades, commits, reset/stash, deployment, new worker/model/account changes or production runtime inference. Preserve all unrelated tracked and untracked files, including `nul` and the supplied plan bundle.

## Required execution order

1. Inspect branch/HEAD and staged/unstaged/untracked scope; preserve the accepted P01/P02 baseline. Identify any unexpected concurrent changes before editing.
2. Implement in thin internal slices: captured bounded registrations and exact selectors; one complete async decision path with mandatory constraints and synchronous freshness; then exact assignment projection and canonical materialization. Keep a single writer throughout. Internal slice checks do not authorize P04.
3. Use distinguishing regression tests for each corrected boundary. Preserve A01–A06. Include the seven original RED scenarios plus the v2/addendum cases: exact resource/route/actor/executor/contract tuples, every target's mandatory/external requirements, selected mandatory alternatives without fallback, whole-input capture across awaits, independent caps including invalidation overflow, and stale/forged/cross-actor projection rejection with valid positive controls.
4. Adapt the disclosure regression to the revised API without making it vacuous: install the exact assignment and assert the denying permission callback actually ran. A missing assignment or invoke non-disclosure alone is not proof.
5. Update affected module READMEs/source maps to actual implemented behavior before the final validation gate. Documentation edits are explicitly authorized here; do not claim P03 accepted, P04 wired, or shared-host privacy complete.
6. Run focused tests and typecheck, then complete DB-safe `pnpm validate` using the child-environment exclusion procedure recorded in `P00-baseline.validate.log`. Never access a live DB or weaken checks to pass. Capture exact exit status, test counts and full gate result.
7. After two failed repair attempts for the same criterion, stop with the smallest reproducer and exact evidence for fresh diagnosis. Do not continue speculative patch loops.

## Completion handoff

Report exact changed/untracked paths, API ownership, A01–A06 and new regression test mapping, focused/full gate commands and results, any remaining limitations, and confirmation of no P01/P02 amendment. Explain caller/executor separation, route-proof coverage, exact mandatory selector behavior, final no-await admission, and descriptor tuple provenance with source pointers.

Stop after delivery. **Actively notify w8:p2 via `herdr agent prompt` with handoff/log paths and status.** A green worker gate is a candidate for independent review, not acceptance. Lead will inspect final files and evidence, arrange bounded final review, and accept/hash only the final verified candidate. P04 remains blocked until then.
