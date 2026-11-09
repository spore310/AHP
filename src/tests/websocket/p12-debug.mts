import { createPolicyIntegrationFixture, createCodingHarness, channel } from "./policyIntegrationFixture";

const item = await createPolicyIntegrationFixture({ mode: "cross" });
const executor = await item.connect(item.executor);
const caller = await item.connect(item.caller);
const harness = createCodingHarness(), chosen = harness[0];
if (chosen === undefined) throw new Error("missing");
await executor.client.joinSession(channel, [chosen]);
const selector = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
console.log("positive:", await caller.client.callTool(channel, selector, { path: "ok" }));
console.log("removing chat binding for", item.caller, item.registry.removeBinding({ bindingId: "p12-p12.chat-constraint-" + item.caller, scope: item.chat, revision: 1 }));
await new Promise((resolve) => setTimeout(resolve, 400));
const ping = await caller.client.client.ping().then(() => ["ping ok"] as const, (error: unknown) => ["ping rejected", String(error)] as const);
console.log("after removal, no dispatch:", ping);
await item.stop();
