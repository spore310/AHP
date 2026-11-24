import { z } from "zod";
import { resourceRefSchema, type ResourceRef } from "@authorization";
import { sameResource } from "@authorization/helpers/context";
import { resourceKey } from "@authorization/helpers/resources";
import { captureValue } from "@jsonrpc/helpers/value/helpers";
import { captureRef } from "@persistence/helpers/durability/helpers";
import type { ResourceRecord, StoredSession } from "@persistence/helpers/durability/types";
import { WorkError } from "../errors";
import type { ResourceLocator, ResourceSelectionInput, WorkResourceSelection, WorkSelectionGraph, WorkSelectionInput, WorkSelectionLimits } from "./types";

const locator = resourceRefSchema.omit({ domainId: true }).partial({ instanceId: true });
const selection = z.strictObject({ resource: locator, include: z.boolean(), includeDescendants: z.boolean().optional() });
const submitted = z.strictObject({ session: locator.optional(), scope: z.array(selection).min(1).max(128), announce: z.array(selection).max(128).optional() });
const invalid = (): never => {
  throw new WorkError("invalid", "Invalid work resource selection.");
};
const locatorKey = (ref: ResourceLocator): string => JSON.stringify([ref.kind, ref.id]);

function budget(value: number | undefined, fallback: number, maximum: number): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) throw new TypeError("Invalid work selection limit.");
  return limit;
}

/** Detach the public wire intent before performing the first repository lookup. */
export function captureWorkSelectionInput(input: WorkSelectionInput, limits: WorkSelectionLimits = {}): WorkSelectionInput {
  const limit = budget(limits.maxSelectors, 64, 128);
  try {
    const copy = captureValue(input, { maxBytes: 1024 * 1024, maxDepth: 8, maxKeys: 4096, postgres: true }).value;
    const parsed = submitted.safeParse(copy);
    if (!parsed.success || parsed.data.scope.length > limit || (parsed.data.announce?.length ?? 0) > limit
      || !parsed.data.scope.some((item) => item.include) || (parsed.data.session && parsed.data.session.kind !== "session")) return invalid();
    // captureValue returns deeply frozen JSON; parsing above validated the same fields.
    return copy as WorkSelectionInput;
  } catch { return invalid(); }
}

interface GraphNode {
  readonly ref: ResourceRef;
  readonly parent?: string;
  readonly grantParent?: string;
  readonly active: boolean;
}

