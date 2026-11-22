# P06 — ACCEPTED

Lead accepts bounded assignment/delegation, canonical revocation/freshness and the
required P04/P05 composition corrections for the exact candidate below. This does
not accept P07–P19 or certify public protected tool execution/privacy.

## Candidate and gates

- `P06-final-candidate.sha256`: 112 cumulative source/test/module-documentation
  paths; manifest SHA-256
  `30e386716230b9687e83a9dcc58d6b3560c949fe347d620ab25da54c01ab73af`.
- Based on pushed checkpoint cd659a919f90c977706aadd6846e313ae574bfb2 plus scoped
  P06 corrections/tests/docs. Historical P00–P05 manifests are preserved.
- Final DB-safe `pnpm validate`, `P06-codex-final-validate.log`: lint/typecheck
  PASS, **74 files / 854 tests PASS**, **167 sources mapped**, build PASS,
  CHECK_EXIT:0. Runtime checks executed by the lead; no live persistence.
- Independent `p06_review` final verdict PASS: no unresolved material source,
  acceptance-criterion or scoped-documentation gap. Reviewer verified the complete
  frozen 112-file review manifest and separately checked the only later source-map
  document changes (authorization/sessions READMEs). No runtime independence claim.
- Final reconciliation verified exactly those two README changes between review
  and final manifests; all source/tests unchanged after review.

## Delivered evidence

[P06-candidate-evidence.md](P06-candidate-evidence.md) maps every G01–G06/R1–R3
criterion to executed named tests, distinguishes canonical/native setup proof from
later public tool execution, and records the contract resolutions. The two P06
suites now contain 170 tests, preserving the original 684 predecessor tests.

Corrections in this continuation include finite canonical-before-admission
ordering, expiry pruning for private negative snapshots and CAS, all-scopes
full-actor quotas, queued pre-adapter identity/basis checks, and caller identity
after target/approval guards. Each behavioral repair has a retained RED followed
by passing focused/full evidence. Public exports and module mappings are complete.

Real host tests cover bootstrap/source/setup/native initialization, no-event
revocation, creating/failed/ready/settling/stopped ownership-aware readiness,
same-bare-factory reuse, reentrant owner projection and successor-safe rollback.
Real agent grants retain independent caller/executor tuples and mandatory provider
constraints. Actual junior tool permission does not bypass unchanged owner-only
WorkService checks. Independent quotas, callback draining, approval identity,
resource-tree/lineage bounds, expiry, provenance and input capture are exercised.

## Next packet and limits

Proceed directly to P07 under its accepted contracts and preflight, with its own
bounded plan/review and gate. Do not claim that relocation implements protected
dispatch or privacy. P12 owns X05/X06 client-executed public routes, P15 owns E05
server execution, and P19 reruns all three full positive/negative/disclosure
matrices on the final integrated candidate. Those rows remain NOT RUN.

Normal tested checkpoint pushes to origin/agentIdentity are explicitly approved
in chat. No force-push, reset/stash, dependency changes, live DB, deployment or
model/account changes are authorized. Preserve unrelated `nul` and local RED logs.
