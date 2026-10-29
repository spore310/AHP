# P05 correction handoff — draining work and atomic admissions

**IMPLEMENTED / VALIDATED / FROZEN for lead validation and Luna's narrow recheck. Not P05 acceptance.** Sol was the sole correction writer and now stops.

Authority: `P05-correction-authorization.md`, accepted findings in `P05-final-review.md`, and lead's explicit test-only extension for `admissionInputReview.test.ts:326–327`. No P06 advancement.

## P06 state before priority switch

P06 planning was explicitly PAUSED and actively reported to `w8:p2` before correction work. Packet, contracts, preflight, lead notes and frozen public types were read; **no P06-plan.md, source/test changes or P06 runtime commands** were produced. Resume only on explicit lead direction after corrected P05 acceptance; P06 APIs/limits remain unresolved planning work, not implementation.

## Final candidate / gates

- Retained actual evidence: **`execution/P05-correction-checks.log`**.
- Final full DB-safe **`pnpm validate` PASS: 72 files / 684 tests**, lint/typecheck, documentation (**163 mapped sources**) and build. Marker **`P05_CORRECTION_FULL_VALIDATE_EXIT:0`** supersedes the historical662 gate for this candidate.
- Final correction-only **10-file source/test/README manifest SHA-256**: **`6f194e2729ecef2b8c77519261e06de3aa7a80cf6452a482cdb7803c08bc1d05`**. Per-file hashes are retained under `P05_CORRECTION_SOURCE_TEST_README_COUNT 10`; digest input is sorted `hash space path LF` lines.
- Pre-correction combined manifest remains historical/unmodified:106 entries, SHA `be7738824a0049a65c5a687ab4557123f533f8031ec7fea2f62d79e1b29fee23`. Exactly10 authorized differences /96 unchanged; **no unaccounted source paths**.
- HEAD unchanged: `22fa7955b8e43839e041228f647f26e00762ebbe`.

Every runtime gate used established child PostgreSQL/database/Supabase/auth/provider environment exclusions, without printing values. No live DB/external service, packages, models/accounts, children, commits, reset/stash/worktrees or deployment. Existing dirty/untracked state and `nul` were untouched.

## P1 — actual unsettled work remains occupied

The existing finite URI-reservation map still releases its reservation promptly on timeout, request abort, expected disposal or global factory disposal. A separate scalar counts outstanding prepare invocations, incremented **before scheduling** the application callback. Both visible reservation count and actual outstanding work are checked against the existing `maxPendingCreates`.

The scalar decrements only in the underlying invocation promise's settlement path, including rejection/synchronous throw/skip before invocation. Cancelled callers do not free it; global disposal, epoch changes and bare-factory reuse do not reset it. No new queue/map/timer or duplicate configuration cap was introduced. A permanently uncooperative adapter saturates capacity and fails closed rather than accumulating unlimited unresolved work. Caller cancellation/URI release/dispose still returns promptly. Late fulfillment invokes its captured idempotent release once; late rejection remains observed; neither can attach authority after cancellation.

### Distinguishing P1 controls

Ten new tests:

- `P1 max1 {abort|timeout|dispose} retains actual unsettled work across reuse until {never|allow|reject}` — nine real cases. First registered callback ignores cancellation and stays unresolved. Valid retries on the same and different URIs, including after global dispose/reuse, cannot start another callback. Never-settling cases genuinely never settle. Allow/reject cases recover legitimate same-URI successor capacity only after actual settlement; no old owner/backend attaches.
- `P1 URI release is distinct from draining occupancy when another real slot is available` — max2 positive: one cancelled/draining invocation still occupies one slot, but its released URI can be used by a real new creator in the other slot. Old late release preserves the successor's real decision currentness.

Existing default-cap cancellation/successor assertions remain unchanged: they have legitimate spare work capacity. No old test was weakened to equate cancellation with settlement.

## P2 — one atomic canonical admission cohort

`ReferenceAuthorizer.installAdmissions(inputs)` now:

1. Validates the captured per-call list bound before copy/iteration; snapshots a fixed bounded selector cohort before compiler calls can mutate caller-owned input.
2. Resolves/stages exact canonical compiler rules and namespace closure with duplicate/conflict validation, without touching admissions/epoch.
3. After all compiler callbacks finish, compares staged entries with CURRENT canonical state and aggregate NEW-entry capacity. Existing identical entries consume no new storage.
4. Publishes all additions synchronously with no intervening callback/await, then advances existing epoch/grant revision **once** only when something changed. Empty/all-identical batches are no-ops, including at cap. Failures do not compensate by removing existing entries.

`installAdmission` delegates to this same common path. Protected creation captures the batch method and calls it once for the complete validated type-registration set, not sequential batches or compensating cleanup.

New `ReferenceInputLimits.maxAdmissionInstalls` is captured like the other input limits: **default128 / absolute1024**, duplicates count. This is a per-call bound, distinct from total `maxAdmissions` storage capacity. P01 limits/schemas and P02 compiler remain untouched. Exact selectors retain the compiler's own captured validated identifier budget rather than accidentally imposing the default identifier limit on valid custom-budget registrations.

### Distinguishing P2 controls

Twelve new tests (two factory + ten canonical batch):

