import { it } from "vitest";
import { createMemoryDurableStorage } from "@persistence";
import { assertDurableResourceConformance } from "./conformance/helpers";

it("runs the common resource CAS and retirement checks against memory", () => assertDurableResourceConformance(createMemoryDurableStorage(), "resource-conformance"));
