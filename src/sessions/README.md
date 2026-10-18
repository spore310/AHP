# Sessions

The session engine. A `SessionsFactory` owns a provider registry, an in-memory
session store, a state reducer, and a host-shared action-sequence allocator. It
exposes creation, snapshots, the agent catalogue, and two event seams a
connection layer subscribes to.

It is **AHP-aware but transport-agnostic**: it speaks protocol parameters,
action envelopes, and snapshots, but imports no network or JSON-RPC code. A
*provider* here means an **agent backend** (`SessionProvider`), not a
client-connection adapter; see
[`docs/plans/ProvidersPlan.md`](../../docs/plans/ProvidersPlan.md).

## Files

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | The contracts: `SessionProvider`, `SessionConfigContract`, `SessionBackend`, `SessionRegistry`, `SessionsFactory(Options)`, diagnostics, and snapshots. |
| `constants.ts` | Channel URIs, the default title, mirrored protocol literals, and the generic start-failure payload. |
| `index.ts` | Public surface for the sessions capability. |
| `createSession/types.ts` | See [`createSession/README.md`](createSession/README.md). |
| `createSession/helpers.ts` | See [`createSession/README.md`](createSession/README.md). |
| `createSession/index.ts` | See [`createSession/README.md`](createSession/README.md). |
| `helpers/configuration/types.ts` | `CreateSessionConfigInput` for `createSessionConfig`. |
| `helpers/configuration/helpers.ts` | `createSessionConfig`: clone a descriptor and bind a runtime parser. |
| `helpers/configuration/index.ts` | Re-exports `createSessionConfig`. |
| `helpers/factory/helpers.ts` | `createSessionsFactory`: wiring, event delivery, and disposal. |
| `helpers/factory/index.ts` | Re-exports `createSessionsFactory`. |
| `helpers/registry/helpers.ts` | `createInMemorySessionRegistry`: the live-session store. |
| `helpers/registry/index.ts` | Re-exports the registry factory. |
| `helpers/sequence/types.ts` | `ActionSequence`: `next()` / non-allocating `current()`. |
| `helpers/sequence/helpers.ts` | `createActionSequence`, `createSequenceAllocator`, and the legacy allocator adapter. |
| `helpers/sequence/index.ts` | Re-exports the sequence port. |
| `helpers/actions/types.ts` | Runtime schemas for client session actions and `clientSeq`. |
| `helpers/actions/helpers.ts` | Validation and the baseline support policy for client session actions. |
| `helpers/actions/index.ts` | Re-exports action validation. |
| `helpers/state/helpers.ts` | Initial state, `applySessionAction` (reducer + envelope), and `buildSessionSnapshot`. |
| `helpers/state/index.ts` | Re-exports the state helpers. |
| `helpers/summary/helpers.ts` | `buildSessionSummary` and catalogue field diffs. |
| `helpers/summary/index.ts` | Re-exports the summary helpers. |
| `helpers/errors/helpers.ts` | The error taxonomy: `SessionsError`, `SessionsDisposingError`, `SessionConfigError`, `SessionStartError`. |
| `helpers/errors/index.ts` | Re-exports the error classes. |
| `mock/helpers.ts` | `createMockProvider` / `mockProvider`: deterministic in-process provider. |
| `mock/types.ts` | `MockProviderOptions` (`failCreation`). |
| `mock/index.ts` | Re-exports the mock provider. |

## API

`createSessionsFactory(options)` returns a `SessionsFactory`:

- `createSession(params: unknown): Promise<void>` — validate, register, emit
  `root/sessionAdded`, then settle with `session/ready` or
  `session/creationFailed`.
- `getSessionSnapshot(sessionUri): SessionSnapshot | undefined`
- `listSessionSnapshots(): SessionSnapshot[]`
- `getCurrentServerSeq(): number`
- `listAgents(): AgentInfo[]`
- `dispatchAction({ channel, clientSeq, action, clientId }): ActionEnvelope` —
  validate the client action, then apply a supported baseline mutation through
  the protocol reducer. Missing targets throw `SessionsError` with
  `SessionNotFound`. Valid-but-unsupported pinned actions are not reduced and
  do not emit an accepted envelope.
- `onCatalogueNotification(listener): () => void`
- `onSessionEnvelope(listener): () => void`
- `dispose(): Promise<void>`

Options: `providers` (required), `defaultProviderId`, `now`, `sequence`,
`nextServerSeq` (legacy adapter), `registryFactory`, `onDiagnostic`.

Errors: `SessionsError`, `SessionsDisposingError`, `SessionConfigError`,
`SessionStartError`. Sequence: `createActionSequence`, `createSequenceAllocator`.
Schema: `sessionUriSchema`, `createSessionParamsSchema`.

## 5-Minute Usage

Create a factory with the built-in mock provider and create one session:

```ts
import { createSessionsFactory, mockProvider } from "@sessions";

const factory = createSessionsFactory({ providers: [mockProvider] });

factory.onCatalogueNotification((notification) => {
  console.log(notification.method); // "root/sessionAdded"
});

await factory.createSession({ channel: "ahp-session:/demo-1" });

const snapshot = factory.getSessionSnapshot("ahp-session:/demo-1");
console.log(snapshot?.state.lifecycle); // "ready"

await factory.dispose();
```

## Intermediate Usage

Implement a provider. A provider owns the agent backend, advertises an
`agentInfo`, and may expose a configuration contract. It never touches the wire:

