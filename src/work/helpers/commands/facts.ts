import type { WorkIntent } from "@persistence/helpers/durability/workTypes";

/** A trusted application can inspect the command but cannot modify its prepared authority facts. */
export function immutableFacts<T extends WorkIntent>(value: T): T {
  const copy = structuredClone(value);
  const visit = (entry: unknown) => {
    if (!entry || typeof entry !== "object" || Object.isFrozen(entry)) return;
    Object.freeze(entry);
    for (const child of Object.values(entry)) visit(child);
  };
  visit(copy);
  return copy;
}
