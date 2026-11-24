import { describe, expect, it } from "vitest";
import { workRequestSchemas } from "@work/helpers/protocol/schemas";
import { RepositoryError } from "@persistence";
import { mapWorkError } from "@websocket/helpers/ahp/agentWork";
import { RpcError } from "@jsonrpc";

const workId = "22222222-2222-4222-a222-22222222222a";
const execution = { workId, leaseToken: "33333333-3333-4333-b333-33333333333b", attempt: 1 };
const session = { kind: "session", id: "ahp-session:/review" };
const scope = [{ resource: session, include: true }];
const version = 1;
const commands = {
  submit: { version, requestKey: "request", kind: "review", input: {}, scope },
  claim: { version, session }, renew: { version, ...execution }, complete: { version, ...execution, result: {} },
  fail: { version, ...execution, retryable: false }, cancel: { version, workId }, get: { version, workId },
  updateData: { version, workId, expectedDataRevision: "1", data: {}, execution },
};

describe("V1 work request contracts", () => {
  for (const [method, packet] of Object.entries(commands)) {
    const schema = workRequestSchemas[method as keyof typeof commands];
    it(`accepts the ${method} envelope and rejects other versions and caller-supplied authority`, () => {
      expect(schema.parse(packet)).toEqual(packet);
      for (const extra of [{ version: 2 }, { owner: "me" }, { actor: {} }, { executionEpoch: "8" }, { capacity: 4 }, { principal: "owner" }]) {
        expect(schema.safeParse({ ...packet, ...extra }).success).toBe(false);
      }
    });
  }
  it("rejects missing attempts, mismatched work IDs, malformed results and non-object data", () => {
    for (const method of ["renew", "complete", "fail"] as const) {
      const packet: Partial<typeof commands[typeof method]> = { ...commands[method] };
      delete packet.attempt;
      expect(workRequestSchemas[method].safeParse(packet).success).toBe(false);
    }
    expect(workRequestSchemas.updateData.safeParse({ ...commands.updateData, execution: { ...execution, workId: execution.leaseToken } }).success).toBe(false);
    expect(workRequestSchemas.complete.safeParse({ ...commands.complete, result: 1 }).success).toBe(false);
    expect(workRequestSchemas.updateData.safeParse({ ...commands.updateData, data: [] }).success).toBe(false);
    expect(workRequestSchemas.submit.safeParse({ ...commands.submit, input: null }).success).toBe(false);
    expect(workRequestSchemas.claim.safeParse({ version, session: { ...session, kind: "chat" } }).success).toBe(false);
  });
  it("exposes a bounded reconciliation marker only for an owned uncertain outcome", () => {
    expect.assertions(5);
    try {
      mapWorkError(new RepositoryError("outcome_unknown", "private driver message"));
    } catch (error) {
      expect(error).toBeInstanceOf(RpcError);
      expect(error).toMatchObject({ code: -32603, message: "Internal error", data: { version: 1, kind: "outcome_unknown" } });
      expect(error instanceof RpcError && (error.data as { correlationId: string }).correlationId).toMatch(/^[a-f0-9-]{36}$/);
    }
    const fake = { code: -32603, data: { kind: "outcome_unknown" } };
    expect(() => mapWorkError(fake)).toThrow();
    expect(fake).not.toBeInstanceOf(RpcError);
  });
});
