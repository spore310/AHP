import { expect, it, vi } from "vitest";
import { createToolDispatcher } from "@toolExecution/helpers/dispatcher";
import { ToolAction } from "@toolExecution";
import type { ToolActionContext, ValidationResult } from "@toolExecution";
import { createToolActionRegistration } from "@toolExecution/helpers/action";
import { TOOL_DISPATCH_ABSOLUTE } from "@toolExecution/helpers/dispatcher/types";
import { EchoAction, contract, facts, ports, registration } from "./fixtures";
import type { Input, Output } from "./fixtures";

it("rejects schema-invalid input before creating an action or running custom hooks", async () => {
  const create = vi.fn(() => new EchoAction());
  const dispatcher = createToolDispatcher();
  const result = await dispatcher.dispatch({ callId: "call-1", input: { path: 7 }, registration: registration(create), ports: ports() }).result;
  expect(result).toMatchObject({ status: "failed", code: "invalid-input", effectPossible: false });
  expect(create).not.toHaveBeenCalled();
  expect(dispatcher.stats().active).toBe(0);
});

it("coarse denial reaches no action factory and supplementary authentication cannot grant access", async () => {
  const dispatcher = createToolDispatcher();
  const create = vi.fn(() => new EchoAction());
  const denied = ports();
  denied.coarse = vi.fn(() => false);
  await expect(dispatcher.dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(create), ports: denied }).result)
    .resolves.toMatchObject({ status: "failed", code: "denied" });
  expect(create).not.toHaveBeenCalled();
  const authenticated = vi.fn();
  const execute = vi.fn(() => ({ value: "forbidden" }));
  class Action extends ToolAction<Input, Output> {
    override authenticate = authenticated;
    override execute = execute;
  }
  const fullDeny = ports("call-2");
  fullDeny.authorize = (context) => ({ decision: { effect: "deny", code: "provider-denied" }, authority: context.authority });
  await expect(dispatcher.dispatch({ callId: "call-2", input: { path: "x" }, registration: registration(() => new Action()), ports: fullDeny }).result)
    .resolves.toMatchObject({ status: "failed", code: "denied" });
  expect(authenticated).toHaveBeenCalledOnce();
  expect(execute).not.toHaveBeenCalled();
});

it("fails closed on a required challenge before preparation", async () => {
  const prepare = vi.fn();
  const execute = vi.fn(() => ({ value: "forbidden" }));
  class Action extends ToolAction<Input, Output> {
    override prepare = prepare;
    override execute = execute;
  }
  const authority = ports();
  authority.authorize = (context) => ({ decision: { effect: "allow", reveal: true, challengeRequired: true }, authority: context.authority });
  await expect(createToolDispatcher().dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(() => new Action()), ports: authority }).result)
    .resolves.toMatchObject({ code: "challenge-required", effectPossible: false });
  expect(prepare).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});

it("requires exact true from the coarse access adapter", async () => {
  const authority = ports();
  authority.coarse = (() => "allow") as unknown as typeof authority.coarse;
  const create = vi.fn(() => new EchoAction());
  await expect(createToolDispatcher().dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(create), ports: authority }).result)
    .resolves.toMatchObject({ code: "denied" });
  expect(create).not.toHaveBeenCalled();
});

it("resolves and authorizes normalized targets instead of reusing the original resource decision", async () => {
  const prepare = vi.fn();
  class Action extends EchoAction {
    override validate(): ValidationResult<Input> {
      return { kind: "normalized", input: { path: "private" } };
    }

    override prepare = prepare;
  }
  const authority = ports();
  const targets: string[] = [];
  authority.resolve = (input) => facts("call-1", "caller", (input as Input).path);
  authority.authorize = (context) => {
    targets.push(context.resources.targets[0]?.id ?? "missing");
    return { decision: { effect: "deny", code: "private-target" }, authority: context.authority };
  };
  await expect(createToolDispatcher().dispatch({ callId: "call-1", input: { path: "public" }, registration: registration(() => new Action()), ports: authority }).result)
    .resolves.toMatchObject({ code: "denied" });
  expect(targets).toEqual(["private"]);
  expect(prepare).not.toHaveBeenCalled();
});

