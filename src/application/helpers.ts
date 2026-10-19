import type { SessionConfigSchema } from "@microsoft/agent-host-protocol";
import { z } from "zod";

import {
  createSessionConfig,
  createSessionTypeCatalogue,
  createSessionTypeToolMap,
  defineApplicationSession,
  ToolAccessLevel,
  type SessionApplicationOptions,
} from "@sessions";
import { createToolCatalogue, defineToolContract } from "@tools";

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
