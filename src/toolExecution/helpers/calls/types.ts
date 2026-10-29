import type { ToolDispatchHandle } from "@toolExecution/helpers/dispatcher";
import type { ToolStatusReply } from "@toolExecution/helpers/client/helpers/protocol";

export interface PrivateToolCallHandle extends ToolDispatchHandle<unknown> {
  /** True only after full schema/policy admission, before remote completion. */
  readonly admitted: Promise<boolean>;
}
export interface PrivateToolCallLimits {
  readonly maxRecords: number;
  readonly maxOutputBytes: number;
  readonly maxRetainedBytes: number;
  readonly ttlMs: number;
}
export interface PrivateToolCallOptions {
  readonly limits?: Partial<PrivateToolCallLimits>;
  readonly now?: () => number;
}
export interface PrivateToolCallReceipt {
  readonly callId: string;
  readonly admitted: Promise<boolean>;
}
export interface PrivateToolCallRead {
  readonly status: ToolStatusReply;
  /** Samples the clock, expires records, then checks this exact immutable status. */
  current(): boolean;
  /** Callback-free owned-state check; use after current authority callbacks. */
  fence(): boolean;
}
/** Owner is an exact trusted connection lease. These methods do not grant policy authority. */
export interface PrivateToolCalls {
  start(owner: object, start: (callId: string) => PrivateToolCallHandle): PrivateToolCallReceipt | undefined;
  read(callId: string, owner: object): PrivateToolCallRead | undefined;
  cancel(callId: string, owner: object): boolean;
  forget(owner: object): void;
  dispose(): void;
  stats(): { readonly records: number; readonly retainedBytes: number };
}

/** Internal retention ownership; never serialized. */
export interface PrivateToolCallEntry {
  readonly callId: string;
  readonly owner: object;
  readonly expiresAt: number;
  readonly admission: ReturnType<typeof Promise.withResolvers<boolean>>;
  timer?: ReturnType<typeof setTimeout>;
  handle?: PrivateToolCallHandle;
  status: ToolStatusReply;
  bytes: number;
  cancelled: boolean;
  finished: boolean;
  resultSeen: boolean;
}
