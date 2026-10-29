import type { ResourceRef, SecuritySubjectRef } from "../../types";
import { sameResource } from "../context";
import type { RegisteredResource } from "./types";

export const resourceKey = (resource: ResourceRef): string => (
  `${resource.domainId}\u0000${resource.kind}\u0000${resource.id}\u0000${resource.instanceId}`
);

export const sameOwner = (left: SecuritySubjectRef, right: SecuritySubjectRef): boolean => (
  left.domainId === right.domainId && left.subject === right.subject
);

export const findResource = (
  resources: ReadonlyMap<string, RegisteredResource>,
  resource: ResourceRef,
): RegisteredResource | undefined => {
  const found = resources.get(resourceKey(resource));
  return found !== undefined && sameResource(found.resource, resource) ? found : undefined;
};
