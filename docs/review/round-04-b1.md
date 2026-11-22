# Round 04 — Side B Reviewer 1 (B1)

- **Reviewer ID:** B1 (side B, independent)
- **Date:** 2026-10-21
- **Candidate:** commit `65127f6` ("fix: bind owner at attach and finish the round-03 closures"), HEAD of branch `agentIdentity`; base diff `d3c33d1`; frozen-contract baseline `7038a08`
- **Mode:** blind, read-only, round-04 side-B review (per `docs/review/00-panel.md` rules 2–3)

## Independence / blind statement

I did not read any `round-04-a*.md` or any other `round-04-b*.md` report, and I did
not open other reviewers' round-01/round-02/round-03 side reports. From
`docs/review/` I consulted only the two files my brief allows as panel/read-only
material: `00-panel.md` and `round-03-triage.md` (coordinator triage, used solely
to anchor the R1–R5 item numbering). Every claim below is based on my own
inspection of the source tree, tests, SQL, and documentation at `65127f6`, plus
git history commands against `d3c33d1` and `7038a08`. Timestamps and findings
were not coordinated with any other reviewer.

## Commands run (exact)

Git (read-only):

```text
git log --oneline -8
git status --short
git show 65127f6 --stat
git diff 7038a08..65127f6 -- src/agents/types.ts src/persistence/types.ts src/work/types.ts
git show 65127f6 -- src/websocket/helpers/ahp/helpers.ts src/websocket/helpers/ahp/agentWork.ts
git show 65127f6 -- src/websocket/helpers/host/helpers.ts src/sessions/createSession/helpers.ts src/sessions/types.ts src/sessions/helpers/factory/helpers.ts
git show 65127f6 -- src/persistence/helpers/text.ts src/work/index.ts src/work/helpers/helpers.ts
git show 65127f6 -- src/tests/work/workService.test.ts src/tests/sessions/createSession.test.ts
git show 65127f6 -- src/tests/websocket/agentWork.binding.test.ts src/tests/websocket/agentWork.test.ts
git show 65127f6 -- src/tests/websocket/agentWork.disposal.test.ts src/tests/websocket/agentWork.integration.test.ts
git show 65127f6 -- database/migrations/README.md database/session-tables.md src/agents/README.md src/persistence/README.md src/sessions/createSession/README.md src/websocket/README.md src/work/README.md
```

Targeted single-file Vitest (as permitted; full `pnpm validate` forbidden and not run):

```text
pnpm vitest run src/tests/websocket/agentWork.disposal.test.ts      -> 1 file, 9 tests passed
pnpm vitest run src/tests/websocket/agentWork.test.ts               -> 1 file, 15 tests passed
pnpm vitest run src/tests/work/workService.test.ts                  -> 1 file, 20 tests passed
pnpm vitest run src/tests/sessions/createSession.test.ts            -> 1 file, 24 tests passed
pnpm vitest run src/tests/websocket/agentWork.integration.test.ts   -> 1 file, 2 tests passed
pnpm vitest run src/tests/websocket/agentWork.binding.test.ts       -> 1 file, 7 tests passed
pnpm vitest run src/tests/websocket.test.ts                         -> 1 file, 26 tests passed
```

No installs, no commits, no source/test/doc edits other than this report file,
no SQL executed, no migrations applied.

## Frozen-contract evidence

`git diff 7038a08..65127f6 -- src/agents/types.ts src/persistence/types.ts src/work/types.ts`
produced **empty output**. The frozen contracts are untouched between the
baseline `7038a08` and the candidate `65127f6`. Evidence type: direct git diff.

## Closure ledger (round-03 B1 items)

### R1 — settle-window predicate single-sourced through `src/websocket/helpers/settling.ts` — **CLOSED**

- **Code.** New file `src/websocket/helpers/settling.ts:12-19` exports the single
  probe `isSettlingSession(sessionOwners, sessions, channel)` = `owner(channel) !== undefined && getSessionSnapshot(channel) === undefined`
  (doc comment at lines 4-11 explains the fail-closed window). Both consumers
  now route through it:
  - AHP binding pre-check: `src/websocket/helpers/ahp/helpers.ts:385` —
    `|| isSettlingSession(sessionOwners, factory, parsed.data.channel)`.
  - Host facade: `src/websocket/helpers/host/helpers.ts:155` —
    `if (channel !== undefined && isSettlingSession(sessionOwners, sessions, channel))`.
  The `git show 65127f6` hunks for both files show the previous hand-duplicated
  inline conditions (`owner(...) !== undefined && sessions.getSessionSnapshot(channel) === undefined`
  on the facade; the equivalent triple condition inside the AHP deny branch).
  A repo-wide search for `owner(...) !== undefined` finds no remaining inline
  settle probe outside `settling.ts`.
