# Round 02 — B-side re-review (B1-R2)

**Reviewer:** B1-R2 (side B, adversarial agent/work end-to-end lens)
**Mode:** Blind and independent. This report was produced without reading any
other reviewer's findings. The only panel inputs used are
`docs/review/00-panel.md` and `docs/review/round-01-triage.md`; all other
statements below are grounded in the candidate's source, tests, SQL, and
documents.

## Candidate

| Field | Value |
| --- | --- |
| Candidate commit | `27ff2bb52dff889d3804f61b18e8c531efc78d39` (supersedes `7038a08a46321885f4a4c418f3f3cb5f7f87eb03`) |
| Branch | `agentIdentity` (HEAD; `git rev-parse HEAD` confirms) |
| Diff base | `7038a08a46321885f4a4c418f3f3cb5f7f87eb03` |
| Working tree | clean except untracked `docs/review/` panel files |

## Files / areas inspected

- `src/websocket/helpers/ahp/agentWork.ts`, `helpers.ts`, `constants.ts`
- `src/websocket/helpers/host/helpers.ts`
- `src/work/helpers/helpers.ts`, `errors.ts`, `types.ts`, `index.ts`
- `src/sessions/createSession/helpers.ts`, `src/sessions/helpers/factory/helpers.ts`, `src/sessions/types.ts`
- `src/agents/helpers/authenticator.ts`, `src/agents/helpers/directory.ts`
- `src/persistence/helpers/{workItems,sessions,agentRegistrations,pool}.ts`
- Tests: `src/tests/websocket/agentWork.disposal.test.ts`, `agentWork.test.ts`, `agentWork.binding.test.ts`, `src/tests/work/workService.test.ts`, `src/tests/agents/{authenticator,directory}.test.ts`, `src/tests/agents/fixtures.ts`
- SQL/docs: `database/migrations/0001_session_tool_baseline.sql`, `0002_agent_work.sql`, `database/migrations/README.md`, `database/M2_AGENT_WORK_DATABASE_SCHEMA.md`, `database/session-tables.md`, `docs/architecture/agent-task-lifecycle.md`, `src/work/README.md`, `src/agents/README.md`, `src/websocket/README.md`, `docs/technical/wire-contract.md`, `docs/plans/agent tasks and identity/IMPLEMENTATION_LEDGER.md`

## Commands run (read-only, no dependencies installed, no SQL applied)

| Command | Outcome |
| --- | --- |
| `git log -3 --oneline --decorate`, `git rev-parse HEAD`, `git status --short` | HEAD = `27ff2bb` on `agentIdentity`; tree clean except untracked `docs/review/` |
| `git diff 7038a08..27ff2bb --stat` / per-path patches | 19 files, +723/−31; matches the fix-bundle scope (no `src/toolClient/`, no `src/tools`, no frozen `types.ts`, no `package.json`) |
| `pnpm exec tsc --noEmit` | exit 0 (clean) |
| `pnpm test` (vitest run — all non-DB) | **40 files / 291 tests passed** (281 + 10 new, matches the triage count) |
| `pnpm run lint` (`eslint . --max-warnings 0`) | exit 0, zero warnings |
| `pnpm run docs:check` | exit 0, "95 source files mapped by module READMEs" |
| `pnpm validate` / `pnpm run build` | **not run** (out-of-scope per review instructions; the constituent non-mutating checks above were run instead) |
| anything touching PostgreSQL | **not run** (panel rule 7; no container, no scripts applied) |

---

## 1. Per-row verification ledger (triage "Fix bundle applied" table)

Each row is verified against the candidate's actual code/tests/docs, not the
triage's description.

### 1.1 A1-F1 (P2) — stale owner binding after failed disposal

**Row decision:** Fixed. **Conclusion: closes the finding** (with one same-principal remainder tracked under new finding B1-R2-01 below).

Evidence:
- `src/workspace .../ahp/helpers.ts:409-416` — `disposeSession` releases the binding in `finally`, so a failing/parked backend dispose can no longer strand the binding:
  ```ts
  try { await factory.disposeSession(params); }
  finally { /* ... */ options?.sessionOwners?.unbind(parsed.channel); }
  ```
