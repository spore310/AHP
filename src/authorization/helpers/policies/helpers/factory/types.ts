import type { NamespaceRef, PolicyAdmission, PolicyLimits, PolicyRef, PolicyScopeRules } from "@authorization";

import type { PolicyResolutionContext, PolicyDefinitionBase, PolicyNamespace } from "../../types";

/** Registry snapshot. Extension is captured data, not a second policy schema. */
export interface CompiledPolicy extends PolicyDefinitionBase {
  readonly extension?: unknown;
}

export type PolicyFactoryErrorCode
  = "invalid-definition"
    | "conflict"
    | "cycle"
    | "unknown-reference"
    | "limit"
    | "binding-not-found";

/** Factory construction failure. Dynamic resolver failures are results, not this error. */
export class PolicyFactoryError extends Error {
  readonly code: PolicyFactoryErrorCode;

  constructor(code: PolicyFactoryErrorCode, message: string) {
    super(message);
    this.name = "PolicyFactoryError";
    this.code = code;
  }
}

export interface PolicyBindingRegistration {
  readonly sessionType: { readonly key: string; readonly version: number };
  readonly providerId: string;
  readonly admitted: PolicyAdmission;
  readonly mandatory: readonly PolicyRef[];
}

export interface PolicyFactoryOptions {
  readonly policies?: readonly CompiledPolicy[];
  readonly namespaces?: readonly PolicyNamespace[];
  readonly bindings?: readonly PolicyBindingRegistration[];
  readonly limits?: PolicyLimits;
}

/** Selection is not a grant. Mandatory refs are independent of alternatives. */
export type PolicySelectionResult
  = | { readonly effect: "deny"; readonly code: string }
    | {
      readonly effect: "selected";
      readonly alternatives: readonly PolicyRef[];
      readonly mandatory: readonly PolicyRef[];
    };

export interface CompiledNamespaceView {
  readonly name: string;
  readonly revision: number;
  readonly policies: readonly PolicyRef[];
  readonly includes: readonly NamespaceRef[];
  readonly expanded: readonly PolicyRef[];
}

export interface PolicyFactory {
  getPolicy(ref: PolicyRef): CompiledPolicy | undefined;
  /** Resolve a trusted application ceiling against these same registered namespaces. */
  selectRules?(rules: PolicyScopeRules, context: PolicyResolutionContext): Promise<PolicySelectionResult>;
  forSessionType(
    sessionType: { readonly key: string; readonly version: number },
    providerId: string,
  ): PolicyScopeRules;
  select(input: {
    readonly sessionType: { readonly key: string; readonly version: number };
    readonly providerId: string;
    readonly context: PolicyResolutionContext;
  }): Promise<PolicySelectionResult>;
  inspect(): {
    readonly policies: readonly CompiledPolicy[];
    readonly namespaces: readonly CompiledNamespaceView[];
  };
}
