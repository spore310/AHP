# P13 accepted handoff

Status: ACCEPTED C01-C07. Base b72122a, local GLM/agentIdentity.
Scoped checkpoint commit/push follows the final acceptance-record gate. Lead sole writer/runtime; p06_review independent
read-only review. Preserved unrelated p12-debug.mts and all failed logs.

## Scope and contract

One suspended dispatcher action owns canonical frozen input, challenge adapter
work, exact context and cleanup. Host UUIDs map privately to adapter IDs. Verify
consumes one attempt before awaiting. Fresh exact authorization plus a pure deadline
fence precedes first preparation/execution. Resumption never changes input or
agent/delegation identity. Noncooperative adapters retain slots through actual
settlement, including cancellation. No IdP, browser, dependency or persistence work.

Private dispatch and resume return at successful enqueue, not remote completion.
The original receipt is one-shot; resume has its own result. Existing retained call
records own bounded continuation lookup by exact connection lease. Discovery now
shows only the safe challenge-required condition under genuine reveal authority;
no verifier still denies effects. See P13-plan and EXECUTION amendment for the
specific P01/P08/P09/P10/P11 API/fixture impact; target requirements are preserved.

## Criteria to actual regressions

| ID | Evidence |
| --- | --- |
| C01 | challenge.test: required challenge rejects missing/false/wrong-id verifier, zero prepare/execute. challengeContinuation: false proof terminal; strict mfaPassed/authority/input fields reject before verifier. P12 self/cross no-verifier effect denial retained with safe discovery conditions. |
| C02 | challengeContinuation: public same-socket dispatch/status/resume executes original cross-client call with validated result; waiting status and zero pre-verification handler calls. Core frozen-input mutation and one cleanup. |
| C03 | challenge.test: changed actor/target/authority/executor/permission denied after verification. challengeContinuation: input/mfaPassed/actor/resource/executor/policyRevision wire substitutions; foreign connection cannot resume. Fresh reconnect/executor/session/restart controls pin original identity and incarnation. |
| C04 | Core consume-before-await concurrent resume; public two-resume one accepted/one denied, one verifier and one handler. Existing exact completion/correlation and replay tests run in full gate. |
| C05 | Core cancel while verifier pending retains draining slot and defers cleanup; access expiry/rollback/dispose; final callback deadline regression with/without prepare. Public parent grant revoke during verify, disconnect, executor replacement, session dispose/recreate, restart; late work reaches no handler and fresh controls succeed. |
| C06 | Public verified identity step-up preserves actual agent/delegation and cannot satisfy separate human-consent permission; independent consent restoration plus new challenge succeeds. |
| C07 | Strict metadata/secret fields/size, unapproved message/redirect and credential-bearing URL reject; explicit approval control; callback expiry blocks presentation. Per actor/global bounds, multibyte proof cap, hanging begin/verify and late cancel retain capacity. Broker verified continuation with failed final enqueue never reports admission and retains draining execution slot. |

## Executed evidence

All commands use Invoke-DbSafeCheck.ps1 with its scrubbed child environment.
- P13-baseline-focused.log: PASS4files79tests before implementation.
- P13-challenge-red.log: required nonblocking receipt absent, genuine RED.
- P13-first-effect-fence-red.log: both final callback expiry variants fail without
  fence; P13-first-effect-fence-green.log PASS3files76tests with correction.
- P13-public-matrix.log: PASS15 public-host tests.
- P13-integration-focused-3.log: PASS6files94tests before final added bound tests.
- P13-validate.log: PASS lint, typecheck,90files1150tests,202 source mappings,
  production build; CHECK_EXIT0 on P13-review-candidate.sha25629paths,
  manifest SHA6478e1c64349512ac9101efa8102fa653912ec58b0f26b37e5bdf3b9735823c4.

Independent plan PASS after explicit enqueue and separate resume receipt refinements.
Core source review found one first-effect expiry gap; reproduced, corrected and
scoped recheck PASS. Integrated source/docs review PASS on revised36manifest, and exact packet-focused
check PASS44tests. Final acceptance-record gate and scoped commit/push verification
follow; source behavior is unchanged from the reviewed candidate. Continue P14-P19 after acceptance.

Integrated reviewer verified29/29 hashes and found two gaps: initial receipt expiry
and advertise-only aggregation. Both have RED3 and GREEN5files86 regressions in
P13-publication-operation-{red,green}.log. Repairs add pending publication fence
and operation-specific challenge aggregation; actual policy/auth/origin substitution
controls added. Updated full gate and independent re-review PASS; prior1150 gate is historical.


## Final acceptance

P13-review-validate-2.log PASS lint/typecheck90files1156tests202mappings/build,
CHECK_EXIT0. P13-packet-focused.log PASS3files44tests CHECK_EXIT0. Added45tests
relative to P12:26 core challenge,17 public/protocol continuation,2 broker controls.
Independent p06_review final PASS C01-C07 verified36/36 hashes in
P13-revised-candidate.sha256 SHA4d8bba073358c37527cc59b322286cfdf6e6e62221d85e92db05f915b06cb629.
No material findings remain; minor SCENARIOS P12 pending label corrected.
Work/persistence/package/lock/env diff is empty. All runtime lead-run; reviewer
read-only. Acceptance-record candidate is P13-final-candidate.sha256. Retain the
historical29/revised36 manifests and failed logs as actual candidate evidence.
Full goal remains ACTIVE. P14-P19, E05 server route and final three-route matrix
still outstanding. No real MFA provider or production integration is claimed.
