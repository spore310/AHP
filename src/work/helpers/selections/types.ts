import type { ResourceRef } from "@authorization";

export interface ResourceLocator {
  readonly kind: string;
  readonly id: string;
  readonly instanceId?: string;
}
export interface ResourceSelectionInput {
  readonly resource: ResourceLocator;
  readonly include: boolean;
  readonly includeDescendants?: boolean;
}
export interface WorkResourceSelection {
  readonly resource: ResourceRef;
  readonly include: boolean;
  readonly includeDescendants: boolean;
}
export interface WorkSelectionInput {
  readonly session?: ResourceLocator;
  readonly scope: readonly ResourceSelectionInput[];
  readonly announce?: readonly ResourceSelectionInput[];
}
export interface NormalizedWorkSelections {
  readonly session: ResourceRef<"session">;
  readonly graphRevision: string;
  readonly scope: readonly WorkResourceSelection[];
  readonly announce: readonly WorkResourceSelection[];
}
export interface WorkSelectionGraph {
  normalize(input: WorkSelectionInput, original?: Pick<NormalizedWorkSelections, "scope" | "announce">): NormalizedWorkSelections;
  selected(target: ResourceRef, rules: readonly WorkResourceSelection[], expectedGraphRevision: string): boolean;
  hasActivePositiveScope(rules: readonly WorkResourceSelection[], expectedGraphRevision: string): boolean;
}
export interface WorkSelectionLimits {
  readonly maxSelectors?: number;
  readonly maxDepth?: number;
  readonly maxResources?: number;
}
