import { sameResource } from "@authorization/helpers/context";
import { captureToolValue } from "../action/helpers";
import type { ToolProjectionOptions, ToolProjectionRequest, ToolResultProjection } from "./types";

/** Trusted mapping of validated output to one separately authorized owning-service action. */
export function createToolResultProjection(options: ToolProjectionOptions): ToolResultProjection {
  const project = options.project.bind(options);
  const resources = options.resources;
  return Object.freeze({
    async project(output, context, current, admission) {
      const aborted = () => context.signal.aborted;
      try {
        if (aborted() || !current()) return false;
        const raw = await project(output, context);
        if (aborted() || !current()) return false;
        if (raw === undefined) return true;
        const value = captureToolValue(raw, { maxBytes: 1024 * 1024, maxDepth: 64, maxKeys: 65536 }).value;
        if (typeof value !== "object" || value === null) return false;
        const request = value as ToolProjectionRequest;
        if (Object.keys(request).some((key) => !["target", "operation", "payload"].includes(key))
          || ![context.resources.origin, ...context.resources.targets].some((ref) => sameResource(ref, request.target))) return false;
        const operation = resources.authorize({ actor: context.caller, route: context.resources, target: request.target,
          operation: request.operation, payload: request.payload, signal: context.signal });
        let ticket;
        try {
          ticket = await operation.ticket;
          if (ticket === undefined) return false;
          if (aborted() || !current()) return false;
          return resources.commit(ticket, admission);
        } finally {
          if (ticket !== undefined) resources.cancel(ticket);
          await operation.settled;
        }
      } catch {
        return false;
      }
    },
  } satisfies ToolResultProjection);
}
