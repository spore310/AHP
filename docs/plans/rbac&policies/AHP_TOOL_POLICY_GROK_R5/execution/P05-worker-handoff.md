# P05 worker handoff — contextual creation and canonical ownership

**IMPLEMENTED, VALIDATED and FROZEN for lead validation/independent final review. Not packet acceptance.** Sole writer Sol now stops; no P06 implementation.

Authority: `P05-authorization.md`, amended `P05-plan.md`, binding `P05-plan-amendment.md` and PASS `P05-plan-recheck.md`. P04 was accepted before execution. HEAD remains `22fa7955b8e43839e041228f647f26e00762ebbe`.

## Final candidate and actual gates

- Final sorted **30-file source/test/owning-README manifest** SHA-256: **`02cd1a6f231ba2a816ae0e8c8a74884d8ac372d24703b079bb49d8897a805097`**. Every per-file hash is in `execution/P05-checks.log` under `P05_FINAL_SOURCE_TEST_README_COUNT 30`. Digest input is sorted `hash space path LF` lines.
- Final full DB-safe **`pnpm validate` PASS**: **72 files / 662 tests**, lint/typecheck, docs (**163 mapped sources**) and build. Exact final marker: **`P05_HANDOFF_VALIDATE_EXIT:0`**. Earlier 658/659-test runs and provisional f959 hash are historical, explicitly superseded by three test-only distinguishing controls. Production/README bytes did not change during that final test-only refinement.
- New P05 suites: **47 protected-creation tests**, **13 binding-removal/coherence tests**. The unmocked public suite retains all 41 P04 controls and adds **11 P05 cases**, totaling52. All execute in the same passing full gate alongside the old canonical compatibility suites.
- The retained log contains every RED, unsuccessful gate and repair; no failures were erased or carried forward as intentional RED. No skipped tests, suppressions, thresholds weakened, unsafe casts or non-null assertions were added.

All established child DB/auth/provider exclusions were applied to runtime gates: PostgreSQL `PGHOST PGHOSTADDR PGPORT PGUSER PGPASSWORD PGDATABASE PGDATA PGSERVICE PGSERVICEFILE PGSSLMODE PGPASSFILE PGOPTIONS PGAPPNAME`, `DATABASE_URL`, `AGENT_HOSTING_PROTOCOL_DATABASE_URL`, `AGENT_HOSTING_PROTOCOL_AUTH_TOKENS`, `AGENT_HOSTING_PROTOCOL_PERSISTENCE_PROVIDER`, `AHP_TEST_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_DB_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`. No values were printed. Test services were loopback/in-process/memory fixtures, not live DB/external services.

## Delivered contracts

### Exact coherent registration and distinct creation authority

`creationSecurity` checks runtime exact true from the genuine registry's strict captured-compiler identity predicate before allocation/admission effects. Separate equivalent compilers and same-reference-identifiers/different-semantics compilers reject without changing prior decision currentness. Provider/config/parser/creation callback properties and policy/template data are captured; serializable type definitions do not include executable policy/template inventory. Enabled selection is registry-backed and exact, not guessed revision/latest parsing. Protected global role/tool-filter options and policy-bearing types without protection reject.

Creation requires the separate registered type/provider capability callback. Namespace closure, invoke permission, cursor permission, template presence and JSON actor/owner/role claims never grant it. The result must approve the exact frozen SDK request object and the entire fixed template (or explicit none for no template). Result/entry extras, copies/replays, wrong IDs/revisions/keys/counts/lifetimes, stale/expired/Promise guards reject. SDK materializes fresh binding IDs, actual creator actor/full candidate scope, fixed roles/policies/authority and preparation-time expiry; owner is the actual creator principal. No invited participant/general issuer or owner impersonation was added.

Bounds: accepted default ResourceRef URI512 before parsers/reservation/authority callbacks; JSON default AND absolute1MiB (smaller configured limits allowed); finite count defaults128/max1024; preparation5000/max60000ms, also capped by caller expiry; approval capped by the existing60s decision horizon; independent bootstrap lifetime host default1h/absolute24h with a positive per-template maximum. JSON capture additionally rejects cycles/accessors/coercion hooks/reserved keys and depth beyond64; it is independent of P01 extension and work input budgets.

### Transaction and lifecycle

A synchronous finite URI reservation is invisible to records/views/owners. Cancellation/timeout/disposal removes only its reservation, rejects promptly without waiting for an uncooperative adapter, observes late rejection and invokes late result cleanup once. Caller actor/fence/deadline/functions are captured; guards and clock run before final SDK-owned token/epoch/currentness checks. No await separates those checks from record/resource/owner/bootstrap attachment. Partial store/resource/later-binding failure rolls back only the attempted full candidate before publication/backend start.

