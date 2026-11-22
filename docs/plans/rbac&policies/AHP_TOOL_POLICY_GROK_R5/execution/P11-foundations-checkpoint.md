# P11 foundations checkpoint

Status: implementation checkpoint; P11 is NOT accepted. Base `941fe85` (accepted
P10). Public v2 methods and migrated client runtime remain to implement.

## Implemented scope

- Strict bounded v2 DTOs and browser-safe parser; no authority-bearing selectors.
  Shared value capture moved unchanged out of action registration, with existing
  imports preserved. Root action types use narrow runtime validation imports.
- Private call retention: exact connection lease, admission/result separation,
  immutable status/currentness proofs, TTL/count/output/aggregate-byte caps,
  cancellation and cleanup without releasing the dispatcher's unsettled capacity.
- Canonical actor-aware assignment cohort freshness: one clock, issued provenance,
  exact tuples, 512-authorizations/1024-stamp limits. Proxy and advertisement gates
  use it with trailing owned fences. Session types retain the existing 64-tool cap.
- Proxy admission signal and isolated fresh result authorization over captured input,
  original full route and selected executor. No redispatch or proof replacement.

## Review and evidence

Independent `p06_review` plan PASS after requiring aggregate freshness. Initial
checkpoint review requested exact provenance capture and logical TTL publication
checks; both have distinguishing regressions. The capacity finding was refined
against the real catalogue: 64 tools succeed; 65/128 session types are already
unsupported; oversized 129-tool advertisements preserve prior routing/handlers.
The larger bounded proof cohort supports multiple purposes without changing that
canonical tool cap. A follow-up invalid Proxy length finding is rejected with a
safe-integer check and explicit regressions. Reviewer is read-only; runtime is lead-run.

Current candidate: `P11-foundations-final-candidate.sha256`, 25 source/test/doc paths,
SHA256 `8d6dc45f312ca50cc13a000ffccf81953b85bb49f150e23b00c8951173d276f2`.
`P11-foundations-reviewed-validate-2.log` passes the DB-safe full gate: 85 files,
1047 tests, 196 source mappings, lint/typecheck/build, CHECK_EXIT0. Independent
`p06_review` final checkpoint PASS verified all 25 hashes and the repaired findings;
no remaining material source/scoped-documentation findings. No reviewer runtime
was claimed. This is checkpoint evidence, not P11 packet acceptance.

Preserved local evidence includes `P11-store-red.log`, `P11-store-typecheck.log`,
`P11-store-green.log` (browser sentinel found the old root-barrel dependency),
`P11-cohort-red.log`, `P11-proxy-route*.log`,
`P11-foundations-review-red.log`, and layout/type-narrowing failures.
The alternate-route regression needed distinct installed bindings and a trusted
canonical route update: inspection of `evaluateSnapshot` established that merely
adding an alternate tuple cannot replace a resource's registered route.
No production authority checks were loosened to fix a fixture.

## Remaining P11 work

Extend the sole broker with private assignments/advertisements and exact v2
correlation; integrate negotiation, dispatch receipt, fresh status/cancel and safe
unsupported resume into the public facade. Bound asynchronous projection/status
work while retaining unresolved capacity. Activate routing only after successful
acknowledgement enqueue with exact staged ownership and pure fences.

Migrate the one client runtime and both import surfaces to minimal native init,
private assignment/advertisement, exact local-handler correlation, bounded polling
and no ambiguous retry. Preserve owned/borrowed shutdown and all existing denial
assertion intent. Complete W01-W06/public positive proof, docs, full DB-safe gate,
independent final review, packet acceptance and normal push before P12.

This checkpoint is not a public protocol or multi-user privacy release. P12 X05/X06,
P15 E05 and final P19 integrated matrices remain required by the active goal.
