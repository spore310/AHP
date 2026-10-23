# Acceptance matrix — all implementation evidence starts NOT RUN

This is a specification, not a passing test report. Each packet owner records the
actual command, candidate, result and evidence pointer. Source-only review does
not mark runtime criteria passed. Real database cases remain blocked until
separate explicit authorization and a dedicated test database are available.

| ID | Category | Required behavior | Distinguishing evidence | Packet | Status |
| --- | --- | --- | --- | --- | --- |
| B01 | Baseline | Pin HEAD/worktree and preserve unrelated edits. | Recorded status and candidate identity; no reset/stash. | P00 | PASS — baseline and worktree recorded |
| B02 | Baseline | Inventory direct and transitive persistence consumers. | Importer/symbol migration table and final comparison. | P00 | PASS — final source scan and consumer audit |
| B03 | Baseline | Preserve no-database-access boundary and canonical DDL. | Migration hash/diff report; no unapproved DB queries. | P00 | PASS — migration hashes match; no DB access |
| C01 | Contract | Keep repository signatures, optional fields and absence sentinels. | Compile fixtures plus each operation result tests. | P01 | PASS — contract fixtures and suites |
| C02 | Contract | One provider has registrations, sessions, work, dispose. | Type fixture and construction test without vendor imports. | P01 | PASS — provider type and factory tests |
| C03 | Contract | No query/Pool/ORM entity/transaction in common contract. | Type/public API inspection and dependency test. | P01 | PASS — neutral contract and import checks |
| C04 | Facade | All facades delegate exact atomic operations once and retain receivers. | Spy and class-based provider; detach facade method to test behavior. | P08 | PASS — delegation, receiver, and atomic-operation tests |
| C05 | Boundary | Neutral @persistence root has no concrete adapter export. | Fresh import sentinel and transitive dependency graph. | P10 | PASS — root export and throwing-pg import tests |
| V01 | Validation | Preserve well-formed text, reject NUL/lone surrogates. | Scalar, key and nested value examples; valid paired surrogates accepted. | P02 | PASS — portable-text tests |
| V02 | Validation | Preserve exact 512-level recursion budget. | Boundary and over-boundary cases with typed failure. | P02 | PASS — depth boundary tests |
| V03 | Validation | Do not conflate text scan with full JSON/schema validation. | Existing object/serialization/size checks retained and documented. | P02 | PASS — shape and size checks retained |
| V04 | Validation | Portable-text restriction is application policy, not universal JSON fact. | Neutral docs and no engine switch in predicates. | P02 | PASS — neutral policy documentation |
| V05 | Consumers | Remove old JSONB helper imports, exports and branded messages. | Production symbol scan plus original rejection regressions. | P09 | PASS — consumer migration and wording scan |
| PG01 | Postgres unit | Keep transaction work on one acquired client. | Distinct pool/client query spies; BEGIN/operation/COMMIT affinity. | P03 | PASS — query-double transaction affinity |
| PG02 | Postgres unit | Release client on success, operation failure and commit failure. | Driver-double failure injections and exact release count. | P03 | PASS — query-double release paths |
| PG03 | Postgres unit | Preserve rollback primary failure and private SQLSTATE mapping. | Rollback failure test; mapping tests; no leaked raw exception. | P03 | PASS — query-double rollback/error tests |
| PG04 | Postgres unit | Registration upsert/get mapping and absence behavior unchanged. | Characterized parameter/result fixtures. | P04 | PASS — query-double mapping tests |
| PG05 | Postgres unit | Session owner guard and sequence-monotonic mapping unchanged. | Query parity and mapped-row tests. | P04 | PASS — query-double session tests |
| PG06 | Postgres unit | Dependent work prevents session deletion. | Constraint/error mapping unit check; real DB case separately tracked. | P04 | PASS — query-double classification; real DB separate |
| PG07 | Postgres unit | Submit uses same transaction for session ensure and work insert. | Query order/affinity and rollback injection; no facade ensure call. | P05 | PASS — query-double atomic submission tests |
| PG08 | Postgres unit | Every work SQL predicate and parameter remains accounted for. | Operation-by-operation parity table and focused query assertions. | P05 | PASS — query-double work predicate tests |
| W01 | Semantics | Idempotent same request returns same ID; changed payload conflicts. | Same/different kind/input/target cases; structural object equality. | P05 | PASS — conformance and query-double tests |
| W02 | Semantics | Claim respects owner, enabled agent, target, kind, attempts and expiry. | Independent negative cases; concurrent real DB claims require permission. | P05 | PASS — unit/query-double semantics; real concurrency BLOCKED at T04 |
| W03 | Semantics | Renew/complete reject wrong owner/agent/token/expiry/status. | Exact-match and stale/expired cases across the common harness. | P05 | PASS — conformance and query-double tests |
| W04 | Semantics | Fail/reclaim/cancel preserve terminal and retry behavior. | Exhaustion, requeue, terminal replay and token-clearing tests. | P05 | PASS — conformance and query-double tests |
| W05 | Semantics | Clock and evaluation points remain adapter-owned. | No Date.now lease computation in facades; SQL clock parity. | P05 | PASS — source/query-double evidence; real DB clock BLOCKED at T06 |
| S01 | Selection | Unknown provider cannot load arbitrary module or fall back. | Allowlist tests with hostile/unknown names and zero allocations. | P06 | PASS — unknown selector rejected before loading |
| S02 | Selection | Omitted selector resolves existing postgres default only inside adapter registry. | Registry test; no concrete default in neutral env/core. | P06 | PASS — registry default and neutral config check |
| S03 | Selection | Validate options before acquisition and preserve existing defaults. | Invalid URL/options and default TTL/pool fixture tests. | P06 | PASS — selection/provider tests |
| S04 | Boundary | Neutral import and disabled entrypoint do not evaluate pg. | Fresh module context with pg factory throwing on evaluation. | P10 | PASS — module-import sentinel |
| S05 | Composition | URL/token pairing remains fail-closed; selector-only is invalid. | Full configuration truth-table test. | P10 | PASS — configuration truth-table tests |
| S06 | Composition | All createAgentWorkOptions callers await async result. | Typecheck, actual caller audit and startup tests. | P10 | PASS — typecheck and caller audit |
| S07 | Composition | Enabled host receives common ports, not raw connection. | Configured-provider fake passed through real composition path. | P10 | PASS — composition fake-provider test |
| L01 | Resources | One provider owns one compatible store/pool bundle. | All repository constructors get same pool; no pool on public object. | P06 | PASS — provider construction and contract tests |
| L02 | Resources | Partial adapter construction releases acquired resources once. | Failure injection after allocation with safe cleanup evidence. | P06 | PASS — construction failure injection |
| L03 | Lifecycle | Disposal closes admission synchronously and waits for admitted work. | Deferred operation; post-close call never reaches adapter. | P07 | PASS — deferred operation lifecycle tests |
| L04 | Lifecycle | Repeated disposal shares settlement including failure. | Same completion promise or equivalent exact settlement test; close count one. | P07 | PASS — repeated disposal success/failure tests |
| L05 | Lifecycle | Rejected operations do not skip cleanup or create unhandled promises. | Failure + all-settled drain + unhandled-rejection trap. | P07 | PASS — failure and cleanup tests |
| L06 | Lifecycle | All namespaces share one operation scope. | Park registrations and work simultaneously; disposal drains both. | P08 | PASS — cross-namespace drain test |
| L07 | Resources | Composition failure/start failure cleans up with one owner. | Failure injection before/after host ownership handoff. | P10 | PASS — composition failure injection and host start-stop cleanup path |
| E01 | Errors | Only owned RepositoryError codes cross unchanged as categories. | Owned vs duck-typed/raw thrown error tests. | P07 | PASS — error normalization tests |
| E02 | Errors | No raw vendor detail, credentials or stack escapes normalized failures. | Canary token/SQL/connection-string input in thrown errors. | P07 | PASS — sanitized error tests |
| E03 | Errors | DTOs and sentinels pass through facades unchanged. | Every repository method return contract covered. | P08 | PASS — contract/facade tests |
| I01 | Integration | AgentDirectory needs no database selector or concrete adapter. | Existing directory tests with fake registration port. | P09 | PASS — directory suite and dependency scan |
| I02 | Integration | WorkService policy is unchanged. | Existing authorization/presence/lease/error tests retained. | P09 | PASS — work service suite |
| I03 | Integration | AHP wire and owner/settling protections are unchanged. | Binding, transport, disposal and v1 schema regressions. | P09 | PASS — WebSocket wire and integration suites |
| I04 | Integration | Baseline host remains usable without durable extension. | Existing application/session/SDK host tests. | P10 | PASS — full host/session suite |
| D01 | Docs | Do not claim newly persisted optional fields or full session recovery. | Mapping audit and accurate unchanged-capability statement. | P04 | PASS — limitation recorded in persistence docs |
| D02 | Docs | All new/relocated production source files are mapped. | pnpm docs:check. | P12 | PASS — docs:check maps 116 source files |
| D03 | Docs | Document source API migration and explicit adapter entrypoints. | Old imports absent from current examples; target plans labeled. | P12 | PASS — module and architecture docs updated |
| D04 | Docs | Database-specific DDL remains where it belongs and unchanged. | Migration diff/hash check; no automatic runner added. | P12 | PASS — no migration diff; baseline hashes match |
| T01 | Tests | Independent fake provider works without pg dependency. | Fresh isolated import and real service integration. | P11 | PASS — provider substitution and pg sentinel |
| T02 | Tests | Two providers do not share records or disposal scope. | Same IDs in isolated fixtures, one disposed independently. | P11 | PASS — independent memory fixtures |
| T03 | Tests | Conformance harness targets repository semantics, not SQL syntax. | Harness fixture API inspection; no Pool in common test contract. | P11 | PASS — `conformance/types.ts` and shared runner |
| T04 | Tests | Real competing claims have one current claimant. | Authorized real PostgreSQL test with separate connections; otherwise BLOCKED. | P11 | BLOCKED — separate DB authorization |
| T05 | Tests | Real transaction rollback leaves no partially submitted work/session. | Authorized failure injection against dedicated DB; otherwise BLOCKED. | P11 | BLOCKED — separate DB authorization |
| T06 | Tests | Real expiry/reclaim rejects old token and preserves retry limit. | Authorized DB-clock test; otherwise BLOCKED. | P11 | BLOCKED — separate DB authorization |
| T07 | Tests | Final neutral dependency graph is vendor free. | Import graph test plus manual search; adapter tests/selection exception explicit. | P11 | PASS — fresh root/domain import sentinel and source scan |
| T08 | Tests | Never equate fake/test existence/skipped real cases with DB proof. | Evidence report names each test category and actual status. | P11 | PASS — handoff separates fake, query-double, and blocked real DB evidence |
| T09 | Validation | Pinned toolchain full gate passes for final candidate or blockers are explicit. | pnpm validate, diff check and sanitized logs. | P12 | PASS — pnpm validate and diff check |
| R01 | Review | Architecture pass examines exact final candidate and consumers. | Findings, source references, independence label and verdict. | P13 | NOT RUN |
| R02 | Review | Correctness pass attacks transaction/lifecycle/lease boundaries. | Counterexamples and evidence, not a repeated summary. | P13 | NOT RUN |
| R03 | Review | Repairs invalidate affected evidence; final report separates DB gate. | Targeted reruns and final candidate identity. | P13 | NOT RUN |

## Hardest counterexamples

A successful typecheck is not enough. Try these deliberately:

1. Import `RepositoryError` from the public root while the `pg` module throws
   during evaluation. Neutral import must still succeed after P10.
2. Park an operation in `registrations`, start another in `work`, call dispose
   twice, then attempt a third operation. First two settle; third is rejected;
   cleanup occurs once and both disposal callers wait for the same completion.
3. Make the work insert fail after the session projection write. The PostgreSQL
   transaction must use one client and roll back the unit, not leave a committed
   first step through a separate public session repository.
4. Submit the same JSON object with different property ordering. A generic
   JSON.stringify equality replacement must not create a false conflict.
5. Replace the concrete adapter with a class-based fake whose methods access
   `this`. Facade delegation must not lose the method receiver.
6. Claim, allow expiry, reclaim, then submit the old token. A refactor that moves
   lease decisions into memory must be caught by the real-DB conformance gate.
7. Send an otherwise bounded object with NUL in a nested key. Existing portable
   admission must still reject it before repository access.
8. Configure only a provider selector or only one credential/URL member.
   Composition must fail before loading a vendor or allocating a resource.
