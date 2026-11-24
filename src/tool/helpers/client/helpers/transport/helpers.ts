import type { Client } from "@client";
import { canonicalJsonEqual } from "@tool/helpers/protocol/helpers/descriptors";
import type { LocalToolImplementation } from "../../types";
import { parseToolWire, toolCorrelation, toolInvokeSchema, toolCompleteSchema, toolExecutorCancelSchema, toolAssignmentsChangedSchema } from "@tool/protocol";
import type { ToolInvoke, ToolAssignedReply, ToolAdvertiseReply, ToolExecutorCancel } from "@tool/protocol";
import type { ActiveToolRegistration, StagedToolRegistration } from "./types";

export class ToolEndpoint {
  private assignmentEpoch: object = {};
  private readonly implementations = new Map<string, ActiveToolRegistration>();
  private readonly staged = new Map<string, { readonly channel: string; readonly registration: StagedToolRegistration }>();
  private readonly queued: ToolInvoke[] = [];
  private readonly seen = new Set<string>();
  private readonly active = new Map<string, { readonly invoke: ToolInvoke; readonly controller: AbortController }>();

  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private readonly detach: (() => void)[] = [];
  private get closed(): boolean { return this.signal.aborted; }

  constructor(private readonly connection: Pick<Client, "rpc" | "lifetime" | "shutdown">) {
    const { rpc, lifetime } = connection;
    try {
      this.detach.push(lifetime.addCleanup(() => {
        this.close();
      }));
      this.detach.push(rpc.onNotification("x-ahp/tools/invoke", (params) => {
        this.receiveInvoke(parseToolWire(toolInvokeSchema, params));
      }));
      this.detach.push(rpc.onNotification("x-ahp/tools/cancel", (params) => {
        const cancel = parseToolWire(toolExecutorCancelSchema, params);
        const active = this.active.get(cancel.callId);
        if (active !== undefined && sameCorrelation(active.invoke, cancel)) active.controller.abort();
        for (let index = this.queued.length - 1; index >= 0; index--) {
          const queued = this.queued[index];
          if (queued && sameCorrelation(queued, cancel)) {
            this.queued.splice(index, 1);
            void this.complete(queued, { error: "execution-failed" });
          }
        }
      }));
      this.detach.push(rpc.onNotification("x-ahp/tools/assignmentsChanged", (params) => {
        const change = parseToolWire(toolAssignmentsChangedSchema, params);
        this.assignmentEpoch = {};
        this.implementations.delete(change.channel);
        for (const [token, entry] of this.staged) if (entry.channel === change.channel) this.discard(change.channel, token);
      }));
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close(): void {
    this.controller.abort();
    for (const cleanup of this.detach.splice(0)) cleanup();
    this.implementations.clear();
    this.staged.clear();
    this.queued.length = 0;
    this.seen.clear();
    for (const entry of this.active.values()) entry.controller.abort();
  }

  captureAssignmentFence(): () => boolean {
    const epoch = this.assignmentEpoch;
    return () => !this.closed && this.assignmentEpoch === epoch;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Tool endpoint closed.");
  }

  stage(channel: string, token: string, tools: readonly LocalToolImplementation[], view: ToolAssignedReply): void {
    this.assertOpen();
    const retainedChannels = new Set([...this.implementations.keys(), ...[...this.staged.values()].map((entry) => entry.channel)]);
    if (view.channel !== channel || this.staged.size >= 64 || this.staged.has(token)
      || (!retainedChannels.has(channel) && retainedChannels.size >= 128)) throw new Error("Tool registration unavailable.");
    this.staged.set(token, { channel, registration: { view, implementations: new Map(tools.map((tool) => [identity(tool.definition), tool])) } });
  }

  activate(channel: string, token: string, acknowledgement: ToolAdvertiseReply): void {
    this.assertOpen();
    const entry = this.staged.get(token);
    if (entry === undefined || entry.channel !== channel) throw new Error("Tool registration staging was lost.");
    if (!this.implementations.has(channel) && this.implementations.size >= 128) throw new Error("Tool registration unavailable.");
    const view = entry.registration.view;
    if (acknowledgement.channel !== channel || acknowledgement.viewRevision !== view.viewRevision
      || !canonicalJsonEqual(acknowledgement.resource, view.resource) || !canonicalJsonEqual(acknowledgement.connection, view.connection)
      || acknowledgement.tools.length !== view.tools.length
      || !acknowledgement.tools.every((tool, index) => sameTool(tool, view.tools[index]))) throw new Error("Server acknowledged a different tool advertisement.");
    this.implementations.set(channel, { ...entry.registration, acknowledgement });
    this.staged.delete(token);
    this.flush(channel);
  }

  discard(channel: string, token: string): void {
    if (this.staged.get(token)?.channel === channel) this.staged.delete(token);
    this.flush(channel);
  }

  private matches(invoke: ToolInvoke, registration: StagedToolRegistration): boolean {
    const tool = registration.view.tools.find((entry) => identity(entry.contract) === identity(invoke.contract));
    return tool !== undefined && tool.execution !== undefined && tool.purposes.includes("execute") && tool.purposes.includes("advertise")
      && canonicalJsonEqual(tool.execution, invoke.execution) && canonicalJsonEqual(registration.view.resource, invoke.route.origin)
      && canonicalJsonEqual(registration.view.connection, invoke.connection) && registration.implementations.has(identity(invoke.contract));
  }

  private receiveInvoke(invoke: ToolInvoke): void {
    if (this.seen.has(invoke.callId)) return;
    const active = this.implementations.get(invoke.channel);
    const matching = active !== undefined && active.acknowledgement.advertisementId === invoke.advertisementId && this.matches(invoke, active);
    const staging = [...this.staged.values()].some((entry) => entry.channel === invoke.channel && this.matches(invoke, entry.registration));
    if (!matching && !staging) return;
    // Never evict replay tombstones and re-execute an old call on this endpoint.
    if (this.seen.size >= 4096) {
      void this.connection.shutdown().catch(() => undefined);
      return;
    }
    this.seen.add(invoke.callId);
    if (matching) void this.execute(invoke);
    else if (this.queued.length < 64) this.queued.push(invoke);
    else void this.complete(invoke, { error: "execution-failed" });
  }

  private flush(channel: string): void {
    for (let index = this.queued.length - 1; index >= 0; index -= 1) {
      const invoke = this.queued[index];
      if (invoke === undefined || invoke.channel !== channel) continue;
      const active = this.implementations.get(channel);
      if (active !== undefined && active.acknowledgement.advertisementId === invoke.advertisementId && this.matches(invoke, active)) {
        this.queued.splice(index, 1);
        void this.execute(invoke);
      } else if (![...this.staged.values()].some((entry) => entry.channel === channel && this.matches(invoke, entry.registration))) {
        this.queued.splice(index, 1);
        void this.complete(invoke, { error: "execution-failed" });
      }
    }
  }

  private async execute(invoke: ToolInvoke): Promise<void> {
    if (this.closed) return;
    const registration = this.implementations.get(invoke.channel);
    const implementation = registration?.implementations.get(identity(invoke.contract));
    if (registration === undefined || implementation === undefined || registration.acknowledgement.advertisementId !== invoke.advertisementId
      || !this.matches(invoke, registration) || this.active.size >= 64) {
      await this.complete(invoke, { error: "execution-failed" });
      return;
    }
    const controller = new AbortController();
    this.active.set(invoke.callId, { invoke, controller });
    try {
      const output: unknown = await implementation.execute(invoke.input, { ...invoke, key: invoke.contract.key,
        version: invoke.contract.version, signal: controller.signal });
      await this.complete(invoke, { output });
    } catch {
      await this.complete(invoke, { error: "execution-failed" });
    } finally {
      this.active.delete(invoke.callId);
    }
  }

  private async complete(invoke: ToolInvoke, outcome: { readonly output: unknown } | { readonly error: "execution-failed" }): Promise<void> {
    if (this.closed) return;
    const correlation = toolCorrelation(invoke);
    try {
      let completion;
      try {
        completion = parseToolWire(toolCompleteSchema, { ...correlation, ...outcome });
      } catch {
        completion = parseToolWire(toolCompleteSchema, { ...correlation, error: "execution-failed" });
      }
      await this.connection.rpc.notify("x-ahp/tools/complete", completion, { signal: this.signal });
    } catch { /* A disconnected executor cannot complete its outstanding call. */ }
  }
}
export const identity = (ref: { readonly id: string; readonly key: string; readonly version: number }): string => `${ref.id}\u0000${ref.key}\u0000${String(ref.version)}`;
export function sameTool(left: unknown, right: unknown): boolean {
  if (!isRecord(left) || !isRecord(right)) return false;
  const entries = Object.entries(left);
  return Object.keys(right).length === entries.length && entries.every(([key, value]) => key === "descriptor"
    ? sameTool(value, right[key])
    : canonicalJsonEqual(value, right[key]));
}
function sameCorrelation(invoke: ToolInvoke, cancel: ToolExecutorCancel): boolean {
  return (["version", "callId", "channel", "contract", "route", "execution", "connection", "advertisementId"] as const)
    .every((key) => canonicalJsonEqual(invoke[key], cancel[key]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
