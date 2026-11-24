import type { ResourceRef, ResourceRegistration } from "@authorization";
import type { DataSnapshot, JsonObject, ReplaceData, ReplaceDataResult } from "@persistence/helpers/durability/types";

export interface RuntimeResourceContext {
  readonly resource: ResourceRef;
  readonly session: ResourceRef<"session">;
  readonly operationId: string;
  readonly recoveryInput: JsonObject;
  readonly runtimeMetadata: JsonObject;
  readonly signal: AbortSignal;
}
export interface RuntimeResourceHandle {
  readonly metadata: JsonObject;
  release(reason: "host-shutdown" | "creation-cancelled" | "resource-retired"): void | Promise<void>;
}
export interface RuntimeResourceDriver {
  readonly key: string;
  readonly version: number;
  readonly kind: string;
  readonly data?: { parse(value: unknown): JsonObject };
  registration?(input: { readonly resource: ResourceRef; readonly session: ResourceRef<"session">; readonly parent: ResourceRef; readonly grantParent?: ResourceRef }):
  Pick<ResourceRegistration, "route" | "allowedRoutes" | "mandatory" | "externalAuthority">;
  captureRecoveryInput(value: unknown): JsonObject;
  ensure(context: RuntimeResourceContext): Promise<RuntimeResourceHandle>;
  restore(context: RuntimeResourceContext): Promise<RuntimeResourceHandle>;
  destroy(context: RuntimeResourceContext): Promise<void>;
}
export interface SessionResourceLifecycle {
  create(input: {
    readonly kind: string;
    readonly id: string;
    readonly parent: ResourceRef;
    readonly grantParent?: ResourceRef;
    readonly driver: { readonly key: string; readonly version: number };
    readonly recoveryInput?: JsonObject;
    readonly data?: JsonObject;
  }): Promise<ResourceRef>;
  readData(resource: ResourceRef): Promise<DataSnapshot>;
  replaceData(resource: ResourceRef, change: ReplaceData): Promise<ReplaceDataResult>;
  retire(resource: ResourceRef): Promise<void>;
}