- `src/sessions/helpers/factory/helpers.ts:203-221` — the record is deleted before the backend dispose; a backend failure throws `InternalError` *after* removal, so the `finally` unbind is the authoritative release point (survives failure as claimed).
- Typed registry error: `src/work/helpers/helpers.ts:191-197` — `bind` raises `WorkError("conflict", ...)`; `src/websocket/helpers/ahp/agentWork.ts:184-196` maps `WorkError("conflict")` → `RpcError(AhpErrorCodes.Conflict, "Conflict")` on the wire.
- Regression: `src/tests/websocket/agentWork.disposal.test.ts:196-255` — real sessions factory, gated backend, failing settle: dispose rejects with `InternalError` after record removal, binding is released (`sessionOwners.owner(SESSION_URI)` → `undefined`), the URI rebinds to the new creator, and the stale principal cannot submit (`work.submit({subject:"alice"}`).rejects `unauthorized`).

### 1.2 A1-F2 (P2) — recreate lands between record delete and unbind → ownerless zombie

**Row decision:** Fixed. **Conclusion: partial — the cross-principal reproduction is closed; a same-principal variant of the same zombie shape remains reachable.** Full finding: **B1-R2-01 (P2, open)** in section 2.

Evidence of the closed half:
- `src/websocket/helpers/ahp/helpers.ts:378-384` — create-time pre-check rejects a mid-window recreate (`Session not found`) while `owner !== principal.subject`; verified for cross-principal recreates in `agentWork.disposal.test.ts:222-231` (fail variant) and `:276-282` (success variant), both asserting the record is invisible while the binding persists.
- After settle, the recreate rebinds to its true creator: `agentWork.disposal.test.ts:233-239` (failed settle) and `:284-290` (success settle).
- Stale-principal resubmission is refused: `agentWork.disposal.test.ts:241-249` → `work.submit(alice)` rejects `unauthorized`; the row-count assertion (`submitted`/`cancelled`) proves no durable pollution.

Evidence of the remaining half is under finding B1-R2-01.

### 1.3 A1-F3 (P3) / A2-05 / B1-P3-04 — submit vs dispose TOCTOU orphaning durable work

**Conclusion: closes the finding.**

Evidence:
- `src/work/helpers/helpers.ts:234-261` — after `repository.submit` resolves, the service re-verifies both facts the pre-check asserted (`sessionOwners.owner(uri)` and a fresh `describeSession(uri)` from the live projection); on failure it best-effort cancels the just-recorded row (`repository.cancel({workId, principalSubject})`, error swallowed) and throws `WorkError("conflict")`, which the wire maps to `AhpErrorCodes.Conflict` (`agentWork.ts:190-192`).
- The re-check reads the *current* binding/live projection (host wiring re-derives `ownerPrincipalSubject` from `sessionOwners.owner` at `src/websocket/helpers/host/helpers.ts:90-93`), so it is not a stale copy of the pre-check result.
- Cancellation semantics are correct even after the race: `src/persistence/helpers/workItems.ts:310-348` — `cancel` joins on the durable `sessions` row owner, so it cancels a committed row even though the live record was already removed. If the row was concurrently leased, cancel installs `cancelled` and clears the lease; the worker's next `renew`/`complete` then fails stale — safe.
- Regression: `src/tests/work/workService.test.ts:241-264` — submit parked on the repository promise, `owners.unbind` + record removal, then release: the service rejects `conflict` and calls cancel with the exact `{workId, principalSubject}`; `agentWork.disposal.test.ts` repeats the binding-window coordination end-to-end.
- Doc: `docs/architecture/agent-task-lifecycle.md:125-127` states both halves (disposal rejected while ANY row references the session; a submission settling after its live session was disposed is cancelled and reported as conflict). Factual as written; `hasDependentWork` does count terminal rows (`workItems.ts:389-395`), so the absolute-claim wording matches the code.

One deliberate nuance (not a defect): for an idempotent replay (`created: false`), the reconciliation would cancel the pre-existing row — this only fires when ownership vanished mid-flight, which a disposal cannot reach while any row exists (`hasDependentWork` is absolute), i.e. it is confined to host-stop/binding-loss paths.

### 1.4 A1-F4 (P3) — register creates durable rows then `bindPresence` rejects

**Row decision:** Fixed (main trigger). **Conclusion: closes the finding as scoped.**

