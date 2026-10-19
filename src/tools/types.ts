import type { ToolAnnotations } from "@microsoft/agent-host-protocol";

/** Exact revision identity. Versions are positive integers, never ranges. */
export interface ToolContractRef {
  readonly key: string;
  readonly version: number;
}

/** Serializable trusted tool contract. Contains no functions or executors. */
export interface ToolContractDefinition {
  readonly id: string;
  readonly key: string;
  readonly version: number;
  readonly name: string;
  readonly schemaDialect: "draft-07";
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly title?: string;
  readonly description?: string;
  readonly annotations?: ToolAnnotations;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ToolDefinitionErrorCode
  = "invalid-definition"
    | "duplicate-revision"
    | "invalid-schema"
    | "unsupported-schema-feature";

export class ToolContractError extends Error {
  readonly code: ToolDefinitionErrorCode;

  constructor(code: ToolDefinitionErrorCode, message: string) {
    super(message);
    this.name = "ToolContractError";
    this.code = code;
  }
}

export type ToolValidationResult
  = { readonly status: "valid" }
    | { readonly status: "invalid" }
    | { readonly status: "schema-not-declared" }
    | { readonly status: "missing-contract" };

export interface ToolCatalogue {
  get(ref: ToolContractRef): ToolContractDefinition | undefined;
  list(): readonly ToolContractDefinition[];
  validateInput(ref: ToolContractRef, value: unknown): ToolValidationResult;
  validateOutput(ref: ToolContractRef, value: unknown): ToolValidationResult;
}

export interface ToolCatalogueOptions {
  readonly definitions: readonly ToolContractDefinition[];
}
