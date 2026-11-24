import { z } from "zod";
import { identifierSchema } from "@authorization";
import { captureValue } from "@jsonrpc/value";
import type { AgentWorkConfig, AgentWorkConfiguration } from "../../types";

const limit = z.number().int().min(0).max(1024);
const settings = z.strictObject({
  defaultMaxActiveClaims: limit.default(3),
  identities: z.array(z.strictObject({
    identity: z.strictObject({ domainId: identifierSchema, subject: identifierSchema, agentKey: identifierSchema, actorAgentId: identifierSchema.optional() }),
    maxActiveClaims: limit.optional(),
    allowedKinds: z.array(identifierSchema).max(128).optional(),
  })).max(4096).default([]),
});
const key = (domainId: string, subject: string, agentKey: string) => JSON.stringify([domainId, subject, agentKey]);

function capture(input: AgentWorkConfig) {
  const parsed = settings.parse(captureValue(input, { maxBytes: 2 * 1024 * 1024, maxKeys: 65536, maxDepth: 8, postgres: true }).value);
  const identities = new Map<string, { actorAgentId?: string; maxActiveClaims: number; allowedKinds?: readonly string[] }>();
  for (const { identity, allowedKinds, maxActiveClaims } of parsed.identities) {
    const locator = key(identity.domainId, identity.subject, identity.agentKey);
    if (identities.has(locator) || (allowedKinds && new Set(allowedKinds).size !== allowedKinds.length)) {
      throw new TypeError("Duplicate work configuration entry.");
    }
    identities.set(locator, { ...(identity.actorAgentId === undefined ? {} : { actorAgentId: identity.actorAgentId }),
      maxActiveClaims: maxActiveClaims ?? parsed.defaultMaxActiveClaims, ...(allowedKinds && { allowedKinds: Object.freeze(allowedKinds) }) });
  }
  return { defaultLimit: parsed.defaultMaxActiveClaims, identities };
}

/** Captures trusted limits and publishes changes only after complete validation. */
export function createAgentWorkConfig(input: AgentWorkConfig = {}, changed?: () => void): AgentWorkConfiguration {
  let current = capture(input);
  let revision = 1n;
  return Object.freeze<AgentWorkConfiguration>({
    resolve(agent) {
      const entry = current.identities.get(key(agent.principal.domainId, agent.principal.subject, agent.agentKey));
      const override = entry?.actorAgentId === undefined || entry.actorAgentId === agent.actorAgentId ? entry : undefined;
      return Object.freeze({ revision: revision.toString(), maxActiveClaims: override?.maxActiveClaims ?? current.defaultLimit,
        ...(override?.allowedKinds && { allowedKinds: override.allowedKinds }) });
    },
    replace(next) {
      current = capture(next);
      revision += 1n;
      changed?.();
    },
  });
}
