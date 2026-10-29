import type { PolicyRef, ResourceRef, ResourceRoute, SecuritySubjectRef } from "../../types";

/** Trusted registration input; installation identity is issued separately. */
export interface ResourceRegistration {
  readonly resource: ResourceRef;
  readonly owner: SecuritySubjectRef;
  readonly route: ResourceRoute;
  readonly mandatory?: readonly RegisteredMandatory[];
  readonly externalAuthority: "none" | "required";
  readonly admission?: { readonly sessionType: { readonly key: string; readonly version: number }; readonly providerId: string };
  readonly grantParent?: ResourceRef;
}

/** Trusted host registration. Applicability is not a caller-supplied policy boolean. */
export interface RegisteredMandatory {
  readonly ref: PolicyRef;
  readonly applicable: boolean;
}

export interface RegisteredResource {
  readonly resource: ResourceRef;
  readonly owner: SecuritySubjectRef;
  readonly route: ResourceRoute;
  readonly mandatory: readonly RegisteredMandatory[];
  readonly externalAuthority: "none" | "required";
  readonly relationshipRevision: number;
  readonly grantParent?: ResourceRef;
}
