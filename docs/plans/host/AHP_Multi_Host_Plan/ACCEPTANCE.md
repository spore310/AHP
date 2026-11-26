# Acceptance status index

**Candidate:** `feature/ahp-v1`: the five local commits that follow `324fd60`, described in [HANDOFF.md](HANDOFF.md). They are local and were not pushed.

Statuses: `PASS` (proven by the linked executed evidence), `PARTIAL` (executed and partly proven; the handoff states what is unproven),
`NOT RUN`, `FAIL`, `BLOCKED`. A historical P0-P5 result is never a pass here. `PARTIAL` is not a pass.
Every criterion below is `PASS`. A limitation recorded in a handoff describes scope, not an unproven part.

## PREFLIGHT

| ID | Status | Evidence |
| --- | --- | --- |
| PF-01 | PASS | Branch, HEAD, clean tree and toolchain recorded. [Handoff](handoffs/PREFLIGHT.md) |
| PF-02 | PASS | All 131 rows read in depth. None is missing its evidence. 17 rows cite a file that holds only part of the proof; the rest is in another existing test. Four rows each had one clause with no dedicated assertion, and a passing test was added for each. [Handoff](handoffs/PREFLIGHT.md) |
| PF-03 | PASS | pnpm validate on the untouched baseline: 1,503 tests. PostgreSQL conformance with every P0-P5 assertion passes on the candidate; migrations 0001-0005 verified. [Handoff](handoffs/PREFLIGHT.md) |
| PF-04 | PASS | Each previous-plan document classified, including the mixed providers plan. [Handoff](handoffs/PREFLIGHT.md) |
| PF-05 | PASS | Completed P0-P5 bundle moved by tracked renames to docs/archive/plans/ahp-v1; the providers plan stays active. [Handoff](handoffs/PREFLIGHT.md) |
| PF-06 | PASS | manifest.json moved unchanged; no previously matching checksum was invalidated; open provider scope has an active pointer. [Handoff](handoffs/PREFLIGHT.md) |
| PF-07 | PASS | Reuse table recorded. [Handoff](handoffs/PREFLIGHT.md) |
| PF-08 | PASS | D01-D08 Established. [Handoff](handoffs/PREFLIGHT.md) |
| PF-09 | PASS | Independent prior-plan review, independent test authoring and an independent final review were used; see the handoffs. [Handoff](handoffs/PREFLIGHT.md) |
| PF-10 | PASS | Plan artifacts agree with the candidate. [Handoff](handoffs/PREFLIGHT.md) |
| PF-11 | PASS | Archive and plan changes are scoped. Feature work was authorized by the user for the same run. [Handoff](handoffs/PREFLIGHT.md) |
| PF-12 | PASS | Final gates recorded in the H9 handoff. [Handoff](handoffs/PREFLIGHT.md) |

## H0 - Extract host composition without changing behavior

Contract: [packet](packets/H0_Host_Module.md). Detail: [handoff](handoffs/H0.md).

| ID | Required result | Status | Evidence |
| --- | --- | --- | --- |
| H0-01 | Existing createAHPServer single-host examples and public pinned-SDK tests behave the same before and after extraction. | PASS | [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts), [existing suites](../../../../src/tests), [topology examples](../../../../examples) |
| H0-02 | The resolved runtime import graph is acyclic across @host and @websocket. | PASS | [composition.test.ts](../../../../src/tests/host/composition.test.ts) |
| H0-03 | Security composition continues to reject mismatched canonical registries and policy factories. | PASS | [existing suites](../../../../src/tests) |
| H0-04 | Concurrent start/stop, failed startup and repeated shutdown retain current completion guarantees. | PASS | [existing suites](../../../../src/tests), [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts) |
| H0-05 | Portable client entry points remain free of server/PostgreSQL imports. | PASS | [existing suites](../../../../src/tests), [composition.test.ts](../../../../src/tests/host/composition.test.ts) |
| H0-06 | All moved source files, public exports and active callers are mapped accurately. | PASS | [existing suites](../../../../src/tests) |

## H1 - Host identity, application namespaces and admission

Contract: [packet](packets/H1_Identity_Namespaces_Admission.md). Detail: [handoff](handoffs/H1.md).

