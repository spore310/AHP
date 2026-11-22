# Environment Configuration

Validated process configuration. `loadEnv` reads only the keys declared in
`envSchema`, applies secure defaults, and returns a typed object. It never
includes received values in its error output, so secrets are not copied into
logs.

This is a required startup step: the composition root calls `loadEnv()` before
building the server. See [`src/README.md`](../src/README.md).

## Files

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | `envSchema` / `EnvConfig`: the declared keys, coercion, and defaults. |
| `helpers.ts` | `loadEnv`: validate a source and throw a value-free message on failure. |
| `parse.ts` | `parseAuthTokens` and `parseAllowedKinds`: validate compound values without echoing secrets. |
| `index.ts` | Public surface: `loadEnv`, `envSchema`, `EnvConfig`, and the compound parsers. |

The provider selector is an optional string. This neutral environment module
does not define database-specific provider names; the persistence adapter
registry owns that allowlist and resolves the omitted value to its compatibility
default only when durable agent/work features are enabled.

## API

- `envSchema` — Zod object for the environment.
- `EnvConfig` — inferred configuration type.
- `loadEnv(source?: NodeJS.ProcessEnv): EnvConfig` — validates `process.env` by
  default; tests pass an explicit record for determinism. Throws on invalid
  input.
- `parseAuthTokens(value?)` — parses the JSON object of bearer tokens to
  principal subjects. An absent value is an empty map; a supplied value must be a
  non-empty object of non-empty strings.
- `parseAllowedKinds(value)` — splits, trims, rejects empty or duplicate work
  kinds, and returns a set.

Declared keys:

| Key | Type | Default | Notes |
| --- | ---- | ------- | ----- |
| `AGENT_HOSTING_PROTOCOL_WEBSOCKET_HOST` | non-empty string | `127.0.0.1` | Bind interface. |
| `AGENT_HOSTING_PROTOCOL_WEBSOCKET_PORT` | integer `1`–`65535` | `12345` | Coerced from the string form. |
| `AGENT_HOSTING_PROTOCOL_DATABASE_URL` | non-empty string | unset | Connection string consumed by the selected adapter. Required with auth tokens to enable durable agent/work features. |
| `AGENT_HOSTING_PROTOCOL_PERSISTENCE_PROVIDER` | non-empty string | unset | Optional adapter selector. Supported names are owned by the allowlisted adapter registry; omitted selects the compatibility default when durable features are enabled. |
| `AGENT_HOSTING_PROTOCOL_AUTH_TOKENS` | JSON object string | unset | Bearer token → trusted principal subject. Never log this value. |
| `AGENT_HOSTING_PROTOCOL_PRESENCE_TTL_SECONDS` | integer `5`–`600` | `90` | In-memory presence lifetime. |
| `AGENT_HOSTING_PROTOCOL_WORK_LEASE_SECONDS` | integer `5`–`3600` | `60` | Work lease lifetime, evaluated by the database clock. |
| `AGENT_HOSTING_PROTOCOL_ALLOWED_WORK_KINDS` | comma-separated string | `code.patch,code.review` | Kinds accepted by submit/claim. |

## 5-Minute Usage

```ts
import { loadEnv } from "@env";

const config = loadEnv();
console.log(config.AGENT_HOSTING_PROTOCOL_WEBSOCKET_HOST); // "127.0.0.1"
console.log(config.AGENT_HOSTING_PROTOCOL_WEBSOCKET_PORT); // 12345
```

Set overrides through the environment before starting the host:

```bash
AGENT_HOSTING_PROTOCOL_WEBSOCKET_HOST=0.0.0.0 \
AGENT_HOSTING_PROTOCOL_WEBSOCKET_PORT=8080 \
  pnpm start
```

## Intermediate Usage

Pass an explicit source in tests instead of mutating `process.env`:

```ts
import { loadEnv } from "@env";

const config = loadEnv({
  AGENT_HOSTING_PROTOCOL_WEBSOCKET_HOST: "0.0.0.0",
  AGENT_HOSTING_PROTOCOL_WEBSOCKET_PORT: "8080",
});
```

## Caveats

- **Failure messages name keys, not values.** The thrown message lists
  `path: reason` pairs only, so an invalid secret-bearing value is never echoed.
- **Only declared keys are read.** Unrelated process variables are ignored, not
  rejected.
- **The port is coerced and range-checked** (`1`–`65535`); a non-numeric or
  out-of-range value throws.
- **Defaults are bind-safe.** The default host is loopback; binding a
  non-loopback interface is a deliberate configuration choice.
- **Agent/work configuration is all-or-nothing.** Supplying only the database
  URL or only auth tokens is a startup error. Supplying neither leaves the
  baseline host unchanged and does not register the extension methods. A
  provider selector without both values is also a startup error.
- **Token maps are secrets.** `parseAuthTokens` reports shape errors only; it
  never includes a token or subject in the message.

## Testing

| Test | Pins |
| ---- | ---- |
| [`src/tests/env.test.ts`](../src/tests/env.test.ts) | Defaults when absent, explicit values, out-of-range and non-numeric ports, empty host, and that errors do not echo the offending value. |
| [`src/tests/env/parse.test.ts`](../src/tests/env/parse.test.ts) | Token-map shape, secret non-disclosure, allowed-kind parsing, fail-closed partial configuration, and optional extension composition. |
| [`src/tests/index.test.ts`](../src/tests/index.test.ts) | Composition exports, optional agent/work configuration, entrypoint guard, and shutdown handlers. |

## Related Documentation

- [`src/README.md`](../src/README.md) — the composition root that consumes this
  configuration.
- [`docs/CodingRules.md`](../docs/CodingRules.md) — naming conventions for
  environment variables.
