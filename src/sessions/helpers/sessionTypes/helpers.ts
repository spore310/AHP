import {
  CONTRACT_KEY_PATTERN,
  MAX_CONTRACT_VERSION,
  MAX_MANIFEST_BYTES,
  MAX_TOOLS_PER_TYPE,
  UUID_PATTERN,
  type ToolCatalogue,
  type ToolContractDefinition,
  type ToolContractRef,
} from "@tools";

import type {
  ApplicationSessionType,
  ResolvedSessionType,
  SessionTypeDefinition,
  SessionTypeRef,
} from "./types";
import { SessionTypeError } from "./types";

export interface SessionTypeCatalogue {
  list(): readonly SessionTypeDefinition[];
  resolveForCreation(ref: SessionTypeRef): ResolvedSessionType;
  resolveExisting(ref: SessionTypeRef): ResolvedSessionType;
}

export interface SessionTypeCatalogueOptions {
  readonly tools: ToolCatalogue;
  readonly types: readonly ApplicationSessionType[];
}

export function createSessionTypeCatalogue(
  options: SessionTypeCatalogueOptions,
): SessionTypeCatalogue {
  const byIdentity = new Map<string, StoredSessionType>();
  const seenIds = new Set<string>();

  for (const registration of options.types) {
    const definition = captureDefinition(registration.definition);
    assertIdentity(definition);
    if (seenIds.has(definition.id)) {
      throw new SessionTypeError("duplicate-revision", "Duplicate session type id.");
    }
    const identity = identityKey(definition);
    if (byIdentity.has(identity)) {
      throw new SessionTypeError("duplicate-revision", "Duplicate session type revision.");
    }
    const tools = resolveTools(options.tools, definition.tools);
    seenIds.add(definition.id);
    byIdentity.set(identity, {
      definition,
      tools,
      config: registration.config,
      enabledForCreation: registration.enabledForCreation,
    });
  }

  const resolve = (ref: SessionTypeRef, forCreation: boolean): ResolvedSessionType => {
    const found = byIdentity.get(`${ref.key}@${String(ref.version)}`);
    if (found === undefined) {
      throw new SessionTypeError("type-not-found", "Session type revision was not found.");
    }
    if (forCreation && !found.enabledForCreation) {
      throw new SessionTypeError("type-disabled", "Session type is not enabled for creation.");
    }
    return {
      definition: structuredClone(found.definition),
      tools: found.tools.map((tool) => structuredClone(tool)),
      config: found.config,
      enabledForCreation: found.enabledForCreation,
    };
  };

  return {
    list: (): readonly SessionTypeDefinition[] => [...byIdentity.values()]
      .map((registration) => structuredClone(registration.definition))
      .sort((left, right) => identityKey(left).localeCompare(identityKey(right))),
    resolveForCreation: (ref: SessionTypeRef): ResolvedSessionType => resolve(ref, true),
    resolveExisting: (ref: SessionTypeRef): ResolvedSessionType => resolve(ref, false),
  };
}

function captureDefinition(definition: SessionTypeDefinition): SessionTypeDefinition {
  return structuredClone(definition);
}

function assertIdentity(definition: SessionTypeDefinition): void {
  if (!UUID_PATTERN.test(definition.id) || !CONTRACT_KEY_PATTERN.test(definition.key)) {
    throw new SessionTypeError("invalid-definition", "Invalid session type identity.");
  }
  if (!Number.isSafeInteger(definition.version) || definition.version < 1 || definition.version > MAX_CONTRACT_VERSION) {
    throw new SessionTypeError("invalid-definition", "Invalid session type version.");
  }
  if (definition.providerId.length === 0) {
    throw new SessionTypeError("invalid-definition", "Invalid session type provider.");
  }
}

function resolveTools(
  catalogue: ToolCatalogue,
  refs: readonly ToolContractRef[],
): readonly ToolContractDefinition[] {
  if (refs.length > MAX_TOOLS_PER_TYPE) {
    throw new SessionTypeError("manifest-too-large", "Session type has too many tools.");
  }
  const seenRevisions = new Set<string>();
  const seenKeys = new Set<string>();
  const seenNames = new Set<string>();
  const resolved: ToolContractDefinition[] = [];

  for (const ref of refs) {
    const revision = `${ref.key}@${String(ref.version)}`;
    if (seenRevisions.has(revision)) {
      throw new SessionTypeError("duplicate-tool", "Duplicate tool revision in session type.");
    }
    if (seenKeys.has(ref.key)) {
      throw new SessionTypeError("duplicate-tool", "A session type cannot pin two versions of one tool.");
    }
    const tool = catalogue.get(ref);
    if (tool === undefined) {
      throw new SessionTypeError("missing-contract", "Session type references a missing tool contract.");
    }
    if (seenNames.has(tool.name)) {
      throw new SessionTypeError("duplicate-tool", "Resolved tool names must be unique in a session type.");
    }
    seenRevisions.add(revision);
    seenKeys.add(ref.key);
    seenNames.add(tool.name);
    resolved.push(structuredClone(tool));
  }

  resolved.sort((left, right) => left.key.localeCompare(right.key) || left.version - right.version);
  if (Buffer.byteLength(JSON.stringify(resolved)) > MAX_MANIFEST_BYTES) {
    throw new SessionTypeError("manifest-too-large", "Session type manifest is too large.");
  }
  return resolved;
}

function identityKey(definition: Pick<SessionTypeDefinition, "key" | "version">): string {
  return `${definition.key}@${String(definition.version)}`;
}

interface StoredSessionType {
  readonly definition: SessionTypeDefinition;
  readonly tools: readonly ToolContractDefinition[];
  readonly config: ApplicationSessionType["config"];
  readonly enabledForCreation: boolean;
}
