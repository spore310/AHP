/** Budgets for one plain-JSON capture. Count and depth are separate. */
export interface PlainJsonLimits {
  readonly maxDepth: number;
  readonly maxKeys: number;
  readonly maxBytes: number;
}
