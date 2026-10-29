import type {
  NamespaceRef,
  PolicyDecision,
  PolicyRef,
  ResourceRef,
  TrustedRequestContext,
} from "@authorization";

import {
  type DirectGrantActorKind,
  type ToolOperation,
} from "./constants";

export type { PolicyDecision, ToolOperation };

/**
 * Generic role gate. Missing branches and empty `anyOf` admit nobody.
 * There is no built-in role vocabulary.
 */
export interface ToolActorPolicy<TRole extends string = string> {
  readonly user?: { readonly anyOf: readonly TRole[] };
  readonly agent?: { readonly anyOf: readonly TRole[] };
}

/** Role-gated rules and direct grants are different modes. A missing mode is not allow-all. */
export type ToolActorRule<TRole extends string = string>
  = | { readonly mode: "roles"; readonly actors: ToolActorPolicy<TRole> }
    | {
      readonly mode: "direct-grant";
      readonly actors: readonly DirectGrantActorKind[];
    };

export interface ToolOperationRule<TRole extends string = string> {
  readonly actor: ToolActorRule<TRole>;
  readonly requiredPermissions?: readonly string[];
  /** Discovery only. Missing is false and never creates a grant. */
  readonly reveal?: boolean;
}

export interface ToolExecutionPolicyBase {
  readonly id: string;
  readonly revision: number;
  readonly operations: Readonly<Partial<Record<ToolOperation, ToolOperationRule>>>;
  readonly challenge: { readonly required: boolean };
}

/**
 * Application policy. `TExtension` defaults to an open record so unrelated
 * extensions remain assignable. It is not `Record<string, never>`.
 */
export interface ToolExecutionPolicy<
  TRole extends string = string,
  TExtension = Readonly<Record<string, unknown>>,
> extends ToolExecutionPolicyBase {
  readonly operations: Readonly<Partial<Record<ToolOperation, ToolOperationRule<TRole>>>>;
  readonly extension?: Readonly<TExtension>;
}

/** Registry fact. `suppliedBy` is contract origin, not runtime attestation. */
export type ToolExecutionBinding
  = | {
    readonly location: "server";
    readonly suppliedBy: "server";
    readonly implementation: "host";
    readonly implementationId: string;
  }
  | {
    readonly location: "client";
    readonly suppliedBy: "server" | "client";
    readonly implementation: "client-owned";
    readonly implementationId: string;
  }
  | {
    readonly location: "client";
    readonly suppliedBy: "server";
    readonly implementation: "approved-artifact";
    readonly artifactRef: string;
  };

/** Verified facts only. Never a framework request or a caller-supplied role list. */
export interface PolicyResolutionContext {
  readonly actor: TrustedRequestContext;
  readonly resource: ResourceRef;
  readonly session?: ResourceRef;
  readonly tool?: { readonly id: string; readonly revision: number };
  readonly input: unknown;
}

/** Runtime namespace. `resolve` is not part of the serializable manifest. */
export interface ToolPolicyNamespace<TPolicy extends ToolExecutionPolicyBase = ToolExecutionPolicyBase> {
  readonly name: string;
  readonly revision: number;
  readonly policies: readonly TPolicy[];
  readonly includes?: readonly NamespaceRef[];
  readonly resolve: (context: PolicyResolutionContext) => readonly PolicyRef[] | Promise<readonly PolicyRef[]>;
}

/** Input shape reserved for a later factory. This packet does not implement it. */
export interface DefineToolPolicyNamespaceInput<TPolicies extends readonly ToolExecutionPolicyBase[]> {
  readonly name: string;
  readonly revision: number;
  readonly policies: TPolicies;
  readonly includes?: readonly NamespaceRef[];
  readonly resolve: ToolPolicyNamespace<TPolicies[number]>["resolve"];
}

/** Serializable namespace projection. Callbacks are rejected, not stored. */
export interface ToolPolicyNamespaceManifest {
  readonly name: string;
  readonly revision: number;
  readonly policies: readonly PolicyRef[];
  readonly includes?: readonly NamespaceRef[];
}
