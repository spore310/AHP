# Round 03 — Side-B Review B2 (blind, independent)

**Reviewer B2** | Date: 2026-10-21

**Blindness statement.** I did not read, and have not read, any other reviewer's
round-02 or round-03 report. The only review-panel inputs consulted are
`docs/review/00-panel.md`, `docs/review/round-01-triage.md`, and
`docs/review/round-02-triage.md`. No `round-02-b1.md`, `round-02-b2.md`,
`round-03-a*.md`, or sibling `round-03-b*.md` file was opened. I was the B2
author of a prior round, but file this report only against its own evidence:
the base/candidate diff, current source, current tests, and current docs.

## Candidate

- Commit: `d3c33d1397f38c36a818ab46d039e49360fb9308` (`d3c33d1`)
- Branch: `agentIdentity`, HEAD at review time
- Supersedes: `27ff2bb` (round-01/round-02 fix bundle) on `7038a08`
  (originally reviewed feature commit)
- Worktree state: clean except untracked `docs/review/` (reports only)

**Commands run (sequential, read-only):**

```text
git log -4 --oneline --decorate
git status --short
git log -1 --format=full d3c33d1
git diff 27ff2bb..d3c33d1 --stat
git diff 27ff2bb..d3c33d1            # full per-path patch review
git show d3c33d1:tsconfig.json       # alias verification for deep imports
pnpm exec vitest run                 # 40 files / 298 tests — all pass
pnpm exec vitest run src/tests/websocket/agentWork.disposal.test.ts
  src/tests/websocket/agentWork.test.ts src/tests/work/workService.test.ts
  src/tests/agents/directory.test.ts src/tests/websocket/agentWork.integration.test.ts
                                     # focused re-run: 5 files / 46 tests — all pass
pnpm run typecheck                   # clean
pnpm run docs:check                  # 96 source files mapped — passes
pnpm run lint                        # 0 warnings (max-warnings 0)
Repo-wide grep sweeps for MAX_AGENT_WORK_PAYLOAD_BYTES / isJsonbSafe(Text) /
  createSession / disposeSession / sessionOwners / channelFromParams
```

No dependencies were installed (existing `node_modules` used); no SQL or
migrations executed; no DB-backed tests exist in the suite (all tests are
in-memory fakes per the migrations README); no commits; only this report file
was created.

**Files/areas reviewed:** `src/work/helpers/helpers.ts`, `src/persistence/helpers/text.ts`,
`src/persistence/helpers/{workItems,sessions,agentRegistrations}.ts`,
`src/persistence/{types,index}.ts`, `src/websocket/helpers/ahp/{helpers,agentWork,constants}.ts`,
`src/websocket/helpers/host/helpers.ts`, `src/websocket/README.md`,
`src/agents/helpers/directory.ts`, `src/agents/README.md`, `src/work/README.md`,
`src/sessions/helpers/factory/helpers.ts`, `src/sessions/createSession/helpers.ts`,
`src/tests/work/workService.test.ts`, `src/tests/websocket/agentWork{,.disposal}.test.ts`,
`src/tests/agents/directory.test.ts`, `database/migrations/{README.md,0001_session_tool_baseline.sql,0002_agent_work.sql}`,
`database/M2_AGENT_WORK_DATABASE_SCHEMA.md`, `database/session-tables.md`,
`docs/architecture/agent-task-lifecycle.md`.

## Per-finding ledger — triage rows vs. evidence

Triage = `docs/review/round-02-triage.md`. Every row was verified at source,
test, and doc level; "partial" rows below carry the residual as its own finding.

