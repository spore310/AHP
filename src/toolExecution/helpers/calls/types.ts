import type { ToolDispatchAdmission, ToolDispatchHandle } from "@toolExecution/helpers/dispatcher";
import type { ToolStatusReply } from "@toolExecution/helpers/client/helpers/protocol";

export interface PrivateToolCallHandle extends ToolDispatchHandle<unknown> {
  /** Structured initial receipt; ready requires actual enqueue, challenge keeps the call waiting. */
  readonly admitted: Promise<ToolDispatchAdmission>;
}
export interface PrivateToolCallLimits {
  readonly maxRecords: number;
  readonly maxOutputBytes: number;
  readonly maxRetainedBytes: number;
  readonly ttlMs: number;
}
export type PrivateToolCallOptions = {
  readonly limits?: Partial<PrivateToolCallLimits>;
} & ({ readonly now?: undefined; readonly fenceNow?: undefined } | {
  readonly now: () => number;
  /** Callback-free read in the same clock domain, for final deadline admission. */
  readonly fenceNow: () => number;
});
export interface PrivateToolCallReceipt {
  readonly callId: string;
  readonly admitted: Promise<ToolDispatchAdmission>;
}
export interface PrivateToolCallRead {
  readonly status: ToolStatusReply;
  /** Trusted adapter metadata may be keyed weakly by this exact handle. Never serialized. */
  readonly handle: PrivateToolCallHandle;
  /** Samples the clock, expires records, then checks this exact immutable status. */
  current(): boolean;
  /** Final deadline and owned-state check; its time reader cannot invoke host callbacks. */
  fence(): boolean;
}
/** Owner is an exact trusted connection lease. These methods do not grant policy authority. */
export interface PrivateToolCalls {
  start(owner: object, start: (callId: string) => PrivateToolCallHandle): PrivateToolCallReceipt | undefined;
  findContinuation(continuationId: string, owner: object): string | undefined;
  resume(callId: string, owner: object, proofRef: string, admission: () => boolean): Promise<boolean>;
  read(callId: string, owner: object): PrivateToolCallRead | undefined;
  cancel(callId: string, owner: object, admission?: () => boolean): boolean;
  forget(owner: object): void;
  dispose(): void;
  stats(): { readonly records: number; readonly retainedBytes: number };
}

/** Internal retention ownership; never serialized. */
export interface PrivateToolCallEntry {
  readonly callId: string;
  readonly owner: object;
  readonly expiresAt: number;
  readonly admission: ReturnType<typeof Promise.withResolvers<ToolDispatchAdmission>>;
  timer?: ReturnType<typeof setTimeout>;
  handle?: PrivateToolCallHandle;
  status: ToolStatusReply;
  bytes: number;
  cancelled: boolean;
  finished: boolean;
  resultSeen: boolean;
  continuationId?: string;
  resuming?: boolean;
}
