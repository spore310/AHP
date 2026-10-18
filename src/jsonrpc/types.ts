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

export const jsonRpcErrorSchema = z.strictObject({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});
export type JsonRpcError = z.infer<typeof jsonRpcErrorSchema>;

export const jsonRpcRequestSchema = z.strictObject({
  jsonrpc: z.literal(JSONRPC_VERSION),
  method: z.string(),
  params: jsonRpcParamsSchema,
  id: jsonRpcRequestIdSchema,
});
export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;

export const jsonRpcNotificationSchema = z.strictObject({
  jsonrpc: z.literal(JSONRPC_VERSION),
  method: z.string(),
  params: jsonRpcParamsSchema,
});
export type JsonRpcNotification = z.infer<typeof jsonRpcNotificationSchema>;

export const jsonRpcResultResponseSchema = z.strictObject({
  jsonrpc: z.literal(JSONRPC_VERSION),
  // Explicit boolean return type: a type predicate would narrow `result`
  // below `unknown` and break the Microsoft conformance assertions.
  result: z
    .unknown()
    .refine((value): boolean => value !== undefined, "result must not be undefined (it would be dropped by JSON serialization)"),
  id: jsonRpcResponseIdSchema,
});
export type JsonRpcResultResponse = z.infer<typeof jsonRpcResultResponseSchema>;

export const jsonRpcErrorResponseSchema = z.strictObject({
  jsonrpc: z.literal(JSONRPC_VERSION),
  error: jsonRpcErrorSchema,
  id: jsonRpcResponseIdSchema,
});
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
