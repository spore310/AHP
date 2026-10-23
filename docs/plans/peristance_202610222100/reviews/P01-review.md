# P01 independent review — READ-ONLY

Reviewer: independent read-only reviewer (same role as the P00 review; not the
writer). Date: 2026-10-22. Candidate: `agentIdentity` @ `6bd3c5e4…` (HEAD
unchanged) + working tree: `src/persistence/types.ts` (+18),
`src/persistence/README.md` (+18), untracked `src/tests/persistence/contracts.test.ts`.
Method: git diff inspection, verbatim comparison against CORE_CONTRACT C01–C03,
direct reading of the fixture, and independent re-runs of all claimed checks.

## Verdict: ACCEPT WITH NOTES

The contract freeze is real, insertion-only, verbatim to C02, and the fixture
would not pass a provider that grows vendor-flavored members. None of the notes
block P02/P03.

## 1. Contract conformance (C01/C02) — VERIFIED

`git diff -- src/persistence/types.ts` shows exactly one hunk, insertion-only
(+18, 0 deletions):

- `PersistenceRepositories` — body identical to C02's block: the three
  `readonly` namespaces in the same order (`registrations`, `sessions`, `work`),
  same member types, no extras. The added doc comment reproduces the C02/C05
  one-store rule and the `work.submit` atomic-unit rule (declared requirement,
  not new policy).
- `PersistenceProvider extends PersistenceRepositories` with exactly
  `dispose(): Promise<void>`; its doc comment is C02 verbatim.

No existing code moved or changed: `WorkStatus`, all DTO shapes (including the
optional `sessionTypeId`/`sessionTypeKey`/`sessionTypeVersion` and work-record
optionals), the three repository interfaces and their nine/six/two operations,
`RepositoryErrorCode`'s four values, and the `RepositoryError` class are byte-
identical to the P00-verified state. `src/persistence/index.ts` is untouched →
**no concrete export removed** (correct; removal belongs to P08–P10).

## 2. Fixture quality (C02/C03 freeze, adversarial check) — VERIFIED

Read in full; `src/tests/persistence/` contains only `contracts.test.ts`.

- No `any`, no unsafe casts (`as` only on literal `const` arrays), no `as
  unknown`; imports are `vitest` + `@persistence/types` only; **zero `pg`
  import**; no `@persistence` root-barrel import.
- Exact key sets are asserted twice for the provider: type-level
  `ExactKeys<PersistenceProvider, keyof PersistenceRepositories | "dispose">`
  (both directions: all expected keys present, no extras) plus
  `NoIndexSignature`, and runtime `Object.keys(provider).sort()` equality.
  Repository operation sets are asserted by exact sorted key lists
  (2 / 3 / 9 operations).
- Distinct sentinels are asserted both by stub return values (`undefined`,
  `undefined`, `null`, `false`) and by `Expect`-style type checks on each
  miss-returning signature.
- Vendor-boundary exclusion: type-level
  `Extract<keyof PersistenceProvider, ProhibitedPersistenceBoundaryKeys>`
  extends `never` over 14 prohibited names (`pool`, `query`, `connect`,
  `connectAsync`, `transaction`, `transactionClient`, `client`, `engine`,
  `orm`, `model`, `schema`, `dialect`, `adapter`, `sql`), and the runtime loop
  asserts `key in provider === false`. `PositionalOf` mutual-assignability
  binds each namespace to the exact existing repository type, so a namespace
  gaining or losing an operation fails typecheck. The packet's adversarial
  case (driver exposing `Pool` or an ORM transaction) is caught at the type
  level; `pnpm typecheck` runs inside the gate, so it is enforced, not
  decorative.
- No weak assertions found: the only methods that "return" values are the
  miss-sentinels; every other stub rejects with
  "Contract fixture does not implement …", and one test asserts those
  rejections. No stub fakes success.

Minor observation (not a defect): the runtime prohibited-key loop enumerates 8
of the 14 names (omits `connectAsync`, `transactionClient`, `client`,
`dialect`, `adapter`, `sql`); the remaining six are still enforced by the
type-level check. Acceptable as an additive runtime spot-check.

