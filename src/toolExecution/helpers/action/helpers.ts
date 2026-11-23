import { compileToolContract } from "@tools/helpers/contracts";
import { toolExecutionBindingSchema } from "@toolPolicy/helpers/validation";

import type { ToolActionRegistration, ToolActionRegistrationOptions } from "./types";

/** The generic types are the host's schema/action pairing; every call still validates at runtime. */
export function createToolActionRegistration<TInput, TOutput, TPrepared = void>(
  options: ToolActionRegistrationOptions<TInput, TOutput, TPrepared>,
): ToolActionRegistration<TInput, TOutput, TPrepared> {
  const compiled = compileToolContract(options.definition);
  const implementation = Object.freeze(toolExecutionBindingSchema.parse(options.implementation));
  const create = options.create.bind(options);
  const validators = bindToolActionValidators(compiled);
  return Object.freeze({
    definition: compiled.definition, implementation, create,
    validateInput: (value: unknown): value is TInput => validators.validateInput(value),
    validateOutput: (value: unknown): value is TOutput => validators.validateOutput(value),
  });
}

export function bindToolActionValidators(
  { validateInput: input, validateOutput: output }: ReturnType<typeof compileToolContract>,
) {
  return {
    validateInput: (value: unknown): value is unknown => {
      const valid = input(value);
      input.errors = null;
      return valid;
    },
    validateOutput: (value: unknown): value is unknown => {
      if (output === undefined) return true;
      const valid = output(value);
      output.errors = null;
      return valid;
    },
  };
}

export { captureToolValue } from "../value";
