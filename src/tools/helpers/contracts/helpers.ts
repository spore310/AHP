import {
  CONTRACT_KEY_PATTERN,
  MAX_CONTRACT_VERSION,
  MAX_TOOL_DEFINITION_BYTES,
  MAX_TOOL_DEFINITION_DEPTH,
  TOOL_CONTRACT_META_KEY,
  TOOL_NAME_PATTERN,
  TOOL_SCHEMA_DIALECT,
  UUID_PATTERN,
} from "@tools/constants";
import { ToolContractError, type ToolContractDefinition } from "@tools/types";
import { assertTrustedSchema, compileTrustedSchema, createTrustedAjv } from "@tools/helpers/validation";

const DEFINITION_KEYS = new Set([
  "id",
  "key",
  "version",
  "name",
  "schemaDialect",
  "inputSchema",
  "outputSchema",
  "title",
  "description",
  "annotations",
  "metadata",
]);

/**
 * Admits a trusted tool-contract definition.
 *
 * The result is cloned, frozen, and JSON-serializable. Validator functions are
 * not stored on the definition.
 */
export function defineToolContract(input: unknown): ToolContractDefinition {
  const data = readPlainObject(input, 0, new WeakSet<object>());
  rejectUnknownKeys(data);
  const definition = captureDefinition(data);
  const serialized = jsonBytes(definition);
  if (serialized > MAX_TOOL_DEFINITION_BYTES) {
    throw new ToolContractError("invalid-definition", "Tool contract definition is too large.");
  }
  admitSchemas(definition);
  return freezeDeep(definition);
}

function captureDefinition(data: Record<string, unknown>): ToolContractDefinition {
  const id = readString(data.id);
  if (!UUID_PATTERN.test(id)) {
    throw new ToolContractError("invalid-definition", "Invalid tool contract identity.");
  }
  const key = readString(data.key);
  if (!CONTRACT_KEY_PATTERN.test(key)) {
    throw new ToolContractError("invalid-definition", "Invalid tool contract identity.");
  }
  const name = readString(data.name);
  if (!TOOL_NAME_PATTERN.test(name)) {
    throw new ToolContractError("invalid-definition", "Invalid tool contract identity.");
  }
  const version = readVersion(data.version);
  if (data.schemaDialect !== TOOL_SCHEMA_DIALECT) {
    throw new ToolContractError("invalid-definition", "Invalid tool contract identity.");
  }
  const inputSchema = readSchemaObject(data.inputSchema, "input");
  const definition: ToolContractDefinition = {
    id,
    key,
    version,
    name,
    schemaDialect: TOOL_SCHEMA_DIALECT,
    inputSchema,
  };
  if (data.outputSchema !== undefined) {
    Object.assign(definition, { outputSchema: readSchemaObject(data.outputSchema, "output") });
  }
  if (data.title !== undefined) {
    Object.assign(definition, { title: readString(data.title) });
  }
  if (data.description !== undefined) {
    Object.assign(definition, { description: readString(data.description) });
  }
  if (data.annotations !== undefined) {
    Object.assign(definition, { annotations: readPlainObject(data.annotations, 1, new WeakSet<object>()) });
  }
  if (data.metadata !== undefined) {
    const metadata = readPlainObject(data.metadata, 1, new WeakSet<object>());
    if (Object.prototype.hasOwnProperty.call(metadata, TOOL_CONTRACT_META_KEY)) {
      throw new ToolContractError("invalid-definition", "Reserved tool metadata is not writable.");
    }
    Object.assign(definition, { metadata });
  }
  return definition;
}

function admitSchemas(definition: ToolContractDefinition): void {
  assertTrustedSchema(definition.inputSchema, "input");
  if (definition.outputSchema !== undefined) {
    assertTrustedSchema(definition.outputSchema, "output");
  }
  const ajv = createTrustedAjv();
  compileTrustedSchema(ajv, definition.inputSchema);
  if (definition.outputSchema !== undefined) {
    compileTrustedSchema(ajv, definition.outputSchema);
  }
}

function readVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new ToolContractError("invalid-definition", "Invalid tool contract version.");
  }
  if (value < 1 || value > MAX_CONTRACT_VERSION) {
    throw new ToolContractError("invalid-definition", "Invalid tool contract version.");
  }
  return value;
}

function readString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolContractError("invalid-definition", "Invalid tool contract identity.");
  }
  return value;
}

function readSchemaObject(value: unknown, role: "input" | "output"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolContractError("invalid-schema", `Invalid ${role} schema root.`);
  }
  return readPlainObject(value, 1, new WeakSet<object>());
}

function rejectUnknownKeys(data: Record<string, unknown>): void {
  for (const key of Object.keys(data)) {
    if (!DEFINITION_KEYS.has(key)) {
      throw new ToolContractError("invalid-definition", "Invalid tool contract definition.");
    }
  }
}

function readPlainObject(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const json = readJson(value, depth, seen);
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new ToolContractError("invalid-definition", "Invalid tool contract definition.");
  }
  return json as Record<string, unknown>;
}

function readJson(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_TOOL_DEFINITION_DEPTH) {
    throw new ToolContractError("invalid-definition", "Tool contract definition is too deep.");
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ToolContractError("invalid-definition", "Invalid tool contract definition.");
    }
    return value;
  }
  if (
    typeof value === "function"
    || typeof value === "bigint"
    || typeof value === "symbol"
    || value === undefined
  ) {
    throw new ToolContractError("invalid-definition", "Invalid tool contract definition.");
  }
  if (typeof value !== "object") {
    throw new ToolContractError("invalid-definition", "Invalid tool contract definition.");
  }
  if (seen.has(value)) {
    throw new ToolContractError("invalid-definition", "Invalid tool contract definition.");
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new ToolContractError("invalid-definition", "Invalid tool contract definition.");
      }
      clone.push(readJson(value[index], depth + 1, seen));
    }
    return clone;
  }
  const prototype: object | null = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ToolContractError("invalid-definition", "Invalid tool contract definition.");
  }
  const clone: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new ToolContractError("invalid-definition", "Invalid tool contract definition.");
    }
    clone[key] = readJson(descriptor.value, depth + 1, seen);
  }
  return clone;
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    if (Array.isArray(value)) {
      for (const entry of value) {
        freezeDeep(entry);
      }
    } else {
      for (const entry of Object.values(value)) {
        freezeDeep(entry);
      }
    }
  }
  return value;
}
