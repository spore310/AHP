# Round 04 — Reviewer A2 (side A) — input/SQL-safety boundaries, frozen contracts, baseline behavior, documentation accuracy

**Candidate under review:** `65127f65cd32c49866274418befb09010a914210` ("fix: bind owner at attach and finish the round-03 closures"), HEAD of `agentIdentity`. Fix diff base: `d3c33d1`. Frozen-contract baseline: `7038a08`.
**Filed by the side-A coordinator from the reviewer's verbatim final report. Blind: reviewer A2 ran with fresh context (round-01..03 triages + panel rules only).**

**Verdict: PASS** (P3 advisory only; my two round-03 P3s are closed with source + test evidence, and the closure does not open a P1/P2 anywhere I traced).

I read only the panel rules and the three triage files for prior context. One process note: while grepping `docs/` for cross-document statements I inadvertently surfaced lines from other reviewers' round-04 files; I have not incorporated anything from them — every claim below is grounded in my own source inspection, `git diff/log`, and test runs performed before and independent of that grep.

---

## 1. F1 closure — `assertSessionDisposable` text gate (A2-r3 F1) — CLOSED

**Gate ordering and shape** — `src/work/helpers/helpers.ts:384-401`:

- The gate runs **before** the `try` block that contains `options.repository.hasDependentWork(sessionUri)` (`:391-393` gate, `:394-395` try/lookup). On non-string or non-JSONB-comparable text (NUL, unpaired surrogates), `WorkError("invalid", "A session URI is required.")` is thrown with **zero repository interaction** — the message and `'invalid'` code are exactly the same shape as the sibling `submit` gate (`:76-81`) and `claim` gate (`:256-261`), so the boundary is uniform.
- The thrown `WorkError` is outside the mapped `try`, so `mapRepositoryFailure` cannot reclassify it.
- SQL reachability confirmed: the only repository consumer is `hasDependentWork` (`src/persistence/helpers/workItems.ts:389-398`), which binds the string as `$1` in `WHERE session_uri = $1` — now fed exclusively gated text.

**Both dispose paths route through it:**

- AHP handler: `src/websocket/helpers/ahp/helpers.ts:427-449` — ownership guard, then `await options?.work?.assertSessionDisposable(parsed.channel)` at `:436` inside the mapped `try`; a typed `invalid` maps via `mapWorkError` (`agentWork.ts:202-204`) to the public `InvalidParams` vocabulary.
- Host facade: `src/websocket/helpers/host/helpers.ts:167-184` — `channelFromParams` then `await work.assertSessionDisposable(channel)` at `:173`. In the facade's only ungated-by-work branch (missing/non-string `channel`), no work SQL can run because the gate call is skipped entirely and the underlying factory dispose fails typed by its own contract; for a string channel, the gate fires before any SQL. The facade error is a typed domain error, consistent with the pre-existing `conflict` propagation from round-01.

**Spot-check of the test** — `src/tests/work/workService.test.ts:444-456`: subcases NUL (`"ahp-session:/x\u0000"`) and lone surrogate (`"ahp-session:/\ud800"`) both rejected `code: "invalid"`, `expect(hasDependentWork).not.toHaveBeenCalled()`, plus the positive case showing comparable text still reaches the lookup. Verified `submit` in `createFakes` is the repository mock (`:87-97`, `:127`), so the deep-projection test's `expect(submit).not.toHaveBeenCalled()` (`:478`) is a genuine repository-untouched assertion. **Ran the file: 20/20 pass.**

## 2. F2 closure — depth budget (A2-r3 F2) — CLOSED

**Mechanics** — `src/persistence/helpers/text.ts:44-67`:

- Default entry `depth = 0`; guard `depth > JSONB_SAFE_DEPTH (512)` → `false` (`:52-54`).
- **No index leak remains:** the array branch uses `value.every((item) => isJsonbSafe(item, depth + 1))` (`:59`) and the object branch `Object.entries(value).every(([key, item]) => isJsonbSafeText(key) && isJsonbSafe(item, depth + 1))` (`:64-66`) — both explicit arrow lambdas taking only the value, not the `every(isJsonbSafe)` shorthand that would have leaked the array index as depth. Object keys are text predicates at the current level (no nesting for a key), correct as written.
- **Boundary arithmetic verified by executing an exact replica of the recursion** (outside the repo, in the approved temp dir; the repo tree was verified clean of artifacts afterward): leaf value at recursion depth **512 passes**; **513 fails**; same for object-valued and array nesting; 600-deep fails; unsafe keys still rejected. This is consistent with the helper's own JSDoc ("maximum nesting level the recursion inspects before rejecting") and with the READMEs' "nesting at most 512 levels" (root = level 0; children at depth ≤ 512 pass).

