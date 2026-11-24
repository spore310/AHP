import { isDeepStrictEqual } from "node:util";
import { identifierSchema } from "@authorization";
import { captureData } from "@persistence/helpers/durability/helpers";
import type { JsonObject } from "@persistence/helpers/durability/types";
import type { ResolvedSessionType } from "@sessions/helpers/sessionTypes/types";
import { WorkError } from "../errors";
import type { CapturedWorkKind, WorkKindDescriptor, WorkKindRegistration, WorkParser } from "./types";

function descriptor(registration: WorkKindRegistration): WorkKindDescriptor {
  const { kind, maxAttempts = 3, inputSchema, resultSchema, dataSchema } = registration;
  if (!identifierSchema.safeParse(kind).success || !kind.trim() || kind.length > 128 || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
    throw new TypeError("Invalid work kind or retry budget.");
  }
  return Object.freeze({ kind, maxAttempts,
    ...(inputSchema === undefined ? {} : { inputSchema: captureData(inputSchema) }),
    ...(resultSchema === undefined ? {} : { resultSchema: captureData(resultSchema) }),
    ...(dataSchema === undefined ? {} : { dataSchema: captureData(dataSchema) }) });
}

function parser(contract: WorkParser): WorkParser {
  if (typeof contract.parse !== "function") throw new TypeError("Invalid work parser.");
  return Object.freeze({ parse: contract.parse.bind(contract) });
}

/** Produce separate code registrations and serializable, deterministically ordered descriptors. */
export function captureWorkKinds(registrations: readonly WorkKindRegistration[] = [], declared?: readonly WorkKindDescriptor[]) {
  if (registrations.length > 64 || (declared !== undefined && declared.length !== registrations.length)) throw new TypeError("Invalid work manifest.");
  const kinds = new Set<string>();
  const work = registrations.map((registration) => {
    const definition = descriptor(registration);
    if (kinds.has(definition.kind)) throw new TypeError("Duplicate work kind.");
    kinds.add(definition.kind);
    if ((definition.dataSchema && !registration.data) || (definition.inputSchema && !registration.input) || (definition.resultSchema && !registration.result)) {
      throw new TypeError("A work schema requires its application parser.");
    }
    return Object.freeze({ ...definition,
      ...(registration.input ? { input: parser(registration.input) } : {}),
      ...(registration.result ? { result: parser(registration.result) } : {}),
      ...(registration.data ? { data: parser(registration.data) } : {}),
      ...(registration.facts ? { facts: parser(registration.facts) } : {}) });
  }).sort((a, b) => a.kind < b.kind ? -1 : 1);
  const descriptors = Object.freeze(work.map(descriptor));
  if (Buffer.byteLength(JSON.stringify(descriptors)) > 65536 || (declared && !isDeepStrictEqual(descriptors, declared))) {
    throw new TypeError("Work descriptors do not match the bounded code registration.");
  }
  return { work: Object.freeze(work), descriptors };
}

function parse(value: unknown, contract: WorkParser | undefined, limit: number): JsonObject {
  try {
    const captured = captureData(value, limit);
    if (!contract) return captured;
    const result = contract.parse(captured);
    if (result instanceof Promise) {
      void result.catch(() => undefined);
      throw new TypeError("Work parsers must be synchronous.");
    }
    return captureData(result, limit);
  } catch {
    throw new WorkError("invalid", "Work payload does not satisfy the registered contract.");
  }
}

export function resolveWorkKind(type: ResolvedSessionType, kind: string): CapturedWorkKind {
  const registration = type.work?.find((item) => item.kind === kind);
  if (!registration) throw new WorkError("invalid", "Work kind is unavailable.");
  return Object.freeze({ descriptor: descriptor(registration),
    parseInput: (value: unknown) => parse(value, registration.input, 65536),
    parseResult: (value: unknown) => parse(value, registration.result, 262144),
    parseData: (value: unknown) => parse(value, registration.data, 65536),
    ...(registration.facts ? { parseFacts: (value: unknown) => parse(value, registration.facts, 65536) } : {}) });
}
