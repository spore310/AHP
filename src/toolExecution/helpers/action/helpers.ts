import { defineToolContract } from "@tools/helpers/contracts";
import { compileTrustedSchema, createTrustedAjv } from "@tools/helpers/validation";
import { toolExecutionBindingSchema } from "@toolPolicy/helpers/validation";

import type { CapturedToolValue, ToolActionRegistration, ToolActionRegistrationOptions, ToolValueLimits } from "./types";

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

/** Internal bounded JSON capture. Data keys never become policy keys or object setters. */
export function captureToolValue(value: unknown, limits: ToolValueLimits): CapturedToolValue {
  let bytes = 0;
  let keys = 0;
  const ancestors = new Set<object>();
  const invalid = (): never => {
    throw new TypeError("Invalid bounded tool JSON.");
  };
  const add = (size: number): void => {
    bytes += size;
    if (bytes > limits.maxBytes) invalid();
  };
  const stringBytes = (text: string): void => {
    if (text.length > limits.maxBytes) invalid();
    add(new TextEncoder().encode(JSON.stringify(text)).byteLength);
  };
  const visit = (current: unknown, depth: number): unknown => {
    if (depth > limits.maxDepth) invalid();
    if (typeof current === "string") {
      stringBytes(current);
      return current;
    }
    if (current === null || typeof current === "boolean" || (typeof current === "number" && Number.isFinite(current))) {
      add(JSON.stringify(current).length);
      return current;
    }
    if (typeof current !== "object" || ancestors.has(current)) return invalid();
    const array = Array.isArray(current);
    const prototype: unknown = Object.getPrototypeOf(current);
    if ((array && prototype !== Array.prototype) || (!array && prototype !== Object.prototype && prototype !== null)
      || Object.getOwnPropertySymbols(current).length !== 0) return invalid();
    if (array && current.length > limits.maxKeys) invalid();
    const names = Object.getOwnPropertyNames(current).filter((name) => !array || name !== "length");
    keys += names.length;
    if (keys > limits.maxKeys) invalid();
    if (array && names.length !== current.length) invalid();
    const copied: Record<string, unknown> | unknown[] = array ? [] : {};
    ancestors.add(current);
    add(2);
    try {
      for (let index = 0; index < names.length; index += 1) {
        const name = names[index];
        if (name === undefined || (array && name !== String(index))) return invalid();
        const descriptor = Object.getOwnPropertyDescriptor(current, name);
        if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return invalid();
        if (index > 0) add(1);
        if (!array) {
          stringBytes(name);
          add(1);
        }
        const child: unknown = descriptor.value;
        Object.defineProperty(copied, name, { value: visit(child, depth + 1), enumerable: true });
      }
      return Object.freeze(copied);
    } finally {
      ancestors.delete(current);
    }
  };
  return { value: visit(value, 0), bytes };
}
