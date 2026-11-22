# P04 global-sequence correction handoff

**Implemented and FROZEN for lead validation/Luna's narrow final recheck. Not P04 acceptance.**

Authority: lead-accepted `P04-sequence-resolution.md`, PASS direction recheck in `P04-sequence-plan-recheck.md`, and the explicit eighth-public-fixture amendment. HEAD remains `22fa7955b8e43839e041228f647f26e00762ebbe`.

## P05 state before correction

`execution/P05-plan.md` was completed and actively handed off to `w8:p2` before switching to this correction. Only that P05 plan was written; no P05 implementation or P05 runtime commands occurred. It remains plan-only, blocked on corrected P04 acceptance, plan/API/bounds/write-set acceptance, and the explicit conditional P03 binding-removal amendment. Its current SHA-256 is `152a76a1cff5941ecf47e432a99dc91f2ce9a9b7e430031c0b15aaf392c69d6f`.

## Narrow implemented amendment

- `PreparedInitialScopes.allowGlobalSequence?: boolean` is an explicit trusted application fact, default false. The setup adapter captures its value once, requires an actual boolean when supplied, rejects malformed/Promise values, and releases rejected preparations. It never infers this permission from authentication, scopes, bindings, roles, namespaces or wire fields.
- The frozen `ConnectionSecuritySnapshot` carries `allowGlobalSequence: boolean`. Existing setup currentness, expiry and release cover this permission as well as the scoped facts. The trusted adapter must invalidate its synchronous guard when permission is revoked.
- Public initialize checks runtime **exact true**, a present/matching real connection generation/id and snapshot context id, and live synchronous currentness before entering the canonical initialize handler or reading the sequence getter. A local `unknown` observation preserves runtime exact-boolean checking without a lint suppression or truthiness fallback.
- No security, missing/false approval, unknown identity, stale/expired setup, malformed values and wire spoofing never authorize native initialization. Denied initialization cannot commit readiness. Existing final egress currentness behavior remains intact; revoked/expired setup closes without releasing a response.
- Explicitly authorized initialization returns the genuine canonical current cursor, native protocol version and empty snapshots. This capability deliberately permits observing **host-wide activity**, not scoped counts, resource/root snapshots, session mutations or tools. Those protected routes remain denied. No fabricated zero, omitted field, alternate cursor, native protocol change, new authenticator or authorization engine was introduced.
- `src/websocket/README.md`, `src/agents/README.md` and the superseding amendment in `execution/P04-plan.md` document the stronger default denial and explicit metadata capability. Earlier anonymous-success assumptions in historical P04 evidence are superseded, not fallback behavior. Ping retains the existing native ready-phase rules.

## Regression evidence

`execution/P04-sequence-checks.log` retains every attempt and failure, followed by final GREEN evidence.

1. **Intended runtime RED, before production/type changes:** 14 failed / 27 passed in the public initialization suite. The real no-config public host, after a trusted server-side session mutation, disclosed `serverSeq: 2` with empty snapshots. Separate revoked/expired controls exposed getter entry despite final-send suppression. These are the actual prior defect, not a fabricated counter mock.
2. **New distinguishing controls:** real factory mutation before a spy on its actual `getCurrentServerSeq`; zero getter calls for no setup, missing/false permission, invalid identity, producer mutation, stale/expired permission and wire-spoof attempts; malformed string/number/null/Promise approval rejection with exact release and no binding reads; no readiness after denial.
3. **Real positive:** public `createAHPServer`, verified trusted setup explicitly approving the cursor, actual server-side mutations before two client connections, exact complete native reply equality against the advancing canonical cursor and `snapshots: []`. Root subscription/tools remain denied. No private-kernel substitution is used for this positive.
4. Existing P04 native-positive fixtures explicitly approve this metadata capability through their trusted preparation results. The unit fixture without approval asserts the captured default is false.
5. Focused public initialization + adapter + public work transport: **3 files / 61 tests passed**. P04-owned suites themselves are now 58 tests (41 public initialization + 17 adapter), twelve added over the original 46.
6. Final full DB-safe **`pnpm validate` passed: 70 files / 591 tests**, typecheck, lint, documentation (**159 mapped sources**) and build. The exact frozen-source run is `SEQUENCE_FROZEN_VALIDATE_EXIT:0`.

