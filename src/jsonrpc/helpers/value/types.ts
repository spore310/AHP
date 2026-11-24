export interface ValueLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxKeys: number;
  readonly postgres?: boolean;
}
export interface CapturedValue { readonly value: unknown; readonly bytes: number }
