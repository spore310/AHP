# Coding Rules

## Organization

Within an application module, use `index.ts` for its public exports, `types.ts`
for contracts and their runtime schemas, `helpers.ts` (or `helpers/`) for
implementation, and optionally `constants.ts` (or `constants/`) for fixed values.
Do not introduce operation-named source files such as `signJwt.ts` or a separate
`schemas.ts`. Framework-required files and tooling/configuration entrypoints
retain their required names.

Nested supporting capabilities belong under the owning module's `helpers/`.
For example, JWT key configuration belongs in `utils/server/jwt/helpers/configuration/`,
with `index.ts`, `helpers.ts`, and `types.ts` as needed, rather than a sibling
`utils/server/jwt/configuration/` directory.

Keep all tests under `src/tests/`, the test root of the project, mirroring
the source paths below `src/`. For example,
`src/utils/server/jwt/helpers/sign/helpers.ts` is tested by
`src/tests/utils/server/jwt/helpers.test.ts`, which groups the public JWT operations.
Related operations can share a module-level suite rather than one suite per helper.
Shared test support may live
directly under `src/tests/`. Do not colocate test files with application source.

## Naming and Spelling

Use the full product name, "Agent Hosting Protocol," for all user-facing text
and documentation.

When a platform requires a compact, machine-safe identifier, use the product
name in a compact form such as `AgentHostingProtocol` for container names,
network names, and generated identifiers. Do not concatenate the product name
with a misspelling or a domain word such as `AgentHostingProtocolpersistance`.

Use the correct English spelling `persistence` for the domain concept, and use
`Persistence` only when a capitalized form is required by a class, folder, or
identifier name. Prefer uppercase environment variables such as
`AGENT_HOSTING_PROTOCOL_ADMIN_USER` and `AGENT_HOSTING_PROTOCOL_ADMIN_PASS`.

Organize code by **capability/domain**, not by framework artifact type.

Prefer:

```text
auth/
├── index.ts
├── helpers/
├── types/
├── constants/
└── jwt/
```

Avoid large global folders such as:

```text
src/helpers/
src/types/
src/utils/
```

when ownership clearly belongs to a capability.

Existing shared folders may remain until a scoped change justifies moving them.
Do not reorganize working code solely to make the directory tree match this
guidance.

---

## `index.ts`

`index.ts` defines the **public boundary of a module**.

Use it to export what consumers are allowed to depend on.

```ts
export type { AuthContext } from "./types";
export { verifyToken } from "@auth/jwt/helpers/verify";
```

Rules:

- Do not place implementation logic in `index.ts`.
- Do not automatically export every internal file.
- Internal modules may change without affecting consumers.
- Imports should prefer the owning capability's public API.

```ts
import { verifyToken } from "@auth/jwt";
```

instead of:

```ts
import { verifyToken } from "@auth/jwt/helpers/verify/helpers";
```

when the helper is part of the public contract.

---

## Types

Types describe **contracts and shapes**, not behavior.

Use:

```text
types.ts
```

for small modules.

Use:

```text
types/
├── index.ts
├── payload/
│   └── types.ts
└── request/
    └── types.ts
```

when the type surface grows.

Rules:

- Keep types separate from helpers.
- Keep runtime validation schemas in `types.ts` alongside their inferred types.
- Do not use `types.ts` as a miscellaneous dumping ground.
- Prefer domain/capability-specific types.
- Extend upstream contracts when appropriate rather than duplicating them.

Example:

```ts
interface AgentHostingProtocolJwtPayload extends JWTPayload {
  userId: string;
}
```

---

## Helpers

`helpers/` contains reusable implementation/support logic owned by the capability.

```text
helpers/
├── sign/
│   ├── index.ts
│   └── helpers.ts
└── configuration/
    ├── index.ts
    ├── helpers.ts
    └── types.ts
```

Rules:

- Prefer small focused helper files.
- One clear responsibility per helper.
- Avoid generic `utils.ts`.
- If a helper gains domain significance, give it a proper module/service instead.
- Route handlers and callers should consume helpers rather than accumulating reusable logic inline.

---

## Constants

Use `constants.ts` (or a `constants/` folder when needed) for stable named values
owned by the capability.

```text
constants.ts
```

Prefer:

```ts
export const AUTHORIZATION_HEADER = "authorization";
```

over repeating string literals throughout the codebase.

Do not turn values that belong in configuration, environment variables, or runtime state into constants.

---

## Function Boundaries

Pass functions and use cases **only the information they need**.

Prefer:

```ts
createDiscussion({
  actorId,
  title,
  body,
  categoryId,
});
```

over:

```ts
createDiscussion(request);
```

Framework-specific objects such as HTTP request/response wrappers or database-specific objects should stay near their system boundary.

---

## Dependencies

Control **where dependencies enter the application**.

Library/framework details should remain behind owned interfaces where portability or replacement matters.

Application and domain logic should not unnecessarily depend on:

- Framework request objects
- ORM-specific entities
- HTTP response types

---

## Module Size

Prefer small, traversable modules with:

- explicit ownership
- explicit dependencies
- clear names
- minimal hidden behavior

Avoid abstraction created only to satisfy an architectural diagram.

Create a new abstraction when it establishes a meaningful boundary, contract, policy, or reusable behavior.

---

## Reusable Logic

Do not bury reusable or authoritative behavior inside:

- route handlers
- middleware
- controllers

These layers should primarily translate inputs, invoke owned behavior, and translate outputs.

---

## General Rules

Prefer:

- strong TypeScript
- explicit contracts
- capability ownership
- deterministic behavior
- secure defaults
- least-invasive changes
- DRY without becoming magical
- clear module boundaries
- configured aliases such as `@env/*`, `@env`, `@jsonrpc/*`, `@jsonrpc`,
  `@sessions/*`, `@sessions`, `@websocket/*`, `@websocket`, `@providers/*`,
  and `@providers`, declared in `tsconfig.json`

Use those aliases for cross-folder imports when relative paths would require
climbing through parent directories. Short same-folder imports such as
`./helpers` and `./types` are appropriate. Do not add aliases solely to avoid a
clear same-folder import. When a capability justifies a new alias, declare it in
`tsconfig.json` and add it to this list.

Avoid:

- global mutable state
- hidden side effects
- giant barrel files
- generic `utils`
- framework leakage
- premature abstractions
- circular dependencies

## Destructuring Rule

Prefer destructuring return values when it makes the result easier to read and map through the function.

Example:

```ts
const { data, error } = fooSchema.safeParse(obj);
```

Prefer this over repeatedly accessing:

```ts
result.data;
result.error;
```

when the destructured values are the actual values being worked with.

### Alias Collisions

If multiple destructured values in the same file, scope, or encapsulation would share the same name, alias them immediately to a meaningful name.

```ts
const { data: userData, error: userError } = userSchema.safeParse(user);

const { data: tokenData, error: tokenError } = tokenSchema.safeParse(token);
```

Do not leave ambiguous values such as:

```ts
data;
error;
result;
value;
```

when multiple operations are present.

Aliases should describe the value's **domain or purpose**, not just its order.

Prefer:

```ts
const { data: jwtPayload, error: jwtPayloadError } =
  jwtPayloadSchema.safeParse(payload);
```

Avoid:

```ts
const { data: data2, error: error2 } = jwtPayloadSchema.safeParse(payload);
```

The goal is to make the flow of values obvious without requiring the reader to trace which operation produced each variable.
