import type { SessionConfigSchema } from "@microsoft/agent-host-protocol";
import { JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createSessionConfig, createSessionTypeCatalogue, SESSION_URI_PREFIX } from "@sessions";
import { ToolAccessLevel } from "@sessions/helpers/application";
import { defineApplicationSession } from "@sessions/helpers/application/define";
import { createSessionTypeToolMap } from "@sessions/helpers/application";
import { createMockProvider } from "@sessions/mock";
import type { ToolCatalogue, ToolContractDefinition } from "@tools";
import { createAHPServer, type AHPServerHandle } from "@websocket";

import { FrameLog, responseWithId } from "./helpers";

const schema: SessionConfigSchema = {
  type: "object",
  properties: { language: { type: "string", title: "Language" } },
};

const standardTool: ToolContractDefinition = {
  id: "11111111-1111-4111-8111-111111111111",
  key: "workspace.read-file",
  version: 1,
  name: "read_file",
  schemaDialect: "draft-07",
  inputSchema: { type: "object" },
};

const adminTool: ToolContractDefinition = {
  id: "33333333-3333-4333-8333-333333333333",
  key: "workspace.delete-file",
  version: 1,
  name: "delete_file",
  schemaDialect: "draft-07",
  inputSchema: { type: "object" },
};

const tools: ToolCatalogue = {
  get: (ref) => [standardTool, adminTool].find((tool) => tool.key === ref.key && tool.version === ref.version),
  list: () => [standardTool, adminTool],
  validateInput: () => ({ status: "valid" }),
  validateOutput: () => ({ status: "schema-not-declared" }),
};

const defined = defineApplicationSession({
  id: "22222222-2222-4222-8222-222222222222",
  key: "code.review",
  version: 1,
  providerId: "mock",
  configSchema: schema,
  config: createSessionConfig({
    schema,
    parser: z.object({ language: z.string().min(1).optional() }).strict(),
  }),
  tools: [
    { ref: { key: standardTool.key, version: standardTool.version }, access: ToolAccessLevel.Standard },
    { ref: { key: adminTool.key, version: adminTool.version }, access: ToolAccessLevel.Admin },
  ],
});

const hosts: AHPServerHandle[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.terminate();
  }
  for (const host of hosts.splice(0)) {
    await host.stop();
  }
});

describe("session type capacity", () => {
  it("accepts the header enum, hides admin tools, and rejects object or unmapped headers", async () => {
    const catalogue = createSessionTypeCatalogue({
      tools,
      types: [defined.registration],
    });
    const host = createAHPServer({
      host: "127.0.0.1",
      port: 0,
      sessions: {
        providers: [createMockProvider()],
        application: {
          catalogue,
          authorizedTools: createSessionTypeToolMap({ [defined.header]: defined.grants }),
        },
      },
    });
    hosts.push(host);
    const address = await host.start();
    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const opened = new WebSocket(`ws://127.0.0.1:${String(address.port)}/`);
      opened.once("open", () => {
        sockets.push(opened);
        resolve(opened);
      });
      opened.once("error", reject);
    });
    const frames = new FrameLog(socket);
    const send = (payload: unknown): void => {
      socket.send(JSON.stringify(payload));
    };

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        channel: "ahp-root://",
        clientId: "capacity",
        protocolVersions: ["1.0.0"],
        initialSubscriptions: ["ahp-root://"],
      },
    });
    await frames.waitFor(responseWithId(1));

    const accepted = `${SESSION_URI_PREFIX}capacity-accepted`;
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "createSession",
      params: {
        channel: accepted,
        config: { "x-ahp-session-type": defined.header },
      },
    });
    await expect(frames.waitFor(responseWithId(2))).resolves.toMatchObject({ id: 2, result: null });
    expect(host.sessions.getSessionSnapshot(accepted)?.state._meta).toMatchObject({
      "x-ahp-application": {
        sessionType: { key: defined.header, version: 1 },
        toolContracts: [{
          key: standardTool.key,
          version: standardTool.version,
          definition: { name: standardTool.name, inputSchema: standardTool.inputSchema },
        }],
      },
    });
    expect(host.sessions.getSessionToolManifest(accepted)?.toolContracts).toEqual([
      expect.objectContaining({ key: standardTool.key, version: standardTool.version }),
    ]);
    expect(JSON.stringify(host.sessions.getSessionSnapshot(accepted)?.state._meta)).not.toContain(adminTool.key);

    const objectChannel = `${SESSION_URI_PREFIX}capacity-object`;
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "createSession",
      params: {
        channel: objectChannel,
        config: { "x-ahp-session-type": { key: defined.header, version: 1 } },
      },
    });
    await expect(frames.waitFor(responseWithId(3))).resolves.toMatchObject({
      id: 3,
      error: { code: JsonRpcErrorCodes.InvalidParams },
    });
    expect(host.sessions.getSessionSnapshot(objectChannel)).toBeUndefined();

    const unmapped = `${SESSION_URI_PREFIX}capacity-unmapped`;
    send({
      jsonrpc: "2.0",
      id: 4,
      method: "createSession",
      params: {
        channel: unmapped,
        config: { "x-ahp-session-type": "code.unknown" },
      },
    });
    await expect(frames.waitFor(responseWithId(4))).resolves.toMatchObject({
      id: 4,
      error: { code: JsonRpcErrorCodes.InvalidParams },
    });
    expect(host.sessions.getSessionSnapshot(unmapped)).toBeUndefined();
  });
});
