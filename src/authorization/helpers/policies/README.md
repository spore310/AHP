# Policy definitions and namespaces

The authorization compiler selects exact direct policies and namespace closures for application-defined roles. Creation, work, session views and tool execution use the same factory instance as the canonical authorizer.

## Files

| File | Responsibility |
| ---- | -------------- |
| `constants.ts` | Operation names and direct-grant actor kinds. No application roles. |
| `types.ts` | Policy definitions and namespace contracts. No traversal. |
| `helpers/validation/types.ts` | Schema bundle for one captured budget. |
| `helpers/validation/helpers.ts` | `createPolicySchemas` and the default schema instances. |
| `helpers/validation/index.ts` | Public validation exports. |
| `helpers/namespace/types.ts` | Detached namespace data without a resolver. |
| `helpers/namespace/helpers.ts` | `definePolicyNamespace` capture. |
| `helpers/namespace/index.ts` | Namespace capture exports. |
| `helpers/factory/types.ts` | Factory options, selection results, and construction errors. |
| `helpers/factory/helpers.ts` | Immutable registry, include closure, and bounded selection. |
| `helpers/factory/index.ts` | Factory exports. |
| `index.ts` | Public exports, including the authorization `PolicyDecision` re-export. |

## Public names

Types: `ActorPolicy`, `ActorRule`, `PolicyOperation`, `PolicyOperationRule`, `PolicyDefinitionBase`, `PolicyDefinition`, `PolicyDecision`, `PolicyResolutionContext`, `PolicyNamespace`, `DefinePolicyNamespaceInput`, `PolicyNamespaceManifest`, `DirectGrantActorKind`, `PolicySchemas`, `CapturedNamespaceData`, `CompiledPolicy`, `PolicyBindingRegistration`, `PolicyFactoryOptions`, `PolicySelectionResult`, `PolicyFactory`.

Values: `POLICY_OPERATIONS`, `DIRECT_GRANT_ACTOR_KINDS`, `createPolicySchemas`, `roleNameSchema`, `actorPolicySchema`, `actorRuleSchema`, `policyOperationRuleSchema`, `policyDefinitionManifestSchema`, `policyNamespaceManifestSchema`, `boundedExtensionSchema`, `policyDecisionSchema`, `definePolicyNamespace`, `createPolicyFactory`, `PolicyFactoryError`. `definePolicyNamespace` accepts an optional second `PolicyLimits` argument when a declaration needs a validated budget other than the defaults.

## Serialization

`PolicyNamespace.resolve` stays on the runtime interface. `policyNamespaceManifestSchema` has no callback field and rejects extra keys, including `resolve`. Definition ids use the same safe identifier schema as policy refs. Role strings use the same schema as binding roles. Extension capture is portable plain JSON: no `Buffer`, no getter or `toJSON` invocation. `createPolicySchemas` applies the captured key, depth, and byte budgets. Include-list length uses `maxNamespaceIncludes`, not include depth.

## Omissions

`createPolicyFactory` pins exact revisions, unions admitted direct refs with namespace selections, and keeps mandatory refs independently of that selection. Include expansion is memoized by namespace and depth, deduplicates includes before descent, and rejects cycles before reuse. `CompiledPolicy.extension` is the detached captured value and is accepted on direct factory policy options. Operation trees and exact-ref arrays use structural bounds derived from shared role, identifier, and reference limits. Extension depth, keys, and bytes apply only to extension data. The factory does not authorize a caller, infer a role from an opaque id, or copy resolver functions into an inspectable view. Dynamic resolver failure, timeout, malformed output, and out-of-admission output deny without publishing the thrown value. Static malformed configuration throws before a registry is published.
