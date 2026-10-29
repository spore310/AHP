import type { ToolDefinition } from "@microsoft/agent-host-protocol";
import type { ToolContractDefinition } from "@tools";
import type { ToolOperation } from "../../types";

export interface AdmittedTool {
  readonly contract: ToolContractDefinition;
  readonly allowed: boolean;
  readonly reveal: boolean;
}

export interface AssignmentSelection {
  readonly purpose: ToolOperation;
  readonly tools: readonly AdmittedTool[];
  readonly descriptors: readonly ToolDefinition[];
}
