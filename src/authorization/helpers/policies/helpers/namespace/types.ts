import type { NamespaceRef } from "@authorization";

import type { PolicyDefinitionBase } from "../../types";

/** Detached namespace data. The resolver is not part of this view. */
export interface CapturedNamespaceData {
  readonly name: string;
  readonly revision: number;
  readonly policies: readonly PolicyDefinitionBase[];
  readonly includes: readonly NamespaceRef[];
}
