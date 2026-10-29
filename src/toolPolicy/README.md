# Tool policy contracts

R5 declarations for generic tool roles, execution bindings, and serializable namespace manifests. The P01 contract boundary is accepted; later changes require an explicit amendment. This module compiles exact direct policies and namespace closures. Compilation is not a grant, and empty role branches still admit nobody only when a later evaluator reads them.

## Files

| File | Responsibility |
| ---- | -------------- |
| `constants.ts` | Operation names and direct-grant actor kinds. No application roles. |
| `types.ts` | Generic policy, binding, and namespace contracts. No traversal. |
| `helpers/validation/types.ts` | Schema bundle for one captured budget. |
| `helpers/validation/helpers.ts` | `createToolPolicySchemas` and the default schema instances. |
| `helpers/validation/index.ts` | Public validation exports. |
| `helpers/namespace/types.ts` | Detached namespace data without a resolver. |
| `helpers/namespace/helpers.ts` | `defineToolPolicyNamespace` capture. |
| `helpers/namespace/index.ts` | Namespace capture exports. |
| `helpers/factory/types.ts` | Factory options, selection results, and construction errors. |
| `helpers/factory/helpers.ts` | Immutable registry, include closure, and bounded selection. |
| `helpers/factory/index.ts` | Factory exports. |
| `helpers/assignments/types.ts` | Admitted tool projection input. |
| `helpers/assignments/helpers.ts` | `projectAssignedDescriptors` calls `toAhpToolDefinition` only after `validateAssignments`. |
| `helpers/assignments/index.ts` | Assignment exports. |
| `index.ts` | Public exports, including the authorization `PolicyDecision` re-export. |

## Public names

Types: `ToolActorPolicy`, `ToolActorRule`, `ToolOperation`, `ToolOperationRule`, `ToolExecutionPolicyBase`, `ToolExecutionPolicy`, `ToolExecutionBinding`, `PolicyDecision`, `PolicyResolutionContext`, `ToolPolicyNamespace`, `DefineToolPolicyNamespaceInput`, `ToolPolicyNamespaceManifest`, `DirectGrantActorKind`, `ToolPolicySchemas`, `CapturedNamespaceData`, `CompiledToolPolicy`, `ToolPolicyBindingRegistration`, `ToolPolicyFactoryOptions`, `PolicySelectionResult`, `ToolPolicyFactory`.

Values: `TOOL_OPERATIONS`, `DIRECT_GRANT_ACTOR_KINDS`, `createToolPolicySchemas`, `roleNameSchema`, `toolActorPolicySchema`, `toolActorRuleSchema`, `toolOperationRuleSchema`, `toolExecutionPolicyManifestSchema`, `toolExecutionBindingSchema`, `toolPolicyNamespaceManifestSchema`, `boundedExtensionSchema`, `policyDecisionSchema`, `defineToolPolicyNamespace`, `createToolPolicyFactory`, `ToolPolicyFactoryError`. `defineToolPolicyNamespace` accepts an optional second `PolicyLimits` argument when a declaration needs a validated budget other than the defaults.

## Assignment descriptors

`projectAssignedDescriptors(view, authorization, currentCaller, purpose)` consumes an authorizer-issued assignment projection. Pass the original caller's current trusted context even for execute delivery: the executor has its own captured identity and registration fence. Replacing the caller context with the executor's context does not validate that authority.

The authorizer validates the entire projection synchronously before descriptor materialization. A copied/cross-host authorization, stale contributor, mismatched purpose, missing exact assignment, or mismatched canonical contract yields no descriptors. Discovery requires an allowed discovery assignment and `reveal=true`; an invoke assignment alone does not disclose. Execute delivery requires the exact installed executor assignment and approved implementation, without granting broad discovery.

These are in-process reference helpers, not transport authentication or completed shared-host privacy enforcement.

## Serialization

`ToolPolicyNamespace.resolve` stays on the runtime interface. `toolPolicyNamespaceManifestSchema` has no callback field and rejects extra keys, including `resolve`. Definition ids use the same safe identifier schema as policy refs. Role strings use the same schema as binding roles. Extension capture is portable plain JSON: no `Buffer`, no getter or `toJSON` invocation. `createToolPolicySchemas` applies the captured key, depth, and byte budgets. Include-list length uses `maxNamespaceIncludes`, not include depth.

## Omissions

`createToolPolicyFactory` pins exact revisions, unions admitted direct refs with namespace selections, and keeps mandatory refs independently of that selection. Include expansion is memoized by namespace and depth, deduplicates includes before descent, and rejects cycles before reuse. `CompiledToolPolicy.extension` is the detached captured value and is accepted on direct factory policy options. Operation trees and exact-ref arrays use structural bounds derived from shared role, identifier, and reference limits. Extension depth, keys, and bytes apply only to extension data. The factory does not authorize a caller, infer a role from an opaque id, or copy resolver functions into an inspectable view. Dynamic resolver failure, timeout, malformed output, and out-of-admission output deny without publishing the thrown value. Static malformed configuration throws before a registry is published.
