import { describe, expect, it } from "vitest";

import {
  ClientAccessRole,
  ToolAccessLevel,
  createSessionTypeToolMap,
  visibleTools,
} from "@sessions/helpers/application";

describe("session type tool map", () => {
  const grants = createSessionTypeToolMap({
    "code.review": [
      { ref: { key: "workspace.read-file", version: 1 }, access: ToolAccessLevel.Standard },
      { ref: { key: "workspace.apply-patch", version: 1 }, access: ToolAccessLevel.Admin },
    ],
  });

  it("hides admin tools from an anonymous client", () => {
    expect(visibleTools(grants.get("code.review") ?? [], ClientAccessRole.Anonymous)).toEqual([
      { key: "workspace.read-file", version: 1 },
    ]);
  });

  it("shows admin tools only to the admin role", () => {
    expect(visibleTools(grants.get("code.review") ?? [], ClientAccessRole.Admin)).toEqual([
      { key: "workspace.read-file", version: 1 },
      { key: "workspace.apply-patch", version: 1 },
    ]);
  });
});
