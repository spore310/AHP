# Packet handoff

**Packet / design revision:** P01 repair 2 / R5 recheck of R4, R5, and R9
**Verdict:** IMPLEMENTED — the three reproduced failures pass. Acceptance remains with w8:p2.
**Candidate:** HEAD `22fa7955b8e43839e041228f647f26e00762ebbe` plus the P01 patch. No commit.
**Scope:** byte accounting, array own-property rejection, and HTTP URL syntax only. No new contract design. No P02.

## Amendments

1. `capturePlainJson` counts the UTF-8 size of JSON text, including escapes (`\"`, `\\`, controls, lone surrogates) and container brackets/commas. Scanning stops when the byte budget is exceeded. It still does not call getters, `toJSON`, or `JSON.stringify` on objects.
2. Arrays reject extra own names, symbols, and accessors, including a non-enumerable `toJSON`, without invoking them. `length` remains a data property and is not serialized.
3. Redirect URLs use `z.string().max(...).pipe(z.httpUrl())`. Length remains bounded. `https://`, `http://[`, invalid hosts, and non-HTTP schemes fail. This is syntax validation, not P13 approval.

## Commands

Repository root. DB variables unset. No live query.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm exec vitest run src/tests/authorization/contractReview.test.ts src/tests/authorization/contracts.test.ts` | 0 | 2 files, 13 tests passed |
| `pnpm validate` | 0 | lint, typecheck, 54 files / 420 tests, docs:check 130, vite build. Log: `execution/P01-repair2-validate.log` |

Lead assertions were kept. Added exact-boundary cases for escaped quotes/backslash, NUL, non-ASCII/surrogate text, nested array bytes, and cycles inside the existing escaped-byte test.

## Downstream

P02/P08 must keep using `capturePlainJson` rather than raw string length. P13 must not treat `z.httpUrl()` success as redirect approval.

**No-database/no-deploy boundary:** no query, migration, install, commit, reset, or stash.
