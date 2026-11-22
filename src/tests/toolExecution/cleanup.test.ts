import { afterEach, expect, it, vi } from "vitest";
import { ToolAction } from "@toolExecution";
import type { ToolActionContext, ToolPreparationHooks } from "@toolExecution";
import { createToolDispatcher } from "@toolExecution/helpers/dispatcher";
import type { ToolDispatchHandle } from "@toolExecution/helpers/dispatcher";
import { EchoAction, ports, registration } from "./fixtures";
import type { Input, Output } from "./fixtures";

afterEach(() => {
  vi.useRealTimers();
});

it.each(["prepare", "execute", "output", "cleanup"])("attempts action-first LIFO cleanup once after %s failure and sanitizes diagnostics", async (broken) => {
  const order: string[] = [];
  class Action extends ToolAction<Input, Output, { handle: string }> {
    override prepare(_input: Input, _context: ToolActionContext, hooks: ToolPreparationHooks): { handle: string } {
      hooks.onCleanup(() => {
        order.push("first");
      });
      hooks.onCleanup(() => {
        order.push("second");
        throw new Error("secret-callback");
      });
      if (broken === "prepare") throw new Error("secret-prepare");
      return { handle: "local" };
    }

    override execute(_input: Input, _context: ToolActionContext, prepared: { handle: string } | undefined): Output {
      expect(prepared).toEqual({ handle: "local" });
      if (broken === "execute") throw new Error("secret-execute");
      return broken === "output" ? { wrong: "secret-output" } as unknown as Output : { value: "ok" };
    }

    override cleanup(_context: ToolActionContext, prepared: { handle: string } | undefined): void {
      expect(prepared).toEqual(broken === "prepare" ? undefined : { handle: "local" });
      order.push("action");
      throw new Error("secret-action-cleanup");
    }
  }
  const dispatcher = createToolDispatcher();
  const handle = dispatcher.dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(() => new Action()), ports: ports() });
  const outcome = await handle.result;
  expect(outcome).toMatchObject({ status: "failed", code: broken === "output" ? "invalid-output" : broken === "cleanup" ? "cleanup-failed" : "action-failed",
    phase: broken, cleanupFailures: 2, effectPossible: true });
  expect(JSON.stringify(outcome)).not.toContain("secret");
  expect(order).toEqual(["action", "second", "first"]);
  await handle.settled;
  handle.cancel();
  await dispatcher.shutdown();
  expect(order).toEqual(["action", "second", "first"]);
});

it("supports a callback prepared value without serializing it and closes cleanup registration after prepare", async () => {
  let saved: ToolPreparationHooks | undefined;
  const closed = vi.fn();
  class Action extends ToolAction<Input, Output, () => string> {
    override prepare(_input: Input, _context: ToolActionContext, hooks: ToolPreparationHooks): () => string {
      saved = hooks;
      hooks.onCleanup(closed);
      return () => "local-handle";
    }

    override execute(_input: Input, _context: ToolActionContext, prepared: (() => string) | undefined): Output {
      if (prepared === undefined) throw new Error("Missing preparation");
      return { value: prepared() };
    }
  }
  const handle = createToolDispatcher().dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(() => new Action()), ports: ports() });
  await expect(handle.result).resolves.toMatchObject({ status: "succeeded", output: { value: "local-handle" } });
  expect(closed).toHaveBeenCalledOnce();
  expect(() => saved?.onCleanup(closed)).toThrow("closed");
});

it.each(["cancel", "timeout"])("retains noncooperative execution ownership and capacity after %s", async (mode) => {
  vi.useFakeTimers();
  const entered = Promise.withResolvers<undefined>();
  const work = Promise.withResolvers<Output>();
  const cleaned = vi.fn();
  class Action extends ToolAction<Input, Output> {
    override execute(): Promise<Output> {
      entered.resolve(undefined);
      return work.promise;
    }

    override cleanup = cleaned;
  }
  const dispatcher = createToolDispatcher({ limits: { maxInFlight: 1, timeoutMs: 20 } });
  const registered = registration(() => new Action());
  const first = dispatcher.dispatch({ callId: "call-1", input: { path: "x" }, registration: registered, ports: ports() });
  await entered.promise;
  if (mode === "cancel") first.cancel();
  else await vi.advanceTimersByTimeAsync(21);
  await expect(first.result).resolves.toMatchObject({ code: mode === "cancel" ? "cancelled" : "timeout", effectPossible: true });
  expect(cleaned).not.toHaveBeenCalled();
  expect(dispatcher.stats()).toMatchObject({ active: 1, draining: 1 });
  await expect(dispatcher.dispatch({ callId: "call-2", input: { path: "y" }, registration: registered, ports: ports("call-2") }).result)
    .resolves.toMatchObject({ code: "capacity" });
  work.resolve({ value: "late-output" });
  await expect(first.settled).resolves.toMatchObject({ status: "failed" });
  expect(cleaned).toHaveBeenCalledOnce();
  expect(dispatcher.stats()).toMatchObject({ active: 0, draining: 0 });
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps late prepare acquisitions owned after timeout and passes the returned handle to cleanup", async () => {
  vi.useFakeTimers();
  const entered = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  const released = vi.fn();
  const cleaned = vi.fn();
  const execute = vi.fn(() => ({ value: "forbidden" }));
  class Action extends ToolAction<Input, Output, { value: string }> {
    override async prepare(_input: Input, context: ToolActionContext, hooks: ToolPreparationHooks): Promise<{ value: string }> {
      entered.resolve(undefined);
      await resume.promise;
      expect(context.signal.aborted).toBe(true);
      hooks.onCleanup(released);
      return { value: "late-resource" };
    }

    override execute = execute;
    override cleanup(_context: ToolActionContext, prepared: { value: string } | undefined): void {
      cleaned(prepared);
    }
  }
  const dispatcher = createToolDispatcher({ limits: { hookTimeoutMs: 10 } });
  const handle = dispatcher.dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(() => new Action()), ports: ports() });
  await entered.promise;
  await vi.advanceTimersByTimeAsync(11);
  await expect(handle.result).resolves.toMatchObject({ code: "timeout", phase: "prepare" });
  expect(released).not.toHaveBeenCalled();
  expect(cleaned).not.toHaveBeenCalled();
  resume.resolve(undefined);
  await handle.settled;
  expect(cleaned).toHaveBeenCalledExactlyOnceWith({ value: "late-resource" });
  expect(released).toHaveBeenCalledOnce();
  expect(execute).not.toHaveBeenCalled();
  expect(dispatcher.stats().active).toBe(0);
});