Backend failure withdraws exact bootstrap receipts before publishing creationFailed, retaining the inspectable failed record, resource/admission and canonical owner. Unexpected trusted-store withdrawal failure propagates without falsely publishing cleanup/failure; the retained record stays non-ready. No owner teardown/reinstallation is used for that failure path.

Expected disposal copies/validates its input token before awaits, cancels/removes only that pending/live incarnation and reserves a bounded owner-free settle marker before deletion. Owner lookup disappears with the live record, not when backend settlement completes. Exact marker identity and old record/full-ref checks protect same-URI successors, including same-subject successors. Global disposal publishes its shared barrier before synchronous cleanup/reentry, cancels preparations before await and permits bare-factory reuse only after cleanup; composed host stop remains terminal and cancels in-process preparations immediately.

### Public composition / work

Native network create preserves canonical same-connection ready-state/kind gating and requires current exact-true P04 global-sequence permission plus a separately approved creation capability. Failed/unattempted initialize, missing/false/stale setup, borrowed JSON fences and revoked preparations have zero creation effects. In-process contextual creation does NOT require native cursor permission. Successful native create returns only `null`; raw subscriptions/views/counts/disposal/actions/tools remain denied.

Work accepts `SessionOwnerLookup`; its writable registry remains legacy-only. Protected host projects current full session ref -> canonical owner -> subject only in configured work domain, with no competing owner map or synthetic mutators. Host disposal captures expected ref before work awaits. Private kernel change is only option plumbing for read-only work lookup; legacy mutable attach/disposal hooks remain internal. Work equality, lease/presence, repositories, SQL and persistence implementations are unchanged.

## Distinguishing control mapping

| Criterion | Actual controls (test names in retained suites/log) |
| --- | --- |
| **S01** actual owner/participant | Senior/junior evaluate separate real complete bindings; wrong actor/role paths deny. Unmocked public Ada creates; Bob receives a test-only junior binding after ready and a real P03 allow, but Bob's work submit is denied before repository access; Ada succeeds as Ada. Same subject in another domain cannot project into configured work domain. No P05 participant issuer. |
| **S02** explicit authority/capture | Valid exact callback/template and explicit no-template positives; deny/copy/extra/none/expired/Promise negatives; genuine previously accepted SDK approval replay rejects without staling original; malformed bootstrap keys/revisions/roles/lifetimes; invoke/namespace alone never authorizes; namespace resolver not invoked. Unknown/disabled/policy-free/ambiguous/wrong-provider/global-role/filter rejects; exact default stays v1. Parser/provider/callback/template/input mutation cannot retarget captured facts; caller generation and release function captured. Mandatory linked admission remains required and cannot become an implicit alternative. URI512/513 and exact1MiB/one-over/config-too-large controls run before approval/effects; spent preparation-time binding expiry cannot be extended by delayed approval. |
| **S03** atomic attachment | First publication observes already committed canonical owner; actual second-binding, after-record-add and after-resource-install faults leave no owner/record/event/backend and permit a fresh-owner URI reuse. Authoritative collision probe preserves the incumbent and never tears it down. |
| **S04** exact lifecycle | Invisible same-URI reservation; abort/timeout/dispose × late allow/reject with genuine successor/current stamps preserved; pending expected-instance cancellation; bounded pending capacity; wrong/expired/Promise context guards; reentrant final guard; actual reentrant backend global-disposal bug reproduced and fixed; late old backend readiness/different-owner and rejection/same-owner cannot publish or stale successor. Actual network stop/revocation cancels parked approval, new connection cannot borrow old initialized JSON fence, native reply lost to revocation cannot reach queued creation. |
| **S05** failure/owner/settle/output | Genuine bootstrap allow before backend rejection; at failure publication its stamp is already stale while owner survives and failed record remains inspectable. Unexpected removal failure surfaces without false failure publication. Disposal removes owner while marker excludes reuse, clears exact marker despite backend rejection and caller token mutation; saturation denies before deleting another resource/calling its backend and preserves its stamp. Real initialized public creation returns exact null and no raw action/snapshot/tool egress. |
| **P05-1 review** compiler | Exact same compiler positive; separately equivalent and narrower user-semantics compiler negatives before registry allocation/admission; existing allow currentness retained. P03 constructor-options mutation cannot change captured identity. |
| **P05-2 review** protocol | Pre-initialize create denied then same URI succeeds after valid initialize; missing/false cursor permission plus spoofed wire claims never reaches approval; metadata true + explicit creation deny still denies; same-connection initialized/current + finite approval succeeds. Actual failed reply/revocation and borrowed-fence controls included. |
| **P05-3 review** bounds | Accepted default ResourceRef URI512 usable;513 has zero approval/record effects. Exact1MiB contextual JSON accepted, one-over and configured larger ceilings denied. No16MiB path. Transport envelope may reject earlier; sessions implementation has no websocket import. |
| **P03 additions** | Exact removal invalidates genuine allow/descriptor/executor proof and frees all three capacities; owner retained. Stale full fields/revision/missing ID and malformed input do not mutate currentness; both assignment maps remain on stale removal. Mandatory contribution removal denies until a fresh contribution is installed. Same-URI successor survives stale removal. Identity predicate has no epoch effect. |

