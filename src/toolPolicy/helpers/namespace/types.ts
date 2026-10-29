import type { NamespaceRef } from "@authorization";

import type { ToolExecutionPolicyBase } from "../../types";

/** Detached namespace data. The resolver is not part of this view. */
export interface CapturedNamespaceData {
  readonly name: string;
  readonly revision: number;
  readonly policies: readonly ToolExecutionPolicyBase[];
  readonly includes: readonly NamespaceRef[];
}
