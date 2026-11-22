import { toAhpToolDefinition } from "@tools";
import type { TrustedRequestContext } from "@authorization";
import type { AssignmentAuthorization } from "@authorization/helpers/evaluate";

import type { ToolOperation } from "../../types";

export interface AssignmentView {
  matches(stamp: AssignmentAuthorization["stamps"][number], actor: TrustedRequestContext): boolean;
  validateAssignments(authorization: AssignmentAuthorization, actor: TrustedRequestContext): boolean;
  getContract(id: string): { readonly id: string; readonly key: string; readonly version: number; readonly name: string; readonly schemaDialect: "draft-07"; readonly inputSchema: Readonly<Record<string, unknown>> } | undefined;
}

/** Materializes descriptors only after the authorizer has already evaluated every item. */
export const projectAssignedDescriptors = (
  view: AssignmentView,
  authorization: AssignmentAuthorization,
  actor: TrustedRequestContext,
  purpose: ToolOperation,
): { readonly descriptors: ReturnType<typeof toAhpToolDefinition>[] } => {
  if (!view.validateAssignments(authorization, actor)) {
    return { descriptors: [] };
  }
  if (authorization.admitted.some((item) => !item.allowed) || authorization.decisions.some((item) => item.decision.effect === "deny")) {
    return { descriptors: [] };
  }
  const descriptors = [];
  for (const item of authorization.admitted) {
    const visible = item.tuple.operation === purpose
      && (purpose === "execute" ? item.allowed : purpose === "discover" && item.allowed && item.reveal);
    const contract = view.getContract(item.tuple.contract.id);
    if (!visible || contract === undefined
      || contract.id !== item.tuple.contract.id
      || contract.key !== item.tuple.contract.key
      || contract.version !== item.tuple.contract.version) {
      return { descriptors: [] };
    }
    descriptors.push(toAhpToolDefinition(contract));
  }
  return { descriptors };
};
