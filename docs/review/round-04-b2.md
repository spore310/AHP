# Round 04 — Side B, Reviewer B2 — Independent closure verification and regression inspection

## Reviewer ID and blind/independence statement

**Reviewer B2 (side B), round 04, full-scope static verification lens.**

This review was conducted blind and independently. I did not open any
`round-04-a*.md` file and no other `round-04-b*.md` file; at review start
`docs/review/` contained only the panel file and the round-01/02/03 files (no
round-04 files existed yet). Round reviewer reports (`round-01-a*.md`,
`round-01-b*.md`, `round-02-*.md`, `round-03-*.md`) were not opened. Reads were
limited to the panel docs the task allows (`00-panel.md`, `round-03-triage.md`),
repository instructions (`.agents/AGENTS.md`), the candidate's own code, tests,
and documentation, and migration SQL read plainly as files (no SQL was
executed). The ledger item definitions below come from my task assignment and
were corroborated only against the allowed round-03 triage. All judgments,
traces, and findings are my own from source inspection (static) plus the
targeted test runs listed.

## Candidate, base diff, and frozen-contract evidence

- Repository: `C:\Users\Yohan\OneDrive\Documents\Code\ahp`, branch `agentIdentity`.
- **Candidate commit:** `65127f65cd32c49866274418befb09010a914210`
  (`fix: bind owner at attach and finish the round-03 closures`), HEAD of
  `agentIdentity`.
- **Base diff:** `d3c33d1` (`fix: close the settling-window recreate and finish
  the storage-shape gate`) is the direct parent, so the commit diff equals the
  base diff (`git show 65127f6 --stat`; `git log --oneline -12`; `git status
  --short` showed no staged/unstaged source changes).
- **Frozen-contract check:** `git diff 7038a08..65127f6 -- 
  src/agents/types.ts src/persistence/types.ts src/work/types.ts` produced
  **empty output** — the frozen contracts are untouched. (`src/sessions/types.ts`
  is not frozen and carries the additive `onRecordCreated` parameter; also
  confirmed `src/work/types.ts` itself is untouched even though
  `src/work/index.ts` re-exports from it.)

### Exact commands run

Read-only git (PowerShell, one command per invocation):

```
git log --oneline -12
git status --short
git branch --show-current
git diff 7038a08..65127f6 --stat -- src/agents/types.ts src/persistence/types.ts src/work/types.ts
git show 65127f6 --stat
git show 65127f6 -- src/sessions/createSession/helpers.ts src/sessions/helpers/factory/helpers.ts src/sessions/types.ts
git show 65127f6 -- src/websocket/helpers/settling.ts src/websocket/helpers/ahp/agentWork.ts src/websocket/helpers/ahp/helpers.ts src/websocket/helpers/host/helpers.ts
git show 65127f6 -- src/persistence/helpers/text.ts src/work/helpers/helpers.ts src/work/index.ts
git show 65127f6 -- <each README / session-tables.md / migrations README>
git show 65127f6 -- <each changed test file>
git diff 7038a08..65127f6 -- src/work/index.ts
```

Targeted single-file/batch Vitest runs (no full suite, no `pnpm validate`):

```
pnpm vitest run src/tests/websocket/agentWork.disposal.test.ts --silent
  → 1 file, 9 tests passed (0 failed)
pnpm vitest run src/tests/websocket/agentWork.test.ts src/tests/websocket/agentWork.binding.test.ts --silent
  → 2 files, 22 tests passed (0 failed)
pnpm vitest run src/tests/sessions/createSession.test.ts src/tests/work/workService.test.ts --silent
  → 2 files, 44 tests passed (0 failed)
pnpm vitest run src/tests/websocket/agentWork.integration.test.ts --silent
  → 1 file, 2 tests passed (0 failed)
```

**Targeted total: 77 tests, all passing; failures: 0.** Deliberately not run:
full `pnpm validate` (forbidden for this review), eslint/tsc/`docs:check` as
individual scripts (outside this review's authorized command set — the
round-03 bundle already validated them green; the docs-gate mapping exposure of
this commit is instead verified by inspection below).

## Ledger — round-03 B2 closure items

