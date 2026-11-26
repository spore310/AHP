# Agent Hosting Protocol — Multi-host support plan

**Status:** implemented and verified on `feature/ahp-v1`, November 26, 2026,
in the five local commits that follow `324fd60`. Scenarios A-D run live with
independent processes and PostgreSQL, and as pods on Kubernetes. See
[ACCEPTANCE.md](ACCEPTANCE.md) for every criterion and
[HANDOFF.md](HANDOFF.md) for the resume point.
**Intent:** the accepted conversation, including application-owned namespaces,
stable app-style host naming, secret-backed host admission, reuse of existing
terminology, and one local orchestrator with bounded subagents.

## Start here

- To use the feature: the [multi-host guide](../../../guides/multi-host.md)
  and the [host module](../../../../src/host/README.md).
- To see it run: `examples/host/docker-compose.yaml` and
  `examples/host/acceptance.ts`.
- To continue the work: [HANDOFF.md](HANDOFF.md), then
  [ACCEPTANCE.md](ACCEPTANCE.md) and the [packet handoffs](handoffs/README.md).

[PROMPT.md](PROMPT.md) is the orchestrator entry point that produced this
state. The packets remain the contract; the handoffs hold the evidence.

## Product outcome

The default remains a single Agent Hosting Protocol server with one logical host and namespace. Applications can choose their own namespace names, use a stable host name resembling the application name, and opt into multi-instance or multi-host operation without replacing the SDK's security or session model.

| Scenario | Required behavior | Main proof |
| --- | --- | --- |
| A — Single host | One default authoritative host; no mandatory distributed dependency. | H0, H1, H3, H9 |
| B — Active-passive | Replicas share a logical host/namespace; one active owner, live standby and fenced takeover. | H2, H3, H9 |
| C — Partitioned namespaces | Applications explicitly allocate independent namespaces to authorized hosts. | H1, H4, H9 |
| D — Shared namespace | Multiple authorized host IDs/instances serve one namespace; each session has one authoritative owner. | H2, H5–H9 |

Multiple active hosts can own different sessions. This plan does not introduce simultaneous unconstrained writers for one session or an agent/model execution runtime on the server.

## Repository baseline

The work started from `feature/ahp-v1` at
`324fd60634e3d93aa4af59da98263c1cac0deb3b` with a clean tree. The baseline
gate was rerun before any change: 1,503 tests in 133 files. The completed
P0-P5 plan is archived under `docs/archive/plans/ahp-v1/`. See
[the preflight handoff](handoffs/PREFLIGHT.md).

## Packet map

| Packet | Outcome | Prerequisites | Criteria |
| --- | --- | --- | ---: |
| [PREFLIGHT](PREFLIGHT.md) | Previous-plan verification/archive and architecture/reuse gate | Actual checkout and instructions | 12 |
| [H0](packets/H0_Host_Module.md) | Extract host composition without changing behavior | PREFLIGHT archive decision recorded; Terminology and ownership map reviewed | 6 |
| [H1](packets/H1_Identity_Namespaces_Admission.md) | Host identity, application namespaces and admission | H0; DECISIONS D01, D02 and D03 resolved | 10 |
| [H2](packets/H2_Coordination_Authorization.md) | Durable coordination and authorization freshness | H1; DECISIONS D03, D04 and D05 resolved | 10 |
| [H3](packets/H3_Single_Replicated_Lifecycle.md) | Single-host and active-passive lifecycle | H2; Provider recovery/placement constraints from D08 are explicit | 8 |
| [H4](packets/H4_Namespace_Isolation_Allocation.md) | Namespace isolation and allocation | H2; H3; DECISIONS D01 and D05 resolved | 9 |
| [H5](packets/H5_Internal_Host_Transport.md) | Authenticated internal host routing | H4; DECISIONS D03, D04 and D07 resolved | 10 |
| [H6](packets/H6_Events_Ordering_Reconciliation.md) | Committed events, ordering and reconciliation | H5; DECISION D06 resolved against the pinned Microsoft SDK | 11 |
| [H7](packets/H7_Session_Ownership_Recovery.md) | Session ownership, recovery and transfer | H6; DECISION D08 resolved | 9 |
| [H8](packets/H8_Agents_Work_Tools.md) | Distributed agents, work claims and tool delivery | H7; H5; H2 authorization/currentness proof | 10 |
| [H9](packets/H9_Conformance_Deployment_Handoff.md) | A–D acceptance, deployment examples and final handoff | H0–H8 verified for the integrated candidate; All blocking decisions and findings closed | 12 |
| **Total** | **Ten feature packets plus preflight** | | **107** |

Packet numbering is sequencing guidance, not permission to bypass a dependency. H0 can be assessed independently, but distributed serving stays disabled until its complete authority, routing, ordering and recovery path is proven.

## Files and responsibilities

| Path | Purpose |
| --- | --- |
| [PROMPT.md](PROMPT.md) | The one prompt entry point for the local orchestrator. |
| [HANDOFF.md](HANDOFF.md) | Overall scope, status, authority and next action. |
| [NOTEPAD.md](NOTEPAD.md) | Compact resumable work record; no private reasoning transcript. |
| [PREFLIGHT.md](PREFLIGHT.md) | Audit, selective archival and planning gate. |
| [CURRENT_STATE.md](CURRENT_STATE.md) | Verified source facts and material gaps relative to this target. |
| [CONTRACTS.md](CONTRACTS.md) | Shared invariants, module ownership, identity and proof rules. |
| [EXAMPLES.md](EXAMPLES.md) | Proposed consumer configurations and application namespace naming. |
| [DECISIONS.md](DECISIONS.md) | Eight decisions the orchestrator must close before dependent work. |
| [ACCEPTANCE.md](ACCEPTANCE.md) | Canonical status index for all 107 criteria. |
| [SOURCES.md](SOURCES.md) | Pinned repository and primary technical references. |
| [packets/README.md](packets/README.md) | Packet reading order and completion rules. |
| [handoffs/README.md](handoffs/README.md) | Evidence handoff format and ownership. |

## Defaults and limits

- Reuse and extend existing concepts and public boundaries before adding names or abstractions. The requested new capability boundary is `src/host` / `@host`.
- Keep native AHP URI formats and the single client transport reader. Proposed host namespace identifiers do not replace session/resource identifiers.
- Keep PostgreSQL-specific code behind persistence adapters. Memory behavior remains useful for the single-process default and deterministic conformance.
- Keep host authentication, infrastructure claims, application actor authorization and current session ownership separate checks.
- Application-defined namespaces are SDK scopes; Kubernetes deployment is optional and does not automatically create or manage Kubernetes Namespace objects.
- Acceptance statuses are recorded per criterion. `PARTIAL` means executed and partly proven, and is not a pass. No criterion is currently `PARTIAL`.

