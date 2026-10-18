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
| `index.ts` | Public surface: `loadEnv`, `envSchema`, and `EnvConfig`. |

## API

- `envSchema` — Zod object for the environment.
- `EnvConfig` — inferred configuration type.
- `loadEnv(source?: NodeJS.ProcessEnv): EnvConfig` — validates `process.env` by
  default; tests pass an explicit record for determinism. Throws on invalid
  input.

Declared keys:

| Key | Type | Default | Notes |
| --- | ---- | ------- | ----- |
| `AGENT_HOSTING_PROTOCOL_WEBSOCKET_HOST` | non-empty string | `127.0.0.1` | Bind interface. |
| `AGENT_HOSTING_PROTOCOL_WEBSOCKET_PORT` | integer `1`–`65535` | `12345` | Coerced from the string form. |

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

## Testing

| Test | Pins |
| ---- | ---- |
| [`src/tests/env.test.ts`](../src/tests/env.test.ts) | Defaults when absent, explicit values, out-of-range and non-numeric ports, empty host, and that errors do not echo the offending value. |

## Related Documentation

- [`src/README.md`](../src/README.md) — the composition root that consumes this
  configuration.
- [`docs/CodingRules.md`](../docs/CodingRules.md) — naming conventions for
  environment variables.
