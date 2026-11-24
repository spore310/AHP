import type { ToolDefinition } from "@microsoft/agent-host-protocol";
import type { ToolContractDefinition } from "@tool";
import type { PolicyOperation } from "@authorization/helpers/policies/types";

export interface AdmittedTool {
  readonly contract: ToolContractDefinition;
  readonly allowed: boolean;
  readonly reveal: boolean;
}

export interface AssignmentSelection {
  readonly purpose: PolicyOperation;
  readonly tools: readonly AdmittedTool[];
  readonly descriptors: readonly ToolDefinition[];
}