| # | Triage row | Decision | Code evidence | Test evidence | Doc evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | Reproduced P2 — owner's own mid-window recreate stripped at settlement (A1-r2 F1 = B1-R2-01 = B2R2-P3-01) | Fix: deny *any* create while a binding exists without a live record, in BOTH the AHP handler and host facade | `src/websocket/helpers/ahp/helpers.ts:377–391` — denial now `(principal === undefined \|\| owner !== principal.subject \|\| factory.getSessionSnapshot(...) === undefined)`; `src/websocket/helpers/host/helpers.ts:16,150–158` — full mirror (`HOST_SESSIONS_SETTLING`, rejects before `sessions.createSession`) | `src/tests/websocket/agentWork.disposal.test.ts:293–329` — owner denied in-window ("Session not found"), binding released exactly at settle, post-settle rebind binds the true creator; sibling tests pin cross-principal denial and the binding-release point | `src/work/README.md` caveats (settling-window closure implied by F6/F7 bullets); error surfaces unchanged | **closed** (one narrow non-deterministic residue filed as F-01 below; the deterministic round-frame is closed) |
| L2 | P3 gate #1 — object keys unguarded; predicates to one source of truth | Shared module + `Object.entries` recursion | `src/persistence/helpers/text.ts:40–53` — recursive check now `Object.entries(value).every(([key, item]) => isJsonbSafeText(key) && isJsonbSafe(item))`; `:11–38` NUL + paired/unpaired surrogate logic; grep proves it is the **only** NUL/surrogate implementation left (old copies in `src/work/helpers/helpers.ts` deleted; module now re-exports at `helpers.ts:30–31` and `@work` index `src/work/index.ts:5`) | Property exercised at wire (`isPayloadInvalid` → `isBoundedInput`/`isBoundedResult`, `agentWork.ts:70–105`) and service (`helpers.ts:43`) | `src/persistence/README.md:17` row added (also satisfies the docs gate); `src/work/README.md:66–68` states "values or object keys" | **closed** |
| L3 | P3 gate #2 — scalar TEXT carriers (`requestKey`, `sessionUri`, `agentKey`, `displayName`) | Gate at service, directory, and wire | Service: `src/work/helpers/helpers.ts:74–79` (submit sessionUri), `:81–86` (requestKey), `:252–260` (claim sessionUri). Directory: `src/agents/helpers/directory.ts:87–92` (agentKey + displayName, before any repository work). Wire: `src/websocket/helpers/ahp/agentWork.ts:41–58` (agentKey/displayName/requestKey refinements), `:115–118` (`boundedSessionUri` + storable-text refine, used by both `submitSchema` and `claimSchema` `:120–132`) | `src/tests/work/workService.test.ts:303–321`; `src/tests/agents/directory.test.ts:41–48` (also asserts zero repository calls); `src/tests/websocket/agentWork.test.ts:284–292` (wire NUL `agentKey` → ZodError, zero `registerCalls`) and `:307–318` (wire NUL session URI → ZodError, zero `work.calls`) | `src/work/README.md:61–70`; `src/agents/README` unchanged on this point (correct scope) | **closed** |
| L4 | P3 gate #3 — durable projection reaching `$8::jsonb` unchecked | Gate `live.durableState` at submit | `src/work/helpers/helpers.ts:192–196` — `isJsonbSafe(live.durableState)` → typed `invalid` before the repository write; runs after ownership validation, before target-agent resolution and SQL | `src/tests/work/workService.test.ts:323–338` (unsafe `workingDirectories` projection refused with "The session projection cannot be stored as JSON.") | `src/work/README.md:66–69` ("inside the durable session projection") | **closed** |
| L5 | P3 — terminal-key replay after reconciled cancel (A2-r2 F4) | Replay-only refinement; frozen contracts untouched | `src/work/helpers/helpers.ts:233–245` — guarded by `!result.created` (cheap rare path), reads the landed row with the **principal-bound** `get({ workId, principalSubject })` and refuses `cancelled`/`failed` with typed `conflict`; `queued`/`leased`/`completed` still resolve `{ id }`. `src/persistence/types.ts:131–134` returns `WorkItemRecord \| null` (`null` handled at `:241`); `git diff 27ff2bb..d3c33d1` touches no frozen `types.ts` (stat contains none) | `workService.test.ts:340–361` (cancelled + failed refusals; `get` called with exact principal-bound args; `cancel` not called) and `:363–374` (non-terminal replay resolves as before, single `get`) | `src/work/README.md:81` Testing row mentions "terminal-key replays" | **closed** |
| L6 | P3 — same-owner recreate during a submission write (A1-r2 F3) | Accepted + documented; no contract change | Verified the stated reason is true: `src/websocket/helpers/host/helpers.ts:29–54` `describeSession` uses fetch-time `createdAt` (`now`), `@sessions/types` `SessionSnapshot` = `{ resource, state, fromSeq }` (no stable generation), and `src/work/helpers/helpers.ts:218–222` reconciles owner+liveness only | none needed (documentation-only decision) | `src/work/README.md:109–114` ("Same-owner recreate residual"); `database/M2_AGENT_WORK_DATABASE_SCHEMA.md:216–221` — both accurate against the code | **closed** (as an explicitly accepted/deferred decision) |
| L7 | P3 observation — one owner authority in the host wiring (A1-r2 F5) | Documented | `src/websocket/helpers/host/helpers.ts:86–95` — projection's `ownerPrincipalSubject` is overlaid from the same `sessionOwners` registry the service checks | n/a | `src/work/README.md:105–108` — accurate | **closed** |
| L8 | Docs #1 — duplicate `## Caveats` in `src/work/README.md`; URI cap + text-gate scope | Merge + add | — | — | Verified: exactly one `## Caveats` (L86); caps `2,048`/`256` match `MAX_SESSION_URI_LENGTH = 2_048` (`helpers.ts:19`) and `MAX_REQUEST_KEY_LENGTH = 256` (`:16`) and the DDL `CHECK length(trim(request_key)) BETWEEN 1 AND 256` | **closed** |
| L9 | Docs #2 — agents README renewal vs cache misdescription | Rewrite | — | — | Verified against code: `bindPresence` reads the registration *cache* (`directory.ts:106`, refreshed by `register`/`getRegistration` `:198–205`); `renewPresence` (`:147–167`) consults neither cache nor repository; work mutations still re-read via `getById` (`helpers.ts:119–128`). One *new* sentence in the bounded-growth bullet is inaccurate — filed as F-02 | **closed**, with a P3 worded-example defect inside the new bullet (F-02) |
| L10 | Docs #3 — `ownedPrincipalSubject` → `owner_principal_subject`; de-contradiction | Fix | — | — | `database/session-tables.md:7` column matches `0001_session_tool_baseline.sql:60`; "superseded but never implemented as specified" no longer self-contradicts; banner now flags in-body lifecycle claims as proposal-only. One citation nit — filed as F-03 | **closed**, with a P3 citation defect (F-03) |
| L11 | Docs #4 — restore literal `;` at `agent-task-lifecycle.md:27` | Normalize | — | — | Verified L27 renders the literal semicolon | **closed** |
| L12 | Docs #5 — M2 bullet states best-effort cancel | Fix | — | — | `M2_AGENT_WORK_DATABASE_SCHEMA.md:216–221` matches `helpers.ts:223–231` (cancel tolerated, conflict raised) and the residual wording | **closed** |
| L13 | Docs #6 — persistence README `helpers/text.ts` row (docs gate) | Add | — | — | Row present and accurate; `pnpm docs:check` passes (96 files) | **closed** |
| L14 | SQL statement-validity (A2-r2 scope 1) — validated, nothing to change | Carry | — | — | `d3c33d1` touches no `.sql` file (stat confirms); 0001:8 `CREATE TABLE IF NOT EXISTS schema_migrations`, plain `INSERT` version rows at 0001:79 / 0002:63 — version strings match filenames | **carried** (statement-level only; runtime still blocked) |
| L15 | Side-B — B1-R2-02 duplicated Caveats | Fix | — | — | = L8 | **closed** |
| L16 | Side-B — B1-R2-04 renewal/cache misdescription | Fix | — | — | = L9 | **closed** |
| L17 | Side-B — B1-R2-03 dead 1 MiB constant | Delete after reference check | `src/websocket/helpers/ahp/constants.ts` — `MAX_AGENT_WORK_PAYLOAD_BYTES` removed; repo-wide grep finds no remaining reference (only `MAX_TOOL_PAYLOAD_BYTES` at `toolInvocation.ts:10,61` — still used) | — | — | **closed** |
| L18 | Side-B — B1-R2-05 session-tables banner nits + "Disposed sessions are deleted" | Fix banner | — | — | Banner (`session-tables.md:3–15`) now cites the body claim (L40 exists), says shipped behavior keeps durable rows. Code check: no caller of `DurableSessionRepository.delete` exists anywhere (grep) and the wiring (`src/index.ts:50–61`) never constructs it — so "keeps durable rows" is true; but "with retention explicitly deferred (see the M2 document)" cites a doc that contains no retention statement → F-03 | **closed**, with P3 F-03 |
| L19 | Side-B — B1-R2-06 migrations README table set + re-apply semantics | Fix | — | — | Eight tables now listed (7 durable + `schema_migrations`) and the list matches the SQL exactly; "table DDL is IF NOT EXISTS, but the version INSERT is not" verified at 0001:8 vs 0001:79/0002:63 | **closed** |
| L20 | Side-B — B2R2-P3-02 best-effort cancel in two docs | Fix | — | — | `M2...:216–221` + `agent-task-lifecycle.md:123–129`; the "failed cancel keeps blocking disposal" consequence is true (`hasDependentWork` counts any-status rows; `assertSessionDisposable` runs on every dispose) | **closed** |
| L21 | Side-B — B1-R2-07 register pre-check read outside the mapped try | Accepted observation, no change | `agentWork.ts:301–313` pre-check remains before the mapped `try` — unchanged, matching the written decision (only reachable class maps identically) | — | — | **closed (as recorded decision)** |
| L22 | Side-B — B2R2-P3-N mermaid `#59;` | Normalize | — | — | = L11 | **closed** |
| L23 | B2 evidence gap — swallowed-cancel path untested | Test added | `helpers.ts:226–230` swallow retained | `workService.test.ts:266–288` — rejecting repository cancel still yields the typed `conflict`, never false success | — | **closed** |
| L24 | B2 evidence gap — replaced-owner reconciliation untested | Accepted with rationale | No code path makes a crossed-subject replacement reachable through public surfaces (window denial + `ensureSession` owner guard `sessions.ts:76–78`); the branch is defensive parity | none (accepted) | — | **closed (as recorded decision)** |

