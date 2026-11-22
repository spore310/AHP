# P08 accepted handoff

ACCEPTED. Base e3dafe4b215d42a5c8223316b209389ae3f52747. Lead implemented; independent
p06_review plan and final source/docs review PASS. Runtime checks were lead-run.
Final eleven-file manifest P08-final-candidate.sha256 SHA-256:
eac8e7740b20ce3d42f6457fc7df49b177ec92380bff6f1b92f3d842819f18bd.

## Delivered scope and contracts

Added action registration and local dispatcher under toolExecution with owning
exports/README; existing ToolAction class remains the single contract. Shared
fixture explicitly added to the packet write set in P08-plan.md. No client,
host, authorization or package source changed; existing tests preserved.

Additive registration captures exact contract, implementation and factory;
dispatcher accepts trusted per-call context/coarse/full-authority/currentness
ports. P09 must retain complete LocalDecisionStamp evidence per invocation and
derive these ports from canonical state. No client-supplied proof/allow fallback.
Provisional initial authority cannot authorize preparation. Full authorization
recaptures the stamp and exact identity/route before effects. Challenges deny.

Bounded immutable input/output/context, existing schemas, fresh action instances,
normalization rechecks, action-first LIFO cleanup, safe diagnostics, callback/handle
prepared state, draining capacity/output ownership and bounded shutdown are
implemented. Result may settle early on abort; settled tracks actual cleanup.
No wire integration, continuation store, replay cache, remote attestation or
server executor is claimed. Those remain their later packets.

## Evidence mapping

55 P08 cases in pipeline.test.ts and cleanup.test.ts; shared fixtures.ts supplies
explicit fake trusted ports for local lifecycle tests, not public authority proof.

| ID | Named distinguishing controls |
| --- | --- |
| L01 | `rejects schema-invalid input before creating an action or running custom hooks`; byte/getter/non-JSON controls; actual input depth/key boundary pairs; invalid finite budget/clock cases. |
| L02 | `coarse denial reaches no action factory and supplementary authentication cannot grant access`; `requires exact true from the coarse access adapter`; missing-hook success still crosses both policy gates; challenge-required denies before prepare. |
| L03 | `resolves and authorizes normalized targets instead of reusing the original resource decision`; frozen original/normalized input and updated authority stamp; schema-invalid and malformed normalization; mismatched implementation/actor/executor/route denial; pinned caller/executor/origin; freshness after each hook and before delivery. |
| L04 | Optional prepare absent; `supports a callback prepared value without serializing it and closes cleanup registration after prepare`; handle preparation in cleanup matrix; late prepared result reaches cleanup after timeout. |
| L05 | `attempts action-first LIFO cleanup once after %s failure and sanitizes diagnostics` for prepare/execute/output/cleanup failures; exact callback order, both cleanup failures counted, primary error preserved, no duplicate cleanup after cancel/shutdown. |
| L06 | `retains noncooperative execution ownership and capacity after %s`; late prepare acquisition after timeout; bounded shutdown report with later cleanup; aborted authentication late rejection; aggregate output held through parked cleanup; same/different-ID clock reentrant admission; no early resource release. |
| L07 | `isolates concurrent actors' action instances and local prepared resources`; concurrent singleton rejection without touching first action; sequential different-actor singleton rejection via WeakSet. |
| L08 | Secret-bearing primary/cleanup/late rejection errors omitted from outcomes; post-effect cleanup/output failure explicitly unsafe to retry; canceled uncertainty preserved; no automatic reexecution; missing output schemas still accept bounded JSON. |

## Checks and review resolution

Every command used Invoke-DbSafeCheck.ps1 child environment. No live persistence
or dependency install. Local failure logs preserved.

- P08-initial-red.log: absent new module, not a behavioral regression claim.
- P08-coarse-red.log: actual truthy-adapter bypass after lint simplification; fixed by unknown-typed exact-true guard. Full gate retains this regression.
- P08-reentrant-admission-red.log: actual max1 over-admission via clock callback. Lead and independent reviewer identified the same defect. Fixed by early callId capture and callback-free recheck immediately before slot installation. Same-ID overwrite and different-ID capacity controls pass in P08-reentrant-admission-green.log.
- P08-controls-tests.log: four focused suites57 tests PASS at earlier candidate.
- P08-boundary-controls.log: final55 P08 tests PASS before layout-only normalization.
- P08-final-layout.log: scoped lint PASS without behavioral autofixes.
- P08-final-validate.log: lint/typecheck/tests/docs/build PASS; 77 files / 941 tests / 179 mapped production sources; CHECK_EXIT:0.

Independent final review verified all eleven manifest hashes, new boundary controls,
gate log and scoped documentation. No unresolved material finding. Old candidate
manifest and failed type/lint/test logs remain as historical diagnostics.

Next: commit/push scoped P08 candidate, verify remote, continue P09. Unrelated
untracked nul remains excluded. X05/X06/E05 public route matrices remain NOT RUN.
