import type { NamespaceRef, PolicyAdmission, PolicyLimits, PolicyRef, PolicyScopeRules } from "@authorization";

import type { PolicyResolutionContext, ToolExecutionPolicyBase, ToolPolicyNamespace } from "../../types";

/** Registry snapshot. Extension is captured data, not a second policy schema. */
export interface CompiledToolPolicy extends ToolExecutionPolicyBase {
  readonly extension?: unknown;
}

export type ToolPolicyFactoryErrorCode
  = "invalid-definition"
    | "conflict"
    | "cycle"
    | "unknown-reference"
    | "limit"
    | "binding-not-found";

/** Factory construction failure. Dynamic resolver failures are results, not this error. */
export class ToolPolicyFactoryError extends Error {
  readonly code: ToolPolicyFactoryErrorCode;

  constructor(code: ToolPolicyFactoryErrorCode, message: string) {
    super(message);
    this.name = "ToolPolicyFactoryError";
    this.code = code;
  }
}

export interface ToolPolicyBindingRegistration {
  readonly sessionType: { readonly key: string; readonly version: number };
  readonly providerId: string;
  readonly admitted: PolicyAdmission;
  readonly mandatory: readonly PolicyRef[];
}

export interface ToolPolicyFactoryOptions {
  readonly policies?: readonly CompiledToolPolicy[];
  readonly namespaces?: readonly ToolPolicyNamespace[];
  readonly bindings?: readonly ToolPolicyBindingRegistration[];
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

export interface ToolPolicyFactory {
  getPolicy(ref: PolicyRef): CompiledToolPolicy | undefined;
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
    readonly policies: readonly CompiledToolPolicy[];
    readonly namespaces: readonly CompiledNamespaceView[];
  };
}
