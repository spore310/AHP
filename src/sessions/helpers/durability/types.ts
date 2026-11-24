import type { SessionState } from "@microsoft/agent-host-protocol";
import type { JsonObject } from "@persistence/helpers/durability/types";
export type PersistedSessionStateV1 = JsonObject & {
  readonly version: 1;
  readonly title: SessionState["title"];
  readonly isRead: boolean;
  readonly isArchived: boolean;
  readonly workingDirectories?: readonly string[];
};
