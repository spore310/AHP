# Neutral Requirements — Tool Contracts and Application Session Types

This is the common requirements packet for both independent reviewers. It is intentionally free of implementer identity, confidence claims, reviewer conclusions, and model-selection information. Read the candidate source and pinned SDK; do not infer implementation quality from this packet.

## Scope

Implement versioned tool definitions and application session types in application code, using in-memory catalogues. Integrate typed sessions with the existing AHP host and public factories. Persistence is a later phase. The AHP server does not execute models, Pi, or tools.

## Requirements

| ID | Requirement |
|---|---|
| N01 | Existing repository instructions, module naming, aliases, tests under `src/tests/`, and documentation coverage remain respected. |
| N02 | Tool definitions are JSON-compatible data with stable explicit revision UUID, key, positive integer version, name, declared schema dialect, and required object-root input schema. |
| N03 | Tool schemas are actually validated with a real schema validator, not only object-shape checks or unsafe casts. |
| N04 | First-slice schema profile is draft-07, no refs, no regex/format plugins, no async/custom executable keywords, bounded size/depth, no remote loading. |
| N05 | Compiled validators remain internal and are not stored in portable definitions; input/output validation does not execute tools or mutate arguments. |
| N06 | Exact-version tool catalogue construction is atomic; duplicate UUID or `(key,version)` registrations fail. |
| N07 | Public catalogue reads and input capture cannot mutate another caller's definitions, schemas, metadata, or caches. |
| N08 | No implicit latest-version lookup, name-only compatibility, or semantic-schema-equivalence claim. |
| N09 | Output without a declared schema is reported as not validated, not successful schema validation. |
| N10 | A session type is an immutable portable definition plus a separately registered code parser; parsers are not serialized. |
| N11 | Each type references exact tool revisions and rejects missing refs, duplicate refs, multiple revisions of one logical tool, and duplicate wire names. |
| N12 | Creation-enabled policy blocks new creation from disabled types while preserving existing exact-definition lookup. |
| N13 | Providers stay code registered; missing provider/default references fail composition before listener startup. |
| N14 | Application configuration and existing provider configuration are separate and independently validated; no bypass of the mock's provider config contract. |
| N15 | `createApplicationSession` and native `createSession` use the same internal creation path and existing live session registry. |
| N16 | Deterministic type/config/manifest failures occur before record registration, provider startup, or accepted publication. |
| N17 | Every typed session pins a type revision; publishing/seeding another version or changing a later default never silently changes the existing session. |
| N18 | Type binding and manifest respect late-create/dispose/URI-reuse generation boundaries. |
| N19 | Application-enabled hosts require an exact selector or explicit default; no silent fallback to untyped sessions. Untyped hosts retain documented legacy behavior. |
| N20 | Native AHP wire method shapes remain intact. `x-ahp-session-type` is an application selector inside `config`, not an invented standard top-level field. |
| N21 | Selector fields are extracted before provider validation without mutating caller input or discarding unrelated provider config. |
| N22 | Allowed manifest is server-authored under `_meta["x-ahp-application"]`, versioned, size-bounded, deterministic, and derived from exact definitions. |
| N23 | Allowed definitions are never falsely advertised as executable `serverTools` or a fabricated active client. |
| N24 | Typed advertisements contain exact revision metadata under `x-ahp-tool-contract`; schemas and names must conservatively match allowed contracts. |
| N25 | Contract-bearing schema keywords survive the actual wire/action parse path; untrusted schemas are compared, not compiled/downloaded. |
| N26 | Typed advertisement checks are atomic; a valid/invalid mixed list cannot partially alter active-client state. Subsets and empty lists are permitted. |
| N27 | Nested client identity on typed set/removal is consistent with connection-derived origin. This does not claim full authentication or RBAC. |
| N28 | Well-formed policy rejections use an AHP rejection envelope, no accepted state mutation, no fan-out to other clients, and delivery to the actual origin connection. |
| N29 | Malformed notifications do not receive illegal JSON-RPC responses and are never cast into fake actions. Request-shaped dispatch remains invalid. |
| N30 | The client action allowlist is not widened to permit metadata replacement, server-tools publication, or type switching. |
| N31 | Two real SDK clients can create/subscribe/inspect the same typed session and manifest; retained tests exercise negative wire behavior as well. |
| N32 | Two hosts composed through public APIs remain isolated in sessions, defaults, sequences, mutable catalogue data, and notifications. |
| N33 | Application consumers do not import private protocol helpers or construct JSON-RPC envelopes just to create a session. |
| N34 | New public methods respect the composed host's terminal stop state; existing entrypoint import guards remain intact. |
| N35 | Tool catalogue inclusion, client advertisement, live availability, and authorization are distinctly documented; no execution/availability guarantee is invented. |
| N36 | Runtime records, active clients, sockets, subscriptions, and handles remain live concerns; no SQL, Redis, ORM, journal, or fake durable repository is implemented. |
| N37 | Future mapping remains five tables: host_state, sessions, session_types, tools, session_type_tools; current code only makes definitions serialization-ready. |
| N38 | Documentation describes the implemented scope, preserves target-state plans, and does not claim restart recovery or persistence. |
| N39 | Retained tests use actual assertions, causal barriers/deferred promises, cleanup, and sanitized fixture data; passing results identify the exact tested candidate. |
| N40 | Independent review conditions and limits are reported honestly; reviewer agreement is not used as a substitute for evidence. |

## Facts to verify rather than assume

The baseline uses in-memory sessions and a mock provider. The existing namespace/config/action parsers, lifecycle handling, and native SDK types must be read in the frozen candidate. Existing issues outside the new feature remain separate unless they directly prevent a requirement above.

A successful review covers these requirements and important counterexamples; it does not certify the whole AHP specification, production security, schema-language equivalence, or a client's tool implementation.
