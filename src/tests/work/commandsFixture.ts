import { randomUUID } from "node:crypto";
import { createMemoryDurableStorage, type DurableHost, type AgentRegistrationRecord } from "@persistence";
import type { StoredWork } from "@persistence/helpers/durability/workTypes";
import { createSessionConfig } from "@sessions";
import type { ResolvedSessionType } from "@sessions/helpers/sessionTypes";
import { createWorkService, type WorkRequestContext, type WorkCommandOptions } from "@work";
import { z } from "zod";
import { createWorkSessionFixture } from "../persistence/conformance/work";

export async function workFixture(options: Partial<WorkCommandOptions> = {}, providedHost?: DurableHost) {
  const rows = new Map<string, StoredWork>();
  const agents = new Map<string, AgentRegistrationRecord>();
  const host = providedHost ?? await createMemoryDurableStorage(rows, agents).acquire("work", () => undefined);
  const { ref, session, root } = await createWorkSessionFixture(host);
  const principal = { domainId: ref.domainId, subject: session.owner };
  const caller: WorkRequestContext = { context: { actor: { kind: "user", principal }, authRevision: "1", connectionId: "reader" },
    isCurrent: () => true, signal: new AbortController().signal };
  const schema = { type: "object" as const, properties: {} };
  const type: ResolvedSessionType = { definition: { ...session.type, providerId: session.providerId, tools: [], configSchema: schema, work: session.type.workManifest },
    config: createSessionConfig({ schema, parser: z.strictObject({}) }), tools: [], enabledForCreation: true, work: [{ kind: "review" }] };
  const service = createWorkService({ repository: () => host.work, resolveType: () => type,
    prepare: () => Promise.resolve({ isCurrent: () => true, release() {} }), ...options });
  const request = { requestKey: "shared", kind: "review", input: { note: "initial" }, data: { progress: 0 },
    scope: [{ resource: { kind: ref.kind, id: ref.id }, include: true }] };
  function lease(id: string) {
    const agent = { principal, actorAgentId: "actor:worker", registrationId: randomUUID(), agentKey: "worker" };
    agents.set(agent.registrationId, { domainId: ref.domainId, id: agent.registrationId, agentKey: agent.agentKey, principalSubject: principal.subject,
      enabled: true, executionEpoch: "2", createdAt: session.createdAt });
    const execution = { workId: id, attempt: 1, leaseToken: randomUUID() };
    const row = rows.get(id);
    if (!row) throw new Error("Missing seeded work.");
    rows.set(id, { ...row, status: "leased", revision: "2", attemptCount: 1, lease: { ...execution,
      registrationId: agent.registrationId, executionEpoch: "2", expiresAt: new Date(Date.now() + 60000).toISOString() } });
    const worker = { ...caller, agent, executionEpoch: "2", context: { ...caller.context, actor: { kind: "agent" as const, principal, agentId: agent.actorAgentId } } };
    return { worker, execution };
  }
  return { rows, agents, host, ref, root, session, type, caller, service, request, lease };
}
