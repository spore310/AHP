# H1 — Host identity, application namespaces and admission

**Status:** implemented on the candidate in [HANDOFF](../HANDOFF.md). Per-criterion status is in the handoff. **Evidence:** [handoff](../handoffs/H1.md). **Shared rules:** [CONTRACTS](../CONTRACTS.md).

## Outcome

Define one coherent configuration contract for the default host and application-owned namespaces, with authenticated host membership and explicit infrastructure claims.

## Prerequisites

- H0
- DECISIONS D01, D02 and D03 resolved

## Existing owners and source anchors

- `./src/websocket/helpers/host/types.ts`
- `./src/agents/types.ts`
- `./src/authorization/types.ts`
- `./src/authorization/helpers/policies/helpers/namespace/helpers.ts`
- `./src/authorization/helpers/policies/helpers/factory/helpers.ts`
- `./src/persistence/helpers/durability/types.ts`

Read the public exports, direct callers, relevant module README and tests for these anchors. Source paths name the inspected baseline; resolve moves before editing. Proposed tests listed below do not exist merely because they appear in this plan.

## Required changes

1. Default to one logical host, one namespace and local/single mode. Give the consuming application a readable stable host name, preferably by extending hostId semantics compatibly instead of adding duplicate hostName/name/clusterName fields.
2. Support explicitly chosen namespaces and a deterministic default derived from the configured app-style host name. Different host IDs may select the same canonical namespace under trusted admission policy. Advanced allocation may admit a host to more than one explicit namespace.
3. Define a single canonical namespace identity and the smallest useful configuration shape. If a shorthand is accepted, normalize it once at configuration capture and use only the canonical value internally.
4. Validate new slug-based names; reject ambiguous normalization, empty segments, invalid escapes and collisions. Never silently slugify an existing opaque durable ID or migrate identity when a display name changes.
5. Keep the current policy NamespaceRef meaning intact. Host namespace, policy namespace, security domain, logical host, running instance, connection generation, session incarnation and work execution epoch must have documented, distinct meanings without duplicate concepts.
6. Bind each public native AHP connection to one configured namespace for the initial implementation; a trusted application selector may choose it from endpoint/authenticated context. A client-supplied selector is intent, never proof of membership. Cross-namespace multiplexing on one native connection is not part of the baseline.
7. Use a fixed identifier prefix with the app/host slug in the namespace-specific value; inspect existing identifier conventions before selecting a production URN/URI scheme. Documentation may use urn:example only as an illustration. Do not change native ahp-session: URIs.
8. Reuse authentication/authorization primitives where they fit. Add a host-specific identity/context type only where host membership cannot correctly be represented by existing contracts; never cast a host into a user/agent actor.
9. A trusted application-controlled configuration authority binds credentials to allowed namespace/host pairs and allowed operations. Joining hosts cannot register their own verifier, grant themselves claims or change namespace mode.
10. Use a secret provider and standard authenticated transport. Provide credential IDs/revisions, bounded rotation overlap, expiry, revocation and optional instance-count limits. A shared per-host secret authenticates that logical host, not a physical Pod UID.
11. Define registration, namespace deletion/recreation and configuration capture/update behavior. If namespace IDs can be reused, fence earlier memberships/resources; otherwise explicitly prohibit reuse.

## Decisions to resolve

- D01: exact backward-compatible identity/config shape and production identifier convention.
- D02: trusted bootstrap/provisioning authority and host-credential verification mechanism.
- D03: cluster trust boundary and explicit credential/revocation semantics; arbitrary shared database access is outside SDK-only isolation.

## Acceptance and required proof

| ID | Required result | Proof that must be recorded |
| --- | --- | --- |
| H1-01 | The minimal configuration starts one local host without distributed dependencies. | Run the public factory with no cluster adapter and verify the resolved defaults; no network membership service is contacted. |
| H1-02 | An app-style host name yields the same default namespace across restarts; explicit namespace selection overrides only that default. | Configuration table tests, restart fixture and captured resolved config; reject ambiguous alias/canonical combinations. |
| H1-03 | Different authorized host IDs can target one namespace; unauthorized host/namespace pairs are denied. | Positive and negative admission matrix, including a valid secret for a different host or namespace. |
| H1-04 | Naming cannot collapse distinct identities or silently change existing durable IDs. | Collision, case, whitespace, Unicode, separator, percent-encoding, oversized input and legacy-ID cases. |
| H1-05 | Host authentication cannot grant application user/tool/work rights or bootstrap administrative policy. | Attempt self-issued claims, forged actor/roles, foreign namespace and untrusted verifier registration; assert zero membership/ownership effects. |
| H1-06 | Credential rotation, revocation and expiry have explicit observable behavior. | Old/new credential overlap, deadline boundary, revoked existing member and rejected rejoin; secrets absent from errors/events/logs. |
| H1-07 | Logical host identity remains stable while runtime instance identity changes. | Two replicas of one host and one restarted replica; stale instance reference cannot impersonate the replacement. |
| H1-08 | The existing policy namespace compiler and native resource URI meanings are unchanged. | Existing policy namespace/include and SDK URI regressions plus terminology/reuse review. |
| H1-09 | Namespace bootstrap and policy changes come only from the trusted configured authority. | Two conflicting bootstrap/config revisions fail deterministically; no first-joining-host-wins authorization. |
| H1-10 | Invalid topology/adapter combinations fail before accepting public traffic. | Reject shared coordination without required authentication/fencing capabilities and reject conflicting namespace mode declarations. |

## Verification targets

- src/tests/host/configuration.test.ts (proposed)
- src/tests/host/admission.test.ts (proposed)
- Existing src/tests/authorization/ policy and identity tests

Focused command template after the proposed test files are implemented; reconcile paths with the checkout and record the command actually used:

```sh
pnpm exec vitest run src/tests/host/configuration.test.ts src/tests/host/admission.test.ts src/tests/authorization
```

Run the relevant public examples and the repository-required final gate for the integrated candidate:

```sh
pnpm validate
```

Use controlled concurrency barriers rather than timing-only sleeps. Preserve relevant existing regression suites. Source inspection, mocks, PostgreSQL checks and public SDK tests are separate evidence categories.

## Handoff required

Complete [the packet handoff](../handoffs/H1.md) with the exact candidate, changed files, per-criterion evidence, actual commands/results, review dispositions, compatibility/documentation impact and next action. Update the root acceptance/status documents. No criterion is satisfied merely by adding its test.

## Stop condition

Do not implement distributed admission until bootstrap authority, identifier equality and credential lifecycle are concrete and reviewed.

Any required gate that fails or cannot run leaves the packet FAIL/BLOCKED/validation incomplete as appropriate. Finish safe independent work, state the concrete limitation and do not enable a dependent mode prematurely.

