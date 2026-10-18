import { z } from "zod";

/**
 * Runtime contract for environment configuration. Values arrive from the
 * process environment as strings, so ports are coerced and every variable
 * declares a secure default where one exists.
 *
 * Only keys declared here are read; unrelated process variables are ignored.
 */
export const envSchema = z.object({
  AGENT_HOSTING_PROTOCOL_WEBSOCKET_HOST: z
    .string()
    .min(1, "must not be empty")
    .default("127.0.0.1"),
  AGENT_HOSTING_PROTOCOL_WEBSOCKET_PORT: z.coerce
    .number()
    .int("must be an integer")
    .min(1, "must be at least 1")
    .max(65535, "must be at most 65535")
    .default(12345),
});
export type EnvConfig = z.infer<typeof envSchema>;
