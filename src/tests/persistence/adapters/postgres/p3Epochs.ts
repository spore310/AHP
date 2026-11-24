import assert from "node:assert/strict";
import { Pool } from "pg";
import { createPostgresAgentRegistrationRepository } from "@persistence/helpers/adapters/postgres/helpers/agentRegistrations";
import { acquirePostgresOwnership } from "@persistence/helpers/adapters/postgres/helpers/ownership";

/** Two pools contend for the same stable registration under one live ownership fence. */
export async function verifyAgentEpochs(connectionString: string): Promise<void> {
  const owner = await acquirePostgresOwnership(connectionString, "p0-conformance", () => {});
  const first = new Pool({ connectionString });
  const second = new Pool({ connectionString });
  try {
    const left = createPostgresAgentRegistrationRepository(first, undefined, () => owner);
    const right = createPostgresAgentRegistrationRepository(second, undefined, () => owner);
    const start = await left.register({ domainId: "epoch", principalSubject: "user", agentKey: "worker" });
    assert.equal(start.executionEpoch, "0");
    assert.ok(typeof left.bindExecution === "function" && typeof right.bindExecution === "function" && typeof right.setEnabled === "function");
    const calls = await Promise.allSettled([left.bindExecution(start), right.bindExecution(start)]);
    assert.equal(calls.filter((result) => result.status === "fulfilled").length, 1);
    const winner = await right.getById(start.id, "epoch");
    assert.ok(winner);
    assert.equal(winner.executionEpoch, "1");
    assert.equal((await right.setEnabled(start.id, "epoch", false)).executionEpoch, "2");
    await assert.rejects(left.bindExecution(winner));
    const disabled = await left.getById(start.id, "epoch");
    assert.ok(disabled);
    await assert.rejects(left.bindExecution(disabled));
    assert.equal((await right.setEnabled(start.id, "epoch", false)).executionEpoch, "2");
    const enabled = await right.setEnabled(start.id, "epoch", true);
    assert.equal(enabled.executionEpoch, "3");
    await assert.rejects(left.bindExecution({ ...enabled, principalSubject: "other" }));
    assert.equal((await left.bindExecution(enabled)).executionEpoch, "4");
  } finally {
    await Promise.all([first.end(), second.end()]);
    await owner.release();
  }
}
