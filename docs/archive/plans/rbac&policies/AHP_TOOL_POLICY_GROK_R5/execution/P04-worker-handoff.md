# P04 worker handoff — safe public setup and private canonical containment

**Status: IMPLEMENTED / worker verification passed; pending Luna review and lead acceptance. NOT P04 accepted. P05 not started.** Source/test/README candidate is frozen for integration.

Authority: `P04-plan.md`, `P04-plan-review.md`, and lead `P04-authorization.md` (including the exact optional-context and seven-file internal migration amendments). Sol was sole P04 writer. No children/models/accounts/packages/commits, live DB/service access, deployment, or persistence/owner/lease changes.

## Candidate and preserved baseline

Base remains `agentIdentity@22fa7955b8e43839e041228f647f26e00762ebbe` with accepted uncommitted predecessors. Most predecessor additions remain untracked: preserve the supplied plan bundle and `nul`.

- Accepted P03 manifest: **56/56 entries still match** after implementation; zero predecessor mutations. Manifest SHA-256 remains `fa567a9c5558f0c3250d4460ab35846bb7a9e4f6bd818fbf520176cf27c98497`.
- Frozen P04 source/test/README set: **28 files**, with exact SHA-256 rows at the end of `execution/P04-checks.log`.
- Seven migrated existing suite bodies from their first `describe()` through EOF compare **byte-for-byte equal** to HEAD. Only authorized imports, isolated module construction and evidence labels changed.
- The private kernel preserves original executable lines exactly after reversing the approved import paths/function rename. A stricter whole-text audit initially flagged only three em-dash comment encoding differences in HEAD extraction; that failed audit and precise diagnosis remain logged. No canonical algorithms were rewritten.

## Delivered boundary

1. **Safe public facade:** `createAHPBinding`, its public `createAHPConnectionModule` alias and real `createAHPServer` all use a fail-closed facade. Minimal initialize returns no snapshots; ping works. Nonempty/oversized initialSubscriptions fail before protected getters/pending subscriptions. Subscribe/repeat subscribe, root/list/session data, native creation/disposal/actions and legacy tool routes stay unavailable. There is no raw/unsafe option, root export or no-config fallback.
2. **One private canonical kernel:** old canonical protocol, owner attach/disposal, broker, buffering and sequencing mechanics live under an internal supporting path, not supported barrels. The facade delegates only safe native methods and the exact existing agent/work method inventory; no namespace-prefix permission shortcut.
3. **Scoped setup independent of DB/work:** `AHPServerOptions.security` combines unchanged P01 ports with the approved local `InitialAuthoritySource`. It selects existing full scopes/query grant revisions; preparation calls `resources.resolve` and `bindings.read({actor,scope,grantRevision})` exactly. Results are schema-validated/captured. No grant issuance, resource/grant installation, synthetic role/user/resource or unscoped read occurs.
4. **One identity source:** an explicit `createLegacyConnectionIdentityAdapter` maps an exact old authenticator to a configured domain. Private WeakMap provenance prevents structural/copy-based bridge claims. Mixed security/work requires that exact authenticator instance and matching workDomainId; conflicting sources reject before host construction effects. Subject-only work projection never collapses arbitrary domains or substitutes the owner.
5. **Fenced lifecycle:** transport reserves the real UUID/generation/auth revision before authentication. One captured deadline covers all setup awaits; pending sockets retain their frames. Abort/timeout/disconnect/stop cannot attach late setup and release late preparations exactly once. Callback methods/options are captured. The final synchronous currentness/fence check and attach have no await between them.
6. **Final egress check:** configured-context sends synchronously recheck setup immediately before local enqueue. Stale setup closes instead of releasing a deferred protected result. The existing frame pump, deferred matching, per-invocation settlement and close algorithms remain intact.
7. **Actor truth:** the trusted ActorResolver establishes actual user/registered-agent class and generation; JSON labels and absent presence do not make a human/admin. Missing required agent generation fails the accepted schema, without downgrade. Directory generations remain separate from transport generations and future executor registration revisions.

