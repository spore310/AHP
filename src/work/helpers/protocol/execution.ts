import { z } from "zod";

export const workUuid = z.uuid().transform((id) => id.toLowerCase());
export const executionSchema = z.strictObject({ workId: workUuid, attempt: z.int().min(1).max(100), leaseToken: workUuid });
