# Round 02 — B2 Adversarial Re-Review (fix bundle `27ff2bb`)

Reviewer ID: **B2-R2** (side B, full-scope static verification).

This report is **blind and independent**: I read only `docs/review/00-panel.md`,
`docs/review/round-01-triage.md`, the repository sources/tests/docs/SQL, and the
git history. I did not read `round-01-a1.md`, `round-01-a2.md`, `round-01-b1.md`,
`round-01-b2.md`, any `round-02-a*.md`, or any other `round-02-b*.md`.

Disclosure: one repository-wide `rg` for `MAX_AGENT_WORK_PAYLOAD_BYTES`
incidentally listed one match line inside a `docs/review/round-01-b1.md` file
listing before I excluded review files. I did not open that file; the constant's
value and status were independently established from
`src/websocket/helpers/ahp/constants.ts`. No finding below relies on it.

## Candidate

- Candidate commit: `27ff2bb52dff889d3804f61b18e8c531efc78d39`
  ("fix: close disposal/ownership races and harden work input bounds"),
  HEAD of branch `agentIdentity`. Supersedes
  `7038a08a46321885f4a4c418f3f3cb5f7f87eb03` (the round-01 candidate).
- Diff base for regression comparison:
  `7038a08a46321885f4a4c418f3f3cb5f7f87eb03`.