Coverage sweep for regressions in round-01 fixes: whitespace-trim checks retained
(`helpers.ts:81–94`, DDL mirror), service-side 2,048 session-URI bound retained
(`:77`), shared wire/service size constants retained (`agentWork.ts` uses
`WORK_MAX_INPUT/RESULT_BYTES`), `fail` message "validated then dropped" behavior
unchanged and correctly documented (wire 512 ≤ service 2,000), token/auth code
untouched, `schema_migrations` INSERTs untouched. Frozen contracts untouched.

## Findings

Scale: P1 blocking / P2 important / P3 hardening-quality-docs. No P1 or P2
found. Hypothetical/analytic status is labeled on each item.

### F-01 (P3, pre-existing in the family fixed this round; not a regression of `d3c33d1`) — post-settlement bind can strand an owner binding with no live record and no in-flight disposal

- **Where:** `src/websocket/helpers/ahp/helpers.ts:371–401` (create handler),
  `:403–425` (dispose handler); `src/sessions/helpers/factory/helpers.ts:152–166,
  194–222`; `src/sessions/createSession/helpers.ts:32–102`.
- **Shape:** the create handler runs its all-principal pre-check, then
  `await factory.createSession(params); sessionOwners.bind(stage, principal.subject)`
  — the bind is unconditional on `parsed.success && principal !== undefined`
  (`:393–396`). `executeCreateSession` starts the provider backend **after**
  registering the record (`createSession/helpers.ts:101`), so the handler's bind
  happens only after `record.provider.startSession(...)` settles. The dispose
  handler releases the binding in `finally` once the removal settles
  (`:416–424`), and removal (`sessions.delete`, `factory/helpers.ts:203`)
  happens **before** the backend dispose is awaited.
