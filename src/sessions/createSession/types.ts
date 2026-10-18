import type { CreateSessionParams as AhpCreateSessionParams } from "@microsoft/agent-host-protocol";
import { z } from "zod";

import { sessionUriSchema } from "@/sessions/types";

/**
 * Parameters accepted by `createSession`.
 *
 * `channel` is the client-chosen session URI and is the only required member.
 * `activeClient` and `progressToken` are accepted for protocol completeness but
 * not interpreted yet: active-client tracking and progress reporting are their
 * own capabilities. Unknown additive members are discarded rather than rejected,
 * so a compatible protocol extension does not invalidate an otherwise valid
 * request; they are never forwarded to the provider.
 */
export const createSessionParamsSchema = z.object({
  channel: sessionUriSchema,
  provider: z.string().min(1).optional(),
  workingDirectories: z.array(z.string().min(1)).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  activeClient: z.unknown().optional(),
  progressToken: z.string().min(1).optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
});
export type CreateSessionParams = z.infer<typeof createSessionParamsSchema>;

/**
 * Compile-time conformance with the Microsoft `CreateSessionParams` type
 * (pinned in `package.json`), which is the source of truth for this method.
 *
 * The first assertion fails when a Microsoft member stops fitting this schema.
 * The second fails when Microsoft adds a parameter the schema does not model,
 * forcing an explicit decision about whether to accept it. The runtime
 * direction is covered by fixtures in
 * `src/tests/sessions/compliance.test.ts`, which are typed with the Microsoft
 * type and parsed with this schema.
 *
 * Internal verification surface; not exported from `@/sessions`.
 */
type AhpAssignableTo<TAhpValue, TSchemaValue> = [TAhpValue] extends [TSchemaValue] ? true : false;
type AhpLinked<TCheck extends true> = TCheck;

export type CreateSessionMicrosoftConformance = [
  AhpLinked<AhpAssignableTo<AhpCreateSessionParams, CreateSessionParams>>,
  AhpLinked<AhpAssignableTo<keyof AhpCreateSessionParams, keyof CreateSessionParams>>,
];
