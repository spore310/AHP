import { z } from "zod";
import { captureValue } from "@jsonrpc/value";
import { workViewStatuses } from "../views/schemas";

const revision = z.string().regex(/^[1-9][0-9]{0,18}$/u).refine((s) => BigInt(s) <= 9223372036854775807n);
const text = z.string().min(1).max(2048);
const session = z.strictObject({ domainId: text, kind: z.literal("session"), id: text, instanceId: text });
const item = z.strictObject({ id: z.uuid(), session, kind: z.string().min(1).max(128), priority: z.int32(), status: z.enum(workViewStatuses),
  revision, createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }) });
const generation = { version: z.literal(1), subscriptionId: z.uuid(), streamEpoch: z.string().min(1).max(256) };
export const resetSchema = z.strictObject(generation);
export const hintSchema = z.strictObject({ ...generation, workId: z.uuid(), revision,
  change: z.enum(["submitted", "claimed", "renewed", "completed", "failed", "requeued", "cancelled", "dataUpdated"]), serverSeq: z.int().nonnegative().optional() });
export const pageSchema = z.strictObject({ version: z.literal(1), items: z.array(item).max(100), nextCursor: z.uuid().optional() });
export const subscribedSchema = pageSchema.extend(generation);
export function capturePage(input: unknown): unknown {
  return captureValue(input, { maxBytes: 2 * 1024 * 1024, maxDepth: 8, maxKeys: 4096, postgres: true }).value;
}