## RED / repair honesty

- P03 prerequisite intended RED:9 failed/1 passed before methods; subsequent authorization/toolPolicy136 passed, later expanded removal suite13 passed.
- Protected factory intended RED:14 failed before pipeline. Public route intended RED:5 failed/42 passed while the original public deny remained active; activation then passed. No private-kernel mock supplied a public positive.
- Adversarial intended REDs found real defects: caller-mutable disposal token stranded a settle marker; reentrant backend cleanup prematurely cleared global disposal barrier; caller generation was reread after a callback. Each was repaired with its regression preserved and passed in the final full gate.
- Non-final type/lint failures are retained: declaration-based never narrowing/private mutable provider-map typing; explicit host callback parameters; wrong descriptor-positive purpose corrected to genuine discovery (not weakened to an empty descriptor); multiline/typed cleanup/SDK enum formatting; typed disposal promise rejection. No criterion had two failed repair attempts without diagnosis. No old test assertion was weakened.

## Exact scope (30 hashed files)

- `src/authorization/README.md`, `src/authorization/helpers/evaluate/{helpers,types}.ts`
- `src/sessions/README.md`, `src/sessions/{index,types}.ts`
- `src/sessions/createSession/{helpers,index}.ts`
- `src/sessions/helpers/application/{define,helpers,host}.ts`
- `src/sessions/helpers/sessionTypes/{helpers,types}.ts`
- `src/sessions/helpers/factory/helpers.ts`
- new `src/sessions/helpers/creation/{types,constants,helpers,index}.ts`
- `src/websocket/README.md`, `src/websocket/helpers/host/helpers.ts`
- `src/websocket/helpers/ahp/{helpers,types,agentWork}.ts`, `helpers/kernel/helpers.ts`
- `src/work/{README.md,types.ts,index.ts}`
- new `src/tests/authorization/bindingRemoval.test.ts`, new `src/tests/sessions/policyCreation.test.ts`, appended `src/tests/websocket/policyInitialization.test.ts`

Execution metadata: amended `execution/P05-plan.md`, retained `execution/P05-checks.log`, this handoff. No other source/fixture migration.

### Predecessor / superseding integrity

- Historical P03 manifest unchanged (`fa567a9c5558f0c3250d4460ab35846bb7a9e4f6bd818fbf520176cf27c98497`): **53/56 source entries unchanged**, only the three expressly approved entries superseded:
  - authorization README: `87996a657aab1ab17e774cc3641b72048f45e76df788b0eb9389954d7d29d18f`
  - evaluator types: `6b5a035c23c8a857d87fdb8c4f77a57013c0fcbf78febea3d988460021603119`
  - evaluator helper: `934207c93830f2ff3b2f6b15359d254a43243e1ba0d131b84b59ff705d5896df`
- Historical P04 manifest unchanged (`47b9e34efcb5b705de486ea05d9033c167850ad02fcad81698b56d3a25de4e08`): **76/85 entries unchanged**, all nine differences in the approved P05 coupling. Final audit reports **no unaccounted source paths**.
- All seven INTERNAL compatibility suite whole-file hashes AND the eighth REAL PUBLIC `agentWork.transport.test.ts` remain unchanged from accepted P04. No additional fixture migration.
- P04 security/transport/identity implementation hashes unchanged. Work helper/equality/lease logic, persistence and env source have no diff from HEAD. Private kernel has only the approved lookup option plumbing, not algorithm rewrites or a public export.

No commits/resets/stash/worktrees/packages/deploy/DB/schema/account/model changes or children. Unrelated dirty/untracked predecessor state, plan bundle and `nul` were preserved.

## Review/remaining limits and next ownership

Worker bounded self-review completed; independent final source review/lead acceptance remain pending. This is not P12 authorized SDK/reducer/privacy certification. Native create/null does not reopen recipient views. Future P06/P09 must check actual instance/readiness, not owner existence; failed/non-ready records cannot gain participant/dispatch rights by implication. IDs/revisions on later reissue must avoid ABA. Trusted application ports must honor synchronous no-callback mutation and release/currentness contracts; TypeScript does not sandbox dishonest JavaScript. Frozen v1 durable work-write reconciliation still has its documented same-owner recreate residual; P05 did not alter that persistence contract.

Source/tests/owning READMEs are now frozen after `P05_HANDOFF_VALIDATE_EXIT:0` and final integrity audit. Lead owns exact-candidate validation, Luna review, acceptance and onward P06 assignment. Sol stops after active notification to `w8:p2`.
