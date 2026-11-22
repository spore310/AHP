# Round 01 — Adversarial Review B1

- Reviewer ID: **B1**
- Independence: **Blind and independent.** This report was written without
  reading `docs/review/round-01-a1.md`, `docs/review/round-01-a2.md`, or any
  other reviewer file. Only `docs/review/00-panel.md` (panel rules), the
  plan/schema/ledger documents, repository rules, and source under the assigned
  scope were read.
- Candidate: commit `7038a08a46321885f4a4c418f3f3cb5f7f87eb03` on branch
  `agentIdentity` (verified `git rev-parse HEAD` = same hash). The worktree is
  clean except untracked `docs/review/` (panel files).
- Review mode: read-only. No migrations, SQL, installs, commits, or edits to
  source/tests/docs were performed. `pnpm validate` was **not** run (per
  instruction); focused non-mutating checks were run instead.

## 1. Files and areas inspected

| Area | Files |
| --- | --- |
| Plans / rules | `docs/review/00-panel.md`, `docs/plans/agent tasks and identity/M2_AGENT_IDENTITY_WORK_LEASING_TASKPLAN.md`, `docs/plans/agent tasks and identity/M2_AGENT_WORK_DATABASE_SCHEMA.md`, `docs/plans/agent tasks and identity/IMPLEMENTATION_LEDGER.md`, `.agents/AGENTS.md`, `docs/CodingRules.md` |
| Agents module | `src/agents/types.ts`, `index.ts`, `constants.ts`, `helpers/directory.ts`, `helpers/authenticator.ts`, `helpers/errors.ts` |
| Work module | `src/work/types.ts`, `index.ts`, `helpers/helpers.ts`, `helpers/errors.ts` |
| Persistence module | `src/persistence/types.ts`, `index.ts`, `helpers/pool.ts`, `helpers/agentRegistrations.ts`, `helpers/sessions.ts`, `helpers/workItems.ts` |
| Database | `database/migrations/0001_session_tool_baseline.sql`, `0002_agent_work.sql`, `database/migrations/README.md` |
| Coupled websocket paths | `src/websocket/types.ts`, `helpers/server.ts`, `helpers/connection.ts`, `helpers/ahp/helpers.ts`, `helpers/ahp/agentWork.ts`, `helpers/ahp/types.ts`, `helpers/ahp/constants.ts`, `helpers/host/helpers.ts`, `helpers/host/types.ts`, `helpers/host/index.ts`, `src/websocket/constants.ts`, module `index.ts` files |
| Sessions/coupled types | `src/sessions/types.ts` (`sessionUriSchema`), `src/sessions/helpers/factory/helpers.ts`, `src/sessions/createSession/helpers.ts`, `src/sessions/helpers/errors/helpers.ts` |
| Composition / env | `src/index.ts`, `env/types.ts`, `env/parse.ts`, `env/helpers.ts`, `tsconfig.json`, `package.json` |
| Tests | `src/tests/agents/directory.test.ts`, `src/tests/agents/authenticator.test.ts`, `src/tests/agents/fixtures.ts`, `src/tests/work/workService.test.ts`, `src/tests/websocket/agentWork.test.ts`, `agentWork.binding.test.ts`, `agentWork.transport.test.ts`, `agentWork.integration.test.ts`, `src/tests/websocket/composition.test.ts` |
| Docs truth | `src/agents/README.md`, `src/work/README.md`, `src/persistence/README.md`, `src/websocket/README.md` (agent/work sections), `src/README.md`, `README.md` (diff), `docs/architecture/agent-task-lifecycle.md`, `docs/technical/wire-contract.md` and `runtime-lifecycles.md` (diffs) |

## 2. Commands run and outcomes

