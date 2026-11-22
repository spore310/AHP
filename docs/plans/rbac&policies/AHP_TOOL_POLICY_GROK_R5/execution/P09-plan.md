# P09 execution amendment and plan

Execute, elevated risk. Base c378c92d16b9e317a80c175b434d3e16da643ca1;
P06-P08 accepted and pushed. Lead is sole writer; p06_review is read-only.
P09 is not accepted. Public tool routes remain unavailable until P10-P12.

## Evidence and amended ownership

The public ahp/helpers.ts facade now wraps a private kernel; actual tool routing
is in ahp/helpers/kernel/helpers.ts. The old toolInvocation.ts broker has schema,
connection, capacity and correlation checks but no policy integration. Its timeout
deletes pending ownership even though remote JavaScript may remain running.

In addition to packet paths, amend ownership to the private kernel, ahp/types.ts,
host/{types,helpers}.ts, sessions/{types.ts,helpers/factory/helpers.ts}, the existing
toolInvocation.test.ts fixture, bounded shared test support, and owning README maps.
The factory addition is a trusted synchronous veto before reduction, never a grant:
it preserves canonical rejection sequence/envelope ownership and structural checks.
Read the clock before the final veto so a reentrant clock cannot invalidate it.
The veto requires exact true; exceptions, false and Promise values deny. After
calling it, recheck the owned session record identity and live/disposal state with
no further user callback before applySessionAction. Test clock/veto reentrancy,
URI reuse, whole-ad rejection and unchanged canonical reducer state.
The host seam requires the same canonical registry/compiler as protected creation.
Canonical executor assignments currently collide for two connections using one
grant because their key omits the executor fence. Amend authorization/evaluate
{types,helpers}.ts and its scoped tests: include complete executor identity in the
executor assignment key, add exact-expected-tuple removal with invalidation, and
prove old-generation removal cannot affect a replacement. No grant reissuance or
broker shadow authority. Registration revision identifies immutable implementation,
approved source id/revision and route facts; this is not remote code attestation.
No unchecked compatibility broker, public privacy opening, new contracts/compiler,
client callback execution on the host, or server-function adapter is permitted.

## One policy and lifecycle path

1. Capture bounded host registrations separately from serializable contracts:
   exact contract, client execution binding and registration revision. Host route
   resolution supplies canonical full origin/targets, session type/provider, and
   optional external/mandatory selectors. Selection is not authority.
2. Neutral policy helper calls the real policy factory selection, reads canonical
   bindings, and calls projectAssignments for exact tuples. Retain issued objects
   and full LocalDecisionStamps privately; validateAssignments gates effects and
   delivery. No callback can return an authorizing boolean in place of the engine.
3. Advertisement checks exact canonical descriptors atomically, then independently
   authorizes advertise and execute/receive for each tool. Bind its ticket to the
   security context, connection generation, resource incarnation and registration.
   Recheck after awaits, inside the synchronous reducer veto, and before activation.
4. Invocation selects exactly one currently admitted executor. Construct a fresh
   host proxy ToolAction and use P08 dispatcher. Caller invoke and executor execute
   use separate canonical assignments. Capture and recheck the complete route.
   Send only private bounded arguments and correlation fields; never identity/grants.
5. Completion pins actual connection/generation, exact contract, implementation,
   instance, call and pending state. Validate output through P08. Reject caller wait
   promptly on cancellation/disconnect/timeout but retain bounded draining ownership
   until the selected remote completion proves protocol settlement. A disconnected
   executor may remain unresolved; report it on bounded shutdown. No retry/reroute.
6. Migrate old internal-kernel fixtures to explicit trusted identity and narrow
   canonical assignments; create/recreate through authorization.createSession.
   Preserve all existing assertions. These fixtures are not X05/X06 public proof.

## Evidence required

T01 guessed/no-invoke denies before send; T02 independent ad/execute grants and whole
descriptor rejection; T03 revoke/disconnect/rebind during await denies commit; T04
exact correlation and ambiguous candidates deny; T05 private argument/result canary
frames; T06 payload bounds, finite capacity, timeout/draining, disconnect, duplicates.
Add neutral clientDispatch and websocket toolPolicyAdmission suites and retain old
toolInvocation assertions. Run every check with Invoke-DbSafeCheck.ps1; focused tests,
typecheck, docs mapping, full pnpm validate, immutable candidate hashes and independent
source/docs review are required before acceptance. Preserve failed logs. Update
continuation/ledger/handoff, stage only P09, commit and normally push verified HEAD.

Independent p06_review plan gate PASS on SHA256
5003fc93e23f2c07a35f216e4effb54019bc1a6c9a1b4545f70edc671431f3c0.
No runtime checks at that gate; implementation and final acceptance remain pending.

## Diagnostic-review amendment during implementation

Private invoke/result admission also owns websocket/types.ts and helpers/connection.ts:
serialize before setup callbacks, then run the per-message/per-invocation policy veto
and final callback-free socket/owned connection fences before enqueue. A protected
broker requires the actual invocation reply-guard seam. Denied result admission sends
only a safe error. This does not open shared projections or substitute P10-P12.
Tests arm revocation in the final setup callback and clock-driven connection changes.
Failed boolean enqueue does not prove remote termination; retain pending ownership.

Project positive alternatives separately; retain one genuine allowed authorization
object, never a filtered/forged proof. Missing/denied sibling alternatives cannot
AND away an otherwise valid grant path. Mandatory rules remain canonical checks.

The reducer veto additionally checks the same record's sequence against its captured
pre-callback value, preventing a nested admitted action from being overwritten with
an older reserved sequence. Reject stale outer actions with a new rejection sequence.
Test nested same-record dispatch and preserved monotonic accepted publication.

Full-gate compatibility amendment (independent reviewer agreed): keep trusted malformed
assignment installation and its existing downstream denial tests. In
tests/toolPolicy/assignmentCompletionReview.test.ts change only the new-generation-at-cap
expectation from conflict to limit: the amended key makes it a distinct bounded entry.
Keep same-registration conflicts/proof freshness assertions. In tests/websocket/ahp.test.ts
retain the internal untyped metadata reducer assertions and add proof that this metadata
cannot execute. With neither factory authorization nor a manifest, raw kernel metadata
may reduce but is never installed as broker executable authority. All no-config calls
remain denied, and the supported facade remains closed. No unchecked broker is retained.

Final diagnostic refinements: canonical accepted tool-row envelopes invalidate broker
ownership synchronously before fanout, and other connections cannot replace an admitted
same-clientId row even with empty metadata. The reducer fence tracks every factory-owned
sequence allocation, so cross-session reentrant publications also reject stale outer
actions. Malformed async currentness/admission verdicts deny and consume rejection;
they cannot generate unhandled secret-bearing Promise failures. Regression evidence
is retained in P09-canonical-row-sequence-red.log and subsequent focused/full gates.
Pending advertisement tickets observe every same-client canonical envelope and bind
activation to the returned accepted sequence plus exact descriptor list after fanout.
A nested removal/replacement therefore invalidates an unactivated ticket too; tickets
share the finite admission budget and release in the kernel's finally block.
P09-staged-row-red.log reproduces the original race. Per-field/per-tool equality
preserves the existing valid multi-tool manifest budget regression.