it("captures immutable original and normalized input and gives prepare the full-decision stamp", async () => {
  const original = { path: "original" };
  const normalized = { path: "normalized" };
  const seen: string[] = [];
  class Action extends EchoAction {
    override validate(input: Input): ValidationResult<Input> {
      expect(Object.isFrozen(input)).toBe(true);
      expect(input).not.toBe(original);
      original.path = "mutated-original";
      return { kind: "normalized", input: normalized };
    }

    override prepare(input: Input, context: ToolActionContext): void {
      normalized.path = "mutated-normalized";
      expect(Object.isFrozen(input)).toBe(true);
      expect(Object.isFrozen(context.caller.actor.principal)).toBe(true);
      expect(context.authority.grantRevision).toBe(2);
      seen.push(input.path);
    }

    override execute(input: Input): Output {
      seen.push(input.path);
      return { value: input.path };
    }
  }
  const authority = ports();
  authority.authorize = (context) => ({ decision: { effect: "allow", reveal: true, challengeRequired: false }, authority: { ...context.authority, grantRevision: 2 } });
  await expect(createToolDispatcher().dispatch({ callId: "call-1", input: original, registration: registration(() => new Action()), ports: authority }).result)
    .resolves.toMatchObject({ status: "succeeded", output: { value: "normalized" } });
  expect(seen).toEqual(["normalized", "normalized"]);
});

it("rejects schema-invalid normalization before full policy or preparation", async () => {
  class Action extends EchoAction {
    override validate(): ValidationResult<Input> {
      return { kind: "normalized", input: { path: 42 } as unknown as Input };
    }
  }
  const authority = ports();
  const authorize = vi.spyOn(authority, "authorize");
  await expect(createToolDispatcher().dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(() => new Action()), ports: authority }).result)
    .resolves.toMatchObject({ code: "invalid-input" });
  expect(authorize).not.toHaveBeenCalled();
});

it.each(["implementation", "actor", "executor", "route"])("rejects a mismatched %s before preparation", async (changed) => {
  const prepare = vi.fn();
  class Action extends EchoAction { override prepare = prepare; }
  const authority = ports();
  if (changed === "implementation") {
    authority.resolve = () => ({ ...facts(), implementation: { location: "server", suppliedBy: "server", implementation: "host", implementationId: "other" } });
  } else {
    authority.authorize = (context) => ({ decision: { effect: "allow", reveal: true, challengeRequired: false },
      authority: { ...context.authority,
        ...(changed === "actor" ? { actor: facts("call-1", "impostor").caller.actor } : {}),
        ...(changed === "executor" ? { executor: { ...context.executor, generation: 99 } } : {}),
        ...(changed === "route" ? { route: { ...context.resources, targets: [] } } : {}),
      } });
  }
  await expect(createToolDispatcher().dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(() => new Action()), ports: authority }).result)
    .resolves.toMatchObject({ code: "invalid-context" });
  expect(prepare).not.toHaveBeenCalled();
});

it.each(["caller", "executor", "origin"])("pins %s across resource resolution after normalization", async (changed) => {
  const authority = ports();
  const authorize = vi.spyOn(authority, "authorize");
  let resolutions = 0;
  authority.resolve = () => {
    const value = facts();
    if (++resolutions === 1) return value;
    if (changed === "caller") return facts("call-1", "other");
    if (changed === "executor") {
      const executor = { ...value.executor, generation: 2 };
      return { ...value, executor, authority: { ...value.authority, executor } };
    }
    const resources = { ...value.resources, origin: { ...value.resources.origin, instanceId: "replacement" } };
    return { ...value, resources, authority: { ...value.authority, route: resources } };
  };
  await expect(createToolDispatcher().dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(() => new EchoAction()), ports: authority }).result)
    .resolves.toMatchObject({ code: "invalid-context" });
  expect(authorize).not.toHaveBeenCalled();
});