Evidence:
- `src/websocket/helpers/ahp/agentWork.ts:290-302` — the pre-check runs **before** `agents.register` and returns the generic `Conflict` reply (`conflict()` at `:153-155`) without touching the repository; it re-verifies the durable record (`agents.getRegistration` → `registrations.getById`) rather than the cache, and re-registering the connection's own `(principal, agentKey)` stays allowed.
- Regression: `src/tests/websocket/agentWork.test.ts:313-336` — a different `agentKey` on the same connection yields `Conflict` with `registerCalls.length === 1` and `records.size === 1` (no row created); re-registering the own key returns the same `agentId` with exactly one durable row.
- "Conflict mapping and register reply shape": the pre-check path produces the same `RpcError(AhpErrorCodes.Conflict, "Conflict")` as `mapAgentError`'s conflict branch; the success reply shape (`{ version: 1, agentId, presenceExpiresAt }`) is unchanged and still pinned by `agentWork.test.ts:121-149`.
- Residual verified against the triage's claim ("row count bounded by unique `(principal, agentKey)`, no growth path"): the cross-connection conflict (`agentWork.test.ts:338-348`, second live connection taking the same identity) still performs an idempotent upsert before `bindPresence` rejects — that touches the *existing* row only (no new row; slight display-name rewrite on conflict), so no growth path remains. A truly concurrent register of two different keys on one connection could still create a row that `bindPresence` then rejects, but such rows are bounded by `(principal, agentKey)` — consistent with the documented residual (see also evidence gap in section 5).

### 1.5 A1-F5 / B1-P3-02 / B2-P3-04 — presence renewals consult a stale registration cache

**Row decision:** Documented, code deferred. **Conclusion: documented; decision stands, but one sentence of the doc is mechanically inaccurate** (B1-R2-04, P3).

Evidence:
- Cache exists at `src/agents/helpers/directory.ts:33, 69-78, 91, 197`; presence binding never re-checks `enabled` after a DB-side flip — behavior confirmed by code, no disable/delete path exists in this slice (grep of `src/agents` has no unbind/disable API).
- Work mutations re-read every time: `src/work/helpers/helpers.ts:152-161` (`enabledAgent`). Claims/completions fail closed on a DB-side disable — consistent with the README claim.
- Doc: `src/agents/README.md:58-62` documents the boundary and that invalidation belongs with a real disable/decommission path. The mechanism ascribed to the renewal path is wrong in detail — `renewPresence` (`directory.ts:140-160`) never reads the registration cache at all; it renews from the live binding. Deferred decision itself is intact.

### 1.6 A1-F6 — whitespace-only `requestKey`/`kind` accepted by the service

**Conclusion: closes the finding.**

Evidence: `src/work/helpers/helpers.ts:115-127` adds `trim().length === 0` rejection to `requestKey` and `kind`; session URI also gains length bounds (see 1.7). Wire-side siblings already had trim refines (`agentWork.ts:47-54`, `57-60`). The DDL CHECKs match: `database/migrations/0002_agent_work.sql:37-38` (`length(trim(request_key)) BETWEEN 1 AND 256`, `length(trim(kind)) BETWEEN 1 AND 128`). Regression: `src/tests/work/workService.test.ts:197-218` rejects `"   "` request key and `" "` kind with `WorkError("invalid")`.

### 1.7 B2-P3-07 — `sessionUri` bound only at the wire

**Conclusion: closes the finding.**

Evidence: `MAX_SESSION_URI_LENGTH = 2_048` (`helpers.ts:18`); enforced service-side in `assertSubmission` (`:110-114`) and `claim` (`:270-274`); wire-side `sessionUriSchema.max(2_048)` (`agentWork.ts:107`) on the same `sessionUriSchema`. Regression: `workService.test.ts:197-205` rejects a 2,049-char URI with `WorkError("invalid")`.

### 1.8 A2-01 — NUL/unpaired surrogates reach JSONB cast → InternalError

**Row decision:** Fixed. **Conclusion: closes the finding.**

Evidence:
- `src/work/helpers/helpers.ts:34-66` — `isJsonbSafeText` rejects a NUL code unit, a high surrogate not followed by a low one (correctly consuming valid pairs), and a lone low surrogate; `isJsonbSafe` recurses arrays/records, passes other scalars.
- Service enforcement at `boundedJsonBytes` (`:68-81`) → `WorkError("invalid")` → wire `InvalidParams` (`agentWork.ts:184-186`).
- Wire mirroring: `isPayloadInvalid` (`agentWork.ts:62-67`) is applied to `boundedObject` (submit input, `:91-93`) and `boundedResult` (`:95-97`); a wire payload error is a `ZodError`, mapped by `src/websocket/helpers/connection.ts:132-133` to `-32602 Invalid params` — the same public vocabulary as the service path. Error class is `invalid` at both layers as claimed.
- Regressions: `src/tests/work/workService.test.ts:226-243` (NUL and unpaired surrogate `\ud800` input → `invalid`); `src/tests/websocket/agentWork.test.ts:285-298` (NUL in submit input → `ZodError`, zero service calls).
- Coverage note: the wire-layer test covers NUL only; the unpaired-surrogate wire case is exercised at the service level (`fail`/`complete` messages carry no JSONB cast risk because the message is never persisted — see 1.15).

