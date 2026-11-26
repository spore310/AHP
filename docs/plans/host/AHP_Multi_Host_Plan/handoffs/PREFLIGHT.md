# PREFLIGHT handoff

**Run date:** November 26, 2026. **Mode:** preflight followed, in the same
run, by feature execution that the user authorized ("start the work and
complete the feature work").

## Candidate (PF-01)

| Fact | Value |
| --- | --- |
| Branch | `feature/ahp-v1` |
| HEAD at start | `324fd60634e3d93aa4af59da98263c1cac0deb3b` (equals the inspected remote baseline) |
| Working tree at start | Clean. Only `docs/plans/host/` was untracked. |
| Toolchain | Node 24.21.0, pnpm 10.34.6, TypeScript 5.9.3, Vitest 5.0.5, Microsoft SDK 1.0.0 |
| Docker | Engine 29.8.1, Compose v5.5.1, image `postgres:17.12-bookworm` |

Nothing was reset or stashed. The work stayed uncommitted until every gate
had passed, and was then committed locally at the user's request.

## Baseline gate (PF-03)

| Check | Command | Result |
| --- | --- | --- |
| Repository gate on the untouched baseline | `pnpm validate` | Exit 0. 133 files, 1,503 tests. 296 source files mapped. Build succeeded. |
| PostgreSQL conformance | `scripts/Invoke-LocalPostgres.ps1`, and `examples/postgresql-conformance.ts` against a disposable `postgres:17.12` | Passed on the candidate. See below. |
| Applied migrations | `SELECT version FROM schema_migrations` | `0001` to `0005` |

The PostgreSQL conformance was first executed after migration 0005 existed,
not on the untouched baseline. It contains every P0–P5 conformance assertion.
Three were adapted to accepted contract changes and are listed under
"Adapted regressions".

Historical figures in the archived ledger (1,503 tests in 133 files) match the
rerun. The ledger's run identifiers, judge reports and timing figures were not
re-verified; they have no artifacts in the repository.

## Previous-plan sweep (PF-02)

Two bounded read-only reviewers inspected the P0-P5 material, in two passes.
Together they read all 131 ledger rows against the cited files.

- The ledger contains exactly 131 distinct acceptance identifiers: P0 24,
  P1 22, P2 23, P3 21, P4 22, P5 19. The set equals the identifiers defined
  in the six packets.
- All 77 link targets in the ledger exist in the current tree.
- No row is missing its evidence.
- 17 rows cite a file that holds only part of the proof. The rest of each
  proof is in another existing test that the row does not cite. The first
  such row found was P2-21, whose remaining assertions are in
  `src/tests/work/executionGuard.test.ts`.
- Four rows each had one clause with no dedicated assertion anywhere. They
  are listed below with what was done.
- The final judged P5 tree differs from HEAD only in the ledger file.

| Row | Clause that had no assertion | Test added |
| --- | --- | --- |
| P0-21 | Work anchored on a dependent reached only through the containment (`parent`) edge is cancelled. The grant edge was already covered. | `src/tests/persistence/ledgerClauses.test.ts`, and the PostgreSQL probe in `durableAdapter.ts` |
| P1-19 | The selection depth limit: 32 by default, at most 64, on either parent edge and through work submission | `src/tests/work/ledgerClauses.test.ts` |
| P2-12 | An execution guard refuses a target excluded beneath an included ancestor | `src/tests/work/ledgerClauses.test.ts` |
| P2-14 | Guard and renewal lifetime follow the store's clock, not the local wall clock | `src/tests/work/ledgerClauses.test.ts` |

For P2-14 the store clock is separated from the local clock by replacing the
time the real in-memory store reports. PostgreSQL clock skew is probed for
claim and renew in `p3Clock.ts`, not for the tagged execution guard.

The archived ledger itself is not edited: it is a historical record.

## Classification and archive (PF-04, PF-05, PF-06)

| Previous path | Verdict | Action |
| --- | --- | --- |
| `docs/plans/plan.md` | Completed | Moved to `docs/archive/plans/ahp-v1/` |
| `docs/plans/work/README_Codex_Handoff.md`, `00_`, `01_`, `02_`, `03_`, `P0_`–`P5_`, `AHP_V1_P0_P4_Database_Schema_Plan.md` | Completed | Moved to `docs/archive/plans/ahp-v1/` |
| `docs/plans/work/AHP_V1_Target_Schema.sql`, `AHP_V1_Schema_Smoke.sql`, `manifest.json` | Completed reference | Moved with the bundle |
| `docs/plans/work/ProvidersPlan.md` | Mixed: milestone 1 implemented, later milestones proposed | Retained as active at `docs/plans/ProvidersPlan.md`, replacing the pointer stub |
| `docs/plans/work/README.md`, old `docs/plans/ProvidersPlan.md` stub | Superseded | Removed |
| `docs/plans/README.md` | Index | Rewritten to list the multi-host plan and the providers plan |

- Moves are tracked renames.
- `manifest.json` was moved unchanged and not regenerated. Its checksums
  describe the files at their original paths and commits.
- Link repairs changed bytes only in `00_Shared_Contracts.md` and
  `03_Acceptance_Matrix.md`. Both already differed from the manifest before
  this run. No checksum that matched before was invalidated.
- `docs/archive/README.md` and `docs/archive/file-index.md` gained an entry.
- `src/sessions/README.md` now links the providers plan at its real path.
- One source edit was required by the move:
  `src/tests/persistence/adapters/postgres/p1Schema.ts` reads the smoke SQL
  fixture and now reads it from the archive path.

The providers plan lists "multi-host out of scope" among its non-goals. That
statement describes its own milestones. Multi-host support is now provided by
this plan, and the providers plan's proposed client milestones remain open.

## Reuse review (PF-07)

| Addition | Existing owner considered | Why an extension was needed |
| --- | --- | --- |
| `src/host` (`@host`) | `websocket/helpers/host` | Requested boundary. Files moved, one factory kept. |
| `topology.hostId` | `sessions.durability.hostId` | Same value. No second name field. |
| Host namespace identifier | Policy `NamespaceRef` | Different concept: a data and membership scope, not a policy grouping. |
| `HostAdmission`, `NamespacePolicy` | `ConnectionAuthenticator`, policy factory | A host is not a user or agent actor. Reused zod validation and the trusted-configuration pattern. |
| `HostClaim`, `HostCoordination` on `DurableHost` | `DurableStorage.acquire`, `DurableHost.epoch` | Extended the same port with an optional claim and capability. No new service. |
| Per-session owner | `host_state` epoch fence | Extended the same transaction fence and the existing locked session read. |
| `host_events` | `WorkEventPublisher` | The in-process publisher is unchanged. The table adds a committed record other hosts can read. |
| Relay listener | `createWebSocketServer`, `ConnectionSetupAdapter` | Reused unchanged. The owner runs its normal connection setup on the forwarded handshake. |
| Order gate | Per-peer view queue | Added a `settle` marker to the existing queue and merged above it. |
| Reserved sequence | `ActionSequence` | Added an optional `reserve` to the same port. |

No second authorization engine, session factory, client state store or
scheduler was introduced.

## Decisions (PF-08)

D01–D08 are Established. See [DECISIONS.md](../DECISIONS.md).

## Review (PF-09)

| Reviewer | Scope | Outcome |
| --- | --- | --- |
| Prior-plan evidence reviewers (independent, read-only, two passes) | P0–P5 ledger, archive convention, inbound links | All 131 rows read. Findings applied above. Flagged the runtime dependency on the smoke SQL fixture. |
| Unit-test author (independent, wrote two test files only) | Namespace, admission and topology validation | Found three defects in new code. All fixed; see [H1](H1.md). |
| Final reviewer, a second reviewer for later changes, and a third after the final fix | Integrated candidate | See [H9](H9.md). The third ended with the verdict PASS. |

## Adapted regressions

These existing conformance assertions changed because an accepted contract
changed. No invariant was weakened.

| Location | Change | Reason |
| --- | --- | --- |
| `p0Conformance.ts`, migration list | Expects `0005_host_coordination` | New migration |
| `p0Conformance.ts`, owner backend lookup | Finds the lease by `(lease_slot, relation)` | The lease key changed (D05) |
| `p0Conformance.ts`, fixture pools | Set `ahp.host_id` for raw SQL fixtures | Session writes require a fenced host identity |

## Scope (PF-11)

The diff contains archive moves, plan documents and, because feature
execution was authorized in the same run, the H0–H9 implementation. No push,
merge, commit or deployment was performed.

## Gates for the final candidate (PF-12)

Recorded in [H9](H9.md).
