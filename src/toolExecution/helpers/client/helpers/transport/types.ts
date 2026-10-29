import type { LocalToolImplementation } from "../../types";
import type { ToolAssignedReply, ToolAdvertiseReply } from "../protocol";

export interface StagedToolRegistration {
  readonly view: ToolAssignedReply;
  readonly implementations: ReadonlyMap<string, LocalToolImplementation>;
}
export interface ActiveToolRegistration extends StagedToolRegistration {
  readonly acknowledgement: ToolAdvertiseReply;
}
