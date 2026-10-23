# P02 independent review — READ-ONLY

Reviewer: independent read-only reviewer (same role as P00/P01 reviews; not the
writer). Date: 2026-10-22. Candidate: `agentIdentity` @ `6bd3c5e4…` + working
tree: `src/persistence/helpers/text.ts` (rewritten, +52/−16),
`src/persistence/README.md` (+40 cumulative incl. P01's section), untracked
`src/tests/persistence/text.test.ts`; P01's `types.ts` modification preserved.
Method: full-diff inspection against the pre-P02 body (byte-level body
comparison), direct reading of the fixture, raw-byte encoding scan, mutation
analysis of the tests, and independent re-runs of every claimed command.

## Verdict: ACCEPT WITH NOTES

No blocking finding for P03/P09. The profile is semantically identical to the
characterized predicates, the aliases are honest temporary debt with an owner,
and the test suite kills the plausible wrong implementations. Notes are
informational.

## 1. Semantic equivalence on the characterized domain (V01/V02) — VERIFIED

Comparing `git diff -- src/persistence/helpers/text.ts` line-by-line against
the P00-verified original:

- `isPortableText` = old `isJsonbSafeText` body **unchanged**: NUL (unit === 0)
  rejected; high surrogate followed by non-low rejected; valid pair consumed
  via `index += 1` (U+1D11E etc. still pass); low surrogate not preceded by a
  high rejected; ASCII/empty accepted.
- `hasPortableTextTree` = old `isJsonbSafe` body **unchanged** except renamed
  self-recursion/constant: entry check `depth > MAX_PORTABLE_TEXT_TREE_DEPTH`
  (same `>` comparator, 512), strings via `isPortableText`, arrays recursed
  with `depth + 1`, **object keys still checked** (`isPortableText(key) &&
  recurse(item)`), and non-record scalars still accepted early (NaN, Date,
  accessors — no broadening or narrowing of the callers-owned shape policy).
- Escaped-NUL adversarial case: a JSON source `\u0000` in a key becomes a real
  NUL after parse and is rejected by the key check — confirmed by the fixture
  using `parseUnknownJson(String.raw`{"kind\u0000ed": 1}`)` → `false`.
- No policy broadening/narrowing introduced anywhere in the file; the only
  body-adjacent changes are names and doc comments.

Raw-encoding check (the assignment's nightly note): a PowerShell code-point
scan over `text.ts` and `text.test.ts` finds exactly one non-ASCII code point,
**8212 = U+2014 em dash** (doc text). The `???` seen in console `rg` output is
rendering only; there is no stray glyph (the P00 `职` class of defect is not
present).

## 2. Aliases, consumers, imports — VERIFIED

- `isJsonbSafeText = isPortableText` and `isJsonbSafe = hasPortableTextTree`
  are behavior-identical rebinds (same function references), explicitly marked
  TEMPORARY with the four production consumers enumerated and
  "**Must be deleted in P09**". Deliberately not `@deprecated`-tagged, with the
  lint rationale recorded — reasonable.
- Consumers **not migrated**: `git status --short` shows only the three owned
  files modified; `agents/helpers/directory.ts`, `work/helpers/helpers.ts`
  (+ the `@work` re-export), and `websocket/helpers/ahp/agentWork.ts` are
  untouched (their scan/JSONB wording is unchanged from BASELINE §3.4).
- No `pg`/ORM import and no engine branch: `text.ts` **gained no imports at
  all**; the test imports only `vitest`, `@jsonrpc` (`parseUnknownJson`,
  per repo lint policy), and `@persistence/helpers/text`. No new production
  dependency edges.

## 3. Test suite mutation analysis (V01/V02) — NOT TAUTOLOGICAL

The 12 tests assert exact absolute values, not just self-consistency. Walking
the claimed wrong implementations:

| Plausible mutant | Killed by |
| --- | --- |
| Value-only scan (skips object keys) | `{ "\ud800": "value" }` → false; escaped-NUL key `{"kind\u0000ed":1}` → false; alias row `{ key: "\u0000" }` → false |
| Key-skipping input validation (keys only) | value NUL tests (`"a\u0000b"` scalar and nested in object/array) |
| Comparator `depth >= 512` | `wrap("leaf", 512)` and `hasPortableTextTree("ok", 512)` must be **true** — the string leaf sits exactly at depth 512 |
| Depth off-by-one in recursion (child at depth+2 or depth unchanged) | boundary combos pin the leaf position for three shapes: `wrap("leaf",512)` true / `wrap("leaf",513)` false; object at 511 + leaf at 512 true / object at 512 + leaf at 513 false; same for arrays; plus explicit-offset consistency (`"ok", 511/512/513`) |
| Rejecting non-JSON scalars (broadened policy) | `Number.NaN`, `null`, `3.5` pinned **accepted** (no-broadening pin) |
| Stale independent alias copy diverging from neutral | alias tests assert both absolute expectations and equality with the neutral function on the same inputs |
| Silent weakening after consumer migration | unchanged `workService` (3 JSONB titles) and `agentWork` (depth-budget title) characterization suites passed untouched in the targeted run |

Boundary edges are pinned from both sides (512 accepted, 513 rejected) for
string, object, and array leaf shapes — a comparator or recursion-depth defect
cannot survive. Note: `depth >= 513` is mathematically equivalent to the
correct `depth > 512` and is correctly not treated as a distinguishable mutant.

## 4. README wording — PASS

The new "Portable-text profile v1" section states: NUL rejection is an **owned
application interoperability policy**, "not a universal JSON rule"; JSON can
represent an escaped NUL; the tree predicate is "**not** a complete JSON
parser, schema validator, authorization check, or arbitrary-object sanitizer";
store-specific encoding checks "are the concrete adapter's responsibility";
aliases are temporary and listed for P09 deletion. All four honesty criteria
from the assignment are met. The P01 "Provider contract" section is carried
unchanged in the cumulative diff.

## 5. Commands re-run — exact results

| Command | Result |
| --- | --- |
| `pnpm typecheck` | **exit 0** |
| `pnpm exec vitest run src/tests/persistence/text.test.ts src/tests/work/workService.test.ts src/tests/websocket/agentWork.test.ts` | **exit 0, 3 files / 49 tests** (12 new + the two characterization suites) — matches handoff |
| `pnpm exec eslint <5 files incl. the three untouched consumers> --max-warnings 0` | **exit 0** |
| `pnpm validate` | **exit 0**: lint ✓, typecheck ✓, vitest **42 files / 330 tests** (P01 state 41/318 + exactly the new file's 1/12), docs gate 97 files ✓, vite build 87 modules, `dist/index.js 186.23 kB` (was 185.09 — accounted for by the new exports) |

Baseline-vs-new separation: final state has **no failures**. The handoff
discloses writer-owned intermediate defects (a test typo, `JSON.parse` lint,
`@deprecated` lint fallout on unowned consumers) and their resolution; the
final fixture is strict and the disclosed path is consistent with the green
end state. Pre-existing non-failures (F-P00-1 transitive-`pg` chain, un-migrated
JSONB wire wording) remain open exactly as routed.

## 6. Scope discipline — VERIFIED

`git status --short`: `M src/persistence/README.md`,
`M src/persistence/helpers/text.ts`, `M src/persistence/types.ts` (P01 state,
preserved), `?? src/tests/persistence/`, `?? docs/plans/peristance_202610222100/`.
No other source, env, scripts, migration, or manifest change. LEDGER has a P02
row and records F-P02-1 (alias debt, owner P09). V01–V03 claims are supported;
the handoff honestly marks **V04 NOT RUN / routed to P09** (consumer wording
migration is not P02 work).

## 7. Notes and blocking findings

None blocking. For the record:

- **N1 (P09 debt):** the TEMPORARY aliases must die in P09 along with the four
  consumer imports and the wire/message wording; P09 cannot claim completion
  while `isJsonbSafe` re-exports exist on the public surface.
- **N2 (bookkeeping, standing):** ACCEPTANCE_MATRIX.md rows V01–V04 still say
  NOT RUN; same sync note as P00/P01. The handoff's split (V01–V03 passed here,
  V04 NOT RUN → P09) is honest.
- **N3 (observational):** the alias-equivalence describe block imports the
  legacy names — if P09 deletes both aliases and this import as one unit, that
  test block must be removed with them, not rewritten to "expect the import to
  fail".

Clean handoff to P03 (postgres connection boundary) and P07 (lifecycle).
