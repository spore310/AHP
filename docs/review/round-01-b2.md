# Round 01 — Reviewer B2

**Reviewer:** B2
**Independence:** This review was produced blind and independently. I read only `docs/review/00-panel.md`, the authoritative plan/ledger documents, repository source, and tests. I did **not** read `docs/review/round-01-a1.md`, `docs/review/round-01-a2.md`, `docs/review/round-01-b1.md`, or any other round review file, and I have not discussed findings with other reviewers.
**Candidate:** commit `7038a08a46321885f4a4c418f3f3cb5f7f87eb03` on branch `agentIdentity` (current HEAD; base commit `3fd2986b963265a588281f6ed911183824673909`; diff vs base: 62 files, +7311/−79).
**Scope assigned:** `src/agents/`, `src/work/`, `src/persistence/`, `database/`, plus directly coupled `src/websocket/` code and source-adjacent tests.
**Review mode:** read-only against this checkout. No checkout of other trees, no commits, no dependency installs, no SQL/migration execution against any Postgres instance, no edits to source, tests or docs; `pnpm validate` was not run (panel rule); `docs/review/round-01-b2.md` is the only file created by this review.

---

## 1. Commands run and outcomes

| Command | Outcome |
| --- | --- |
| `git rev-parse HEAD` | `7038a08a46321885f4a4c418f3f3cb5f7f87eb03` (read-only; confirms candidate = HEAD) |
| `pnpm exec tsc --noEmit` | exit 0 — no type errors |
| `pnpm exec vitest run src/tests/agents src/tests/work src/tests/websocket/agentWork.test.ts src/tests/websocket/agentWork.binding.test.ts src/tests/websocket/agentWork.transport.test.ts src/tests/websocket/agentWork.integration.test.ts src/tests/env/parse.test.ts` | exit 0 — 8 test files, 51 tests passed (focused sweep over the new-feature units and wire tests) |
| `pnpm exec vitest run` | exit 0 — 39 test files, 281 tests passed (full non-DB suite; matches the ledger's reported counts) |
| `pnpm run lint` | exit 0 — repo-wide |
| `pnpm run docs:check` | exit 0 — 95 files mapped |

No Postgres server, migration, or DB-backed test was executed; per the user's instruction the migrations in `database/migrations/` were only read, never applied. All repository behavior that lives only in SQL was verified by code reading (see the labeled evidence gaps in §6).

## 2. Materials inspected

**Authoritative documents (cross-check targets):**
- `docs/review/00-panel.md` (panel rules, verdict scale)
- `docs/plans/agent tasks and identity/M2_AGENT_IDENTITY_WORK_LEASING_TASKPLAN.md` (AUTH/PRES/DATA/LEASE/REC/PROTO acceptance tables)
- `docs/plans/agent tasks and identity/M2_AGENT_WORK_DATABASE_SCHEMA.md` (reference DDL and reference claim SQL)
- `docs/plans/agent tasks and identity/IMPLEMENTATION_LEDGER.md` (frozen contracts and wire shapes)
- `docs/plans/agent tasks and identity/TERMINAL_B_ASSIGNMENT.md`
- `.agents/AGENTS.md`, `docs/CodingRules.md`
- Module READMEs for `src/agents`, `src/work`, `src/persistence`, `src/websocket`, `database/migrations`, and the env README
- `docs/architecture/agent-task-lifecycle.md` (plus the wire-contract and runtime-lifecycle doc diffs)
- `database/migrations/0001_session_tool_baseline.sql`, `database/migrations/0002_agent_work.sql`

**Source (feature code, full read):**
- `src/agents/types.ts`, `src/agents/helpers/authenticator.ts`, `src/agents/helpers/directory.ts`, `src/agents/helpers/errors.ts`
- `src/work/types.ts`, `src/work/helpers/helpers.ts`, `src/work/helpers/errors.ts`
- `src/persistence/types.ts`, `src/persistence/helpers/pool.ts`, `src/persistence/helpers/workItems.ts`, `src/persistence/helpers/sessions.ts`, `src/persistence/helpers/agentRegistrations.ts`
- `src/websocket/helpers/server.ts`, `src/websocket/helpers/connection.ts`, `src/websocket/helpers/ahp/{agentWork,helpers,constants,types}.ts`, `src/websocket/helpers/host/{helpers,types}.ts`
- `src/index.ts`, `env/` (parse/derive), `src/sessions/types.ts` (for `sessionUriSchema` coupling)

**Tests:**
- `src/tests/agents/*` (authenticator, directory, and their fixtures), `src/tests/work/workService.test.ts`, `src/tests/websocket/agentWork*.test.ts` (plain, binding, transport, integration variants) and `src/tests/websocket/helpers.ts`, `src/tests/env/parse.test.ts`.

---

## 3. Verified positives (so the verdict has an evidentiary basis)

These are code-level verifications only; the DB-only acceptance items are covered in §6.

- **Durable claim is a single fenced statement.** `submit` is idempotent with a real conflict rule: `INSERT ... ON CONFLICT (session_uri, request_key) DO NOTHING`, then a same-payload probe that returns the existing id, or a `conflict` if the kind/input/target differ (`src/persistence/helpers/workItems.ts:83-128`, and the schema's `UNIQUE(session_uri, request_key)` at `database/migrations/0002_agent_work.sql:36`).
- **Claim CTE enforces every gate in one place.** Enabled registration, principal subject match, session-owner subject match, kind allowlist, target-agent restriction, retry budget (`attempt_count < max_attempts`, line 158), reclaimable status with DB-clock expiry (line 161), `FOR UPDATE OF w SKIP LOCKED LIMIT 1` (lines 164-165) inside one CTE/UPDATE that increments `attempt_count` and stamps a DB-side `lease_expires_at` (lines 167-178). `WorkService.claim` adds the presence/enablement guards before this (`src/work/helpers/helpers.ts:197-213`).
- **Renew/complete/fail are lease-token fenced and cross-principal safe.** All three require `lease_agent_id`, `lease_token`, and `lease_expires_at > statement_timestamp()` plus the registration-and-session-owner guard; they `SELECT ... FOR UPDATE OF w` inside a transaction (`src/persistence/helpers/workItems.ts:216-217, 240-248, 265-282`). The shared `principalGuard` constant (lines 56-66) requires an enabled registration for the caller's principal **and** a session owned by the same principal.
- **`get`/`cancel` are principal-bound in SQL** (`workItems.ts:318-319, 357`), so identity never comes from request JSON.
- **Presence fencing matches the design.** One live binding per agent (denial while live: `src/agents/helpers/directory.ts:107-122`), at most one agent per connection (line 118-122), generation fencing on renew/release (`binding.ts` logic: `directory.ts:35-55, 140-155`), expiry lazily removed via `liveBinding` (lines 57-67), and `releaseConnection` only removes bindings owned by that exact connection (lines 166-174). Principal identity always comes from the authenticated connection context at the wire layer (`agentWork.ts:267-280`; the extension header docs forbid agent ID/principal/generation from JSON at `agentWork.ts:198-203`).
- **Wire error vocabulary is sanitized and matches the frozen ledger shapes.** `not_found`/`unauthorized`/`invalid` → InvalidParams "Request rejected"; `conflict` → `Conflict` code; `stale`/`exhausted` → InvalidRequest; `database` → InternalError "Internal error" (`agentWork.ts:129-194`). Replies use the deep-frozen `{version, agentId, presenceExpiresAt}` / `{version, workId, leaseToken, ...}` / `{version, status, result}` shapes.
- **Session-disposal blocking is intentional and DB-consistent.** `assertSessionDisposable` rejects while *any* work row references the session (`src/work/README.md:36`; `workItems.ts:389-394`), which exactly matches the `ON DELETE RESTRICT` FK (`database/migrations/0002_agent_work.sql:21`); the architecture doc states the same rule (`docs/architecture/agent-task-lifecycle.md:125,148`). Not a defect: it is the documented, FK-aligned invariant.
- **Honest documentation.** The delivered architecture doc explicitly labels the DB-backed acceptance gates as blocked (same environment constraint recorded in §6), discloses that work-available push notifications did not change, and the persistence README's behavior claims match the code I read.

## 4. Findings (severity-ordered)

No P1 or P2 findings were identified. All findings below are P3 (hardening / quality / documentation that does not block the candidate).

### B2-P3-01 — Whitespace-only `displayName` passes wire validation and only fails at the DB CHECK, surfacing as InternalError instead of InvalidParams

- **Status:** open
- **Severity:** P3 (error-code hygiene; unreachable until the DB is actually wired)
- **Evidence:**
  - `src/websocket/helpers/ahp/agentWork.ts:44`
    ```ts
    const displayName = z.string().min(1).max(128);
    ```
    Every other client-provided string in the same schema block carries an explicit non-blank refine, e.g. `agentKey` (lines 40-43), `requestKey` (45-48), `workKind` (49-52), `failureMessage` (55-58). `displayName` alone is missing it, so `"   "` passes `min(1)`.
  - `database/migrations/0002_agent_work.sql:16`
    ```sql
    CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 200)
    ```
  - `src/websocket/helpers/ahp/agentWork.ts:156-157` — a DB constraint violation becomes `RepositoryError("database")` and maps to `JsonRpcErrorCodes.InternalError, "Internal error"`; `mapAgentError` (`agentWork.ts:183-194`) has no InvalidParams path for it.
- **Expected:** a blank-but-non-empty `displayName` should be rejected at the wire boundary with InvalidParams "Request rejected", like `agentKey`/`requestKey`/`workKind` blanks are.
- **Observed:** zod accepts it, the register flows through (`agentWork.ts:269-275`) into the Postgres repository's upsert, the CHECK rejects the row, and the client receives InternalError. In the current non-DB test world nothing catches this: `src/tests/agents/fixtures.ts:48-68` accepts any displayName without a trim check, so `agentWork.transport.test.ts` style validation tests cannot observe it either.
- **Impact:** a client-triggered input reaches the database layer and skips the sanitized error vocabulary. Functional harm is small (no row is created, nothing is corrupted), but it breaks the established input-validation symmetric treatment and will only present itself in production with a real DB.
- **Suggested remediation:** add the same `.refine((value) => value.trim().length > 0, ...)` to `displayName` (preferred; consistent with sibling fields), or trim/validate at the service boundary. Then add a wire-level rejection test so it does not regress.

### B2-P3-02 — Bearer-token credential lookup is non-constant-time

- **Status:** open
- **Severity:** P3 (hardening)
- **Evidence:**
  - `src/agents/helpers/authenticator.ts:56`
    ```ts
    const subject = subjectsByToken.get(token);
    ```
    `Map.get` compares keys with early exit, so lookup time depends on the common prefix length between the presented credential and stored tokens.
- **Expected:** comparison of authentication secrets should be constant-time regardless of how many bytes match.
- **Observed:** early-exit string comparison on the WS upgrade Authorization credential.
- **Impact:** a theoretical timing side channel allowing an adjacent, statistically equipped attacker to probe token prefixes over many handshakes. Practical risk in this deployment shape is low (handshake-path jitter, few tokens, no countermeasure gap beyond timing), which is why this is P3 rather than P2.
- **Suggested remediation:** iterate the token map and compare with `crypto.timingSafeEqual` on equal-length buffers (or hash both sides and compare digests), keeping the same SemVer contract. Note as refutation input that the threat model here is host-configured static tokens with a small cardinality, which limits the leakage rate.

### B2-P3-03 — No per-connection rate bound on `x-ahp/work/*`; every claim executes a global `reconcileExpired()` UPDATE first

- **Status:** open
- **Severity:** P3 (performance/robustness, not correctness)
- **Evidence:**
  - `src/work/helpers/helpers.ts:197-210`
    ```ts
    async claim(agent, sessionUri) {
      presentAgent(options, agent);
      await enabledAgent(options, agent);
      ...
      await options.repository.reconcileExpired();
      const lease = await options.repository.claim({...});
    ```
  - `src/persistence/helpers/workItems.ts:368-387` — `reconcileExpired()` is an unqualified global `UPDATE work_items SET status='failed' ... WHERE status='leased' AND lease_expires_at <= ... AND attempt_count >= max_attempts`.
  - The wire layer bounds volume only via the pre-existing 256-frame outbound queue (`src/websocket/helpers/connection.ts`), with no per-method rate limit on work methods.
- **Expected:** per-agent concurrent claim safety is what matters; the global reconciler statement being issued synchronously before every claim is an avoidable serial write round-trip per claim.
- **Observed:** two statements per claim attempt by every agent; in the common no-expired-rows case the UPDATE matches zero rows but still acquires and releases page/heap access each time. Fence correctness does **not** depend on this call — the claim CTE re-declares expiry with the DB clock itself (`workItems.ts:161`) — so this is purely overhead, not a race.
- **Impact:** at moderate agent counts the redundant statement adds latency and contention on the claim path; the tight partial index `work_items_expired_claim_idx` (`0002_agent_work.sql:54-56`) keeps the scan narrow, which is the only mitigation currently present.
- **Suggested remediation:** fold reconcile into the claim CTE, or run it on a timer (it is also a "cleanup on inactivity" concern: with zero claims anywhere, expired-and-exhausted leases are never terminalized — see §5, hypothesis 2). Optionally add a per-connection rate/scheduler for work methods if load expectations grow.

### B2-P3-04 — `registrationCache` grows without eviction; disabled/decommissioned registrations are only evicted on a miss

- **Status:** open
- **Severity:** P3 (bounded-memory hygiene)
- **Evidence:**
  - `src/agents/helpers/directory.ts:33, 73-78, 191-198` — the cache is a plain `Map`; entries are inserted in `register` (line 91) and in `getRegistration` (line 197); the only deletion is on a *miss*:
    ```ts
    const record = await registrations.getById(agentId);
    if (record === undefined) {
      registrationCache.delete(agentId);
      return undefined;
    }
    ```
  - This slice exposes no deregister/disable API (`disable` exists only inside test fixtures, e.g. `src/tests/agents/fixtures.ts` and `src/tests/work/workService.test.ts:211`), so there is no in-process hook that prunes the cache today.
- **Expected:** any host-managed cache keyed by externally assigned IDs should have a bounded memory story (LRU/TTL or explicit invalidation on removal).
- **Observed:** cardinality grows with the number of distinct agent IDs ever seen by the process; a row disabled externally (future ops path) would keep binding until the miss-driven delete or process restart.
- **Impact:** small per-resident-record cost, unbounded over process lifetime. Not a leak flow in practice for this candidate (registration IDs are few and stable), hence P3.
- **Suggested remediation:** when a remove/disable path lands, invalidate `registrationCache` in the same operation; until then document the cache-as-eventual-source-of-truth vs `getById`.

### B2-P3-05 — `WorkErrorCode` member `"exhausted"` is declared, mapped, and tested, but never produced

- **Status:** open
- **Severity:** P3 (dead contract path / doc alignment)
- **Evidence:**
  - `src/work/types.ts:120`
    ```ts
    | "conflict"
    | "stale"
    | "exhausted";
    ```
  - Wire mapping handles it (`src/websocket/helpers/ahp/agentWork.ts:172-174`), and `src/tests/websocket/agentWork.test.ts:472-474` asserts the mapping for `"exhausted"` — but no production code path constructs `WorkError("exhausted", ...)` (grep over `src/` finds only the type, the mapping, the test, and the README mention `src/work/README.md:13`).
  - `src/persistence/types.ts:135` documents the analogous concept ("Terminalizes expired attempts that have exhausted their retry budget") for the repository — the service never surfaces a corresponding error to callers.
- **Expected:** either the enum member and its test/mapping reflect an actual reachable state (e.g. submitting against or failing an item whose retry budget is spent), or the member is removed to keep the sanitized vocabulary honest.
- **Observed:** a retry-budget-exhausted item is simply unclaimable (`workItems.ts:158`) until `reconcileExpired` terminalizes it on someone's next claim; clients see `stale`/`not_found` shapes, never `exhausted`.
- **Impact:** minor contract surface noise and a test that pins dead behavior; a future implementer might assume the code path exists.
- **Suggested remediation:** remove the member and its shared `case` label, or produce it when `fail`/`get` observe an exhausted-budget item; align `src/work/README.md:13` and the ledger note either way.

### B2-P3-06 — Failure `message` is validated then dropped; no persistence column exists

- **Status:** open
- **Severity:** P3 (observability loss; no contract violation)
- **Evidence:**
  - `src/work/helpers/helpers.ts:277-282` validates `reason.message` (`1..2000`, non-empty)…
    ```ts
    if (typeof reason.retryable !== "boolean"
      || typeof reason.message !== "string"
      || reason.message.length === 0
      || reason.message.length > MAX_FAILURE_MESSAGE_LENGTH) {
      throw new WorkError("invalid", "A bounded failure reason is required.");
    }
    ```
  - …then the repository call at lines 284-290 passes only `retryable`; `repository.fail` (`src/persistence/helpers/workItems.ts:256-299`) takes no message, and `database/migrations/0002_agent_work.sql:19-48` defines no failure-message column. The wire schema additionally bounds it at 512 (`agentWork.ts:55-58`), which is strictly tighter than the service's 2000.
  - This is consistent with the frozen contract: `x-ahp/work/fail` replies `{ status }` only, so persistence of the message was not promised (no ledger/task-plan acceptance row requires it). Hence P3, not contract drift.
- **Expected vs observed:** as specified; the only issue is that the validation is dead weight and the operator-facing "why did this item fail" data is discarded entirely.
- **Impact:** diagnostic information loss (failure reasons live only in the agent's own logs); minor.
- **Suggested remediation:** either persist the message (schema change) and expose it in `work/get`, or delete the message validation/limits and document the intentional discard in the README and ledger so the dropped value is a recorded decision.

### B2-P3-07 — `sessionUri` length is bounded only at the wire layer; `WorkService` and the DDL don't bound it

- **Status:** open
- **Severity:** P3 (defense-in-depth)
- **Evidence:**
  - `src/websocket/helpers/ahp/agentWork.ts:87`
    ```ts
    const boundedSessionUri = sessionUriSchema.max(2_048);
    ```
  - `src/work/helpers/helpers.ts:63-65` (submit) and `200-202` (claim) validate only `typeof … === "string" && length > 0`.
  - `database/migrations/0002_agent_work.sql:21` declares `session_uri TEXT NOT NULL REFERENCES sessions(session_uri) ON DELETE RESTRICT` with no length CHECK; the sessions-side FK correctly guarantees existence, but nothing enforces the 2 KiB ceiling outside the wire extension.
- **Expected:** a service-level bound mirroring the wire limit (defense-in-depth pattern used by the module for kind/requestKey/lease inputs).
- **Observed:** a non-wire caller of the `WorkRepository`/`WorkService` contract (e.g. a future host maintenance path) could submit arbitrarily long `session_uri` values that the schema accepts without warning.
- **Impact:** none reachable today from reviewed paths (all reviewed callers go through the wire parse or derive the URI from the sessions module); hardening only.
- **Suggested remediation:** reuse `sessionUriSchema.max(2_048)` (or a shared constant) inside `WorkService.submit/claim` validation, next to the existing non-empty checks.

### B2-P3-08 — Fixture-vs-SQL divergence for re-registration `displayName`; a test pins fixture semantics as if they were repository truth

- **Status:** open
- **Severity:** P3 (test double fidelity)
- **Evidence:**
  - `src/tests/agents/fixtures.ts:52-55` — re-registering the same (principal, key) returns the pre-existing record unchanged:
    ```ts
    const existing = byKey.get(key);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    ```
  - `src/persistence/helpers/agentRegistrations.ts:37-39` — the real upsert **updates** the name on conflict:
    ```sql
    ON CONFLICT (principal_subject, agent_key)
    DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, agent_registrations.display_name)
    ```
  - `src/tests/agents/directory.test.ts:26-39` — registers with `"Worker"`, re-registers with `"Renamed"` (asserting both repository calls happened at line 33), then pins `displayName: "Worker"` at line 37. Under the Postgres repository the same sequence would resolve `"Renamed"` because `EXCLUDED.display_name` is non-null in the second call.
- **Expected:** the fake repository should mirror the contract of the real one (last-write-wins for a provided name), or the behavioral difference should be covered only by the DB acceptance suite (currently blocked).
- **Observed:** the unit suite hard-pins behavior that production SQL does not have, so a future change that relies on re-register stability of `displayName` would behave differently with the real repository and still pass the unit tests. (Re-registering `enabled` state *is* consistent between both — the SQL conflict update touches only `display_name`, matching the fixture's unchanged record — so the divergence is limited to the name field.)
- **Impact:** latent grammar fork between the test double and the repository under production; neither the current integration test (which binds the real work service with the fake repository, per `src/tests/websocket/agentWork.integration.test.ts` fixture wiring) nor the unit suite can observe the SQL semantics.
- **Suggested remediation:** make `fixtures.ts` replace `displayName` when provided in the upsert path (mirroring `COALESCE`), update `directory.test.ts` accordingly; note it as DB-suite re-check if the blocked environment later becomes available.

## 5. Hypothetical risks (explicitly labeled — not findings)

1. **Hypothetical:** flag-controlled disable-by-DB (an operational path not present in this slice) would leave a cached-but-disabled registration bindable indefinitely, since `bindPresence` only consults `cachedRegistration` and the record refresh happens on `register`/`getRegistration` (`directory.ts:94-105, 191-198`). Speculative because no disable path exists in the candidate; becomes actionable together with B2-P3-04.
2. **Hypothetical:** if a future refactor removes the pre-claim `reconcileExpired()` call without folding expiry into the claim CTE, expired leases that have exhausted their retry budget would never terminalize (the claim CTE's budget filter at `workItems.ts:158` excludes them), leaving sessions with only exhausted work permanently undisposable (`hasDependentWork` counts any row). Speculative as a future-regression note; in the current candidate the coupling exists and works, and the architecture doc's lifecycle section records reconcile as part of every claim.
3. **Hypothetical:** timing side-channel from B2-P3-02 escalating to real-world token forgery would require a co-located attacker and high handshake throughput — listed separately from the finding itself since the candidate's deployment model (host-configured static tokens per env README) makes it low-probability.

## 6. Labeled evidence gaps (not failures; per panel rule, DB setup was not permitted)

- **Real-Postgres acceptance not executed (blocked by user instruction, as anticipated by the task plan's own gates):** claim races among concurrent agents, `DATA-*` and `LEASE-*` DB-anchored scenarios, the `CHECK` constraints of `0002_agent_work.sql` (lines 14-16, 26, 35-41, 42-47), the `FOR UPDATE OF w SKIP LOCKED LIMIT 1` behavior under contention, and cross-principal `get`/`cancel`/`renew`/`complete` outcomes were verified **by code reading only** (statements inspected at `src/persistence/helpers/workItems.ts:56-66, 135-179, 210-248, 255-310, 318-319, 357, 368-387`). No SQL was run; no DB result differences from my expectations were observed or claimable.
- **`src/tests/persistence/` is absent entirely.** No unit tests (even repository-fake-free ones) exercise `mapWork`, `databaseFailure`, JSON type mapping, or `withTransaction` semantics in isolation (`src/persistence/helpers/pool.ts`). These could be tested without a live database connection; their absence is a test-coverage gap, recorded here because P1/P2 severity would be reserved for a demonstrably missing gate that could ship broken behavior — nothing reachable was found to depend on the untested mapping paths in the reviewed code.
- **DB-linked host env from the persistence README (`ahp-postgres`, port 55432) was not applied or connected under the user's instruction**; the env/config parsing was verified instead via `src/tests/env/parse.test.ts` (all pass).
- **`pnpm validate` was not run** (panel rule). Its constituent steps were run separately: `tsc --noEmit`, vitest, lint, `docs:check` — all exit 0, individually listed in §1.
- **Blocked acceptance rows in the task plan remain undisputed,** matching the ledger's own blocked gates; the ledger's claims about those rows were treated as informative, not verified.

## 7. Documentation drift checks (results)

- `docs/architecture/agent-task-lifecycle.md` — honestly labels the SQL-backed gates as blocked (consistent with §6), documents the "rejected while any work row references the session" disposal rule (lines 125, 148), and does not overclaim push behavior for work availability. No drift found.
- `src/work/README.md` — its claim list matches the code, including the fenced renewal semantics and the note that the integration test binds the real work service with a fake repository; the one drift candidate is `"exhausted"` in the error vocabulary (B2-P3-05).
- `src/persistence/README.md`, `src/agents/README.md`, `src/websocket/README.md`, `database/migrations/README.md` — consistent with the code and migration files as read; no drift found beyond the fixtures-vs-SQL nuance in B2-P3-08, which the READMEs themselves do not misstate (the divergence lives in the test double, not the documented contract).

## 8. Final verdict

**PASS**

**Rationale.** The candidate implements the frozen contracts faithfully at every layer I could verify in this environment: (1) the application's authorization architecture routes all identity (agent id, principal, generation, connection) from the authenticated connection and live presence — never from request JSON (`agentWork.ts:198-203, 267-295`; `directory.ts:94-137`); (2) durable-work fencing is a single-CTE claim with `FOR UPDATE OF w SKIP LOCKED`, a same-transaction lease token, DB-clock expiry, budget checks, and cross-principal guard SQL in every mutating path (`workItems.ts:147-178, 216-245, 265-310, 318-319, 357`); (3) idempotent submission has a real conflict semantics (`submit`'s `same_payload` probe, lines 103-128); (4) the wire extension's error mapping and reply shapes match the ledger exactly (`agentWork.ts:129-194`); (5) session-disposal blocking is an intentional, FK-aligned invariant (`workItems.ts:389-394` + `0002_agent_work.sql:21` + README/architecture-documented). Verification parity with the ledger's evidence was reproduced here (281/281 passing tests, lint, tsc, docs:check individually per the panel's prohibition on the combined validate target).

Every concrete imperfection I found is a P3-class hardening gap: one wire-validation asymmetry whose observable symptom is an error-code mismatch (B2-P3-01, unreachable today because the DB path is not live in the test environment), one timing-side-channel hardening note (B2-P3-02), redundant global reconcile per claim (B2-P3-03), an unbounded-registration cache (B2-P3-04), a dead enum member plus a test pinning unreachable behavior (B2-P3-05), the failure `message` being validated then dropped, consistent with the frozen `{ status }` reply contract (B2-P3-06), defense-in-depth only on `sessionUri` length (B2-P3-07), and the fixture-vs-SQL display name divergence being pinned by unit tests as if it were repository semantics (B2-P3-08). None of these break the acceptance gates; none cause incorrect state transitions in the current wiring, and their combined remediation risk is low.

DB-execution acceptance (claim races, CHECK enforcement, cross-principal outcomes under real Postgres) remains an environment-blocked evidence gap shared with the task plan's own blocked gates, per §6; recorded as such, and in accordance with panel rules, it does not default the reviewed code to failing status.

---

**Report:** `docs/review/round-01-b2.md`
**Verdict:** PASS
