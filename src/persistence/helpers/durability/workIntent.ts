import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { policyActorRefSchema } from "@authorization";
import { resourceKey } from "@authorization/helpers/resources";
import type { WorkResourceSelection } from "@work/helpers/selections/types";
import { isPortableText } from "../text";
import { captureData, captureRef } from "./helpers";
import type { WorkIntent } from "./workTypes";

const text = (max: number) => z.string().min(1).max(max).refine((v) => v.trim().length > 0 && isPortableText(v));
const fields = z.object({ kind: text(128), requestKey: text(256), priority: z.int32(), maxAttempts: z.int().min(1).max(100),
  targetAgentId: z.uuid().toLowerCase().nullable(), submitter: policyActorRefSchema });

/** Durable validation also covers work accepted by hosts with a raised selector budget. */
export const durableSelectionLimits = Object.freeze({ maxSelectors: 128 });

function rules(input: readonly WorkResourceSelection[]): readonly WorkResourceSelection[] {
  if (input.length > durableSelectionLimits.maxSelectors) throw new TypeError("Invalid work selection count.");
  const unique = new Map<string, WorkResourceSelection>();
  for (const rule of input) {
    const { include, includeDescendants } = rule;
    if (typeof include !== "boolean" || typeof includeDescendants !== "boolean") throw new TypeError("Invalid work selection.");
    const resource = captureRef(rule.resource);
    const key = resourceKey(resource);
    const existing = unique.get(key);
    if (existing && (existing.include !== include || existing.includeDescendants !== includeDescendants)) throw new TypeError("Conflicting work selection.");
    unique.set(key, { resource, include, includeDescendants });
  }
  return [...unique.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([, rule]) => rule);
}

export function captureWorkIntent(command: WorkIntent): WorkIntent {
  const scalar = fields.parse(command);
  return { ...scalar, priority: scalar.priority === 0 ? 0 : scalar.priority, session: captureRef(command.session), input: captureData(command.input),
    submittedData: captureData(command.submittedData), scope: rules(command.scope), announce: rules(command.announce) };
}

export function sameWorkIntent(original: WorkIntent, requested: WorkIntent): boolean {
  const fields = Object.keys(requested) as (keyof WorkIntent)[];
  return fields.every((key) => key === "maxAttempts" || isDeepStrictEqual(original[key], requested[key]));
}
