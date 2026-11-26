import { describe, it } from "vitest";
import { createMemoryDurableStorage } from "@persistence";
import { assertHostCoordinationConformance } from "../persistence/conformance/hostCoordination";

describe("host coordination", () => {
  it("H2-08 the in-memory adapter implements the portable membership, ownership and revocation transitions", async () => {
    await assertHostCoordinationConformance(() => {
      const storage = createMemoryDurableStorage();
      return Promise.resolve(() => storage);
    });
  });
});
