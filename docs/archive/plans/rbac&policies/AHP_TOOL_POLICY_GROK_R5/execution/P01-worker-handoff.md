# Packet handoff

**Packet / design revision:** P01 / R5
**Verdict:** IMPLEMENTED — packet commands and `pnpm validate` passed. Acceptance remains with w8:p2.
**Candidate:** HEAD `22fa7955b8e43839e041228f647f26e00762ebbe` on `agentIdentity`. No commit. Untracked plan directory and empty `nul` were not reset, stashed, or deleted.
**Owned paths actually changed:**
- `src/authorization/constants.ts`
- `src/authorization/types.ts`
- `src/authorization/index.ts`
- `src/authorization/README.md`
- `src/toolPolicy/constants.ts`
- `src/toolPolicy/types.ts`
- `src/toolPolicy/index.ts`
- `src/toolPolicy/README.md`
- `src/toolExecution/types.ts`
- `src/toolExecution/index.ts`
- `src/toolExecution/README.md`
- `src/tests/authorization/contracts.test.ts`
- `tsconfig.json` (aliases `@authorization`, `@toolPolicy`, `@toolExecution` only)
- `docs/plans/rbac&policies/AHP_TOOL_POLICY_GROK_R5/execution/P01-worker-handoff.md`
- `docs/plans/rbac&policies/AHP_TOOL_POLICY_GROK_R5/execution/P01-worker-validate.log`
**Contract amendments:** none
**Behavior implemented and invariants preserved:** Portable contracts and strict schemas only. No factory, kernel, dispatcher, authenticator, or host/session/tools edit. `AuthenticatedPrincipal` is untouched. `PrincipalSubjectCompatibility` is a subject projection, not a replacement.

## Commands and results

