# P03 correction handoff

**Status:** candidate for independent review. Not accepted. P04 is blocked.
**Candidate:** HEAD `22fa7955b8e43839e041228f647f26e00762ebbe` plus accepted P01/P02 and this P03 correction. No commit. No P01 or P02 amendment.

## Gate

Repository root. Integration DB variables unset. No live query.

`pnpm validate` exit 0: lint, typecheck, 61 files / 477 tests, docs:check 152, vite build. Log: `execution/P03-correction-validate.log`.

## Source

- `src/authorization/helpers/evaluate/helpers.ts`: per-host `issued` set; separate tool and executor maps; caller identity stays on the stamp while the executor stays on `authority.executor`; admission ceiling and missing admission deny; scope must sit on the registered route; mandatory extension and permission callbacks use the obligation resource; final expiry check before allow; conflicting assignment throws; identical assignment returns.
- `src/toolPolicy/helpers/assignments/helpers.ts`: delivery purpose must equal the issued tuple operation. Invoke authorization cannot be relabeled execute.

## Findings to tests

| Finding | Test |
| --- | --- |
| Cross-host provenance | `rejects an authorization issued by another identically configured host` |
| Independent executor cap | `keeps executor assignment capacity independent of tool assignments` |
| Mandatory extension | `denies a mandatory policy whose own extension evaluator is missing` |
| Caller retained on execute | `retains the caller on a genuinely authorized execute stamp` |
| Admission ceiling | `denies a positive policy outside the linked admission ceiling` |
| Missing admission | `denies an uninstalled admission link` |
| Scope off route | `denies a binding scope that is not on the registered route` |
| Target permission scope | `gives a target permission callback the target resource` |
| Purpose escalation | `does not disclose an invoke authorization when delivery purpose is execute` |
| Conflicting tuple | `rejects a conflicting assignment instead of overwriting the installed tuple` |
| Recipient mismatch | `does not disclose an assignment whose recipient does not match the caller` |
| A01–A06 and seven RED tests | unchanged security outcomes, passed |

## Fixture strengthening

| Test | Previous gap | Retained assertion |
| --- | --- | --- |
| Cross-host provenance | No canonical tool or assignment | Same-host validate true; other host false; allow control remains |
| Executor capacity | Execute record without binding/contract | Independent cap still succeeds after a real tool assignment |
| Disclosure RED | No assignment, so empty descriptors could skip evaluate | Assignment installed; denying callback count is greater than zero |

**No-database/no-deploy boundary:** no query, migration, install, commit, reset, or stash.