### 1.9 B2-P3-01 / A2-03 — whitespace-only `displayName` passes the wire but fails the DB CHECK

**Conclusion: closes the finding.**

Evidence: `agentWork.ts:43-46` adds the trim refine to wire `displayName` (bound 1..128, tighter than the DDL's 1..200 in `0002_agent_work.sql:16`); regression `agentWork.test.ts:273-283` rejects `"   "` with a `ZodError` and asserts `registerCalls` stays empty.

### 1.10 B1-P3-01 — wire payload bounds looser than service; result shape mismatch

**Row decision:** Fixed. **Conclusion: closes the finding** (one dead-constant doc nit remains, B1-R2-03).

Evidence:
- `src/work/helpers/helpers.ts:22-23` exports `WORK_MAX_INPUT_BYTES` (64 KiB) and `WORK_MAX_RESULT_BYTES` (256 KiB) from the service defaults; `src/work/index.ts:3-9` re-exports.
- Wire uses exactly these constants (`agentWork.ts:74`, `:85`) for submit input and complete result; the old `MAX_AGENT_WORK_PAYLOAD_BYTES` import was dropped. Submit `input` is a `z.record` object (`:91-93`); `completeSchema.result` is now a bounded JSON object (`:129-134`) mirroring the service's `isRecord` + `boundedJsonBytes(result, ..., maxResultBytes)` (`helpers.ts:325-328`).
- The service's `maxInputBytes`/`maxResultBytes` remain configurable; the wire pins the defaults. The service stays the enforcement gate and RuntimeError-maps oversize to `invalid` either way — same public vocabulary.
- Complete test coverage: blanks/JSONB result shape at `agentWork.test.ts:300-310` (non-object result rejected pre-service) and size semantics pinned inside `workService.test.ts` (input oversize at `:175-218` context).

### 1.11 B2-P3-02 (+B1 hypothetical) — timing-unsafe bearer comparison

**Row decision:** Fixed. **Conclusion: closes the finding.**

Evidence:
- `src/agents/helpers/authenticator.ts:29-30, 54-56, 69-76` — configured tokens and the presented credential are both reduced to SHA-256 digests (fixed 32-byte buffers, so `timingSafeEqual` cannot throw on length mismatch); the compare loops over every configured token and only returns the subject (never the token); repeated/ambiguous headers are rejected (`readAuthorization`, `:12-27`; regex `\S+` rejects multi-word or empty credentials → `undefined`), header names are matched case-insensitively (`name.toLowerCase()`), and unknown/missing credentials resolve to `undefined`.
- Cost is one hash plus one digest comparison per configured token — reveals at most the token count plus the (non-secret) match position, never prefixes or lengths, as documented in the updated docstring (`:40-43`).
- Regression: `src/tests/agents/authenticator.test.ts:50-63` — `token` → `short-owner`, `token-extended` → `long-owner`, `token-extr` → `undefined` (prefix discrimination that the old `Map.get` semantics make meaningful).
- Hypothetical (not blocking, no evidence path established): the `break` after a match means a hit stops the loop; an attacker measuring a *successful* authentication could in principle learn the configured-token index. With ≥1 valid credential this leaks nothing about failures, and rounds on a 32-byte compare dwarf the loop step. Hypothetical-hardening footnote only.

### 1.12 B2-P3-03 — reconcile-per-claim overhead

**Row decision:** Documented, deferred. **Conclusion: documented accurately.**

Evidence: `src/work/README.md:82-86` records the accepted overhead and the "possible scheduler variant, not a v1 contract change" decision. The correctness claim is verified in the SQL: the claim CTE re-checks lease expiry against the DB clock itself (`src/persistence/helpers/workItems.ts:159-163`, `statement_timestamp()`), so no claim depends on the reconciler having run.

### 1.13 B1-P3-07 / B2-P3-05 — dead `exhausted` code and unused mapping

**Row decision:** Reserved (documented). **Conclusion: closes as reserved; removal would indeed be a frozen-contract change.**

Evidence: `WorkErrorCode` still includes `exhausted` (`src/work/types.ts:120`); `mapWorkError` maps it to `stale()` (`agentWork.ts:192-195`); no producer exists — budget-exhausted leases terminalize to `failed` in SQL (`workItems.ts:288-290`) rather than throwing. Documented in `src/work/README.md:87-90` with the same rationale the triage gives.

### 1.14 A2-02 — `target_agent_id` principality not expressible in DDL

**Row decision:** Documented, policy deferred. **Conclusion: documented accurately; no overclaim.**

Evidence: `database/M2_AGENT_WORK_DATABASE_SCHEMA.md:127` (column cell now names `WorkService.submit` at `src/work/helpers/helpers.ts` as the write-time enforcement point and states direct repository callers bypass it — both statements verified: service check at `helpers.ts:225-233`, FK in `0002_agent_work.sql:27` anchors the row only) and `database/M2_AGENT_WORK_DATABASE_SCHEMA.md:212-218` (operational note + reconciliation). The orphaned-target remediation remains deferred; owner `cancel` remains the recovery path (claim unaffected because the claim SQL itself enforces `(target_agent_id IS NULL OR target_agent_id = a.id)` at `workItems.ts:157`).

### 1.15 B2-P3-06 — failure `message` validated then dropped

**Row decision:** Documented decision. **Conclusion: documented accurately.**

Evidence: the service validates then discards (`helpers.ts:349-356` validates `reason.message`, the repository call at `:356-362` passes only `retryable`); the frozen v1 reply is `{ version: 1, status }` (`agentWork.ts:428-432`); no failure-message column exists (`0002_agent_work.sql`). `src/work/README.md:66-69` states exactly this. (The README carries the content twice — formatting defect B1-R2-02, not a truth defect.)

### 1.16 A1 doc drift — disposal vs dependent work

**Row decision:** Updated. **Conclusion: accurate.** `docs/architecture/agent-task-lifecycle.md:125-127` states the check-time rule ("rejected while any work row references the session") plus the post-settlement reconciliation ("cancelled and reported as a conflict rather than kept"). Both match `hasDependentWork` (any status row) and the service reconciliation.

### 1.17 A2 doc drift — two authority narratives for `sessions`

**Row decision:** Updated (superseded banner). **Conclusion: banner effective; two small wording defects remain** (B1-R2-05, P3).

Evidence: `database/session-tables.md:1-13` — "Status: **Superseded.** ... Read this file only as the original proposal record; the executable SQL and `src/persistence/helpers/sessions.ts` are authoritative." Banner intent is satisfied. Nits: the banner names "`ownedPrincipalSubject` ownership" while the real column is `owner_principal_subject` (`0001_session_tool_baseline.sql:60`), and the body still says "Disposed sessions are deleted" (`:37`), which the shipped retention behavior contradicts (nothing deletes durable session rows; retention is explicitly deferred). Under an explicit superseded banner this is a P3 wording issue, not a false implementation claim.

### 1.18 B1-P3-03 — per-agent kind eligibility (plan LEASE-03)

**Row decision:** Documented, deferred. **Conclusion: accurate; correctly stated as still deferred.**

Evidence: `docs/architecture/agent-task-lifecycle.md:181-183` — "Work-kind eligibility is host-global in V1 — one configurable allow-list shared by every agent; per-agent kind grants from the task plan are deferred (a contract change, not a configuration task)." The code does keep one host-global list (`allowedKinds` flowing into every claim: `src/websocket/helpers/host/helpers.ts:95`, `helpers.ts:281`), and nothing in the docs claims per-agent grants exist. No false claim.

### 1.19 B1-P3-05 — retention / never-delete durable state

**Row decision:** Documented, deferred. **Conclusion: accurate.**

Evidence: `docs/architecture/agent-task-lifecycle.md:184-186` — "no retention path: `work_items` rows and the durable `sessions` row they first landed are never deleted (live disposal only removes in-memory state), so a retain/cancel-and-archive policy is required before production use." Verified: live removal never calls the durable repository (host/ahp dispose paths touch only the in-memory registry and the owner binding); `work_items` has no delete statement; `assertSessionDisposable` holds disposal while any row exists.

### 1.20 A2-04 — `schema_migrations` created but never written

**Row decision:** Fixed. **Conclusion: closes the finding as written; one carried doc gap** (B1-R2-06, P3).

Evidence: both scripts now self-record: `0001_session_tool_baseline.sql:79` (`INSERT INTO schema_migrations (version) VALUES ('0001_session_tool_baseline')`) and `0002_agent_work.sql:63` (its own row), after their DDL as claimed. The INSERTs make re-apply fail on a duplicate PK while the DDL is `IF NOT EXISTS` — acceptable single-shot semantics, but no doc in `database/` mentions the table or this behavior. The fix itself is verified in the SQL.

### 1.21 PostgreSQL runtime acceptance (all reports)

**Row decision:** Blocked (unchanged). **Conclusion: treated as an evidence gap, not a failure.** No SQL was executed for this review (no container, no psql, no migrations). The candidates' docs consistently state this honestly: `database/M2_AGENT_WORK_DATABASE_SCHEMA.md:3-5`, `database/migrations/README.md:3-6`, `docs/architecture/agent-task-lifecycle.md:173-177` ("Treat the SQL acceptance gates as **BLOCKED**, not passed"). The Real-DB probe list from the triage (concurrent `SKIP LOCKED` claim, replay/conflict DATA-04/05, CHECK lease-shape, `\u0000` payload probe, disabled-target remediation) remains owed.

### 1.22 "Deliberately not changed" rows

Verified: no changed file touches `src/agents/types.ts`, `src/persistence/types.ts`, `src/work/types.ts` (frozen contracts), `x-ahp/tools/*`, the SDK surface, or `package.json`/lockfile (diff stat scope confirms). Baseline AHP methods (subscribe/dispatch/dispose, `x-ahp/tools/*`, SDK) are pinned by the unchanged pre-existing tests among the 291 passing tests.

---

## 2. Regressions / new defects

### B1-R2-01 — P2 — open — same-principal mid-window recreate survives, then the racing dispose's `finally` unbind deletes the new binding (A1-F2 shape incompletely closed)

**Status:** open. **Severity:** P2 (incomplete fix that leaves the reproduced zombie shape reachable, plus an authorization consequence).

**Threat path (established by source, not yet pinned by a test):**
1. `disposeSession(URI)` by alice passes the pre-check and `assertSessionDisposable`, then `factory.disposeSession` removes the record and awaits the backend dispose (`src/sessions/helpers/factory/helpers.ts:203-221`). While the backend disposal is in flight (parked, slow, or failing), the owner binding persists (`agentWork.disposal.test.ts:214-220` explicitly documents this window).
2. During that window, `createSession(URI)` from a *different* connection held by the **same principal** passes the pre-check (`owner === principal.subject` → no throw, `src/websocket/helpers/ahp/helpers.ts:378-384`), creates the live record again, and rebinds (`:386-392`, same-subject bind is a no-conflict overwrite of the identical value).
3. When the old disposal settles, its `finally` runs `sessionOwners.unbind(parsed.channel)` **unconditionally** (`:409-416`), deleting the *new* binding. The same applies to the parallel programmatic path (`src/websocket/helpers/host/helpers.ts:166-174`).

**Result:** a live session record with no owner binding — the ownerless zombie that A1-F2/P2 described — from which:
- any peer can dispose it, including an unauthenticated one: the dispose owner check is skipped entirely when `owner === undefined` (`helpers.ts:400-404`), `assertSessionDisposable` passes when no rows exist, and `factory.disposeSession` then removes alice's live record (foreign disposal of another user's live session);
- work can no longer attach: post-wipe, `describeSession` returns `undefined` (host wiring `host/helpers.ts:90-93`) and `boundOwner` is `undefined`, so `service.submit` fails `not_found` (`src/work/helpers/helpers.ts:217-221`);
- if rows were committed inside the rebind window, `hasDependentWork` pins the zombie against disposal forever (absolute claim) while submissions stay frozen — the worst of both states.

