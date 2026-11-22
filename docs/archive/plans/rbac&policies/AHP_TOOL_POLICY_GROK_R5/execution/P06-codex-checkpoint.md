# P06 continuation checkpoint — incomplete

Candidate: 112 source/test/module-documentation paths in
`P06-codex-checkpoint.sha256`, based on agentIdentity@22fa795. Integrity comparison
against P05: 13 superseded entries, 6 added files, no unaccounted source paths.
Historical manifests and failure logs are preserved. This is a cumulative R5
checkpoint, not reconstructed P00–P05 commits or P06 acceptance.

## Implemented and checked in this continuation

- Retained runtime reentrancy/currentness checks while repairing all 76 baseline
  lint errors; moved grant runtime schemas to types.ts and added public exports.
- Added grant source mappings and corrected scoped authorization/session/websocket
  documentation for ownership tokens, canonical snapshots and real composition.
- Private snapshot/CAS checks now prune expiry using the already sampled clock.
  Two regressions first failed: stale empty snapshot returned true; stale prepared
  commit succeeded. Both pass with expiry canonicalized before comparison.
- Real public-host fixture constructs catalogue/bootstrap/backend, fail-closed
  deferred ports, hosted grant service and bind-once source. It proves unbound and
  mismatched composition denial, actual bootstrap reads, setup currentness and
  revocation during/after reads with fixed external freshness.
- P04 deadline sample precedes the final canonical source predicate. The original
  trailing-clock regression failed with a current result after synchronous revoke.
  Final clock NaN/infinity/throw/abort/revoke and post-predicate release/abort deny.
- Independent review found a nonfinite intermediate TTL regression in the first
  repair. Its RED returned a snapshot with validUntil NaN. The final predicate now
  rejects a nonfinite deadline too; the regression passes.
- Real native initialize succeeds with authenticated scoped authority; canonical
  revocation causes close before the next RPC response without event/freshness use.

## Reproducible checks

From repository root, invoke the child PowerShell runner with execution-policy
bypass. It removes every environment name in the handoff's DB-safe list without
printing values, then runs the given pnpm arguments. Example:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "& './docs/plans/rbac&policies/AHP_TOOL_POLICY_GROK_R5/execution/Invoke-DbSafeCheck.ps1' -LogPath 'checkpoint-validate.log' -CommandArgs @('validate')"
```

Lead-run `P06-codex-checkpoint-final-validate.log`: lint PASS, typecheck PASS,
Vitest **74 files / 743 tests PASS**, documentation **167 sources mapped**, build
PASS, `CHECK_EXIT:0`. No live persistence or dependency changes. Earlier 742-test
validation is superseded by the intermediate-TTL correction.

Local retained RED logs: `P06-codex-expiry-red.log`, `P06-codex-clock-red.log`,
`P06-codex-deadline-red.log`. Earlier host-fixture import/authenticator setup
failures remain in `P06-codex-host-red*.log`; those are fixture errors, not semantic
security counterexamples. Focused runs are also retained. Logs remain ignored;
this record and committed tests provide portable commands and findings.

## Independent review

Read-only subagent `p06_review` reviewed the actual source, requirements and logs;
it made no edits or runtime claims. Initial verdict CHANGES REQUIRED; final narrow
recheck PASS **for an incomplete checkpoint only**. It confirmed expiry correction,
clock ordering, finite deadline, root exports and scoped docs. Reviewed hashes:

- security/helpers.ts: 6e80b3716a82931f968f70d9829202f3541093086a50399935894aeccf025e59
- freshness.test.ts: 33a2c94757218e4f4324ed7b342101681113351d6113bfdb78931c0baffcae54
- authorization/index.ts: ae2c32acdaf7ff4d491fef60e2b4ec4af146065582058fa1ed3e31717d3b5ab2

## Still required before P06 acceptance

Complete the G01–G06/R1–R3 matrix: real host lifecycle/bare-factory reuse and owner
projection, agents and caller/executor tuple cleanup, provider deny/challenge,
actual junior WorkService denial, independent limits/catalogue/draining/revocation
controls, scope/actor/generation isolation and exact candidate review/gates.

Resolve the observed actor-cap discrepancy against accepted plan §6: plan counts
all full-actor bindings, current implementation counts actor+scope. Investigate
the reviewer's later-guard identity invalidation hypothesis with a reproducer;
do not remove reentrancy guards. Public execution additions X05/X06/E05 and all
P07–P19 implementation/acceptance remain outstanding.