Working directory: repository root. Toolchain: installed pnpm scripts, no install or upgrade. Integration DB variables were unset in the shell (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGDATA`, `PGSERVICE`, `PGSSLMODE`, `DATABASE_URL`, `AGENT_HOSTING_PROTOCOL_DATABASE_URL`). No live query.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm typecheck` | 0 | `tsc --noEmit` produced no errors |
| `pnpm exec vitest run src/tests/authorization/contracts.test.ts` | 0 | 1 file, 3 tests passed |
| `pnpm docs:check` | 0 | 124 source files mapped |
| `pnpm validate` | 0 | lint, typecheck, 53 files / 410 tests, docs:check 124, vite build. Log: `execution/P01-worker-validate.log` |

RED before implementation: `vitest` exit 1, `Cannot find package '@authorization'`. No production repair of a failing security assertion was required. One type annotation (`policyLimitsSchema` input is partial because of defaults) and lint formatting/control-character/void-union issues were fixed before the green gate.

## Coverage IDs

| ID | Test | Result |
| --- | --- | --- |
| K01 | `K01 no built-in role or implicit grant` | passed |
| K02 | `K02 one typed portable contract boundary` | passed |
| K03 | `K03 malformed policy and config values fail deterministically` | passed |

## Baseline failures distinguished from new failures

None. Prior baseline was 407 tests. This run is 410, the same suite plus these three tests.

## Frozen public names

Authorization types: `SecuritySubjectRef`, `PolicyActorRef`, `ResourceRef`, `TrustedRequestContext`, `PolicyRef`, `NamespaceRef`, `PolicyAdmission`, `PolicyScopeRules`, `GrantAuthority`, `ScopedPolicyBinding`, `AuthorityRevisionStamp`, `PrincipalSubjectCompatibility`, `TrustedHandshakeInput`, `ConnectionIdentityAdapter`, `ActorResolutionRequest`, `ActorResolver`, `BindingQuery`, `BindingResolver`, `GrantIssueRequest`, `PreparedGrant`, `GrantRevocation`, `GrantIssuer`, `ResourceSelector`, `ResourceResolution`, `ResourceResolver`, `PolicyDecision`, `PolicyEvaluationRequest`, `PolicyEvaluator`, `FreshnessNotice`, `FreshnessPort`, `SecurityComposition`, `PolicyLimits`.

Authorization values: `POLICY_LIMIT_DEFAULTS`, `POLICY_LIMIT_ABSOLUTE`, `MAX_POLICY_REVISION`, `RESERVED_OBJECT_KEYS`, `policyLimitsSchema`, `securitySubjectRefSchema`, `policyActorRefSchema`, `resourceRefSchema`, `trustedRequestContextSchema`, `policyRefSchema`, `namespaceRefSchema`, `policyAdmissionSchema`, `policyScopeRulesSchema`, `grantAuthoritySchema`, `scopedPolicyBindingSchema`, `authorityRevisionStampSchema`, `policyDecisionSchema`, `rejectReservedKeys`.

Tool policy types: `ToolActorPolicy`, `ToolActorRule`, `ToolOperation`, `ToolOperationRule`, `ToolExecutionPolicyBase`, `ToolExecutionPolicy`, `ToolExecutionBinding`, `PolicyResolutionContext`, `ToolPolicyNamespace`, `DefineToolPolicyNamespaceInput`, `ToolPolicyNamespaceManifest`, `DirectGrantActorKind`. `PolicyDecision` is re-exported from `@authorization`.

Tool policy values: `TOOL_OPERATIONS`, `DIRECT_GRANT_ACTOR_KINDS`, `toolActorPolicySchema`, `toolActorRuleSchema`, `toolOperationRuleSchema`, `toolExecutionPolicyManifestSchema`, `toolExecutionBindingSchema`, `toolPolicyNamespaceManifestSchema`, `boundedExtensionSchema`, `policyDecisionSchema`.

Tool execution types: `Awaitable`, `ValidationResult`, `ToolPreparationHooks`, `ToolActionContext`, `ChallengePresentation`, `ChallengeContinuation`, `ChallengeProof`, `ChallengeVerification`, `ChallengeStatus`, `ChallengeAdapter`, `ArtifactDescriptor`.

Tool execution values: `ToolAction`, `challengePresentationSchema`.

`ToolAction.execute` takes one canonical input and `prepared: TPrepared | undefined`. `ValidationResult` is `void` or `{ kind: "normalized"; input }` of that same input type.

## Limits

Defaults: include depth 16, expanded policies 256, delegation depth 8, challenges 8 per actor and 64 per host, challenge lifetime 300 seconds, retained calls 256, aggregate results 16 MiB, retention 60 seconds, roles 32, policy refs 64, metadata strings 256, hook deadline 5000 ms, extension depth 8, extension bytes 16384, extension keys 32, identifier length 128.

Absolute ceilings are in `POLICY_LIMIT_ABSOLUTE` (for example challenges per host 1024, extension depth 16). Zero, negative, non-integer, and non-finite values fail. Empty `anyOf`, missing actor branches, and omitted binding `roles`/`policies` normalize to empty and the K01 fixture treats them as deny. Direct-grant mode must be explicit.

## Omissions

- `defineToolPolicyNamespace` and `createToolPolicyFactory` are not implemented. `DefineToolPolicyNamespaceInput` is the reserved input type.
- No evaluator, issuer, identity adapter, or dispatcher.
- Manifest extension bounds use `POLICY_LIMIT_DEFAULTS`, not a caller-selected lower `PolicyLimits` value. The limits schema itself accepts a lower budget.
- `src/README.md` capability table and `docs/CodingRules.md` alias list were not edited; they are outside this packet's write list. `pnpm docs:check` passes because each new file is mapped by its module README.
- `ToolAction` lives in `src/toolExecution/types.ts`, not `helpers/action`, because this packet forbids helper scaffolding.

## Remaining scope or blockers

No P01 blocker. P02 is not started.

**No-database/no-deploy boundary:** no query, migration, package install, commit, reset, stash, or worktree.

**Documentation source mapping:** module README file tables. `docs:check` 124 files.

**Next eligible packet:** P02, only after acceptance.
