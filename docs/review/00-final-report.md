# Final report — the double-blind adversarial review loop

**Result: CLOSED — all four blind reviewers PASS on round 04.**
Candidate of record: `65127f6` ("fix: bind owner at attach and finish the
round-03 closures"), finished by the user-authored closing commits `4951b82`
(panel record + advisory doc fixes) and `f280496` (scalar-seed boundary test
pins). Final HEAD: `f280496`, branch `agentIdentity`, working tree clean.
Final validation: lint → typecheck → **312 tests** (40 files) → docs gate
(97 source files mapped) → build (185.09 kB).

---

## 1. Scope and protocol

Modules under review: `src/agents`, `src/work`, `src/persistence`, `database`,
plus the coupled `src/websocket` surface. Protocol: two independent,
mutually blind reviewers per side (side A and side B) per round; all four
verdicts **PASS** to close. Any P1 or P2 ⇒ **CHANGES REQUIRED**. Findings
trigger fix → focused verification → fresh blind re-review. Reviewers were
read-only (no repo edits, no commits, no SQL) and each round ran as fresh
context briefed only by `docs/review/00-panel.md` and the prior *triage* files.
Triage files are the shared panel record; verdict files
(`round-0N-{a1,a2,b1,b2}.md`) are filed per reviewer. Coordinators declared
write sets in the triage before editing. SQL (panel rule 7) was **never
executed** at any round — SQL files were edited only.

Reviewer roles:

| Reviewer | Lens |
| --- | --- |
| A1 (side A) | identity, authorization, binding lifecycle, wire mapping — adversarial rigs over real wiring |
| A2 (side A) | input/SQL-safety boundaries, frozen contracts, baseline behavior preservation, documentation accuracy |
| B1 (side B) | adversarial agent/work end-to-end, per-row verification ledger |
| B2 (side B) | full-scope static verification, ledger + trace |

## 2. Round-by-round history

### Round 01 — candidate `7038a08` ("feat: add authenticated agent presence and durable work leases")

| Reviewer | Verdict |
| --- | --- |
| A1-r1 | **CHANGES REQUIRED** — F1, F2 (two P2s, both reproduced) |
| A2-r1 | PASS (advisory P3s) |
| B1-r1 | PASS (P3s only) |
| B2-r1 | PASS (P3s only) |

Blocking findings: the stale owner binding surviving a failed disposal
enabling cross-principal work ownership (A1-F1), and the recreate landing
between record delete and unbind leaving an ownerless zombie session (A1-F2).
Side B had found the same area only as an unreachable P3 shape (B1-P3-06);
A1's reproduction established reachability, confirming both P2s.

**Fix bundle `27ff2bb`** — 19 files, +723/−31. Owner binding released in
`finally` at the authoritative removal point; create pre-checks fail closed;
submit re-verifies binding + live projection after the repository write and
cancels/COUNTs conflicts; register pre-checks the connection conflict; NUL and
lone-surrogate text gate (`isJsonbSafe`/`isJsonbSafeText`) at service and wire;
shared payload-bound constants; timing-unsafe bearer comparison replaced with
SHA-256 digest comparison; `schema_migrations` rows written; whitespace trim
alignments; documentation corrections. Validation: 291 tests (+10 regressions),
docs gate 95 files, build green.

### Round 02 — candidate `27ff2bb`

| Reviewer | Verdict |
| --- | --- |
| A1-r2 | **CHANGES REQUIRED** — F1 (P2, reproduced); F2–F5 (P3) |
| A2-r2 | **CHANGES REQUIRED** — F1–F5 (P3) |
| B1-r2 | **CHANGES REQUIRED** — B1-R2-01 (P2, code-analytical); rest P3 |
| B2-r2 | PASS (P3s only) |

Convergence: A1-r2 reproduced and B1-r2 independently derived the **same
incomplete closure** — the owner's own mid-window recreate survived and was
then stripped by the settlement unbind — while B2-r2 filed the identical gap
only as a P3 hardening item. A2-r2 + A1-r2 converged on the JSONB-key and
scalar-carrier shape-gate families.

**Fix bundle `d3c33d1`** — 19 files, +363/−94. The settling window is closed to
*all* principals (any create is denied while a binding exists without a live
record); a single source of truth `src/persistence/helpers/text.ts` extends the
gate to object keys, all scalar TEXT carriers, and the durable projection;
terminal-key replay after a reconciled cancel is refused with typed `conflict`
(idempotency contract preserved for queued/leased/completed); two
round-01-introduced documentation regressions corrected (duplicated Caveats
section; renewal-path misdescription); the dead 1 MiB payload constant removed;
the mermaid `#59;` entity normalized back to the literal `;`. The **same-owner
recreate during a submission write** (A1-r2 F3) had no detectable root cause
fixable without a wire-visible session identity field — accepted, documented
(`src/work/README.md` "Same-owner recreate residual"). Validation: 298 tests
(+7), docs gate 96 files, build green.

### Round 03 — candidate `d3c33d1`

| Reviewer | Verdict |
| --- | --- |
| A1-r3 | **CHANGES REQUIRED** — F1 (P2, reproduced); F2–F4 (P3) |
| A2-r3 | **CHANGES REQUIRED** — F1–F2 (P3) |
| B1-r3 | PASS (R1–R5, all P3) |
| B2-r3 | PASS (F-01–F-03, all P3) |

Convergence: three reviewers independently agreed on the same root — the owner
binding lands only *after* the factory call resolves — making A1-r3's
reproduced P2 (F1: a stale, self-disposed create late-binds onto a concurrently
created foreign live record) panel-confirmed, with B-side members as the
settle-strip/ghost family.

**Fix bundle `65127f6`** — 23 files, +682/−62. The load-bearing change: owner
binding acquired **at the record-attach moment** via a new optional
`onRecordCreated(sessionUri)` hook on `SessionsFactory.createSession`
(`src/sessions` is an unfrozen surface; `agents`/`persistence`/`work` types
remained untouched — frozen diffs vs `7038a08` verified empty in round 04).
The resolution step now *verifies* (`owner === caller && snapshot exists`,
else public `Conflict` "The created session is no longer available."). This
removes every bind moment of the takeover/ghost/settle-strip family, and the
in-flight window gained dispose protection. Alongside: A2-r3 F1 — the dispose
channel's URI now passes `assertSessionDisposable`'s text gate (typed
`invalid`, zero repository access on garbage text); A2-r3 F2 — explicit 512
level JSONB depth budget; B1-r3 R2 — shared settle-window probe
(`src/websocket/helpers/settling.ts`) used by both the AHP handler and the
host facade; B1-r3 R5 — wire request-key cap aligned via the exported
`WORK_MAX_REQUEST_KEY_LENGTH` (256); documentation corrections (re-apply
failure wording, retention citation repoint, bounded-growth example,
attach-hook contract). A1-r3 F4 (throwing `unbind` inside the dispose
`finally`) was kept **fail-loud** over the suggested swallow — swallowing would
turn a loud, re-dispose-healable failure into a permanent silent settle
lockout — by triage decision, with reading + a pinned regression test.
Validation: 310 tests (+12 across 5 files), docs gate 97 files, build green.

### Round 04 — candidate `65127f6` — ALL PASS

| Reviewer | Verdict | Findings/outlook |
| --- | --- | --- |
| A1-r4 | **PASS** | P3: stale `sessions/README.md` signature (D1), caveat wording (D2); accepted observations O1 (facade ownerless) + O2 (benign typed race) |
| A2-r4 | **PASS** | P3 advisory: depth-budget boundary unpinned by tests; frozen diffs empty; closures verified with source + test evidence |
| B1-r4 | **PASS** | P3: same-principal successor wording in the websocket README caveat |
| B2-r4 | **PASS** | P3 doc-truth: README + paired code comment over-claim typed Conflict for the same-principal successor case |

Convergence: B1-r4, B2-r4, and (via D2/O) A1-r4 converged on the same P3
doc-truth defect — the settle-window caveat claims a typed Conflict for a
*same-principal* successor attach, where the code answers plain success (the
explicitly deferred same-owner residual family). The triage (`round-04-triage.md`)
recorded decisions RF-1..RF-4 and declared the closing write set.

**Closing bundle** (advisory, docs/tests only, applied after all-PASS and
validated green at 312 tests, landed as the user's two commits):

- **RF-1** `src/websocket/README.md` caveat reworded (removal semantics per
  A1-D2; the same-principal successor attach honestly named as the deferred
  residual with cross-reference to `src/work/README.md` "Same-owner recreate
  residual"); the paired comment in `src/websocket/helpers/ahp/helpers.ts`
  scoped to a *foreign* successor.
- **RF-2** `src/sessions/README.md` factory signature updated with the optional
  attach hook + contract pointer.
- **RF-3** depth-boundary pins: one service-level and one wire-level test
  asserting **512 levels accepted / 513 refused** with a *scalar seed* — a
  scalar seed makes the deepest leaf land exactly at recursion depth `levels`
  (an object seed would add one level: 512 wraps = 513 objects), so the pair
  catches a one-directional off-by-one comparator flip in either direction.
  Committed as `4951b82` + the scalar-seed correction `f280496`.
- **RF-4** accepted, no change: facade-created records are ownerless by
  design, covered by the existing "does not add authorization" note.

Frozen-contract verification in round 04: `git diff 7038a08..65127f6 --`
`src/agents/types.ts src/persistence/types.ts src/work/types.ts` **empty**;
`sessions/types.ts` additive-only (optional hook param + JSDoc).

## 3. Commit ledger

| Commit | Round | Content | Stats |
| --- | --- | --- | --- |
| `7038a08` | r1 candidate | authenticated agent presence + durable work leases | (base) |
| `27ff2bb` | r1 fixes | disposal/ownership races + input bounds | 19 files +723/−31 |
| `d3c33d1` | r2 fixes | settling-window recreate + storage-shape gate | 19 files +363/−94 |
| `65127f6` | r3 fixes | bind owner at attach + round-03 closures | 23 files +682/−62 |
| `4951b82` | closing (user) | docs/review panel record + advisory doc/comment fixes | see git |
| `f280496` | closing (user) | scalar-seed boundary test pins | see git |

Validation progression: 281 → **291** (r1) → **298** (r2) → **310** (r3) →
**312** (closing) tests; docs gate 95 → 96 → 97 mapped source files; every
bundle closed with a full green `pnpm validate` (lint, typecheck, tests,
docs gate, build).

## 4. Accepted residuals (documented, with rationale)

| # | Residual | Decision origin | Where documented |
| --- | --- | --- | --- |
| 1 | Same-owner recreate during a submission write cannot be detected without a stable session-generation field (wire-visible contract change) | A1-r2 F3, re-affirmed r3/r4 | `src/work/README.md` "Same-owner recreate residual"; M2 schema doc reconciliation bullet; cross-referenced from `src/websocket/README.md` + the create-handler comment |
| 2 | Facade-created (`host.sessions.createSession`) records are ownerless by construction; durable work cannot attach to them | A1-r4 O1, A2-r4 observation (RF-4: accepted, no change) | `src/websocket/README.md` "does not add authorization" note |
| 3 | Failing settle `unbind` kept fail-loud (re-dispose heals) instead of swallowed | A1-r3 F4 triage decision | `src/websocket/README.md` + pinned regression test |
| 4 | Registration-cache staleness: invalidation specified to land together with a real disable/decommission path (renewals consult neither cache nor repository) | A1-F5/B1-P3-02/B2-P3-04 | `src/agents/README.md` |
| 5 | Per-agent kind eligibility (plan LEASE-03): V1 keeps a frozen host-global allow-list | B1-P3-03 | `docs/architecture/agent-task-lifecycle.md` "Not implemented" |
| 6 | Retention / never-delete durable state: a retain/cancel-and-archive policy is required before production use | B1-P3-05 | `docs/architecture/agent-task-lifecycle.md` "Not implemented"; cited from `database/session-tables.md` |
| 7 | Reconcile-per-claim overhead accepted; the claim CTE re-checks the DB clock itself | B2-P3-03 | `src/work/README.md` caveats |
| 8 | Reserved wire vocabulary `exhausted` kept (frozen contract) until a producer exists | B1-P3-07/B2-P3-05 | `src/work/README.md` |
| 9 | Failure `message` validated then dropped: frozen v1 reply is `{ status }`; persistence is a schema change | B2-P3-06 | `src/work/README.md` |
| 10 | Targeted-row orphan remediation is a policy decision; owner `cancel` is the recovery path | A2-02 | `database/M2_AGENT_WORK_DATABASE_SCHEMA.md` |
| 11 | Register pre-check read outside the mapped `try`: today's only reachable failure class maps identically; moving it risks diverging the conflict path for zero gain | B1-R2-07/B2R2-P3-N | round-02 triage |
| 12 | Same-principal successor attach resolves plain success (one identity owns both records) | RF-1 wording; deferred residual family | `src/websocket/README.md` caveat + `src/work/README.md` |

## 5. BLOCKED: real-PostgreSQL acceptance (panel rule 7)

Per user instruction no SQL was ever applied or executed against a database;
all validation is code-level, static, and unit-level. The blocker is recorded
in every round and persists. Owed when a database is approved (from
`round-01-triage.md`, extended by later rounds):

- concurrent `SKIP LOCKED` claim race (two claims, one row);
- replay/conflict behavior on a real DB (DATA-04/05 scenarios);
- CHECK lease-shape enforcement;
- `\u0000`/lone-surrogate payload probe against a live JSONB cast;
- disabled-target remediation test;
- migration re-apply failure mode (first duplicate object / version key);
- depth-budget payload (512 accepted / 513 refused) against the real storage.

## 6. Process notes

- **Blindness incidents, none material.** A2-r4 first launch died at the
  platform rate limit and was relaunched fresh with the identical
  deterministic prompt (blindness preserved). A2-r4 disclosed in its report
  that a docs-wide grep inadvertently surfaced lines of other reviewers'
  round-04 files; every claim was grounded in inspection performed before and
  independent of that grep. The side-B coordinator hit its daily message cap
  immediately after writing both verdict files; both are on disk.
- **Mermaid `#59;` corruption.** The round-01 fix commit introduced
  `push#59;` entity corruption at `docs/architecture/agent-task-lifecycle.md` —
  external tooling rewriting `;` inside mermaid blocks; restored to the
  literal `;` in round 02 (render-equivalent normalization). Later recurrences
  (correlated with a workspace agent "Fix broken mermaid diagrams") were
  recovered via `git checkout`. State at the time of this report: clean — no
  `#59;` entity in `README.md` or `docs/architecture/agent-task-lifecycle.md`.
- **Panel hygiene.** Reviewers read-only at every round; coordinators declared
  write sets in the active triage before editing; SQL never executed; frozen
  contracts verified byte-identical vs `7038a08` at rounds 03 and 04;
  `sessions/types.ts` changes remained additive-optional throughout.

## 7. Verdict file index

- Panel rules: `00-panel.md`
- Triages: `round-01-triage.md`, `round-02-triage.md`, `round-03-triage.md`,
  `round-04-triage.md`
- Verdicts: `round-01-{a-process,a1,a2,b1,b2}.md`, `round-02-{b1,b2}.md`
  (side-A round-02 findings are inlined in `round-02-triage.md`),
  `round-03-{a1,a2,b1,b2}.md`, `round-04-{a1,a2,b1,b2}.md`