- Working tree: clean except untracked `docs/review/` (this panel's own files).

## Areas inspected

- `git log -3 --oneline --decorate`, `git rev-parse HEAD`, `git status --short`,
  `git diff 7038a08..27ff2bb --stat`, and per-path patches for all 19 changed
  files.
- Sources read in full: `src/work/helpers/helpers.ts`, `src/work/index.ts`,
  `src/websocket/helpers/ahp/agentWork.ts`, `src/websocket/helpers/ahp/helpers.ts`,
  `src/websocket/helpers/host/helpers.ts`, `src/websocket/helpers/connection.ts`
  (dispatcher error mapping), `src/sessions/createSession/helpers.ts`,
  `src/sessions/helpers/factory/helpers.ts` (dispose ordering),
  `src/agents/helpers/directory.ts`, `src/agents/helpers/authenticator.ts`,
  `src/persistence/helpers/workItems.ts`, `src/persistence/helpers/agentRegistrations.ts`,
  `src/persistence/helpers/pool.ts`, `src/persistence/types.ts`, `src/agents/types.ts`,
  `src/sessions/types.ts` (`sessionUriSchema`), `src/websocket/helpers/ahp/types.ts`
  (`channelParamsSchema`), `src/websocket/helpers/ahp/constants.ts`.
- Tests: `src/tests/websocket/agentWork.disposal.test.ts` (new, 310 lines),
  new/updated cases in `src/tests/work/workService.test.ts`,
  `src/tests/websocket/agentWork.test.ts`, `src/tests/agents/authenticator.test.ts`,
  `src/tests/agents/fixtures.ts`, `src/tests/agents/directory.test.ts`.
- Docs/SQL: `database/migrations/0001_session_tool_baseline.sql`,
  `database/migrations/0002_agent_work.sql`,
  `database/M2_AGENT_WORK_DATABASE_SCHEMA.md`, `database/session-tables.md`,
  `docs/architecture/agent-task-lifecycle.md`, `src/work/README.md`,
  `src/agents/README.md`, plus round-01 contract inputs
  `docs/plans/agent tasks and identity/IMPLEMENTATION_LEDGER.md` and module READMEs.
- No source, test, doc (other than this report), package, or SQL file was edited;
  no SQL applied; no `pnpm validate`; no build (build writes `dist/`, treated as
  mutating and skipped).

## Commands run (exact, in the repository root)

| Command | Outcome |
| --- | --- |
| `git log -3 --oneline --decorate` / `git rev-parse HEAD` / `git status --short` | HEAD `27ff2bb` on `agentIdentity`; only untracked `docs/review/` |
| `git diff 7038a08a46321885f4a4c418f3f3cb5f7f87eb03..27ff2bb52dff889d3804f61b18e8c531efc78d39 --stat` and per-path `-- <path>` patches | 19 files, +723/−31; no frozen `types.ts` touched |
| `pnpm exec tsc --noEmit` | exit 0, no output |
| `pnpm test` (vitest run — the suite has no DB-dependent tests; persistence tests use in-memory fakes) | **40 files / 291 tests passed** |
| `pnpm run lint` (`eslint . --max-warnings 0`) | exit 0, no warnings |
| `pnpm run docs:check` (`vite-node scripts/check-docs.ts`) | pass, "95 source files mapped" |

Note: the triage's post-fix claim "291 tests (281 + 10 new)" matches my run (291).

## Findings

Labels: each finding has status/evidence/impact/next action. Hypothetical-risk
labels are applied where the candidate does not itself establish the threat path.

### B2R2-P3-01 (new, code+tests) — same-principal mid-window recreate can lose its fresh owner binding when the parked disposal settles

- Status: open, P3 (hardening). Constructible race, not demonstrated by a test in
  the candidate; no cross-principal work-ownership gain results (work fails
  closed), so I keep it out of P2.
- Evidence:
  - `src/websocket/helpers/ahp/helpers.ts:378-384` — the create pre-check only
    rejects when `owner !== principal.subject`; a recreate by the *same* subject
    during the disposal park is allowed and completes:
    `factory.createSession` succeeds (the live record was already deleted by
    `src/sessions/helpers/factory/helpers.ts:203` `sessions.delete(...)` *before*
    `await record.backend.dispose()` at line 213) and
    `options?.sessionOwners?.bind(...)` rebinds the subject.
  - `src/websocket/helpers/ahp/helpers.ts:409-416` — the dispose handler's
    `finally { options?.sessionOwners?.unbind(parsed.channel); }` runs after the
    backend settles, unconditionally deleting the map entry — including the
    binding the recreate just installed.
  - Reachable with the same bearer token on two connections (C1 disposes, C2
    recreates while the gated backend dispose is parked), or with a host-API
    `handle.sessions.disposeSession` (`src/websocket/helpers/host/helpers.ts:158-175`,
    same `finally`) racing a wire `createSession`. Per-connection frames are
    serialized (`src/websocket/helpers/connection.ts:278-285`, `pumpFrames`),
    so a single connection cannot trigger it.
- Impact: the recreated live session is left with no owner binding until the
  next bind. In that state every work mutation fails closed
  (`src/work/helpers/helpers.ts:219-223`: `boundOwner === undefined` →
  `not_found`; no privilege escalation), but the dispose owner pre-check
  (`src/websocket/helpers/ahp/helpers.ts:400-404) only acts *when a binding
  exists*, so any principal can dispose that live recreated session. The state
  is recoverable (a later dispose+recreate rebinds).
- Next action (owner call): differentiate the release at removal — e.g., capture
  the binding identity when dispose starts and only unbind that identity, or
  have a recreate that lands during a parked disposal re-bind after the settle.
  Add a same-principal recreate race test mirroring
  `agentWork.disposal.test.ts` test 1.

### B2R2-P3-02 (new, code path + docs precision) — reconciliation cancel is best-effort, but the changed docs state it unconditionally

- Status: open, P3 (docs truth / residual behavior).
- Evidence:
  - `src/work/helpers/helpers.ts:251-258` —
    ```ts
    try {
      await options.repository.cancel({ workId: result.id, principalSubject: principal.subject });
    } catch {
      // The ownership problem outranks a reconciliation failure.
    }
    throw new WorkError("conflict", "The live session changed while the submission was recorded.");
    ```
    a failed cancel is swallowed.
  - `database/M2_AGENT_WORK_DATABASE_SCHEMA.md:216-218`: "…reconciled, not
    orphaned: the work service **cancels** the row and reports a conflict…"
    (unconditional).
  - `docs/architecture/agent-task-lifecycle.md:125-127`: "…a submission that
    settles after its live session was disposed … **is cancelled** and reported
    as a conflict rather than kept." (unconditional).
- Impact: if the repository commit succeeds and the cancel then fails (e.g. a
  transient DB fault between COMMIT and cancel), a queued row lands for a
  disposed live session. `hasDependentWork`
  (`src/persistence/helpers/workItems.ts:389-395`) then returns true for that
  URI forever, so *disposal of a future session recreated under the same URI is
  blocked with `conflict`* (`agentWork.disposal.test.ts:293-309` pins the
  block-on-dependent-work behavior). The owner cannot discover the stranded
  `workId`: `work.get`/`work.cancel` are both `workId`-addressed and no list
  endpoint exists, so owner-side `cancel` is not actually available as a
  recovery path for this specific row (the M2 doc's general "owner cancel"
  note applies only to rows whose id is known).
- Next action: reword both doc sentences as "best effort: the service cancels
  the row and reports a conflict; if the cancel itself fails the row remains and
  blocks future disposal of the same URI until resolved operationally". Consider
  a session-scoped list/get for diagnostics in a later slice.

### B2R2-P3-03 (new, docs accuracy) — agents README misdescribes the renewal/staleness mechanism

- Status: open, P3 (docs truth).
- Evidence:
  - `src/agents/README.md:58-62`: "The **renewal path consults an in-process
    registration cache** refreshed by `register`/`getRegistration`. …presence
    may keep renewing from the cached record **until a refresh or restart**."
  - `src/agents/helpers/directory.ts:140-160` — `renewPresence` reads only the
    binding map and the clock; it consults neither `registrationCache` nor the
    repository. The cache is consulted by `bindPresence` (directory.ts:99-105),
    reachable via `register` (which refreshes the cache first, line 86-92).
    Consequence: a cache refresh does **not** stop renewals of an unexpired
    binding; only expiration, connection close, or a process restart does.
  - The second half of the bullet ("Every work mutation re-reads the
    registration, so claims and completions still fail closed") **is**
    accurate: `src/work/helpers/helpers.ts:152-161` (`enabledAgent`) calls
    `options.registrations.getById` on every claim/renew/complete/fail.
- Impact: the stated mechanism is wrong even though the security conclusion
  (renewal is not re-authorized against `enabled`) is directionally conveyed.
  This bullet is itself the deliverable of the A1-F5/B1-P3-02/B2-P3-04
  documentation row, so it should state the mechanism correctly.
- Next action: reword to "the renewal path does not re-read the registration at
  all (`renewPresence` is binding-local); it keeps renewing until expiry or
  connection close regardless of an `enabled` flip. Work mutations re-read the
  registration from the repository."

### B2R2-P3-04 (new, docs structure) — `src/work/README.md` now has a duplicated "## Caveats" section

- Status: open, P3 (docs quality).
- Evidence: `src/work/README.md` contains two `## Caveats` headings — the new
  detailed one at lines 72-90 (added by this commit; includes "Reconcile per
  claim" and "Reserving `\"exhausted\"`") and the old one at lines 100-109 with
  four verbatim-repeated bullets. The commit inserted the new section without
  removing/merging the old one.
- Impact: purely editorial; content of the two blocks is consistent. But the
  duplication is itself the kind of drift the docs gate cannot catch.
- Next action: merge into one Caveats section.

### B2R2-P3-05 (regression-cleanliness note, code) — dead wire constant with a stale comment

- Status: open, P3 (cleanup).
- Evidence: `src/websocket/helpers/ahp/constants.ts:81-82` still exports
  `MAX_AGENT_WORK_PAYLOAD_BYTES = 1_048_576` with the comment "Cap on one
  agent/work extension JSON payload (submission input or result)" — but this
  commit removed its only consumer; `agentWork.ts` now bounds input with
  `WORK_MAX_INPUT_BYTES` (64 KiB) and result with `WORK_MAX_RESULT_BYTES`
  (256 KiB) (`src/websocket/helpers/ahp/agentWork.ts:8,74,85`). No importer
  remains (repository-wide grep).
- Impact: a reader of constants.ts is told the cap is 1 MiB, contradicting the
  tightened bounds. No behavior effect (lint passes; unused exports are not
  flagged).
- Next action: delete the constant or update its comment to point at the shared
  `@work` constants.

### B2R2-P3-N (notes, no action required in this round)

- `docs/architecture/agent-task-lifecycle.md:27` changed the Mermaid note text
  from `push;` to `push#59;` — `#59;` is Mermaid's numeric entity escape for a
  semicolon inside diagram labels, so it renders identically. Truth-neutral.
  Verified render-equivalent, no finding.
- Register pre-check reads, not writes: the triage row for A1-F4 says the
  pre-check returns Conflict "before any repository call"; precisely, it
  performs one repository **read** (`agents.getRegistration` →
  `registrations.getById`, `src/agents/helpers/directory.ts:191-198`) before the
  write. No durable row is created (pinned by
  `agentWork.test.ts:313-336`, `registerCalls` length 1). Loose triage wording,
  accurate commit intent.
- The pre-check's `getById` sits *outside* the handler's `try` that maps via
  `mapAgentError` (`agentWork.ts:294-302` vs 303-321). A raw
  `RepositoryError` escaping there is converted by the transport's generic
  catch to `InternalError` (`src/websocket/helpers/connection.ts:132-139,
  177-180`). `getById` can only fail with the `database` code in the wiring
  (agent IDs are repository-issued UUIDs), whose mapped outcome is the same
  `InternalError` — no observable divergence today; noting for completeness.
- The exponential-early-`break` in the digest loop
  (`src/agents/helpers/authenticator.ts:71-76`) reveals only *which configured
  token matched*, which the authenticating caller learns anyway as the returned
  subject. The doc claim "reveals nothing about shared prefixes or lengths"
  (`authenticator.ts:40-43`) is accurate: all comparisons are full-length
  32-byte `timingSafeEqual` over SHA-256 digests.

## Per-triage-row fix verification ledger

Verified against commit `27ff2bb` (not the triage's description alone).

| Triage row (source) | Claimed | Verification | Result |
| --- | --- | --- | --- |
| A1-F1 stale owner binding after failed disposal | Fixed | Create pre-check fails closed before live state: `ahp/helpers.ts:375-385` (reads `options.sessionOwners.owner(parsed.data.channel)` **before** `factory.createSession`, throws `InvalidParams "Session not found"`); typed bind conflict: `src/work/helpers/helpers.ts:191-197` raises `WorkError("conflict")`, mapped to `AhpErrorCodes.Conflict` via `mapWorkError` (`agentWork.ts:190-191`); authoritative release: `ahp/helpers.ts:409-416` `finally { unbind }` and mirrored at `host/helpers.ts:166-174`. Ordering proof that finally-unbind is correct on backend failure: `sessions/helpers/factory/helpers.ts:203` deletes the live record *before* `await record.backend.dispose()` (213), so a failing backend dispose always leaves the record already gone — the unbind is the correct removal-point action. Tests: `agentWork.disposal.test.ts:196-255` pins binding release on failed disposal (`InternalError` rejection), recreate-by-bob binding bob, alice's submit rejected `unauthorized` (`helpers.ts:222-223`), and no phantom durable entry. | **Verified complete** (F1 hazard closed; residual same-principal recreate gap filed separately as B2R2-P3-01) |
| A1-F2 recreate between record delete and unbind → ownerless zombie | Fixed | Mid-window recreates by a *different* principal are rejected fail-closed while the binding persists: same pre-check + tests (`agentWork.disposal.test.ts:222-231` and 276-282: bob's create rejected with `InvalidParams` both on failed and successful settle; binding present at 220, undefined only after settle at 235/287); rebind verified at 238-239 and 289-290. Binding released exactly once: `unbind` is `Map.delete` (`helpers.ts:201-203`) — idempotent, no double-release semantics. | **Verified complete for cross-principal recreates**; same-principal recreate window open (B2R2-P3-01) |
| A1-F3 / A2-05 / B1-P3-04 submit-vs-dispose TOCTOU | Fixed | Post-write re-verification: `src/work/helpers/helpers.ts:242-260` re-reads `options.sessions.owner(...)` and `options.describeSession(...)` after the repository write resolves; vanished/replaced owner ⇒ best-effort cancel (swallowed failure, see B2R2-P3-02) then `WorkError("conflict")`, which propagates through the outer catch because `mapRepositoryFailure` rethrows non-`PersistenceError` values (helpers.ts:102). Wiring fact check: in the host wiring `describeSession` collapses to `undefined` when the *owner binding* is gone (`host/helpers.ts:85-94`), so the re-check is soundly fail-closed. Cancel semantics verified against `workItems.ts:310-348`: queued or leased rows are cancelable by the durable-session owner; terminal rows return their status. Tests: `workService.test.ts:235-260` (conflict + exact cancel args); docs update: lifecycle:125-127, M2:216-218 (wording overstated — B2R2-P3-02). | **Verified complete in code**; docs precision P3 filed |
| A1-F4 register pollutes durable rows behind connection conflict | Fixed | Pre-check before any durable *write*: `agentWork.ts:290-302` — if the connection holds a live binding whose registration is missing, foreign, or keyed differently, `conflict()` fires before `agents.register` (one `getById` read occurs; see note above). Own-key re-register stays allowed and idempotent on one stable row: test `agentWork.test.ts:313-336` (records.size stays 1 across two register calls; same `agentId`); repository upsert (`agentRegistrations.ts:31-51`) is an `ON CONFLICT (principal_subject, agent_key) DO UPDATE` with no growth path. | **Verified complete** |
| A1-F5 / B1-P3-02 / B2-P3-04 presence renewal cache staleness | Documented, code deferred | `src/agents/README.md:58-62` exists (cache boundary + no-disable-path caveat + work-mutation re-read claim). Deferred claim matches code: no disable path exists in this slice (`enabled` only flips via repository; nothing invalidates `registrationCache` except `getRegistration` itself, `directory.ts:191-198`). | **Verified as documentation**, but the bullet's mechanism sentence is factually wrong (B2R2-P3-03) — docs-truth fix owed for this row |
| A1-F6 whitespace-only `requestKey`/`kind` at service | Fixed | Mirror of DDL `length(trim(...))` CHECKs (`migrations/0002_agent_work.sql:37-38`): `helpers.ts:115-127` adds `trim().length === 0` checks to both fields; test `workService.test.ts:205-216` pins `"   "` request key and `" "` kind → `invalid`. | **Verified complete** |
| A2-01 NUL/unpaired surrogates → InternalError | Fixed | `isJsonbSafe`/`isJsonbSafeText` (`helpers.ts:34-66`) reject NUL, unpaired high surrogates, and unpaired low surrogates; applied at the service inside `boundedJsonBytes` (helpers.ts:78-80) and mirrored at both wire bounds via `isPayloadInvalid` (`agentWork.ts:62-67,91-97`). Error class: service `invalid` → `InvalidParams` (`agentWork.ts:184-189` mapWorkError), wire `ZodError` → `InvalidParams` (`connection.ts:132-134`). Tests: `workService.test.ts:219-233` (`"a\u0000b"`, `"\ud800"`), `agentWork.test.ts:286-298` (wire NUL). Minor note: the unpaired *low* surrogate branch is exercised only through the shared helper (no direct test). | **Verified complete** |
| A2-02 `target_agent_id` principality enforcement point | Documented | `M2_AGENT_WORK_DATABASE_SCHEMA.md:127`: "…enforced at write time by `WorkService.submit` (`src/work/helpers/helpers.ts`), not by the schema. Direct repository callers bypass the service check." — matches code (`helpers.ts:225-233`) and the absent cross-table DDL; operational orphan-remediation left as a policy decision (owner `cancel` remains the recovery path for rows whose id is known). | **Verified accurate** |
| A2-03 / B2-P3-01 whitespace-only `displayName` at wire | Fixed | `agentWork.ts:43-46` adds the trim refine (mirroring `0002_agent_work.sql:16` which trims, 1–200 — wire 1–128 is tighter); test `agentWork.test.ts:277-283` pins rejection with **zero** repository calls (`registerCalls` length 0, so no durable row either). | **Verified complete** |
| A2-04 `schema_migrations` never written | Fixed | `0001_session_tool_baseline.sql:8-11` creates the table first; insert at the end (lines 76-79); `0002_agent_work.sql:61-63` inserts its own version. Idempotency caveat only (re-run hits the PK on `version`), consistent with the "no runner yet" narrative in M2:203-204. Runtime application remains blocked (panel rule 7). | **Verified complete (scripts only; runtime gap unchanged)** |
| B1-P3-01 wire bounds + result shape | Fixed | Shared constants exported from `@work` (`src/work/index.ts:1-11`, `helpers.ts:21-23`) and consumed by the wire (`agentWork.ts:8,69-97`); `completeSchema.result` tightened to a bounded **record** object (`agentWork.ts:95-97`), mirroring the service's `isRecord` check (`helpers.ts:325-328`). Note the leftover dead 1 MiB constant (B2R2-P3-05). | **Verified complete** |
| B2-P3-02 timing-unsafe bearer comparison | Fixed | `src/agents/helpers/authenticator.ts:29-30` `digestToken` SHA-256; 69-76 `timingSafeEqual` per configured token. Mixed-case/repeated Authorization: `readAuthorization` (12-27) lowercases header names and rejects ambiguous or non-string values; `BEARER_CREDENTIAL = /^Bearer\s+(\S+)$/i` (line 10) rejects malformed input; empty/malformed → `undefined`; construction rejects empty tokens/subjects (49-53). No token logging anywhere in the module. Test: prefix discrimination (`authenticator.test.ts:47-62`: `token` and `token-extended` map to their owners, `token-extr` fails). See B2R2-P3-N for the (non-defect) scheduling nuance. | **Verified complete** |
| B2-P3-03 reconcile-per-claim overhead | Documented, deferred | `src/work/README.md:82-86` records it; implementation claim true: `claim` runs `repository.reconcileExpired()` before `repository.claim` (`helpers.ts:275-282`), and the claim CTE bounds expiry with `statement_timestamp()` (`workItems.ts:159-161`). | **Verified complete (documentation match)** |
| B2-P3-04 unbounded registration cache | Documented | Same README bullet as A1-F5 (`agents/README.md:58-62`); cache growth is real (`registrationCache` only grows via `register`/`getRegistration`, never bounded) and the deferred-with-disable-path rationale is recorded. Mechanism misdescription filed (B2R2-P3-03). | **Verified as documentation** |
| B1-P3-07 / B2-P3-05 dead `exhausted` producer | Reserved (documented) | No service code constructs `WorkError("exhausted")` (grep over `src/`); wire vocabulary still maps it (`agentWork.ts:192-194`); `src/work/README.md:87-90` says exactly that ("v1 service code never produces it; budget-exhausted leases terminalize to `failed`" — true: `reconcileExpired` marks rows `failed`, `workItems.ts:368-387`). | **Verified accurate** |
| B2-P3-06 failure `message` validated then dropped | Documented decision | `helpers.ts:346-362` validates the message (1–2,000) and passes only `retryable` to the repository; no column exists (`0002_agent_work.sql`). `src/work/README.md:66-69` states the discard exactly. | **Verified accurate** |
| B2-P3-07 `sessionUri` service bound | Fixed | `MAX_SESSION_URI_LENGTH = 2_048` (`helpers.ts:18`) enforced on submit (110-114) and claim (270-274), mirroring the wire (`sessionUriSchema.max(2_048)`, `agentWork.ts:107`; base schema `sessions/types.ts:23-28`). Test `workService.test.ts:197-204`. | **Verified complete** |
| B2-P3-08 fixture-vs-SQL `displayName` divergence | Fixed | `src/tests/agents/fixtures.ts:49-62` implements `displayName` replaced only when provided, `enabled` untouched — exactly `COALESCE(EXCLUDED.display_name, agent_registrations.display_name)` (`agentRegistrations.ts:36-39`); `directory.test.ts:28-38` updated to expect `"Renamed"` with a stable ID. | **Verified complete** |
| A1 doc drift (absolute disposal claim) | Updated | `agent-task-lifecycle.md:125-127` now states the check-time rule plus racing-submission reconciliation. Accurate modulo the unconditional-cancel wording (B2R2-P3-02). | **Verified, minor precision owed** |
| A2 doc drift (two authority narratives for `sessions`) | Updated | `database/session-tables.md:3-12` superseded banner: claims `0001` is the shipped schema with `owner_principal_subject`/`last_server_seq`/`durable_state` — verified true against `0001:56-69`; the exact proposed `title/status/lifecycle`, `action_sequence`, `session_active_clients` shapes exist nowhere in the migrations — verified true (the sequence now lives in `host_state`, lines 13-17); body correctly scoped "as the original proposal record". | **Verified accurate** |
| B1-P3-03 per-agent kind eligibility (plan LEASE-03) | Documented, deferred | `agent-task-lifecycle.md:181-183` ("host-global in V1 … deferred (a contract change, not a configuration task)") — matches `allowedKinds` usage (`helpers.ts:275-281` claim passes the one shared set). Not claimed as implemented. | **Verified accurate** |
| B1-P3-05 retention / never-delete | Documented, deferred | `agent-task-lifecycle.md:184-186`: "`work_items` rows and the durable `sessions` row they first landed are never deleted (live disposal only removes in-memory state)" — verified: nothing in the wiring calls `DurableSessionRepository.delete` (`src/persistence/helpers/sessions.ts:122` is exported but unwired), and `work_items.session_uri` is `ON DELETE RESTRICT` (`0002_agent_work.sql:21`). | **Verified accurate** |
| PostgreSQL runtime acceptance | Blocked (unchanged) | No SQL executed by me; no SQL was applied in this fix bundle; blocked evidence recorded unchanged in the code/READMEs I inspected. | **Verified unchanged** |

## Regressions / new defects

- **None at P1/P2.** All behavior deltas I could trace are the intended fix
  bundle semantics:
  - Fail-closed create/dispose pre-checks only alter outcomes that previously
    ended in a raw error, `SessionAlreadyExists`, or a worse hazard; unbound
    (never-owned) sessions keep the baseline dispose-any semantics, and the
    checks no-op entirely when the work extension is not configured
    (`options?.sessionOwners`, `options?.work?.`).
  - The wire payload tightening replaces a dead 1 MiB wire cap with the shared
    64/256 KiB constants; both remain *tighter than or equal to* the service
    defaults, so no accepted-by-wire/rejected-by-service envelope opened (if a
    host configures smaller service maxes, the service stays authoritative and
    the reply is `InvalidParams`, same error code vocabulary).
  - `displayName`/`sessionUri`/`requestKey`/`kind` trims and bounds match the
    DDL CHECKs exactly at the boundary the wire can reach.
  - The disposal `finally`-unbind cannot double-release (`Map.delete`), cannot
    deadlock (no lock is held across it; the added reconciliation cancel runs
    outside the submit transaction), and cannot strand a stale binding on the
    failure path (record-removal precedes backend dispose in
    `sessions/helpers/factory/helpers.ts:203,213-221`).
  - Register pre-check fails closed for every mismatched principal/key/missing
    registration case I could construct (`agentWork.ts:294-302`), including a
    connection whose binding belongs to another subject.
- New P3s found: B2R2-P3-01 (same-principal recreate binding wipe),
  B2R2-P3-02 (best-effort cancel vs unconditional docs), B2R2-P3-05 (dead
  constant), plus the docs items below.

## Documentation misunderstandings / inaccuracies

1. `src/work/README.md:66-69` and the duplicate Caveats block at 100-109 —
   duplicated section introduced by this commit (B2R2-P3-04).
2. `database/M2_AGENT_WORK_DATABASE_SCHEMA.md:216-218` and
   `docs/architecture/agent-task-lifecycle.md:126-127` — reconciliation
   described as unconditional, implemented best-effort (B2R2-P3-02).
3. `src/agents/README.md:58-62` — "renewal path consults an in-process
   registration cache… until a refresh or restart" contradicts
   `renewPresence` (`directory.ts:140-160`, reads neither cache nor repository)
   (B2R2-P3-03).
4. `src/websocket/helpers/ahp/constants.ts:81-82` — stale "Cap on one
   agent/work extension JSON payload" comment on a now-dead 1 MiB constant
   (B2R2-P3-05).

## Evidence gaps

- **Real-PostgreSQL runtime acceptance remains blocked** (panel rule 7; no SQL
  applied by anyone, including me). Not a code failure. Owed probes when a
  database is approved: concurrent `SKIP LOCKED` claim race, replay/conflict
  (melting `ON CONFLICT` behavior), CHECK lease-shape, `\u0000` payload probe
  against real JSONB, disabled-target remediation, and — added by this
  re-review — the racing-submit reconciliation against a real backend
  (including the cancel-failure branch, which has no test at any layer,
  `docker/postgres` or otherwise).
- No test covers a *failing* reconciliation cancel (`helpers.ts:256-258`
  swallow path), a reconciliation where the binding changed to a *different*
  subject (only the unbind case is tested), or a same-principal
  recreate-during-parked-disposal race (B2R2-P3-01).
- `pnpm run build` and `pnpm validate` were not run (mutating / combined gate
  respectively, per this round's constraints); `tsc`, full non-DB Vitest, lint,
  and docs:check all pass individually, matching the pre-fix
  `IMPLEMENTATION_LEDGER` execution gates.

## Verdict

**PASS.**

Rationale: every row of the round-01 fix bundle is genuinely present in commit
`27ff2bb` and is pinned by named regression tests; the two reproduced round-01
P2 hazards (cross-principal work ownership after failed disposal; ownerless
zombie after a mid-window recreate by a different principal) are closed by
code that I re-derived end-to-end (pre-check → factory ordering → `finally`
release → typed conflict mapping), and the fix's preconditions were re-checked
against the dispose implementation it relies on. The two P2s and all P3 fix
rows verify complete; the deferred/reserved rows are documented accurately
except for three small docs-precision defects (best-effort cancel wording,
renewal-cache mechanism, duplicated README section) and one dead constant —
all filed here as P3 with concrete next actions. The residual same-principal
recreate binding-wipe race is a bounded hardening gap (work fails closed; no
cross-principal work ownership; state recoverable), labeled accordingly. No
blocking defect, contract violation, or dangerous regression to the baseline
AHP/session/tool/SDK surface was found. TypeScript, the full non-DB test suite
(291/291), lint, and the docs gate all pass on the candidate tree; real-SQL
acceptance stays blocked as a recorded evidence gap, not a code failure.

Report: docs/review/round-02-b2.md — Verdict: PASS
