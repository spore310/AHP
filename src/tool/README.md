# Tool contracts and capabilities

Trusted, in-memory tool-contract definitions. A contract describes an allowed tool revision. It does not execute the tool, call a model, or open a network connection.

`database/` does not own this module. These definitions are application code. Later SQL scripts may store the same serializable data; this module does not write them.

## Files

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | `ToolContractRef`, `ToolContractDefinition`, `ToolCatalogue`, and validation results. |
| `constants.ts` | Identity patterns, schema dialect, and size limits. |
| `index.ts` | Public exports, including `toAhpToolDefinition`. |
| `helpers/contracts/helpers.ts` | Definition capture, size limits, schema admission, and `defineToolContract`. |
| `helpers/contracts/index.ts` | Contract capture and admission exports. |
| `helpers/validation/helpers.ts` | Ajv adapter. Trusted schemas only. No `$ref`, `pattern`, or `format`. |
| `helpers/validation/index.ts` | Re-exports the Ajv adapter. |
| `helpers/catalogue/helpers.ts` | `createToolCatalogue`. Exact `{ key, version }` lookup. |
| `helpers/catalogue/index.ts` | Re-exports `createToolCatalogue`. |
| `helpers/protocol/helpers/descriptors/helpers.ts` | Project a contract to an AHP tool descriptor without claiming it is executable. |
| `helpers/protocol/helpers/descriptors/index.ts` | Descriptor projection exports. |
| `helpers/protocol/index.ts` | Portable private V1 protocol and descriptor exports. |
| `helpers/protocol/types.ts` | Strict V1 schemas, private selectors and correlated messages. |
| `helpers/protocol/helpers.ts` | Bounded capture, correlation and schema parsing. |

## Public projection

`toAhpToolDefinition(contract)` produces a detached client advertisement with exact revision identity under `_meta["x-ahp-tool-contract"]`. It preserves schema keywords such as `additionalProperties` and does not register or execute the tool. Typed sessions admit subsets of their visible contracts and normalize accepted text/annotations from these trusted definitions.

`canonicalJsonEqual(left, right)` performs bounded JSON comparison. Object-key order is ignored; array order matters. Invalid, cyclic, over-deep or oversized data compares unequal, never as `null`. Client schemas are compared, not compiled.

The proposal service first captures bounded definition data, then applies the
existing schema profile and compiler after scoped proposal authorization and
capacity checks. Proposals and approved definitions contain serializable data.

Input and output schemas have object roots and use draft-07. Admission checks
schema-bearing positions including additional tuple items and schema-valued
dependencies. The profile excludes references, regex keywords, formats,
asynchronous validation, and data references. Property names and literal
values under `const` and `enum` are ordinary data. Execution validation stops
at the first error. Catalogue validation continues to return detailed errors.

## Testing

| Test | Pins |
| ---- | ---- |
| [`src/tests/tool/contracts/contracts.test.ts`](../tests/tool/contracts/contracts.test.ts) | Definition admission and immutability. |
| [`src/tests/tool/contracts/schema.test.ts`](../tests/tool/contracts/schema.test.ts) | Schema profile and payload validation. |
| [`src/tests/tool/contracts/catalogue.test.ts`](../tests/tool/contracts/catalogue.test.ts) | Exact revision lookup and atomic construction. |
| [`src/tests/tool/contracts/validation.test.ts`](../tests/tool/contracts/validation.test.ts) | Input/output validation without execution or coercion. |
| [`src/tests/tool/contracts/protocol.test.ts`](../tests/tool/contracts/protocol.test.ts) | Descriptor projection and conservative JSON comparison. |

## Entrypoints

Use the [tool adapter](helpers/client/README.md) for private client capabilities, [execution](helpers/execution/README.md) for trusted dispatch, and [tool policy](helpers/policy/README.md) for admission and assignment projection. `@tool/protocol` provides the portable wire schemas. The general connection is owned by [the client module](../client/README.md).
