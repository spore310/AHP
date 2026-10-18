import type {
  JsonRpcErrorResponse as AhpJsonRpcErrorResponse,
  JsonRpcNotification as AhpJsonRpcNotification,
  JsonRpcRequest as AhpJsonRpcRequest,
  JsonRpcSuccessResponse as AhpJsonRpcSuccessResponse,
} from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";

import {
  jsonRpcErrorResponseSchema,
  jsonRpcMessageSchema,
  jsonRpcNotificationSchema,
  jsonRpcRequestSchema,
  jsonRpcResultResponseSchema,
} from "@jsonrpc";

// Wire fixtures are typed with the Microsoft protocol package and validated
// with our schemas. The fixture types and the schema types must stay linked
// at compile time (see `JsonRpcMicrosoftConformance` in
// `src/jsonrpc/types.ts`), and the fixture values must stay accepted at
// runtime (the assertions below).

const ahpRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    clientId: "client-1",
    protocolVersions: ["1.0.0"],
  },
} satisfies AhpJsonRpcRequest;

const ahpNotification = {
  jsonrpc: "2.0",
  method: "unsubscribe",
  params: {
    channel: "ahp-root://",
  },
} satisfies AhpJsonRpcNotification;

const ahpResultResponse = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    protocolVersion: "1.0.0",
  },
} satisfies AhpJsonRpcSuccessResponse;

const ahpErrorResponse = {
  jsonrpc: "2.0",
  id: 1,
  error: {
    code: -32601,
    message: "Method not found",
  },
} satisfies AhpJsonRpcErrorResponse;

describe("Microsoft Agent Host Protocol wire conformance", () => {
  it("accepts requests produced by the Microsoft client", () => {
    expect(jsonRpcRequestSchema.safeParse(ahpRequest).success).toBe(true);
  });

  it("accepts notifications produced by the Microsoft client", () => {
    expect(jsonRpcNotificationSchema.safeParse(ahpNotification).success).toBe(true);
  });

  it("accepts both client message shapes through the message union", () => {
    expect(jsonRpcMessageSchema.safeParse(ahpRequest).success).toBe(true);
    expect(jsonRpcMessageSchema.safeParse(ahpNotification).success).toBe(true);
  });

  it("accepts success responses", () => {
    expect(jsonRpcResultResponseSchema.safeParse(ahpResultResponse).success).toBe(true);
  });

  it("accepts error responses", () => {
    expect(jsonRpcErrorResponseSchema.safeParse(ahpErrorResponse).success).toBe(true);
  });
});

describe("JSON-RPC strict parsing", () => {
  it("accepts string request ids", () => {
    expect(
      jsonRpcRequestSchema.safeParse({ jsonrpc: "2.0", method: "m", id: "abc-1" }).success,
    ).toBe(true);
  });

  it("rejects fractional request ids", () => {
    expect(
      jsonRpcRequestSchema.safeParse({ jsonrpc: "2.0", method: "m", id: 1.5 }).success,
    ).toBe(false);
  });

  it("rejects null request ids", () => {
    expect(
      jsonRpcRequestSchema.safeParse({ jsonrpc: "2.0", method: "m", id: null }).success,
    ).toBe(false);
  });

  it("rejects a success response whose result is explicitly undefined", () => {
    expect(
      jsonRpcResultResponseSchema.safeParse({ jsonrpc: "2.0", id: 1, result: undefined }).success,
    ).toBe(false);
  });

  it("accepts a null result", () => {
    expect(
      jsonRpcResultResponseSchema.safeParse({ jsonrpc: "2.0", id: 1, result: null }).success,
    ).toBe(true);
  });

  it("tolerates an unknown additive member and discards it", () => {
    const parsed = jsonRpcRequestSchema.safeParse({
      jsonrpc: "2.0",
      method: "m",
      id: 1,
      extra: true,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error("expected the request to parse");
    }
    expect(Object.hasOwn(parsed.data, "extra")).toBe(false);
  });

  it("rejects params: null", () => {
    expect(
      jsonRpcRequestSchema.safeParse({ jsonrpc: "2.0", method: "m", id: 1, params: null }).success,
    ).toBe(false);
  });

  it("rejects batch arrays", () => {
    expect(jsonRpcMessageSchema.safeParse([{ jsonrpc: "2.0", method: "m" }]).success).toBe(false);
  });

  it("accepts responses through the message union", () => {
    expect(jsonRpcMessageSchema.safeParse(ahpResultResponse).success).toBe(true);
    expect(jsonRpcMessageSchema.safeParse(ahpErrorResponse).success).toBe(true);
  });
});

describe("JSON-RPC message classification", () => {
  it("keeps a request a request when an additive member is present", () => {
    const parsed = jsonRpcMessageSchema.safeParse({
      jsonrpc: "2.0",
      id: 7,
      method: "m",
      extension: { trace: "abc" },
    });
    if (!parsed.success) {
      throw new Error("expected the request to parse");
    }
    expect("method" in parsed.data).toBe(true);
    expect("id" in parsed.data).toBe(true);
  });

  it("rejects a wrongly typed known member", () => {
    expect(
      jsonRpcMessageSchema.safeParse({ jsonrpc: "2.0", id: 1, method: "m", params: 5 }).success,
    ).toBe(false);
  });

  it("rejects a response carrying both result and error", () => {
    expect(
      jsonRpcMessageSchema.safeParse({
        jsonrpc: "2.0",
        id: 1,
        result: 1,
        error: { code: -32603, message: "Internal error" },
      }).success,
    ).toBe(false);
  });

  it("rejects a message mixing request and response members", () => {
    expect(
      jsonRpcMessageSchema.safeParse({ jsonrpc: "2.0", id: 1, method: "m", result: 1 }).success,
    ).toBe(false);
  });

  it("rejects an unknown protocol version", () => {
    expect(
      jsonRpcMessageSchema.safeParse({ jsonrpc: "1.0", id: 1, method: "m" }).success,
    ).toBe(false);
  });
});