| Item | Verdict | Evidence |
| --- | --- | --- |
| **F-01 — attach-hook owner binding so a dispose/settle race can no longer strand an ownerless live record** | **closed** | Code: `src/sessions/createSession/helpers.ts:104` — the hook `onRecordCreated?.(record.sessionUri)` runs synchronously immediately after `dependencies.sessions.add(record)` (line 96), before the `root/sessionAdded` broadcast (109) and before `startBackend` (114); a throwing hook deletes the just-added record and rethrows (105–108), so the URI stays re-creatable. Threaded via `src/sessions/helpers/factory/helpers.ts:153-165` and declared on `SessionsFactory.createSession` in `src/sessions/types.ts:243-255`. The AHP create path binds at attach: `src/websocket/helpers/ahp/helpers.ts:395-407` builds the hook (bind, `mapWorkError` on throw) and it is the only bind moment; the resolution step verifies ownership + live record and answers `AhpErrorCodes.Conflict` instead of silently re-binding (409–423). I verified the pre-check → uniqueness check → record add → hook span executes in one synchronous span (no `await` between `channelParamsSchema.safeParse`/pre-check and the hook; `prepareSessionCreation` is a synchronous `function`, `src/sessions/helpers/application/helpers.ts:81`), so a cross-subject incumbent cannot appear between pre-check and attach — the bind-at-attach cannot claim a foreign successor's record and cannot land inside a settle window (the settle-window pre-check denies creates while `owner != undefined && snapshot == undefined`). The settle window itself denies every principal (`isSettlingSession`, and the straight `executor == undefined`/cross-subject branch at helpers.ts:382-387). Tests: `src/tests/websocket/agentWork.disposal.test.ts` — stale detached create denied from binding a foreign successor, record disposed mid-start answers Conflict and binds no ghost, in-flight foreign disposal denied (record protected by the attach-time binding), re-create binds its true creator at attach; `agentWork.binding.test.ts:166-194` pins bind-at-attach/unbind-at-dispose and the no-bind-for-anonymous cases; the compose-host facade denial is pinned in `agentWork.integration.test.ts` ("keeps the host facade fail-closed while a connection disposal is settling"). All ran green. |
| **F-02 — `src/agents/README.md` bounded-growth example matches actual register/bind behavior** | **closed** | `src/agents/README.md:66-73` now states the reachable shapes: (a) one connection racing two concurrent registrations of distinct keys — both pass the synchronous map-read pre-check, then compete for the single live binding; (b) one agent key raced across two connections — one row via upsert, one failed bind. I traced these against `src/websocket/helpers/ahp/agentWork.ts:306-342` and `src/agents/helpers/directory.ts`: `getByConnection` (directory.ts:187-196) is a synchronous map read; two concurrent registrations of distinct keys on one connection both read `connected == undefined` at entry, both land a durable row via `register` (upsert, `src/persistence/helpers/agentRegistrations.ts:31-37` — `ON CONFLICT (principal_subject, agent_key)`), then `bindPresence` accepts the first and the second raises `AgentDirectoryError("conflict", "Connection already has a live agent")` (directory.rs:125-129 — connection holds at most one live agent). Cross-connection same key: one upsert row, the second `bindPresence` raises "Agent already has a live connection" (directory.ts:116-121). Row growth is thereby bounded by unique `(principal, agent_key)` pairs, as the bullet claims. The only looseness is stylistic ("map-reading conflict pre-check" also awaits `getRegistration` in the sequential case), which does not affect the reachability claim. |
| **F-03 — `database/session-tables.md` retention citation repointed to `docs/architecture/agent-task-lifecycle.md`** | **closed** | `database/session-tables.md:14-17`: "shipped behavior keeps durable rows, with retention explicitly deferred — the retain/cancel-and-archive policy is recorded as 'not implemented' in [`docs/architecture/agent-task-lifecycle.md`]". The relative path resolves to the existing file, and that file carries the claim under its "**Not implemented:**" paragraph: "There is also no retention path: `work_items` rows and the durable `sessions` row they first landed are never deleted (live disposal only removes in-memory state), so a retain/cancel-and-archive policy is required before production use" (lines 181–188). The M2 document is no longer cited for this statement. |

## Ledger — remaining round-03 closure family inspected in this commit (per my scope item 3)

