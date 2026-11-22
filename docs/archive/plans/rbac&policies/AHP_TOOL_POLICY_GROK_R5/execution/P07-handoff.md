# P07 accepted handoff

Status: ACCEPTED. Full DB-safe gate and independent final candidate review PASS.
Base `bd46480bed27477b6262b0e8b63179aec74c05fa`; 13-file candidate in
P07-final-candidate.sha256. Lead sole writer; p06_review independent read-only
plan reviewer, final reviewer. Goal authorizes sequential execution and pushes.

## Implementation and amendment

One implementation moved under toolExecution/helpers/client, three old files are
export-only shims. Exact aliases and source maps added. Existing suites unchanged.
Additive ToolClientConnection descriptor: owned SDK endpoint or borrowed exclusive
logical endpoint with mandatory detach. URL mode still uses pinned SDK socket,
now lazy. Framing and shutdown contracts/limits are recorded in P07-plan.md and
the two module READMEs. No protected-host authorization or P08 pipeline is claimed.

Independent plan review PASS after correcting proposed framing validation that
would have rejected previously legal JSON. Preserve text semantics; binary-only
2 MiB predecode budget; parsed objects retain trusted adapter semantics. All
ordinary frames retain identity. No new dependencies or validator changes.

## Criterion mapping

All new controls are in src/tests/toolExecution/clientBoundary.test.ts (32 cases).

| ID | Named distinguishing evidence |
| --- | --- |
| M01 | `uses one runtime through legacy and new imports without evaluating platform or server modules`; exact function/class identity and throwing module sentinels. Source rg finds one connectToolClient and one ToolInvocationTransport. All old tests retain their imports/assertions. |
| M02 | `keeps the prior handler after %s and removes it on an accepted empty advertisement`; `ignores wrong origin, sequence, channel and action until the exact advertisement acknowledgement`; `never activates a rejected staged candidate or lets it execute queued invocations`; `serializes same-channel joins after failure while another channel progresses`; timeout, stream-close, shutdown/queued-join and 64-entry staged queue controls. Exact acknowledgement code moved unchanged. |
| M03 | `runs real SDK initialize, exact ack and local execution on %s frames`; owned/borrowed init failure, detach/captured callback/lease routing, pending read, EOF/read/send failure, late completion controls; cross-frame deep/reserved-key/>1MiB JSON parity; ordinary frame identity and binary 2MiB/invalid UTF-8 boundaries. Initialize messages are asserted exactly with no invented credentials. Existing actual URL/socket initialization-failure regression also passes. |

Borrowed fixture proves the specified logical adapter contract using a shared
fixture carrier router; it does not certify arbitrary third-party detach callbacks.
No-op detach is expressly unsupported in README. Internal broker compatibility
tests are not public protected execution evidence. Later X05/X06/E05 remain not run.

## Reproducible lead-run checks

All checks used Invoke-DbSafeCheck.ps1 in a clean child environment per handoff.
No live database/persistence or dependency changes. Failure logs preserved locally.

- P07-boundary-red.log: 2 genuine regression failures (double owned close; lost binary response).
- P07-boundary-green.log: moved/fixed initial 4 suites, 6 tests PASS.
- P07-parity-tests.log: 5 suites including unchanged internal broker, 45 tests PASS.
- P07-parity-typecheck.log: PASS.
- P07-scoped-lint.log / P07-scoped-lint-fixed.log: intermediate style diagnostics, repaired without rule changes.
- P07-validate.log: full lint/typecheck/tests/docs/build PASS, 75 files / 884 tests / 173 mapped sources, CHECK_EXIT:0.

Final P07-accepted-validate.log supersedes earlier gates: 75 files / 886 tests / 173 mappings, all stages PASS, CHECK_EXIT:0. Independent p06_review final source/documentation review PASS. Its two material findings were reproduced in P07-async-release-red.log and P07-release-receiver-red.log, then fixed with passing regression suites. The late lint logs were test typing/formatting fixes, not waived gates.

Final13-file manifest SHA-256: 6e1622b9d6d6d35d69ae4848e0208d7da8293d9a042f772f934a6e3243961ce2. Review verified the production candidate and final test hash d4044daa965054b1b3cc1910cc1e036f14053b31e16d1fd93dfbcd0c2eff8b69. Final manifest refreshed accordingly. All old tests preserved.

No P08 source edits. Untracked unrelated nul preserved and excluded. Next: commit/push and verify P07, then P08.