Work-extension methods retain their existing explicit principal/domain/owner/presence/service checks. New security readiness is not a substitute permission; legacy subject-only work configuration does not acquire policy/tool grants. Canonical owner/bootstrap/session creation integration remains P05; actual tool admission/recipient projections remain later packets.

## Source/write inventory

| Paths | Change |
| --- | --- |
| `src/agents/helpers/policyIdentity/{types,helpers,index}.ts` (new), `src/agents/index.ts` | Exact-source explicit legacy identity/domain bridge; public factory/type only, private provenance lookup. |
| `src/websocket/helpers/security/{types,constants,helpers,index}.ts` (new) | Local options/seeds/fences/snapshots, captured count/deadline limits, existing-resource/scoped-binding reads, freshness/currentness and idempotent release. |
| `src/websocket/helpers/host/{types,helpers}.ts` | Add security option, validate exact work bridge before owned resources, compose setup without requiring persistence, pass captured subscription/deadline bounds. |
| `src/websocket/{types,index}.ts` | Add setup option and local types. Base legacy context fields are optional by approved amendment; every real transport context supplies generation/currentness. No accepted P01 context/stamp changes. |
| `src/websocket/helpers/{server,connection}.ts` | Reserved fence, hold/deadline/cancel/late cleanup, immutable captured security facts, last-attach and last-send checks; preserve ordered framing/settlement/correlation. |
| `src/websocket/helpers/ahp/{helpers,types}.ts` | Safe public facade and bounded initial subscription option. |
| `src/websocket/helpers/ahp/helpers/kernel/helpers.ts` (new) | Private original canonical kernel; no supported raw export or runtime bypass option. |
| `src/tests/agents/policyActor.test.ts`, `src/tests/websocket/policyInitialization.test.ts` (new) | **46 new tests**: 17 actor/setup and 29 public/network cases. |
| Seven existing websocket suites below | Imports/construction/evidence classification only; assertions unchanged. |
| `src/agents/README.md`, `src/websocket/README.md` | Eight new production-file mappings and actual public/internal/API limitations. Tests are excluded by the repository documentation gate; no unrelated tests README was created. |

No env/process composition, package/lockfile, shared P01–P03 contract/schema/compiler/authorizer, work/persistence/directory implementation, session creation implementation, or unrelated test was edited.

## Exact test migration and limits

Direct internal-kernel construction (alias retains existing fixture calls):

- `src/tests/websocket/ahp.test.ts`
- `src/tests/websocket/agentWork.binding.test.ts`
- `src/tests/websocket/agentWork.disposal.test.ts`

File-local, Vitest-isolated substitution of only the host binding factory:

- `src/tests/websocket/sdk.test.ts`
- `src/tests/websocket/toolInvocation.test.ts`
- `src/tests/websocket/sessionTypeCapacity.test.ts`
- `src/tests/websocket/agentWork.integration.test.ts`

These latter suites still invoke the **real createAHPServer** constructor and actual host-owned sessions, sequence, owner registry, AgentDirectory, WorkService/repository fixtures, hostedSessions facade and stop/disposal. There is no duplicated/fake host, global mock or production flag. The new public suites do not mock binding selection and run in the same full gate, proving isolation.

Old SDK/schema/broker assertions now certify **INTERNAL canonical mechanics only**. They are not P04 public protected-host privacy or P12 authorized SDK/reducer evidence. Native protected output remains deferred; P09/P10/P12 must implement and prove the real authorized flow before reopening it. No raw compatibility fallback was retained to keep old assertions green.

## I01–I05 distinguishing evidence

All exact expanded test names are in the final verbose segment of `P04-checks.log`. Below A means `policyActor.test.ts`, W means `policyInitialization.test.ts`.

