import { it } from "vitest";
import { createMemoryDurableStorage } from "@persistence";
import { assertTypeManifestPinning, assertWorkGraphRevisions } from "./conformance/workGraph";

it("invalidates graph snapshots when grant-parent availability changes", async () => {
  const host = await createMemoryDurableStorage().acquire("graph", () => {});
  try {
    await assertWorkGraphRevisions(host);
  } finally { await host.release(); }
});

it("pins work manifests beyond session purge and host reacquisition", async () => {
  await assertTypeManifestPinning(createMemoryDurableStorage(), "manifest");
});
