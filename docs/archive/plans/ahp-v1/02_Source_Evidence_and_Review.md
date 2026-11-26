# Source evidence and final architectural review

**Prepared:** November 22, 2026.  
**Baseline:** develop at `bcd85354723bce293e1384af0ca88e84d5ce9dda`.  
**Verdict:** READY FOR IMPLEMENTATION as a reviewed plan with explicit acceptance gates. This is not implementation approval, a test pass or deployment readiness.

## 1. Evidence boundary

The prior schema plan/SQL and the user's accepted decisions were reconciled with pinned repository source. The source tree was inspected at one exact develop commit; it was not assumed identical to the user's named `GLM/agentIdentity` working checkout. Relevant contracts, capture paths, policy/currentness code, persistence SQL, host/wire delivery, client transport, existing tests and examples were read. Microsoft upstream types were verified at the pinned package tag, not guessed from a later library version.

No repository files were implemented, committed or pushed. No actual application database was modified. No PostgreSQL engine, migration, TypeScript compile, Vitest suite, public SDK integration or test application was run during this planning task. The SQL reference and smoke fixture have only static review here.

## 2. Pinned source-to-decision map

| Current source boundary | Exact source | Target implication |
| --- | --- | --- |
| Existing eight-table baseline | [database/migrations/0001_session_tool_baseline.sql](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/database/migrations/0001_session_tool_baseline.sql) | The current session/catalogue tables are not the target durable resource lifecycle. |
| Existing agent/work baseline | [database/migrations/0002_agent_work.sql](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/database/migrations/0002_agent_work.sql) | Current work identity/lease constraints need the P0/P1 forward migrations. |
| Session/provider/live contracts | [src/sessions/types.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/sessions/types.ts) | Keep synchronous live registry; extend async provider and durable ports instead of pretending a SQL registry is synchronous. |
| Protected provider capture | [src/sessions/helpers/factory/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/sessions/helpers/factory/helpers.ts) | Explicitly preserve new restore/retire/codec/driver methods in the captured provider object. |
| Current native action subset | [src/sessions/helpers/actions/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/sessions/helpers/actions/helpers.ts) | Title/read/archive persist; active-client membership is transient. Unsupported native actions do not become implemented through storage. |
| Reducer and immediate publication | [src/sessions/helpers/state/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/sessions/helpers/state/helpers.ts) | P0 stages and commits accepted state before live apply/publication and makes dispatch asynchronous. |
| Creation-policy capture | [src/sessions/helpers/creation/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/sessions/helpers/creation/helpers.ts) | New work/restoration registrations must survive actual capture and catalogue resolution. |
| Current durable ports | [src/persistence/types.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/persistence/types.ts) | Old URI-only ensure projection and subject-only repository requests are replaced by exact instance/transaction contracts. |
| PostgreSQL work operations | [src/persistence/helpers/adapters/postgres/helpers/workItems/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/persistence/helpers/adapters/postgres/helpers/workItems/helpers.ts) | Claims, renewals, replay comparison and owner predicates require deliberate transaction changes. |
| Current work service | [src/work/helpers/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/work/helpers/helpers.ts) | Remove owner-only flow and terminal-replay exception; prepare existing canonical policy instead. |
| Current work wire | [src/websocket/helpers/ahp/agentWork.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/websocket/helpers/ahp/agentWork.ts) | Strict V1 already exists for work; update single shapes, attempt fencing, trusted contexts and sanitized errors. |
| Live agent identity/presence | [src/agents/helpers/directory.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/agents/helpers/directory.ts) | Keep existing one-connection binding/idempotency while adding durable execution epochs around the async boundary. |
| Canonical resource operation seam | [src/authorization/helpers/resources/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/authorization/helpers/resources/helpers.ts) | Keep final synchronous current/admission semantics; do not sneak async SQL into ResourceOperations.commit. |
| Existing generic policy compiler | [src/toolPolicy/helpers/factory/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/toolPolicy/helpers/factory/helpers.ts) | Extend this authorization implementation for work; P5 moves generic ownership without replacing the engine. |
| Thin ToolClient facade | [src/toolClient/index.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/toolClient/index.ts) | This directory is a compatibility export, not the actual general client implementation. |
| Actual tool-specific client | [src/toolExecution/helpers/client/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/toolExecution/helpers/client/helpers.ts) | It initializes native SDK and negotiates/advertises/executes tools; generic Client extraction is warranted. |
| Client transport/lifetime | [src/toolExecution/helpers/client/helpers/transport/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/toolExecution/helpers/client/helpers/transport/helpers.ts) | Preserve one recv owner, completion notification sends, bounded correlation, send settlement and shutdown. |
| Server broker inside client subtree | [src/toolExecution/helpers/client/helpers/broker/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/toolExecution/helpers/client/helpers/broker/helpers.ts) | Move server remote execution to tool server ownership; do not rename it a client feature. |
| Shared tool DTOs in client subtree | [src/toolExecution/helpers/client/helpers/protocol/types.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/toolExecution/helpers/client/helpers/protocol/types.ts) | Move portable DTOs into tool/protocol and relabel the one unreleased private shape V1. |
| Legacy broker fallback | [src/websocket/helpers/ahp/toolInvocation.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/websocket/helpers/ahp/toolInvocation.ts) | Remove old shape/call-path behavior and migrate useful tests; changing the numeric literal is insufficient. |
| Retained call status producers | [src/toolExecution/helpers/calls/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/toolExecution/helpers/calls/helpers.ts) | Update all retained private status DTOs, not just request schemas. |
| Portable comparator concern | [src/tools/helpers/protocol/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/tools/helpers/protocol/helpers.ts) | Runtime Buffer use requires actual execution with Buffer absent, not only import mocks. |
| Generic work use of tool transport | [examples/advanced/work.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/examples/advanced/work.ts) | Work/agents RPC should depend on client, without forcing tool negotiation. |
| Real SDK boundary tests | [src/tests/toolExecution/clientBoundary.test.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/tests/toolExecution/clientBoundary.test.ts) | Preserve ownership/framing/send/read/teardown tests through P5. |
| Public private-tool test | [src/tests/websocket/toolProtocolV2.test.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/tests/websocket/toolProtocolV2.test.ts) | Migrate to single V1 public-binding proof; internal kernel substitutions are different evidence. |
| Real PostgreSQL test app | [examples/postgresql-conformance.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/examples/postgresql-conformance.ts) | Extend actual loopback migrated-database acceptance; do not silently substitute stubs. |
| Owned RPC error mapping | [src/jsonrpc/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/jsonrpc/helpers.ts) | Extend existing RpcError/code vocabulary and preserve error provenance. |

