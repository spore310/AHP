# Sessions

The session engine. A `SessionsFactory` owns a provider registry, an in-memory
session store, a state reducer, and a host-shared action-sequence allocator. It
exposes creation, snapshots, the agent catalogue, and two event seams a
connection layer subscribes to.

It is **AHP-aware but transport-agnostic**: it speaks protocol parameters,
action envelopes, and snapshots, but imports no network transport. A
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
| `helpers/creation/types.ts` | Trusted type/provider creation capability, exact request/template approval, contextual factory output capability. |
| `helpers/creation/constants.ts` | Independent finite creation count, input and bootstrap-lifetime budgets. |
| `helpers/creation/helpers.ts` | Immutable registration/callback capture, compiler coherence, JSON bounds, reservations, atomic attach/rollback, conditional bootstrap withdrawal and exact settle cleanup. |
| `helpers/creation/index.ts` | Internal orchestration and public creation type exports. |
| `helpers/registry/helpers.ts` | `createInMemorySessionRegistry`: the live-session store. |
| `helpers/registry/index.ts` | Re-exports the registry factory. |
| `helpers/sequence/types.ts` | `ActionSequence`: `next()` / non-allocating `current()`. |
| `helpers/sequence/helpers.ts` | `createActionSequence`, `createSequenceAllocator`, and the legacy allocator adapter. |
| `helpers/sequence/index.ts` | Re-exports the sequence port. |
| `helpers/actions/types.ts` | Runtime schemas for client session actions and `clientSeq`. |
| `helpers/actions/helpers.ts` | Validation and the baseline support policy for client session actions. |
| `helpers/actions/index.ts` | Re-exports action validation. |
| `helpers/sessionTypes/types.ts` | Session-type definitions and resolution errors. |
| `helpers/sessionTypes/helpers.ts` | `createSessionTypeCatalogue`: exact type and tool resolution. |
| `helpers/sessionTypes/index.ts` | Re-exports the session-type catalogue. |
| `helpers/application/constants.ts` | Tool access levels and server-derived client roles. |
| `helpers/application/types.ts` | Typed-host options, the header tool map, and the live session-type binding. |
| `helpers/application/define.ts` | `defineApplicationSession`: domain registration, header enum, and tool grants. |
| `helpers/application/helpers.ts` | `prepareSessionCreation`: selector extraction without mutating caller config. |
| `helpers/application/manifest.ts` | Projects the visible tool contracts into the session manifest. |
| `helpers/application/admission.ts` | Checks a typed advertisement before the reducer. |
| `helpers/application/host.ts` | `createApplicationSession`: factory createSession with a header-enum type string. |
| `helpers/application/index.ts` | Re-exports typed session preparation. |
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

Protected factories expose `authorization.usesRegistry(registry)` as a strict
identity check and `authorization.isReady(fullSessionRef)` as an ownership-aware
readiness projection. Readiness requires the current record, ready lifecycle,
backend and exact canonical resource installation, with no stopping/settling state.
`getResource(uri)` returns the record's stable ref only while that installation is
still owned. A failed record can retain ownership while remaining non-ready.
Bootstrap withdrawal and resource disposal carry preknown single-use installation
tokens, so delayed failure/rollback cannot remove a replacement with identical
nominal IDs. Instrumented install adapters must forward those tokens even if they
throw after installing. See [authorization](../authorization/README.md).

`createSessionsFactory(options)` returns a `SessionsFactory`:

- `createSession(params, onRecordCreated?): Promise<void>` — validate, register,
  invoke the attach hook, emit `root/sessionAdded`, then settle with
  `session/ready` or `session/creationFailed`. The optional hook fires
  synchronously at the record-attach moment; the contract lives in
  [`./createSession/README.md`](./createSession/README.md).
- `getSessionSnapshot(sessionUri): SessionSnapshot | undefined`
- `getSessionToolManifest(sessionUri): SessionToolManifest | undefined` — the
  visible tool contracts for a typed session. Missing and untyped sessions
  return `undefined`. This read does not allocate a sequence number.
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
`nextServerSeq` (legacy adapter), `registryFactory`, `onDiagnostic`, and
optional `application` for a typed host, and `creationSecurity` for protected contextual creation.

Typed session surface:

- `defineApplicationSession({ id, key, version, providerId, configSchema, config, tools })`
  returns `{ header, registration, grants }`. It does not create a session or a
  JSON-RPC frame. `header` is `key`. `enabledForCreation` defaults to true.
