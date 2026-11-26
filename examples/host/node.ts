/**
 * One Agent Hosting Protocol host process for the multi-host examples.
 *
 * Everything is configured from the environment so the same program serves
 * every topology: a single host, an active-passive replica, a partitioned
 * namespace host, or one member of a distributed namespace.
 *
 * The control listener is example scaffolding for the acceptance driver. It is
 * not part of the SDK and has no authentication: publish it on loopback only.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { join } from "node:path";
import { namespaceSchemaName, type HostCredential, type HostTopologyMode, type NamespacePolicy } from "@host";
import type { PersistenceProvider } from "@persistence";
import { createExamplePersistence } from "../advanced/persistence";
import { createExampleNode } from "./support";

const env = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
};
const required = (name: string): string => env(name) ?? (() => {
  throw new Error(`${name} is required.`);
})();
const integer = (name: string): number | undefined => {
  const value = env(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be an integer.`);
  return parsed;
};

const hostId = required("AHP_HOST_ID");
const mode = (env("AHP_HOST_MODE") ?? "single") as HostTopologyMode;
const namespaceId = required("AHP_NAMESPACE_ID");
const instanceId = env("AHP_INSTANCE_ID") ?? `${hostname()}-${String(process.pid)}`;
const databaseUrl = env("AHP_DATABASE_URL");
const membershipDirectory = env("AHP_MEMBERSHIP_DIR");
const log = (event: string, detail: Record<string, unknown> = {}): void => {
  // Operational facts only: never a credential, a token or request content.
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), hostId, instanceId, event, ...detail })}\n`);
};

let provider: PersistenceProvider;
if (databaseUrl === undefined) {
  provider = createExamplePersistence().provider;
} else {
  const { createPostgresPersistenceProvider } = await import("@persistence/helpers/adapters/postgres");
  // The namespace selects its own schema. The name comes from trusted configuration, never from a request.
  provider = await createPostgresPersistenceProvider({ connectionString: databaseUrl, schema: env("AHP_DATABASE_SCHEMA") ?? namespaceSchemaName(namespaceId),
    maxConnections: integer("AHP_DATABASE_POOL") ?? 5, eventPollMs: integer("AHP_EVENT_POLL_MS") ?? 500 });
}
const storage = provider.durability;
if (storage === undefined) throw new Error("The configured persistence has no durable storage.");

// Each host reads the shared policy and only its own secret, as a secret provider would supply them.
const membership = membershipDirectory === undefined
  ? undefined
  : {
      policy: JSON.parse(readFileSync(join(membershipDirectory, "policy.json"), "utf8")) as NamespacePolicy,
      // A platform that mounts exactly one credential per pod names that file directly.
      credentials: new Map([[hostId, JSON.parse(readFileSync(env("AHP_CREDENTIAL_FILE") ?? join(membershipDirectory, "secrets", `${hostId}.json`), "utf8")) as HostCredential]]),
    };
const routingPort = integer("AHP_ROUTING_PORT");
const node = createExampleNode({
  hostId, mode, namespaceId, instanceId, storage, persistence: provider,
  ...(membership === undefined ? {} : { membership }),
  publicHost: env("AHP_PUBLIC_HOST") ?? "127.0.0.1", publicPort: integer("AHP_PUBLIC_PORT") ?? 0,
  ...(routingPort === undefined
    ? {}
    : { routing: { host: env("AHP_ROUTING_HOST") ?? "127.0.0.1", port: routingPort, endpoint: required("AHP_ROUTING_ENDPOINT"),
        ...(integer("AHP_ROUTE_TIMEOUT_MS") === undefined ? {} : { requestTimeoutMs: integer("AHP_ROUTE_TIMEOUT_MS") }) } }),
  ...(integer("AHP_LEASE_MS") === undefined ? {} : { leaseMs: integer("AHP_LEASE_MS") }),
  ...(integer("AHP_STANDBY_RETRY_MS") === undefined ? {} : { standbyRetryMs: integer("AHP_STANDBY_RETRY_MS") }),
  ...(env("AHP_ADOPTION") === "automatic" ? { adoption: "automatic" as const } : {}),
});
const host = node.host;
host.onHostEvent((delivery) => {
  if (delivery.type === "reset") log("host-events-reset");
  else if (delivery.event.topic !== "work") log("host-event", { topic: delivery.event.topic, kind: delivery.event.kind, origin: delivery.event.originHostId, entity: delivery.event.entityId });
});

let previous = "";
const watch = setInterval(() => {
  const status = host.status();
  const summary = `${status.phase}:${String(status.ready)}:${status.epoch ?? ""}`;
  if (summary === previous) return;
  previous = summary;
  log("status", { ...status });
  if (status.phase === "stopped") {
    // Ownership was lost or the host stopped itself: exit so the supervisor starts a fresh instance.
    clearInterval(watch);
    setTimeout(() => process.exit(stopping ? 0 : 1), 100).unref();
  }
}, 50);

let stopping = false;
const shutdown = (signal: string): void => {
  if (stopping) return;
  stopping = true;
  log("signal", { signal });
  // A rolling replacement drains: unready first, optional handoff, then release. Nothing durable is retired.
  const transferTo = env("AHP_DRAIN_TRANSFER_TO");
  void host.drain(transferTo === undefined ? undefined : { transferTo }).catch(() => undefined).finally(() => {
    control?.close();
    process.exitCode = 0;
  });
};
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});

const controlPort = integer("AHP_CONTROL_PORT");
const control = controlPort === undefined
  ? undefined
  : createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://control");
      const reply = (status: number, body: unknown): void => {
        response.writeHead(status, { "Content-Type": "application/json", "Connection": "close" });
        response.end(JSON.stringify(body));
      };
      const run = async (): Promise<unknown> => {
        if (url.pathname === "/status") {
          return { ...host.status(), sessions: host.sessions.listSessionSnapshots().map((snapshot) => ({ uri: snapshot.resource, title: (snapshot.state as { title?: string }).title })),
            routing: host.routingStats(), members: await host.members().catch(() => []), diagnostics: host.sessions.durability?.inspect() ?? [] };
        }
        if (request.method !== "POST") throw new Error("Unknown control request.");
        if (url.pathname === "/adopt") return { adopted: await host.adoptSessions(url.searchParams.get("from") ?? "") };
        if (url.pathname === "/transfer") {
          await host.transferSession(url.searchParams.get("session") ?? "", url.searchParams.get("to") ?? "");
          return { transferred: true };
        }
        if (url.pathname === "/revoke") return { revision: await host.revokeNamespaceAuthority() };
        throw new Error("Unknown control request.");
      };
      run().then((body) => {
        reply(200, body);
      }, (error: unknown) => {
        // SDK refusals are already generic. Nothing here can carry a credential.
        reply(409, { error: "refused", reason: error instanceof Error ? error.message : "unknown" });
      });
    });
control?.listen(controlPort, env("AHP_CONTROL_HOST") ?? "127.0.0.1");

try {
  const address = await host.start();
  log("listening", { port: address.port, mode, namespaceId });
} catch (error) {
  // Refusals are generic by design: membership and ownership errors never describe a credential.
  log("start-refused", { mode, namespaceId, reason: error instanceof Error ? error.message : "unknown" });
  control?.close();
  clearInterval(watch);
  process.exitCode = 1;
}
