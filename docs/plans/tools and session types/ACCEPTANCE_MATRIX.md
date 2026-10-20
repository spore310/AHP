# Acceptance Matrix — Code-First Phase

> **Status: historical target inventory.** This file preserves the original
> plan's 100 proposed scenarios and proposed test paths. It is not the current
> execution ledger, and no row below is a claim that the scenario passed.
> The implementation has landed since this matrix was written; see
> [CURRENT_STATE.md](CURRENT_STATE.md) for actual coverage, divergences, and
> the test files that now exist. Several proposed paths differ from the
> implemented tests.

Every case was marked **NOT RUN** when the plan was prepared. Related cases may be parameterized in one test; this is not a requirement for one test function per row. The listed test files are proposed paths under the repository's existing test root.

| ID | Proposed test / gate | Scenario | Required evidence |
|---|---|---|---|
| TC-001 | `src/tests/tools/contracts.test.ts` | Valid contract | A bounded JSON definition with explicit UUID/key/version and object input schema is accepted unchanged in meaning. |
| TC-002 | `src/tests/tools/contracts.test.ts` | Invalid identity | Blank/malformed UUID, key, or name rejects before a catalogue entry is observable. |
| TC-003 | `src/tests/tools/contracts.test.ts` | Version types | Missing, string, boolean, zero, negative, fractional, unsafe, and out-of-range versions reject without coercion. |
| TC-004 | `src/tests/tools/contracts.test.ts` | No implicit revision ID | Constructing from identical explicit seed data never generates a new random revision identity. |
| TC-005 | `src/tests/tools/contracts.test.ts` | Non-JSON values | Functions, BigInt, NaN, Infinity, undefined array entries, class instances, and cycles reject safely. |
| TC-006 | `src/tests/tools/contracts.test.ts` | Accessor boundary | Definitions with accessor/getter side effects are rejected by data admission rather than invoked as tool behavior. |
| TC-007 | `src/tests/tools/contracts.test.ts` | Definition size | Serialized definition above the chosen byte limit fails with a safe bounded error. |
| TC-008 | `src/tests/tools/contracts.test.ts` | Nesting limit | Over-deep nested schema/data fails before recursive compilation can exhaust the stack. |
| TC-009 | `src/tests/tools/contracts.test.ts` | Reserved metadata | A conflicting x-ahp-tool-contract reference supplied by a catalogue author is rejected. |
| TC-010 | `src/tests/tools/contracts.test.ts` | Input mutation | Mutating the original seed and nested required/enum arrays after capture does not change the definition. |
| TC-011 | `src/tests/tools/contracts.test.ts` | Portable definition | JSON round-trip preserves the definition but contains no compiled function or library object. |
| TC-012 | `src/tests/tools/schema.test.ts` | Wrong root | Root boolean, array, null, or non-object type is rejected under the catalogue profile. |
| TC-013 | `src/tests/tools/schema.test.ts` | Actual schema validation | Invalid nested required/type/enum shapes fail even though they are ordinary JSON objects. |
| TC-014 | `src/tests/tools/schema.test.ts` | Unknown keyword | A misspelled or custom executable schema keyword is rejected, not silently ignored. |
| TC-015 | `src/tests/tools/schema.test.ts` | No schema fetch | Remote and local refs under the initial no-ref profile reject and perform zero network reads. |
| TC-016 | `src/tests/tools/schema.test.ts` | No hidden async | Async/data-dependent/custom code keywords reject; no async execution is started. |
| TC-017 | `src/tests/tools/schema.test.ts` | No regex/plugin creep | Pattern/patternProperties/format-plugin features reject under the chosen first-slice profile. |
| TC-018 | `src/tests/tools/schema.test.ts` | Nested normal schema | Nested object/array constraints and ordinary bounds work with compatible object property schemas. |
| TC-019 | `src/tests/tools/schema.test.ts` | Object excess keys | additionalProperties:false actually rejects an extra key in a validated input. |
| TC-020 | `src/tests/tools/validation.test.ts` | Valid input | A known valid argument returns valid without running a tool. |
| TC-021 | `src/tests/tools/validation.test.ts` | Invalid input | Missing required, wrong type, enum mismatch, and bounds failure return invalid with safe issues. |
| TC-022 | `src/tests/tools/validation.test.ts` | No coercion | A numeric string is not accepted as a number merely because coercion could convert it. |
| TC-023 | `src/tests/tools/validation.test.ts` | No input mutation | Validation does not insert defaults, remove unknown keys, or mutate arrays/objects. |
| TC-024 | `src/tests/tools/validation.test.ts` | Output validation | Declared output schema accepts/rejects the appropriate object shapes. |
| TC-025 | `src/tests/tools/validation.test.ts` | Output not declared | An omitted output schema produces schema-not-declared rather than valid. |
| TC-026 | `src/tests/tools/validation.test.ts` | Error safety | Errors do not echo fake secrets, full inputs, raw schemas, or compiler stacks. |
| TC-027 | `src/tests/tools/validation.test.ts` | Stable error results | A second validation cannot overwrite or mutate a prior returned issue list. |
| TC-028 | `src/tests/tools/catalogue.test.ts` | Duplicate natural revision | Two definitions with the same key/version reject catalogue construction. |
| TC-029 | `src/tests/tools/catalogue.test.ts` | Duplicate UUID | Two different definitions with the same revision UUID reject catalogue construction. |
| TC-030 | `src/tests/tools/catalogue.test.ts` | Atomic construction | An invalid later seed does not leave a usable partially built catalogue. |
| TC-031 | `src/tests/tools/catalogue.test.ts` | Exact lookup | Missing version does not resolve to latest; an absent exact key/version returns missing. |
| TC-032 | `src/tests/tools/catalogue.test.ts` | Multiple versions | v1 and v2 resolve to different exact definitions and remain unchanged. |
| TC-033 | `src/tests/tools/catalogue.test.ts` | Read ownership | Mutating nested get/list results does not affect subsequent reads or validation. |
| TC-034 | `src/tests/tools/catalogue.test.ts` | Compile once | Repeated lookups/input validation do not recompile the same trusted revision inside one catalogue runtime. |
| TC-035 | `src/tests/tools/catalogue.test.ts` | No global coupling | Separate catalogues built from shared input objects cannot mutate each other. |
| TC-036 | `src/tests/tools/protocol.test.ts` | Canonical keys | Reordered object keys compare equal; changed contract-bearing values do not. |
| TC-037 | `src/tests/tools/protocol.test.ts` | Array comparison | Array order is preserved by the conservative comparison, with no equivalence claim. |
| TC-038 | `src/tests/tools/protocol.test.ts` | Descriptor projection | toAhpToolDefinition adds the correct authoritative revision metadata and preserves schemas. |
| TC-039 | `src/tests/tools/protocol.test.ts` | Detached descriptor | Mutating a projected SDK descriptor cannot change its source catalogue contract. |
| TC-040 | `src/tests/sessions/sessionTypes.test.ts` | Type definition | A valid type captures exact refs and separate runtime config parser registration. |
| TC-041 | `src/tests/sessions/sessionTypes.test.ts` | Type duplicates | Duplicate type UUID or natural key/version rejects. |
| TC-042 | `src/tests/sessions/sessionTypes.test.ts` | Missing tool | A type referencing an unknown exact tool revision cannot be activated. |
| TC-043 | `src/tests/sessions/sessionTypes.test.ts` | Duplicate tool ref | Repeated reference to the same tool in one type rejects. |
| TC-044 | `src/tests/sessions/sessionTypes.test.ts` | Two versions one manifest | A single type cannot select both v1 and v2 of the same logical tool. |
| TC-045 | `src/tests/sessions/sessionTypes.test.ts` | Wire-name collision | Different tool keys with the same AHP name collide inside a resolved manifest. |
| TC-046 | `src/tests/sessions/sessionTypes.test.ts` | Empty type | A valid type may have an empty tool list and can still create a session. |
| TC-047 | `src/tests/sessions/sessionTypes.test.ts` | Disabled creation | Disabled type cannot create new sessions but exact existing-definition lookup remains possible. |
| TC-048 | `src/tests/sessions/sessionTypes.test.ts` | Config defaults | Type parser applies explicit approved defaults and validates required fields. |
| TC-049 | `src/tests/sessions/sessionTypes.test.ts` | Config descriptor ownership | Nested descriptor edits after catalogue construction cannot alter advertised type configuration. |
| TC-050 | `src/tests/sessions/sessionTypes.test.ts` | No parser serialization | Portable type definition contains JSON config schema but no parser callback. |
| TC-051 | `src/tests/sessions/manifests.test.ts` | Manifest determinism | Same exact type produces the same order, revisions, UUIDs, and schema content. |
| TC-052 | `src/tests/sessions/manifests.test.ts` | Manifest size | Too many tools or oversized resolved manifest rejects before session creation. |
| TC-053 | `src/tests/sessions/manifests.test.ts` | Manifest ownership | Editing returned manifest schemas/tools/type reference cannot change another read. |
| TC-054 | `src/tests/sessions/applicationCreation.test.ts` | Public creation | createApplicationSession creates a normal session with the selected exact type. |
| TC-055 | `src/tests/sessions/applicationCreation.test.ts` | Same pipeline | Application and native creation yield equivalent type binding and lifecycle for equivalent inputs. |
| TC-056 | `src/tests/sessions/applicationCreation.test.ts` | Unknown/disabled type | Invalid selector fails before registry insertion, provider start, and accepted publication. |
| TC-057 | `src/tests/sessions/applicationCreation.test.ts` | Separate configs | Application language settings do not enter the mock provider config; provider options retain their meaning. |
| TC-058 | `src/tests/sessions/applicationCreation.test.ts` | Provider mismatch | A selected type and explicit native provider disagreement rejects instead of being silently corrected. |
| TC-059 | `src/tests/sessions/applicationCreation.test.ts` | Invalid provider config | A valid type does not bypass an invalid provider-specific config. |
| TC-060 | `src/tests/sessions/applicationCreation.test.ts` | Missing provider | Host composition fails before listening when a type/default references a missing registered provider. |
| TC-061 | `src/tests/sessions/applicationCreation.test.ts` | Default policy | Typed host uses its exact configured default; no default/selector rejects; no implicit latest. |
| TC-062 | `src/tests/sessions/applicationCreation.test.ts` | No untyped bypass | Omitting selector or naming a different provider cannot bypass policy on an application-enabled host. |
| TC-063 | `src/tests/sessions/applicationCreation.test.ts` | Legacy mode | Untyped host retains its documented native creation behavior and rejects the unsupported reserved selector. |
| TC-064 | `src/tests/sessions/applicationCreation.test.ts` | No caller mutation | Extraction/normalization does not delete keys from the caller config or mutate nested input. |
| TC-065 | `src/tests/sessions/applicationCreation.test.ts` | Duplicate URI | Duplicate create while first start is pending still rejects with existing ownership semantics. |
| TC-066 | `src/tests/sessions/applicationCreation.test.ts` | Backend failure distinction | Valid registration followed by mock backend failure creates an inspectable failed lifecycle, not a phantom success. |
| TC-067 | `src/tests/sessions/applicationCreation.test.ts` | Late generation | Delayed old backend completion cannot change a reused URI new type/manifest. |
| TC-068 | `src/tests/sessions/applicationCreation.test.ts` | Pinned version | Creating another session from v2 does not change an existing v1 binding. |
| TC-069 | `src/tests/sessions/applicationCreation.test.ts` | Eager active client guard | Typed create with non-undefined activeClient rejects explicitly before registration instead of bypassing admission. |
| TC-070 | `src/tests/websocket/sessionTypes.test.ts` | Native selector | Actual SDK createSession with x-ahp-session-type config creates the expected type. |
| TC-071 | `src/tests/websocket/sessionTypes.test.ts` | Malformed selector | Raw null/array/string/bad revision selector gets the correct request failure, not a partial record. |
| TC-072 | `src/tests/websocket/sessionTypes.test.ts` | Two client manifest | Creator and observer obtain the same exact allowed manifest from ordinary snapshots. |
| TC-073 | `src/tests/websocket/sessionTypes.test.ts` | No fake execution | Manifest issuance leaves serverTools absent and does not invent active clients or execution events. |
| TC-074 | `src/tests/websocket/sessionTypes.test.ts` | Metadata authority | Client-supplied metadata cannot replace the reserved session manifest or selected type. |
| TC-075 | `src/tests/websocket/sessionTypes.test.ts` | Snapshot ordering | Post-snapshot actions follow their snapshot and do not arrive twice due to new projection code. |
| TC-076 | `src/tests/sessions/toolAdmission.test.ts` | Valid subset | Subset of permitted exact tool descriptors is accepted once through the existing reducer. |
| TC-077 | `src/tests/sessions/toolAdmission.test.ts` | Empty update | Empty tool array is allowed without blocking the session lifecycle. |
| TC-078 | `src/tests/sessions/toolAdmission.test.ts` | Unassigned tool | Known catalogue tool not assigned to this type is rejected without state change. |
| TC-079 | `src/tests/sessions/toolAdmission.test.ts` | Wrong revision | Matching name with a different key/version/UUID fails exact contract admission. |
| TC-080 | `src/tests/sessions/toolAdmission.test.ts` | Input weakening | Changed input type, required, enum, or additionalProperties fails. |
| TC-081 | `src/tests/sessions/toolAdmission.test.ts` | Output weakening | Missing/different declared output schema fails; undeclared output policy is explicit. |
| TC-082 | `src/tests/sessions/toolAdmission.test.ts` | Revision metadata absent | Schemaless/name-only ad is not treated as a compliant typed catalogue registration. |
| TC-083 | `src/tests/sessions/toolAdmission.test.ts` | Duplicate ad names | Duplicate tool names or revision identities in one client entry fail atomically. |
| TC-084 | `src/tests/sessions/toolAdmission.test.ts` | Mixed-list atomicity | A list with valid and invalid descriptors performs no partial active-client update. |
| TC-085 | `src/tests/sessions/toolAdmission.test.ts` | Nested identity spoof | A typed client set/removal may not target another nested client ID. |
| TC-086 | `src/tests/sessions/toolAdmission.test.ts` | Hints not authority | Changing readOnly/destructive annotations does not grant policy; accepted normalization uses the chosen trusted contract policy. |
| TC-087 | `src/tests/websocket/toolAdmission.test.ts` | Schema parse preservation | Catalogue-generated additionalProperties:false survives the real wire and action parsers. |
| TC-088 | `src/tests/websocket/toolAdmission.test.ts` | Private rejection | Well-formed denied ad yields one rejection only to the actual originating connection. |
| TC-089 | `src/tests/websocket/toolAdmission.test.ts` | Same-ID isolation | When duplicate claimed IDs are permitted by the baseline, one socket must not receive another socket private rejection. |
| TC-090 | `src/tests/websocket/toolAdmission.test.ts` | Malformed notification | No illegal JSON-RPC response and no forged typed envelope is produced from malformed data. |
| TC-091 | `src/tests/websocket/toolAdmission.test.ts` | Request-shaped dispatch | Giving dispatchAction an id does not bypass method-kind enforcement. |
| TC-092 | `src/tests/websocket/toolAdmission.test.ts` | No client grant action | Client metadata/serverTools/type-switch actions remain forbidden. |
| TC-093 | `src/tests/application.test.ts` | Public imports only | Consumer creates typed sessions without private helper imports or handwritten JSON-RPC. |
| TC-094 | `src/tests/application.test.ts` | Host isolation | Two live hosts with same session URI and different defaults do not share records, counters, or delivery. |
| TC-095 | `src/tests/application.test.ts` | Legacy and typed hosts | Typed policy in one host does not impose catalogue requirements on another explicitly legacy host. |
| TC-096 | `src/tests/websocket/composition.test.ts` | Stopped facade | New createApplicationSession method cannot revive or mutate a stopped host. |
| TC-097 | `src/tests/application.test.ts` | Inert module import | Importing application seed/entrypoint modules does not bind ports or run tool code. |
| TC-098 | `documentation gate` | Mapped source and examples | All new production files have README coverage; corresponding examples compile through fixtures. |
| TC-099 | `phase boundary inspection` | No persistence creep | No SQL migration, Redis/ORM client, durable write, agent SDK, tool runner, or replay journal is introduced. |
| TC-100 | `review custody` | Independent final reports | Both reports identify the final candidate, disclose limitations, and are sealed before reveal. |


