# P13 execution plan and bounded contract amendment

Execute under the accepted R5 goal. Base b72122aae8ee2e49bc4164f0677146005ded5477,
local GLM/agentIdentity, P12 accepted and pushed. Lead owns all writes/runtime;
p06_review is read-only independent plan/final reviewer. Untracked p12-debug.mts
is excluded. P13-C01 through C07 and EXECUTION E4/E7 remain the acceptance target.
Status: independent plan PASS after the two-stage admission refinement. P13 implementation ACCEPTED after final C01-C07 review and full gate.

## Observed seams and ownership

Dispatcher helpers/dispatcher/helpers.ts owns one canonical input, action,
AbortController, active/draining slot and cleanup; required challenge currently
throws before prepare. Client broker helpers/client/helpers/broker/helpers.ts
rejects challenge-bearing tuples and produces a boolean admitted receipt at send.
Private calls owns bounded retained call/result records, not execution. Socket
helpers/ahp/helpers/toolProtocol returns unsupported resume and false capability.
Resource views reject discover challenge; assignment conditions are empty-only.
Public client already exposes dispatch/status/resume and typed challenge errors.

## Chosen extension

Keep one suspended dispatcher job rather than re-dispatching stored input through
a second action lifecycle. Add helpers/challenge as the bounded adapter owner;
it retains adapter work until actual settlement even after caller-facing timeout.
No generic connection-pump priority path, rerouting or replay. Wire remains v2.

Core ToolDispatchHandle gains a structured admission promise (ready,
challenge-required plus existing ChallengeContinuation, or denied) and a per-call
resume(proofRef) method. Private broker admitted changes to that same union;
its ready still means actual remote enqueue, not just policy allow. Core ready
means effects are admitted. Core result/settled ownership is unchanged. Update
all coupled fixtures/tests rather than accepting truthy objects. Call retention
stores the challenge ID with its existing record and looks up by exact owner;
no second unbounded protocol registry. Resuming transitions waiting to running
only after actual broker admission; status uses the original callId.

Challenge coordinator accepts captured ChallengeAdapter and optional trusted
presentation approval callback. Default presentation permits only bare wait.
Any message or redirect requires explicit host approval after strict bounded
schema capture; URLs with credentials or non-http(s) schemes are rejected.
Adapter IDs are private; host UUID is separately generated. Strict verification
must name the exact adapter ID. Adapter optional cancel is best effort with owned
bounded work; optional status never grants execution authority.

Finite configuration: default pending 64 host / 16 actor, metadata 4096 bytes,
proof 1024 bytes, challenge lifetime 30 seconds and verifier/begin timeout 5 seconds;
absolute caps bounded by dispatcher lifetime/work limits. Count reservations
before begin; hold capacity until actual begin/verify/cancel work settles. Late
adapter results cannot reopen state. One proof attempt consumes the continuation
before any await; duplicate/foreign/unknown/restart IDs give safe unavailable.
Canonical input remains frozen privately in the dispatcher; compute SHA-256 of
its captured JSON for binding. Snapshot full trusted context, decision obligations
and authority, including actor/delegation/auth, connection, route incarnations,
contract, exact executor/implementation; immutable broker closure pins approved
source/registration. No resume accepts new input or context. Existing exact
currentness proof cohort is required before and after verification.

After verification resolve and authorize the SAME canonical input again, require
exact original route/context/authority/obligation binding and current proofs,
then satisfy only this challenge requirement. Deny any independent permission,
human consent or delegation failure. No MFA boolean enters authority. Agent
classification is never changed. A policy/grant revision change invalidates the
old approval even if the new policy would otherwise allow. No user rebind in P13.

Use dispatcher now plus a paired pure fenceNow when a custom challenge clock is
configured (existing no-challenge custom clocks remain compatible). Final checks
sample pure deadline after callback-bearing current/presentation/authorization
checks, with no callback between the final fence and state transition. Timer and
access expiry both invalidate records. Abort, disconnect, session destruction,
registry invalidation and shutdown cancel pending challenges. Verification late
settlement retains capacity but cannot prepare/execute. Action cleanup still runs
once and cannot run before owned adapter work stops using action context.

