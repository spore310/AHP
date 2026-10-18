import type { ClientSessionAction } from "@microsoft/agent-host-protocol";
import { z } from "zod";

import {
  ACTION_TYPE_SESSION_ACTIVE_CLIENT_REMOVED,
  ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET,
  ACTION_TYPE_SESSION_CONFIG_CHANGED,
  ACTION_TYPE_SESSION_CUSTOMIZATION_TOGGLED,
  ACTION_TYPE_SESSION_IS_ARCHIVED_CHANGED,
  ACTION_TYPE_SESSION_IS_READ_CHANGED,
  ACTION_TYPE_SESSION_MCP_SERVER_BACKGROUND_REQUESTED,
  ACTION_TYPE_SESSION_MCP_SERVER_START_REQUESTED,
  ACTION_TYPE_SESSION_MCP_SERVER_STOP_REQUESTED,
  ACTION_TYPE_SESSION_TITLE_CHANGED,
  ACTION_TYPE_SESSION_WORKING_DIRECTORY_REMOVED,
  ACTION_TYPE_SESSION_WORKING_DIRECTORY_REPLACED,
  ACTION_TYPE_SESSION_WORKING_DIRECTORY_SET,
  CUSTOMIZATION_ENABLEMENT_GLOBAL,
  CUSTOMIZATION_ENABLEMENT_SESSION,
  CUSTOMIZATION_ENABLEMENT_WORKSPACE,
  CUSTOMIZATION_TYPE_PLUGIN,
} from "@sessions/constants";

/**
 * JSON number that is a non-negative safe integer.
 *
 * No coercion: strings, booleans, null, fractions, and unsafe integers fail.
 */
export const clientSeqSchema = z
  .number()
  .refine((value: number): boolean => Number.isSafeInteger(value) && value >= 0, {
    message: "clientSeq must be a non-negative safe integer",
  });

const jsonSchemaPropertySchema = z.custom<object>(
  (value): value is object => typeof value === "object" && value !== null && !Array.isArray(value),
);

const toolSchemaObject = z.object({
  type: z.literal("object"),
  properties: z.record(z.string(), jsonSchemaPropertySchema).optional(),
  required: z.array(z.string()).optional(),
});

const toolDefinitionSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: toolSchemaObject.optional(),
  outputSchema: toolSchemaObject.optional(),
  annotations: z.object({
    title: z.string().optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  }).optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
});

const customizationEnablementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal(CUSTOMIZATION_ENABLEMENT_GLOBAL), enabled: z.boolean() }),
  z.object({
    kind: z.literal(CUSTOMIZATION_ENABLEMENT_WORKSPACE),
    uri: z.string().min(1),
    enabled: z.boolean(),
  }),
  z.object({ kind: z.literal(CUSTOMIZATION_ENABLEMENT_SESSION), enabled: z.boolean() }),
]);

const sessionTitleChangedActionSchema = z.object({
  type: z.literal(ACTION_TYPE_SESSION_TITLE_CHANGED),
  title: z.string(),
});

const sessionIsReadChangedActionSchema = z.object({
  type: z.literal(ACTION_TYPE_SESSION_IS_READ_CHANGED),
  isRead: z.boolean(),
});

const sessionIsArchivedChangedActionSchema = z.object({
  type: z.literal(ACTION_TYPE_SESSION_IS_ARCHIVED_CHANGED),
  isArchived: z.boolean(),
});

const clientPluginCustomizationSchema = z.object({
  type: z.literal(CUSTOMIZATION_TYPE_PLUGIN),
  id: z.string().min(1),
  uri: z.string().min(1),
  name: z.string().min(1),
  nonce: z.string().optional(),
  version: z.string().optional(),
  clientId: z.string().optional(),
  enablement: z.array(customizationEnablementSchema).optional(),
  childEnablement: z.record(z.string(), z.array(customizationEnablementSchema)).optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
});