| ID | Actual test names and distinguishing controls |
| --- | --- |
| **I01** early barrier / safe protocol != permission | W `I01 public no-config host supports minimal initialize and ping but denies protected routes`; `I01 public facade rejects protected initial subscriptions before getters and side effects`; `I01 supported exports provide no raw kernel or unsafe constructor`; parameterized `I01 parks identity...` and `I01 parks authority before immediate protected initialSubscriptions and later permits only safe setup`; `I01 counts subscription selectors before deduplication and retains successful-reply initialization semantics`. Before release: zero frames/binding reads/native effects; after release: protected denial, genuine minimal initialize positive. Actual getter spies prove no root/session lookup/backend call. At-limit one subscription is protected-denied; one-over duplicate list is `InvalidParams` before deduplication. Failed initialization can retry minimal form; successful initialize cannot repeat. |
| **I02** security without persistence, exact existing facts | W `I02 real public host completes scoped security setup without persistence and still denies protected disclosure`; A `I02 reads only explicit existing scoped bindings without issuing or installing grants`; `I02 empty initial authority does not invent a scope or perform an unscoped read`; six `I02 rejects <actor/scope/incarnation/expired/revision/guard> setup facts atomically and releases its preparation` cases. Fixtures install real P03 resources/bindings beforehand and use exact scoped queries; no prepare/commit issuance or operation evaluation, no owner teardown. Native tools/session disclosure remain denied even after valid setup. |
| **I03** actual user/agent classification | A `I03 explicit user and independently registered-agent controls do not infer kind from labels or absence`; `I03 rejects trusted resolver attempts to retarget principal, connection or auth revision`. A finite trusted registration map supplies the real agent control; removal invalidates its lease and missing generation rejects without human fallback. W configured/public bridge cases send spoofed clientId/kind/role but scoped actor/work queries still use the trusted principal. |
| **I04** one authenticator, safe bridge/work | A `I04 legacy bridge calls the exact single authenticator and captures its domain`; W `I04 real public host invokes one exact legacy bridge and preserves work principals despite spoofed client labels`; `I04 rejects conflicting bridge sources and incompatible durable domains before authentication`; `I04 a thrown identity failure closes only that socket and the real host accepts the next valid setup`. Two real public clients with same wire label use different actual repository principal queries; one exact auth invocation each, unknown credential cannot query work, copied/unproven bridge rejects, wrong durable domain rejects, a failing connection does not stop the host. |
| **I05** lifecycle / cancellation / final currentness | W twelve `I05 bounds <identity/actor/authority/resource/bindings/freshness> setup, observes late rejection, and never attaches after <timeout/disconnect>` cases; `I05 disconnect/stop while authority is pending releases a late preparation exactly once`; `I05 reconnect uses a different actual connection generation and auth revision`; `I05 transport checks currentness immediately at attach and after attachment without async freshness`; `I05 revocation after preparation but before final attachment prevents onConnection effects`; two `I05 transport refuses a prepared <connection/generation> fence belonging to another attachment`; `I05 revocation during a real deferred work read prevents protected result egress at the final send`. A `I05 old setup release cannot remove a successor directory presence generation`; `I05 refuses a non-synchronous currentness result instead of treating a Promise as permission`; `I05 captures options and checks stale guards without asynchronous freshness at currentness`; `I05 captures the total binding limit before multiple scopes can amplify it`; `I05 expiry and throwing local guards cannot preserve an attached setup`; `I05 validates setup count/deadline limits and honors cancellation before any reads`. Explicit deferred gates/event conditions, not sleeps; real within-deadline positives; late fulfillment/rejection observed; no async freshness from local currentness. The deferred work case has a genuine owned-data read first, then proves no post-revocation reply bytes. |

Count/default/absolute controls cover scopes, total binding output, subscription selector bounds, all invalid constructor values and allowed ceilings. Per-binding/resource facts reuse accepted schemas. Initial setup is a finite captured fact snapshot, **not an operation allow decision or P03-issued authorization stamp**.

## Actual execution history / checks