it.each(["authenticate", "validate", "prepare", "execute", "cleanup"])("fences stale authority after %s settles", async (changed) => {
  let current = true;
  const execute = vi.fn((input: Input) => ({ value: input.path }));
  class Action extends EchoAction {
    override async authenticate(): Promise<void> {
      await Promise.resolve();
      if (changed === "authenticate") current = false;
    }

    override async validate(): Promise<void> {
      await Promise.resolve();
      if (changed === "validate") current = false;
    }

    override async prepare(): Promise<void> {
      await Promise.resolve();
      if (changed === "prepare") current = false;
    }

    override execute(input: Input): Output {
      if (changed === "execute") current = false;
      return execute(input);
    }

    override cleanup(): void {
      if (changed === "cleanup") current = false;
    }
  }
  const authority = ports();
  authority.current = () => current;
  await expect(createToolDispatcher().dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(() => new Action()), ports: authority }).result)
    .resolves.toMatchObject({ code: "stale" });
  expect(execute).toHaveBeenCalledTimes(changed === "execute" || changed === "cleanup" ? 1 : 0);
});

it("rejects a promise-shaped currentness verdict without treating it as true", async () => {
  const authority = ports();
  authority.current = (() => Promise.reject(new Error("private-current-error"))) as unknown as typeof authority.current;
  const create = vi.fn(() => new EchoAction());
  const outcome = await createToolDispatcher().dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(create), ports: authority }).result;
  expect(outcome).toMatchObject({ code: "stale" });
  expect(JSON.stringify(outcome)).not.toContain("private-current-error");
  expect(create).not.toHaveBeenCalled();
});

it("rejects sequential reuse of an action instance for a different actor", async () => {
  const singleton = new EchoAction();
  const registered = registration(() => singleton);
  const dispatcher = createToolDispatcher();
  await expect(dispatcher.dispatch({ callId: "call-1", input: { path: "first" }, registration: registered, ports: ports() }).result)
    .resolves.toMatchObject({ status: "succeeded" });
  await expect(dispatcher.dispatch({ callId: "call-2", input: { path: "second" }, registration: registered, ports: ports("call-2", "other") }).result)
    .resolves.toMatchObject({ code: "action-reused" });
});

it("accepts bounded JSON when the contract omits an output schema", async () => {
  const { outputSchema, ...definition } = contract;
  expect(outputSchema).toBeDefined();
  class Action extends ToolAction<Input, unknown> {
    override execute(): unknown {
      return ["valid", 3, null];
    }
  }
  const registered = createToolActionRegistration({ definition, implementation: facts().implementation, create: () => new Action() });
  await expect(createToolDispatcher().dispatch({ callId: "call-1", input: { path: "x" }, registration: registered, ports: ports() }).result)
    .resolves.toMatchObject({ status: "succeeded", output: ["valid", 3, null] });
});

it("enforces input byte boundaries without evaluating getters or accepting non-JSON values", async () => {
  const getter = vi.fn(() => "x");
  const withGetter = Object.defineProperty({}, "path", { enumerable: true, get: getter });
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const create = vi.fn(() => new EchoAction());
  for (const input of [withGetter, cyclic, new Date(), { path: "x".repeat(100) }, { path: Number.NaN }]) {
    const outcome = await createToolDispatcher({ limits: { maxInputBytes: 12 } }).dispatch({ callId: "call-1", input, registration: registration(create), ports: ports() }).result;
    expect(outcome).toMatchObject({ code: "invalid-input" });
  }
  expect(getter).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  await expect(createToolDispatcher({ limits: { maxInputBytes: 12 } }).dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(create), ports: ports() }).result)
    .resolves.toMatchObject({ status: "succeeded" });
});