- `createSessionTypeToolMap({ [header]: grants })` builds the server map from
  that header to its authorized tools.
- `createSessionTypeCatalogue({ tools, types })` resolves exact tool revisions.
  A missing contract fails construction.
- `createApplicationSession(factory, { channel, type, config }, caller?)` uses the
  protected output capability when the trusted context is supplied; without it,
  it calls
  `factory.createSession` with `config["x-ahp-session-type"]` set to the
  header string. Other `config` keys are application config, not provider config.
- `visibleTools(grants, role)` returns standard tools for `anonymous` and adds
  admin tools only for the server role `admin`.

### Protected contextual creation (P05)

`creationSecurity` requires the genuine registry and its exact captured compiler:
`registry.usesPolicyFactory(policies)` must return true before allocation/admission
or host acquisition. Separate equivalent compilers reject. All captured type
admissions are installed as one canonical `installAdmissions` cohort, including
aggregate new-entry capacity, conflict and per-call input validation before mutation.
A failed construction cannot leave a partial admission cohort or stale prior stamps. Each trusted type has
an optional private `policy` registration: exact rules, creation capability/callback
and fixed creator-bootstrap template. Catalogue definitions/manifests contain none
of that executable policy/template inventory. Policy-bearing types without security,
and protected global `role`/`authorizedTools` configurations, reject at construction.
Provider, parser, schema, registration and callback properties are captured once.
Header selection uses exact registered keys/uniquely enabled revisions or an exact
default, never guessed suffixes/latest versions.

Protected factories expose frozen `authorization`:

- `createSession(params, caller)` requires current trusted context plus explicit
  type/provider creation approval for the exact frozen SDK request. Invoke permission,
  namespace membership, template presence and client role/owner claims never suffice.
  An absent template needs explicit `none`; a template needs all exact entries and
  bounded lifetimes. Owner is the actual creator principal, binding actor stays the
  actual creator kind, and only registered roles/policies are materialized.
- `getResource(uri)` returns the live record's immutable full session ref, never a
  reservation or owner cache. Contextual creation validates the accepted default
  ResourceRef (URI max512), UTF-8 JSON input (default and absolute **1MiB**, smaller
  configured budgets allowed) before parsers/reservation/approval. JSON capture also
  rejects cycles, accessors/coercion hooks, reserved keys and depth beyond64.
- Preparation reserves synchronously, is invisible, and has finite count/deadline
  budgets (counts128/max1024, hook5000/max60000ms). `maxPendingCreates` bounds
  both visible reservations and actual unsettled prepare work. Abort/dispose/timeout
  rejects promptly and releases the URI reservation, but cancelled/draining callbacks
  still occupy capacity until their invocation settles. Disposal/bare-factory reuse
  never resets that occupancy; an uncooperative adapter can saturate the bound, not
  manufacture more slots. Late fulfillment is released once and rejection is observed. Guards/clock run before final SDK-owned
  checks; record/resource/owner/bootstrap attach and rollback have no intervening await.
  Publication/backend start follow complete installation. Legacy context-free create
  and attach hooks are unavailable on protected factories.
- Backend rejection preserves inspectable failed record/owner/admission but withdraws
  exact bootstrap bindings before failure publication. Unexpected withdrawal failure
  propagates without falsely publishing successful cleanup; the record remains
  non-ready. Bootstrap lifetime is independently capped (host default1h/max24h;
  each template declares its positive bound), not challenge/cache TTL.
- `disposeSession(expectedFullRef)` cancels/removes only that pending/live instance.
  Owner disappears immediately when the record is removed; an owner-free finite settle
  marker excludes URI reuse until backend disposal finishes. Late backend/cleanup cannot
  touch a same-URI successor. Factory disposal cancels preparations before await; bare
  factories may be reused after disposal, but composed host stop is terminal.