All prescribed PostgreSQL/database/Supabase/auth/provider integration environment variables were unset in each gate child; no values were printed and no live database or external service was used. Runtime test hosts were loopback/in-process fixtures.

### Preserved non-final failures

The log also records one test-formatting lint failure (two statements on one line), repaired without suppression; one full-gate type error from accessing an `unknown` response while strengthening equality, repaired by asserting the exact complete frame without casts or weakened expectations; and one integrity-script Windows default-decoding error, repaired with explicit UTF-8, with no source change. Initial RED, lint/type failures and diagnostic failure were not erased or relabeled GREEN. No skipped tests, suppressions, threshold changes or intentional RED carryover remain.

## Exact correction writes and continuity audit

Production changes are limited to:

- `src/websocket/helpers/security/types.ts`
- `src/websocket/helpers/security/helpers.ts`
- `src/websocket/helpers/ahp/helpers.ts`

Owning test/doc changes:

- `src/tests/websocket/policyInitialization.test.ts`
- `src/tests/agents/policyActor.test.ts`
- `src/tests/websocket/agentWork.transport.test.ts` — explicitly authorized **eighth PUBLIC fixture/expectation tightening**, not another internal-kernel migration.
- `src/websocket/README.md`, `src/agents/README.md`
- `execution/P04-plan.md`, this handoff and `execution/P04-sequence-checks.log`.

The eighth public test uses the real existing setup adapter and exact original authenticator's legacy identity bridge, an explicit verified-user set, empty scopes and explicit cursor permission only after successful identity/actor resolution. It does not fabricate context, invoke another authenticator or mock the public facade/kernel. Only its obsolete anonymous-success expectation and subsequent message are strengthened: initialize denies, subsequent registration fails as uninitialized before effects. All valid-subject, records-size-2, work-calls-`[submit]`, held-frame and throwing-authenticator assertions remain and pass.

The final integrity audit establishes:

- Accepted P03 manifest SHA `fa567a9c5558f0c3250d4460ab35846bb7a9e4f6bd818fbf520176cf27c98497`: **56/56 unchanged**.
- Exactly the seven expected source/test/README entries differ from the original 28-entry P04 candidate; the additional eighth public fixture is separately listed and hashed.
- All **seven internal compatibility suite whole files** match the frozen original P04 hashes, retaining its earlier unchanged-body audit: `ahp`, `sdk`, `toolInvocation`, `agentWork.binding`, `agentWork.disposal`, `sessionTypeCapacity`, `agentWork.integration`.
- Private kernel unchanged, SHA `77d980f4694274e943cff3c062762f5e3036aa2dbbdb086b846c6302c4c7a5c5`.
- Canonical factory and allocator unchanged from HEAD. Transport server/connection and host helper/types match the original frozen P04 candidate; no generic transport reordering.
- The sorted **29-entry source/test/README manifest** and all per-file hashes are in the checks log. Candidate SHA-256: **`8fc437a4c8ee5ecfb1dcd84bf3c0dbf8b8ff8cdc5138dfa17d7562e2b41f0566`** (SHA-256 of sorted `hash space path LF` lines). Plan hash is recorded separately.

No source/test/README edits occurred after the final successful frozen-source full gate. Only integrity evidence and this handoff were appended. No commits, resets, stash, worktrees, packages, DB/schema changes, model/account changes or children were used. Predecessor dirty/untracked state was preserved.

## Stop / next ownership

Sole correction writer now stops. Lead owns exact-candidate validation/acceptance and requesting Luna's narrow final recheck. Internal canonical compatibility tests remain explicitly non-public evidence; this handoff is not P12 authorized SDK certification. P05 implementation remains blocked and has not started.
