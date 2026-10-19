import type { ToolDefinition } from "@microsoft/agent-host-protocol";

import { MAX_TOOL_DEFINITION_BYTES, MAX_TOOL_DEFINITION_DEPTH, TOOL_CONTRACT_META_KEY } from "@tools/constants";
import type { ToolContractDefinition } from "@tools/types";

/**
 * Projects a trusted contract onto an AHP tool descriptor.
 *
 * The descriptor is not an executor and does not admit a client. Reserved
 * revision metadata is attached under {@link TOOL_CONTRACT_META_KEY}.
 */
export function toAhpToolDefinition(definition: ToolContractDefinition): ToolDefinition {
  const descriptor: ToolDefinition = {
    name: definition.name,
    inputSchema: {
      ...structuredClone(definition.inputSchema),
      type: "object",
    },
    _meta: {
      [TOOL_CONTRACT_META_KEY]: {
        id: definition.id,
        key: definition.key,
        version: definition.version,
      },
    },
  };
  if (definition.title !== undefined) {
    descriptor.title = definition.title;
  }
  if (definition.description !== undefined) {
    descriptor.description = definition.description;
  }
  if (definition.outputSchema !== undefined) {
    descriptor.outputSchema = {
      ...structuredClone(definition.outputSchema),
      type: "object",
    };
  }
  if (definition.annotations !== undefined) {
    descriptor.annotations = structuredClone(definition.annotations);
  }
  return descriptor;
}

/**
 * Conservative JSON equality for admitted contract data.
 *
 * Object key order is irrelevant. Array order is significant. This is not a
 * schema-equivalence proof.
 */
export function canonicalJsonEqual(left: unknown, right: unknown): boolean {
  const leftKey = canonicalKey(left, 0, new WeakSet(), { remaining: MAX_TOOL_DEFINITION_BYTES });
  if (leftKey === undefined) {
    return false;
  }
  const rightKey = canonicalKey(right, 0, new WeakSet(), { remaining: MAX_TOOL_DEFINITION_BYTES });
  return rightKey !== undefined && leftKey === rightKey;
}

function canonicalKey(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
  budget: { remaining: number },
): string | undefined {
  if (depth > MAX_TOOL_DEFINITION_DEPTH) {
    return undefined;
  }
  if (typeof value === "string" && value.length > budget.remaining) {
    return undefined;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))) {
    const encoded = JSON.stringify(value);
    return consume(encoded, budget) ? encoded : undefined;
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    return undefined;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return undefined;
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return undefined;
  }
  if (Array.isArray(value) && value.length > budget.remaining) {
    return undefined;
  }
  const keys = Array.isArray(value)
    ? Array.from({ length: value.length }, (_entry, index) => String(index))
    : Object.keys(value).sort();
  if (keys.length > budget.remaining || !consume("{}" + ",".repeat(Math.max(0, keys.length - 1)), budget)) {
    return undefined;
  }
  ancestors.add(value);
  try {
    const entries: string[] = [];
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        return undefined;
      }
      const nested: unknown = descriptor.value;
      const encoded = canonicalKey(nested, depth + 1, ancestors, budget);
      if (encoded === undefined) {
        return undefined;
      }
      if (Array.isArray(value)) {
        entries.push(encoded);
      } else {
        const label = `${JSON.stringify(key)}:`;
        if (!consume(label, budget)) {
          return undefined;
        }
        entries.push(`${label}${encoded}`);
      }
    }
    return Array.isArray(value) ? `[${entries.join(",")}]` : `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function consume(text: string, budget: { remaining: number }): boolean {
  budget.remaining -= Buffer.byteLength(text);
  return budget.remaining >= 0;
}
