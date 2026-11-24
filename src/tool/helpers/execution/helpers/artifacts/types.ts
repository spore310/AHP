import { z } from "zod";
import { identifierSchema } from "@authorization/helpers/validation";
import type { LocalToolImplementation } from "../../../client/types";

export const MAX_ARTIFACT_BYTES = 256 * 1024;
export const MAX_ARTIFACT_ENCODING = Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4;
const revision = z.int().positive().max(2_147_483_647);

export const approvedArtifactSchema = z.strictObject({
  contract: z.strictObject({ id: z.uuid(), key: identifierSchema, version: revision }),
  source: z.strictObject({ id: identifierSchema, revision }),
  descriptor: z.strictObject({ artifactId: identifierSchema, publisherId: identifierSchema, contractRevision: revision,
    implementationRevision: revision, runtime: identifierSchema, platform: identifierSchema,
    digest: z.string().regex(/^[0-9a-f]{64}$/u), verificationRef: identifierSchema }),
});

export type ApprovedArtifact = z.infer<typeof approvedArtifactSchema>;
export interface ArtifactSourceOptions {
  /** Trusted host check of publisher, approval and verification reference. */
  approve(artifact: ApprovedArtifact, signal: AbortSignal): boolean | Promise<boolean>;
  read(artifact: ApprovedArtifact, signal: AbortSignal): Uint8Array | Promise<Uint8Array>;
}

export interface ApprovedArtifactSource {
  /** Trusted application registration, before selecting an executor for this revision. */
  register(artifact: ApprovedArtifact): void;
  find(contract: ApprovedArtifact["contract"], source: ApprovedArtifact["source"]): ApprovedArtifact | undefined;
  read(artifact: ApprovedArtifact, signal: AbortSignal, current: () => boolean): Promise<string | undefined>;
}

export interface ApprovedArtifactLoader {
  readonly runtime: string;
  readonly platform: string;
  verify(artifact: ApprovedArtifact, bytes: Uint8Array): boolean | Promise<boolean>;
  load(artifact: ApprovedArtifact, bytes: Uint8Array): LocalToolImplementation | undefined | Promise<LocalToolImplementation | undefined>;
}