const sessionActiveClientSetActionSchema = z.object({
  type: z.literal(ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET),
  activeClient: z.object({
    clientId: z.string().min(1),
    displayName: z.string().optional(),
    tools: z.array(toolDefinitionSchema),
    customizations: z.array(clientPluginCustomizationSchema).optional(),
  }),
});

const sessionActiveClientRemovedActionSchema = z.object({
  type: z.literal(ACTION_TYPE_SESSION_ACTIVE_CLIENT_REMOVED),
  clientId: z.string().min(1),
});

const sessionWorkingDirectorySetActionSchema = z.object({
  type: z.literal(ACTION_TYPE_SESSION_WORKING_DIRECTORY_SET),
  directory: z.string().min(1),
});

const sessionWorkingDirectoryRemovedActionSchema = z.object({
  type: z.literal(ACTION_TYPE_SESSION_WORKING_DIRECTORY_REMOVED),
  directory: z.string().min(1),
});

const sessionWorkingDirectoryReplacedActionSchema = z.object({
  type: z.literal(ACTION_TYPE_SESSION_WORKING_DIRECTORY_REPLACED),
  directory: z.string().min(1),
  replacement: z.string().min(1),
});

const sessionCustomizationToggledActionSchema = z.object({
  type: z.literal(ACTION_TYPE_SESSION_CUSTOMIZATION_TOGGLED),
  id: z.string().min(1),
  enablement: z.array(customizationEnablementSchema),
});

const sessionMcpServerStartRequestedActionSchema = z.object({
  type: z.literal(ACTION_TYPE_SESSION_MCP_SERVER_START_REQUESTED),
  id: z.string().min(1),
});

const sessionMcpServerStopRequestedActionSchema = z.object({
  type: z.literal(ACTION_TYPE_SESSION_MCP_SERVER_STOP_REQUESTED),
  id: z.string().min(1),
});

const sessionMcpServerBackgroundRequestedActionSchema = z.object({
  type: z.literal(ACTION_TYPE_SESSION_MCP_SERVER_BACKGROUND_REQUESTED),
  id: z.string().min(1),
});

const sessionConfigChangedActionSchema = z.object({
  type: z.literal(ACTION_TYPE_SESSION_CONFIG_CHANGED),
  config: z.record(z.string(), z.unknown()),
  replace: z.boolean().optional(),
});

/**
 * Runtime schemas for the thirteen client-dispatchable session actions.
 *
 * Unknown additive fields are stripped. Known fields are not coerced.
 */
export const clientSessionActionSchema = z.discriminatedUnion("type", [
  sessionTitleChangedActionSchema,
  sessionIsReadChangedActionSchema,
  sessionIsArchivedChangedActionSchema,
  sessionActiveClientSetActionSchema,
  sessionActiveClientRemovedActionSchema,
  sessionWorkingDirectorySetActionSchema,
  sessionWorkingDirectoryRemovedActionSchema,
  sessionWorkingDirectoryReplacedActionSchema,
  sessionCustomizationToggledActionSchema,
  sessionMcpServerStartRequestedActionSchema,
  sessionMcpServerStopRequestedActionSchema,
  sessionMcpServerBackgroundRequestedActionSchema,
  sessionConfigChangedActionSchema,
]);

export type ParsedClientSessionAction = z.infer<typeof clientSessionActionSchema>;

type AhpAssignableTo<TAhpValue, TSchemaValue> = [TAhpValue] extends [TSchemaValue] ? true : false;
type AhpLinked<TCheck extends true> = TCheck;

/**
 * Compile-time inventory of pinned client-dispatchable session actions.
 *
 * Fails when the protocol package adds or removes a client session action this
 * baseline has not classified as supported or valid-but-unsupported.
 */
export type ClientSessionActionConformance = [
  AhpLinked<AhpAssignableTo<ClientSessionAction["type"], ParsedClientSessionAction["type"]>>,
  AhpLinked<AhpAssignableTo<ParsedClientSessionAction["type"], ClientSessionAction["type"]>>,
];
