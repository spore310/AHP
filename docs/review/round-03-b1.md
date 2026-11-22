# Round 03 — Reviewer B1

- **Reviewer:** B1 (side B, blind/re-view role)
- **Independence / blindness:** This report was written without reading any other
  side-B review: I did not open `docs/review/round-02-b1.md`,
  `docs/review/round-02-b2.md`, any earlier round-01 side-B file, or any
  `round-03-*.md` file other than this one. My only panel inputs were
  `docs/review/00-panel.md` (rules) and `docs/review/round-02-triage.md` (the
  candidate's fix list), used strictly as a checklist to verify against the
  source tree. Every claim below is grounded in the diff, the source, the
  tests, or runs I executed in this session. An incidental `grep` over the
  repo did surface filenames/matching lines from the excluded review files as
  tool output; no evidence in this report derives from those files' content.
- **Read-only:** I made no source, test, doc, or package edits; no dependencies
  installed; no SQL or migrations executed; no commits.

## Candidate

- Commit `d3c33d1` ("fix: close the settling-window recreate and finish the
  storage-shape gate"), branch `agentIdentity`, HEAD at review time.
- Supersession chain: `7038a08` (round-01 candidate) → `27ff2bb` (round-02
  fix bundle, triage's reviewed candidate) → `d3c33d1` (this candidate).
- **Base diff reviewed:** `git diff 27ff2bb..d3c33d1` — 19 files,
  +363/−94.

### Commands run

- `git log -4 --oneline --decorate`
- `git status --short` (untracked `docs/review/` only; clean otherwise)
- `git show d3c33d1 --no-patch --format=fuller`
- `git diff 27ff2bb..d3c33d1 --stat` and per-path diffs for all 19 files
  (code: `src/persistence/helpers/text.ts`,
  `src/agents/helpers/directory.ts`, `src/work/helpers/helpers.ts`,
  `src/websocket/helpers/ahp/{helpers,agentWork,constants}.ts`,
  `src/websocket/helpers/host/helpers.ts`; tests: `directory.test.ts`,
  `agentWork.disposal.test.ts`, `agentWork.test.ts`, `workService.test.ts`;
  docs: `src/{agents,persistence,websocket,work}/README.md`,
  `database/{M2_AGENT_WORK_DATABASE_SCHEMA,migrations/README,session-tables}.md`,
  `docs/architecture/agent-task-lifecycle.md`)
- Full-file reads of the changed files' current state plus context:
  `src/sessions/helpers/factory/helpers.ts` (create/dispose semantics),
  `src/sessions/types.ts` (`sessionUriSchema`, `SessionSnapshot`),
  `src/agents/helpers/directory.ts`, `src/persistence/helpers/{workItems,sessions}.ts`,
  `src/persistence/types.ts`, `database/migrations/000{1,2}_*.sql`
- Focused greps: `MAX_AGENT_WORK_PAYLOAD_BYTES`, `schema_migrations`,
  `renewPresence`/cache usage, durable-session `delete` callers,
  `HOST_SESSIONS_SETTLING` in tests
- Validation (this session, on the candidate tree, no SQL touched):
  - `pnpm run test` → **40 files / 298 tests, all passed** (matches the commit
    message and triage's +7 over 291)
  - `pnpm run typecheck` → clean
  - `pnpm run lint --max-warnings 0` → clean
  - `pnpm run docs:check` → "Documentation gate passed: 96 source files"
  - `pnpm run build` → passed (86 modules, dist emitted)

## Per-finding ledger (triage rows → candidate evidence)

### L1 — Reproduced P2: owner's own recreate in the settling window stripped at settle

**Status: closed.**

- `src/websocket/helpers/ahp/helpers.ts:378-401` (createSession): the pre-check
  previously denied only `owner !== principal.subject`. It now denies **every**
  create while an owner binding exists without a live record — the third
  disjunct `factory.getSessionSnapshot(parsed.data.channel) === undefined`
  closes the window to the bound owner as well (`"Session not found"` /
  InvalidParams, unchanged wire shape).
- `src/websocket/helpers/host/helpers.ts:146-160`: the host facade's
  `hostedSessions.createSession` mirrors the predicate
  (`sessionOwners.owner(channel) !== undefined && sessions.getSessionSnapshot(channel) === undefined`
  → reject `HOST_SESSIONS_SETTLING`), so a backend-path create cannot enter the
  window either.
- Mechanism verified end to end: disposal deletes the registry record
  synchronously then awaits backend disposal
  (`src/sessions/helpers/factory/helpers.ts:194-222`), and the settle unbind is
  unconditional in `finally` (`ahp/helpers.ts:416-424`; facade
  `host/helpers.ts:176-184`). With no create able to enter the window, the
  unconditional unbind cannot strip a recreate's binding.
- Regression: `src/tests/websocket/agentWork.disposal.test.ts:293-330`
  ("denies the owner's own recreate inside the settling window") — real AHP
  binding + real sessions factory + gated backend disposal; asserts the
  in-window denial (even for the bound owner), release exactly at
  `gated.settle()`, owner undefined, then a post-settle recreate binding its
  true creator. The pre-existing "another principal's recreate during settle
  lands the creator" test covers the cross-principal post-settle rebind.
- Leftover (hypothetical, not test-reproducible): a create whose pre-check
  passed while the record was still live can complete (re-register + bind)
  during the disposal's backend-await and be stripped by the settle unbind.
  See finding R1 below; it is the same class the triage deferred (no stable
  session-identity field), and it is not reachable through any test in the
  candidate.

### L2 — P3 cluster: shared text predicates + object keys + scalar carriers + durable projection

**Status: closed** (with two documented-scope observations, D-notes below).

- Single source: `src/persistence/helpers/text.ts` (new, 53 lines) —
  `isJsonbSafeText` (text.ts:14; NUL and unpaired-surrogate rejection, correct
  pairing scan with `index += 1` on a matched pair; lone low surrogate and
  trailing high surrogate fail) and `isJsonbSafe` (text.ts:40) which recurses
  **`Object.entries`** (text.ts:50) checking keys and values, arrays, and
  passes non-JSON-shaped leaves. `src/work/helpers/helpers.ts:30-31` re-exports
  `isJsonbSafe` so wire imports keep compiling — no duplicate predicate left in
  the work module.
- Scalar carriers:
  - Service: `assertSubmission` gates `sessionUri` and `requestKey`
    (`src/work/helpers/helpers.ts:75-87`); `claim` gates `sessionUri`
    (`:255-260`) — typed `invalid` failures.
  - Directory: `register` refuses unstorable `agentKey`/`displayName` **before
    any repository work** (`src/agents/helpers/directory.ts:87-92`), typed
    `AgentDirectoryError("invalid")`, which maps to a sanitized invalid wire
    error (`agentWork.ts:214-225`).
  - Wire: `agentKey`/`displayName`/`requestKey` refines
    (`src/websocket/helpers/ahp/agentWork.ts:40-58`) and
    `boundedSessionUri` (`:115-118`) shared by `submitSchema` (:122) and
    `claimSchema` (:131).
- Durable projection: `WorkService.submit` gates `live.durableState` with the
  same predicate before the repository write
  (`src/work/helpers/helpers.ts:192-196`, "The session projection cannot be
  stored as JSON."), preventing the round-02 poisoning of every later submit
  for that session.
- Regressions, verified by reading:
  - `src/tests/work/workService.test.ts` — NUL `sessionUri` and NUL
    `requestKey` at submit with exact messages; NUL session URI at claim; the
    unsafe-projection refusal (fake `describeSession` returning
    `workingDirectories: ["a\u0000b"]`).
  - `src/tests/websocket/agentWork.test.ts` — wire NUL `agentKey` (ZodError,
    zero `registerCalls`) and wire NUL `sessionUri` in submit (ZodError, zero
    `work.calls`).
  - `src/tests/agents/directory.test.ts` — NUL `agentKey`, NUL `displayName`,
    `registerCalls` stays 0.
- Predicate soundness: `isJsonbSafe` handles `undefined`/scalars as safe, maps
  any `Array.isArray` branch first, and object keys are checked with the same
  text predicate — closes the round-02 `"a\u0000b"`-as-object-key hole.

**Observations (not defects):** (a) `kind` is deliberately not text-gated at
the wire (`workKind`, `agentWork.ts:59-62`) — the allow-list is the primary
gate and the work README now states exactly that; a NUL kind is only possible
if the operator's `allowedKinds` config contains one, which is not client
input. (b) `failureMessage` (fail path, wire max 512) is validated then dropped
(no failure-message column), so no SQL text-encoding surface. Both are
consistent with the README and triage; no action required for closure.

### L3 — P3: terminal-key replay after a reconciled cancel

**Status: closed.**

- `src/work/helpers/helpers.ts:233-245`: on a replay (`!result.created`, which
  post-reconcile only happens after the ownership checks pass), the service
  reads the landed row with the principal-bound get
  (`repository.get({ workId, principalSubject: principal.subject })`) and
  refuses `cancelled`/`failed` with a typed
  `WorkError("conflict", "That request key is already terminal.")`. The
  `WorkError` survives the local catch because `mapRepositoryFailure`
  re-throws non-`RepositoryError` errors as-is
  (`src/work/helpers/helpers.ts:54-68`, line 67), so the wire mapping is the
  typed conflict, not an unclassified failure.
- Non-terminal replays (`queued`/`leased`/`completed`) keep the idempotency
  contract: still `{ id }` success (`:246`).
- Frozen contracts untouched: `WorkRepository.get`
  (`src/persistence/types.ts:131-134`) and its SQL join against
  `sessions.owner_principal_subject` (`src/persistence/helpers/workItems.ts:350-366`)
  pre-existed (the service's `get` view already used it) — the fix is
  service-level only, matching the triage.
- Regressions:
  - `src/tests/work/workService.test.ts` "refuses a replayed request key whose
    landed row is terminal" — pinned for `cancelled` and `failed`, asserts
    `get` was called with the principal-bound argument, and no extra cancel.
  - "keeps idempotent replay success for a non-terminal landed row" — `get`
    called once, `{ id }` returned.
- Semantics note: legacy replays that previously returned false success for
  terminal rows now get a typed conflict. That is the intended closure (a
  reconciled-away or owner-cancelled row can never be claimed again); clients
  must mint a new request key, which the triage records as the contract.

### L4 — P3: same-owner recreate during a submission write — documented residual

**Status: closed as documented (deferred fix).**

- `src/work/README.md` carries the "Same-owner recreate residual" caveat
  matching code facts I verified independently:
  `SessionSnapshot` exposes only `{ resource, state, fromSeq }`
  (`src/sessions/types.ts:191-194` — no identity/generation field), and the
  host `describeSession` synthesizes `createdAt` from fetch time
  (`src/websocket/helpers/host/helpers.ts:41-47`).
- `database/M2_AGENT_WORK_DATABASE_SCHEMA.md:214-221` now says best-effort
  cancel plus the same fusion of owner+ liveness residual. Accurate against
  `helpers.ts:214-232` (cancel swallowed in `catch`, conflict thrown).

### L5 — Documentation regressions of round-01

**Status: closed** (two precision nits filed as D1/D2 below).

1. Work README: single `## Caveats` restored (the old duplicated section is
   gone in the diff); the two previously added caveats were kept and moved into
   the merged section; a Testing table was added above Caveats and pins the new
   cases (unstorable text including terminal-key replays). Verified across the
   diff.
2. Agents README: rewritten mechanism note — bind path consults the
   registration cache (`directory.ts:101-106`, `cachedRegistration`), renewals
   consult neither cache nor repository (`directory.ts:147+` reads `byAgent`
   only); work mutations re-read via `enabledAgent`
   (`src/work/helpers/helpers.ts:119-128`); bounded-growth note is consistent
   with the connection-level bind-conflict pre-refusal before the durable
   write (`agentWork.ts:301-313`) and the idempotent
   `(principal, agent_key)` registration (SQL `UNIQUE (principal_subject, agent_key)`).
3. `database/session-tables.md`: `owner_principal_subject` matches the shipped
   SQL/mermaid (M2 line 49); "superseded by those shipped migrations and never
   implemented as specified" removes the round-01 self-contradiction; the new
   banner sentence correctly flags in-body lifecycle statements as
   proposal-only, and I verified "shipped behavior keeps durable rows" — the
   durable-session `delete` (`src/persistence/helpers/sessions.ts:122-136`)
   has **no production caller**, so rows persist with retention deferred.
4. `docs/architecture/agent-task-lifecycle.md:27`: literal `;` restored in the
   sequence-note line (entity corruption gone).
5. M2 reconciliation bullet: now best-effort + residual — accurate (see L4).
6. `src/persistence/README.md`: the new `helpers/text.ts` row exists and the
   docs gate passes with 96 files.

## New findings (this bundle)

No P1 or P2 found. The following are P3 items with evidence.

### R1 — P3 — hypothetical — settle-strip via an in-flight create: label — not reproducible from tests

**Where:** `src/websocket/helpers/ahp/helpers.ts:378-401` (create) interleaved
with `disposeSession` (`:403-425`) and the settle unbind (`:418-423`).

**Observed code path:** a create that passes the pre-check **while the record
is live** can still complete during a concurrently starting disposal of the
same channel: disposal's owner check passes (same principal), the record is
deleted and the backend await parks, the create's provider then resolves and
re-registers a live record, the create handler binds, and the disposal's
`finally` unbind then strips that binding — a live, ownerless record any
principal's next create could seize.

**Expected vs observed:** the settling-window closure is airtight only for
creates that *enter* after the record is gone; a create that entered while the
record was live is not ordered against the settle unbind.

**Why hypothetical:** it requires the owner to race dispose against recreate on
the same channel and the create's provider/backend completion to land strictly
inside the dispose's backend await; no test in the candidate exercises that
interleave, and neither a fail-closed nor an ownerless outcome is deterministically
reachable through an obvious command sequence. Impact class is the reproduced
round-02 bug, but the trigger is narrower. The triage's deferred lever (a
stable session-identity field on `SessionSnapshot`) covers it; a cheaper
in-place lever would be a conditional settle unbind (skip when a snapshot
re-appeared between record deletion and settle, without touching the
must-unbind-on-failure semantics).

**Status / next action:** open, `P3` (hypothetical hardening). Reuse this
disposal test rig with a second gate on the provider's `startSession` to pin it,
or record it beside the "Same-owner recreate residual" caveat so the deferred
contract change covers both shapes.

### R2 — P3 — the host facade's settling mirror is untested and hand-duplicated

**Where:** `src/websocket/helpers/host/helpers.ts:150-158`
(`HOST_SESSIONS_SETTLING` branch).

**Expected vs observed:** the same predicate is written twice — raw
`sessionOwners`/`sessions` reads in the facade vs `options.sessionOwners` /
`factory` reads in the AHP handler — with no test that drives
`createAHPServer(...).sessions.createSession` during a settle. A future drift
in one copy silently reopens the window for one of the two entry paths.

**Status / next action:** open, `P3`. Either add a facade-level test (the
disposal rig's gated provider composes with `createAHPServer` easily), or
extract the shared predicate so both call sites stay single-sourced.

### R3 — P3 — docs precision: migrations README names the wrong first re-apply failure

**Where:** `database/migrations/README.md:33-37`.

**Observed:** "each script is single-shot, and re-applying fails on the
duplicate version key rather than silently re-running statements." The
substance (no idempotent re-apply; no silent re-run) is correct, but re-applying
`0001`/`0002` fails **first** at the non-`IF NOT EXISTS` `CREATE TABLE`
(`host_state` / `agent_registrations`), before the version INSERT; the
duplicate-key failure is real but not the first failure mode.

**Status / next action:** open, `P3`. Reword to "re-applying fails (on the
first duplicate object or the version key) rather than silently re-running
statements."

### R4 — P3 — docs cross-reference overclaim: session-tables banner defers "retention" to the M2 doc

**Where:** `database/session-tables.md` banner
("(see the M2 document)").

**Observed:** the M2 document contains no statement about retention or delete
deferral for durable session rows (verified by search); the deferral statement
lives only in the session-tables banner sentence itself.

**Status / next action:** open, `P3`. Point the retention sentence at itself or
add one line to M2's durable-section.

### R5 — P3 — pre-existing (not introduced here), documented on the record: wire request-key cap is 128, README says 256

**Where:** `agentWork.ts:53-58` (`max(128)`) vs
`src/work/helpers/helpers.ts:16` (`MAX_REQUEST_KEY_LENGTH = 256`) and
`src/work/README.md` Bounded-input ("the request key at 256").

**Observed:** a client sizing a request key by the README (e.g. 200 chars)
receives wire rejection at 128 before the service bound is ever tested. The
diff only added the text refine; both caps pre-date this bundle.

**Status / next action:** open, `P3`, pre-existing. Align the README sentence
("256 at the service, 128 on the wire") or widen the wire cap to the service
bound.

### Non-issues I checked for and cleared

- **New reject-after-success paths:** the terminal-replay refusal happens
  before the submit reply is emitted (`helpers.ts:236-246`, inside the same
  try before `return { id }`), and the swallowed-cancel reconcile path already
  existed pre-diff — the new test only pins it. The `!result.created` get adds
  a new failure mode (repository `database` error → typed unavailability), a
  rare-path trade-off consistent with the design, seen in `mapRepositoryFailure`.
- **Blocked/lost work from the window closure:** during settle, creates are
  refused by design; after settle they proceed and rebind (pinned by test).
  Claim/cancel/complete are untouched by the window.
- **New state changes from newly denied requests:** denies are thrown before
  `factory.createSession`, so no partial state; the facade mirror likewise
  rejects before `sessions.createSession`.
- **Replay id-leak (pre-existing, bounded):** request-key idempotency is
  `(session_uri, request_key)` (`workItems.ts:87`), so a foreign-owned row's id
  could surface as `{ id }` only if the durable session owner diverges from the
  registry while the caller passes the service's ownership check; `get` then
  returns `null` (owner join) and no view data leaks. Pre-existing, narrow, out
  of this bundle's scope.
- **Dead constant:** `MAX_AGENT_WORK_PAYLOAD_BYTES` — removal is complete; only
  historical mentions remain, all inside `docs/review/`.
- **Predicate regressions in the shared module:** the moved predicates are
  byte-for-byte equivalent to the round-02 service copies, plus the object-key
  extension; no third copy remains (`grep` finds the predicate only in
  `text.ts`, the two importers, and the shim export).
- **Owner-bounding on `submit`:** the durableState gate runs after the two
  ownership checks and before target-agent resolution — a denial cannot be
  used to probe foreign agents, and no repository write precedes it.

## Documentation accuracy checks (explicit)

| Claim changed | Verified against | Verdict |
| --- | --- | --- |
| Work README text-gate scope (values + keys, scalars, durable projection, directory gate) | `text.ts`, `helpers.ts:75-96,192-196,255-260`, `directory.ts:87-92`, `agentWork.ts:40-58,115-118` | Accurate; "kind: allow-list is the primary char-set gate" matches code |
| Work README caveats ("one owner authority", "same-owner recreate residual") | `host/helpers.ts:85-95` (owner synthesized from the same registry), `SessionSnapshot` shape | Accurate |
| Work README testing rows (unstorable text, terminal replays, disposal races incl. owner + cross-principal) | new/updated tests in `workService.test.ts`, `agentWork.disposal.test.ts` | Accurate |
| Agents README (bind-path cache; renewals consult neither; disable-path closure via work-mutation re-reads; bounded growth) | `directory.ts:70-79,101-176`, `agentWork.ts:301-313`, `helpers.ts:119-128`, SQL `UNIQUE` | Accurate |
| Persistence README `helpers/text.ts` row | file contents | Accurate |
| WebSocket README host-disposal wording ("releases the owner binding when the record removal settles — success or failure") | `host/helpers.ts:176-184`, `ahp/helpers.ts:416-424` | Accurate |
| session-tables banner (column name, de-contradiction, proposal-only lifecycle statements, rows kept) | M2 mermaid :49, SQL schema, no production caller of durable delete | Accurate except R4 cross-reference nit |
| Lifecycle doc (`;` restored; best-effort cancel; failed cancel blocks disposal) | code (`helpers.ts:223-231`, `hasDependentWork`/`assertSessionDisposable`), diff line 27 | Accurate |
| M2 reconciliation bullet (best-effort card; residual) | `helpers.ts:214-232` | Accurate |
| Migrations README (eight tables; single-shot version rows) | `0001:8-11,79`, `0002:63`, SQL column/default | Accurate except R3 wording nit |

## Evidence gaps

- **SQL runtime (blocked by panel rule 7):** none of the candidate's new
  behavior was executed against PostgreSQL. The JSONB/22P05 and class-22021
  claims (NUL / lone surrogates as keys, scalar carriers, durable projection)
  rest on the DDL/SQL analysis and the pure predicates, not on a database run.
  The `UNIQUE (session_uri, request_key) DO NOTHING` + `same_payload` replay
  path, the `cancelled`/`failed` refusal semantics, and the
  `ON DELETE RESTRICT` disposal block remain static-analysis conclusions.
- The commit message's full `pnpm validate` was reproduced by me in two
  halves (lint/typecheck/test/docs/build each run green today), matching the
  claimed 40 files / 298 tests.
- The host facade's `HOST_SESSIONS_SETTLING` branch has no direct test (R2).
- The in-flight-create interleave of R1 is analytic; no runtime or test
  evidence either way (labeled hypothetical, correctly excluded from blocking).

## Final verdict

All four triage fix rows close with code + test or documented-deferral
evidence; the seven claimed regressions are present and pinned (test count and
suite green under my own run); no P1/P2; the residuals found are P3 hardening
and docs precision, none reproducible as a defect from the candidate state.

**PASS** — with R1–R5 (all P3) as non-blocking follow-ups for a later round.

Report: docs/review/round-03-b1.md — Verdict: PASS
