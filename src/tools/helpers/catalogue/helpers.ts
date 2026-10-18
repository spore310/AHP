import { defineToolContract } from "@tools/helpers/contracts";
import { compileTrustedSchema, createTrustedAjv } from "@tools/helpers/validation";
import type {
  ToolCatalogue,
  ToolCatalogueOptions,
  ToolContractDefinition,
  ToolContractRef,
  ToolValidationResult,
} from "@tools/types";
import { ToolContractError } from "@tools/types";

import type { ValidateFunction } from "ajv";

interface CompiledRevision {
  readonly definition: ToolContractDefinition;
  readonly validateInput: ValidateFunction;
  readonly validateOutput: ValidateFunction | undefined;
}

/**
 * Builds an in-memory catalogue of exact tool-contract revisions.
 *
 * Construction is atomic: one invalid or duplicate definition fails the whole
 * catalogue. Lookups are exact `{ key, version }` matches. Payload validation
 * never throws for missing, invalid, or undeclared-output results.
 */
export function createToolCatalogue(options: ToolCatalogueOptions): ToolCatalogue {
  if (!Array.isArray(options.definitions)) {
    throw new ToolContractError("invalid-definition", "Invalid tool catalogue options.");
  }

  const byRef = new Map<string, CompiledRevision>();
  const byId = new Map<string, CompiledRevision>();
  const ajv = createTrustedAjv();

  for (const seed of options.definitions) {
    const definition = defineToolContract(seed);
    const refKey = revisionKey(definition);
    if (byRef.has(refKey) || byId.has(definition.id)) {
      throw new ToolContractError("duplicate-revision", "Duplicate tool contract revision.");
    }
    const compiled: CompiledRevision = {
      definition,
      validateInput: compileTrustedSchema(ajv, definition.inputSchema),
      validateOutput: definition.outputSchema === undefined
        ? undefined
        : compileTrustedSchema(ajv, definition.outputSchema),
    };
    byRef.set(refKey, compiled);
    byId.set(definition.id, compiled);
  }

  return {
    get: (ref: ToolContractRef): ToolContractDefinition | undefined => {
      const compiled = byRef.get(revisionKey(ref));
      return compiled === undefined ? undefined : cloneDefinition(compiled.definition);
    },
    list: (): readonly ToolContractDefinition[] => {
      return [...byRef.values()]
        .map((entry) => cloneDefinition(entry.definition))
        .sort(compareDefinitions);
    },
    validateInput: (ref: ToolContractRef, value: unknown): ToolValidationResult => {
      const compiled = byRef.get(revisionKey(ref));
      if (compiled === undefined) {
        return { status: "missing-contract" };
      }
      return evaluate(compiled.validateInput, value);
    },
    validateOutput: (ref: ToolContractRef, value: unknown): ToolValidationResult => {
      const compiled = byRef.get(revisionKey(ref));
      if (compiled === undefined) {
        return { status: "missing-contract" };
      }
      if (compiled.validateOutput === undefined) {
        return { status: "schema-not-declared" };
      }
      return evaluate(compiled.validateOutput, value);
    },
  };
}

function evaluate(validator: ValidateFunction, value: unknown): ToolValidationResult {
  const snapshot = structuredClone(value);
  const ok = validator(snapshot);
  const errors = validator.errors === undefined || validator.errors === null
    ? []
    : validator.errors.slice();
  validator.errors = null;
  if (ok && errors.length === 0) {
    return { status: "valid" };
  }
  return { status: "invalid" };
}

function revisionKey(ref: Pick<ToolContractRef, "key" | "version">): string {
  return `${ref.key}@${String(ref.version)}`;
}

function cloneDefinition(definition: ToolContractDefinition): ToolContractDefinition {
  return structuredClone(definition);
}

function compareDefinitions(
  left: ToolContractDefinition,
  right: ToolContractDefinition,
): number {
  const keyOrder = left.key.localeCompare(right.key);
  if (keyOrder !== 0) {
    return keyOrder;
  }
  return left.version - right.version;
}