| Item | Verdict | Evidence |
| --- | --- | --- |
| Shared settle-window probe (AHP + host facade) | closed | New module `src/websocket/helpers/settling.ts` (single predicate). Used identically in the AHP pre-check (`ahp/helpers.ts:385`) and the host facade (`host/helpers.ts:155`), replacing the hand-duplicated mirror. Pinned by the "shared settle-window probe" suite (`agentWork.disposal.test.ts:561-582`: false for live-owned and unknown, true mid-disposal, false after settle) and by the facade-level `agentWork.integration.test.ts` end-to-end run (denied while parked, reopened after settle, teardown released). |
| New `WORK_MAX_REQUEST_KEY_LENGTH` export | closed | `src/work/helpers/helpers.ts:25` exports the service cap (`MAX_REQUEST_KEY_LENGTH = 256`, used at the service level 82-88); re-exported in `src/work/index.ts:7`; consumed by the wire schema `requestKey` in `src/websocket/helpers/ahp/agentWork.ts:62` — the wire cap is now exactly the service/DDL/README cap (DDL `CHECK (length(trim(request_key)) BETWEEN 1 AND 256)`, `database/migrations/0002_agent_work.sql:37`; `src/work/README.md` "Bounded input"). Wire no longer rejects keys the service would accept: pinned by "accepts a service-length request key and rejects longer ones at the wire" (`agentWork.test.ts`). |
| Dispose-channel text gate (`assertSessionDisposable`) | closed | `src/work/helpers/helpers.ts:387-393` rejects a non-string or non-JSONB-comparable `sessionUri` with `WorkError("invalid", "A session URI is required.")` before `repository.hasDependentWork`. Pinned twice in `workService.test.ts` (NUL channel and lone surrogate, repository untouched, comparable text still reaches the lookup). Covers both the AHP dispose handler and the host facade (both call the service). |
| JSONB depth budget for `isJsonbSafe` | closed | `src/persistence/helpers/text.ts` — `JSONB_SAFE_DEPTH = 512`; recursion threads `depth + 1` through arrays and object entries; `depth > 512` returns `false` (typed rejection instead of stack overflow; cycles are also now caught at the budget instead of overflowing). Service-side projection gate at `helpers.ts:195-196` ("The session projection cannot be stored as JSON.") and wire-side gate via `isPayloadInvalid`; both are pinned by the deep-input/deep-result wire tests and the deep-projection service test (all green). `src/persistence/README.md` and `src/work/README.md` describe the budget exactly. |
| Settlement `unbind` failure stays loud, healable | closed | Dispose handlers keep `unbind` in `finally` (`ahp/helpers.ts:440-447`; `host/helpers.ts:175-183`), so a throwing custom `unbind` replaces the outcome (fail-loud) and the re-dispose path (which answers `SessionNotFound` for an already-removed record) still runs the finally and heals the window. Pinned by "surfaces a failing settlement unbind and heals the settle window on a re-dispose" (`agentWork.disposal.test.ts:504-558`). |
| Migrations README re-apply wording | closed | `database/migrations/README.md:34-37` now states re-applying fails on the first duplicate object (e.g. `CREATE TABLE`) or the duplicate version key. Verified against `0001_session_tool_baseline.sql` (`schema_migrations` is the only `IF NOT EXISTS`; `host_state`/`session_types`/`tools`/`sessions` are bare `CREATE TABLE`) and `0002_agent_work.sql` (bar `CREATE TABLE` × 2, bar INSERT). Accurate. |
| Docs-gate exposure for new `src/websocket/helpers/settling.ts` | closed (verified by inspection) | `src/websocket/README.md` helpers table gains the `helpers/settling.ts` row (:28); every other changed source file already has a mapping row (createSession README updated for the hook; persistence/work/agents README rows updated). `src/websocket/index.ts` deliberately does not re-export the internal probe; the test imports the helper path directly — consistent with existing pattern (`agentWork.test.ts` imports `@websocket/helpers/ahp/agentWork`). |

## Findings

### P3-01 — `src/websocket/README.md` and the resolution-comment overclaim the Conflict for the same-principal successor subcase — open

- **Files:** `src/websocket/README.md:165-171`; framing also present in
  `src/websocket/helpers/ahp/helpers.ts:400-403` and `:410-414`.
- **Claimed:** "a create whose record is removed mid-start (its own disposal, or
  a same-principal successor attach) answers typed Conflict (`The created
  session is no longer available.`)".
- **Expected (doc):** the stale create answers Conflict whenever a successor
  attaches after the settle, including a same-principal successor.
- **Observed (code):** the post-check is
  `ownedByCaller = principal == undefined ? owner == undefined : owner == principal.subject`
  (`ahp/helpers.ts:415-423`). When the creator's own disposal settled and a
  *same-principal* successor attaches (allowed once the window is closed:
  `owner == undefined` pre-check passes, uniqueness passes), the stale
  resolution finds `owner === principal.subject` and a live snapshot, so
  `ownedByCaller` is true and the create answers **plain success**, not
  Conflict. Conflict only fires for a foreign successor (`owner != subject`),
  for a no-successor detached resolution (record gone), or for a stale
  *unauthenticated* create (`owner != undefined` breaks `owner == undefined`).