**Why this is not the implemented "fail-closed" contract:** the triage's fix row says "mid-window recreates are rejected fail-closed while the binding persists" — the code only rejects them when the binding subject *differs*. The existing tests (`agentWork.disposal.test.ts`) exercise exactly the cross-principal variant (bob rejected at `:222-231`/`:276-282`); no test exercises alice's own mid-window recreate, so the gap is invisible to the suite. Reachability is realistic: two same-principal connections (dispatch is serialized per socket, so the race needs a second socket), the candidate's own gated-failure disposal makes the window arbitrarily long, and the harness already exists to pin it.

**Suggested next state:** make the release binding-identity-aware instead of URI-only — e.g. capture the bound entry at dispose start and release exactly that entry (value-and-generation-aware registry entry, or a conditional `unbindIf(channel, token)`), or reject mid-window recreates for *all* principals while a binding persists (sequential dispose→create after settle still works since settle releases the binding), and add the same-principal interleave to `agentWork.disposal.test.ts` (the `gated` harness makes it deterministic).

**Classification note:** not a behavioral regression introduced by `27ff2bb` (the same-principal wipe existed at round-01 in the successful-disposal variant, where unbind already ran unconditionally after dispose); it is an *incomplete verification of the claimed fix*, which the panel equates with leaving the reproduced issue partially open (P2).

