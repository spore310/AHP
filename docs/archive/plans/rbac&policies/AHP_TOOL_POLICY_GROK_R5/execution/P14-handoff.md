# P14 accepted handoff

Status: ACCEPTED R01-R05. Base84bc468f14669ec56aeee42d0278c0669e979b8b,
local GLM/agentIdentity. Lead sole writer/runtime; p06_review independent read-only
review. Normal tested checkpoint push is authorized. Preserve p12-debug.mts and
failed evidence. P15-P19 and the final integrated public-route proof remain open.

## Scope and boundaries

The canonical registry now exposes frozen resource facts without installation
capabilities, accepts bounded explicit alternative full routes, and validates
assignment plus independent operation proofs at one final clock sample. Existing
ownership, grants, immutable admission and exact installation cleanup remain the
canonical authority. Application read/write/input/terminate/mutate operations map
to explicit existing policy purposes and finite policy-ref ceilings. Every route
resource needs its own registered kind/type/provider, supported operation, complete
positive grant and all mandatory restrictions. No new policy compiler or wire API.

Resource preparation pins the canonical epoch before resolution. Its handle splits
ticket response from actual settlement. Timed-out or cancelled work cannot commit
but retains capacity until underlying adapters settle. Issued tickets are private,
single-use, and bind captured actor/route/action/proofs. The owning service performs
validated synchronous mutation; its admission closure closes on return or throw.

Optional result projection runs once after validated execution and successful
cleanup. It maps to one registered owning-service action, checks original invocation
and resource authority jointly, then pure deadline/instance fences. The client
broker retains its original three private proofs. Dispatcher jobs and output bytes
stay owned through actual resource settlement. Projection failure exposes a safe
code/phase without output, retry or rollback claims. The real SessionsFactory title
action exercises its existing schema/reducer/sequence; other resource adapters are
fakes. No process/filesystem/chat runtime, dependency, persistence or work change.

## Criteria and distinguishing tests

| ID | Actual evidence |
| --- | --- |
| R01 | resourceScopes: terminal read cannot authorize input/terminate; workspace read cannot write; chat read cannot mutate. Each has a distinct-grant successful control. |
| R02 | Shared workspace has two explicit full routes: permissive second origin succeeds, restricted first origin, omitted chat and forged relation deny. Route updates invalidate tickets. Oversized alternatives reject before cloning. |
| R03 | Missing evaluator, provider denial, missing external proof, stale instance, unknown type, unsupported operation and missing registrations deny. Operation challenge cannot borrow invocation approval; fresh no-challenge control succeeds. |
| R04 | resultProjection: action-shaped executor output alone leaves state unchanged. Configured trusted mapping invokes real session title reducer once after cleanup, with one sequence/envelope. Missing guard, unknown operation, wrong target, invalid action data/output and cleanup failure produce zero mutations and no retry. |
| R05 | Foreign/copied/replayed tickets deny; retained admission after return/throw closes. Revocation/replacement/cancel/shutdown during parked projection yields zero commit and fresh controls. Actual owner boundary rejects expired invocation, expired operation and dispatcher deadline independently. Resource timeout retains dispatcher bytes/job through late settlement. Same-full-ref reinstall during resolution denies with fresh control. Malformed/changing cohort lengths and repeated stamp reads are rejected/captured correctly. |

Existing exact-installation cleanup remains covered by delegation.test.ts's
replacement installation tests, including old resource-token teardown returning
false. The full suite retains all earlier public self/cross execution, challenge,
privacy, lifecycle and work-owner tests. P15 owns server execution; P19 must rerun
all three public routes and negative matrices on the final integrated candidate.

## Candidate and reproducible evidence

- P14-review-candidate.sha256: initial20paths. Full gate P14-first-validate.log
  passed92files1187tests205mappings; this candidate was NOT accepted.
- P14-review-regressions-red.log:8actual failures reproduced four review findings
  plus the lead's same-full-ref replacement race. No assertions were weakened.
- P14-review-regressions-green.log:2files42tests passed after those repairs.
- P14-review-candidate-2.sha256: revised20paths; independent reviewer verified all
  hashes and returned PASS R01-R05. Source/docs agree on final authority and ownership.
- P14-reviewed-validate.log: all stages PASS,92files1199tests205mappings,CHECK_EXIT0.
  Includes43newtests: resourceScopes26 and resultProjection17.
- P14-final-candidate.sha256 identifies the final acceptance-record candidate.
  P14-final-validate.log and P14-packet-focused.log record its final full/focused gates.

Every check uses execution/Invoke-DbSafeCheck.ps1 with sanitized child environment.
No live persistence or dependency installation. Failed logs remain local; logs are
ignored rather than staged. Reviewer inspected source/docs but ran no tests; runtime
evidence was produced by the lead. Final acceptance-record review and final gate
must pass before the scoped commit/push. Continue directly to P15 afterward.
