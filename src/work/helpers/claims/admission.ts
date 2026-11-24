import type { WorkApproval } from "../commands/types";

/** Only framework composition may issue a callback-free generation/expiry check. */
declare const issued: unique symbol;
export interface WorkSchedulingStamp { readonly [issued]: true }
export type WorkSchedulingAdmission = WorkSchedulingStamp | AbortSignal | { readonly signal: AbortSignal; readonly validUntil: number };
const checks = new WeakMap<WorkSchedulingStamp, (locking: boolean) => boolean>();
const policyFences = new WeakMap<WorkApproval, () => boolean>();

export function createSchedulingStamp(check: (locking: boolean) => boolean): WorkSchedulingStamp {
  const receipt = Object.freeze({}) as WorkSchedulingStamp;
  checks.set(receipt, check);
  return receipt;
}

/** Use the native internal slot so a consumer getter can never run under a row lock. */
export function captureSignal(signal: AbortSignal): () => boolean {
  const current = () => !Reflect.get(AbortSignal.prototype, "aborted", signal);
  current();
  return current;
}

export function issueWorkApproval<T extends WorkApproval>(approval: T, fence: () => boolean): T {
  policyFences.set(approval, fence);
  return approval;
}

export function captureSchedulingStamp(stamp: WorkSchedulingAdmission, approval: WorkApproval): (locking: boolean) => boolean {
  const owned = checks.get(stamp as WorkSchedulingStamp);
  const timed = !owned && "signal" in stamp ? { signal: stamp.signal, validUntil: stamp.validUntil } : undefined;
  if (timed && !Number.isSafeInteger(timed.validUntil)) throw new TypeError("Invalid scheduling approval deadline.");
  const active = owned ?? captureSignal(timed?.signal ?? stamp as AbortSignal);
  const canonical = policyFences.get(approval);
  return (locking) => active(locking) && (!timed || Date.now() < timed.validUntil) && (!canonical || canonical());
}
