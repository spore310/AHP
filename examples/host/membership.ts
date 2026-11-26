/**
 * Generates example namespace membership: one shared policy and one secret per
 * host. Nothing here is checked in; run it into an ignored directory or a
 * container volume.
 *
 * Usage: vite-node examples/host/membership.ts <directory> <namespaceId> <revision> <hostId[=endpoint][*maxInstances]>...
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createExampleMembership } from "./support";

const [directory, namespaceId, revision, ...members] = process.argv.slice(2);
if (directory === undefined || namespaceId === undefined || revision === undefined || members.length === 0) {
  throw new Error("Usage: membership.ts <directory> <namespaceId> <revision> <hostId[=endpoint][*maxInstances]>...");
}
const hosts = members.map((member) => {
  const [identity = "", maxInstances] = member.split("*");
  const [hostId = "", endpoint] = identity.split("=");
  return { hostId, ...(endpoint === undefined ? {} : { endpoint }), ...(maxInstances === undefined ? {} : { maxInstances: Number(maxInstances) }) };
});
const membership = createExampleMembership(namespaceId, hosts, Number(revision));
mkdirSync(join(directory, "secrets"), { recursive: true });
writeFileSync(join(directory, "policy.json"), JSON.stringify(membership.policy, undefined, 2));
// In a deployment each host receives only its own secret from the platform's secret provider.
for (const [hostId, credential] of membership.credentials) writeFileSync(join(directory, "secrets", `${hostId}.json`), JSON.stringify(credential), { mode: 0o600 });
process.stdout.write(`Wrote membership policy revision ${revision} for ${namespaceId} with ${String(hosts.length)} member(s).\n`);
