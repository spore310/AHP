import { captureValue } from "@jsonrpc/helpers/value/helpers";
import { resourceRefSchema, type ResourceRef } from "@authorization";
import type { JsonObject, ResourceRecord } from "./types";

/** Only an interrupted, unprovisioned session may re-enter provider startup. */
export function canRetrySessionStart(record: ResourceRecord): boolean {
  return record.ref.kind === "session" && (record.lifecycle === "failed" || record.lifecycle === "suspended")
    && !Object.hasOwn(record.runtimeMetadata, "receipt");
}

export function captureData(value: unknown, maxBytes = 65536): JsonObject {
  const captured = captureValue(value, { maxBytes, maxDepth: 16, maxKeys: 4096, postgres: true }).value;
  if (captured === null || typeof captured !== "object" || Array.isArray(captured)) throw new TypeError("Expected a JSON object.");
  return captured as JsonObject;
}

export function captureRef<T extends string>(ref: ResourceRef<T>): ResourceRef<T> {
  const copy = resourceRefSchema.parse(ref);
  if ([copy.domainId, copy.kind, copy.id, copy.instanceId].reduce((sum, part) => sum + Buffer.byteLength(part), 0) > 2048) throw new Error("Resource identity exceeds byte limit.");
  return Object.freeze(copy) as ResourceRef<T>;
}

export function resourceOrder(records: readonly ResourceRecord[]): ResourceRecord[] {
  const result: ResourceRecord[] = [];
  const heights = new Map<ResourceRecord, number>();
  const byInstance = new Map(records.map((r) => [JSON.stringify([r.ref.kind, r.ref.id, r.ref.instanceId]), r]));
  const visit = (record: ResourceRecord, path: Set<ResourceRecord>): number => {
    if (path.has(record) || path.size > 32) throw new Error("Invalid resource dependency graph.");
    const known = heights.get(record);
    if (known !== undefined) return known;
    let height = 0;
    path.add(record);
    for (const ref of [record.parent, record.grantParent]) {
      if (ref === undefined) continue;
      const parent = byInstance.get(JSON.stringify([ref.kind, ref.id, ref.instanceId]));
      if (parent !== undefined) height = Math.max(height, 1 + visit(parent, path));
    }
    path.delete(record);
    if (height > 32) throw new Error("Resource dependency depth exceeded.");
    heights.set(record, height);
    result.push(record);
    return height;
  };
  for (const record of records) visit(record, new Set());
  return result;
}

/** Preserve synchronous memory transactions behind the asynchronous storage port. */
export function atomic<T>(run: () => T): Promise<T> {
  try {
    return Promise.resolve(run());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error("Durable operation failed."));
  }
}
