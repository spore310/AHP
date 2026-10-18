import type { SessionConfigSchema } from "@microsoft/agent-host-protocol";

import type { SessionConfigContract } from "@sessions/types";
import type { ToolContractDefinition, ToolContractRef } from "@tools";

/** Exact session-type revision. There is no latest resolver. */
export interface SessionTypeRef {
  readonly key: string;
  readonly version: number;
}

/** Serializable session-type definition. The config parser is not part of this object. */
export interface SessionTypeDefinition {
  readonly id: string;
  readonly key: string;
  readonly version: number;
  readonly providerId: string;
  readonly configSchema: SessionConfigSchema;
  readonly tools: readonly ToolContractRef[];
}

/** Code registration that binds a definition to its parser. */
export interface ApplicationSessionType {
  readonly definition: SessionTypeDefinition;
  readonly config: SessionConfigContract;
  readonly enabledForCreation: boolean;
}

export interface ResolvedSessionType {
  readonly definition: SessionTypeDefinition;
  readonly tools: readonly ToolContractDefinition[];
  readonly config: SessionConfigContract;
  readonly enabledForCreation: boolean;
}

export type SessionTypeErrorCode
  = "invalid-definition"
    | "duplicate-revision"
    | "missing-contract"
    | "duplicate-tool"
    | "manifest-too-large"
    | "type-disabled"
    | "type-not-found";

export class SessionTypeError extends Error {
  readonly code: SessionTypeErrorCode;

  constructor(code: SessionTypeErrorCode, message: string) {
    super(message);
    this.name = "SessionTypeError";
    this.code = code;
  }
}
