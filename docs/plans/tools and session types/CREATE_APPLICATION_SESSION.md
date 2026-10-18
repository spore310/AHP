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

## Not current

`createApplicationHost` is not implemented. The caller still composes the catalogue, the tool map, and the factory. Authentication that can promote a connection to `admin` is not implemented. Hiding a tool is not execution control.