it("reports bounded shutdown draining and still cleans up late settled actions", async () => {
  vi.useFakeTimers();
  const entered = Promise.withResolvers<undefined>();
  const work = Promise.withResolvers<Output>();
  const cleaned = vi.fn();
  class Action extends ToolAction<Input, Output> {
    override execute(): Promise<Output> {
      entered.resolve(undefined);
      return work.promise;
    }

    override cleanup = cleaned;
  }
  const dispatcher = createToolDispatcher({ limits: { shutdownWaitMs: 10 } });
  const registered = registration(() => new Action());
  const handle = dispatcher.dispatch({ callId: "call-1", input: { path: "x" }, registration: registered, ports: ports() });
  await entered.promise;
  const stopping = dispatcher.shutdown();
  await vi.advanceTimersByTimeAsync(11);
  await expect(stopping).resolves.toEqual({ draining: 1 });
  await expect(handle.result).resolves.toMatchObject({ code: "cancelled" });
  expect(cleaned).not.toHaveBeenCalled();
  await expect(dispatcher.dispatch({ callId: "call-2", input: { path: "x" }, registration: registered, ports: ports("call-2") }).result)
    .resolves.toMatchObject({ code: "closed" });
  work.resolve({ value: "late" });
  await handle.settled;
  expect(cleaned).toHaveBeenCalledOnce();
  await expect(dispatcher.shutdown()).resolves.toEqual({ draining: 0 });
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds output retained during cleanup and releases its budget only after settlement", async () => {
  const cleaning = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  class First extends EchoAction {
    override cleanup(): Promise<undefined> {
      cleaning.resolve(undefined);
      return release.promise;
    }
  }
  const dispatcher = createToolDispatcher({ limits: { maxRetainedOutputBytes: 20 } });
  const first = dispatcher.dispatch({ callId: "call-1", input: { path: "one" }, registration: registration(() => new First()), ports: ports() });
  await cleaning.promise;
  expect(dispatcher.stats().retainedOutputBytes).toBe(15);
  const other = dispatcher.dispatch({ callId: "call-2", input: { path: "two" }, registration: registration(() => new EchoAction()), ports: ports("call-2") });
  await expect(other.result).resolves.toMatchObject({ code: "result-capacity", effectPossible: true });
  first.cancel();
  await first.result;
  expect(dispatcher.stats().retainedOutputBytes).toBe(15);
  release.resolve(undefined);
  await first.settled;
  expect(dispatcher.stats().retainedOutputBytes).toBe(0);
});

it("isolates concurrent actors' action instances and local prepared resources", async () => {
  const both = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  const seen: string[] = [];
  let created = 0;
  class Action extends ToolAction<Input, Output, string> {
    private owner = "unset";
    override prepare(_input: Input, context: ToolActionContext): string {
      this.owner = context.caller.actor.principal.subject;
      if (++created === 2) both.resolve(undefined);
      return this.owner;
    }

    override async execute(_input: Input, _context: ToolActionContext, prepared: string | undefined): Promise<Output> {
      await resume.promise;
      expect(prepared).toBe(this.owner);
      seen.push(this.owner);
      return { value: this.owner };
    }
  }
  const dispatcher = createToolDispatcher();
  const registered = registration(() => new Action());
  const first = dispatcher.dispatch({ callId: "call-1", input: { path: "x" }, registration: registered, ports: ports() });
  const second = dispatcher.dispatch({ callId: "call-2", input: { path: "x" }, registration: registered, ports: ports("call-2", "other") });
  await both.promise;
  resume.resolve(undefined);
  await Promise.all([first.result, second.result]);
  expect(seen.sort()).toEqual(["caller", "other"]);
});

