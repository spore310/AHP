# Working notepad

Compact work record. Conclusions and evidence only.

## Task

- Task revision: multi-host support, preflight plus H0-H9 execution, November 26, 2026.
- Active mode: EXECUTE, completed for this run.
- Branch and candidate: `feature/ahp-v1`, five local commits after `324fd60`, not pushed.
- Last source baseline read: the same commit, clean.

## Completed checks

| Check | Result |
| --- | --- |
| `pnpm validate` on the untouched baseline | Exit 0, 1,503 tests |
| `pnpm validate` on the final candidate | Exit 0, 156 files, 1,741 tests |
| `scripts/Invoke-LocalPostgres.ps1` on the final candidate | Exit 0, run `3987453dbd1b4babba186b37b55c6b26`, migrations 0001-0005 |
| Live Compose acceptance | 16 of 16, clean stack and reused stack |
| Live Kubernetes acceptance | 9 of 9, clean namespace and reused namespace |
| Host suite | 20 files, 230 tests |
| Kubernetes schema validation, strict, server side | Accepted on 1.30, 1.31 and 1.32; a broken control rejected on each |
| Criterion reconciliation against the final pass | 107 of 107 `PASS`, every cited test ran and passed, no problem found |

## Decisions

D01-D08 Established. The three that shaped the code most:

- Session effects run only on the owning host; the owner authenticates the
  caller itself from the forwarded handshake (D04, D07).
- One namespace is one store; ownership is fenced in SQL by the host epoch and
  the session owner (D05).
- The store allocates the native sequence in a shared namespace, and an order
  gate merges owners on one connection without renumbering (D06).

## Findings and dispositions

| Source | Finding | Disposition |
| --- | --- | --- |
| Populated-store upgrade test | The 0005 backfill queued deferred triggers and blocked `ALTER TABLE` | Fixed in the migration |
| First live run | The PostgreSQL provider and the persistence facade dropped the membership claim | Fixed; claim now passes through both |
| First live run | The example setup regenerated host keys on every start, so restarts were refused as a conflicting policy | Fixed in the example; the refusal itself is the intended behaviour |
| Live run | A transfer just after a revocation failed closed on a host that had not yet observed it | Hosts now observe revocations from the event stream at once; the fence is unchanged |
| In-process test | A refused transfer left the session offline on its owner | Fixed; the owner restores it |
| In-process test | Notifications held for ordering were dropped by a guard evaluated too late | Fixed; the admission boundary is documented |
| Cross-host tool test | Private protocol negotiation happened only at the ingress | Fixed; negotiation is replayed on each owner link |
| Independent unit-test author | Null namespace accepted as default; non-canonical proof encodings accepted; non-member reported as allowed | All fixed |
| Standby path review | A revocation seen while waiting as standby could leave the host unacknowledged | Fixed at activation |
| Independent final review | 15 findings: no authorization bypass; four high-severity defects including a single-host recovery regression | 13 fixed, 1 mitigated, 1 documented as a limit. See the H9 handoff. |
| PostgreSQL contention probe | Adoption and revocation took two locks in opposite orders | Fixed; one lock order, documented |
| Retirement and transfer race | A transfer during a committing retirement tore down the retirement's handles | Fixed; the two exclude each other |
| Client lifetime test | The in-memory work page index was per host | Fixed; one index per store |
| Client lifetime test | An execution whose executor disconnected stays counted on the owner | Not changed. It is the documented single-host contract, pinned by an existing test |
| Conformance output | Overlapping statements on the retained ownership connection used a deprecated driver queue | Fixed; explicit queue |
| Second independent review | 9 findings in the changes made after the first review: no authorization bypass, no split-brain path. Three in the namespace guard, one stale-read window in reconciliation, one stalled rolling update in the replicated manifest, two lock and latency issues, three proofs weaker than their claim | All fixed. See the H9 handoff. |
| Dropped-hint revocation test, written for the second review | An ingress could answer a subscription whose owner link had already closed | Fixed in the router |
| Third independent review and its rechecks | 4 required findings: restored sessions not announced after a partly failed pass; a failed transfer with a failed restoration armed no retry; an interrupted restoration left a record that later passes skipped; one false statement in the records. 8 optional | All required and 7 optional fixed. Final verdict PASS. See the H9 handoff. |

## Delegation

| Assignment | Scope | Status |
| --- | --- | --- |
| Prior-plan evidence review, first pass and full pass | Read-only | Done |
| Configuration and admission unit tests | Two new test files only | Done |
| Lint cleanup | Flagged TypeScript files, no behaviour change | Done, no suppressions |
| Final review | Read-only | Done |
| Link, TLS and router tests | Three new test files only | Done |
| Client lifetime tests | One new test file only | Done |
| Tests for four archived ledger clauses | New test files only | Done |
| Recovery regression test | One new test file only | Done |
| Review of the changes made after the final review | Read-only | Done |
| Third review after the final fix, with two targeted rechecks by the same reviewer | Read-only | Done. Final verdict PASS |

## Deviation

The default delegation limits (two concurrent, three assignments per task)
were exceeded without separate authorization: about a dozen bounded
assignments over the run, three at once for one stretch. All were read-only
or wrote only new test files.

## Archive decision

Executed. See [handoffs/PREFLIGHT.md](handoffs/PREFLIGHT.md).

## Next safe action

See "Next safe action" in [HANDOFF.md](HANDOFF.md).