### B1-R2-02 — P3 — open — `src/work/README.md` has two "## Caveats" sections

**Evidence:** the fix bundle inserted the expanded "## Caveats" block before "## Testing" (`src/work/README.md:72-90`) and left the original "## Caveats" block after "## Testing" (`:100-109`), which lacks the reconcile-per-claim and reserved-`"exhausted"` entries. The later file in the Testing table also duplicates the first four bullets. **Impact:** docs-drift hazard (a future edit to one block will diverge from the other). **Remediation:** delete the trailing duplicated block or fold it into the first.

### B1-R2-03 — P3 — open — dead, now-misleading `MAX_AGENT_WORK_PAYLOAD_BYTES`

**Evidence:** `src/websocket/helpers/ahp/constants.ts:81-82` still exports `MAX_AGENT_WORK_PAYLOAD_BYTES = 1_048_576` but the work extension no longer imports it (only reference in the repo, found by symbol search); its comment still reads "Cap on one agent/work extension JSON payload (submission input or result)" while the real caps are 64 KiB / 256 KiB. **Impact:** a reader implementing a client could size payloads to 1 MiB and hit wire rejection. **Remediation:** delete the constant or repoint the comment to `WORK_MAX_INPUT_BYTES`/`WORK_MAX_RESULT_BYTES`.