- **Interleaving (analytic, not reproduced):** same owner issues `createSession(U)`
  and (concurrently) `disposeSession(U)` while the create's backend is still
  starting. The dispose (its work gate permitting) finds the record, deletes
  it, and completes → `finally` unbinds. The create's backend resumes, sees the
  record detached, late-disposes the backend, `createSession` resolves as
  success, and the handler then calls `bind(U, subject)` — a binding with **no
  live record and no disposal in flight**. From then on every `createSession(U)`
  is refused by the (correct, fail-closed) settle-window pre-check — including
  the owner's — and nothing releases the binding except the owner issuing a
  disposal of the non-existent URI (which unbinds even on `SessionNotFound`,
  `:416–424`), or `stop()` (`host/helpers.ts:210`). Other principals stay
  walled off. Availability defect only: no takeover (binding = true owner), no
  data corruption, work on the URI already fails closed via
  `describeSession`/`boundOwner`.
- **Expected vs observed:** expected — the round-02 fix's invariant "a binding
  without a live record marks a disposal still settling" (its own comment,
  `ahp/helpers.ts:381–383`) so the denial window is bounded by the settle;
  observed — a settled disposal can be followed by a fresh bind, making the
  denial window unbounded. Needed for closure: bind only after re-confirming
  the live record still exists (re-check `factory.getSessionSnapshot(channel)`
  immediately before binding, or unbind on the detached path), plus an
  interleaving regression over the gated provider.
