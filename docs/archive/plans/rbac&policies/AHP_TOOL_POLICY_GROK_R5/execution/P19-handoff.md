# P19 verified integrated handoff

The verified working-tree candidate is based on
`3d86b5113caa60e2f7c3fc33f1f9f1ef120717d9`. The [48-file SHA-256 manifest](P19-final-candidate.sha256)
pins the implementation, tests, and consumer documentation. The manifest SHA-256
is `6887b22917695f67ef080a7fed512aa0560d177006eb8958c898dadce1c56077`.

## Commands and outcome

Runs used Node 24.21.0, pnpm 10.34.6, and `Invoke-DbSafeCheck.ps1` from the
repository root. The verbose focused `pnpm exec vitest run` covered authorization,
tool policy, tool execution, application examples, and the public policy,
proposal, artifact, and continuation transport suites. It passed 746 tests in
44 files with `CHECK_EXIT:0`. `pnpm validate` passed lint, typecheck, 1,257 tests
in 99 files, 217 source mappings, and production build with `CHECK_EXIT:0`.
`git diff --check` passed. The scope check found no dependency, migration,
persistence, or durable work changes.

The local runner kept the sanitized `ahp-r5-p19-focused.log` and
`ahp-r5-p19-final-validate.log` in the PowerShell temporary directory. A full
`pnpm exec vitest run --reporter=verbose` run also passed all 1,257 tests with
`CHECK_EXIT:0` and recorded individual test names in `ahp-r5-p19-all-test-names.log`.

## Coverage reconciliation

The [R5 matrix](../TEST_COVERAGE.md) and [packet ledger](../templates/LEDGER.md)
link predecessor criterion mappings to their test suites and handoffs. The P19
full gate reran the repository suite. [P16](P16-handoff.md), [P17](P17-handoff.md),
and [P18](P18-handoff.md) map the new criteria to named current tests.

| Criteria | Final candidate proof |
| --- | --- |
| X05, X06, Z01 | `policyIntegration.test.ts` · “self route executes the approved harness with actual identity, source and full mandatory route” and its `cross` counterpart. The final run includes identity, schema, source, grant, provider, challenge, revocation, reconnect, and same-URI negatives. |
| E05, Z01 | `serverTools.integration.test.ts` · “public junior invokes the exact host action with separate authenticated authority and no client execution” and its `junior-agent` counterpart. The final run includes the matching provider, grant, source, challenge, and stale-instance negatives. |
| Z01, Z02 | `policyIntegration.test.ts` · “one harness preserves distinct senior, junior and PM user/agent inventories, private results and SDK views.” The absent-evaluator and server invoke-only denial cases compare canonical and recipient snapshot state and sequences. The egress and continuation suites cover recipient frames, buffers, reducer consistency, replay, and revocation. |
| Z02 | `clientProtocol.test.ts` · “releases only settled never-admitted retention” in both promise orders. `serverTools.integration.test.ts` · “settled public denials release disclosure capacity before an authorized call.” Before the fix, only 256 of 257 requests reached the policy callback. The final run reached it 257 times and dispatched the authorized control successfully. |
| Z02, Z03 | Independent source review verified the scoped activation, artifact delivery, and retention boundaries. The lead reran the integrated suites and checked source-map coverage and diff scope. |

The proof uses the real public `createAHPServer` and pinned SDK over loopback
with trusted fixture identity and policy providers. External identity, production
storage, and production artifact runtimes remain separate integrations.