The table describes evidence from develop; the accompanying contracts describe future behavior. Source comments that call a synchronous in-memory registry replaceable by a database, or a transient stream gap-free, are descriptions to correct during implementation rather than guarantees to repeat.

## 3. Upstream and database references

Pinned Microsoft package: `@microsoft/agent-host-protocol@1.0.0`, upstream tag commit `5f16d81bb7045b66d7bc768d244feab75002d943`.

- [TypeScript package](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/typescript/package.json).
- [SessionState and status bits](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-session/state.ts): read/archive are status bits; ready is a native lifecycle value, suspended is not.
- [Chat message/state types](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/state.ts) and [chat actions](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/actions.ts): use a system-notification projection; avoid accidentally initiating a turn.
- [PostgreSQL 17 transaction isolation](https://www.postgresql.org/docs/17/transaction-iso.html): separate command snapshots at READ COMMITTED inform lock-before-count ordering.
- [PostgreSQL 17 SELECT](https://www.postgresql.org/docs/17/sql-select.html): SKIP LOCKED is suited to queue-like access, not a globally consistent strict-order snapshot.
- [PostgreSQL 17 explicit/advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html): retained host ownership and deliberate row-lock ordering.
- [PostgreSQL 17 constraints](https://www.postgresql.org/docs/17/ddl-constraints.html): cross-row invariants require more than a row CHECK; the reference uses composite FKs and deferred triggers where appropriate.

## 4. Findings corrected before handoff

Two bounded independent source/contract reviews covered work authority/durability and tool/client boundaries, followed by targeted rechecks of their findings. The lead also reviewed the full packet set and late wire/codec/bounds clarifications. The following are resolved design findings, not claims that fixes already exist in the repository.

| Finding | Pinned correction | Evidence required during implementation |
| --- | --- | --- |
| Mutable JSON could break idempotent replay | Separate immutable submitted_data from current data; use independent dataRevision CAS | P1 replay/CAS/final-settlement tests |
| Crash between provider create and receipt save could duplicate resources | Reserve exact identity/provision key first; idempotent ensure/reconcile and explicit restore/destroy | P0 crash-window/restart tests |
| Provider/policy widening could be silently dropped by capture code | Update both actual capture paths and application/type resolution | P0-23, P1-20, P2-02 |
| Session durable state could resurrect live clients/activity | Explicit V1 stable-state codec, current readiness and fresh bindings | P0-07/P0-24 |
| Remote work opened before scheduling fences existed | Remain closed through P2; enable only after P3's real-SQL gates | Intermediate composition and P3 gate |
| Unknown commit left old execution guards usable | Mark exact guards settling before SQL; reconcile under the same locks; retain uncertain reservations | P2-23, P3-17 |
| Owner-only checks contradicted consumer policy and cross-principal work | One canonical SecurityComposition across wire/service/SQL and typed trusted entities | P2-03/P2-05/P2-06 |
| Empty canonical target arrays bypassed work scope | Targets when nonempty, otherwise origin; real origin effects must be declared | P2-21 |
| Claim capacity count could use a pre-lock snapshot | Separate awaited agent-lock statement, then fresh count; all epochs/sessions included | P3-01/P3-08 |
| Renew could revive an expired lease after lock wait | Recheck fresh database time after acquiring exact work lock | P3-09/P3-10 |
| Scope trigger allowed concurrent last-positive deletion | Lock distinct OLD/NEW work parents; separate fresh existence query at READ COMMITTED | P1-22 plus real two-session SQL |
| Revised root trigger introduced a late lock upgrade | Root validation takes session FOR SHARE; lifecycle/root writers lock exclusively up front | P0-22 |
| List output limits left scanning/memory unbounded | Examined-row/time budget, finite sweep, opaque continuation, bounded client tracked state | P4-14/P4-21/P4-22 |
| Snapshot/global-sequence race could lose a work change | Buffer before query, reconcile by per-item revisions; never cut hints by sampled serverSeq alone | P4-04/P4-05/P4-11 |
| General client port could not send completions or preserve deadlines | notify plus bounded request options, overall polling deadline and actual send settlement accounting | P5-13/P5-16 |
| Tool/work adapters could not observe generic shutdown | One lifetime signal/cleanup seam, partial attachment rollback and shared logical release | P5-14/P5-15 |
| Legacy tests required production fallback planned for deletion | Migrate useful scenarios to strict public V1; remove fallback/obsolete fixtures with coverage mapping | P5-18 |
| Host schema accepted work tag but caller SDK could not send it | Optional typed tool call options; token retained only on caller-to-host/private guard path | P5-17 |
| Version relabel could corrupt unrelated version axes | Private top-level envelope 1; legitimate tool contract 2 remains context.version 2 | P5-11/P5-19 |
| Portability test could miss a free Buffer global | Execute comparison/ack paths with Buffer absent and Unicode/budget cases | P5-06/P5-07 |

The targeted reviewers found no remaining material blocker in their corrected scopes. Small client deadline/cleanup wording clarifications were also applied. The later root-owned supplement fixes complete wire shapes, the required attempt field, bounded cursor ownership, approved error formatting, same-connection bind idempotency, child-retirement behavior and the exact stable state codec.

## 5. Final consistency decisions

- All remote contracts have one supported V1 shape. Work starts at V1 already; P5 relabels the currently unreleased private tool shape. JSON-RPC, Microsoft package/protocol and tool-definition versions are separate axes.
- Scope and announce are different typed selections. The nearest applicable include/exclude wins within containment, but no selection grants permission. A narrow child resolves its real parent; an excluded subtree can be explicitly re-included at a deeper anchor only within current permission.
- Canonical resource application data, provider recovery facts and native durable state stay separate. Metadata keys cannot forge owner/domain/role/policy. All callback outputs are captured and bounded again.
- Data conflicts cause no partial update or event. Authorized replay is independent of current mutable data and consumes no new quota. Unknown outcomes never become a false rollback or fabricated success.
- The current synchronous authorization final-admission seam is preserved. SQL authorization is explicitly admission-time with row/epoch fences, not a claim that JavaScript and COMMIT are atomic. External effects can be at least once.
- Single-store ownership is enforced at host composition with a retained database advisory connection and persistent epoch. It is not reacquired independently by every pool.
- Consumer hooks may narrow permission and choose a fenced authority-loss disposition. They cannot mint grants, mutate another attempt or veto explicit resource retirement.
- Same-connection agent-register replay is idempotent. A new binding/reconnect rotates the persistent epoch; live presence still stays in memory.
- Client/work bounds are visible outcomes. A partial scan or overlarge client view does not pretend that unseen work disappeared.
- P5 is a dependency/ownership cleanup with explicit behavior gates, not a new execution policy, an assignment-ledger rewrite or a new package ecosystem.

## 6. Operating limits and remaining proof obligations

The plan supports one active authoritative host for a logical store, PostgreSQL 17 READ COMMITTED, externally executed work and best-effort work hints with authorized reconciliation. It does not promise native chat turn hosting, durable event replay, active/active failover or exactly-once external side effects.

Before declaring implementation complete, the coding agent must compile and run the exact authored migrations and tests, including real two-pool lock waits, deferred-trigger races, unknown-COMMIT fault injection, recovery after provider creation, public binding/pinned-SDK interoperability, client runtime portability and all sample apps. Query plans and bounded-load measurements must be recorded using the actual adapter, not inferred from index names.

A provider whose external API cannot reconcile by a stable creation key cannot claim crash-safe automatic provisioning. The adapter should leave its durable instance unavailable and expose a consumer reconciliation path. Nonempty legacy development rows require an explicitly trusted mapping/reset decision; the default migration safely refuses them. Neither condition is hidden by declaring the plan ready.
