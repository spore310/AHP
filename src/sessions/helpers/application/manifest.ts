import type { ToolAnnotations } from "@microsoft/agent-host-protocol";

import { SessionTypeError } from "@sessions/helpers/sessionTypes";
import {
  MAX_MANIFEST_BYTES,
  TOOL_SCHEMA_DIALECT,
  type ToolContractDefinition,
  type ToolContractRef,
} from "@tools";

/** Issued manifest version. Clients ignore unknown versions. */
export const APPLICATION_SCHEMA_VERSION = 1;

/** One allowed contract as listed on a typed session. */
export interface IssuedToolContract {
  readonly id: string;
  readonly key: string;
  readonly version: number;
  readonly schemaDialect: typeof TOOL_SCHEMA_DIALECT;
  readonly definition: {
    readonly name: string;
    readonly title?: string;
    readonly description?: string;
    readonly inputSchema: Readonly<Record<string, unknown>>;
    readonly outputSchema?: Readonly<Record<string, unknown>>;
    readonly annotations?: ToolAnnotations;
  };
}

/** Server-authored list of the tools a typed session may advertise. */
export interface SessionToolManifest {
  readonly schemaVersion: typeof APPLICATION_SCHEMA_VERSION;
  readonly sessionType: {
    readonly id: string;
    readonly key: string;
    readonly version: number;
  };
  readonly toolContracts: readonly IssuedToolContract[];
}

/**
 * Projects the visible catalogue revisions into the snapshot manifest.
 *
 * The result lists schemas. It does not register an executor or an active client.
 */
export function projectSessionToolManifest(
  sessionType: { readonly id: string; readonly key: string; readonly version: number },
  tools: readonly ToolContractDefinition[],
  visible: readonly ToolContractRef[],
): SessionToolManifest {
  const allowed = new Set(visible.map((ref) => `${ref.key}@${String(ref.version)}`));
  const toolContracts = tools
    .filter((tool) => allowed.has(`${tool.key}@${String(tool.version)}`))
    .map((tool): IssuedToolContract => {
      return {
        id: tool.id,
        key: tool.key,
        version: tool.version,
        schemaDialect: TOOL_SCHEMA_DIALECT,
        definition: {
          name: tool.name,
          ...(tool.title === undefined ? {} : { title: tool.title }),
          ...(tool.description === undefined ? {} : { description: tool.description }),
          inputSchema: structuredClone(tool.inputSchema),
          ...(tool.outputSchema === undefined ? {} : { outputSchema: structuredClone(tool.outputSchema) }),
          ...(tool.annotations === undefined ? {} : { annotations: structuredClone(tool.annotations) }),
        },
      };
    });

  const manifest: SessionToolManifest = {
    schemaVersion: APPLICATION_SCHEMA_VERSION,
    sessionType: {
      id: sessionType.id,
      key: sessionType.key,
      version: sessionType.version,
    },
    toolContracts,
  };
  if (Buffer.byteLength(JSON.stringify(manifest)) > MAX_MANIFEST_BYTES) {
    throw new SessionTypeError("manifest-too-large", "Session tool manifest is too large.");
  }
  return manifest;
}
