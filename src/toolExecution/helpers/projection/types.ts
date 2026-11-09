import type { ResourceOperationAuthority, ResourceOperations, ResourceRef } from "@authorization";
import type { Awaitable, ToolActionContext } from "../../types";

export interface ToolProjectionRequest {
  readonly target: ResourceRef;
  readonly operation: string;
  readonly payload: unknown;
}
export interface ToolProjectionOptions {
  readonly resources: ResourceOperations;
  project(output: unknown, context: ToolActionContext): Awaitable<ToolProjectionRequest | undefined>;
}
export interface ToolResultProjection {
  project(output: unknown, context: ToolActionContext, current: () => boolean, admission: (authority: ResourceOperationAuthority) => boolean): Promise<boolean>;
}