Evidence: `docs/plans/rbac&policies/AHP_TOOL_POLICY_GROK_R5/execution/P04-checks.log` (all failures retained).

- Initial public-facade RED: **2 failed / 1 passed**, exit 1, before production changes. No-config raw root initialization and facade getter access were reproduced.
- First combined safe-public/internal-kernel run: **50 passed**, exit 0. First typecheck exposed one new implicit-any bridge callback; fixed with the accepted input type.
- First setup test iteration: **30 passed / 1 fixture failure** (missing agent generation already correctly rejected by P01 rather than resolving undefined) and two widened mock literal TS errors. Fixture expectations were made stricter and exact types fixed; no security denial was removed.
- Additional intended security RED: **3 failed / 32 passed** — Promise-valued guard accepted; wrong connection and generation snapshots attached. Narrow local boolean/fence checks fixed them.
- Scoped actor/public/authenticator/deferred loop: **42 passed**, typecheck exit 0.
- Targeted lint initially reported style, require-await and unbound mock-reference errors. Fixed without suppressions, skipped cases or threshold changes. An intermediate full test run passed 571 tests; it was not claimed as the final gate.
- Final-send regression initially reproduced a revoked deferred work result leaving the connection. The final local enqueue check fixed it. An intermediate full gate then found one old new-test expectation asking for an inspection reply after revocation; the stronger fail-closed send now closes instead. That test retains its valid initial reply, explicitly asserts local currentness false and verifies no stale reply/connection closure. It does not weaken the security condition.
- Final disconnect-at-every-await and just-before-attach controls were added; their final results are below.

| Final command | Actual result |
| --- | --- |
| Targeted ESLint on final new network tests, `--max-warnings 0` | exit 0 |
| `pnpm exec vitest run src/tests/agents/policyActor.test.ts src/tests/websocket/policyInitialization.test.ts --reporter verbose` | **46 passed**, 2 files, exit 0 |
| **`pnpm validate`** | **exit 0: lint, typecheck, 70 test files / 579 tests, docs:check (159 mapped sources), build all passed** |
| P03 manifest final recheck | **56/56 unchanged**, zero mismatches |
| Seven old suite-body audit | **7/7 unchanged** |

No `.skip`, deleted assertions, lint/type suppressions, dependency updates or intentional-RED carryover. Full validation includes public/unmocked and internal/mocked suites together, plus unchanged P01–P03 contract/portable-import tests.

Every gate ran in a child shell with these DB/auth/provider variables unset (names only, never values): `PGHOST PGHOSTADDR PGPORT PGUSER PGPASSWORD PGDATABASE PGDATA PGSERVICE PGSERVICEFILE PGSSLMODE PGPASSFILE PGOPTIONS PGAPPNAME DATABASE_URL AGENT_HOSTING_PROTOCOL_DATABASE_URL AGENT_HOSTING_PROTOCOL_AUTH_TOKENS AGENT_HOSTING_PROTOCOL_PERSISTENCE_PROVIDER AHP_TEST_DATABASE_URL SUPABASE_URL SUPABASE_DB_URL POSTGRES_URL POSTGRES_PRISMA_URL`. Only local ephemeral WebSocket/in-memory test fixtures were exercised; no live persistence/provider services.

## Onward limits / next action

- Lead must integrate exact scope, reverify hashes and obtain Luna's independent final review before accepting P04.
- P05 must implement authorized creation, canonical owner/bootstrap attach and work owner projection. No such creation grant is manufactured by setup.
- P09 must implement real dispatch/executor admission; P10 recipient projection/reducer coherence; P12 actual authorized SDK multi-client evidence. The private compatibility tests are not substitutes.
- External adapter guards/expiry are an explicit trusted local freshness obligation, not a distributed atomicity claim. Already admitted work side effects are not undone by withholding stale result delivery.
- No further source/test/README edits by Sol after the final green candidate. P05 remains unstarted; await the lead's next bounded assignment.
