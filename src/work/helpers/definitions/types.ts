import type { JsonObject } from "@persistence/helpers/durability/types";

export interface WorkKindDescriptor {
  readonly kind: string;
  readonly maxAttempts: number;
  readonly inputSchema?: JsonObject;
  readonly resultSchema?: JsonObject;
  readonly dataSchema?: JsonObject;
}

/** Trusted application code pinned by the containing session type revision. */
export interface WorkKindRegistration extends Omit<WorkKindDescriptor, "maxAttempts"> {
  readonly maxAttempts?: number;
  readonly input?: WorkParser;
  readonly result?: WorkParser;
  readonly data?: WorkParser;
  readonly facts?: WorkParser;
}

export interface WorkParser {
  parse(value: unknown): unknown;
}

export interface CapturedWorkKind {
  readonly descriptor: WorkKindDescriptor;
  parseInput(value: unknown): JsonObject;
  parseResult(value: unknown): JsonObject;
  parseData(value: unknown): JsonObject;
  readonly parseFacts?: (value: unknown) => JsonObject;
}