In-process callers need no native cursor permission; network native create additionally
requires successful same-connection ready initialize and live explicit global-cursor
permission. The wire result is only `null`; no snapshots, counts, tools or raw routes
are reopened. Work owner lookup derives from current full ref -> canonical registry
owner -> subject in the configured domain. Ownership is not readiness or invocation
permission. The [authorization grant service](../authorization/README.md#bounded-grant-service)
owns bounded issuance and revocation; public dispatch and recipient-view/SDK proof
remain later integration work.

The role-based typed visibility/examples below describe **legacy trusted-kernel**
configuration, not protected authority or public privacy certification.

#### Arguments

| Argument | Type | Purpose | Example |
| --- | --- | --- | --- |
| `type` | `string` | Server-authored session-type header. Must be a registered key. | `"code.review"` |
| `tools` | `AuthorizedToolGrant[]` | Tools that header may expose, each `standard` or `admin`. | `{ ref: { key: "workspace.read-file", version: 1 }, access: "standard" }` |
| `role` | `"anonymous" \| "admin"` | Server-derived. Never taken from the client payload. | `"anonymous"` |

#### Returns

`defineApplicationSession` returns the header and the registration to pass into
the catalogue. `createApplicationSession` returns `Promise<void>`. The created
session snapshot carries `_meta["x-ahp-application"]` with the type identity
and the visible tool contracts, including their input schemas. Admin tools are
omitted unless the server role is `admin`. A client may advertise a subset of
those contracts with `session/activeClientSet`. A different contract, schema, or
nested client id is rejected without changing the session. Hiding or admitting a
tool does not execute it. Sessions itself does not authenticate; protected context
comes from trusted host/IAM composition.

#### Caveats

A client cannot submit an object selector or choose the role. An unknown header
creates no session. Hiding an admin tool does not execute or authorize the
tool. Sessions itself does not authenticate. Client advertisements are claims and
may remain stale after disconnect under the deferred presence policy. They do
not prove that a tool can execute. Creation-time `activeClient` is rejected on a
typed host; create, subscribe, then advertise instead. An explicitly untyped
host keeps its legacy advertisement behavior.

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
  `session/isReadChanged`, `session/isArchivedChanged`, `session/activeClientSet`,
  and `session/activeClientRemoved` through the protocol reducer. The other
  pinned client-dispatchable session actions are validated and rejected without
  a reducer application or accepted envelope. MCP, working-directory, and
  mutable-config behavior are not implemented here. Disconnect does not yet
  auto-remove an active client.
- **`x-ahp-session-type` is a server-authored header enum.** The legal values are the registered session-type keys. A client cannot send an object selector. The key selects the authorized tool map. Admin grants are omitted from the snapshot metadata unless the server role is `admin`. The wire path does not accept a role from the client.
- **`disposeSession` removes one session.** It emits `root/sessionRemoved`,
  drops that session from the catalogue, and releases its backend. It does not
  close the caller's socket. `listSessions` returns non-disposed summaries,
  most recently modified first.
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
| [`src/tests/sessions/sessionTypes.test.ts`](../tests/sessions/sessionTypes.test.ts) | Exact type resolution, disabled-type lookup, and missing tool rejection. |
| [`src/tests/sessions/typedCreation.test.ts`](../tests/sessions/typedCreation.test.ts) | String header binding and untyped-host rejection. |
| [`src/tests/sessions/toolAccess.test.ts`](../tests/sessions/toolAccess.test.ts) | Anonymous clients do not see admin tools. |
| [`src/tests/sessions/toolManifest.test.ts`](../tests/sessions/toolManifest.test.ts) | Full visible schemas, detached reads, captured policy, legacy absence, and different per-type tool sets. |
| [`src/tests/sessions/toolAdmission.test.ts`](../tests/sessions/toolAdmission.test.ts) | Exact schema/revision admission, atomic rejection, schema preservation, self-only updates, empty/subset registration, and state ownership. |
| [`src/tests/sessions/applicationHost.test.ts`](../tests/sessions/applicationHost.test.ts) | `createApplicationSession` stamps the header and rejects an unknown type. |
| [`src/tests/websocket/sessionTypeCapacity.test.ts`](../tests/websocket/sessionTypeCapacity.test.ts) | Wire threshold: accepted header, hidden admin tool, rejected object and unmapped headers. |

## Related Documentation

- [`src/sessions/createSession/README.md`](createSession/README.md) — the
  create-time contract.
- [`docs/architecture/capabilities.md`](../../docs/architecture/capabilities.md) —
  where sessions sit in the capability map.
- [`docs/technical/runtime-lifecycles.md`](../../docs/technical/runtime-lifecycles.md)
  — session lifecycle and disposal semantics.
- [`docs/plans/ProvidersPlan.md`](../../docs/plans/ProvidersPlan.md) — the
  intended backend/AHP wiring (target state).
