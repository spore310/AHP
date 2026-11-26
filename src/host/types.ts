import type { ServerToolBrokerOptions } from "@tool/server";
import type { AddressInfo } from "node:net";

import type { AgentDirectoryRegistrationLimits, ConnectionAuthenticator } from "@agents";
import type { HostEventDelivery, HostMember } from "@persistence/helpers/durability/types";
import type { AgentRegistrationRepository, WorkRepository } from "@persistence/types";
import type { SessionsFactory, SessionsFactoryOptions } from "@sessions/types";
import type { ClientToolBrokerOptions } from "@tool/helpers/execution/helpers/remote";
import type { ResourceViewOptions } from "@sessions/views";
import type { AHPServerSecurityOptions } from "@websocket/helpers/security/types";
import type { WebSocketTransportLimits } from "@websocket/types";
import type { HostAdmissionOptions } from "./helpers/admission";
import type { HostLinkFactory, HostLinkOptions } from "./helpers/routing";

/**
 * Optional durable agent and work-leasing wiring.
 *
 * When present, the host creates the in-memory agent directory and work
 * service; the transport authenticates the upgrade before any AHP frame is
 * dispatched. When absent, the baseline host is unchanged and the extension
 * methods are not registered.
 */
export interface AHPServerAgentWorkOptions {
  readonly chatProjection?: import("@work/helpers/chatProjection/types").WorkChatProjectionOptions;
  readonly configuration?: import("@agents").AgentWorkConfig;
  readonly leaseMs?: number;
  readonly authenticator?: ConnectionAuthenticator;
  readonly ceiling?: import("@authorization").PolicyScopeRules;
  readonly hooks?: import("@work/helpers/authorityLoss/types").WorkServiceHooks;
  readonly hookDeadlineMs?: number;
  readonly maxPendingHooks?: number;
  readonly agentMappings?: readonly { readonly domainId: string; readonly subject: string; readonly actorAgentId: string; readonly agentKey: string }[];
  readonly registrations: AgentRegistrationRepository;
  readonly work: WorkRepository;
  /** Work kinds that may be submitted or claimed. */
  readonly allowedKinds: ReadonlySet<string>;
  /** Presence lifetime; defaults to the agent directory default. */
  readonly presenceTtlMs?: number;
  readonly registrationLimits?: Partial<AgentDirectoryRegistrationLimits>;
  /** Clock used for presence deadlines and work-service validation. */
  readonly now?: () => number;
  /** Releases host-owned resources (for example, a database pool). */
  readonly dispose?: () => Promise<void>;
}

/**
 * How logical hosts share a namespace.
 *
 * - `single`: one host owns the namespace's store. The default.
 * - `replicated`: replicas of one logical host; one is active, the rest wait as healthy standbys.
 * - `partitioned`: this host serves one explicitly allocated namespace with its own store.
 * - `distributed`: several logical hosts are active in one namespace and each session has one owner.
 */
export type HostTopologyMode = "single" | "replicated" | "partitioned" | "distributed";

/** Internal listener and outbound limits for routing requests to a session's owning host. */
export interface HostRoutingOptions {
  /** Network interface and port of the internal listener. Never the public AHP listener. */
  readonly host: string;
  readonly port: number;
  readonly path?: string;
  /** Endpoint other members dial. It must be listed for this host in the membership policy. */
  readonly endpoint: string;
  /** TLS for the internal listener. Required when the policy requires TLS. */
  readonly tls?: import("node:https").ServerOptions;
  /** Trust settings for outbound links, such as the deployment's certificate authority. */
  readonly clientTls?: HostLinkOptions["tls"];
  readonly requestTimeoutMs?: number;
  readonly maxPending?: number;
  readonly maxLinksPerConnection?: number;
  /** Longest wait for another owner to confirm it holds nothing older before the connection is ended. */
  readonly orderTimeoutMs?: number;
  /** Replaceable transport between hosts. Defaults to the WebSocket adapter. */
  readonly connect?: HostLinkFactory;
}

export interface HostTopologyOptions {
  /**
   * Stable logical host name, usually resembling the application, such as
   * `support-app`. Replicas share it. It equals the durable host identity.
   */
  readonly hostId: string;
  /** Short namespace name expanded under this host's name. Mutually exclusive with `namespaceId`. */
  readonly namespace?: string;
  /** Explicit canonical identifier, so different hosts can name one shared namespace. */
  readonly namespaceId?: string;
  /** Identity of this running process. Defaults to a fresh random value. Never a credential. */
  readonly instanceId?: string;
  readonly mode?: HostTopologyMode;
  /** Trusted membership policy and this host's credential. Required outside `single` mode. */
  readonly admission?: Omit<HostAdmissionOptions, "hostId">;
  readonly routing?: HostRoutingOptions;
  /** Membership lease measured by the coordination store's clock. */
  readonly leaseMs?: number;
  readonly standbyRetryMs?: number;
  /** `automatic` takes over the sessions of members whose lease is provably free. Defaults to `manual`. */
  readonly adoption?: "manual" | "automatic";
}

