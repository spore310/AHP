import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AhpTransport } from "@microsoft/agent-host-protocol/client";
import type { ResourceRef, PolicyActorRef } from "@authorization";
import type { ClientToolRegistration, ClientToolRoute } from "@toolExecution/helpers/client/helpers/broker";
import { connectToolClient, type ToolClient } from "@toolExecution/client";
import { connectToolClient as compatibilityConnect } from "@toolClient";
import { parseUnknownJson } from "@jsonrpc";
import { parseToolWire, toolAssignedReplySchema, toolAdvertiseReplySchema, toolDispatchReplySchema } from "@toolExecution/helpers/client/helpers/protocol";
import { createToolPolicyHost, connectPolicyTransport, toolPolicyChannel as channel } from "./toolPolicyFixture";
import { codingHarnessContracts, createCodingHarness } from "../toolExecution/fixtures";

export { channel, codingHarnessContracts, createCodingHarness };
export const sourceEvidence = Object.freeze({ path: "src/tests/toolExecution/fixtures.ts", export: "createCodingHarness",
  candidate: createHash("sha256").update(readFileSync("src/tests/toolExecution/fixtures.ts")).digest("hex"), revision: 7 });
const user = (subject: string): PolicyActorRef => ({ kind: "user", principal: { domainId: "local", subject } });
const actor = (subject: string): PolicyActorRef => subject.endsWith("-agent")
  ? { kind: "agent", principal: { domainId: "local", subject }, agentId: "verified-" + subject } : user(subject);
const operations = ["discover", "invoke", "advertise", "execute"] as const;
const provider = { id: "p12.workspace-provider", revision: 2 }, chatPolicy = { id: "p12.chat-constraint", revision: 4 };
const workspace: ResourceRef = { domainId: "local", kind: "workspace", id: "workspace:/production", instanceId: "workspace-generation-1" };
const chat: ResourceRef = { domainId: "local", kind: "chat", id: "chat:/triage", instanceId: "triage-generation-1" };

