# P04 independent review — READ-ONLY

Reviewer: independent read-only reviewer (same role as P00–P03; not the
writer). Date: 2026-10-22. Candidate: `agentIdentity` @ `6bd3c5e4…` + two new
adapter repository modules, rewritten adapter `types.ts`, new tests, README
file-map update. Legacy neutral repositories untouched. Method: full reads of
all moved files against legacy counterparts, an **independent normalized SQL
extraction comparison** (my own script in the approved temp dir, not the
writer's), row-mapping parameter-parity checks, driver-double mutation
analysis, and independent re-runs of all commands.

## Verdict: ACCEPT WITH NOTES

SQL/columns/parameters/mapping/sentinels are parity-faithful; the
transaction-local ensureSession is correctly withheld from the public module
index; D01 is honest. The write-ownership expansion (QueryableClient) is
recorded with reason and is sound. Non-blocking notes for P05 below.

## 1. SQL/column/parameter parity (PG04/PG05) — VERIFIED INDEPENDENTLY

The writer's parity evidence was its own temp script, so I re-derived it: a
Node script extracted every SQL literal (backtick templates plus detection of
the double-quoted DELETE), whitespace-normalized, and compared the legacy
`helpers/agentRegistrations.ts` + `helpers/sessions.ts` multiset against the
moved adapter files.

- **All 6 template statements byte-equal** (normalized): registration
  upsert/RETURNING, registration `$1::uuid` select, sessions INSERT (`$8::jsonb`,
  `ON CONFLICT (session_uri) DO NOTHING`), sessions re-select, GREATEST/CASE
  sequence-monotonic UPDATE, and the second `SELECT ${SELECT_COLUMNS}` variant.
- Both `SELECT_COLUMNS` constants limb-identical per file (registration and
  sessions — no column added/removed/reordered).
- The 7th statement, the double-quoted string in `delete`
  ("DELETE FROM sessions WHERE session_uri = $1 RETURNING session_uri"), is
  character-identical in legacy `sessions.ts:125` and moved
  `sessions/helpers.ts:127` (read both).
- Parameter arrays verified element-wise from the file text: register
  `[principalSubject, agentKey, displayName ?? null]`; getById `[id]`; session
  INSERT's 8 bindings (incl. `JSON.stringify(input.durableState ?? {})`);
  update 4 bindings; get/delete `[sessionUri]`.
- No changed cast, conflict target, guard, or absence sentinel: `$1::uuid`,
  `$2::uuid`/`$5::timestamptz`/`$6::timestamptz`/`$8::jsonb`, conflict targets
  `(principal_subject, agent_key)` and `(session_uri)`, COALESCE upsert, owner
  check **before** update, `GREATEST(modified_at, $2::timestamptz)`,
  `GREATEST(last_server_seq, $3)`, `CASE WHEN $3 >= last_server_seq`, all
  unchanged.

## 2. Mapping parity — VERIFIED

`display_name` null → `undefined` optional; `created_at`/`created_at`-family
`Date | string` → ISO via `toIso`; `last_server_seq` string → `Number`
(`typeof` asserted number in tests); `session_type_id ?? undefined`;
`durable_state` passthrough; `enabled` boolean; work-free (no mapping logic
invented). Error translation sites are identical: register/getById/get/delete
wrap in `try { … } catch { throw databaseFailure(error) }`;
ensureSession's three owned `RepositoryError`s ("lost during insertion",
owner mismatch → `unauthorized`, "could not be updated") moved verbatim;
`delete` 23503 → `conflict` "The session still has dependent work."
special case preserved adapter-privately (F-P00-3 respected), other SQLSTATEs
via the P03 `databaseFailure`.

## 3. ensureSession transaction-locality and P05 viability — VERIFIED

- Exported **only from `sessions/helpers.ts`**; `sessions/index.ts` exports
  just the repository factory — the primitive is unreachable through the
  public factory path (adversarial check satisfied: public `ensure` wraps it
  in exactly one `withTransaction`).
- Signature `database: QueryableClient` (query-only, pg-derived,
  adapter-private in `postgres/types.ts`): the real pg `Pool` (as repository
  factory `PoolLike`) and `PoolClient` are **compile-proven** to satisfy the
  adapter shapes via the exported type assertion `RealDriverShapesMatchAdapter`
  (`[Pool] extends [PoolLike]`, `[PoolClient] extends [QueryableClient]`) —
  `pnpm typecheck` exit 0 proves them, with no runtime assignment or casts.
- P05 path confirmed viable without unsafe casts: `withTransaction`'s client
  is `PoolClientLike` whose `query` member is structurally identical to
  `QueryableClient.query` (additional `release` member is extra, hence
  assignable); the work helper can call `ensureSession(client, input)` on the
  transaction client and pass the same double-tested `PoolLike`/`pool.query`
  surfaces. P05 must import
  `@persistence/helpers/adapters/postgres/helpers/sessions/helpers` (never
  the module index) — exactly the handoff's inbox note.

## 4. Test honesty (20 tests) — NOT TAUTOLOGICAL; one soft spot

- P03 review notes were folded in: the double now records `connectCount()`
  (N1 closed) and the one-client affinity test asserts connect=1, all recorded
  surfaces `["client"]` only, and the exact statement order
  BEGIN/INSER/SELEC/UPDAT/COMMIT.