- **Status/impact:** open; P3. The deterministic record-less window the triage
  item targeted is genuinely closed (L1); this is a supplementary scheduling
  corner in the same binding design that predates this bundle (the handler
  order is identical in `27ff2bb`). Filed because the charter asks for stale
  or stranded bindings and false denials that should still succeed; it does
  not block this candidate's declared scope.

### F-02 (P3, open) — new sentence in `src/agents/README.md:66–70` describes a concurrency example the code does not produce

- **Where:** `src/agents/README.md:66–70` (bullet added by this commit).
- **Observed text:** "Two same-principal connections registering distinct keys
  concurrently can each land a row before one fails to bind, which stays
  inside that bound."
- **Why inaccurate:** with two *connections* and two *distinct* keys there are
  two distinct `agentId`s and two distinct connection bindings — neither bind
  can fail (`bindPresence` conflicts only on (a) same agentId live on another
  connection or (b) a connection already holding another agent,
  `directory.ts:116–129`). The reachable "row landed but bind failed" shapes
  are: one connection whose two concurrent registrations of distinct keys both
  pass the (synchronous, map-reading) conflict pre-check and then compete for
  the one live binding it may hold, or the same agent key raced across two
  connections (one row, one failed bind). The *normative* claim in the same
  bullet ("rows grow only with unique `(principal, agent_key)` pairs; the bind
  conflict is refused before the durable write; same-key registrations are
  upserts") is verified true against `agentWork.ts:297–333` and
  `agentRegistrations.ts:31–51`.
- **Status/impact:** open; P3 docs. Next action: reword the example to a shape
  the code actually produces (or drop the example sentence).

### F-03 (P3, open) — `database/session-tables.md:14–15` cites the wrong document for deferred retention

- **Where:** `database/session-tables.md:14–15` (banner rewritten by this commit):
  "shipped behavior keeps durable rows, with retention explicitly deferred
  (see the M2 document)."
- **Why inaccurate:** the M2 document contains no retention statement (grep for
  retention/deletion/kept-rows has no match in a lifecycle sense). The
  retention/never-delete note lives in `docs/architecture/agent-task-lifecycle.md`
  ("Not implemented": retain/cancel-and-archive policy required — round-01 row
  B1-P3-05). The factual behavior claim itself is verified true (no caller of
  `DurableSessionRepository.delete`; the host wiring never constructs the
  repository; `ensureSession` only inserts/updates), so only the citation is
  wrong.
- **Status/impact:** open; P3 docs. Next action: repoint the citation to the
  lifecycle doc, or add one retention sentence to the M2 "Operational caveats"
  so the citation holds.

### Checked and explicitly *not* findings

- **`kind` has no NUL/surrogate text gate** at service or wire
  (`helpers.ts:88–94` allow-list only; `agentWork.ts:59–62` unrefined). This
  was the triage's explicit four-field scope (requestKey/sessionUri/agentKey/
  displayName) and first submit fails with an operator-broken allow-list only —
  env values cannot contain NUL (block-delimited), and the configured set is
  server-supplied, so there is no client-reachable injection path. The work
  README hedges this correctly ("the allow-list is the primary char-set gate
  for kind"). Recording as accepted scope, not a defect.
- **Terminal-replay `get` returning `null` skips the refusal** (`helpers.ts:241`):
  a principal-row mismatch would have to change the durable `sessions` owner
  mid-call; `ensureSession` raises `unauthorized` on a cross-owner write
  (`sessions.ts:76–78`) and the in-window create denial blocks post-settle
  cross-principal recreation, so no current path reaches it. Defensive parity;
  hypothetical only.
- **Deep import `@persistence/helpers/text`** (three consumers) rather than a
  `src/persistence/index.ts` export: `index.ts` "defines the intended public
  surface" and CodingRules prefer the owning capability's public API for
  public contracts; precedent for type-surface deep imports exists
  (`@persistence/types`, `@sessions/types`). The README row documents the file
  and the gate passes. Style-level only; not graded up.
- **Host facade pre-check asymmetry** (`Error` w/ `HOST_SESSIONS_SETTLING` vs
  RPC `InvalidParams "Session not found"`): matches the pre-existing
  `HOST_SESSIONS_STOPPED` style of the host API; consistent.
- **`isJsonbSafe` objects whose `Object.entries` is empty** (Maps/Sets can only
  reach the gate from non-JSON internal shapes — none exist: wire payloads are
  `JSON.parse`-bound and `durableState` rows come back from JSONB).

## Documentation accuracy checks (summary)

| Document | Claim | Verdict |
| --- | --- | --- |
| `database/migrations/README.md:22–36` | Eight-table set; `schema_migrations` DDL `IF NOT EXISTS` + non-idempotent single-shot version INSERT | Accurate vs `0001`/`0002` SQL |
| `database/M2_AGENT_WORK_DATABASE_SCHEMA.md:216–221` | Best-effort cancel, tolerated failure, binding+liveness-only reconciliation, same-owner residual | Accurate vs `helpers.ts:218–231` |
| `docs/architecture/agent-task-lifecycle.md:27` | literal `;` restored | Accurate |
| `docs/architecture/agent-task-lifecycle.md:123–129` | Best-effort cancel + failed-cancel keeps blocking disposal | Accurate (`hasDependentWork` counts any-status rows) |
| `src/work/README.md` | Single Caveats; caps; text-gate scope; failure-message 1–2,000 w/ 512 wire cap; one-owner-authority; same-owner residual; Testing table incl. disposal races | Accurate (kind bullet is hedge-correct; no overclaim) |
| `src/agents/README.md:58–70` | Bind consults cache / renewals consult neither / work re-reads re-enabled / disabled DB flip keeps presence | Accurate vs `directory.ts`; the bounded-growth *example sentence* is inaccurate → F-02 |
| `src/websocket/README.md:159–163` | Host disposal releases binding at settlement, success or failure; no authorization | Accurate vs both `finally` unbinds and the record-already-removed failure mode |
| `src/persistence/README.md:17` | `text.ts` predicate row | Accurate; docs gate passes |
| `database/session-tables.md:3–15` | Superseded banner, column rename, proposal-only body claims, durable rows kept | Accurate except the M2 citation → F-03 |
| Commit message claims | Owner-recreate denial; shared predicates + keys; scalar/wire/directory/projection gates; terminal replay; deleted dead constant; docs; +7 regressions; "pnpm validate green (40 files / 298)" | All verified; exactly 7 new `it()` blocks (291 → 298), suite/typecheck/docs-gate/lint re-run green here |

## Evidence gaps

1. **PostgreSQL runtime (long-standing panel blocker, rule 7):** no SQL applied
   or queried. Statement validity remains review-based. In particular the new
   behaviors (terminal-replay refusal, projection gate, scalar gates) are
   unit-tested over in-memory fakes; the real-DB probes already owed (concurrent
   `SKIP LOCKED`, replay/conflict, CHECK shapes, `\u0000` probe) now also
   implicitly cover the NUL-in-key → 22P05 path, which no one can run yet.
2. **F-01 is code-path-derived, not test-reproduced.** The interleave argument
   is deterministic at the microtask level but no test pins it (I did not add
   test files under the read-only constraint).
3. **Replaced-owner reconciliation** remains untested by recorded decision (row
   L24) — unchanged from triage.
4. `reconcileExpired` cluster semantics and the static token authenticator were
   out of this round's fix surface; not deep-reverified beyond confirming the
   diff does not touch them.

## Verdict

Every triage fix row is closed at source, test, and documentation level, with
the two accepted-and-deferred items consistent with their recorded decisions.
No P1/P2 was found; the new defects are three P3s (one narrow pre-existing
binding race in the same family as the fixed P2, two doc-accuracy items, one
of which was introduced by this commit's README bullet). The validation claims
in the commit message reproduce exactly (298 tests, docs gate 96 files,
typecheck/lint clean). Nothing here blocks the round frame's goals.

**Final verdict: `PASS`** (with the three open P3s recommended for the next
hardening pass; F-01 is the one I would fix first).

Report: docs/review/round-03-b2.md — Verdict: PASS