**Consumer enumeration** — every client-reachable storage vector either depth-gates or is structurally scalar:

| Vector | Gate | Depth applies? |
| --- | --- | --- |
| Submit `input` (service + wire) | `boundedJsonBytes` → `isJsonbSafe` (`work/helpers/helpers.ts:44`); wire `isBoundedInput` (`agentWork.ts:83,91`) | Yes — recursive check over the whole payload |
| Complete `result` (service + wire) | same helpers; wire `isBoundedResult` (`agentWork.ts:97-106`) | Yes |
| Durable session projection | `isJsonbSafe(live.durableState)` (`work/helpers/helpers.ts:195`) | Yes |
| `sessionUri` (submit/claim/dispose), `requestKey` | `isJsonbSafeText` (scalars — cannot nest) | N/A |
| Registration `agentKey`/`displayName` | `isJsonbSafeText` (`src/agents/helpers/directory.ts:89-92`) — scalar | N/A |
| `kind` | trim + length + `allowedKinds.has(...)` (`:89-94`) — allow-listed, structurally scalar | N/A |
| `ensureSession`'s `provider_id` | reachable only via `WorkService.submit`, and `provider === snapshot.state.provider` is embedded in the JSONB-gated `durableState` (`host/helpers.ts:42-53`) — a NUL provider cannot reach `$3` without first failing the projection gate | Covered transitively |
| `createPostgresDurableSessionRepository.ensure/get/delete` | no in-slice callers (dead surface) | Unreachable |

**Tests:** deep-projection refusal (`workService.test.ts:458-479`, typed `The session projection cannot be stored as JSON.`, repository `submit` never called) and wire-level depth-600 submit-input + complete-result ZodError with zero service calls (`agentWork.test.ts:604-629`). Both files **ran: 20/20 and 15/15 pass.**

## 3. Request-key cap alignment — CLOSED