it("rejects every invalid dispatcher budget and nonfinite clocks", async () => {
  for (const [key, absolute] of Object.entries(TOOL_DISPATCH_ABSOLUTE)) {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, absolute + 1]) {
      expect(() => createToolDispatcher({ limits: { [key]: value } })).toThrow("limit");
    }
  }
  const create = vi.fn(() => new EchoAction());
  await expect(createToolDispatcher({ now: () => Number.NaN }).dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(create), ports: ports() }).result)
    .resolves.toMatchObject({ code: "invalid-clock" });
  expect(create).not.toHaveBeenCalled();
});

it("checks currentness after the last clock callback before effectful hooks", async () => {
  let clockAfterCurrent = true;
  const authority = ports();
  authority.current = () => {
    clockAfterCurrent = false;
    return true;
  };
  class Action extends EchoAction {
    override prepare(): void {
      expect(clockAfterCurrent).toBe(false);
    }

    override execute(input: Input): Output {
      expect(clockAfterCurrent).toBe(false);
      return { value: input.path };
    }
  }
  await expect(createToolDispatcher({ now: () => {
    clockAfterCurrent = true;
    return 100;
  } }).dispatch({
    callId: "call-1", input: { path: "x" }, registration: registration(() => new Action()), ports: authority,
  }).result).resolves.toMatchObject({ status: "succeeded" });
});

it("keeps the captured per-call currentness method when the caller replaces the port", async () => {
  let valid = true;
  const authority = ports();
  authority.current = () => valid;
  class Action extends EchoAction {
    override cleanup(): void {
      valid = false;
      authority.current = () => true;
    }
  }
  await expect(createToolDispatcher().dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(() => new Action()), ports: authority }).result)
    .resolves.toMatchObject({ code: "stale", phase: "delivery", effectPossible: true });
});

it("rejects getter-bearing authority results without running their accessor", async () => {
  const getter = vi.fn(() => ({ effect: "allow", reveal: true, challengeRequired: false }));
  const authority = ports();
  authority.authorize = (context) => Object.defineProperty({ authority: context.authority }, "decision", { enumerable: true, get: getter }) as unknown as ReturnType<typeof authority.authorize>;
  const prepare = vi.fn();
  class Action extends EchoAction { override prepare = prepare; }
  await expect(createToolDispatcher().dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(() => new Action()), ports: authority }).result)
    .resolves.toMatchObject({ status: "failed" });
  expect(getter).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
});

it("preserves ordinary JSON constructor and prototype keys without invoking object setters", async () => {
  const { outputSchema, ...definition } = contract;
  expect(outputSchema).toBeDefined();
  class Action extends ToolAction<Readonly<Record<string, unknown>>, unknown> {
    override execute(input: Readonly<Record<string, unknown>>): unknown {
      return input;
    }
  }
  const registered = createToolActionRegistration({ definition: { ...definition, inputSchema: { type: "object" } }, implementation: facts().implementation, create: () => new Action() });
  const input = Object.defineProperty({ constructor: "data", prototype: "data" }, "__proto__", { enumerable: true, value: { safe: "data" } });
  const outcome = await createToolDispatcher().dispatch({ callId: "call-1", input, registration: registered, ports: ports() }).result;
  expect(outcome).toMatchObject({ status: "succeeded", output: { constructor: "data", prototype: "data" } });
  if (outcome.status !== "succeeded") throw new Error("Expected admitted result");
  expect(Object.getPrototypeOf(outcome.output)).toBe(Object.prototype);
  expect(Object.getOwnPropertyDescriptor(outcome.output, "__proto__")?.value).toEqual({ safe: "data" });
});