- **Not a regression:** under base `d3c33d1` the late bind was same-subject
  idempotent — the observable outcome for the same-principal successor subcase
  is identical (stale create returns success). This is exactly the
  same-owner recreate residual that round-03 declared deferred ("still
  requires a wire-visible identity field and stays deferred"), so the sentence
  contradicts both the code and the residual framing it was meant to carry.
- **Impact:** documentation truth only; wire contract unchanged. Suggested
  reword: "(its own disposal, or a successor bind by another principal) answers
  typed Conflict …; a recreate by the same principal is indistinguishable at
  the wire (deferred residual — see round-03)". The comment block at
  `helpers.ts:410-414` can drop "or a URI now owned by a successor" or scope
  "successor" to a foreign subject.

### Explicitly hunted and cleared (no defect)

- **Hook-failure rollback**: record delete + rethrow leaves `sessions.size` at
  the pre-count, the factory `.then` skips `emitActiveSessionsChanged`, the
  startup backend never runs (`startBackend` is after the hook), the URI is
  immediately re-creable — pinned by `createSession.test.ts` "fails the create
  when the hook throws and leaves no record".
- **Attach atomicity**: uniqueness (`sessions.has`, `createSession/helpers.ts:58-63`)
  and `sessions.add` are in one synchronous span with the hook, so the `add`
  (`registry.set`) can never overwrite a foreign record.
- **Unbound mid-start creates**: an anonymous baseline create (no binding) is
  the documented host-global POC residual (round-03); not expanded by this
  commit, and the settle-window probe still applies to it.
- **`mapWorkError` in the hook**: cross-subject bind maps to
  `RpcError(AhpErrorCodes.Conflict, "Conflict")` (`agentWork.ts:202-221`);
  non-work errors rethrow unmodified; the record is rolled back in every case.
- **`assertSessionDisposable` catch**: the `WorkError("conflict")` thrown
  inside the `try` re-enters `mapRepositoryFailure`, which rethrows non-
  persistence errors verbatim — no code/mapping corruption (`helpers.ts:394-400`).
- **Dispose-channel gate on the host facade**: a `WorkError` rejection from
  `hostedSessions.disposeSession` is not new (dependent-work conflict already
  rejected with `WorkError` at base).
- **`isJsonbSafe` budget performance/equivalence**: budget only ever widens
  legitimate-payload acceptance (well inside PostgreSQL JSONB nesting); keys
  and arrays recurse correctly; rejection is typed at both layers.
- **Rig determinism**: the new integration test's ≤20-`setImmediate` polling
  loops each allow I/O polling before the check phase; bounded waits of this
  shape are the established pattern in this suite, not a new flake mechanism.
- **Type surface**: fake factories in `agentWork.binding.test.ts` satisfy the
  widened `SessionsFactory.createSession` signature; `hostedSessions`'s
  narrower `createSession` remains assignable; `AhpErrorCodes.Conflict`
  (-32011) is an established member of the app error vocabulary reused for a
  lifecycle conflict with a distinguishing message.

## Verdict

**PASS.**

All three assigned round-03 B2 closure items are fully and verifiably closed by
`65127f6`: the owner binding is acquired at the synchronous record-attach
moment (with rollback on hook failure) and the resolution step verifies
ownership/liveness instead of re-binding, so the late-bind takeover, ghost
binding, and settlement-strip family has no reachable bind moment left; the
agents README bounded-growth text now describes shapes I independently re-traced
as reachable exactly as written; and the session-tables retention citation
points at an existing document that actually carries the "not implemented"
retain/cancel-and-archive statement. The remaining closure family (shared
settle probe, `WORK_MAX_REQUEST_KEY_LENGTH`, dispose-channel text gate, 512-level
JSONB budget, loud unbind, migrations wording) also checks out against code,
wire schema, DDL, docs, and 77 targeted tests that ran green with zero
failures, and the frozen contracts at `src/agents/types.ts`,
`src/persistence/types.ts`, and `src/work/types.ts` show an empty diff across
`7038a08..65127f6`. The one open finding is a single P3 documentation-truth
defect: the websocket README (and the paired code comment) claim a typed
Conflict for a same-principal successor attach where the code answers plain
success — behavior identical to the base commit and explicitly deferred as the
same-owner residual, so it is a wording fix, not a wire or behavior change.

Report: docs/review/round-04-b2.md — Verdict: PASS