/** Extends the one real host harness; all policy/resource/identity ports below are explicit fixture authority. */
export async function createPolicyIntegrationFixture(options: {
  readonly mode: "self" | "cross";
  readonly host?: Parameters<typeof createToolPolicyHost>[1];
  readonly providerVerdict?: () => Promise<"allow" | "deny">;
} ) {
  const caller = options.mode === "self" ? "senior-agent" : "junior-agent";
  const executor = "senior-agent";
  const subjects = ["senior", "junior", "pm", "senior-agent", "junior-agent", "pm-agent", "observer"];
  const roles = Object.fromEntries(subjects.map((subject) => [subject, subject === "observer" ? ["discover"] as const : [...operations]]));
  const actors = Object.fromEntries(subjects.map((subject) => [subject, { actor: actor(subject),
    ...(subject.endsWith("-agent") ? { agentGeneration: 2, delegationRef: "verified-delegation-" + subject,
      parentSubject: subject.slice(0, -6) } : {}) }]));
  const registrations: readonly ClientToolRegistration[] = codingHarnessContracts.map((definition) => ({ definition,
    revision: 5, source: { id: "p12-source-" + definition.name + "-" + sourceEvidence.candidate, revision: sourceEvidence.revision },
    implementation: { location: "client", suppliedBy: "client", implementation: "client-owned", implementationId: "p12-approved-" + definition.name } }));
  const route = (origin: ResourceRef): ClientToolRoute => ({ route: { origin, targets: [chat, workspace] },
    externalProofs: [{ resource: workspace, revision: "p12-provider-authority-1", validUntil: Date.now() + 60_000 }] });
  const additionalPolicies = [provider, chatPolicy].map((policy) => ({ ...policy, operations: Object.fromEntries(operations.map((operation) => [operation,
    { actor: { mode: "roles" as const, actors: { user: { anyOf: ["inspect"] }, agent: { anyOf: ["inspect"] } } },
      ...(operation === "discover" ? { reveal: true } : {}),
      ...(policy === provider ? { requiredPermissions: ["p12-provider"] } : {}) }])), challenge: { required: false } }));
  const f = await createToolPolicyHost(codingHarnessContracts, { protectedViews: true, roles, actors, registrations,
    toolDiscovery: subjects.filter((subject) => subject !== "observer"), additionalPolicies, route,
    permissionEvaluators: { "p12-provider": () => options.providerVerdict?.() ?? Promise.resolve("allow") },
    assignment: (subject, registration, operation) => {
      if (subject === "observer") return false;
      const key = registration.definition.key;
      if ((subject.startsWith("junior") || subject.startsWith("pm")) && key !== "coding.read" && key !== "coding.summary") return false;
      if (operation === "execute" || operation === "advertise") return subject === executor;
      return true;
    },
    configureResources: (registry, origin, sessionType) => {
      const resolved = route(origin).route;
      registry.installResource({ resource: origin, route: resolved, owner: { domainId: "local", subject: "creator" },
        admission: { sessionType, providerId: "mock" }, externalAuthority: "none" });
      registry.installResource({ resource: chat, route: resolved, owner: { domainId: "local", subject: "chat-owner" },
        grantParent: origin, mandatory: [{ ref: chatPolicy, applicable: true }], externalAuthority: "none" });
      registry.installResource({ resource: workspace, route: resolved, owner: { domainId: "local", subject: "workspace-owner" },
        mandatory: [{ ref: provider, applicable: true }], externalAuthority: "required" });
      for (const subject of subjects) for (const [resource, policy] of [[chat, chatPolicy], [workspace, provider]] as const) {
        registry.installBinding({ id: "p12-" + policy.id + "-" + subject, actor: actor(subject), scope: resource,
          roles: ["inspect"], policies: [policy], revision: 1, authority: { kind: "host-policy", policy } });
      }
    }, ...options.host });
  const address = await f.host.start(), clients: ToolClient[] = [];
  const url = "ws://127.0.0.1:" + String(address.port) + "/capacity";
  const connect = async (subject: string, clientId = "display-" + subject, compatibility = false) => {
    const inner = await connectPolicyTransport(url, subject);
    const received: unknown[] = [], sent: unknown[] = [];
    const waits = new Map<string, ReturnType<typeof Promise.withResolvers<unknown>>>();
    const transport: AhpTransport = {
      send: (message) => {
        sent.push(typeof message === "string" ? parseUnknownJson(message) : message);
        return inner.send(typeof message === "string" ? message : JSON.stringify(message));
      },
      recv: async () => {
        for (;;) {
          const frame = await inner.recv();
          if (frame === null) {
            for (const pending of waits.values()) pending.reject(new Error("Fixture endpoint closed"));
            waits.clear(); return null;
          }
          const parsed: unknown = frame.kind === "text" ? parseUnknownJson(frame.text) : frame.kind === "parsed" ? frame.message : parseUnknownJson(new TextDecoder().decode(frame.data));
          received.push(parsed);
          if (typeof parsed === "object" && parsed !== null && "id" in parsed && typeof parsed.id === "string") {
            const pending = waits.get(parsed.id);
            if (pending !== undefined) { waits.delete(parsed.id); pending.resolve(parsed); continue; }
          }
          return frame;
        }
      }, close: inner.close.bind(inner),
    };
    const client = await (compatibility ? compatibilityConnect : connectToolClient)({ transport, ownership: "owned" }, { clientId, protocolVersions: ["1.0.0"] });
    clients.push(client);
    const request = async (method: string, params: unknown): Promise<unknown> => {
      const id = "p12-test-" + globalThis.crypto.randomUUID(), result = Promise.withResolvers<unknown>();
      waits.set(id, result);
      const timer = setTimeout(() => result.reject(new Error("Fixture request timed out")), 2000);
      try {
        await transport.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
        return await result.promise;
      } finally { clearTimeout(timer); waits.delete(id); }
    };
    const result = (frame: unknown): unknown => {
      if (typeof frame !== "object" || frame === null || !("result" in frame)) throw new Error("Private request denied");
      return frame.result;
    };
    const assigned = async () => parseToolWire(toolAssignedReplySchema, result(await request("x-ahp/tools/assigned", { version: 2, channel })));
    const advertise = async (viewRevision: string, contracts: unknown[]) => parseToolWire(toolAdvertiseReplySchema, result(await request("x-ahp/tools/advertise", { version: 2, channel, viewRevision, contracts })));
    const dispatch = async (contract: unknown, input: unknown) => parseToolWire(toolDispatchReplySchema, result(await request("x-ahp/tools/dispatch", { version: 2, channel, contract, input })));
    await client.client.subscribe(channel);
    const actual = [...f.contexts.values()].find((entry) => entry.context.actor.principal.subject === subject);
    if (actual === undefined) throw new Error("Missing authenticated context");
    return { client, received, sent, request, assigned, advertise, dispatch, actual, transport };
  };
  const stop = async () => { await Promise.all(clients.map((client) => client.shutdown())); await f.host.stop(); };
  return { ...f, connect, stop, caller, executor, route, workspace, chat, provider, chatPolicy, url, actors, sourceEvidence };
}