it.each([null, false, { kind: "other", input: { path: "x" } }, { kind: "normalized" }, { kind: "normalized", input: { path: "x" }, extra: true }])(
  "rejects malformed normalization %j before authorization or effects", async (malformed) => {
    const prepare = vi.fn();
    const execute = vi.fn(() => ({ value: "forbidden" }));
    class Action extends ToolAction<Input, Output> {
      override validate(): ValidationResult<Input> {
        return malformed as unknown as ValidationResult<Input>;
      }

      override prepare = prepare;
      override execute = execute;
    }
    const authority = ports();
    const authorize = vi.spyOn(authority, "authorize");
    await expect(createToolDispatcher().dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(() => new Action()), ports: authority }).result)
      .resolves.toMatchObject({ code: "invalid-input" });
    expect(authorize).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  },
);

it.each(["depth", "keys"])("enforces actual input %s boundaries before constructing an action", async (dimension) => {
  const { outputSchema, ...definition } = contract;
  expect(outputSchema).toBeDefined();
  class Action extends ToolAction<unknown, unknown> {
    override execute(input: unknown): unknown {
      return input;
    }
  }
  const create = vi.fn(() => new Action());
  const registered = createToolActionRegistration({ definition: { ...definition, inputSchema: { type: "object" } }, implementation: facts().implementation, create });
  const limits = dimension === "depth" ? { maxJsonDepth: 2 } : { maxJsonKeys: 2 };
  const boundary = dimension === "depth" ? { nested: { value: "x" } } : { a: 1, b: 2 };
  const beyond = dimension === "depth" ? { nested: { deeper: { value: "x" } } } : { a: 1, b: 2, c: 3 };
  const dispatcher = createToolDispatcher({ limits });
  await expect(dispatcher.dispatch({ callId: "call-1", input: boundary, registration: registered, ports: ports() }).result)
    .resolves.toMatchObject({ status: "succeeded", output: boundary });
  await expect(dispatcher.dispatch({ callId: "call-2", input: beyond, registration: registered, ports: ports("call-2") }).result)
    .resolves.toMatchObject({ code: "invalid-input", effectPossible: false });
  expect(create).toHaveBeenCalledOnce();
});

it.each(["depth", "keys"])("enforces actual output %s boundaries even with no output schema", async (dimension) => {
  const { outputSchema, ...definition } = contract;
  expect(outputSchema).toBeDefined();
  const cleaned = vi.fn();
  let output: unknown = dimension === "depth" ? { nested: { value: "x" } } : { a: 1, b: 2 };
  class Action extends ToolAction<Input, unknown> {
    override execute(): unknown {
      return output;
    }

    override cleanup = cleaned;
  }
  const registered = createToolActionRegistration({ definition, implementation: facts().implementation, create: () => new Action() });
  const dispatcher = createToolDispatcher({ limits: dimension === "depth" ? { maxJsonDepth: 2 } : { maxJsonKeys: 2 } });
  await expect(dispatcher.dispatch({ callId: "call-1", input: { path: "x" }, registration: registered, ports: ports() }).result)
    .resolves.toMatchObject({ status: "succeeded" });
  output = dimension === "depth" ? { nested: { deeper: { value: "x" } } } : { a: 1, b: 2, c: 3 };
  await expect(dispatcher.dispatch({ callId: "call-2", input: { path: "x" }, registration: registered, ports: ports("call-2") }).result)
    .resolves.toMatchObject({ code: "invalid-output", effectPossible: true });
  expect(cleaned).toHaveBeenCalledTimes(2);
});

it("runs an admitted action with optional preparation absent", async () => {
  const dispatcher = createToolDispatcher();
  const handle = dispatcher.dispatch({ callId: "call-1", input: { path: "chosen" }, registration: registration(() => new EchoAction()), ports: ports() });
  await expect(handle.result).resolves.toEqual({ status: "succeeded", output: { value: "chosen" }, cleanupFailures: 0 });
  await handle.settled;
  expect(dispatcher.stats()).toEqual({ active: 0, draining: 0, retainedOutputBytes: 0 });
});
