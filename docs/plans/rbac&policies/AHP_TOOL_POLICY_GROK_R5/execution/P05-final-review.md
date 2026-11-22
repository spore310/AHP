# P05 final read-only review

**Verdict: REVISE — P05 is not accepted by this review.** Reviewed the frozen combined candidate `P05-candidate.sha256` (106 files; SHA-256 `be7738824a0049a65c5a687ab4557123f533f8031ec7fea2f62d79e1b29fee23`), the P05 packet/contracts/amended plan/authorization, actual source and tests, then `P05-worker-handoff.md` and the final marker in `P05-checks.log`. Candidate-scope and handoff report 30 worker files, nine approved predecessor changes, and no unaccounted source paths. The worker reports final `pnpm validate` exit 0 (72 files/662 tests/163 mapped sources); I did not rerun it. Lead's independent gate was still running. No source/test/runtime/DB changes or commands were made.

The reviewed happy paths and required controls are substantially present: exact captured compiler identity before admission effects; separately approved exact type/provider creation; immutable callback/template/input/caller capture; 512 URI and 1 MiB bounds; same-connection ready/current cursor gate for network create and `null`-only success; reservation, abort/late-result, reentrant guard, no-await attach/rollback and expected-instance cleanup; bootstrap withdrawal before failure notification while preserving owner; conditional P03 removal and work-owner lookup projection. The seven internal suites and eighth public `agentWork.transport.test.ts` fixture are recorded unchanged; the new public success uses the actual facade/host rather than a kernel mock. I found two material gaps below.

## Findings

### P1 — canceled creation frees the pending limit while its application prepare promise can remain live

`src/sessions/helpers/creation/helpers.ts:267` enforces `maxPendingCreates` using only `pending.size`. Cancellation at `:279-288` deletes the reservation immediately. The application callback promise is separately created at `:299-307` and raced against `aborted` at `:308`; racing does not cancel or settle the original promise. Timeout and request-close use the same cancellation path (`:287-288`). The late-result tests in `src/tests/sessions/policyCreation.test.ts:369-405` resolve or reject the callback after cancellation; they do not cover a callback that never settles.

**Reproduction:** configure `maxPendingCreates: 1` and a registered `prepare` callback that ignores its `AbortSignal` and returns a never-settling promise. Start a valid create and abort/close it. The request rejects and its slot is removed. Repeat with distinct URIs; each call reaches `prepare` while every prior callback remains pending. Thus authenticated network creates can accumulate unbounded unresolved adapter work/retained request state despite the configured cap and prompt cancellation. The same occurs on timeout or factory cancellation.

**Required direction:** keep a separate bounded count/semaphore for every still-unsettled underlying prepare callback, including canceled/timed-out calls, and release it only when that callback settles (while continuing to reject the caller promptly and consume late results safely). Add a never-settling callback regression that repeatedly cancels requests and proves the cap prevents another callback from starting. Do not count only visible URI reservations as the preparation bound.

### P2 — registration-cap failure can leave partial admissions in the caller-owned canonical registry

`src/sessions/helpers/creation/helpers.ts:123-149` validates the type registrations into an array, then applies `installAdmission` sequentially. The shipped authorizer inserts and bumps its revision for each new admission, and only then checks the capacity for the next one (`src/authorization/helpers/evaluate/helpers.ts:635-642`; default `maxAdmissions` is 128 at `src/authorization/helpers/evaluate/constants.ts:11`). There is no batch transaction or rollback in the protected factory constructor.

**Reproduction:** use one canonical authorizer with `maxAdmissions: 1` and a coherent compiler/catalogue containing two distinct valid policy-bearing session types. Protected `createSessionsFactory` installs the first admission, then throws on the second. The factory is not returned, but the caller-supplied registry retains the first admission and its revision bump; any already-issued authorizer stamp is invalidated. This is a failed construction with partial authority-registry effects, contrary to the plan's validate-before-first-admission boundary.

**Required direction:** make admission installation atomic for the full registration set, or preflight all existing/capacity/conflict conditions through a side-effect-free canonical operation before any install. Add a capacity-boundary regression proving that failed factory construction leaves the registry and pre-existing decision currentness unchanged. Avoid compensating cleanup that can remove pre-existing admissions.

## Scoped README drift

`src/websocket/README.md:84-87` documents the third AHP binding argument as enabling `agents`, `work`, and `sessionOwners`, but the reviewed `src/websocket/helpers/ahp/types.ts:69-74` adds the read-only `ownerLookup` option. The protected host uses this path at `src/websocket/helpers/host/helpers.ts:94-115,139`; documenting the option would make the public/internal composition contract discoverable. No README was changed in this review. Other inspected P05 README claims match the source, including the explicit protected boundary and the expressly retained same-owner durable-work residual.

## Acceptance boundary

The reported worker gate and scope-integrity evidence are acknowledged, not independently reproduced here. The two findings are within P05's bounded creation/composition behavior; they are not requests to implement P06 delegation, P10 recipient views, or P12 SDK/reducer certification. I found no change to `src/work/helpers/helpers.ts`, persistence, SQL, or lease/owner equality, and do not treat the already documented same-owner v1 work-write residual as a newly introduced P05 regression. P05 acceptance and any repair authorization remain lead-owned.