```ts
import { createActionSequence, SessionConfigError, type SessionProvider } from "@sessions";

const provider: SessionProvider = {
  providerId: "local",
  agentInfo: { provider: "local", displayName: "Local", description: "", models: [] },
  config: {
    schema: { type: "object", additionalProperties: false, properties: {} },
    parse: (config) => {
      if (Object.keys(config).length > 0) {
        throw new SessionConfigError("local accepts no configuration");
      }
      return {};
    },
  },
  startSession: async ({ sessionUri }) => ({
    dispose: () => {
      // release whatever the backend holds for sessionUri
    },
  }),
};

const factory = createSessionsFactory({
  providers: [provider],
  defaultProviderId: "local",
  now: () => new Date("2026-01-01T00:00:00.000Z"),
  sequence: createActionSequence(100),
  onDiagnostic: (diagnostic) => logger.warn(diagnostic),
});
```

## Advanced Usage

Share one sequence stream across channels, and observe envelopes for broadcast.
Inject the same allocator into anything else that publishes to the connection's
action stream so sequence numbers stay monotonic and gap-free:

```ts
import {
  createActionSequence,
  createSessionsFactory,
  mockProvider,
  ROOT_CHANNEL_URI,
} from "@sessions";

const sequence = createActionSequence();
const factory = createSessionsFactory({ providers: [mockProvider], sequence });

factory.onSessionEnvelope((envelope) => {
  // envelope: { channel, action, serverSeq, origin }
  broadcastToSubscribers(envelope.channel, { method: "action", params: envelope });
});

await factory.createSession({ channel: "ahp-session:/shared-1" });
// Root catalogue events target the root channel and never consume the sequence:
// ROOT_CHANNEL_URI === "ahp-root://"
```

Disposal is race-safe: a backend still starting when `dispose()` begins is not
awaited. When it resolves it detects the cleared registry, releases itself
detached, and reports a sanitized `lateBackendDisposeFailed` diagnostic rather
than publishing a stale `session/ready`.

## Caveats

- **`SessionBackend` is `{ dispose() }` only.** There is no prompt/stream I/O
  contract yet; session turns are out of scope. A future backend contract must
  be added deliberately.
- **Mirrored protocol literals.** The protocol package declares its
  discriminants as ambient `const enum`s, which this project's
  `verbatimModuleSyntax` cannot read as values (TS2748). `constants.ts` mirrors
  them, pins each to the protocol type, and
  [`src/tests/sessions/compliance.test.ts`](../tests/sessions/compliance.test.ts)
  checks the mirrors against the package's runtime enums. Never read a
  `const enum` member directly here.
- **Baseline client actions.** This host applies `session/titleChanged`,
  `session/isReadChanged`, and `session/isArchivedChanged`. The other pinned
  client-dispatchable session actions are validated and rejected without a
  reducer application or accepted envelope. MCP, tools, working-directory, and
  mutable-config behavior are not implemented here.
- **`applySessionAction` is the only mutation path.** State changes only through
  the protocol reducer; the sequence comes from the injected port, never from
  the record. `getCurrentServerSeq()` reads `sequence.current()` even after
  disposal or an empty registry.
- **Snapshots and delivered events are `structuredClone`d** per consumer, so an
  in-process caller cannot mutate authoritative state or affect another
  observer.
- **Listener and diagnostic throws are swallowed.** A broken observer must not
  veto the caller; operational diagnostics belong to the composition root.
- **Disposal is single-flight and reusable.** Concurrent/repeated `dispose()`
  calls share one completion; the factory accepts sessions again once it
  settles. While disposal is in flight, `createSession` rejects with
  `SessionsDisposingError`.
- **Construction is strict.** An empty provider list, an empty `providerId`, a
  duplicate `providerId`, or an unregistered `defaultProviderId` throws at
  factory construction.
- **Configuration is parsed before registration.** Invalid `createSession.config`
  creates no record and never reaches the provider. With no config contract, any
  non-empty config is rejected.
- **Only the first working directory is kept.** No agent advertises multiple
  working directories yet.

## Testing

| Test | Pins |
| ---- | ---- |
| [`src/tests/sessions/configuration.test.ts`](../tests/sessions/configuration.test.ts) | `createSessionConfig` descriptor protection, parser defaults, required/type/enum/unknown-key rejection, and sanitized unexpected parser failures. |
| [`src/tests/sessions/factory.test.ts`](../tests/sessions/factory.test.ts) | Construction guards, queries, listener unsubscribe, snapshot/observer isolation, and the full disposal lifecycle including late backends and reused URIs. |
| [`src/tests/sessions/dispatch.test.ts`](../tests/sessions/dispatch.test.ts) | Missing-target errors, malformed title/read/archive payloads, `clientSeq` non-coercion, unsupported actions, sequence cursor, and summary/count projections. |
| [`src/tests/sessions/compliance.test.ts`](../tests/sessions/compliance.test.ts) | Protocol-literal mirrors against the package runtime enums, catalogue/state conformance through the protocol reducer, and the single gap-free action sequence. |
| [`src/tests/sessions/createSession.test.ts`](../tests/sessions/createSession.test.ts) | See [`createSession/README.md`](createSession/README.md). |

## Related Documentation

- [`src/sessions/createSession/README.md`](createSession/README.md) — the
  create-time contract.
- [`docs/architecture/capabilities.md`](../../docs/architecture/capabilities.md) —
  where sessions sit in the capability map.
- [`docs/technical/runtime-lifecycles.md`](../../docs/technical/runtime-lifecycles.md)
  — session lifecycle and disposal semantics.
- [`docs/plans/ProvidersPlan.md`](../../docs/plans/ProvidersPlan.md) — the
  intended backend/AHP wiring (target state).
