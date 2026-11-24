import type {
  NamespaceRef,
  PolicyDecision,
  PolicyRef,
  ResourceRef,
  TrustedRequestContext,
} from "@authorization";

import {
  type DirectGrantActorKind,
  type PolicyOperation,
} from "./constants";

export type { PolicyDecision, PolicyOperation };

/**
 * Generic role gate. Missing branches and empty `anyOf` admit nobody.
 * There is no built-in role vocabulary.
 */
export interface ActorPolicy<TRole extends string = string> {
  readonly user?: { readonly anyOf: readonly TRole[] };
  readonly agent?: { readonly anyOf: readonly TRole[] };
}

/** Role-gated rules and direct grants are different modes. A missing mode is not allow-all. */
export type ActorRule<TRole extends string = string>
  = | { readonly mode: "roles"; readonly actors: ActorPolicy<TRole> }
    | {
      readonly mode: "direct-grant";
      readonly actors: readonly DirectGrantActorKind[];
    };

export interface PolicyOperationRule<TRole extends string = string> {
  readonly actor: ActorRule<TRole>;
  readonly requiredPermissions?: readonly string[];
  /** Discovery only. Missing is false and never creates a grant. */
  readonly reveal?: boolean;
}

export interface PolicyDefinitionBase {
  readonly id: string;
  readonly revision: number;
  readonly operations: Readonly<Partial<Record<PolicyOperation, PolicyOperationRule>>>;
  readonly challenge: { readonly required: boolean };
}

/**
 * Application policy. `TExtension` defaults to an open record so unrelated
 * extensions remain assignable. It is not `Record<string, never>`.
 */
export interface PolicyDefinition<
  TRole extends string = string,
  TExtension = Readonly<Record<string, unknown>>,
> extends PolicyDefinitionBase {
  readonly operations: Readonly<Partial<Record<PolicyOperation, PolicyOperationRule<TRole>>>>;
  readonly extension?: Readonly<TExtension>;
}

/** Verified facts only. Never a framework request or a caller-supplied role list. */
export interface PolicyResolutionContext {
  readonly actor: TrustedRequestContext;
  readonly resource: ResourceRef;
  readonly session?: ResourceRef;
  readonly tool?: { readonly id: string; readonly revision: number };
  readonly input: unknown;
}

/** Runtime namespace. `resolve` is not part of the serializable manifest. */
export interface PolicyNamespace<TPolicy extends PolicyDefinitionBase = PolicyDefinitionBase> {
  readonly name: string;
  readonly revision: number;
  readonly policies: readonly TPolicy[];
  readonly includes?: readonly NamespaceRef[];
  readonly resolve: (context: PolicyResolutionContext) => readonly PolicyRef[] | Promise<readonly PolicyRef[]>;
}

/** Captured namespace declaration supplied to the policy factory. */
export interface DefinePolicyNamespaceInput<TPolicies extends readonly PolicyDefinitionBase[]> {
  readonly name: string;
  readonly revision: number;
  readonly policies: TPolicies;
  readonly includes?: readonly NamespaceRef[];
  readonly resolve: PolicyNamespace<TPolicies[number]>["resolve"];
}

/** Serializable namespace projection. Callbacks are rejected, not stored. */
export interface PolicyNamespaceManifest {
  readonly name: string;
  readonly revision: number;
  readonly policies: readonly PolicyRef[];
  readonly includes?: readonly NamespaceRef[];
}
