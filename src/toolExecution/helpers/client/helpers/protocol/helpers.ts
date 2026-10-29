import type { z } from "zod";
import { captureToolValue } from "@toolExecution/helpers/value";

/** Capture first: schema parsing must never evaluate wire-object accessors. */
export function parseToolWire<T>(schema: z.ZodType<T>, value: unknown): T {
  const limits = { maxBytes: 2 * 1024 * 1024, maxDepth: 64, maxKeys: 131072 };
  const captured = captureToolValue(value, limits).value;
  return captureToolValue(schema.parse(captured), limits).value as T;
}
