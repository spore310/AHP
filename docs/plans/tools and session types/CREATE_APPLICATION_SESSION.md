# createApplicationSession

Status: **Current behavior.** `defineApplicationSession` and `createApplicationSession` exist. Authentication does not.

## What a caller writes

```ts
const review = defineApplicationSession({
  id: "22222222-2222-4222-8222-222222222222",
  key: "code.review",
  version: 1,
  providerId: "mock",
  configSchema: languageSchema,
  config: languageConfig,
  tools: [
    { ref: { key: "workspace.read-file", version: 1 }, access: "standard" },
    { ref: { key: "workspace.apply-patch", version: 1 }, access: "admin" },
  ],
});

const catalogue = createSessionTypeCatalogue({
  tools: toolCatalogue,
  types: [review.registration],
});

const factory = createSessionsFactory({
  providers: [mockProvider],
  application: {
    catalogue,
    authorizedTools: createSessionTypeToolMap({ [review.header]: review.grants }),
  },
});

await createApplicationSession(factory, {
  channel: "ahp-session:/review-1",
  type: review.header,
  config: { language: "typescript" },
});
```

`type` is the server-authored header enum value. It is not an object and not a client-invented key. The map for that header decides which tools are visible. An anonymous caller sees `standard` tools only. Admin tools appear in snapshot metadata only when server code sets the role to `admin`.

The helper calls `factory.createSession`. It does not build a WebSocket frame, choose a provider that can disagree with the type, or compile schemas.

The created snapshot lists the visible contracts under `_meta["x-ahp-application"].toolContracts`, including input schemas. `factory.getSessionToolManifest(channel)` returns that same list and does not allocate a sequence number. A client advertises a subset of those contracts with `session/activeClientSet`, using descriptors from `toAhpToolDefinition`. A different contract or schema is rejected and does not change the session.

`createBaselineSessionApplication()` supplies `code-review@1` and `coding@1` for the example host. Those contracts do not read or write files.

## Not current

`createApplicationHost` is not implemented. Authentication that can promote a connection to `admin` is not implemented. Hiding or admitting a tool is not execution control.
