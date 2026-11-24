import type { ToolContractDefinition } from "@tool/types";
import type { ToolExecutionBinding } from "@tool/policy/binding";
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
