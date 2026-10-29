import type { ToolContractDefinition } from "@tools/types";
import type { ToolExecutionBinding } from "@toolPolicy/types";
import type { ToolAction } from "../../types";

/** Trusted host registration, never a wire-supplied action or validator. */
export interface ToolActionRegistration<TInput, TOutput, TPrepared = void> {
  readonly definition: ToolContractDefinition;
  readonly implementation: ToolExecutionBinding;
  create(): ToolAction<TInput, TOutput, TPrepared>;
  validateInput(value: unknown): value is TInput;
  validateOutput(value: unknown): value is TOutput;
}

export interface ToolActionRegistrationOptions<TInput, TOutput, TPrepared = void> {
  readonly definition: ToolContractDefinition;
  readonly implementation: ToolExecutionBinding;
  create(): ToolAction<TInput, TOutput, TPrepared>;
}

export interface ToolValueLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxKeys: number;
}

export interface CapturedToolValue {
  readonly value: unknown;
  readonly bytes: number;
}
