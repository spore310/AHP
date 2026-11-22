# P09 accepted handoff

ACCEPTED; independent final source/docs review PASS. Base
c378c92d16b9e317a80c175b434d3e16da643ca1. Lead is sole writer and runtime-check
operator; p06_review independently reviewed plan, implementation and scoped docs.
Final 27-path source/test/README manifest P09-final-candidate.sha256 SHA256:
a53099d361c517dadc09b369b8485803331f71ef24a01a984ec0c7ca04a4d0cc.

## Implemented boundary

The internal client broker uses one neutral P08 proxy dispatcher with canonical
invoke, advertise and execute assignments. It captures contract, implementation,
approved source/revision, complete resource route, actual caller/executor security
contexts and connection generations. Selection is not a grant. Genuine issued
authorization objects remain private; separate positive alternatives preserve one
complete grant path, while mandatory constraints and unresolved challenges deny.

Advertisements preserve structural/schema admission, then enforce policy before
synchronous reduction. Final owned fences run after callback-bearing checks.
Canonical row changes invalidate active and staged ownership before fanout; activation
requires its exact accepted row sequence still current afterward. Same-ID connections
cannot clear another executor's row. Exact completion correlation and bounded output
validation precede private result delivery. Final transport guards run after setup
callbacks, so revocation there prevents both invocation and result disclosure.

Cancellation/timeout/disconnect promptly settle caller waits but retain unresolved
remote ownership and capacity. A failed boolean enqueue is not termination proof.
Bounded shutdown reports remaining work via host.toolExecutionStats(). No automatic
retry/reroute, remote code attestation, forced JS termination or remote cleanup proof.

Scope amendments in P09-plan.md include split-kernel/host integration, canonical
executor tuple identity/removal, synchronous factory veto/global allocation fencing,
private final-send/reply guards, and authenticated canonical fixture migration.
Existing malformed trusted assignment tests retain downstream denial assertions;
only the new-generation-at-cap expectation changes from conflict to limit under the
amended key. Inert untyped internal metadata still reduces but never becomes executable;
its original reducer assertions remain and a companion assertion proves zero invocation.

## Required criteria and distinguishing tests

| ID | Actual evidence |
| --- | --- |
| T01 | toolPolicyAdmission: `subscribed caller without invoke is denied before executor send`; clientDispatch: `denies receive-only callers before the remote send port`, missing assignments with valid grants, unissued/substituted registrations. |
| T02 | `invoke-only and advertise-only clients cannot activate an executor`; `a same-ID invoke-only connection cannot clear another executor's canonical row`; original wire-schema mismatch privately rejects whole advertisement. |
| T03 | Revoke/disconnect/rebind during awaited policy evaluation leave canonical snapshot unchanged; `a final proof clock cannot close the advertiser and still commit its advertisement`; exact-true and rejecting Promise veto controls; same/cross-session reentrant clock/sequence/veto controls. |
| T04 | Neutral connection/generation/registration/actor substitutions, origin incarnation/full-target route denial; original forged connection, stale ownership, duplicate claimed ID tests; two admitted executors deny; canonical empty row and nested removal during fanout prevent execution. Executor lifecycle tests preserve one grant across exact connection/generation tuples and generation-safe removal. |
| T05 | Distinct actual credential identities and generations; private argument/result canaries scanned on observer frames after causal ping; revoked caller result withheld; actual final setup-send callback revocation blocks invoke and result. Rejecting async send/reply guards disclose neither canary nor exception text. |
| T06 | Original 64-call bound and release after real results, concurrent same-socket calls/order, disconnect/URI reuse and host stop; neutral byte/schema bounds, timeout/cancel retained capacity and late real settlement; shutdown reports unresolved draining; original exact completion handling remains private and duplicates cannot settle another call. |

New suites contain 21 clientDispatch, 26 toolPolicyAdmission and 3 executorLifecycle
cases. Original eleven toolInvocation tests retain their assertions with real credential
validation, canonical sessions and assignments. These remain internal-kernel fixtures,
not X05/X06/E05 public protected execution proof. Public facade still denies tool routes.

## Validation and findings

Every runtime/check command used Invoke-DbSafeCheck.ps1 child environment from the
repository root; no live persistence, dependency installation or deployment.

- P09-executor-lifecycle-red.log reproduces executor-key collision; focused green146 tests.
- P09-review-alternatives-sequence-red.log reproduces positive-path conjunction and same-record sequence regression; fixed with separate genuine proofs and allocation fencing.
- P09-final-send-red.log reproduces actual forbidden invocation and leaked result from final setup callback revocation; final message/reply admission guards resolve both.
- P09-canonical-row-sequence-red.log reproduces stale canonical row execution, same-ID clearing and cross-session sequence regression; all three controls pass after fixes.
- P09-staged-row-red.log reproduces stale activation after nested canonical removal. P09-staged-row-final-green.log passes37 tests including original multi-tool byte-budget case.
- P09-admission-focused.log disconnect failure was a fixture barrier issue: SDK close initiation did not prove server release. The corrected test awaits actual setup release before unblocking policy; no weaker assertion.
- P09-first-validate.log records four compatibility failures; amendments preserve negative assertions and inert raw-domain metadata behavior. Subsequent full gates passed; earlier candidates/logs remain diagnostics.
- **P09-final-staging-validate.log:** lint, typecheck, 80 files / 991 tests, 182 documentation mappings and production build PASS, CHECK_EXIT:0.

Final independent verdict PASS, all27 manifest hashes verified. Prior reviews identified and rechecked the listed
authority, lifecycle and sequence issues; reviewer runtime checks were not claimed.
Next: verify hashes/staged content, commit/push scoped P09, verify remote
identity, then continue P10. Unrelated nul remains excluded. P10-P19 remain unfinished.
