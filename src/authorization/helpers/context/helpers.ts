import type { PolicyActorRef, ResourceRef, ResourceRoute } from "../../types";

export const sameActor = (left: PolicyActorRef, right: PolicyActorRef): boolean => {
  if (left.kind !== right.kind
    || left.principal.domainId !== right.principal.domainId
    || left.principal.subject !== right.principal.subject) {
    return false;
  }
  if (left.kind === "user" || right.kind === "user") {
    return left.kind === right.kind;
  }
  return left.agentId === right.agentId;
};

export const sameResource = (left: ResourceRef, right: ResourceRef): boolean => (
  left.domainId === right.domainId
  && left.kind === right.kind
  && left.id === right.id
  && left.instanceId === right.instanceId
);

export const sameRoute = (left: ResourceRoute, right: ResourceRoute): boolean => (
  sameResource(left.origin, right.origin)
  && left.targets.length === right.targets.length
  && left.targets.every((target, index) => {
    const other = right.targets[index];
    return other !== undefined && sameResource(target, other);
  })
);
