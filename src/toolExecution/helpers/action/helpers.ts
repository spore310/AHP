import { defineToolContract } from "@tools/helpers/contracts";
import { compileTrustedSchema, createTrustedAjv } from "@tools/helpers/validation";
import { toolExecutionBindingSchema } from "@toolPolicy/helpers/validation";

import type { ToolActionRegistration, ToolActionRegistrationOptions } from "./types";

/** The generic types are the host's schema/action pairing; every call still validates at runtime. */
export function createToolActionRegistration<TInput, TOutput, TPrepared = void>(
  options: ToolActionRegistrationOptions<TInput, TOutput, TPrepared>,
): ToolActionRegistration<TInput, TOutput, TPrepared> {
  const definition = defineToolContract(options.definition);
  const implementation = Object.freeze(toolExecutionBindingSchema.parse(options.implementation));
  const create = options.create.bind(options);
  const ajv = createTrustedAjv();
  const input = compileTrustedSchema(ajv, definition.inputSchema);
  const output = definition.outputSchema === undefined ? undefined : compileTrustedSchema(ajv, definition.outputSchema);
  return Object.freeze({
    definition, implementation, create,
    validateInput: (value: unknown): value is TInput => {
      const valid = input(value);
      input.errors = null;
      return valid;
    },
    validateOutput: (value: unknown): value is TOutput => {
      if (output === undefined) return true;
      const valid = output(value);
      output.errors = null;
      return valid;
    },
  });
}

export { captureToolValue } from "../value";
