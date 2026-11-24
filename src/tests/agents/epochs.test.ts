import { expect, it, vi } from "vitest";
import assert from "node:assert/strict";
import { createAgentDirectory, createAgentWorkConfig } from "@agents";
import { RepositoryError } from "@persistence";
import { createExampleRegistrationState } from "../../../examples/advanced/persistence";

const principal = { domainId: "demo", subject: "junior" };
const agent = { principal, agentKey: "worker", actorAgentId: "actor", registrationId: "agent" };

it("captures complete full-identity claim configuration before replacement", () => {
  const changed = vi.fn();
  const kinds = ["review"];
  const config = createAgentWorkConfig({ identities: [{ identity: { ...principal, agentKey: "worker", actorAgentId: "actor" }, maxActiveClaims: 4, allowedKinds: kinds }] }, changed);
  kinds.pop();
  expect(config.resolve(agent)).toMatchObject({ maxActiveClaims: 4, allowedKinds: ["review"] });
  expect(config.resolve({ ...agent, actorAgentId: "other" }).maxActiveClaims).toBe(3);
  expect(config.resolve({ ...agent, principal: { ...principal, subject: "other" } }).maxActiveClaims).toBe(3);
  const initial = config.resolve(agent).revision;
  expect(() => {
    config.replace({ defaultMaxActiveClaims: 1025 });
  }).toThrow();
  expect(config.resolve(agent).revision).toBe(initial);
  expect(changed).not.toHaveBeenCalled();
  config.replace({ defaultMaxActiveClaims: 0 });
  expect(config.resolve(agent)).toMatchObject({ maxActiveClaims: 0 });
  expect(config.resolve(agent).revision).not.toBe(initial);
  expect(changed).toHaveBeenCalledOnce();
});

it("rotates only on new binds and transitions, evicting local authority synchronously", async () => {
  const { repository } = createExampleRegistrationState();
  const directory = createAgentDirectory({ domainId: "demo", registrations: repository });
  const bind = (connection: string) => directory.registerPresence(principal, "worker", connection, { requireExecutionEpoch: true });
  const first = await bind("one");
  expect(first.executionEpoch).toBe("1");
  expect(await bind("one")).toBe(first);
  await expect(bind("two")).rejects.toThrow();
  const fence = directory.capturePresenceFence?.(first, "1");
  assert.ok(fence);
  const disabled = directory.setEnabled(first.agentId, false);
  expect(fence()).toBe(false);
  expect(directory.getOnline(first.agentId)).toBeUndefined();
  expect((await disabled).executionEpoch).toBe("2");
  expect((await directory.setEnabled(first.agentId, false)).executionEpoch).toBe("2");
  await expect(bind("two")).rejects.toThrow();
  expect((await directory.setEnabled(first.agentId, true)).executionEpoch).toBe("3");
  expect(directory.getOnline(first.agentId)).toBeUndefined();
  const next = await bind("two");
  expect(next.executionEpoch).toBe("4");
  directory.releasePresence(first);
  expect(directory.getOnline(first.agentId)).toBe(next);
});

it("reserves identity and connection across a delayed commit and discards a disconnected result", async () => {
  const { repository } = createExampleRegistrationState();
  const entered = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  const directory = createAgentDirectory({ domainId: "demo", registrations: { ...repository,
    async bindExecution(...args) {
      assert.ok(typeof repository.bindExecution === "function");
      const result = await repository.bindExecution(...args);
      entered.resolve(undefined);
      await resume.promise;
      return result;
    },
  } });
  const bind = (key: string, connection: string) => directory.registerPresence(principal, key, connection, { requireExecutionEpoch: true });
  const first = bind("worker", "one");
  await entered.promise;
  await expect(bind("another", "one")).rejects.toThrow();
  await expect(bind("worker", "two")).rejects.toThrow();
  directory.releaseConnection("one");
  resume.resolve(undefined);
  await expect(first).rejects.toThrow();
  expect(directory.getByConnection("one")).toBeUndefined();
  expect((await bind("worker", "two")).executionEpoch).toBe("2");
});

it("reconciles an uncertain commit only on a fresh bind", async () => {
  const { repository } = createExampleRegistrationState();
  let uncertain = true;
  const directory = createAgentDirectory({ domainId: "demo", registrations: { ...repository,
    async bindExecution(...args) {
      assert.ok(typeof repository.bindExecution === "function");
      const result = await repository.bindExecution(...args);
      if (uncertain) throw new RepositoryError("outcome_unknown", "Uncertain result");
      return result;
    },
  } });
  const bind = () => directory.registerPresence(principal, "worker", "one", { requireExecutionEpoch: true });
  await expect(bind()).rejects.toMatchObject({ code: "outcome_unknown" });
  expect(directory.getByConnection("one")).toBeUndefined();
  uncertain = false;
  expect((await bind()).executionEpoch).toBe("2");
});

it("holds the shared pending slot through durable bind and releases it only after settlement", async () => {
  const { repository } = createExampleRegistrationState();
  const entered = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  const directory = createAgentDirectory({ domainId: "demo", registrationLimits: { maxPending: 1 }, registrations: { ...repository,
    async bindExecution(record) {
      entered.resolve(undefined);
      await resume.promise;
      assert.ok(typeof repository.bindExecution === "function");
      return repository.bindExecution(record);
    },
  } });
  const binding = directory.registerPresence(principal, "worker", "one", { requireExecutionEpoch: true });
  await entered.promise;
  try {
    await expect(directory.register(principal, "another")).rejects.toMatchObject({ code: "conflict" });
    directory.releaseConnection("one");
    await expect(directory.register(principal, "another")).rejects.toMatchObject({ code: "conflict" });
  } finally {
    resume.resolve(undefined);
    await binding.catch(() => undefined);
  }
  await expect(directory.register(principal, "another")).resolves.toMatchObject({ agentKey: "another" });
});

it("refuses an epoch-required bind before creating any row on a legacy store", async () => {
  const { repository, registrations } = createExampleRegistrationState();
  const directory = createAgentDirectory({ domainId: "demo", registrations: { register: repository.register.bind(repository), getById: repository.getById.bind(repository) } });
  await expect(directory.registerPresence(principal, "worker", "one", { requireExecutionEpoch: true })).rejects.toThrow();
  expect(registrations.size).toBe(0);
  const legacy = await directory.registerPresence(principal, "worker", "one");
  expect(legacy.executionEpoch).toBeUndefined();
  expect(directory.capturePresenceFence?.(legacy, "0")()).toBe(false);
});
