import { z } from "zod";
import { executionSchema, workUuid } from "./execution";
export { executionSchema, workUuid } from "./execution";
import { captureValue } from "@jsonrpc/helpers/value/helpers";
import type { JsonObject } from "@persistence/helpers/durability/types";
import { isPortableText } from "@persistence/helpers/text";

const nonblank = (max: number) => z.string().min(1).max(max).refine((text) => text.trim().length > 0 && isPortableText(text));
const locator = z.strictObject({ id: nonblank(2048), kind: nonblank(128), instanceId: nonblank(2048).optional() });
const session = locator.extend({ kind: z.literal("session") });
const rule = z.strictObject({ resource: locator, include: z.boolean(), includeDescendants: z.boolean().optional() });
const revision = z.string().regex(/^[1-9][0-9]{0,18}$/).refine((n) => BigInt(n) <= 9223372036854775807n);

function jsonObject(maxBytes: number) {
  return z.unknown().transform((raw, context): JsonObject => {
    try {
      const { value } = captureValue(raw, { maxBytes, maxKeys: 4096, maxDepth: 16, postgres: true });
      if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as JsonObject;
    } catch { /* Return the same schema issue for every malformed payload. */ }
    context.addIssue({ code: "custom", message: "Expected a bounded JSON object." });
    return z.NEVER;
  });
}

export const submissionSchema = z.strictObject({ session: session.optional(), kind: nonblank(128), requestKey: nonblank(256), input: jsonObject(65536),
  priority: z.int32().optional(), targetAgentId: workUuid.optional(), scope: z.array(rule).min(1).max(128).refine((rules) => rules.some((r) => r.include)),
  announce: z.array(rule).max(128).optional(), data: jsonObject(65536).optional() });
export const replacementSchema = z.strictObject({ expectedDataRevision: revision, data: jsonObject(65536) });
export const completionSchema = z.strictObject({ result: jsonObject(262144), data: replacementSchema.optional() });
export const failureSchema = z.strictObject({ retryable: z.boolean(), code: nonblank(64).optional(), message: nonblank(512).optional(), data: replacementSchema.optional() });

const version = z.literal(1);
const byId = z.strictObject({ version, workId: workUuid });
export const workRequestSchemas = Object.freeze({
  submit: submissionSchema.extend({ version }),
  claim: z.strictObject({ version, session }),
  renew: executionSchema.extend({ version }),
  complete: completionSchema.extend({ version, ...executionSchema.shape }),
  fail: failureSchema.extend({ version, ...executionSchema.shape }),
  cancel: byId, get: byId,
  updateData: replacementSchema.extend({ version, workId: workUuid, execution: executionSchema.optional() })
    .refine((command) => command.execution === undefined || command.execution.workId === command.workId),
});