## Minimum real-SDK acceptance sequence

```text
Build host through public factories with a typed default
  -> open creator and observer with installed WebSocketTransport/AhpClient
  -> initialize both and subscribe root
  -> create exact code-review@1 session through native config selector
  -> both subscribe its session URI
  -> inspect matching x-ahp-application manifest and empty live tools
  -> creator advertises a catalogue-generated allowed tool descriptor
  -> both observe one accepted state action; inspect real session state
  -> creator advertises a well-formed unassigned write tool
  -> creator receives one rejected envelope; observer receives no accepted mutation
  -> session remains unchanged by rejection
  -> create coding@1 session and observe its larger allowed set
  -> close clients and stop host under existing cleanup contract
```

No test may invoke a real read/write tool implementation. The tool payloads in this feature test are declarations and validation samples only.

## Negative evidence is explicit

A timeout without a causal observation point is not sufficient proof that an event was not emitted. A generic catch without checking the error class/code is not sufficient proof of correct rejection. A single successful event is not sufficient proof of no duplicate event. Tests must select barriers and assertions for the exact behavior they claim.

Do not remove newly introduced failing tests to obtain a green total. Fix the behavior or report the gate incomplete. Baseline unrelated failures are reported separately and do not convert a failed final `pnpm validate` into a success.