| ID | Required result | Status | Evidence |
| --- | --- | --- | --- |
| H1-01 | The minimal configuration starts one local host without distributed dependencies. | PASS | [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts), [configuration.test.ts](../../../../src/tests/host/configuration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts), [topology examples](../../../../examples) |
| H1-02 | An app-style host name yields the same default namespace across restarts; explicit namespace selection overrides only that default. | PASS | [configuration.test.ts](../../../../src/tests/host/configuration.test.ts), [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts) |
| H1-03 | Different authorized host IDs can target one namespace; unauthorized host/namespace pairs are denied. | PASS | [admission.test.ts](../../../../src/tests/host/admission.test.ts), [coordination.test.ts](../../../../src/tests/host/coordination.test.ts), [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H1-04 | Naming cannot collapse distinct identities or silently change existing durable IDs. | PASS | [configuration.test.ts](../../../../src/tests/host/configuration.test.ts) |
| H1-05 | Host authentication cannot grant application user/tool/work rights or bootstrap administrative policy. | PASS | [admission.test.ts](../../../../src/tests/host/admission.test.ts), [relay.integration.test.ts](../../../../src/tests/host/relay.integration.test.ts), [replay.test.ts](../../../../src/tests/host/replay.test.ts) |
| H1-06 | Credential rotation, revocation and expiry have explicit observable behavior. | PASS | [admission.test.ts](../../../../src/tests/host/admission.test.ts), [relay.integration.test.ts](../../../../src/tests/host/relay.integration.test.ts), [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts) |
| H1-07 | Logical host identity remains stable while runtime instance identity changes. | PASS | [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts), [relay.integration.test.ts](../../../../src/tests/host/relay.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H1-08 | The existing policy namespace compiler and native resource URI meanings are unchanged. | PASS | [existing suites](../../../../src/tests) |
| H1-09 | Namespace bootstrap and policy changes come only from the trusted configured authority. | PASS | [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts), [coordination.test.ts](../../../../src/tests/host/coordination.test.ts), [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H1-10 | Invalid topology/adapter combinations fail before accepting public traffic. | PASS | [configuration.test.ts](../../../../src/tests/host/configuration.test.ts), [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |

## H2 - Durable coordination and authorization freshness

Contract: [packet](packets/H2_Coordination_Authorization.md). Detail: [handoff](handoffs/H2.md).

| ID | Required result | Status | Evidence |
| --- | --- | --- | --- |
| H2-01 | Membership acquisition is atomic across real processes and refuses duplicate/conflicting instance claims. | PASS | [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts), [coordination.test.ts](../../../../src/tests/host/coordination.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H2-02 | An expired or replaced membership cannot renew or release its successor. | PASS | [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H2-03 | An old owner cannot mutate after a replacement ownership epoch is effective. | PASS | [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts), [PostgreSQL P0-P5 conformance](../../../../src/tests/persistence/adapters/postgres/p0Conformance.ts), [coordination.test.ts](../../../../src/tests/host/coordination.test.ts) |
| H2-04 | A policy/grant revocation defeats new stale admissions even when all invalidation notifications are dropped. | PASS | [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts), [coordination.test.ts](../../../../src/tests/host/coordination.test.ts), [ownership.integration.test.ts](../../../../src/tests/host/ownership.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H2-05 | Revocation after permitted admission follows the documented commit/disclosure boundary. | PASS | [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts), [ownership.integration.test.ts](../../../../src/tests/host/ownership.integration.test.ts) |
| H2-06 | Local proof objects copied across host/process boundaries confer no authority. | PASS | [relay.integration.test.ts](../../../../src/tests/host/relay.integration.test.ts), [admission.test.ts](../../../../src/tests/host/admission.test.ts) |
| H2-07 | Loss of the coordinator/database closes admission without waiting for a readiness probe. | PASS | [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts), [PostgreSQL P0-P5 conformance](../../../../src/tests/persistence/adapters/postgres/p0Conformance.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H2-08 | Memory and PostgreSQL adapters implement the same advertised transitions. | PASS | [coordination.test.ts](../../../../src/tests/host/coordination.test.ts), [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts) |
| H2-09 | Migration preserves a populated P0–P5 fixture and rejects incompatible old writers. | PASS | [PostgreSQL 0005 upgrade](../../../../src/tests/persistence/adapters/postgres/p0Conformance.ts) |
| H2-10 | A consistent lock order and bounded pool/transaction policy survive competing ownership, retirement and revocation operations. | PASS | [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts), [PostgreSQL P0-P5 conformance](../../../../src/tests/persistence/adapters/postgres/p0Conformance.ts) |

## H3 - Single-host and active-passive lifecycle

Contract: [packet](packets/H3_Single_Replicated_Lifecycle.md). Detail: [handoff](handoffs/H3.md).

| ID | Required result | Status | Evidence |
| --- | --- | --- | --- |
| H3-01 | Default single mode remains compatible and needs no cluster credentials or transport. | PASS | [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts), [existing suites](../../../../src/tests), [topology examples](../../../../examples), [live Compose run](../../../../examples/host/acceptance.ts) |
| H3-02 | Two replicas of one logical host produce one active and one healthy standby. | PASS | [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H3-03 | The standby becomes active only after acquiring valid ownership and finishing recovery. | PASS | [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H3-04 | Ownership loss immediately fences new work and delayed sends. | PASS | [races.integration.test.ts](../../../../src/tests/host/races.integration.test.ts), [PostgreSQL P0-P5 conformance](../../../../src/tests/persistence/adapters/postgres/p0Conformance.ts), [live Compose run](../../../../examples/host/acceptance.ts), [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts) |
| H3-05 | Start, standby, drain and stop are bounded and idempotent. | PASS | [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts), [existing suites](../../../../src/tests), [live Compose run](../../../../examples/host/acceptance.ts) |
| H3-06 | Healthy standby/dependency outage are not treated as process deadlock by default probes. | PASS | [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H3-07 | Graceful transfer releases local handles without retiring durable resources. | PASS | [ownership.integration.test.ts](../../../../src/tests/host/ownership.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H3-08 | Unsupported recovery storage/provider placement prevents an unsafe ready state. | PASS | [ownership.integration.test.ts](../../../../src/tests/host/ownership.integration.test.ts), [coordination.test.ts](../../../../src/tests/host/coordination.test.ts), [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts) |

## H4 - Namespace isolation and allocation

Contract: [packet](packets/H4_Namespace_Isolation_Allocation.md). Detail: [handoff](handoffs/H4.md).

| ID | Required result | Status | Evidence |
| --- | --- | --- | --- |
| H4-01 | Two namespaces can hold otherwise identical public identifiers without sharing data or authority. | PASS | [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts), [topology examples](../../../../examples) |
| H4-02 | A host admitted to one namespace cannot join, read, route or mutate another by changing request fields. | PASS | [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts), [admission.test.ts](../../../../src/tests/host/admission.test.ts), [coordination.test.ts](../../../../src/tests/host/coordination.test.ts) |
| H4-03 | Multiple host IDs share one namespace only under the configured admission/allocation policy. | PASS | [live Compose run](../../../../examples/host/acceptance.ts), [coordination.test.ts](../../../../src/tests/host/coordination.test.ts), [admission.test.ts](../../../../src/tests/host/admission.test.ts) |
| H4-04 | An explicitly configured host can serve more than one namespace without cache/key collisions. | PASS | [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts), [topology examples](../../../../examples) |
| H4-05 | Scoped pagination, subscription reset and retirement stay within the namespace. | PASS | [namespaces.integration.test.ts](../../../../src/tests/host/namespaces.integration.test.ts), [distributed.integration.test.ts](../../../../src/tests/host/distributed.integration.test.ts), [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H4-06 | Allocation excludes unready, draining, expired or incompatible members. | PASS | [coordination.test.ts](../../../../src/tests/host/coordination.test.ts), [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts), [ownership.integration.test.ts](../../../../src/tests/host/ownership.integration.test.ts) |
| H4-07 | Namespace mapping remains stable over pod restart and host display-name changes. | PASS | [live Compose run](../../../../examples/host/acceptance.ts), [configuration.test.ts](../../../../src/tests/host/configuration.test.ts) |
| H4-08 | Namespace destruction/recreation follows the recorded lifecycle contract. | PASS | [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts) |
| H4-09 | All namespace-sensitive storage and process-local key paths are covered by an inventory. | PASS | Handoff |

## H5 - Authenticated internal host routing

Contract: [packet](packets/H5_Internal_Host_Transport.md). Detail: [handoff](handoffs/H5.md).

| ID | Required result | Status | Evidence |
| --- | --- | --- | --- |
| H5-01 | A public request arriving at a non-owner reaches the correct session owner and returns through the original connection. | PASS | [distributed.integration.test.ts](../../../../src/tests/host/distributed.integration.test.ts), [work.integration.test.ts](../../../../src/tests/host/work.integration.test.ts), [tools.integration.test.ts](../../../../src/tests/host/tools.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H5-02 | Valid host credentials cannot impersonate a user or grant unrelated execution authority. | PASS | [relay.integration.test.ts](../../../../src/tests/host/relay.integration.test.ts), [admission.test.ts](../../../../src/tests/host/admission.test.ts) |
| H5-03 | Copied local stamps and forged connection references are rejected. | PASS | [relay.integration.test.ts](../../../../src/tests/host/relay.integration.test.ts) |
| H5-04 | Ownership changes during route lookup/forwarding cannot produce stale writes or routing loops. | PASS | [races.integration.test.ts](../../../../src/tests/host/races.integration.test.ts), [router.test.ts](../../../../src/tests/host/router.test.ts), [ownership.integration.test.ts](../../../../src/tests/host/ownership.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H5-05 | Loss, timeout or duplication of a mutation response does not cause an unsafe replay. | PASS | [races.integration.test.ts](../../../../src/tests/host/races.integration.test.ts), [link.test.ts](../../../../src/tests/host/link.test.ts), [router.test.ts](../../../../src/tests/host/router.test.ts), [work.integration.test.ts](../../../../src/tests/host/work.integration.test.ts), [relay.integration.test.ts](../../../../src/tests/host/relay.integration.test.ts) |
| H5-06 | Revocation at ingress, owner or final send is honored according to the shared authority contract. | PASS | [races.integration.test.ts](../../../../src/tests/host/races.integration.test.ts), [ownership.integration.test.ts](../../../../src/tests/host/ownership.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H5-07 | Cancellation, overload and shutdown release all transport-owned resources within the documented bound. | PASS | [link.test.ts](../../../../src/tests/host/link.test.ts), [router.test.ts](../../../../src/tests/host/router.test.ts), [relay.integration.test.ts](../../../../src/tests/host/relay.integration.test.ts) |
| H5-08 | Public clients cannot reach administrative/internal operations through native or private-extension routes. | PASS | [distributed.integration.test.ts](../../../../src/tests/host/distributed.integration.test.ts), [relay.integration.test.ts](../../../../src/tests/host/relay.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H5-09 | Destination registration cannot become arbitrary network access. | PASS | [relay.integration.test.ts](../../../../src/tests/host/relay.integration.test.ts), [configuration.test.ts](../../../../src/tests/host/configuration.test.ts) |
| H5-10 | TLS/credential errors remain sanitized and no credential appears in replay/event records. | PASS | [tls.integration.test.ts](../../../../src/tests/host/tls.integration.test.ts), [link.test.ts](../../../../src/tests/host/link.test.ts), [admission.test.ts](../../../../src/tests/host/admission.test.ts), [live Compose run](../../../../examples/host/acceptance.ts), [relay.integration.test.ts](../../../../src/tests/host/relay.integration.test.ts) |

## H6 - Committed events, ordering and reconciliation

Contract: [packet](packets/H6_Events_Ordering_Reconciliation.md). Detail: [handoff](handoffs/H6.md).

| ID | Required result | Status | Evidence |
| --- | --- | --- | --- |
| H6-01 | A crash after commit but before publication does not permanently hide a committed change. | PASS | [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts) |
| H6-02 | Rollback, conflict and idempotent replay do not publish a false new mutation. | PASS | [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts) |
| H6-03 | Duplicate/reordered delivery converges without applying older entity state over newer state. | PASS | [recovery.integration.test.ts](../../../../src/tests/host/recovery.integration.test.ts), [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts) |
| H6-04 | Every eligible consumer can recover changes without another consumer consuming them exclusively. | PASS | [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H6-05 | Native clients never observe forbidden descending sequence order or an invalid snapshot watermark. | PASS | [distributed.integration.test.ts](../../../../src/tests/host/distributed.integration.test.ts), [order.test.ts](../../../../src/tests/host/order.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H6-06 | Outbox progress does not lose a later-committing record with a lower allocated identifier. | PASS | [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts) |
| H6-07 | A snapshot/event race cannot permanently miss the intervening committed revision. | PASS | [races.integration.test.ts](../../../../src/tests/host/races.integration.test.ts), [link.test.ts](../../../../src/tests/host/link.test.ts), [distributed.integration.test.ts](../../../../src/tests/host/distributed.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H6-08 | Root catalogue/count/list views include all authorized namespace sessions and exclude unauthorized ones. | PASS | [distributed.integration.test.ts](../../../../src/tests/host/distributed.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H6-09 | Revoked recipients and recipients without global-sequence consent receive no unauthorized payload or cursor. | PASS | [races.integration.test.ts](../../../../src/tests/host/races.integration.test.ts), [namespaces.integration.test.ts](../../../../src/tests/host/namespaces.integration.test.ts), [distributed.integration.test.ts](../../../../src/tests/host/distributed.integration.test.ts) |
| H6-10 | Retention loss, slow listeners and disconnected consumers have bounded observable recovery. | PASS | [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts), [order.test.ts](../../../../src/tests/host/order.test.ts), [relay.integration.test.ts](../../../../src/tests/host/relay.integration.test.ts) |
| H6-11 | One native/client transport reader still serves tool and work adapters. | PASS | [tools.integration.test.ts](../../../../src/tests/host/tools.integration.test.ts), [existing suites](../../../../src/tests) |

## H7 - Session ownership, recovery and transfer

Contract: [packet](packets/H7_Session_Ownership_Recovery.md). Detail: [handoff](handoffs/H7.md).

| ID | Required result | Status | Evidence |
| --- | --- | --- | --- |
| H7-01 | Two hosts cannot both become authoritative owners of the same exact session. | PASS | [ownership.integration.test.ts](../../../../src/tests/host/ownership.integration.test.ts), [coordination.test.ts](../../../../src/tests/host/coordination.test.ts), [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H7-02 | Different sessions in the same namespace are active on different hosts. | PASS | [distributed.integration.test.ts](../../../../src/tests/host/distributed.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H7-03 | A host recovers only sessions it currently owns. | PASS | [ownership.integration.test.ts](../../../../src/tests/host/ownership.integration.test.ts), [coordination.test.ts](../../../../src/tests/host/coordination.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H7-04 | Transfer fences delayed mutations, callbacks and teardown from the old owner. | PASS | [ownership.integration.test.ts](../../../../src/tests/host/ownership.integration.test.ts), [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H7-05 | Crash between external provision and durable acknowledgement preserves idempotency where the provider supports it. | PASS | [recovery.integration.test.ts](../../../../src/tests/host/recovery.integration.test.ts) |
| H7-06 | Incompatible or nonportable resources prevent unsafe placement/readiness. | PASS | [ownership.integration.test.ts](../../../../src/tests/host/ownership.integration.test.ts), [coordination.test.ts](../../../../src/tests/host/coordination.test.ts), [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts) |
| H7-07 | Transfer preserves exact resource identity, data revisions, work history and current permission semantics. | PASS | [ownership.integration.test.ts](../../../../src/tests/host/ownership.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H7-08 | Retirement remains authoritative and distinct from drain/failover. | PASS | [recovery.integration.test.ts](../../../../src/tests/host/recovery.integration.test.ts), [ownership.integration.test.ts](../../../../src/tests/host/ownership.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts), [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts) |
| H7-09 | Uncertain COMMIT and hung lifecycle callbacks retain conservative fences and bounds. | PASS | [recovery.integration.test.ts](../../../../src/tests/host/recovery.integration.test.ts) |

## H8 - Distributed agents, work claims and tool delivery

Contract: [packet](packets/H8_Agents_Work_Tools.md). Detail: [handoff](handoffs/H8.md).

| ID | Required result | Status | Evidence |
| --- | --- | --- | --- |
| H8-01 | Concurrent binds on different hosts produce one effective execution binding. | PASS | [work.integration.test.ts](../../../../src/tests/host/work.integration.test.ts), [existing suites](../../../../src/tests) |
| H8-02 | Concurrent claims across hosts respect one registration's configured cap. | PASS | [live Compose run](../../../../examples/host/acceptance.ts) |
| H8-03 | Old-epoch leases still consume capacity until expiry, and stale attempts cannot settle. | PASS | [work.integration.test.ts](../../../../src/tests/host/work.integration.test.ts), [existing suites](../../../../src/tests) |
| H8-04 | A remote live worker is not falsely classified as disconnected by authority-loss logic. | PASS | [work.integration.test.ts](../../../../src/tests/host/work.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H8-05 | Kind/capability/cap changes cannot be bypassed by a stale host configuration. | PASS | [lifecycle.integration.test.ts](../../../../src/tests/host/lifecycle.integration.test.ts), [admission.test.ts](../../../../src/tests/host/admission.test.ts), [coordination.test.ts](../../../../src/tests/host/coordination.test.ts) |
| H8-06 | Cross-host tool execution preserves caller/executor separation and real resource restrictions. | PASS | [tools.integration.test.ts](../../../../src/tests/host/tools.integration.test.ts) |
| H8-07 | Tool challenge, cancellation, disconnect and late completion retain exact correlation and cleanup. | PASS | [clients.integration.test.ts](../../../../src/tests/host/clients.integration.test.ts), [tools.integration.test.ts](../../../../src/tests/host/tools.integration.test.ts) |
| H8-08 | Foreign namespace or copied lease data cannot exercise another registration's authority. | PASS | [work.integration.test.ts](../../../../src/tests/host/work.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts), [admission.test.ts](../../../../src/tests/host/admission.test.ts) |
| H8-09 | Renewal after a lock wait cannot revive an expired lease; lost commit acknowledgements stay uncertain. | PASS | [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H8-10 | Client/work/tool shared-lifetime and bounded-view behavior survive a host-owner change. | PASS | [clients.integration.test.ts](../../../../src/tests/host/clients.integration.test.ts), [live Compose run](../../../../examples/host/acceptance.ts), [relay.integration.test.ts](../../../../src/tests/host/relay.integration.test.ts) |

## H9 - A-D acceptance, deployment examples and final handoff

Contract: [packet](packets/H9_Conformance_Deployment_Handoff.md). Detail: [handoff](handoffs/H9.md).

| ID | Required result | Status | Evidence |
| --- | --- | --- | --- |
| H9-01 | Scenario A works through the documented minimal public example with no distributed services. | PASS | [live Compose run](../../../../examples/host/acceptance.ts), [topology examples](../../../../examples) |
| H9-02 | Scenario B proves standby health, one active owner, failure takeover and safe rolling drain. | PASS | [live Compose run](../../../../examples/host/acceptance.ts) |
| H9-03 | Scenario C proves custom application namespaces and isolation under identical resource identifiers. | PASS | [live Compose run](../../../../examples/host/acceptance.ts) |
| H9-04 | Scenario D proves horizontal serving with per-session authority and shared-namespace host admission. | PASS | [live Compose run](../../../../examples/host/acceptance.ts) |
| H9-05 | The security matrix holds across network delays, revocation, dropped hints and host loss. | PASS | [live Compose run](../../../../examples/host/acceptance.ts), [relay.integration.test.ts](../../../../src/tests/host/relay.integration.test.ts), [PostgreSQL host coordination](../../../../src/tests/persistence/adapters/postgres/hostCoordination.ts) |
| H9-06 | Deployment examples are valid and their readiness/drain/identity settings match SDK behavior. | PASS | [live Kubernetes run](../../../../examples/host/kubernetes/acceptance.ts), [deployment.test.ts](../../../../src/tests/host/deployment.test.ts), [live Compose run](../../../../examples/host/acceptance.ts) |
| H9-07 | Examples carry no secrets and impose no mandatory optional infrastructure on default consumers. | PASS | [live Compose run](../../../../examples/host/acceptance.ts) |
| H9-08 | Resource bounds and performance evidence are concrete and reproducible. | PASS | [live Compose run](../../../../examples/host/acceptance.ts), [PostgreSQL P0-P5 conformance](../../../../src/tests/persistence/adapters/postgres/p0Conformance.ts) |
| H9-09 | Migration and compatibility documentation matches the tested upgrade/cutover behavior. | PASS | [PostgreSQL 0005 upgrade](../../../../src/tests/persistence/adapters/postgres/p0Conformance.ts) |
| H9-10 | The final candidate passes required repository and PostgreSQL gates with reconciled evidence. | PASS | Handoff |
| H9-11 | Independent final review inspects the integrated tree and resolves all required findings. | PASS | Handoff |
| H9-12 | Users and the next agent have a complete truthful handoff. | PASS | Handoff |

## Overall gate

- Preflight: 12 PASS of 12.
- Feature criteria: 95 PASS, 0 PARTIAL, 0 FAIL, 0 NOT RUN of 95.
- Scenarios A, B, C and D: each proven live with independent processes and PostgreSQL under Docker Compose. A, B and D also ran as pods on Kubernetes.
- Final gates and their results: [H9 handoff](handoffs/H9.md#final-gates-h9-10-pf-12).
- Independent review: completed three times. The third was done after the final fix and ended PASS on the gated tree; see the H9 handoff.
- Reconciliation of all 107 criteria against the final pass: no problem found; see the H9 handoff.
- Known limits: [HANDOFF.md](HANDOFF.md#known-limits).
