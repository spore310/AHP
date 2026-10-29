# P11 integrated candidate handoff

Status: ACCEPTED for P11. Full P06-P19 goal remains ACTIVE.
Base: f3e74c73abc5bc7598165c6a0ae5e9fe68450c17 (tested foundations checkpoint).
Lead sole writer; p06_review is read-only. Full P06-P19 goal remains ACTIVE.

## Implemented boundary

One production client runtime and both import surfaces now use minimal native
initialization and strict project v2 negotiation, assigned views, exact private
advertisements, prompt dispatch receipts, status/cancel and unsupported resume.
The pinned native AHP version remains 1.0.0. No raw manifest or legacy public
call/completion fallback exists. Actual public SDK client-to-client execution and
validated result delivery are exercised, not only raw-kernel initialization.

The sole canonical broker still owns policy and dispatcher execution. Assignment
views require discover/reveal and independently admitted purposes. Advertisements
stage against recipient/view/resource/connection identity and commit after exact
reply enqueue. Invokes, completions and cooperative executor cancellation bind
full route, contract, source/implementation/registration, executor generation and
advertisement ID. Cancellation excludes input and cannot free unresolved work.
Retained reads freshly authorize the original caller/route/executor and apply a
final pure deadline fence after callback-bearing authority checks.

Bounds cover negotiation, staged/retained views, refresh work, call retention,
requests, unresolved sends, joins including queued same-channel work, whole polling
calls, active/staged channel union, early invocations, local handlers and replay
tombstones. Timeout never proves underlying work/send settlement. Prior handlers
survive failed acknowledgements. Native protected views and work owner/lease
semantics remain unchanged. Source binding is not remote code attestation.

## Criterion evidence

| ID | Distinguishing evidence |
| --- | --- |
| W01 | toolProtocolV2 W01: absent negotiation, unknown version, old alias, extra authority selector, inventory canary; clientProtocol strict selector/capture tests; connection initialization failure socket cleanup. |
| W02 | toolProtocolV2 W02: exact private ack/tuple and observer raw canaries; clientBoundary rejected/mismatched/stale channel/resource/generation/view/descriptor/source/extra-field ack, staged early calls, empty registration, failure retention; toolProtocolCapacity replacement and failed enqueue at capacity. |
| W03 | toolProtocolV2 W02/W03/W04: prompt receipt with pending manual executor, ping/status, foreign completion ignored, exact completion; W03 cancellation correlates only selected executor and stays draining; public SDK cancelled case observes actual local AbortSignal and delayed settlement. |
| W04 | clientProtocol owner/TTL/count/bytes/draining tests; public foreign status/cancel absence; final-send TTL canary regression; public SDK binding revocation retires the protected native view and suppresses late-result wire canary. |
| W05 | clientBoundary import identity/sentinels, exact text/binary/parsed v2 execution, typed pending/challenge, bounded polling and lost dispatch without retry; toolProtocolV2 real public SDK completed result. |
| W06 | clientBoundary owned/borrowed initialization, cleanup failure, detach receiver capture, shutdown/EOF/send/read failure, late-result suppression and carrier successor; actual public pinned SDK transports authenticate via fixture credentials rather than clientId. |

P09 native-broker suites retain their assertions through a frozen test-only legacy
client fixture. They do not test the current production runtime or establish
public v2 authorization. The old depth-80 private payload parity case is now
bounded depth-48 success plus depth-80 denial across all three frame forms, as
required by the accepted strict depth-64 DTO contract; ordinary forwarding remains.

## Candidate, checks and review trail

P11-integration-candidate.sha256 contains 53 source/test/documentation paths,
including coupled foundations. Manifest SHA256:
d9fe30d41a89855528323e439c11762e1a30027b6eb15f1fbfcaec53e3f7c7cc.
P11-reviewed-integration-validate-2.log: full DB-safe pnpm validate PASS,
87 files / 1074 tests / 199 mapped source files; lint/typecheck/build CHECK_EXIT0.
All checks use Invoke-DbSafeCheck.ps1; no live persistence or dependency changes.

Independent diagnostic findings were fixed with preserved regressions:
- Negotiation pending reservation, net-new view reservation and final TTL reader:
  P11-wire-capacity-first.log and P11-wire-final-expiry.log.
- Cancel reply identity race and exact executor signal: wire-cancel-red/green.
- Client staged-channel and queued-join bounds: client-capacity-red/green.
- Whole polling lifetime bound: client-poll-capacity-red/green.
- Unsettled send ownership after timeout and restored capacity after settlement:
  client-send-capacity-red/green.
- Public SDK completed/cancelled/revoked paths: public-sdk-lifecycle-2.log PASS7;
  initial lifecycle.log preserves the incorrect expectation that binding revocation
  would keep the native resource view open. The actual P10 closure is now asserted.
Earlier foundation manifests, failed logs, layout/type errors and the first full
integration gate remain available; they do not replace this candidate's evidence.

Independent p06_review final PASS verified all 53 integration hashes, reviewed
W01-W06 and scoped documentation, with no material blocker. Runtime checks are
lead-run. Subsequent edits only remove acceptance-pending headings from the two
module READMEs; no source/test behavior changed. Final manifest is
P11-final-candidate.sha256 (53 paths), SHA256
c37717c72a5884a55ca987c77687031a47e0001268188459b82b6107d6d315c0.
P11-final-packet-focused.log passes the exact packet command (3 files/20 tests).
P11-final-validate.log records the final acceptance gate. P12 owns full X05/X06 matrices; P15
owns public server execution/E05; P19 reruns all three routes and negative matrices
on the final integrated candidate. No whole-goal completion claim is made here.
