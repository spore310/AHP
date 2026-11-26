import type { AddressInfo } from "node:net";
import { JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import { z } from "zod";
import { RpcError, parseUnknownJson } from "@jsonrpc";
import type { HostCoordination } from "@persistence/helpers/durability/types";
import { createWebSocketServer } from "@websocket/helpers/server";
import type { ConnectionSetupAdapter } from "@websocket/helpers/security/types";
import type { JsonRpcHandlers, WebSocketConnectionContext, WebSocketServerOptions } from "@websocket/types";
import { HOST_FORWARDED_HEADER, HOST_FORWARDED_MAX_BYTES, HOST_PROOF_HEADER } from "../../constants";
import { bindDigest, type HostAdmission, type VerifiedHost } from "../admission";

const forwardedSchema = z.strictObject({
  v: z.literal(1), hop: z.literal(1),
  headers: z.record(z.string().max(256), z.union([z.string().max(8_192), z.array(z.string().max(8_192)).max(16)])),
  remoteAddress: z.string().max(128).optional(),
});
const syncSchema = z.strictObject({ version: z.literal(1) });
const attachSchema = z.strictObject({ version: z.literal(1), agentKey: z.string().min(1).max(128), executionEpoch: z.string().regex(/^[1-9][0-9]{0,18}$/u) });
const single = (value: string | string[] | undefined): string | undefined => typeof value === "string" ? value : undefined;

export interface RelayListenerOptions extends Pick<WebSocketServerOptions, "host" | "port" | "path" | "tls" | "transportLimits" | "setupDeadlineMs" | "onConnection" | "beforeDispatch"> {
  readonly admission: HostAdmission;
  readonly coordination: () => HostCoordination | undefined;
  /** The host's own connection setup. It authenticates the original caller from the forwarded handshake. */
  readonly setup: ConnectionSetupAdapter;
  /** The unwrapped method table: a relayed request is always handled here and never forwarded again. */
  readonly handlers: JsonRpcHandlers;
  readonly admitting: () => boolean;
  /** Resolves once everything already committed for that connection has been sent. */
  readonly settle: (connectionId: string) => Promise<void>;
  readonly attachAgent?: (context: WebSocketConnectionContext, agentKey: string, executionEpoch: string) => Promise<void>;
}

/**
 * Internal endpoint on which this host serves connections relayed by other members.
 *
 * Two independent facts are established before a relayed connection exists:
 * the sender is a current member of this namespace holding a valid credential
 * for this exact destination, and the original caller's own credential is
 * accepted by this host's authenticator. Neither replaces the other, and the
 * sender's claim about the caller is never read.
 */
export const createRelayListener = (options: RelayListenerOptions): { start(): Promise<AddressInfo>; stop(): Promise<void>; sender(connectionId: string): VerifiedHost | undefined } => {
  const senders = new Map<string, VerifiedHost>();
  const prepare = options.setup.prepare.bind(options.setup);
  const requireRelay = (context: WebSocketConnectionContext): void => {
    if (!senders.has(context.connectionId)) throw new RpcError(JsonRpcErrorCodes.MethodNotFound, "Method not found");
  };
  const server = createWebSocketServer({
    host: options.host, port: options.port, path: options.path, authentication: "required",
    ...(options.tls === undefined ? {} : { tls: options.tls }),
    transportLimits: options.transportLimits, setupDeadlineMs: options.setupDeadlineMs,
    admission: options.admitting,
    beforeDispatch: options.beforeDispatch,
    connectionSetup: {
      async prepare(input) {
        const proof = single(input.handshake.headers[HOST_PROOF_HEADER]);
        const forwarded = single(input.handshake.headers[HOST_FORWARDED_HEADER]);
        if (proof === undefined || forwarded === undefined || forwarded.length > HOST_FORWARDED_MAX_BYTES) return undefined;
        const sender = options.admission.verify(proof, { purpose: "relay", bind: bindDigest(forwarded), operation: "route" });
        if (sender === undefined) return undefined;
        // A valid signature from a replaced or expired instance is still refused.
        if (await options.coordination()?.isCurrentMember(sender.hostId, sender.instanceId, sender.generation) !== true) return undefined;
        const original = forwardedSchema.parse(parseUnknownJson(Buffer.from(forwarded, "base64url").toString("utf8")));
        const prepared = await prepare({ ...input, handshake: Object.freeze({ headers: Object.freeze(original.headers),
          ...(original.remoteAddress === undefined ? {} : { remoteAddress: original.remoteAddress }) }) });
        if (prepared !== undefined && !input.signal.aborted) {
          senders.set(input.fence.connectionId, sender);
          input.signal.addEventListener("abort", () => {
            senders.delete(input.fence.connectionId);
          }, { once: true });
        }
        return prepared;
      },
    },
    onConnection(context) {
      context.onClose(() => {
        senders.delete(context.connectionId);
      });
      options.onConnection?.(context);
    },
    handlers: {
      ...options.handlers,
      "x-ahp-host/sync": async (params, context) => {
        requireRelay(context);
        syncSchema.parse(params);
        await options.settle(context.connectionId);
        return { version: 1 };
      },
      "x-ahp-host/agents/attach": async (params, context) => {
        requireRelay(context);
        const parsed = attachSchema.parse(params);
        if (options.attachAgent === undefined) throw new RpcError(JsonRpcErrorCodes.MethodNotFound, "Method not found");
        try {
          await options.attachAgent(context, parsed.agentKey, parsed.executionEpoch);
        } catch {
          throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Agent presence unavailable");
        }
        return { version: 1 };
      },
    },
  });
  return { start: () => server.start(), stop: () => server.stop(), sender: (connectionId) => senders.get(connectionId) };
};
