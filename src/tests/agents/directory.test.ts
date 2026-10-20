import { describe, expect, it } from "vitest";

import {
  AgentDirectoryError,
  createAgentDirectory,
  type AuthenticatedPrincipal,
} from "@agents";

import { createRegistrationFixture, createTestClock } from "./fixtures";

const alice: AuthenticatedPrincipal = { subject: "alice" };
const bob: AuthenticatedPrincipal = { subject: "bob" };

const setup = (ttlMs = 1_000) => {
  const clock = createTestClock();
  const registrations = createRegistrationFixture();
  const directory = createAgentDirectory({
    registrations: registrations.repository,
    now: clock.now,
    presenceTtlMs: ttlMs,
  });
  return { clock, registrations, directory };
};

describe("createAgentDirectory registration", () => {
  it("resolves one stable registration for the same principal and agent key", async () => {
    const { registrations, directory } = setup();
    const first = await directory.register(alice, "coding-worker", "Worker");
    const second = await directory.register(alice, "coding-worker", "Renamed");

    expect(second.id).toBe(first.id);
    expect(second.agentKey).toBe("coding-worker");
    expect(registrations.registerCalls).toHaveLength(2);
    await expect(directory.getRegistration(first.id)).resolves.toMatchObject({
      id: first.id,
      principalSubject: "alice",
      displayName: "Worker",
    });
  });

  it("does not let another principal claim the same agent key or registration id", async () => {
    const { directory } = setup();
    const aliceAgent = await directory.register(alice, "coding-worker");
    const bobAgent = await directory.register(bob, "coding-worker");

    expect(bobAgent.id).not.toBe(aliceAgent.id);
    expect(() => directory.bindPresence(aliceAgent.id, bob, "bob-connection"))
      .toThrow(AgentDirectoryError);
  });

  it("delegates registration lookup to the repository and rejects an unknown binding", async () => {
    const { registrations, directory } = setup();
    const record = await registrations.repository.register({
      principalSubject: "alice",
      agentKey: "external-worker",
    });
    expect(directory.getOnline(record.id)).toBeUndefined();
    await expect(directory.getRegistration(record.id)).resolves.toEqual(record);
    expect(directory.bindPresence(record.id, alice, "connection-1")).toMatchObject({
      agentId: record.id,
      principalSubject: "alice",
      connectionId: "connection-1",
      generation: 1,
    });
    expect(() => directory.bindPresence(
      "00000000-0000-4000-8000-000000009999",
      alice,
      "connection-2",
    )).toThrow(AgentDirectoryError);
  });

  it("denies a disabled registration", async () => {
    const { registrations, directory } = setup();
    const record = await directory.register(alice, "disabled-worker");
    registrations.records.set(record.id, { ...record, enabled: false });
    await directory.getRegistration(record.id);

    expect(() => directory.bindPresence(record.id, alice, "connection-1"))
      .toThrow(AgentDirectoryError);
  });
});

describe("createAgentDirectory presence fencing", () => {
  it("denies a different live connection but is idempotent on the current one", async () => {
    const { directory } = setup();
    const record = await directory.register(alice, "coding-worker");
    const first = directory.bindPresence(record.id, alice, "connection-1");

    expect(directory.bindPresence(record.id, alice, "connection-1")).toEqual(first);
    expect(() => directory.bindPresence(record.id, alice, "connection-2"))
      .toThrow(AgentDirectoryError);
    expect(directory.getByConnection("connection-2")).toBeUndefined();
  });

  it("denies a second agent identity on one live connection", async () => {
    const { directory } = setup();
    const first = await directory.register(alice, "worker-one");
    const second = await directory.register(alice, "worker-two");
    directory.bindPresence(first.id, alice, "connection-1");

    expect(() => directory.bindPresence(second.id, alice, "connection-1"))
      .toThrow(AgentDirectoryError);
    expect(directory.getByConnection("connection-1")?.agentId).toBe(first.id);
  });

  it("renews only from the exact current binding, before expiry", async () => {
    const { clock, directory } = setup();
    const record = await directory.register(alice, "coding-worker");
    const binding = directory.bindPresence(record.id, alice, "connection-1");

    clock.advance(500);
    const renewed = directory.renewPresence(binding);
    expect(renewed).toMatchObject({
      agentId: binding.agentId,
      connectionId: binding.connectionId,
      generation: binding.generation,
      expiresAt: clock.now() + 1_000,
    });

    expect(directory.renewPresence({ ...binding, connectionId: "connection-2" })).toBeUndefined();
    expect(directory.renewPresence({ ...binding, generation: binding.generation + 1 })).toBeUndefined();

    clock.advance(1_000);
    expect(directory.renewPresence(renewed ?? binding)).toBeUndefined();
    expect(directory.getOnline(record.id)).toBeUndefined();
  });

  it("treats expired presence as offline and lets a new generation take over", async () => {
    const { clock, directory } = setup();
    const record = await directory.register(alice, "coding-worker");
    const oldBinding = directory.bindPresence(record.id, alice, "connection-1");
    clock.advance(1_001);

    expect(directory.getOnline(record.id)).toBeUndefined();
    expect(directory.getByConnection("connection-1")).toBeUndefined();

    const newBinding = directory.bindPresence(record.id, alice, "connection-2");
    expect(newBinding.generation).toBeGreaterThan(oldBinding.generation);
    directory.releasePresence(oldBinding);

    expect(directory.getOnline(record.id)).toEqual(newBinding);
    expect(directory.getByConnection("connection-2")).toEqual(newBinding);
  });

  it("releases every binding for one connection and ignores stale releases", async () => {
    const { clock, directory } = setup();
    const first = await directory.register(alice, "worker-one");
    const second = await directory.register(alice, "worker-two");
    const firstBinding = directory.bindPresence(first.id, alice, "connection-1");
    const secondBinding = directory.bindPresence(second.id, alice, "connection-2");
    directory.releaseConnection("connection-1");

    expect(directory.getOnline(first.id)).toBeUndefined();
    expect(directory.getOnline(second.id)).toEqual(secondBinding);
    directory.releasePresence(firstBinding);
    expect(directory.getOnline(second.id)).toEqual(secondBinding);

    clock.advance(1_001);
    expect(directory.getOnline(second.id)).toBeUndefined();
  });
});