- Wire: `src/websocket/helpers/ahp/agentWork.ts:62` — `z.string().min(1).max(WORK_MAX_REQUEST_KEY_LENGTH)`; the literal `128` requestKey cap is gone (grep: the remaining `128` bindings are `agentKey`/`displayName`/`workKind`, which match the DDL's 1–128 CHECKs for `agent_key`/`kind`).
- Constant exported from `@work`: `src/work/helpers/helpers.ts:16,25` → `src/work/index.ts:7`. Diff confirms the import at `agentWork.ts:13`.
- DDL/docs agree on 256: `database/migrations/0002_agent_work.sql:37` (`CHECK (length(trim(request_key)) BETWEEN 1 AND 256)`), `database/M2_AGENT_WORK_DATABASE_SCHEMA.md:123`, `src/work/README.md:62-66` (sentence names `WORK_MAX_REQUEST_KEY_LENGTH` and states both directions of the alignment).
- Tests pin both directions at the wire (`agentWork.test.ts:577-602`: 256 accepted and recorded in the service call, 257 → `ZodError`, one submission total). **Ran: pass.**
- `channelParamsSchema` (`src/websocket/helpers/ahp/types.ts:46-48`) is unchanged and absent from the commit — consistent with the round-03 triage's declared scope exclusion (it is shared by subscribe/unsubscribe; the dispose channel is typed through the service gate instead, so no ungated SQL remains on that channel).

## 4. Frozen-contract diffs — CLEAN

- `git diff 7038a08..65127f6 -- src/agents/types.ts src/persistence/types.ts src/work/types.ts` → **empty** (also re-verified against `d3c33d1`: empty).
- `git diff 7038a08..65127f6 -- src/sessions/types.ts` → identical to the `d3c33d1..65127f6` diff: purely additive — optional `onRecordCreated?: (sessionUri: string) => void` on `SessionsFactory.createSession` plus JSDoc (`src/sessions/types.ts:240-259`). No removals, renames, or type widenings; existing single-argument callers compile unchanged (additive optional param).
- `src/sessions/createSession/helpers.ts` and `src/sessions/helpers/factory/helpers.ts` diffs are limited to threading the hook; on hook throw the helper deletes the just-added record and rethrows (`createSession/helpers.ts:103-108`) — the registry is a pure `Map` wrapper (no stray notifications/logs). The backend-start-failure path still resolves with the record intact (`session/creationFailed` envelope), so the resolution-time verification cannot convert a creation-failure flow into a spurious conflict; `executeCreateSession` only publishes nothing when the record is genuinely detached (`:185-198`).

## 5. Baseline behavior preservation — HOLDING

- Commit stat matches the round-03 declared write set exactly; no wire method was added/removed or re-versioned; `x-ahp/tools/*` (`toolInvocation.ts`) and the adm/dispatch/subscribe paths are untouched by this bundle.
- All wire schemas except `requestKey`'s `.max(...)` are byte-identical (`agentWork.ts` diff); error-mapping tables and `mapWorkError`/`mapAgentError` unchanged; create still resolves `null` on success; dispose still resolves `null`. The new resolution-time `Conflict` on a stale create and the depth-refusal mapping are failure-path normalizations, pre-approved by the round-03 triage ("wire no longer rejects keys the service would accept"; stale-create conflict is a declared fix). The `sessionOwners === undefined` baseline (unauthenticated host-global POC) is unchanged: hook `undefined`, post-check skipped, behavior identical.
- Facade `hostedSessions.createSession` still supplies no hook — same pre-candidate shape (facade-created sessions were never owner-bound before this bundle either), covered by the existing "does not add authorization" boundary note in `src/websocket/README.md`.
- The re-apply wording fix is factually right: only `schema_migrations` DDL is `IF NOT EXISTS`; every other object in `0001`/`0002` is a plain `CREATE TABLE`/`CREATE INDEX` (verified by reading both scripts), so re-applying does fail on the first duplicate object or the version key.

## 6. Documentation sweep (files in the bundle) — ACCURATE

- `src/work/README.md:36-38` (dispose gate, "no repository access happens"), `:62-66` (cap alignment), `:69-76` (512-level budget + text-gate scope incl. durable projection and directory registration), testing rows `:87-88` — all match code/tests exactly.
- `src/persistence/README.md:17` — text.ts row states NUL/lone-surrogate rejection, object keys, explicit 512-level budget; matches `text.ts` verbatim.
- `src/agents/README.md:65-74` — the rewritten bounded-growth shapes match the code: the register pre-check is a synchronous `getByConnection` map read (`agentWork.ts:314-322`); one connection racing two distinct-key registrations yields two rows then one failed bind (`bindPresence` "Connection already has a live agent", `directory.ts:125-129`); one key raced across two connections yields one upsert row and one "Agent already has a live connection" (`directory.ts:116-121`).
- `database/session-tables.md:12-20` — citation repointed to `docs/architecture/agent-task-lifecycle.md`, which does carry the retention statement in its "Not implemented" paragraph (`:181-188`); relative link resolves.
- `database/migrations/README.md:31-41` — verified against both SQL scripts (above).
- `src/sessions/createSession/README.md:20-30,97-100,123` — attach-hook contract matches `createSession/helpers.ts:96-114` (add → hook → broadcast → backend) and the new tests.
- `src/websocket/README.md` — settle probe row (`helpers/settling.ts`), binding-at-attach semantics, stale-create Conflict message, failing-unbind fail-loud/re-dispose-heals, and updated testing rows all match the code and the disposal test file.
- Cross-doc statements about disposal remain true: `docs/architecture/agent-task-lifecycle.md:151` ("rejected with a conflict while dependent work exists") and `docs/technical/runtime-lifecycles.md:109` ("checks ownership first, then dependent work") — the new text gate sits between the ownership check and the dependent-work lookup and merely adds typing; neither statement became stale.

## 7. New-gap scan

- Settle probe (`src/websocket/helpers/settling.ts:14-19`): two in-memory reads, no storage/logs.
- Attach-hook path: writes the in-memory owner registry with `record.sessionUri` (registry-validated create params); throw path leaves no record, no notifications; the hook's bind-conflict branch is genuinely unreachable through the shipped probe (an incumbent-with-record blocks attachment at URI uniqueness; an incumbent-without-record window is pre-checked deny) and fails typed `Conflict` if ever reached.
- Facade create: malformed/missing `channel` skips the probe but always reaches the real factory parse (double-parse; no missing-parse hole).
- No new repository-facing call with unbounded arguments anywhere in the bundle diff; the only logging-adjacent code is none (the `lateBackendDisposeFailed` diagnostic predates the bundle).

---

## Findings

### P1
None.

### P2
None.

### P3

**P3-A2r4-1 — open (advisory): the exact depth-budget boundary is unpinned by tests; a one-directional off-by-one regression would ship silently.**
- Evidence: `src/persistence/helpers/text.ts:44,52-54` (budget 512, rejection at `depth > 512`); tests only exercise deep rejection at 600 (`src/tests/work/workService.test.ts:458-479`, `src/tests/websocket/agentWork.test.ts:604-629`) plus ordinary shallow acceptance; no test asserts the maximum accepted nesting.
- Failure scenario: change `depth > JSONB_SAFE_DEPTH` to `depth >= JSONB_SAFE_DEPTH` — all existing tests still pass, the READMEs' "512-level" wording remains plausible, yet legitimate payloads whose deepest value sits at recursion depth 512 (measured and confirmed passing today, both array- and object-nested) start failing as typed `invalid`. The reverse direction (`<=`, `514`-deep leak) is stack-safe and harmless but equally unobserved.
- Minimal fix: one service-level and one wire-level boundary case (e.g., a 512-wrapped-object instance accepted, one level deeper refusing typed) or a pinned exported `JSONB_SAFE_DEPTH` used directly by the tests. No contract change; keeps the doc statement honest under refactoring.

**Observation (status: no change, documented boundary):** facade-created (`host.sessions.createSession`) sessions do not acquire an owner binding, so durable work cannot attach to them. This is the pre-candidate shape, limited to the programmatic facade surface, and is covered by the existing `src/websocket/README.md` note that direct host surfaces "do not add authorization". Recorded to distinguish verified-unchanged behavior from an oversight.

---

## Closure evidence table

| Item | Status | Evidence (source + test run) |
| --- | --- | --- |
| A2-r3 F1 — dispose-channel text gate | **Closed** | `work/helpers/helpers.ts:384-401` gates `typeof`/`isJsonbSafeText` before the only repository call (`workItems.ts:389-398`); AHP handler `ahp/helpers.ts:436` and facade `host/helpers.ts:173` both route through it; test `workService.test.ts:444-456` (typed `invalid`, zero repository access) + surrounding disposal-conflict test. File ran: 20/20. |
| A2-r3 F2 — JSONB depth budget | **Closed** | `persistence/helpers/text.ts:44-67` — 512 budget, explicit `depth + 1` lambdas, no index leak; boundary verified (512 passes / 513 fails, arrays and objects); all consumers enumerated above, each depth-gated or structurally scalar; deep-projection and wire-depth-600 tests pass. |
| Adjacent — request-key cap 256 alignment | **Closed** | Wire `agentWork.ts:62` uses exported `WORK_MAX_REQUEST_KEY_LENGTH` (`work/index.ts:7`); DDL `0002_agent_work.sql:37` and M2 doc `:123` say 1–256; wire/service/docs/tests agree; 256 accepted / 257 wire-rejected pre-service. |
| Adjacent — doc corrections (migrations re-apply wording, retention citation, bounded-growth example, attach-hook contract, settle-window rows) | **Closed** | Verified statement-by-statement against `0001/0002` SQL, `docs/architecture/agent-task-lifecycle.md:181-188`, `directory.ts` + register handler, `createSession/helpers.ts`, and the disposal/bind/integration tests. |
| Frozen contracts `7038a08..65127f6` | **Empty diff** (expected) | `agents/persistence/work` types.ts — no output; also empty vs `d3c33d1`. |
| `sessions/types.ts` | **Additive-only** | Optional `onRecordCreated` + JSDoc only; identical diff vs `7038a08` and vs `d3c33d1`; factory/create helpers thread it without behavior change for existing callers. |
| Baseline wire surface | **Unchanged except declared caps/validations** | Commit matches the declared write set; schemas/methods/version literals untouched; reply/error-mapping unchanged; stale-create `Conflict` and depth refusal are triage-approved failure-path normalizations. |

## Validation performed (single-file targeted commands only; no `pnpm validate`, no SQL)

- `pnpm exec vitest run src/tests/work/workService.test.ts` — 20/20 pass.
- `pnpm exec vitest run src/tests/websocket/agentWork.test.ts` — 15/15 pass.
- `pnpm exec vitest run src/tests/websocket/agentWork.disposal.test.ts` — 9/9 pass.
- `pnpm exec vitest run src/tests/sessions/createSession.test.ts` — 24/24 pass.
- `pnpm exec vitest run src/tests/websocket/agentWork.integration.test.ts` — 2/2 pass (facade settle-window end-to-end).
- Off-the-repo arithmetic probe confirming the depth boundary (outside the working tree; `git status` verified clean of my artifacts afterward — the only untracked entry is the pre-existing `docs/review/` panel directory, which I never read beyond the three approved triage files).

Real PostgreSQL acceptance remains BLOCKED per panel rule 7; nothing above claims a database test passed.
