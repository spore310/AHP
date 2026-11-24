import type { WorkAgentContext, WorkApproval, WorkRequestContext, WorkService } from "@work";
import { WorkError } from "@work";
import { workRequestSchemas } from "@work/helpers/protocol/schemas";
import type { JsonRpcHandler, JsonRpcInvocation, WebSocketConnectionContext } from "../../types";
import { workConnection } from "./workContext";

export interface ProtectedWorkMutations {
  readonly service: WorkService;
  worker(connection: WebSocketConnectionContext): Promise<WorkAgentContext>;
}
function unavailable(): never {
  throw new WorkError("unauthorized", "Work operation unavailable.");
}
async function guarded<C extends WorkRequestContext, T>(caller: C, invocation: JsonRpcInvocation,
  action: (context: C) => Promise<T>, requiresReceipt: (result: T) => boolean = () => true) {
  const guard = invocation.guardReply?.bind(invocation);
  if (!guard || invocation.kind !== "request" || !caller.isCurrent()) return unavailable();
  let receipt: WorkApproval | undefined;
  const retainReply = (approval: WorkApproval) => {
    if (receipt) return unavailable();
    invocation.onReplySettled(() => {
      approval.release();
    });
    receipt = approval;
  };
  const result = await action({ ...caller, retainReply });
  const required = requiresReceipt(result);
  const current = () => caller.isCurrent() && !caller.signal.aborted && (!required || receipt?.isCurrent() === true);
  if (!current()) return unavailable();
  guard(current);
  return result;
}

export function createWorkMutationHandlers(binding: ProtectedWorkMutations, mapError: (error: unknown) => never): Record<string, JsonRpcHandler> {
  const { service } = binding;
  const actions: Record<string, JsonRpcHandler> = {
    submit(params, connection, invocation) {
      const { version, ...command } = workRequestSchemas.submit.parse(params);
      return guarded(workConnection(connection), invocation, async (caller) => ({ version, workId: (await service.submit(caller, command)).id }));
    },
    async claim(params, connection, invocation) {
      const { version, session } = workRequestSchemas.claim.parse(params);
      return guarded(await binding.worker(connection), invocation, async (caller) => ({ version, ...await service.claim(caller, session) }),
        (reply) => reply.status === "claimed");
    },
    async renew(params, connection, invocation) {
      const { version, ...execution } = workRequestSchemas.renew.parse(params);
      return guarded(await binding.worker(connection), invocation, async (caller) => ({ version, ...await service.renew(caller, execution) }));
    },
    async complete(params, connection, invocation) {
      const { workId, attempt, leaseToken, data, result } = workRequestSchemas.complete.parse(params);
      return guarded(await binding.worker(connection), invocation, async (caller) => {
        await service.complete(caller, { workId, attempt, leaseToken }, { result, ...(data && { data }) });
        return null;
      });
    },
    async fail(params, connection, invocation) {
      const { version, workId, attempt, leaseToken, data, code, message, retryable } = workRequestSchemas.fail.parse(params);
      return guarded(await binding.worker(connection), invocation, async (caller) => ({
        version, ...await service.fail(caller, { workId, attempt, leaseToken }, { retryable,
          ...(code !== undefined && { code }), ...(message !== undefined && { message }), ...(data && { data }) }),
      }));
    },
    cancel(params, connection, invocation) {
      const { workId } = workRequestSchemas.cancel.parse(params);
      return guarded(workConnection(connection), invocation, async (caller) => {
        await service.cancel(caller, workId);
        return null;
      });
    },
    async updateData(params, connection, invocation) {
      const { version, workId, execution, data, expectedDataRevision } = workRequestSchemas.updateData.parse(params);
      const caller = connection.security?.context.actor.kind === "agent" || execution ? await binding.worker(connection) : workConnection(connection);
      return guarded(caller, invocation, async (context) => ({ version, ...await service.updateData(context, workId, { data, expectedDataRevision }, execution) }));
    },
  };
  return Object.fromEntries(Object.entries(actions).map(([name, handler]) => [`x-ahp/work/${name}`, async (...args: Parameters<JsonRpcHandler>) => {
    try {
      // Reject notifications before invoking a worker resolver or touching storage.
      if (args[2].kind !== "request" || !args[2].guardReply) return unavailable();
      return await handler(...args);
    } catch (error) { return mapError(error); }
  }]));
}