- Exact normalized SQL text is asserted for: registration INSERT (full),
  getById SELECT (full), session `get` SELECT (full column list — this also
  independently underpins the D01 no-invented-columns claim), and the DELETE
  (exact equality). The monotonic UPDATE is pinned by its three distinctive
  clauses. Element-wise parameter assertions pin bindings for nearly every
  statement; a swapped/refactored statement fails these.
- Mapped-output assertions transform real double rows (snake_case → camelCase,
  `Date`→ISO with exact strings, `"7"` → `7` with number type check, null →
  undefined, `undefined` durableState → `"{}"`), so echoing cannot satisfy
  them. Absence sentinels (`undefined`, `delete` true/false), owner-mismatch
  → unauthorized, vanished row → database, 23505 → conflict, 23503 → conflict,
  42P01 → database are all exact-value or exact-message pins.
- **Soft spot (N1):** the session INSERT's full text is only prefix-checked
  (`slice(0, 6)` = "INSERT") plus parameter values — the test does not assert
  its distinctive clauses the way the registration INSERT does. Mitigated by
  my independent byte-parity proof (§1), so nothing escapes today; recommend
  adding the normalized INSERT text when the file is next touched.
- **Near-tautology acknowledged:** the F-P00-2 runtime check
  (`row).not.toHaveProperty("session_type_key"…)`) pins the test's own
  fixture, but the substantive pins are the exact `SELECT_COLUMNS` text
  (§4 second bullet) plus the `SessionRow` type — harmless as written.

## 5. D01 honesty — VERIFIED

No DDL change (`git diff -- database/migrations` empty, exit 0); no invented
columns (`SessionRow` holds only legacy shapes; INSERT/SELECT column lists
byte-parity); `postgres/types.ts` and `postgres/README.md` both explicitly
state the sessionTypeKey/Version non-persistence and no-round-trip limitation;
no claim of full session recovery anywhere in the new files or README.

## 6. Scope and commands — VERIFIED

- `git status --short`: prior P01/P02/P03 candidate files unchanged + untracked
  bundle, `adapters/`, `tests/persistence/`. `git diff` on
  `pool.ts`/`agentRegistrations.ts`/`sessions.ts`/`workItems.ts`/`index.ts` is
  **empty** (legacy repositories byte-untouched, no shim). No provider/facade
  file exists (`postgres/index.ts` still absent; only the 9 adapter files, 4
  new this packet — two `agentRegistrations`, two `sessions`).
- The recorded ownership expansion (`QueryableClient` + row types in
  adapter `postgres/types.ts`, two README file-map rows) follows the packet's
  "record the reason and dependency impact" clause: the reason cites P03
  review N2 verbatim, the direction of dependency is documented, and the
  capability never touches the neutral root. Acceptable and honestly labeled.
- The parity scripts live in the writer's temp dir only (not committed) —
  matches this reviewer's own practice; repo clean.

| Command | Result |
| --- | --- |
| `pnpm typecheck` | **exit 0** (includes the `RealDriverShapesMatchAdapter` compile proof) |
| `pnpm exec vitest run src/tests/persistence/adapters/postgres/repositories.test.ts` | **exit 0, 1 file / 20 tests** — matches handoff |
| `pnpm run docs:check` | **exit 0, "105 source files mapped"** (101 + the 4 new repository module files) |
| `pnpm exec eslint src/persistence/helpers/adapters src/tests/persistence/adapters --max-warnings 0` | **exit 0** |
| `pnpm validate` | **exit 0**: lint ✓, typecheck ✓, vitest **44 files / 364 tests** (P03 state 43/344 + exactly 1/20), docs gate 105 ✓, vite build 87 modules, `dist/index.js 186.23 kB` (unchanged — no neutral edge reaches the adapter yet) |
| `git diff -- database/migrations` | empty (exit 0) |

Baseline-vs-new separation: final state **no failures**; the handoff's
disclosed intermediate defects (double shape, control-statement queue
desync caught by the affinity test, imports/typing/lint) are consistent with
the final strict iterates.

## 7. Notes and blocking findings for P05

No blocker. Recorded notes:

- **N1 — test strengthening:** assert the session INSERT's full normalized
  text (distinctive `$8::jsonb`, `ON CONFLICT (session_uri) DO NOTHING`,
  RETURNING list) when the repository test file is next touched; my own
  parity proof covers today's equivalence.
- **N2 — P05 imports:** `ensureSession` from the sessions **helpers** module;
  repository factories consume `PoolLike`/`QueryableClient` (not legacy
  `Queryable`, which remains unused — intentional per the handoff and tracked
  for a later cleanup decision).
- **N3 — bookkeeping:** ACCEPTANCE_MATRIX.md PG04–PG06/D01 rows still NOT RUN
  (standing sync note); LEDGER has the P04 row and carries the duplication
  debt items. The README's "provider factory arrive with P06/P10" wording
  slightly compresses TASKPLAN's P04–P06/P10 staging — cosmetic, sync at P06.
- Half of the note is confirmation, not complaint: the packet's adversarial
  case (public `ensure` from work would open an independent transaction) is
  structurally prevented until P05 chooses the helpers import — keep that
  choice in P05's evidence.

Clean handoff to P05 (work repository adapter).