/** Immutable snapshot of the authoritative containment graph and exact lifecycle facts. */
export function createWorkSelectionGraph(domainId: string, session: StoredSession, resources: readonly ResourceRecord[],
  limits: WorkSelectionLimits = {}): WorkSelectionGraph {
  const maxSelectors = budget(limits.maxSelectors, 64, 128);
  const depthLimit = budget(limits.maxDepth, 32, 64);
  const countLimit = budget(limits.maxResources, 256, 4096);
  const revision = session.graphRevision;
  if (session.ref.domainId !== domainId || session.lifecycle !== "active"
    || !/^[1-9][0-9]{0,18}$/u.test(revision) || BigInt(revision) > 9223372036854775807n || resources.length > countLimit) return invalid();
  const root = captureRef(session.ref);
  const rootKey = resourceKey(root);
  const nodes = new Map<string, GraphNode>();
  const current = new Map<string, GraphNode>();
  for (const row of resources) {
    if (!sameResource(row.session, root) || row.ref.domainId !== domainId || row.providerId !== session.providerId || row.owner !== session.owner) return invalid();
    const ref = captureRef(row.ref);
    const key = resourceKey(ref);
    if (nodes.has(key)) return invalid();
    if (key === rootKey ? ref.kind !== "session" || row.parent || row.grantParent || row.lifecycle !== "active" : ref.kind === "session" || !row.parent) return invalid();
    const node = { ref, parent: row.parent && resourceKey(captureRef(row.parent)), grantParent: row.grantParent && resourceKey(captureRef(row.grantParent)),
      active: row.lifecycle === "active" };
    nodes.set(key, node);
    if (row.lifecycle !== "retired") {
      const identity = locatorKey(ref);
      if (current.has(identity)) return invalid();
      current.set(identity, node);
    }
  }
  if (!nodes.has(rootKey)) return invalid();
  const availability = new Map<string, { active: boolean; height: number }>();
  const visiting = new Set<string>();
  function inspect(key: string): { active: boolean; height: number } {
    const previous = availability.get(key);
    if (previous) return previous;
    const node = nodes.get(key);
    if (!node || visiting.has(key) || visiting.size > depthLimit) return invalid();
    visiting.add(key);
    let height = 0;
    let active = node.active;
    for (const parent of [node.parent, node.grantParent]) {
      if (!parent) continue;
      const dependency = inspect(parent);
      height = Math.max(height, dependency.height + 1);
      active = active && dependency.active;
    }
    visiting.delete(key);
    if (height > depthLimit) return invalid();
    const facts = { active, height };
    availability.set(key, facts);
    return facts;
  }
  for (const key of nodes.keys()) inspect(key);
  const available = (key: string) => availability.get(key)?.active === true;
  function resolve(ref: ResourceLocator, original?: ReadonlyMap<string, ResourceRef>): ResourceRef {
    const node = current.get(locatorKey(ref));
    if (node && available(resourceKey(node.ref)) && (ref.instanceId === undefined || ref.instanceId === node.ref.instanceId)) return node.ref;
    const pinned = original?.get(locatorKey(ref));
    if (pinned && (ref.instanceId === undefined ? !node || sameResource(pinned, node.ref) : ref.instanceId === pinned.instanceId)) {
      const historical = nodes.get(resourceKey(pinned));
      if (historical) return historical.ref;
    }
    return invalid();
  }
  function normalize(entries: readonly ResourceSelectionInput[], prior?: readonly WorkResourceSelection[]): readonly WorkResourceSelection[] {
    const unique = new Map<string, WorkResourceSelection>();
    const original = prior && new Map(prior.map((item) => [locatorKey(item.resource), item.resource]));
    for (const input of entries) {
      const resource = resolve(input.resource, original);
      const key = resourceKey(resource);
      const includeDescendants = input.includeDescendants ?? false;
      const previous = unique.get(key);
      if (previous && (previous.include !== input.include || previous.includeDescendants !== includeDescendants)) return invalid();
      unique.set(key, Object.freeze({ resource, include: input.include, includeDescendants }));
    }
    return Object.freeze([...unique.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([, value]) => value));
  }
  function index(rules: readonly WorkResourceSelection[]): Map<string, WorkResourceSelection> | undefined {
    if (rules.length > maxSelectors) return undefined;
    const indexed = new Map<string, WorkResourceSelection>();
    for (const rule of rules) {
      if (rule.resource.domainId !== domainId || typeof rule.include !== "boolean" || typeof rule.includeDescendants !== "boolean") return undefined;
      const key = resourceKey(rule.resource);
      const previous = indexed.get(key);
      if (previous && (previous.include !== rule.include || previous.includeDescendants !== rule.includeDescendants)) return undefined;
      indexed.set(key, rule);
    }
    return indexed;
  }
  return {
    normalize(input, original) {
      const captured = captureWorkSelectionInput(input, { maxSelectors });
      if (captured.session && !sameResource(resolve(captured.session), root)) return invalid();
      return Object.freeze({ session: root, graphRevision: revision, scope: normalize(captured.scope, original?.scope), announce: normalize(captured.announce ?? [], original?.announce) });
    },
    selected(target, rules, expectedGraphRevision) {
      const key = resourceKey(target);
      if (expectedGraphRevision !== revision || !available(key)) return false;
      const indexed = index(rules);
      if (!indexed) return false;
      let cursor: string | undefined = key;
      while (cursor !== undefined) {
        const match = indexed.get(cursor);
        if (match && (cursor === key || match.includeDescendants)) return match.include;
        cursor = nodes.get(cursor)?.parent;
      }
      return false;
    },
    hasActivePositiveScope(rules, expectedGraphRevision) {
      if (expectedGraphRevision !== revision) return false;
      const indexed = index(rules);
      if (!indexed) return false;
      const positive = [...indexed].filter(([, item]) => item.include);
      return positive.length > 0 && positive.every(([key]) => available(key));
    },
  };
}
