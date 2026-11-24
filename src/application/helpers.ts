import type { SessionConfigSchema } from "@microsoft/agent-host-protocol";
import { z } from "zod";
import type { PolicyAdmission } from "@authorization";
import { createPolicyFactory, definePolicyNamespace, type PolicyDefinitionBase, type PolicyNamespace } from "@authorization/policies";

import {
  createSessionConfig,
  createSessionTypeCatalogue,
  createSessionTypeToolMap,
  defineApplicationSession,
  ToolAccessLevel,
  type SessionApplicationOptions,
} from "@sessions";
import { createToolCatalogue, defineToolContract } from "@tool";
import { ToolAction } from "@tool/execution";
import { createServerToolRegistration, type ServerToolRegistration } from "@tool/server";

import {
  CODE_REVIEW_ID,
  CODE_REVIEW_KEY,
  CODING_ID,
  CODING_KEY,
  READ_FILE_ID,
  SEARCH_ID,
  WRITE_FILE_ID,
} from "./constants";

const languageSchema: SessionConfigSchema = {
  type: "object",
  properties: { language: { type: "string", title: "Language" } },
};

const objectSchema = {
  type: "object",
  additionalProperties: false,
  properties: { path: { type: "string", minLength: 1 } },
  required: ["path"],
} as const;

export function createExamplePolicyAdmission(mode: "direct" | "namespace", definitions: readonly PolicyDefinitionBase[]): {
  readonly admitted: PolicyAdmission;
  readonly namespaces: readonly PolicyNamespace[];
} {
  const refs = definitions.map(({ id, revision }) => ({ id, revision }));
  if (mode === "direct") return { admitted: { policies: refs, namespaces: [] }, namespaces: [] };
  const shared = definePolicyNamespace({ name: "example.shared", revision: 1, policies: definitions, resolve: () => refs });
  const triage = definePolicyNamespace({ name: "example.triage", revision: 1, policies: [],
    includes: [{ name: shared.name, revision: shared.revision }], resolve: () => refs });
  return { admitted: { policies: [], namespaces: [{ name: triage.name, revision: triage.revision }] }, namespaces: [shared, triage] };
}

/** Explicit application vocabulary and mandatory provider consent, with empty initial grants. */
export function createScopedToolPolicyExample(mode: "direct" | "namespace") {
  const tools = { id: "example.tools", revision: 1, challenge: { required: false }, operations: {
    discover: { actor: { mode: "roles", actors: { user: { anyOf: ["maintainer", "triage"] }, agent: { anyOf: ["reader"] } } }, reveal: true },
    invoke: { actor: { mode: "roles", actors: { user: { anyOf: ["maintainer"] }, agent: { anyOf: ["reader"] } } } },
  } } satisfies PolicyDefinitionBase;
  const provider = { id: "example.provider", revision: 1, challenge: { required: false }, operations: {
    discover: { actor: { mode: "direct-grant", actors: ["user", "agent"] }, reveal: true },
    invoke: { actor: { mode: "direct-grant", actors: ["user", "agent"] }, requiredPermissions: ["example-provider-consent"] },
  } } satisfies PolicyDefinitionBase;
  const { admitted, namespaces } = createExamplePolicyAdmission(mode, [tools]);
  const sessionType = { key: "example.triage", version: 1 };
  const providerId = "mock";
  const mandatory = [{ id: provider.id, revision: provider.revision }];
  return { sessionType, providerId, admitted, mandatory,
    policies: createPolicyFactory({ policies: [tools, provider], namespaces, bindings: [{ sessionType, providerId, admitted, mandatory }] }),
    seniorOwner: { domainId: "example", subject: "senior" },
    juniorAgent: { kind: "agent" as const, principal: { domainId: "example", subject: "junior" }, agentId: "junior-agent" },
    projectManager: { kind: "user" as const, principal: { domainId: "example", subject: "pm" } },
    roles: { senior: ["maintainer"], juniorAgent: ["reader"], projectManager: ["triage"] },
  };
}

/** Pure bounded example. Registration grants no authority and installs no runtime. */
export function createInMemoryEchoRegistration(): ServerToolRegistration {
  const definition = defineToolContract({ id: "11111111-1111-4111-8111-111111111114", key: "example.echo", version: 1,
    name: "echo", schemaDialect: "draft-07", description: "Return a bounded in-memory text value.",
    inputSchema: { type: "object", properties: { text: { type: "string", maxLength: 4096 } }, required: ["text"], additionalProperties: false },
    outputSchema: { type: "object", properties: { value: { type: "string", maxLength: 4096 } }, required: ["value"], additionalProperties: false } });
  class Echo extends ToolAction<{ readonly text: string }, { readonly value: string }> {
    override execute(input: { readonly text: string }) {
      return { value: input.text };
    }
  }
  return createServerToolRegistration({ definition, revision: 1, source: { id: "application.in-memory-echo", revision: 1 },
    implementation: { location: "server", suppliedBy: "server", implementation: "host", implementationId: "application.echo.v1" }, create: () => new Echo() });
}

/**
 * Builds a fresh typed-host policy for the example server.
 *
 * The contracts describe allowed client tools. They do not read or write files.
 * Each call returns new catalogue runtimes, so two hosts do not share records.
 */
export function createBaselineSessionApplication(): SessionApplicationOptions {
  const readFile = defineToolContract({
    id: READ_FILE_ID,
    key: "workspace.read-file",
    version: 1,
    name: "read_file",
    schemaDialect: "draft-07",
    description: "Read a file through an authorized client implementation.",
    inputSchema: objectSchema,
  });
  const search = defineToolContract({
    id: SEARCH_ID,
    key: "workspace.search",
    version: 1,
    name: "search_files",
    schemaDialect: "draft-07",
    description: "Search files through an authorized client implementation.",
    inputSchema: objectSchema,
  });
  const writeFile = defineToolContract({
    id: WRITE_FILE_ID,
    key: "workspace.write-file",
    version: 1,
    name: "write_file",
    schemaDialect: "draft-07",
    description: "Write a file through an authorized client implementation.",
    inputSchema: objectSchema,
    outputSchema: { type: "object", additionalProperties: false, properties: {} },
  });
  const tools = createToolCatalogue({ definitions: [readFile, search, writeFile] });
  const config = createSessionConfig({
    schema: languageSchema,
    parser: z.object({ language: z.string().min(1).default("typescript") }).strict(),
  });
  const review = defineApplicationSession({
    id: CODE_REVIEW_ID,
    key: CODE_REVIEW_KEY,
    version: 1,
    providerId: "mock",
    configSchema: languageSchema,
    config,
    tools: [
      { ref: { key: readFile.key, version: 1 }, access: ToolAccessLevel.Standard },
      { ref: { key: search.key, version: 1 }, access: ToolAccessLevel.Standard },
    ],
  });
  const coding = defineApplicationSession({
    id: CODING_ID,
    key: CODING_KEY,
    version: 1,
    providerId: "mock",
    configSchema: languageSchema,
    config,
    tools: [
      { ref: { key: readFile.key, version: 1 }, access: ToolAccessLevel.Standard },
      { ref: { key: search.key, version: 1 }, access: ToolAccessLevel.Standard },
      { ref: { key: writeFile.key, version: 1 }, access: ToolAccessLevel.Standard },
    ],
  });

  return {
    catalogue: createSessionTypeCatalogue({
      tools,
      types: [review.registration, coding.registration],
    }),
    defaultType: { key: CODE_REVIEW_KEY, version: 1 },
    authorizedTools: createSessionTypeToolMap({
      [review.header]: review.grants,
      [coding.header]: coding.grants,
    }),
  };
}