| Command | Outcome |
| --- | --- |
| `git log --oneline -5; git rev-parse HEAD; git branch --show-current` | HEAD = `7038a08a…eb03`, branch `agentIdentity` |
| `git status --short` | Only `?? docs/review/` (untracked panel files); candidate tree otherwise clean |
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm exec vitest run src/tests/agents src/tests/work/workService.test.ts src/tests/websocket/agentWork.test.ts src/tests/websocket/agentWork.binding.test.ts src/tests/websocket/agentWork.transport.test.ts src/tests/websocket/agentWork.integration.test.ts --reporter=dot` | 7 files / 44 tests passed |
| `pnpm exec vitest run src/tests/websocket src/tests/sessions src/tests/toolClient src/tests/toolClient.test.ts src/tests/env/parse.test.ts --reporter=dot` | 26 files / 190 tests passed (baseline + extension regression check) |
| `pnpm exec eslint src/agents src/work src/persistence src/websocket/helpers/ahp src/websocket/helpers/connection.ts src/websocket/helpers/server.ts src/websocket/helpers/host src/tests/agents src/tests/work src/tests/websocket/agentWork*.test.ts --max-warnings 0` | exit 0 |
| `pnpm exec vite-node scripts/check-docs.ts` | "Documentation gate passed: 95 source files mapped" |
| `git show --stat 7038a08a…` | Change inventory confirmed; all diff paths reviewed above |

PostgreSQL migrations/tests were **not** executed (user instruction + panel rule
7). The PostgreSQL adapters were reviewed statically only; this is recorded as
an evidence gap, not a code failure.

## 3. Findings

**No P1 or P2 findings.** Every attack path probed (auth spoofing, cross-principal
work access, stale-token completion, generation hijack, duplicate claim, replay
submission, disposal conflicts, error leakage, state changes on rejected calls)
either fails closed at the domain/service layer or is fenced in SQL. The probes
that were rejected as candidate defects are summarized so the coordinator can
re-verify the reasoning; the remaining quality items are P3 and hypothetical
risks, explicitly labeled.

### B1-P3-01 — Wire payload bounds are looser than the work-service bounds, and the result-shape schemas disagree

- status: open
- Evidence:
  - `src/websocket/helpers/ahp/constants.ts:82` —
    `MAX_AGENT_WORK_PAYLOAD_BYTES = 1_048_576`; wire schemas
    `boundedObject`/`boundedJson` (`src/websocket/helpers/ahp/agentWork.ts:60-77`)
    accept ≈1 MiB input and result.
  - `src/work/helpers/helpers.ts:13-14` — service defaults
    `DEFAULT_MAX_INPUT_BYTES = 64 * 1024`, `DEFAULT_MAX_RESULT_BYTES = 256 * 1024`.
  - Host composition (`src/websocket/helpers/host/helpers.ts:80-97`) creates the
    work service **without** `maxInputBytes`/`maxResultBytes`, so the defaults
    apply on the wire. A correctly shaped ≤1 MiB `x-ahp/work/submit` input is
    accepted by Zod, then rejected by the service with
    `WorkError("invalid")` → `-32602 "Request rejected"`; same for a ≤1 MiB
    result on `x-ahp/work/complete`.
  - Secondary shape mismatch: the wire `result: boundedJson` accepts JSON
    arrays/scalars (only size-checked), while `complete` in
    `src/work/helpers/helpers.ts:249-256` requires a JSON object → again
    `-32602` after the wire schema already accepted the request.
  - No test pins the real composed input/result limits at the adapter boundary
    (`src/tests/work/workService.test.ts:115-116` overrides both limits to 256
    bytes for unit tests only).
- Impact: functional inconsistency and client compliance friction only. The
  mismatch fails closed before any SQL runs; no size-based DoS, no truncation,
  no silent data change. Direction of error is always "reject", never "accept
  unbounded payload" (frame cap 1 MiB also applies at
  `src/websocket/constants.ts:8`).
- Suggested fix: pass explicit `maxInputBytes`/`maxResultBytes` (or a shared
  constants module) so the wire schemas and service limits agree, and tighten
  `completeSchema.result` to a bounded object to mirror the service rule. Add a
  boundary test at the composed server.

### B1-P3-02 — Agent-directory registration cache cannot observe an external `enabled` flip

- status: open
- Evidence: `src/agents/helpers/directory.ts:33` (`registrationCache`),
  `69-78` (`cachedRegistration`/`rememberRegistration`), `99-105` (`bindPresence`
  consults **only** the cache: `cachedRegistration(agentId)`), `191-198`
  (`getRegistration` refreshes it only when called). Entries are evicted only
  when `getById` returns `undefined`.
- Impact: **hypothetical today** — the candidate has no path that disables a
  registration after it was cached (no admin/tooling exists in this slice; the
  registration upsert preserves `enabled`). If an external process flips
  `enabled = FALSE` on `agent_registrations`, `bindPresence` could still admit a
  presence binding from a stale cached record. Work mutations cannot be abused
  this way: every work mutation re-reads the registration from the database
  (`src/work/helpers/helpers.ts:101-110`, `enabledAgent`), so claims/renewals/
  completions still fail closed. Witnessed in tests: the disabled-registration
  test must call `getRegistration` first to refresh the cache
  (`src/tests/agents/directory.test.ts:72-80`), which only works because the
  fixture stores the disabled record via the test handle — production has no
  equivalent refresher.
- Suggested fix (when a disable path lands): make `bindPresence` consult the
  repository (or add TTL/negative-cache semantics), or document the
  registration-cache staleness assumption in `src/agents/README.md`.

### B1-P3-03 — Per-agent work-kind eligibility is not implemented; a plan requirement rests on a global allow-list

- status: open
- Evidence:
  - Task plan §1 ("Authorize the principal + session + operation + agent
    registration + task kind"), §3 Stage 3 item 3 ("bounded `work.kind`
    eligibility **per registered worker**"), and Stage 5 test `LEASE-03`
    ("Agent lacks work-kind permission → No claim issued").
  - Implementation: `src/work/helpers/helpers.ts:206-210` — claim passes
    `kinds: [...options.allowedKinds].sort()`, one **global** set from
    `AGENT_HOSTING_PROTOCOL_ALLOWED_WORK_KINDS` (`env/parse.ts:40-54`);
    `agent_registrations` has no kind policy and `WorkRepository` has no
    per-agent kind input.
  - `docs/plans/agent tasks and identity/IMPLEMENTATION_LEDGER.md:35` records
    the frozen decision as a global configurable set, so the deviation is
    documented by the implementers — but the architecture page
    (`docs/architecture/agent-task-lifecycle.md`) does not explicitly say that
    kind eligibility is host-global rather than per-agent.
- Impact: no privilege escalation (kinds are still server policy, and the
  same-principal session-owner rule bounds cross-target impact), but `LEASE-03`
  cannot be satisfied as written and a future per-agent grant model would be a
  contract change, not a configuration task.
- Suggested fix/verification: either state in
  `docs/architecture/agent-task-lifecycle.md` (not-implemented/deferred list)
  that kind eligibility is host-global for V1, or implement per-agent kind sets;
  do not leave LEASE-03 silently open.

### B1-P3-04 — Tiny live-dispose vs in-flight-submit window can orphan a durable session row

- status: open
- Evidence: `x-ahp/work/submit` reads the live snapshot and registry owner
  synchronously (`src/websocket/helpers/ahp/agentWork.ts:318-337`, host
  projection `src/websocket/helpers/host/helpers.ts:85-94`), then awaits the
  repository. In `src/persistence/helpers/workItems.ts:79-133`, `submit`
  runs `ensureSession` and inserts the work row inside one transaction. If a
  concurrent `disposeSession` deletes the live session *between* the snapshot
  read and the SQL commit (live dispose path:
  `src/websocket/helpers/ahp/helpers.ts:382-398`; `src/sessions/helpers/factory/helpers.ts:194-222`),
  the durable `sessions` row and the queued `work_items` row are committed for a
  session that no longer exists live.
- Impact: bounded and fail-safe. The orphaned work stays claimable with correct
  ownership (`rew`/`complete`/`cancel`/`get` all re-join
  `sessions.owner_principal_subject`, `src/persistence/helpers/workItems.ts:56-66, 205-366`),
  cancellation keeps working, and no data is lost. Disposal of the session is
  permanently rejected thereafter only because dependent-work policy already
  rejects disposal for any referenced row (see B1-P3-05). No fencing invariant is
  violated; an attacker gains nothing (their principal is still the recorded
  owner). Requires race in the sub-millisecond shared window across two
  connections.
- Suggested fix/verification (hardening only): re-check
  `sessions.owner(sessionUri)` after the repository `submit` resolves (or
  re-fetch the live snapshot inside the repository call) and treat a vanished
  owner as a conflict; add a directed test that interleaves `disposeSession`
  and `submit`.

### B1-P3-05 — Sessions that ever received work can never be disposed, and no code path ever deletes durable rows (accepted policy; permanent state growth)

- status: open (policy confirmed as implemented-and-documented; growth note)
- Evidence: `hasDependentWork` returns true for **any** work row including
  terminal ones (`src/persistence/helpers/workItems.ts:389-399`), disposal
  rejects with `Conflict` (`src/work/helpers/helpers.ts:328-336`,
  `src/websocket/helpers/ahp/helpers.ts:391`), and `DurableSessionRepository.delete`
  (`src/persistence/helpers/sessions.ts:122-136`) has **no caller** in `src/`
  (grep: only references within the module and tests). Grep confirms there is no
  delete path for `work_items` either (cancel/fail/reconcile only mutate status).
- Impact: matches the frozen ledger decision ("Session disposal: Rejected while
  any work row references the session") and the schema invariant 11 (no cascade
  until a retention policy exists), so this is **not** a defect. Practical
  consequence worth tracking: one work-enabled session makes `sessionOwners`
  keep the owner entry after a rejected disposal, and both `sessions` and
  `work_items` grow monotonically with use. No unbounded per-connection memory
  was found (peers, presence, and registration caches are all keyed/bounded by
  actual agents/connections; frame queue is capped at 256,
  `src/websocket/helpers/connection.ts:403-406`).
- Suggested follow-up: the retain/cancel-and-archive retention policy must land
  before production use; note it in the architecture page's not-implemented
  list to keep future readers from assuming deletion exists.

### B1-P3-06 — `sessionOwners.bind` failure would map a policy rejection to `InternalError`; currently unreachable

- status: open (hygiene, hypothetical)
- Evidence: `src/websocket/helpers/ahp/helpers.ts:371-380` binds the created
  session after `factory.createSession` resolves. If `bind` throws
  (`src/work/helpers/helpers.ts:140-146` raises a plain `Error("The session
  already belongs to another principal.")`), `sendMappedError`
  (`src/websocket/helpers/connection.ts:127-139`) would answer
  `-32603 "Internal error"` and — worse ordering — after the live session was
  already successfully created.
- Impact: **not reachable in the current candidate.** The sessions factory
  rejects duplicate live URIs synchronously before registration
  (`src/sessions/createSession/helpers.ts:57-62`, no `await` between the
  exists-check and `sessions.add`), and both disposal paths unbind
  (`src/websocket/helpers/ahp/helpers.ts:396`,
  `src/websocket/helpers/host/helpers.ts:158-169`), so the conflicting-owner
  state for a brand-new URI cannot arise. This finding documents the failure
  shape so a future refactor does not silently enable it.
- Suggested fix (when touched): move the owner bind next to session creation
  using a mapped public error (e.g. `AhpErrorCodes.Conflict`) or make the bind
  part of the factory result transaction.

### B1-P3-07 — Dead code: unproducible `exhausted` wire code and unused `WorkViewSource`

- status: open
- Evidence: `WorkErrorCode` includes `"exhausted"`
  (`src/work/types.ts:114-120`) and `mapWorkError` (`agentWork.ts:162-181`)
  maps it, but nothing in `src/work/` or `src/persistence/` produces a
  `WorkError("exhausted")` — attempt exhaustion is terminalized by
  `reconcileExpired` → status `failed` (`src/persistence/helpers/workItems.ts:368-387`)
  and retryable failures return `queued`/`failed` directly
  (`src/work/helpers/helpers.ts:283-298`). `WorkViewSource`
  (`src/work/types.ts:122-124`) is exported but unused.
- Impact: cosmetic; a maintained-but-un exercised mapping keeps future
  exhausted-code producers from having to re-derive the wire behavior. No test
  gap results (the stale mapping is tested for both `stale` and `exhausted`,
  `src/tests/websocket/agentWork.test.ts:472-488`).
- Suggested fix: either produce the code from a genuine path (e.g. rejection at
  claim-in above the max-attempt threshold) or document it as reserved in
  `src/work/README.md`.

## 4. Hypothetical risks (explicitly not established by the candidate state)

- **Bearer-token map lookups are not constant-time**
  (`src/agents/helpers/authenticator.ts:56-57`, plain `Map.get`). A timing
  oracle against a large token list would require sustained network access and
  adaptive measurement; the candidate documents loopback-only `ws` defaults and
  POC-grade tokens (`src/agents/README.md:60-62`,
  `docs/architecture/agent-task-lifecycle.md:152-155`), and
  `env/types.ts:14` defaults the host to `127.0.0.1`. Not exercised by any test
  here; listed only so a production hardening pass considers it.
- **Multi-host deployments sharing one database.** Presence is deliberately
  process-local (`src/agents/README.md:41-44`), so two AHP host processes
  against one PostgreSQL would each enforce their own presence bindings while
  sharing durable work (leases remain SQL-fenced). The candidate is labeled
  single-node; this is documented, not tested.
- **Registration `display_name` can only be replaced, never cleared** via
  re-register (`src/persistence/helpers/agentRegistrations.ts:37-39`,
  `COALESCE(EXCLUDED.display_name, …)`). Cosmetic; identities do not depend on
  it.

## 5. Evidence gaps (recorded per panel rule 7, not treated as failures)

1. **PostgreSQL runtime acceptance is unverified.** The migrations
   (`database/migrations/0001_session_tool_baseline.sql`, `0002_agent_work.sql`),
   the `pg` adapters (`src/persistence/helpers/*.ts`), and the claim/renew/
   complete/fail/cancel/reconcile SQL were reviewed statically only. The
   repository's own documents consistently say the same
   (`database/migrations/README.md:3-7`, `src/persistence/README.md:57-63`,
   `docs/architecture/agent-task-lifecycle.md:166-176`,
   `IMPLEMENTATION_LEDGER.md:102-115`), so there is no documentation drift, but
   the SQL correctness conclusions in this report are **analysis, not executed
   proof**. When a disposable database is approved, priority probes:
   concurrent `SKIP LOCKED` claim race (two pools), `same_payload` replay vs
   conflict (DATA-04/05), CHECK-constraint lease-field shape (LEASE-13), and
   `FOR UPDATE OF w` waiting behavior in `fail`/`cancel` under contention.
2. **No automated test executes any `createPostgres*Repository` factory.** The
   integration test `src/tests/websocket/agentWork.integration.test.ts:47-107`
   substitutes in-memory fakes for `WorkRepository`; there is no
   `src/tests/persistence/` directory. Unit tests for the SQL-error
   classification (`databaseFailure` mapping of 23505/23503/22P02,
   `src/persistence/helpers/pool.ts:41-55`) and the guarded
   `ensureSession` update (`src/persistence/helpers/sessions.ts:80-96`) are
   absent.
3. **Restart/recovery paths (REC-01/02/03) are untested** because durable rows
   cannot be exercised in-process; only the fakes simulate them. Presence loss
   after restart is process-local by construction, so the risk is limited to
   SQL semantics, which are also runtime-unverified (see item 1).

## 6. Probes that yielded no candidate defects (verifications, for the record)

- **Principal/identity fencing.** `TrustedHandshakeContext` reads only the
  upgrade `Authorization` header; ambiguous/duplicate headers are rejected
  (`src/agents/helpers/authenticator.ts:10-25`); `initialize.clientId` is stored
  only on the peer record and never used for authorization
  (`src/websocket/helpers/ahp/helpers.ts:303`,
  `src/tests/websocket/agentWork.transport.test.ts:123-201`). Absent or unknown
  credentials leave `principal === undefined` and every agent/work handler
  throws `Authentication required` before touching state
  (`agentWork.ts:207-213`, test: `agentWork.test.ts:151-176`).
- **One-binding-per-agent / one-agent-per-connection.**
  `bindPresence` denies a live different connection, is idempotent for the
  current one, denies a second agent on one connection, and bumps
  `generations` for every takeover
  (`src/agents/helpers/directory.ts:94-137`; tests
  `directory.test.ts:84-143`). `presentAgent`
  (`src/work/helpers/helpers.ts:86-99`) re-binds each mutation to the exact
  `agentId + principal + connectionId + generation + unexpired` binding, and the
  wire handler builds `AuthorizedAgentContext` server-side only —
  `claim/renew/complete/fail` schemas (`agentWork.ts:98-127`) expose no field a
  client could use to inject identity.
- **Close/dispose fencing.** `removeBinding` matches
  connectionId+generation+principal, so a late close callback of an old
  generation cannot remove a newer binding
  (`directory.ts:35-55`; test `directory.test.ts:128-143`). `releaseConnection`
  clears only that connection's bindings
  (`directory.ts:166-174`; `agentWork.ts:430-437`, `ahp/helpers.ts:464-475`,
  `511-516`); duplicate close callbacks are guarded (`peer.closeNotified`).
- **SQL fencing and state machine.** The claim CTE uses
  `FOR UPDATE OF w SKIP LOCKED` with eligibility gates
  (`queued` or expired-`leased`, attempt budget, target match, owner match,
  enabled registration) and rotates `lease_token` server-side
  (`workItems.ts:135-203`), matching the reference SQL in
  `database/M2_AGENT_WORK_DATABASE_SCHEMA.md:268-300` and the lease-shape
  CHECK in `database/migrations/0002_agent_work.sql:42-47`. `renew`/`complete`
  are single fenced conditional updates including the
  `principalGuard` (agent-belonging + session-owner subqueries,
  `workItems.ts:56-66, 205-254`). `fail` locks the row (`FOR UPDATE OF w`) and
  clears lease fields in the same transaction (`workItems.ts:256-308`). `cancel`
  is idempotent for terminal rows and clears a live lease
  (`workItems.ts:310-348`). Boundary operators do not overlap: claim takes
  `lease_expires_at <= statement_timestamp()`, renew/complete require `>`.
- **Idempotent submission.** `ON CONFLICT … DO NOTHING` then a committed-row
  compare of `kind`, `input` (JSONB deep equality), and target
  (`workItems.ts:79-133`); a differing payload raises `conflict` without
  mutation. Service/wire error mapping keeps both outcomes indistinguishable to
  a foreign caller (`agentWork.ts:149-181` maps `not_found` and `unauthorized`
  to the same generic `InvalidParams`; `WorkError` messages are static strings).
- **Ownership boundaries.** Session creation binds only with a principal
  (`ahp/helpers.ts:371-380`; test `agentWork.binding.test.ts:157-166`); disposal
  requires the bound owner and rejects dependent work
  (`ahp/helpers.ts:382-398`; tests `agentWork.binding.test.ts:168-224`);
  submissions target-capable of another principal return a generic rejection
  after an ownership check (`workService.test.ts:161-172`); `get` never returns
  lease tokens or holder IDs (`src/tests/work/workService.test.ts:250-255`,
  `agentWork.integration.test.ts:232-237`).
- **Lease semantics vs presence.** `reconcileExpired` terminalizes only
  budget-exhausted expired leases and is called per claim
  (`workItems.ts:368-387`; `src/work/helpers/helpers.ts:203-204`); a worker
  disconnect does not delete the row or its lease (nothing does), matching
  LEASE-14/PRES-04 semantics in the plan.
- **Baseline regressions.** Full websocket/sessions/toolClient suites pass
  (190 tests), including the untouched `x-ahp/tools/*` bridge, SDK interop, and
  session-type behavior.

## 7. Verdict

**PASS**

Rationale, based only on the candidate at
`7038a08a46321885f4a4c418f3f3cb5f7f87eb03`: the implementation satisfies the
review target's authorization, fencing, persistence, and protocol requirements
in the inspected code, and all focused checks pass (typecheck, 44 + 190 scoped
tests, lint, documentation gate). No P1 or P2 defect was found. The seven P3
findings are quality/hardening/documentation items that do not block by
themselves; three of them are explicitly hypothetical because the candidate
does not establish the preconditions. PostgreSQL runtime behavior remains an
accurately recorded evidence gap (user-blocked, per panel rule 7) — it is not
claimed as passing and does not, by itself, justify `CHANGES REQUIRED` because
the repository docs and the ledger consistently label SQL acceptance as
**BLOCKED, not passed**.

---

Report file: `docs/review/round-01-b1.md` — Verdict: **PASS** (reviewer B1,
blind and independent).