### B1-R2-04 — P3 — open — `src/agents/README.md` misdescribes the renewal path's cache use

**Evidence:** `src/agents/README.md:58-62` says "The renewal path consults an in-process registration cache refreshed by `register`/`getRegistration`" — but `renewPresence` (`src/agents/helpers/directory.ts:140-160`) never reads `registrationCache`; the wire renew path (`agentWork.ts:324-338`) revalidates only the live binding. The intended boundary (a DB-side `enabled` flip does not stop renewals until a refresh/restart; work mutations re-read and fail closed) is correct. **Remediation:** reword to, e.g., "presence renewal does not re-check the durable record at all".

### B1-R2-05 — P3 — open — `database/session-tables.md` banner wording nits

**Evidence:** banner says `ownedPrincipalSubject` (real column: `owner_principal_subject`, `0001_session_tool_baseline.sql:60`) and the retained body states "Disposed sessions are deleted" (`:37`), contradicting the shipped never-delete retention behavior while the top banner says the file is a historical record only. **Remediation:** correct the column name; optionally bracket the body as historical prose.

### B1-R2-06 — P3 — open (carried) — `schema_migrations` is undocumented in `database/` prose and re-apply is not idempotent

**Evidence:** the A2-04 fix added self-recording INSERTs (`0001:79`, `0002:63`). `database/migrations/README.md:22-23` still says "The canonical seven tables" — with the bookkeeping table the set is eight — and no doc mentions the version rows or that the DDL is `IF NOT EXISTS` while the INSERTs are duplicate-PK-fatal on re-apply. Pre-existing drift aggravated by the fix. **Remediation:** one sentence in `migrations/README.md` naming `schema_migrations`, its self-record behavior, and single-shot semantics.

### B1-R2-07 — P3 / hypothetical — register pre-check repository failures bypass `mapAgentError`

**Evidence:** the new pre-check's `await agents.getRegistration(...)` (`agentWork.ts:294-302`) sits outside the handler's `try`, so an escaping `RepositoryError` reaches `sendMappedError` (`connection.ts:138`) as generic `-32603` instead of the sanctioned mapping. Today's only failure factory (`databaseFailure`, `src/persistence/helpers/pool.ts:41-55`) collapses SELECT failures to `database`, which `mapAgentError` would also map to `-32603` — identical outcome; a hypothetical non-`database` code from a read would diverge. **Remediation (optional hardening):** include the pre-check inside the mapped try. No current impact.

