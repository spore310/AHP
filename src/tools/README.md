# Tools

Trusted, in-memory tool-contract definitions. A contract describes an allowed tool revision. It does not execute the tool, call a model, or open a network connection.

`database/` does not own this module. These definitions are application code. Later SQL scripts may store the same serializable data; this module does not write them.

## Files

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | `ToolContractRef`, `ToolContractDefinition`, `ToolCatalogue`, and validation results. |
| `constants.ts` | Identity patterns, schema dialect, and size limits. |
| `index.ts` | Public exports, including `toAhpToolDefinition`. |
| `helpers/contracts/helpers.ts` | `defineToolContract`. |
| `helpers/contracts/index.ts` | Re-exports `defineToolContract`. |
| `helpers/validation/helpers.ts` | Ajv adapter. Trusted schemas only. No `$ref`, `pattern`, or `format`. |
| `helpers/validation/index.ts` | Re-exports the Ajv adapter. |
| `helpers/catalogue/helpers.ts` | `createToolCatalogue`. Exact `{ key, version }` lookup. |
| `helpers/catalogue/index.ts` | Re-exports `createToolCatalogue`. |
| `helpers/protocol/helpers.ts` | Project a contract to an AHP tool descriptor without claiming it is executable. |
| `helpers/protocol/index.ts` | Re-exports protocol projection helpers. |

## Public projection

`toAhpToolDefinition(contract)` produces a detached client advertisement with exact revision identity under `_meta["x-ahp-tool-contract"]`. It preserves schema keywords such as `additionalProperties` and does not register or execute the tool. Typed sessions admit subsets of their visible contracts and normalize accepted text/annotations from these trusted definitions.

`canonicalJsonEqual(left, right)` performs bounded JSON comparison. Object-key order is ignored; array order matters. Invalid, cyclic, over-deep or oversized data compares unequal, never as `null`. Client schemas are compared, not compiled.

## Testing

| Test | Pins |
| ---- | ---- |
| [`src/tests/tools/contracts.test.ts`](../tests/tools/contracts.test.ts) | Definition admission and immutability. |
| [`src/tests/tools/schema.test.ts`](../tests/tools/schema.test.ts) | Schema profile and payload validation. |
| [`src/tests/tools/catalogue.test.ts`](../tests/tools/catalogue.test.ts) | Exact revision lookup and atomic construction. |
| [`src/tests/tools/validation.test.ts`](../tests/tools/validation.test.ts) | Input/output validation without execution or coercion. |
| [`src/tests/tools/protocol.test.ts`](../tests/tools/protocol.test.ts) | Descriptor projection and conservative JSON comparison. |
