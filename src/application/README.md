# Application

Inert example session policy for the default host. It lists allowed tool contracts. It does not read files, write files, or run a model.

## Files

| File | Responsibility |
| ---- | -------------- |
| `constants.ts` | Stable revision ids and session-type keys. |
| `helpers.ts` | Baseline session catalogue and bounded in-memory host action registration. |
| `index.ts` | Public exports. |

## API

`createBaselineSessionApplication()` returns a fresh `SessionApplicationOptions`. The default type is `code-review@1`, which lists `workspace.read-file@1` and `workspace.search@1`. `coding@1` also lists `workspace.write-file@1`. Language settings stay in the application config. The mock provider still receives `{}`.

Importing this module does not open a port. `src/index.ts` calls this factory for the CLI host; callers may still compose an explicitly untyped host by omitting `application`.

## Usage

```ts
import { createBaselineSessionApplication } from "@application";
import { createApplicationSession } from "@sessions";
import { mockProvider } from "@sessions/mock";
import { createAHPServer } from "@websocket";

const host = createAHPServer({
  host: "127.0.0.1",
  port: 0,
  sessions: {
    providers: [mockProvider],
    application: createBaselineSessionApplication(),
  },
});
await host.start();
// Native create with no selector uses code-review@1.
await host.sessions.createSession({ channel: "ahp-session:/review" });
// Application creation uses the server-authored header string, never an object.
await createApplicationSession(host.sessions, {
  channel: "ahp-session:/coding",
  type: "coding",
  config: { language: "typescript" },
});
const allowed = host.sessions.getSessionToolManifest("ahp-session:/coding");
console.log(allowed?.toolContracts.map((contract) => contract.definition.name));
await host.stop();
```

A native SDK client selects the same type with `config: { "x-ahp-session-type": "coding" }`. Its ordinary session snapshot carries `_meta["x-ahp-application"]`. `serverTools` stays absent; no client is advertised until that client registers tools.

For registering a local implementation and calling it from another client, use the [public tool client adapter](../toolClient/README.md). Discovering a descriptor alone does not install a filesystem implementation.

## Testing

[`src/tests/application.test.ts`](../tests/application.test.ts) covers fresh catalogues, separate application/provider config, two running hosts with different defaults and the same session URI, and terminal stop behavior.

## In-memory host action

`createInMemoryEchoRegistration()` returns an inert `ServerToolRegistration` for
`example.echo@1`. It accepts `{ text: string }` (at most 4096 characters) and returns
`{ value: text }`, with strict object schemas, registration/source revision 1 and
server/host implementation `application.echo.v1`. It has no optional preparation
or external effects. The baseline application does not install this registration.

```ts
import { createInMemoryEchoRegistration } from "@application";
import type { ServerToolBrokerOptions } from "@toolExecution/server";

// These ports are application-owned canonical authority, never request data.
const registration = createInMemoryEchoRegistration();
const serverTools: ServerToolBrokerOptions = {
  registry, policies, executor, resolve, registrations: [registration],
};
// Add registration.definition to the authorized session catalogue, install
// caller invoke and exact host execute grants, then pass serverTools as
// createAHPServer({ ...hostOptions, serverToolExecution: serverTools }).
```

The embedding application supplies `registry`, `policies`, `executor`, `resolve`
and `hostOptions`. Registration alone creates no permissions or network listeners.
The executor requires an explicit trusted identity, generation and current/pure
fence callbacks. See [tool execution](../toolExecution/README.md#host-controlled-actions).
