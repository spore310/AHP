import type { SessionConfigSchema } from "@microsoft/agent-host-protocol";
import type { z } from "zod";

/** Inputs for {@link createSessionConfig}. */
export interface CreateSessionConfigInput {
  /** Descriptor advertised to clients. Cloned and frozen by the helper. */
  readonly schema: SessionConfigSchema;
  /** Runtime parser that normalizes accepted configuration. */
  readonly parser: z.ZodType<Record<string, unknown>>;
}