export type HostPhase = "idle" | "starting" | "standby" | "recovering" | "active" | "draining" | "stopped";

export interface HostStatus {
  readonly mode: HostTopologyMode;
  readonly phase: HostPhase;
  /** True only while this instance holds valid ownership, finished recovery and admits public traffic. */
  readonly ready: boolean;
  readonly hostId?: string;
  readonly namespaceId?: string;
  readonly instanceId?: string;
  /** Membership generation of this running instance. */
  readonly generation?: string;
  /** Ownership epoch of the logical host's lease. */
  readonly epoch?: string;
  /** Latest namespace authority revocation this instance has observed and acted on. */
  readonly authorityRevision?: number;
}

export type HostDiagnosticEvent = "hostStandby" | "hostActive" | "hostAuthorityRevoked" | "hostRecoveryFailed" | "hostAdoptionFailed";

/** Options for a composed Agent Hosting Protocol host. */
export interface AHPServerOptions {
  readonly onDiagnostic?: (event: { readonly event: import("@work").WorkDiagnosticEvent | "lateBackendDisposeFailed" | "malformedNotification" | HostDiagnosticEvent;
    readonly correlationId: string; }) => void;
  readonly nativeWrites?: import("@websocket/helpers/ahp/types").NativeSessionWrites;
  readonly protectedViews?: ResourceViewOptions;
  readonly toolExecution?: ClientToolBrokerOptions;
  readonly serverToolExecution?: ServerToolBrokerOptions;
  /** Network interface to bind. Unrelated to the logical host identity in `topology`. */
  readonly host: string;
  readonly port: number;
  readonly path?: string;
  readonly transportLimits?: Partial<WebSocketTransportLimits>;
  /** Session factory options. The host creates and owns the factory. */
  readonly sessions: SessionsFactoryOptions;
  /** Optional authenticated agent identity and durable work leasing. */
  readonly agentWork?: AHPServerAgentWorkOptions;
  /** Trusted connection setup, independent of work storage. Not permission to disclose native views. */
  readonly security?: AHPServerSecurityOptions;
  /**
   * Logical host identity, application namespace and multi-host mode. Omit it
   * for the unchanged single-host default with no membership or coordination.
   */
  readonly topology?: HostTopologyOptions;
}

/**
 * A host that owns its transport, AHP binding, and session factory.
 * `sessions` is not usable to revive the host after `stop()`.
 */
export interface AHPServerHandle {
  /** Private V1 work request methods enabled by this host's current configuration. */
  readonly workMethods: readonly string[];
  readonly workConfiguration?: import("@agents").AgentWorkConfiguration;
  readonly setAgentEnabled?: (agentId: string, enabled: boolean) => Promise<unknown>;
  /** Trusted in-process commands sharing the host's canonical session policy and durable store. */
  readonly work?: import("@work").WorkService;
  /** Restricts an owning resource operation to the current protected connection's exact work lease. */
  readonly prepareResourceWork?: import("@tool/execution").ToolWorkPreparation;
  /** Includes unresolved remote work after bounded shutdown; not a termination guarantee. */
  toolExecutionStats(): { readonly active: number; readonly draining: number; readonly retainedOutputBytes: number };
  /**
   * Resolves with the bound address. In `replicated` mode the listener binds
   * first and the promise resolves while this instance may still be a standby:
   * observe `status()` or the readiness probe for activation.
   */
  start(): Promise<AddressInfo>;
  stop(): Promise<void>;
  readonly sessions: SessionsFactory;
  status(): HostStatus;
  /**
   * Stops admitting traffic, reports unready, optionally hands this host's
   * sessions to another member, then stops. Durable resources are not retired.
   */
  drain(options?: { readonly transferTo?: string }): Promise<void>;
  /** Live members of this host's namespace, from the coordination store. */
  members(): Promise<readonly HostMember[]>;
  /** Moves one session this host owns to another active member that supports its provider. */
  transferSession(sessionUri: string, toHostId: string): Promise<void>;
  /** Takes over the sessions of a member whose lease is provably free, and restores them here. */
  adoptSessions(fromHostId: string): Promise<readonly string[]>;
  /**
   * Durable namespace-wide revocation. Every member closes its connections and
   * re-establishes authority; fenced transactions fail closed until it has.
   */
  revokeNamespaceAuthority(): Promise<number>;
  /** Identifier-only namespace events. A reset means: reconcile from current state. */
  onHostEvent(listener: (delivery: HostEventDelivery) => void): () => void;
  /** Bounded routing resources currently held by this host. */
  routingStats(): { readonly connections: number; readonly links: number; readonly pending: number; readonly held: number };
}
