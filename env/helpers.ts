import { envSchema, type EnvConfig } from "./types";

/**
 * Validate an environment source and return the typed configuration.
 *
 * Throws when validation fails. The thrown message names only the offending
 * keys and the validation failure, never the received values, so secrets and
 * other sensitive input are not copied into logs or error output.
 *
 * @param source Environment source to validate. Defaults to `process.env`;
 *   tests pass an explicit record for determinism.
 */
export const loadEnv = (source: NodeJS.ProcessEnv = process.env): EnvConfig => {
  const { data, error } = envSchema.safeParse(source);
  if (!error) {
    return data;
  }

  const details = error.issues
    .map((issue) => {
      const path = issue.path.join(".") || "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");

  throw new Error(`Invalid environment configuration (${details})`);
};
