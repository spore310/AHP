import type { ToolDefinition } from "@microsoft/agent-host-protocol";

import { TOOL_CONTRACT_META_KEY } from "@tools/constants";
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
  return canonicalKey(left) === canonicalKey(right);
}

function canonicalKey(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalKey(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalKey(nested)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(null);
}
