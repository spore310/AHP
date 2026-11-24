import assert from "node:assert/strict";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { createMemoryDurableStorage, type DurableStorage } from "@persistence";
import type { StoredWork } from "@persistence/helpers/durability/workTypes";
import { mockProvider } from "@sessions/mock";
import { channel, createReviewHost, reviewWorkerKey } from "../../../examples/advanced/host";
import { createExamplePersistence, createExampleRegistrationState } from "../../../examples/advanced/persistence";
import { claimedLease, execution, openWorkClient } from "../../../examples/advanced/work";

it.each([["signal", "claim"], ["registry", "claim"], ["callback-only", "claim"], ["signal", "renew"], ["registry", "renew"]] as const)(
  "checks %s initial connection authority before committing a hosted %s", async (source, operation) => {
    const registrations = createExampleRegistrationState();
    const rows = new Map<string, StoredWork>();
    const underlying = createMemoryDurableStorage(rows, registrations.registrations);
    const entered = Promise.withResolvers<undefined>();
    const resume = Promise.withResolvers<undefined>();
    const revoke = new AbortController();
    let hold = true;
    const afterPreparation = vi.fn(async () => {
      if (hold) {
        entered.resolve(undefined);
        await resume.promise;
      }
    });
    const storage: DurableStorage = { async acquire(...args) {
      const host = await underlying.acquire(...args);
      return { ...host, work: { ...host.work, async claimPrepared(...claim) {
        if (operation === "claim") await afterPreparation();
        return host.work.claimPrepared(...claim);
      }, async renewPrepared(...renewal) {
        await afterPreparation();
        return host.work.renewPrepared(...renewal);
      } } };
    } };
    const persistence = { ...createExamplePersistence().provider, durability: storage, registrations: registrations.repository, dispose: registrations.dispose };
    const demo = createReviewHost("direct", { persistence, provider: mockProvider, durability: { storage, hostId: "seed-withdrawal" },
      initialAuthority: { prepare: ({ context }) => Promise.resolve({ scopes: [], allowGlobalSequence: true, validUntil: Date.now() + 60000,
        ...(source === "signal" ? { signal: revoke.signal } : source === "registry" ? { invalidation: "registry" as const } : {}),
        isCurrent: () => context.actor.principal.subject !== "junior" || !revoke.signal.aborted, release() {} }) } });
    const peers: Awaited<ReturnType<typeof openWorkClient>>[] = [];
    try {
      const { port } = await demo.host.start();
      await demo.provision();
      const url = `ws://127.0.0.1:${String(port)}`;
      const pm = await openWorkClient(url, "pm", "submit-review");
      peers.push(pm);
      const worker = await openWorkClient(url, "junior", "claim-review");
      peers.push(worker);
      const { agentId } = z.object({ agentId: z.uuid() }).parse(await worker.request("x-ahp/agents/register", { agentKey: reviewWorkerKey }));
      const ref = { kind: "session", id: channel };
      const { workId } = z.object({ workId: z.uuid() }).parse(await pm.request("x-ahp/work/submit", { session: ref, scope: [{ resource: ref, include: true }],
        targetAgentId: agentId, input: {}, kind: "code.review", requestKey: "initial-authority" }));
      const take = () => worker.request("x-ahp/work/claim", { session: ref });
      const lease = operation === "renew" ? claimedLease.parse(await take()).lease : undefined;
      const before = structuredClone(rows.get(workId));
      const outcome = lease ? worker.request("x-ahp/work/renew", execution(lease)) : take();
      if (source === "callback-only") {
        hold = false;
        resume.resolve(undefined);
        await expect(outcome).rejects.toThrow();
        expect(afterPreparation).not.toHaveBeenCalled();
      } else {
        await entered.promise;
        revoke.abort();
        if (source === "registry") demo.registry.invalidateExternal("withdrawn");
        resume.resolve(undefined);
        await expect(outcome).rejects.toThrow();
      }
      assert.ok(before);
      expect(rows.get(workId)).toEqual(before);
    } finally {
      resume.resolve(undefined);
      await Promise.allSettled(peers.map(({ client }) => client.shutdown()));
      await demo.stop();
    }
  });
