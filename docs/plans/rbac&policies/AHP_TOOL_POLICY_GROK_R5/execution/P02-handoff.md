# P02 accepted handoff — R5

**Verdict:** VERIFIED FOR PACKET. Immutable policy compiler and namespace selection; no grant evaluation or host security wiring claimed.
**Candidate:** base `22fa7955b8e43839e041228f647f26e00762ebbe` + accepted P01/P02 uncommitted files. Exact 30-file manifest `P02-accepted.sha256`, SHA-256 `718da773a88bc45de05f427ae2a8c27d61ee34cdc64818794bc1138bb344ee05`. Lead compared P01 hashes: only authorized toolPolicy index/README changed; all other P01 files unchanged. No unrelated source/package/lockfile/DDL change or commit.

## Gate and review

Final worker-run `pnpm validate` exit 0 with integration DB credentials removed. Orchestrator read the actual log: **57 files / 440 tests**, lint/typecheck, 136 source mappings, build 97ms. `P02-final-correction-validate.log` is authoritative; final correction handoff's 56-file count was a transcription error. Focused toolPolicy: 19 tests. Lead also ran the earlier RED reproductions and checked final source and scope; `git diff --check` passed. No extra unchanged-code full run is claimed.

N01–N05 tests in `factory.test.ts` plus `factoryReview.test.ts` and `portableImports.test.ts` cover direct mode, mixed direct/namespace selection, exact registry and opaque IDs, mandatory preservation, immutable data, callback-free views, safe resolver failure/timeout/malformed output, dependency-free neutral import, include cycles/bounds/depth-sensitive memoization, typed detached extensions, and boundary budgets.

P02-R1–R7 resolved. Independent read-only review confirmed exponential path materialization; corrected by shared depth-keyed memo and incremental deduplicated sets. After two repairs, a fresh targeted diagnosis identified redundant operation counters as the remaining limit failure. Final narrow correction removed that duplicate authority and freezes the structurally bounded parsed operations. Unknown extensions remain separately bounded/captured. Full permitted operation/role/permission combinations now pass without weakening the schema.

## Accepted P02 API

- `defineToolPolicyNamespace(input, limits?)`: detached frozen declaration, required runtime resolver, optional validated P02-local budget argument. No include expansion until factory construction.
- `createToolPolicyFactory({policies?, namespaces?, bindings?, limits?})`: atomic immutable registry compilation. Direct inputs allow `CompiledToolPolicy.extension?: unknown`.
- `getPolicy(ref)` returns detached frozen compiled policy or undefined.
- `forSessionType({key,version}, providerId)` returns exact host-registered admission and independent mandatory refs; unknown pair throws typed construction/domain error.
- `select({sessionType,providerId,context})` returns selected alternatives plus mandatory refs, or sanitized deny. Selection is not an allow decision. Direct refs survive namespace selection; missing/throwing/timed-out/invalid namespace selection cannot remove mandatory rules.
- `inspect()` returns detached callback-free host inspection data, NOT a client disclosure API.

P03 must use these APIs, exact revisions and separate mandatory refs. Do not reinterpret a selected result as a grant or expose inspect() to clients. Optional declaration budget is the only P02 addition to the sketched call shape; no P01 shared contract was changed.

## Limits and next step

Resolvers are trusted application callbacks; timeout returns denial but does not cancel a noncooperative promise or CPU work. Final authority freshness belongs to P03/P06, not this compiler. Host registration remains trusted; no anonymous/caller authorization, identity provider, DB, model runtime or resource access is added. P10–P12 still gate shared-host privacy claims.

**Next eligible packet:** P03, using `P03-preflight.md` with enforced external validity and synchronous local freshness admission. No permission to bypass existing durable-work equality or lease fencing.
