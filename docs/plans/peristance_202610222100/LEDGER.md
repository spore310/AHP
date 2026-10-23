# Execution ledger

Design R2. Template status column updated per packet; evidence columns point to
task-local proof only.

| Packet | Status | Candidate | Evidence | Owner | Blocker |
| --- | --- | --- | --- | --- | --- |
| P00 | DONE / VERIFIED FOR PACKET | `agentIdentity` @ `6bd3c5e` (baseline; no source edits) | [BASELINE.md](BASELINE.md) · [handoffs/P00.md](handoffs/P00.md) | GLM 5.3 Flash writer | None |
| P01 | DONE / VERIFIED FOR PACKET | working tree @ `6bd3c5e` (types.ts + provider shape; uncommitted) | [handoffs/P01.md](handoffs/P01.md) · [../src/tests/persistence/contracts.test.ts](../../../src/tests/persistence/contracts.test.ts) | GLM 5.3 Flash writer | None |
| P02 | DONE / VERIFIED FOR PACKET | working tree @ `6bd3c5e` (text.ts portable-text profile; uncommitted) | [handoffs/P02.md](handoffs/P02.md) · [../src/tests/persistence/text.test.ts](../../../src/tests/persistence/text.test.ts) | GLM 5.3 Flash writer | None (V04 consumer wording P09) |
| P03 | DONE / VERIFIED FOR PACKET | working tree @ `6bd3c5e` (adapter connection module; uncommitted) | [handoffs/P03.md](handoffs/P03.md) · [../src/tests/persistence/adapters/postgres/connection.test.ts](../../../src/tests/persistence/adapters/postgres/connection.test.ts) | GLM 5.3 Flash writer | None (legacy pool.ts duplication → P08) |
| P04 | DONE / VERIFIED FOR PACKET | working tree @ `6bd3c5e` (adapter registration/session repository modules; uncommitted) | [handoffs/P04.md](handoffs/P04.md) · [../src/tests/persistence/adapters/postgres/repositories.test.ts](../../../src/tests/persistence/adapters/postgres/repositories.test.ts) | GLM 5.3 Flash writer | None (ensureSession consumed by → P05 on the transaction client) |
| P05 | DONE / VERIFIED FOR PACKET | working tree @ `6bd3c5e` (adapter work repository module; uncommitted) | [handoffs/P05.md](handoffs/P05.md) · [../src/tests/persistence/adapters/postgres/workItems.test.ts](../../../src/tests/persistence/adapters/postgres/workItems.test.ts) | GLM 5.3 Flash writer | None (work adapters consume `ensureSession`/`QueryableClient`; verify per packet) |
| P06 | DONE / VERIFIED FOR PACKET | `agentIdentity` @ `f04be7a` | [handoffs/P06.md](handoffs/P06.md) · selection/provider tests | Codex GPT-6 | None |
| P07 | DONE / VERIFIED FOR PACKET | `agentIdentity` @ `6d6dfc2` | [handoffs/P07.md](handoffs/P07.md) · lifecycle tests | Codex GPT-6 | None |
| P08 | DONE / VERIFIED FOR PACKET | `agentIdentity` @ `a5765ea` | [handoffs/P08.md](handoffs/P08.md) · facade/lifecycle/adapter tests | Codex GPT-6 | Root barrel has compatibility exports until P10 |
| P09 | DONE / VERIFIED FOR PACKET | `agentIdentity` @ pending P09 commit | [handoffs/P09.md](handoffs/P09.md) · domain/wire tests | Codex GPT-6 | None |
| P10 | NOT STARTED | — | — | — | — |
| P11 | NOT STARTED | — | — | — | — |
| P12 | NOT STARTED | — | — | — | — |
| P13 | NOT STARTED | — | — | — | — |

## Contract amendments

None recorded.

## Database authorization

Not granted by this handoff. Real acceptance is NOT RUN. P00 asserted the
boundary: no queries, migrations, provisioning, and no use of any connection
string.

## Findings

Record IDs, exact source locations, evidence and disposition. Do not turn an
unimplemented target into a current-state claim.