- Real coherent capacity1 authorizer + two valid policy-bearing session types: constructor fails while a genuine old allow stamp stays current; registry factory/approval/backend never run. Separate fresh controls prove **either** previously attempted type can subsequently occupy the untouched slot with exactly one revision change.
- Fitting batch with duplicates changes epoch AND grant revision once; empty/identical/single-existing calls remain no-ops at capacity.
- Empty-store and mixed existing/new over-capacity failures preserve prior currentness and leave slots available; no hidden partial admission.
- Invalid later selector leaves earlier valid selector uninstalled.
- Existing-entry and intra-cohort conflict negatives use an explicit faulty trusted compiler adapter over genuine unchanged policy bodies to exercise defensive conflict validation; no P02 implementation/mock grant engine was changed.
- Captured input2 ignores later constructor-options mutation; duplicates count separately from storage. Default128/129 and absolute1024/1025 boundaries, invalid0/1025 configuration, no capacity leak.
- Captured selector-list positive prevents compiler-call mutation of caller input from changing the authorized cohort.
- Single/batch selectors accepted by a genuine higher-budget compiler remain accepted (compatibility regression detected and repaired).

Owning READMEs document draining occupancy, cohort atomicity/input-vs-storage limits, and `ownerLookup` as the read-only AHP binding option. The protected host's canonical owner projection and legacy mutable option distinction are now discoverable.

## Actual RED/failure history (retained, not erased)

- Intended pre-implementation RED: **18 failed /62 passed** in80 focused tests. Never-settling/draining controls reproduced P1; actual capacity1/two-types constructor invalidated the prior stamp under P2. Missing batch API also failed new positive controls.
- Initial broader correction check: **205/206 passed**, typecheck0. Sole remaining old failure was the exact four-key default-input object assertion after the explicitly approved fifth key was added. No edit was made until lead approved the exact test-only amendment.
- Owned correction suites then **80 passed**. Scoped lint initially reported Array.isArray-induced `any` narrowing and autoformatted void assertion blocks; repaired with a typed alias/bounded copy and multiline blocks, no casts/suppressions. Lint/typecheck then0; broader focused authorization/toolPolicy/creation **206 passed**.
- Additional preservation regression exposed overly restrictive default identifier parsing of canonical higher-budget selectors:1 failed/21 passed, repaired by validating primitive selectors through the existing captured canonical compiler. Final full gate includes that positive and selector-snapshot control.
- First integrity-helper attempt had a quoted-path SyntaxError before execution; retained, then rerun successfully without path conversion. No source changes from the helper repair.

No skips, test deletions, thresholds lowered, non-null assertions, unsafe casts or intentional RED carryover. No criterion had two failed repair attempts without bounded diagnosis.

## Exact correction scope and integrity

Only these10 source/test/README files differ from the frozen106-entry predecessor:

1. `src/sessions/helpers/creation/helpers.ts`
2. `src/authorization/helpers/evaluate/helpers.ts`
3. `src/authorization/helpers/evaluate/types.ts`
4. `src/authorization/helpers/evaluate/constants.ts`
5. `src/tests/sessions/policyCreation.test.ts`
6. `src/tests/authorization/bindingRemoval.test.ts`
7. `src/tests/authorization/admissionInputReview.test.ts` — explicit extra test-only amendment
8. `src/sessions/README.md`
9. `src/authorization/README.md`
10. `src/websocket/README.md`

Execution outputs: this handoff and `execution/P05-correction-checks.log`. No plan/ledger/acceptance-manifest rewrite.

The old P03 test changes ONLY the expected default object and adjacent invalid/1024 key list to add `maxAdmissionInstalls`, preserving all four old keys/assertions and all other bodies. Audit reconstructs the old bytes by reversing exactly those two additions and obtains the exact historical digest **`d0a33b069cefb72b30d961b66c0facaed10f4b40801d54b8abb33c6c58832c3a`**.

Superseding P03 hashes:

| Path | SHA-256 |
| --- | --- |
| evaluator helper | `6f0018dbbfa0702640d5087a8494df59b5b382d22b4caea766c23717b3a437b0` |
| evaluator types | `1d4636563aa4918625b0d38b8c7f590da85087083de6385e59092477954bd59a` |
| evaluator constants | `edf3adc9c6343bd9c0e4cb2476d1cf3a53e3554f5576b7d3bd0e7ebdbdc45f4b` |
| authorization README | `0d1dfd72520523e751150f5ca77c728c36d2ae7c2d79677d1f862c4db10d4083` |
| admissionInputReview test | `4c4e22f404d2982de96dd1fa89285ce2a9b16428a40f220e9b546af24e1df5e8` |

All seven INTERNAL canonical suite whole-file hashes and eighth REAL PUBLIC `agentWork.transport.test.ts` match the predecessor. No correction edits to P01/P02, factory lifecycle module, websocket facade/host/kernel/transport/security/identity, work ownership/lease code, persistence or env. The original P05 semantic delivery outside these findings is not reworked.

## Stop / ownership

Source/tests/owning READMEs are frozen after `P05_CORRECTION_FULL_VALIDATE_EXIT:0` and the final exact-scope/hash audit. Lead owns exact-candidate validation, Luna's narrow recheck and P05 acceptance. The earlier662 gate remains historical. P06 remains PAUSED with no plan artifact or implementation; only lead may direct its resumption. Sol actively notifies `w8:p2` and stops.
