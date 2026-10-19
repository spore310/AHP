import type {
  JsonRpcErrorResponse as AhpJsonRpcErrorResponse,
  JsonRpcNotification as AhpJsonRpcNotification,
  JsonRpcRequest as AhpJsonRpcRequest,
  JsonRpcResponse as AhpJsonRpcResponse,
  JsonRpcSuccessResponse as AhpJsonRpcSuccessResponse,
} from "@microsoft/agent-host-protocol";
import { z } from "zod";

import { JSONRPC_VERSION } from "./constants";

export const jsonRpcParamsSchema = z
  .union([
    z.record(z.string(), z.unknown()),
    z.array(z.unknown()),
  ])
  .optional();
export type JsonRpcParams = z.infer<typeof jsonRpcParamsSchema>;

// JSON-RPC 2.0 request ids are strings or integral numbers. Fractional
// numbers are discouraged by the specification and rejected here.
export const jsonRpcRequestIdSchema = z.union([z.string(), z.int()]);
export type JsonRpcRequestId = z.infer<typeof jsonRpcRequestIdSchema>;

export const jsonRpcResponseIdSchema = jsonRpcRequestIdSchema.nullable();
export type JsonRpcResponseId = z.infer<typeof jsonRpcResponseIdSchema>;

// Known members are validated strictly; unknown additive members are discarded
// so a compatible protocol extension does not invalidate an otherwise valid
// error object. Security-sensitive known members stay typed.
export const jsonRpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});
export type JsonRpcError = z.infer<typeof jsonRpcErrorSchema>;

// A message's kind is decided by its members before any member is validated.
// Discriminating on shape first is required: validating a request against a
// stripping notification schema would remove its `id` and misclassify it as a
// notification. Shaping also preserves request/response and result/error
// exclusivity while still tolerating unknown additive members.
const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const shapedMessage = <TSchema extends z.ZodType>(
  isShape: (value: Record<string, unknown>) => boolean,
  shapeName: string,
  schema: TSchema,
): z.ZodType<z.output<TSchema>> =>
  z
    .custom<unknown>((value): boolean => isJsonObject(value) && isShape(value), {
      message: `Not a JSON-RPC ${shapeName}`,
    })
    .pipe(schema);

const hasMethod = (value: Record<string, unknown>): boolean => "method" in value;
const hasId = (value: Record<string, unknown>): boolean => "id" in value;
const hasResult = (value: Record<string, unknown>): boolean => "result" in value;
const hasError = (value: Record<string, unknown>): boolean => "error" in value;

export const jsonRpcRequestSchema = shapedMessage(
  (value): boolean => hasMethod(value) && hasId(value) && !hasResult(value) && !hasError(value),
  "request",
  z.object({
    jsonrpc: z.literal(JSONRPC_VERSION),
    method: z.string(),
    params: jsonRpcParamsSchema,
    id: jsonRpcRequestIdSchema,
  }),
);
export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;

export const jsonRpcNotificationSchema = shapedMessage(
  (value): boolean => hasMethod(value) && !hasId(value) && !hasResult(value) && !hasError(value),
  "notification",
  z.object({
    jsonrpc: z.literal(JSONRPC_VERSION),
    method: z.string(),
    params: jsonRpcParamsSchema,
  }),
);
export type JsonRpcNotification = z.infer<typeof jsonRpcNotificationSchema>;

export const jsonRpcResultResponseSchema = shapedMessage(
  (value): boolean => !hasMethod(value) && hasId(value) && hasResult(value) && !hasError(value),
  "success response",
  z.object({
    jsonrpc: z.literal(JSONRPC_VERSION),
    // Explicit boolean return type: a type predicate would narrow `result`
    // below `unknown` and break the Microsoft conformance assertions.
    result: z
      .unknown()
      .refine((value): boolean => value !== undefined, "result must not be undefined (it would be dropped by JSON serialization)"),
    id: jsonRpcResponseIdSchema,
  }),
);
export type JsonRpcResultResponse = z.infer<typeof jsonRpcResultResponseSchema>;

export const jsonRpcErrorResponseSchema = shapedMessage(
  (value): boolean => !hasMethod(value) && hasId(value) && !hasResult(value) && hasError(value),
  "error response",
  z.object({
    jsonrpc: z.literal(JSONRPC_VERSION),
    error: jsonRpcErrorSchema,
    id: jsonRpcResponseIdSchema,
  }),
);
export type JsonRpcErrorResponse = z.infer<typeof jsonRpcErrorResponseSchema>;

