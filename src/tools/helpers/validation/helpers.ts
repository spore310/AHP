import Ajv, { type ValidateFunction } from "ajv";

import { TOOL_SCHEMA_DIALECT } from "@tools/constants";
import { ToolContractError } from "@tools/types";

const FORBIDDEN_SCHEMA_KEYS = new Set([
  "$ref",
  "pattern",
  "patternProperties",
  "format",
  "$async",
  "$data",
]);

const SCHEMA_WALK_KEYS = new Set([
  "properties",
  "additionalProperties",
  "items",
  "contains",
  "if",
  "then",
  "else",
  "not",
  "allOf",
  "anyOf",
  "oneOf",
  "propertyNames",
  "dependencies",
  "dependentSchemas",
  "$defs",
  "definitions",
]);

/**
 * Creates an Ajv 8 instance for trusted, already-admitted draft-07 schemas.
 *
 * No coercion, defaults, additional-property removal, format plugin, or
 * remote schema loading.
 */
export function createTrustedAjv(): Ajv {
  return new Ajv({
    allErrors: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    strict: true,
    validateFormats: false,
    $data: false,
    addUsedSchema: false,
    inlineRefs: false,
    loadSchema: undefined,
  });
}

/** Rejects catalogue-forbidden schema features before compilation. */
export function assertTrustedSchema(
  schema: Readonly<Record<string, unknown>>,
  role: "input" | "output",
): void {
  if (!isObjectRootSchema(schema)) {
    throw new ToolContractError("invalid-schema", `Invalid ${role} schema root.`);
  }
  walkSchema(schema);
}

export function compileTrustedSchema(
  ajv: Ajv,
  schema: Readonly<Record<string, unknown>>,
): ValidateFunction {
  try {
    return ajv.compile(structuredClone(schema));
  } catch {
    throw new ToolContractError("invalid-schema", "Invalid tool schema.");
  }
}

function isObjectRootSchema(schema: Readonly<Record<string, unknown>>): boolean {
  return schema.type === "object";
}

function walkSchema(schema: unknown): void {
  if (typeof schema === "boolean") {
    throw new ToolContractError("invalid-schema", "Boolean schemas are not admitted.");
  }
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new ToolContractError("invalid-schema", "Invalid tool schema.");
  }

  const record = schema as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_SCHEMA_KEYS.has(key)) {
      throw new ToolContractError(
        "unsupported-schema-feature",
        "Unsupported schema feature.",
      );
    }
    if (key === "$id" || key === "id") {
      const identity = record[key];
      if (typeof identity === "string" && isRemoteIdentifier(identity)) {
        throw new ToolContractError(
          "unsupported-schema-feature",
          "Unsupported schema feature.",
        );
      }
    }
  }

  if (record.$schema !== undefined && record.$schema !== TOOL_SCHEMA_DIALECT
    && record.$schema !== "http://json-schema.org/draft-07/schema#"
    && record.$schema !== "http://json-schema.org/draft-07/schema") {
    throw new ToolContractError("invalid-schema", "Invalid tool schema.");
  }

  if (record.required !== undefined) {
    assertStringArray(record.required);
  }
  if (record.enum !== undefined && !Array.isArray(record.enum)) {
    throw new ToolContractError("invalid-schema", "Invalid tool schema.");
  }

  for (const key of SCHEMA_WALK_KEYS) {
    const nested = record[key];
    if (nested === undefined) {
      continue;
    }
    walkNested(nested);
  }
}

function walkNested(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "object" && entry !== null) {
        walkSchema(entry);
      }
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const looksLikeSchema = record.type !== undefined
      || record.properties !== undefined
      || record.items !== undefined
      || record.required !== undefined;
    if (looksLikeSchema || Object.keys(record).some((key) => FORBIDDEN_SCHEMA_KEYS.has(key))) {
      walkSchema(record);
      return;
    }
    for (const child of Object.values(record)) {
      if (typeof child === "object" && child !== null) {
        walkNested(child);
      }
    }
  }
}

function assertStringArray(value: unknown): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ToolContractError("invalid-schema", "Invalid tool schema.");
  }
}

function isRemoteIdentifier(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("ftp://");
}
