import type { SessionConfigSchema } from "@microsoft/agent-host-protocol";

import type { ApplicationSessionType } from "@sessions/helpers/sessionTypes";
import type { SessionConfigContract } from "@sessions/types";
import type { SessionTypePolicyRegistration } from "@sessions/helpers/creation/types";

import type { AuthorizedToolGrant } from "./types";

/**
 * Packages one domain session type for catalogue registration.
 *
 * The header is the session-type key. This does not create a session or a
 * JSON-RPC frame. Authentication is not implied.
 */
export function defineApplicationSession(input: {
  readonly id: string;
  readonly key: string;
  readonly version: number;
  readonly providerId: string;
  readonly configSchema: SessionConfigSchema;
  readonly config: SessionConfigContract;
  readonly tools: readonly AuthorizedToolGrant[];
  readonly enabledForCreation?: boolean;
  readonly policy?: SessionTypePolicyRegistration;
}): {
  readonly header: string;
  readonly registration: ApplicationSessionType;
  readonly grants: readonly AuthorizedToolGrant[];
} {
  return {
    header: input.key,
    registration: {
      definition: {
        id: input.id,
        key: input.key,
        version: input.version,
        providerId: input.providerId,
        configSchema: input.configSchema,
        tools: input.tools.map((grant) => ({ ...grant.ref })),
      },
      config: input.config,
      ...(input.policy === undefined ? {} : { policy: input.policy }),
      enabledForCreation: input.enabledForCreation ?? true,
    },
    grants: input.tools.map((grant) => ({
      access: grant.access,
      ref: { ...grant.ref },
    })),
  };
}