- **F-P00-1 (adversarial check, must resolve in facade/wire packets):**
  `src/websocket/helpers/ahp/agentWork.ts:6` value-imports `RepositoryError`
  from the `@persistence` root barrel; the barrel evaluates
  `helpers/pool.ts` → `pg` at import time, so the AHP wire layer loads the
  PostgreSQL driver even when no database is configured. Neutral leaf
  (`@persistence/types`) import is the fix; the C03 dependency rule already
  forbids root-barrel imports by internal helpers. Evidence: BASELINE §3.3.
- **F-P00-2 (pre-existing, record-only):** `DurableSessionInput.sessionTypeKey`
  / `sessionTypeVersion` never persist; `sessionTypeId` is selected but not
  round-tripped (`sessions.ts` map/select). C08 requires this to stay recorded
  until a packet deliberately changes the schema contract. Evidence: BASELINE §2/§6.
- **F-P00-3 (pre-existing, record-only):** `sessions.delete` maps SQLSTATE
  `23503` → `conflict` locally while `pool.databaseFailure` maps `23503` →
  `not_found`; the adapter move must preserve the delete-site classification.
  Evidence: BASELINE §2.
- **F-P00-4 (tasking discrepancy, resolved):** reviewed checkpoint `f280496` is
  HEAD~1 (1 docs-only later commit), not 4 commits back; no impact on the
  plan. Evidence: BASELINE §1.
- **F-P00-5 (wording inventory):** JSONB-named symbols/messages exist in
  `text.ts`, `directory.ts`, `work/helpers/helpers.ts` (+ `@work` re-export),
  `agentWork.ts`, and five asserting test/doc sites; C07 text-message changes
  must be documented against the test titles pinned in BASELINE §3.4.
- **F-P02-1 (debt, owner P09):** `src/persistence/helpers/text.ts` still
  exports the temporary legacy aliases `isJsonbSafeText`/`isJsonbSafe`
  (behavior-identical rebinding of `isPortableText`/`hasPortableTextTree`),
  so all four consumer files and their lint state stay untouched until P09
  migrates them and deletes the aliases; wire/service "JSONB cannot store"
  messages and the `@work` public re-export rename with the same packet.
- **F-P03-1 (debt, owner P08):** pool/transaction/timestamp/SQLSTATE
  mechanics are duplicated — legacy `src/persistence/helpers/pool.ts` (the
  three old repository files, and `src/index.ts`, still import it) and the
  new adapter module `helpers/adapters/postgres/helpers/connection/`.
  `PostgresOptions` is likewise duplicated. P08 deletes the legacy copy after
  the callers migrate; no forwarding shim exists in either direction. As of
  P04 the legacy row interfaces (`AgentRegistrationRow`, `SessionRow`) are
  additionally duplicated into the adapter `types.ts`; same deletion owner.
- **F-P04-1 (P04 review-inbox note):** `ensureSession` — the transaction-local
  session projection primitive — is exported from
  `adapters/postgres/helpers/sessions/helpers.ts` only (deliberately not from
  `sessions/index.ts`). The work adapter (P05) must run it on its own
  transaction client via `withTransaction`, never by calling the public
  `DurableSessionRepository.ensure`, which opens an independent transaction
  and would break `work.submit` atomicity. Also recorded there: SQL parity
  was proven statement-by-statement (7/7 byte-equal modulo whitespace and
  `RETURNING ${SELECT_COLUMNS}` interpolation). Disposition: honored — P05
  imports `ensureSession` from `../sessions/helpers` and runs it on the
  transaction client inside one `withTransaction`; the choice is recorded in
  the P05 handoff with same-client/rollback test evidence.
- **F-P05-1 (characterization, record-only):** on the submit conflict path
  the work module throws INSIDE the transaction callback, so the adapter's
  `withTransaction` ROLLBACKs the whole unit (no COMMIT) — a session
  projection newly written in that same transaction is discarded together
  with the conflict (harmless in practice because the FK guarantees the
  session row already existed). Preserved faithfully from legacy
  `workItems.ts`; pinned by the workItems test. If a future packet ever
  wants conflicting submits to keep the projection, that is a deliberate
  semantic change, not a move artifact.
