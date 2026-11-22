export interface ToolValueLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxKeys: number;
}

export interface CapturedToolValue {
  readonly value: unknown;
  readonly bytes: number;
}
