import { RepositoryError } from "../../types";
import { createWorkSelectionGraph } from "@work/helpers/selections";
import { durableSelectionLimits } from "./workIntent";
import type { CandidateScan, ClaimAdmission, LockedClaim, PreparedClaim, PreparedRenew } from "./workTypes";

export function schedulingConflict(): never {
  throw new RepositoryError("conflict", "Work scheduling state changed.");
}
export function bounded(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
const validKinds = (kinds: readonly string[]) => Array.isArray(kinds) && kinds.length <= 128
  && kinds.every((name) => typeof name === "string" && name.length > 0 && name.length <= 128);
const isArray = (value: unknown): boolean => Array.isArray(value);
export function validateScan(input: CandidateScan) {
  if (!bounded(input.limit, 1, 32) || !validKinds(input.allowedKinds) || (input.after && (!bounded(input.after.priority, -2147483648, 2147483647)
    || !Number.isFinite(Date.parse(input.after.createdAt))))) schedulingConflict();
}
export function validateSchedule(input: PreparedClaim | PreparedRenew) {
  if (!bounded(input.leaseMs, 1000, 300000)) schedulingConflict();
  if ("candidates" in input && (!bounded(input.maxActiveClaims, 0, 1024) || !validKinds(input.allowedKinds)
    || !isArray(input.candidates) || input.candidates.length > 128 || new Set(input.candidates.map((r) => r.id)).size !== input.candidates.length
    || input.candidates.some((r) => !/^[1-9]\d{0,18}$/u.test(r.revision)))) schedulingConflict();
}
export function synchronousAdmission<T>(callback: (input: T) => unknown, input: T): void {
  const value = callback(input);
  if (value !== undefined) {
    void Promise.resolve(value).catch(() => undefined);
    throw new RepositoryError("unauthorized", "Work admission denied.");
  }
}
export function admitSchedule(locked: LockedClaim, admit: ClaimAdmission) {
  if (!createWorkSelectionGraph(locked.session.ref.domainId, locked.session, locked.resources, durableSelectionLimits)
    .hasActivePositiveScope(locked.row.scope, locked.session.graphRevision)) schedulingConflict();
  try {
    synchronousAdmission(admit, structuredClone(locked));
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    throw new RepositoryError("unauthorized", "Work admission denied.");
  }
}