Broker proof carries challengeRequired; discover/advertise preserve permissions
without invoking challenge. invoke/execute accumulate challenge across the three
purposes and suspend in the dispatcher. Pending status refresh authorizes the same
fixed route even before execution; it does not consume challenge. Assignment
conditions become bounded enum challenge-required (no hidden policy/provider
metadata); native discovery no longer denies solely for invoke challenge. Update
P12 transitional challenge-view tests with explicit E7 evolution, retaining
no-verifier and effectful denial coverage. Capabilities continuation reflects
configured support; strict schema accepts true/false. No IdP/browser dependency.

## Slices and distinguishing evidence

1. Coordinator and dispatcher: C01 no adapter/false proof/no prepare; C03 canonical
   input and exact binding; C04 concurrent consume; C05 expiry/revoke/late/shutdown;
   C07 count/bytes/presentation/time bounds and draining. Unit tests use controlled
   promises, causal barriers, pure fake clocks; no broad sleeps.
2. Broker/call/protocol/public-host integration: C02 same-socket dispatch returns
   challenge, status waiting, resume, exact handler and result. C03 actor/executor/
   route/revision substitutions; C05 disconnect/session/restart and revocation
   during verify. Owner-specific raw canaries, no competing handler. C06 agent
   identity unchanged plus separately denied human-approval permission.
3. E7 discover safe condition, public exports/source maps/contracts/runbook/ledger
   and P13 handoff. Retain old denial regressions where still contract-correct.

Every test/check runs via execution/Invoke-DbSafeCheck.ps1 (DB-safe child env).
Focused: vitest run src/tests/toolExecution/challenge.test.ts
src/tests/websocket/challengeContinuation.test.ts src/tests/websocket/deferred.test.ts,
plus affected dispatcher/clientProtocol/clientDispatch/policyIntegration suites.
Run full pnpm validate before acceptance, independent actual-candidate review,
resolve findings, refresh exact hashes and final validation. Commit only scoped
reviewed files, normal approved push HEAD:refs/heads/agentIdentity, verify SHA.
Continue P14-P19; this plan is not completion.

## Plan review refinements

Reviewer identified that the existing RemoteAction resolves its boolean BEFORE
send, whose promise means remote completion. Add a trusted onEnqueued callback
to ClientToolDispatchRequest.send, called only after successful exact context.send.
Broker ready is resolved by that callback after currentness/final owned checks;
failed final enqueue yields denied/cancellation while preserving draining work.
Update trusted fixtures to signal their simulated enqueue explicitly. Never await
remote completion to return the dispatch receipt.

Admission is one-shot. Core resume returns a separate ready/denied promise after
verification and fresh authorization; broker resume also awaits its separate
actual-enqueued promise. Private calls updates waiting to running only after that
resume result and final owner/status/deadline checks, not by re-resolving admission.
Add explicit failed-final-enqueue and cancel/expiry-between-verify-and-enqueue
controls. ChallengeContext extends ToolActionContext with inputDigest (SHA-256 of
the immutable normalized input); existing adapter callback parameters remain
source-compatible. Coordinator settled includes optional cancel work; dispatcher
awaits it before action cleanup. Optional adapter status is never authoritative.


## Implementation review evidence (in progress)

Core coordinator/dispatcher reviewed independently by p06_review. First-effect
expiry gap reproduced in P13-first-effect-fence-red.log (prepare present/absent),
corrected with pure challenge fence after current callbacks and a separate resumed
result at first effect. P13-first-effect-fence-green.log PASS3files76tests; reviewer
scoped recheck PASS. Challenge validity is consumed at first prepare/execute;
subsequent work retains ordinary policy and overall dispatch deadline checks.
P13-baseline-focused.log PASS4files79tests. P13-integration-focused-3.log PASS6files94tests.
P13-public-matrix.log PASS15tests: same-socket cross-client positive, strict resume
substitutions, false proof, concurrent resumes, parent revoke during verify,
independent agent consent, disconnect/executor/session/restart and fresh controls.
All runtime lead-run DB-safe. Final gate/review/acceptance outstanding.

Integrated review on manifest29 found expired initial-challenge publication and
advertise-only challenge aggregation. P13-publication-operation-red.log reproduces
three failures; pendingFence/continuationCurrent after final reply callbacks and
invoke/execute-only aggregation repair them. GREEN P13-publication-operation-green
PASS5files86tests. Added explicit policy/auth/origin substitution controls.

Final independent integrated review PASS C01-C07 on revised36manifest; full gate
P13-review-validate-2 PASS90files1156tests202mappings, packet-focused PASS44tests.
All three review findings resolved with actual RED/GREEN controls. Acceptance
records corrected; final record manifest P13-final-candidate.sha256.
