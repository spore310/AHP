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
  /** Connection string consumed by the selected persistence adapter. */
  AGENT_HOSTING_PROTOCOL_DATABASE_URL: z.string().min(1).optional(),
  /** Optional provider selector; the adapter registry owns supported names. */
  AGENT_HOSTING_PROTOCOL_PERSISTENCE_PROVIDER: z.string().min(1).optional(),
  /**
   * JSON object mapping bearer tokens to trusted principal subjects. Never log
   * this value. Example: {"token-a":"alice","token-b":"bob"}.
   */
  AGENT_HOSTING_PROTOCOL_AUTH_TOKENS: z.string().min(1).optional(),
  AGENT_HOSTING_PROTOCOL_PRESENCE_TTL_SECONDS: z.coerce
    .number()
    .int("must be an integer")
    .min(5, "must be at least 5")
    .max(600, "must be at most 600")
    .default(90),
  AGENT_HOSTING_PROTOCOL_WORK_LEASE_SECONDS: z.coerce
    .number()
    .int("must be an integer")
    .min(5, "must be at least 5")
    .max(3600, "must be at most 3600")
    .default(60),
  AGENT_HOSTING_PROTOCOL_ALLOWED_WORK_KINDS: z
    .string()
    .min(1)
    .default("code.patch,code.review"),
});
export type EnvConfig = z.infer<typeof envSchema>;
