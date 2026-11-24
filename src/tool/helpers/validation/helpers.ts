import Ajv, { type ValidateFunction } from "ajv";

import { TOOL_SCHEMA_DIALECT } from "@tool/constants";
import { ToolContractError } from "@tool/types";

const FORBIDDEN_SCHEMA_KEYS = new Set([
  "$ref",
  "pattern",
  "patternProperties",
  "format",
  "$async",
  "$data",
]);

const SCHEMA_MAP_KEYS = ["properties", "definitions", "$defs"] as const;
const SCHEMA_ARRAY_KEYS = ["allOf", "anyOf", "oneOf"] as const;
const SINGLE_SCHEMA_KEYS = [
  "additionalProperties",
  "additionalItems",
  "contains",
  "if",
  "then",
  "else",
  "not",
  "propertyNames",
] as const;

/**
 * Creates an Ajv 8 instance for trusted, already-admitted draft-07 schemas.
 *
 * No coercion, defaults, additional-property removal, format plugin, or
 * remote schema loading.
 */
export function createTrustedAjv(allErrors = false): Ajv {
  return new Ajv({
    allErrors,
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
    return;
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

  for (const key of SINGLE_SCHEMA_KEYS) {
    if (record[key] !== undefined) walkSchema(record[key]);
  }
  for (const key of SCHEMA_ARRAY_KEYS) {
    if (Array.isArray(record[key])) record[key].forEach(walkSchema);
  }
  for (const key of SCHEMA_MAP_KEYS) {
    schemaMapValues(record[key]).forEach(walkSchema);
  }
  const items = record.items;
  if (Array.isArray(items)) items.forEach(walkSchema);
  else if (items !== undefined) walkSchema(items);
  for (const dependency of schemaMapValues(record.dependencies)) {
    if (!Array.isArray(dependency)) walkSchema(dependency);
  }
}

function schemaMapValues(value: unknown): unknown[] {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.values(value)
    : [];
}

function assertStringArray(value: unknown): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ToolContractError("invalid-schema", "Invalid tool schema.");
  }
}

function isRemoteIdentifier(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("ftp://");
}