- **Semantics preserved.** Inside the AHP branch the probe is evaluated only
  under `owner !== undefined`, where it reduces exactly to
  `factory.getSessionSnapshot(channel) === undefined` — identical to the
  `d3c33d1` condition. Cross-principal and anonymous denial is unchanged
  (`owner !== principal.subject` / `principal === undefined` still deny with
  `Session not found`, `src/websocket/helpers/ahp/helpers.ts:382-387`), and the
  submit path's `assertOwnedSession` cross-principal gate is untouched
  (`src/websocket/helpers/ahp/agentWork.ts:295-303`).
- **Tests.** `src/tests/websocket/agentWork.disposal.test.ts:562-582` pins the
  probe's truth table on the real factory/binding (live+owned → false; unknown
  channel → false; mid-disposal → true; post-settle → false). The d3c33d1
  fail-closed tests remain in place: lines 302 ("keeps mid-window recreates
  fail-closed ...") and 338 ("denies the owner's own recreate ...").
- **Facade probe end-to-end.** `src/tests/websocket/agentWork.integration.test.ts:277-349`
  drives a real `createAHPServer`: an AHP dispose parked on the backend keeps
  the facade create denied with `HOST_SESSIONS_SETTLING`, and after the settle
  the facade create succeeds.
- **Docs.** `src/websocket/README.md` module table carries the
  `helpers/settling.ts` row describing exactly this contract.

### R5 — wire request-key cap aligned through `WORK_MAX_REQUEST_KEY_LENGTH` — **CLOSED**

- **Code.** `src/work/helpers/helpers.ts:16` (`MAX_REQUEST_KEY_LENGTH = 256`),
  new export at line 25, re-exported at `src/work/index.ts:7`. Wire schema now
  `z.string().min(1).max(WORK_MAX_REQUEST_KEY_LENGTH)` at
  `src/websocket/helpers/ahp/agentWork.ts:62` (previously the hard-coded
  `128`, per the `git show` hunk).
- **End-to-end consistency.** DDL
  `database/migrations/0002_agent_work.sql:37` —
  `CHECK (length(trim(request_key)) BETWEEN 1 AND 256)` — matches the service
  gate (`src/work/helpers/helpers.ts:82-88`) and now the wire gate. The
  direction of the change is correct: the wire previously rejected keys the
  service (and DDL) accepted; now service, wire, DDL, and
  `src/work/README.md` ("the request key at 256", shared via the exported
  cap) agree.
- **Tests.** `src/tests/websocket/agentWork.test.ts:577-602` accepts exactly
  `WORK_MAX_REQUEST_KEY_LENGTH` characters through the wire, rejects 257 with
  a `ZodError` before the service (pinned by the submitted count staying at 1).

### R3 — `database/migrations/README.md` first-failure wording — **CLOSED**

- The bullet at `database/migrations/README.md:33-38` now reads: "...the object
  and version statements are not [IF NOT EXISTS]: each script is single-shot,
  and re-applying fails (on the first duplicate object, e.g. `CREATE TABLE`,
  or on the duplicate version key) rather than silently re-running statements."
- **Truth check against the SQL.** The guarded DDL is only the bookkeeping
  table (`0001_session_tool_baseline.sql:8` `CREATE TABLE IF NOT EXISTS schema_migrations`);
  every other object is unguarded (`0001:13` `host_state`, `0001:19`/`34`/`50`/`56`,
  `0002:6` `agent_registrations`, `0002:19` `work_items`, indexes `0002:50-59`
  and `0001:71-74`), and both version INSERTs are unguarded (`0001:79`,
  `0002:63`). With `-v ON_ERROR_STOP=1` (README:11-12) a re-apply aborts on the
  first failing object — which for a re-applied script is indeed a duplicate
  `CREATE TABLE` (`host_state` for 0001, `agent_registrations` for 0002).
  The claim matches the scripts. (The awkward mid-clause line wrap
  ("each script / is single-shot") renders as one sentence and is cosmetic.)

### R4 — `database/session-tables.md` retention citation — **CLOSED**

- `database/session-tables.md:12-17` now cites
  [`docs/architecture/agent-task-lifecycle.md`](../docs/architecture/agent-task-lifecycle.md)
  for the deferred retention: "the retain/cancel-and-archive policy is recorded
  as 'not implemented' in ...". The relative path resolves from `database/`
  to `<repo>/docs/architecture/agent-task-lifecycle.md`, which exists.
- **Target content check.** The cited document's "Not implemented" status item
  (`docs/architecture/agent-task-lifecycle.md:181-188`) states: "There is also
  no retention path: `work_items` rows and the durable `sessions` row they
  first landed are never deleted (live disposal only removes in-memory state),
  so a retain/cancel-and-archive policy is required before production use."
  That carries the retain/cancel-and-archive, no-retention-path statement the
  summary banner points to. The citation is truthful.

## Independent inspection of the candidate commit

All 23 files of `git show 65127f6 --stat` were reviewed, plus the current HEAD
text of the touched modules. Results of the deep checks:

- **Attach-time owner binding.** `src/sessions/createSession/helpers.ts:96-108`:
  the record is added, the hook runs synchronously at the attach moment (before
  the `root/sessionAdded` broadcast and the backend start), and a throwing hook
  removes the record and fails the create. Entry→add is fully synchronous
  inside `executeCreateSession` (parse/prepare/resolve/`has()`/parse-config are
  all synchronous; the first `await` is `startBackend`), so two creators cannot
  interleave between the uniqueness check and the add; a concurrent or
  late-arriving same-URI create gets `SessionAlreadyExists` via
  `sessions.has` (`src/sessions/createSession/helpers.ts:58-63`). The factory
  guard for an in-flight disposal remains at entry
  (`src/sessions/helpers/factory/helpers.ts:153-159`) and is not bypassed by
  the hook.
- **Resolution-time verification.** `src/websocket/helpers/ahp/helpers.ts:409-423`
  answers `AhpErrorCodes.Conflict` when the resolved create no longer leaves a
  live record owned by the caller. This replaces the previous after-resolution
  `bind(...)` that could strand a binding onto a removed record (a settle-window
  lockout no settlement would release). The ghost-binding and foreign-successor
  races are now pinned by tests:
  `src/tests/websocket/agentWork.disposal.test.ts:394-475` (stale detached
  create answers Conflict, never re-binds, the true creator keeps the work
  channel) and `:445` (mid-start own dispose → Conflict, URI immediately
  re-creatable, the recreate binds at attach). The `mapWorkError` typed-conflict
  fallback for an attach-time bind failure is correct even though the shipped
  gates (`sessions.has` + the settle-window deny) make it unreachable with
  normal registries (`src/websocket/helpers/ahp/agentWork.ts:173-175,202-221`).
- **`isJsonbSafe` depth budget.** `src/persistence/helpers/text.ts:35-68` adds
  an explicit 512-level bound; all call sites remain single-argument (grep
  verified), the recursion is otherwise unchanged, and the semantics ("scalar
  at nesting level 512 accepted, 513 rejected") match the new README wording of
  `src/work/README.md` and `src/persistence/README.md`. Pinned by
  `src/tests/work/workService.test.ts:458-477` and
  `src/tests/websocket/agentWork.test.ts:604-627`.
- **Dispose-channel text gate.** `src/work/helpers/helpers.ts:387-400` refuses
  before repository access; pinned by `src/tests/work/workService.test.ts:444-456`
  (incl. `hasDependentWork` not called).
- **`src/agents/README.md` bounded-growth rewrite** matches the code mechanics:
  the synchronous map-read pre-check at
  `src/websocket/helpers/ahp/agentWork.ts:310-322`, the bind conflicts at
  `src/agents/helpers/directory.ts:116-129`, and the upsert registration at
  `src/agents/helpers/directory.ts:93-98`.
- **`src/sessions/types.ts` / READMEs / facades.** The `createSession`
  contract doc, `src/sessions/createSession/README.md` ordering
  (registration + attach hook + broadcast → backend start), and the
  `src/websocket/README.md` ownership bullet were checked against the
  implementation; the ordered description is accurate. The untouched
  `src/tests/websocket.test.ts:419` stub (server without `sessionOwners`)
  remains valid — the new hook/post-check are inert without `sessionOwners`.
- **Bind key consistency.** The hook binds `record.sessionUri`
  (`params.channel`, untransformed by `sessionUriSchema`, `src/sessions/types.ts:23-28`),
  and the post-check reads the same untransformed channel — the keys match.

## Findings

### P1 — none.

### P2 — none.

### P3-1 (open, doc truth) — websocket README mis-files the outcome of one stale-create race case

- **File:** `src/websocket/README.md`, new bullet "Session ownership binds at
  the record-attach moment" (introduced by this commit).
- **Claim made:** "a create whose record is removed mid-start (its own
  disposal, or a same-principal successor attach) answers typed Conflict
  ('The created session is no longer available.')".
- **Expected (per that sentence):** Conflict for any record-removed-mid-start
  create, including after a same-principal successor attach.
- **Observed (code):** the resolution check at
  `src/websocket/helpers/ahp/helpers.ts:415-421` throws Conflict only when
  `!ownedByCaller || snapshot === undefined`. A same-principal successor
  attaches only after the dispose settled (the settle window denies even the
  owner's own recreate, `agentWork.disposal.test.ts:338`), at which point the
  stale create resolves with `owner === principal.subject` **and** a live
  snapshot → `return null` **success**, not Conflict. Conflict answers occur
  for: record gone and unbound (own disposal, e.g.
  `agentWork.disposal.test.ts:445`), an ownerless successor record (host
  facade `createSession` never binds), or a cross-principal successor owner
  (`agentWork.disposal.test.ts:394`). The normative behavior ("never re-binds
  the URI") is correct; only the third enumerated case answers success where
  the README says Conflict. This contradicts `AGENTS.md` "documentation must
  follow the code".
- **Suggested fix (one line):** rewrite the parenthetical to
  "(its own disposal, a host-facade successor attach, or a cross-principal
  successor attach)". Non-blocking; no behavioral defect.

### P3-2 (hypothetical, pre-existing, separately labeled — not attributable to this candidate)

- **File:** wire params path (`src/websocket/helpers/ahp/agentWork.ts`
  `boundedObject`/`boundedResult` + zod object schemas).
- Extreme wire nesting (thousands of levels) can still defeat engine-side
  `JSON.parse`/zod object recursion before any typed gate, escaping as an
  unclassified Internal error. This commit strictly improves the same path
  (bounded `isJsonbSafe` recursion at 512 levels with wire/service tests at
  600), and the residual depth is far beyond any legitimate payload. Status:
  deferred; recorded only because rule 5 asks hypothetical risks to be labeled.

## Validated-areas summary

| Area | Evidence | Mark |
| ---- | -------- | ---- |
| R1 shared settle predicate (AHP + facade) | `settling.ts:12-19`; `ahp/helpers.ts:385`; `host/helpers.ts:155`; probe test `disposal.test.ts:562-582`; facade e2e `integration.test.ts:277-349` | CLOSED |
| R5 request-key cap alignment | `helpers.ts:25` export; `agentWork.ts:62` wire; DDL 256; `agentWork.test.ts:577-602` | CLOSED |
| R3 migrations README first-failure wording | `database/migrations/README.md:33-38` vs `0001*.sql:8,13,71-74,79`, `0002*.sql:6,19,50-63`, `ON_ERROR_STOP=1` | CLOSED |
| R4 retention citation | `database/session-tables.md:12-17` → `docs/architecture/agent-task-lifecycle.md:181-188` | CLOSED |
| Frozen contracts untouched | `git diff 7038a08..65127f6 -- src/agents/types.ts src/persistence/types.ts src/work/types.ts` empty | VERIFIED |
| Denial semantics (cross-principal / owner-in-window) | pre-check reduction argument + retained `disposal.test.ts:302,338` + `agentWork.test.ts`/`binding.test.ts` suites | PRESERVED |
| Targeted test evidence | 7 files re-run by B1 (see command ledger): 9+15+20+24+2+7+26 = 103 tests, all passing | PASSING |

## Verdict

**PASS**

Verdict summary: The commit `65127f6` closes all four round-03 B1 items I was
briefed on exactly as specified — the settle-window probe is now a single
shared helper used unchanged by both the AHP binding and the host facade (with
a dedicated probe unit test and an end-to-end facade test), the wire
request-key cap flows through the new `WORK_MAX_REQUEST_KEY_LENGTH` export so
wire, service, DDL, and README agree at 256, and both documentation
corrections (first-failing-object re-apply semantics; the retention
"not implemented" citation to `docs/architecture/agent-task-lifecycle.md`) are
factually accurate against the scripts and the target file. The new attach-time
owner binding plus resolution-time verification closes the ghost-binding race
without weakening any cross-principal or owner-in-window denial, and the
frozen contracts `src/agents/types.ts`, `src/persistence/types.ts`, and
`src/work/types.ts` are byte-identical between `7038a08` and `65127f6`; all 103
tests across my seven permitted targeted runs pass. The only open finding is a
single-sentence documentation imprecision in `src/websocket/README.md` (the
"same-principal successor attach" stale-create case answers success, not
Conflict), which is behaviorally harmless, one line to fix, and non-blocking
under the panel rules.

Report: docs/review/round-04-b1.md — Verdict: PASS