## 3. README addition — PASS

`git diff -- src/persistence/README.md` is insertion-only (+18): a new
"Provider contract" section declaring the two type shapes and the atomic-unit
rule. Wording is declaration ("types.ts additionally declares…"), not a claim
that an adapter registry, provider factory, or facade exists. The JSONB rows,
API list, and all other sections are untouched. One wording nit (N2): the
closing sentence mentions "the public `sessions.ensure` facade" — a facade
does not exist until P08; the section context makes this a rule statement, but
P08/P09 should not be judged against it as a current-state claim.

## 4. Commands re-run — exact results

| Command | Result |
| --- | --- |
| `pnpm typecheck` | **exit 0** (`tsc --noEmit`, no errors) |
| `pnpm exec vitest run src/tests/persistence/contracts.test.ts` | **exit 0**, `1 passed (1)` file, `6 passed (6)` tests, 205ms — matches handoff (6 tests) |
| `pnpm exec eslint src/tests/persistence/contracts.test.ts src/persistence/types.ts --max-warnings 0` | **exit 0** |
| `pnpm validate` | **exit 0**: lint ✓, typecheck ✓, vitest **41 files / 318 tests** (baseline 40/312 + exactly the new fixture's 1 file/6 tests), docs gate "97 source files mapped" (unchanged), vite build 87 modules, `dist/index.js 185.09 kB` |

Baseline-vs-new failure separation: re-run found **no failures at all** in the
final state. The handoff's admission of two writer-owned intermediate test
failures (key-list defects, sync-throw stubs) and one `verbatimModuleSyntax`
TS1484 pair, all disclosed and fixed before freeze, is honest and consistent
with the final green state; no assertion was weakened — the final fixture is
strict, not permissive.

Pre-existing conditions (not P01 failures): the F-P00-1 transitive-`pg` chain
via the root barrel still exists by design (index.ts untouched); the runtime
build graph is unchanged (87 modules, same output size).

## 5. Scope discipline — VERIFIED

`git status --short`: `M src/persistence/README.md`, `M src/persistence/types.ts`,
`?? src/tests/persistence/`, `?? docs/plans/peristance_202610222100/`. No
migrations, env, scripts, manifest, or lockfile changes; no other source file
touched. The plan_bundle `BASELINE.md` glyph fix was confirmed independently:
`rg "职"` over the bundle returns no matches (BASELINE line 50 now reads
"`hasDependentWork`: `EXISTS` incl. terminal rows"); the fix is confined to
that glyph — the P00 review's N1. N2 (insertion count) and N3 (matrix
bookkeeping) remain open as the handoff honestly states. LEDGER has a P01 row
pointing at the handoff and fixture; no matrix status cells were updated (same
N3 note as P00).

## 6. Notes (non-blocking)

- **N1 — matrix bookkeeping:** ACCEPTANCE_MATRIX.md rows C01/C02/C03 still say
  NOT RUN while the handoff marks them passed (C03 with an explicit "partial"
  qualifier). Same standing note as P00-N3; sync in one later touch or by the
  integrator.
- **N2 — README wording:** the "public `sessions.ensure` facade" phrasing in
  `src/persistence/README.md` refers to a P08 artifact; harmless now, but keep
  C03's "no current-state claim" discipline in later docs packets.
- **N3 — runtime prohibited-key coverage:** only 8 of 14 names are asserted at
  runtime; the type check covers all 14. Optional to extend when the fixture is
  next touched.
- The export migration list in the handoff (P01 step 5) is complete against
  BASELINE §3.1 and unambiguous about packet ownership; P02/P03 can rely on it.

## 7. Blockers for P02/P03

None. The C02 shapes are frozen verbatim, C01 surface is provably intact, and
C03's remaining work (root-barrel `pg` isolation) is explicitly deferred to
P08–P10 as planned. P02 (portable-text policy) and P03 (postgres connection
boundary) may start on this contract; P03 must keep the fixture's prohibited-
member boundary intact when introducing `createPostgresPersistenceProvider`.
