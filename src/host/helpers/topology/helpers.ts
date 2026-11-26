import { randomUUID } from "node:crypto";
import type { HostClaim } from "@persistence/helpers/durability/types";
import { HOST_DEFAULT_LEASE_MS, HOST_DEFAULT_ORDER_TIMEOUT_MS, HOST_DEFAULT_ROUTE_MAX_LINKS, HOST_DEFAULT_ROUTE_MAX_PENDING, HOST_DEFAULT_ROUTE_TIMEOUT_MS, HOST_DEFAULT_STANDBY_RETRY_MS } from "../../constants";
import type { AHPServerOptions, HostRoutingOptions, HostTopologyMode } from "../../types";
import { createHostAdmission, type HostAdmission } from "../admission";
import { resolveNamespaceId } from "../namespace";

export interface CapturedTopology {
  readonly mode: HostTopologyMode;
  readonly hostId: string;
  readonly namespaceId: string;
  readonly instanceId: string;
  /** Several logical hosts own disjoint sessions in one store. */
  readonly shared: boolean;
  /** A replica that cannot take the lease stays alive and unready instead of failing. */
  readonly standby: boolean;
  readonly adoption: "manual" | "automatic";
  readonly admission?: HostAdmission;
  readonly routing?: Required<Pick<HostRoutingOptions, "requestTimeoutMs" | "maxPending" | "maxLinksPerConnection" | "orderTimeoutMs">> & HostRoutingOptions;
  claim(runtime: Pick<HostClaim, "onAuthorityRevoked"> & { readonly signal: AbortSignal; onStandby(): void }): HostClaim;
}

const invalid = (message: string): never => {
  throw new TypeError(`Invalid host topology: ${message}`);
};
const bounded = (value: number | undefined, fallback: number, min: number, max: number, name: string): number => {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) invalid(`${name} is out of range.`);
  return resolved;
};

/**
 * Captures and validates the host topology once, before any listener, session
 * or storage exists. Every combination that could serve traffic unsafely is
 * rejected here rather than discovered after the host is reachable.
 */
export const captureHostTopology = (options: AHPServerOptions): CapturedTopology | undefined => {
  const input = options.topology;
  if (input === undefined) return undefined;
  const mode: HostTopologyMode = input.mode ?? "single";
  if (!["single", "replicated", "partitioned", "distributed"].includes(mode)) invalid("unknown mode.");
  const hostId = input.hostId;
  if (typeof hostId !== "string" || !hostId.trim() || Buffer.byteLength(hostId) > 512) invalid("a stable host name is required.");
  const durability = options.sessions.durability;
  // The friendly host name is the existing durable host identity, never a second one.
  if (durability !== undefined && durability.hostId !== hostId) invalid("the host name must equal the durable host identity.");
  const namespaceId = resolveNamespaceId({ hostId, ...(input.namespace === undefined ? {} : { namespace: input.namespace }),
    ...(input.namespaceId === undefined ? {} : { namespaceId: input.namespaceId }) });
  const instanceId = input.instanceId ?? randomUUID();
  if (typeof instanceId !== "string" || !instanceId.trim() || Buffer.byteLength(instanceId) > 512) invalid("the runtime instance identifier is invalid.");
  const shared = mode === "distributed";
  const standby = mode === "replicated";
  if (mode !== "single") {
    if (durability === undefined) invalid(`${mode} mode requires durable storage.`);
    if (input.admission === undefined) invalid(`${mode} mode requires host admission credentials.`);
  }
  if (mode === "partitioned" && input.namespace === undefined && input.namespaceId === undefined) invalid("partitioned mode requires an explicit namespace.");
  if (mode !== "distributed" && input.routing !== undefined) invalid("internal routing belongs to distributed mode.");
  if (mode === "distributed" && (input.routing === undefined || options.security === undefined || options.sessions.creationSecurity === undefined)) {
    invalid("distributed mode requires internal routing and protected connection setup.");
  }
  const adoption: unknown = input.adoption;
  if (adoption !== undefined && adoption !== "manual" && adoption !== "automatic") invalid("unknown adoption policy.");
  if (input.adoption === "automatic" && !shared) invalid("adoption belongs to distributed mode.");
  const admission = input.admission === undefined
    ? undefined
    : createHostAdmission({ hostId, policy: input.admission.policy, credential: input.admission.credential,
        ...(input.admission.requireTls === undefined ? {} : { requireTls: input.admission.requireTls }),
        ...(input.admission.configuration === undefined ? {} : { configuration: input.admission.configuration }),
        ...(input.admission.now === undefined ? {} : { now: input.admission.now }) });
  if (admission !== undefined && admission.namespaceId !== namespaceId) invalid("the membership policy names another namespace.");
  if (admission !== undefined && !admission.allows(hostId, "serve")) invalid("the membership policy does not permit this host to serve sessions.");
  const routing = input.routing;
  if (routing !== undefined && admission !== undefined && !admission.endpointAllowed(hostId, routing.endpoint)) invalid("the advertised endpoint is not listed for this host in the membership policy.");
  if (routing !== undefined && input.admission?.requireTls === true && routing.tls === undefined) invalid("TLS is required for the internal listener.");
  const leaseMs = bounded(input.leaseMs, HOST_DEFAULT_LEASE_MS, 1_000, 300_000, "leaseMs");
  const retryMs = bounded(input.standbyRetryMs, HOST_DEFAULT_STANDBY_RETRY_MS, 10, 60_000, "standbyRetryMs");
  const providers = options.sessions.providers.map((provider) => provider.providerId);
  return Object.freeze<CapturedTopology>({
    mode, hostId, namespaceId, instanceId, shared, standby, adoption: input.adoption ?? "manual",
    ...(admission === undefined ? {} : { admission }),
    ...(routing === undefined
      ? {}
      : { routing: Object.freeze({ ...routing,
          requestTimeoutMs: bounded(routing.requestTimeoutMs, HOST_DEFAULT_ROUTE_TIMEOUT_MS, 100, 300_000, "requestTimeoutMs"),
          maxPending: bounded(routing.maxPending, HOST_DEFAULT_ROUTE_MAX_PENDING, 1, 4_096, "maxPending"),
          maxLinksPerConnection: bounded(routing.maxLinksPerConnection, HOST_DEFAULT_ROUTE_MAX_LINKS, 1, 64, "maxLinksPerConnection"),
          orderTimeoutMs: bounded(routing.orderTimeoutMs, HOST_DEFAULT_ORDER_TIMEOUT_MS, 50, 60_000, "orderTimeoutMs") }) }),
    claim: (runtime) => ({
      namespaceId, instanceId, shared, leaseMs,
      // Declared application configuration is part of the digest, so one revision can never mean two configurations.
      policy: admission === undefined ? { revision: 0, digest: "" } : admission.policy,
      ...(admission === undefined ? {} : { credentialId: admission.credentialId() }),
      ...(admission?.maxInstances === undefined ? {} : { maxInstances: admission.maxInstances }),
      ...(routing === undefined ? {} : { endpoint: routing.endpoint }),
      capabilities: { providers },
      ...(standby ? { standby: { signal: runtime.signal, retryMs, onStandby: runtime.onStandby.bind(runtime) } } : {}),
      ...(runtime.onAuthorityRevoked === undefined ? {} : { onAuthorityRevoked: runtime.onAuthorityRevoked }),
    }),
  });
};