export const jsonRpcResponseSchema = z.union([
  jsonRpcResultResponseSchema,
  jsonRpcErrorResponseSchema,
]);
export type JsonRpcResponse = z.infer<typeof jsonRpcResponseSchema>;

// Any single JSON-RPC 2.0 message: request, notification, or response.
// JSON-RPC batch arrays are not supported.
export const jsonRpcMessageSchema = z.union([
  jsonRpcNotificationSchema,
  jsonRpcRequestSchema,
  jsonRpcResultResponseSchema,
  jsonRpcErrorResponseSchema,
]);
export type JsonRpcMessage = z.infer<typeof jsonRpcMessageSchema>;

/**
 * Compile-time conformance with the `@microsoft/agent-host-protocol` wire
 * types (pinned in `package.json`), which are the declared source of truth
 * for messages on the wire.
 *
 * Each assertion fails type checking when a Microsoft message member stops
 * fitting the corresponding schema type, including a Microsoft-side member
 * addition the schemas do not model. The reverse direction is covered by the
 * fixtures in `src/tests/jsonrpc.test.ts`: they are typed with these same
 * Microsoft types and fail at runtime if the schemas stop accepting
 * Microsoft-shaped messages. Because the Microsoft types declare `params`,
 * `result`, and `error.data` as `unknown`, only those fixtures pin the
 * accepted value shapes for those members.
 *
 * Internal verification surface; not exported from `index.ts`.
 */
type AhpAssignableTo<TAhpValue, TSchemaValue> = [TAhpValue] extends [TSchemaValue] ? true : false;
type AhpLinked<TCheck extends true> = TCheck;

export type JsonRpcMicrosoftConformance = [
  // request
  AhpLinked<AhpAssignableTo<keyof AhpJsonRpcRequest, keyof JsonRpcRequest>>,
  AhpLinked<AhpAssignableTo<AhpJsonRpcRequest["jsonrpc"], JsonRpcRequest["jsonrpc"]>>,
  AhpLinked<AhpAssignableTo<AhpJsonRpcRequest["method"], JsonRpcRequest["method"]>>,
  AhpLinked<AhpAssignableTo<AhpJsonRpcRequest["id"], JsonRpcRequestId>>,
  // notification
  AhpLinked<AhpAssignableTo<keyof AhpJsonRpcNotification, keyof JsonRpcNotification>>,
  AhpLinked<AhpAssignableTo<AhpJsonRpcNotification["jsonrpc"], JsonRpcNotification["jsonrpc"]>>,
  AhpLinked<AhpAssignableTo<AhpJsonRpcNotification["method"], JsonRpcNotification["method"]>>,
  // success response
  AhpLinked<AhpAssignableTo<keyof AhpJsonRpcSuccessResponse, keyof JsonRpcResultResponse>>,
  AhpLinked<AhpAssignableTo<AhpJsonRpcSuccessResponse["jsonrpc"], JsonRpcResultResponse["jsonrpc"]>>,
  AhpLinked<AhpAssignableTo<AhpJsonRpcSuccessResponse["id"], JsonRpcResponseId>>,
  AhpLinked<AhpAssignableTo<AhpJsonRpcSuccessResponse["result"], JsonRpcResultResponse["result"]>>,
  // error response
  AhpLinked<AhpAssignableTo<keyof AhpJsonRpcErrorResponse, keyof JsonRpcErrorResponse>>,
  AhpLinked<AhpAssignableTo<AhpJsonRpcErrorResponse["jsonrpc"], JsonRpcErrorResponse["jsonrpc"]>>,
  AhpLinked<AhpAssignableTo<AhpJsonRpcErrorResponse["id"], JsonRpcResponseId>>,
  AhpLinked<AhpAssignableTo<AhpJsonRpcErrorResponse["error"]["code"], JsonRpcError["code"]>>,
  AhpLinked<AhpAssignableTo<AhpJsonRpcErrorResponse["error"]["message"], JsonRpcError["message"]>>,
  AhpLinked<AhpAssignableTo<AhpJsonRpcErrorResponse["error"]["data"], JsonRpcError["data"]>>,
  // whole Microsoft response union (flags variants the response types cannot accept)
  AhpLinked<AhpAssignableTo<AhpJsonRpcResponse, JsonRpcResponse>>,
];
