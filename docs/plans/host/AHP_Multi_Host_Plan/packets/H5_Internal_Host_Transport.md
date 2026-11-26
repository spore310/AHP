# H5 — Authenticated internal host routing

**Status:** implemented on the candidate in [HANDOFF](../HANDOFF.md). Per-criterion status is in the handoff. **Evidence:** [handoff](../handoffs/H5.md). **Shared rules:** [CONTRACTS](../CONTRACTS.md).

## Outcome

Route validated operations to their authoritative host while preserving original caller identity, authorization and bounded transport behavior.

## Prerequisites

- H4
- DECISIONS D03, D04 and D07 resolved

## Existing owners and source anchors

- `./src/websocket/helpers/host/work.ts`
- `./src/websocket/helpers/security/types.ts`
- `./src/authorization/types.ts`
- `./src/authorization/helpers/evaluate/types.ts`
- `./src/client/README.md`
- `./src/tool/README.md`

Read the public exports, direct callers, relevant module README and tests for these anchors. Source paths name the inspected baseline; resolve moves before editing. Proposed tests listed below do not exist merely because they appear in this plan.

## Required changes

1. Treat internalHostTransport as a narrow replaceable host request/reply capability. Reuse current JSON-RPC, validation, cancellation and lifecycle patterns where suitable; do not add another native SDK receive loop.
2. Prefer a standard TLS-protected transport for the first network adapter, with a deterministic in-memory adapter for tests. Concrete protocol/version and adapter location must follow the existing capability boundaries.
3. Resolve destinations from trusted, namespace-scoped membership. Bind the authenticated sender, destination/audience, namespace, instance generation, operation and request identity; never accept arbitrary client-provided routing URLs.
4. Separate authenticated host authority from the original user/agent's authority. Carry a verifiable original identity/delegation reference and exact target facts; the destination must establish current local authority before effects.
5. A serialized context object or local decision stamp is not remote proof. Define the trusted resolver/revalidation contract and its failure behavior instead of forwarding allow:true, claimed roles, callbacks or a raw user token indiscriminately.
6. Route session operations to the current owner and route client-executed tool delivery to the process owning the exact connection/generation. Preserve caller versus executor separation.
7. Enforce runtime schemas, message/queue/byte limits, bounded in-flight calls, deadlines, cancellation propagation, hop limits and cleanup on disconnect/drain.
8. Reuse existing requestKey/idempotency semantics where present. Retry only operations with proven replay safety; a lost response after a mutation yields an unknown outcome that must be reconciled.
9. Keep internal endpoints distinct from public client initialization and protect internal responses as well as requests. Define version compatibility and safe rejection during rolling upgrades.

## Decisions to resolve

- D07: exact sender/original-actor proof, destination discovery, transport schemas, deadlines, duplicate/replay handling and unknown-outcome semantics.

## Acceptance and required proof

| ID | Required result | Proof that must be recorded |
| --- | --- | --- |
| H5-01 | A public request arriving at a non-owner reaches the correct session owner and returns through the original connection. | Two real host processes, with ingress deliberately different from owner; observe the executed owner and exact resource incarnation. |
| H5-02 | Valid host credentials cannot impersonate a user or grant unrelated execution authority. | Forge actor, roles, namespace, claim, audience, operation and target; assert no effects or protected output. |
| H5-03 | Copied local stamps and forged connection references are rejected. | Cross-process JSON copies plus wrong/old instance and connection generation tests. |
| H5-04 | Ownership changes during route lookup/forwarding cannot produce stale writes or routing loops. | Pause lookup, transfer ownership, resume; bounded redirect/re-resolution and exact epoch enforcement. |
| H5-05 | Loss, timeout or duplication of a mutation response does not cause an unsafe replay. | Drop reply after commit; retry with preserved immutable intent or report/reconcile unknown outcome. |
| H5-06 | Revocation at ingress, owner or final send is honored according to the shared authority contract. | Controlled awaits before remote admission and before delivery, including dropped invalidation hints. |
| H5-07 | Cancellation, overload and shutdown release all transport-owned resources within the documented bound. | Queue saturation, blocked handlers, late responses and double-close tests; inspect pending counts and memory bounds. |
| H5-08 | Public clients cannot reach administrative/internal operations through native or private-extension routes. | Attempt internal envelopes on public endpoints; require explicit authenticated internal protocol negotiation. |
| H5-09 | Destination registration cannot become arbitrary network access. | Reject untrusted endpoints, protocol/version mismatch and a valid endpoint registered for another namespace. |
| H5-10 | TLS/credential errors remain sanitized and no credential appears in replay/event records. | Inspect structured diagnostics, failure payloads and retained request metadata. |

## Verification targets

- src/tests/host/transport.test.ts (proposed)
- src/tests/host/routing.integration.test.ts (proposed)
- Existing client transport, cancellation and tool caller/executor tests

Focused command template after the proposed test files are implemented; reconcile paths with the checkout and record the command actually used:

```sh
pnpm exec vitest run src/tests/host/transport.test.ts src/tests/host/routing.integration.test.ts src/tests/client
```

For criteria that depend on database behavior, use the disposable environment in `docs/guides/postgresql.md`, verify actual applied migrations and ensure new conformance scenarios are wired into the executed entry point. Required database/multiprocess cases may not silently skip:

```sh
pnpm exec vite-node examples/postgresql-conformance.ts
```

Run the relevant public examples and the repository-required final gate for the integrated candidate:

```sh
pnpm validate
```

Use controlled concurrency barriers rather than timing-only sleeps. Preserve relevant existing regression suites. Source inspection, mocks, PostgreSQL checks and public SDK tests are separate evidence categories.

## Handoff required

Complete [the packet handoff](../handoffs/H5.md) with the exact candidate, changed files, per-criterion evidence, actual commands/results, review dispositions, compatibility/documentation impact and next action. Update the root acceptance/status documents. No criterion is satisfied merely by adding its test.

## Stop condition

Do not enable general remote mutation by merely trusting an internal network or a shared namespace secret.

Any required gate that fails or cannot run leaves the packet FAIL/BLOCKED/validation incomplete as appropriate. Finish safe independent work, state the concrete limitation and do not enable a dependent mode prematurely.