---

## 3. Documentation accuracy checks (changed docs only)

| Doc | Claim checked | Result |
| --- | --- | --- |
| `database/session-tables.md` banner | Supersession of the proposal by shipped migrations; points at `0001` + M2 doc; names real mechanisms | Correct in intent; `owner_principal_subject` naming nit and body line 37 conflict (B1-R2-05) |
| `database/M2_AGENT_WORK_DATABASE_SCHEMA.md` | `target_agent_id` invariant enforced by `WorkService.submit`, not the DDL; direct repository callers bypass; racing submission reconciliation | Accurate (`helpers.ts:225-233`; `workItems.ts` FK anchors only) |
| `database/migrations/*.sql` | Self-recorded version rows after DDL; comments match schema (`schema_migrations` created at top of 0001) | Accurate in-file; README prose drift (B1-R2-06); statuses still honestly say "written, not applied" |
| `docs/architecture/agent-task-lifecycle.md` | Disposal rule + reconciliation; deferral statements (per-agent kinds, retention); verification status honestly BLOCKED for SQL | Accurate; no implemented-when-deferred overclaims found |
| `src/work/README.md` | Bounds (64 KiB/256 KiB), JSONB-unsafe rejection, failure-message discard, reconcile-per-claim, reserved `exhausted` | Accurate content; duplicated "## Caveats" sections (B1-R2-02) |
| `src/agents/README.md` | Cache-staleness boundary | Intent correct; renewal mechanism misdescribed (B1-R2-04) |
| `docs/technical/wire-contract.md` (unchanged) | Extension namespace claims (lease token only to the claimant, `get` redacts) | Cross-checked against `workItems.ts`/`toView` — still true |
| `src/websocket/README.md:158-162` | "Direct host disposal ... unbinds the owner on success" | Slightly stale now: `hostedSessions.disposeSession` unbinds in `finally` (success or failure). Minor; folded into B1-R2-05 as a wording-class note (P3) |
| Triage fix rows referencing docs | Lifecycle/M2/session-tables updates exist and state check-time facts | Confirmed; no deferred item is claimed as implemented anywhere in the changed docs |

## 4. Evidence gaps (separate)

1. **Real-PostgreSQL runtime acceptance remains blocked** and unassessed (user instruction; panel rule 7). No SQL executed, no container started; I claim no DB test result. The owed probes (concurrent `SKIP LOCKED` claim race, replay/conflict DATA-04/05, CHECK lease-shape, `\u0000` JSONB probe, disabled-target remediation, `schema_migrations` apply/re-apply) stay open.
2. **B1-R2-01 is code-analytical:** the same-principal mid-window wipe is derived from the source interleaving; no test in the candidate executes it. The existing gated-factory harness would pin it in minutes.
3. **Concurrent same-connection register race** (two registers with distinct keys in flight) could still create a row that `bindPresence` later rejects — analysis-level only; bounded by `(principal, agent_key)` per the triage residual and untested.
4. **Wire-layer JSONB-unsafe coverage** covers NUL on submit input only; the unpaired-surrogate case at the wire schema is exercised at the service level and through the shared `isJsonbSafe`.

## 5. Verdict

**CHANGES REQUIRED.**

Rationale (candidate-based only): 20 of the triage's 22 action rows verify as Fixed/Documented/Reserved exactly as claimed, the four non-`pnpm validate` constituent checks pass (`tsc --noEmit` clean; vitest 40 files / 291 tests; `eslint --max-warnings 0` clean; docs gate 95 files), and no regression to baseline AHP, `x-ahp/tools/*`, or SDK behavior was found (frozen contracts untouched, 19-file diff scope confirms). One incomplete fix keeps the round-01 finding A1-F2's ownerless-zombie shape reachable through a same-principal mid-window recreate, with an additional authorization consequence (foreign disposal of the ownerless live record) — the triage's stated fix contract ("mid-window recreates are rejected fail-closed") is only implemented for cross-principal recreates. That single P2 (B1-R2-01) plus the P3 docs-drift items require one more targeted pass; after closing B1-R2-01 (binding-identity-aware release or all-principal mid-window rejection, plus its regression test and the small doc corrections), a PASS is supportable without any further evidence.

Report: docs/review/round-02-b1.md — Verdict: CHANGES REQUIRED