it("rejects concurrent instance reuse and duplicate active call ids without cleaning the first action", async () => {
  const entered = Promise.withResolvers<undefined>();
  const work = Promise.withResolvers<Output>();
  const cleaned = vi.fn();
  class Action extends ToolAction<Input, Output> {
    override execute(): Promise<Output> {
      entered.resolve(undefined);
      return work.promise;
    }

    override cleanup = cleaned;
  }
  const singleton = new Action();
  const registered = registration(() => singleton);
  const dispatcher = createToolDispatcher();
  const first = dispatcher.dispatch({ callId: "call-1", input: { path: "x" }, registration: registered, ports: ports() });
  await entered.promise;
  await expect(dispatcher.dispatch({ callId: "call-1", input: { path: "x" }, registration: registered, ports: ports() }).result)
    .resolves.toMatchObject({ code: "duplicate-call" });
  await expect(dispatcher.dispatch({ callId: "call-2", input: { path: "x" }, registration: registered, ports: ports("call-2") }).result)
    .resolves.toMatchObject({ code: "action-reused" });
  expect(cleaned).not.toHaveBeenCalled();
  work.resolve({ value: "first-only" });
  await first.settled;
  expect(cleaned).toHaveBeenCalledOnce();
});

it("keeps an aborted authentication hook draining through late rejection and removes the upstream listener", async () => {
  const entered = Promise.withResolvers<undefined>();
  const hook = Promise.withResolvers<undefined>();
  const cleaned = vi.fn();
  const execute = vi.fn(() => ({ value: "forbidden" }));
  class Action extends ToolAction<Input, Output> {
    override authenticate(): Promise<undefined> {
      entered.resolve(undefined);
      return hook.promise;
    }

    override execute = execute;
    override cleanup = cleaned;
  }
  const upstream = new AbortController();
  const removed = vi.spyOn(upstream.signal, "removeEventListener");
  const dispatcher = createToolDispatcher();
  const handle = dispatcher.dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(() => new Action()), ports: ports(), signal: upstream.signal });
  await entered.promise;
  upstream.abort();
  await expect(handle.result).resolves.toMatchObject({ code: "cancelled", phase: "authenticate", effectPossible: false });
  expect(cleaned).not.toHaveBeenCalled();
  hook.reject(new Error("private-late-auth-error"));
  const outcome = await handle.settled;
  expect(JSON.stringify(outcome)).not.toContain("private");
  expect(outcome).toMatchObject({ code: "cancelled" });
  expect(cleaned).toHaveBeenCalledOnce();
  expect(execute).not.toHaveBeenCalled();
  expect(removed).toHaveBeenCalledOnce();
});

it("performs no upstream callback for an already-aborted request", async () => {
  const upstream = new AbortController();
  upstream.abort();
  const authority = ports();
  const resolve = vi.spyOn(authority, "resolve");
  const create = vi.fn(() => new EchoAction());
  await expect(createToolDispatcher().dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(create), ports: authority, signal: upstream.signal }).settled)
    .resolves.toMatchObject({ code: "cancelled" });
  expect(resolve).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

it("sanitizes a declared-output failure and still cleans acquired resources", async () => {
  const cleaned = vi.fn();
  class Action extends EchoAction {
    override execute(): Output {
      return { value: "secret".repeat(100) };
    }

    override cleanup = cleaned;
  }
  const outcome = await createToolDispatcher({ limits: { maxOutputBytes: 20 } }).dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(() => new Action()), ports: ports() }).result;
  expect(outcome).toMatchObject({ code: "invalid-output", phase: "output", effectPossible: true });
  expect(JSON.stringify(outcome)).not.toContain("secret");
  expect(cleaned).toHaveBeenCalledOnce();
});

it.each(["same", "different"])("rechecks admission capacity after a reentrant injected clock starts the %s call id", async (identity) => {
  const entered = Promise.withResolvers<undefined>();
  const work = Promise.withResolvers<Output>();
  class Action extends ToolAction<Input, Output> {
    override execute(): Promise<Output> {
      entered.resolve(undefined);
      return work.promise;
    }
  }
  const create = vi.fn(() => new Action());
  const registered = registration(create);
  let started = false;
  let nested: ToolDispatchHandle<Output> | undefined;
  const dispatcher = createToolDispatcher({ limits: { maxInFlight: 1 }, now: () => {
    if (!started) {
      started = true;
      const callId = identity === "same" ? "outer" : "nested";
      nested = dispatcher.dispatch({ callId, input: { path: "x" }, registration: registered, ports: ports(callId) });
    }
    return 100;
  } });
  const outer = dispatcher.dispatch({ callId: "outer", input: { path: "x" }, registration: registered, ports: ports("outer") });
  await entered.promise;
  const active = dispatcher.stats().active;
  work.resolve({ value: "done" });
  const outcomes = await Promise.all([outer.result, nested?.result]);
  expect(active).toBe(1);
  expect(outcomes[0]).toMatchObject({ code: identity === "same" ? "duplicate-call" : "capacity" });
  expect(outcomes[1]).toMatchObject({ status: "succeeded" });
  expect(create).toHaveBeenCalledOnce();
});
