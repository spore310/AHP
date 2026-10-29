import { z } from "zod";
import { resourceRefSchema, identifierSchema } from "@authorization/helpers/validation";
import { toolExecutionBindingSchema } from "@toolPolicy/helpers/validation";
import { challengePresentationSchema } from "@toolExecution/types";

const version = z.literal(2);
const channel = z.string().min(1).max(2048);
const revision = z.uuid();
const json = z.unknown().refine((value): boolean => value !== undefined);
const positive = z.int().positive().max(2_147_483_647);
export const toolContractSelectorSchema = z.strictObject({ id: z.uuid(), key: identifierSchema, version: positive });
const connection = z.strictObject({ id: identifierSchema, generation: positive });
const execution = z.strictObject({ binding: toolExecutionBindingSchema, registrationRevision: positive,
  source: z.strictObject({ id: identifierSchema, revision: positive }) });
const annotations = z.strictObject({ title: z.string().optional(), readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(), idempotentHint: z.boolean().optional(), openWorldHint: z.boolean().optional() });
const descriptor = z.strictObject({ name: z.string().min(1).max(256), title: z.string().optional(), description: z.string().optional(),
  inputSchema: z.record(z.string(), json), outputSchema: z.record(z.string(), json).optional(),
  annotations: annotations.optional(), _meta: z.record(z.string(), json) });
export const assignedToolSchema = z.strictObject({ contract: toolContractSelectorSchema, descriptor,
  purposes: z.array(z.enum(["discover", "invoke", "advertise", "execute"])).min(1).max(4),
  conditions: z.array(z.never()).max(0), execution: execution.optional() });
const view = { version, channel, resource: resourceRefSchema, connection, viewRevision: revision };

export const toolCapabilitiesRequestSchema = z.strictObject({ version });
export const toolCapabilitiesReplySchema = z.strictObject({ version, assignments: z.literal(true),
  dispatch: z.literal(true), continuation: z.literal(false) });
export const toolAssignedRequestSchema = z.strictObject({ version, channel });
export const toolAssignedReplySchema = z.strictObject({ ...view, tools: z.array(assignedToolSchema).max(128) });
export const toolAdvertiseRequestSchema = z.strictObject({ version, channel, viewRevision: revision,
  contracts: z.array(toolContractSelectorSchema).max(128) });
export const toolAdvertiseReplySchema = z.strictObject({ ...view, advertisementId: revision,
  tools: z.array(assignedToolSchema).max(128) });
export const toolDispatchRequestSchema = z.strictObject({ version, channel, contract: toolContractSelectorSchema, input: json });
export const toolCallSelectorSchema = z.strictObject({ version, callId: z.uuid() });
export const toolResumeRequestSchema = z.strictObject({ version, continuationId: revision, proofRef: identifierSchema });
export const toolDispatchReplySchema = z.discriminatedUnion("status", [
  z.strictObject({ version, status: z.literal("accepted"), callId: z.uuid() }),
  z.strictObject({ version, status: z.literal("challenge-required"), callId: z.uuid(), continuationId: revision,
    expiresAt: z.iso.datetime(), presentation: challengePresentationSchema }),
  z.strictObject({ version, status: z.literal("denied"), code: z.enum(["unavailable", "unsupported"]) }),
]);
export const toolStatusReplySchema = z.discriminatedUnion("status", [
  z.strictObject({ version, status: z.enum(["waiting", "running", "draining", "failed", "cancelled"]), callId: z.uuid() }),
  z.strictObject({ version, status: z.literal("completed"), callId: z.uuid(), output: json }),
  z.strictObject({ version, status: z.literal("unavailable") }),
]);
export const toolAssignmentsChangedSchema = z.strictObject({ version, channel, viewRevision: revision });
const correlation = { version, callId: z.uuid(), channel, contract: toolContractSelectorSchema,
  route: z.strictObject({ origin: resourceRefSchema, targets: z.array(resourceRefSchema).max(64) }),
  execution, connection, advertisementId: revision };
export const toolInvokeSchema = z.strictObject({ ...correlation, input: json });
/** Host-to-executor cooperative cancellation; distinct from the caller request selector. */
export const toolExecutorCancelSchema = z.strictObject(correlation);
export const toolCompleteSchema = z.union([
  z.strictObject({ ...correlation, output: json }),
  z.strictObject({ ...correlation, error: z.literal("execution-failed") }),
]);

export type AssignedTool = z.infer<typeof assignedToolSchema>;
export type ToolAssignedReply = z.infer<typeof toolAssignedReplySchema>;
export type ToolAdvertiseReply = z.infer<typeof toolAdvertiseReplySchema>;
export type ToolDispatchReply = z.infer<typeof toolDispatchReplySchema>;
export type ToolStatusReply = z.infer<typeof toolStatusReplySchema>;
export type ToolInvoke = z.infer<typeof toolInvokeSchema>;
export type ToolExecutorCancel = z.infer<typeof toolExecutorCancelSchema>;
export type ToolComplete = z.infer<typeof toolCompleteSchema>;

/** A known call remains resumable by explicit status; this error never resubmits it. */
export class ToolPendingError extends Error {
  constructor(readonly callId: string) {
    super("Tool call is still pending.");
    this.name = "ToolPendingError";
  }
}
export class ToolChallengeRequiredError extends Error {
  constructor(readonly reply: Extract<ToolDispatchReply, { status: "challenge-required" }>) {
    super("Tool call requires a challenge.");
    this.name = "ToolChallengeRequiredError";
  }
}
