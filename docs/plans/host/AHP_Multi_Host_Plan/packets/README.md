# Packet index

Read ../README.md, ../CONTRACTS.md and ../DECISIONS.md before using a packet. Execute ../PREFLIGHT.md first. Each packet specifies required behavior and proof; its companion handoff stores actual evidence.

| Packet | Outcome | Handoff |
| --- | --- | --- |
| [H0](H0_Host_Module.md) | Extract host composition without changing behavior | [H0 handoff](../handoffs/H0.md) |
| [H1](H1_Identity_Namespaces_Admission.md) | Host identity, application namespaces and admission | [H1 handoff](../handoffs/H1.md) |
| [H2](H2_Coordination_Authorization.md) | Durable coordination and authorization freshness | [H2 handoff](../handoffs/H2.md) |
| [H3](H3_Single_Replicated_Lifecycle.md) | Single-host and active-passive lifecycle | [H3 handoff](../handoffs/H3.md) |
| [H4](H4_Namespace_Isolation_Allocation.md) | Namespace isolation and allocation | [H4 handoff](../handoffs/H4.md) |
| [H5](H5_Internal_Host_Transport.md) | Authenticated internal host routing | [H5 handoff](../handoffs/H5.md) |
| [H6](H6_Events_Ordering_Reconciliation.md) | Committed events, ordering and reconciliation | [H6 handoff](../handoffs/H6.md) |
| [H7](H7_Session_Ownership_Recovery.md) | Session ownership, recovery and transfer | [H7 handoff](../handoffs/H7.md) |
| [H8](H8_Agents_Work_Tools.md) | Distributed agents, work claims and tool delivery | [H8 handoff](../handoffs/H8.md) |
| [H9](H9_Conformance_Deployment_Handoff.md) | A–D acceptance, deployment examples and final handoff | [H9 handoff](../handoffs/H9.md) |

## How to close a packet

1. Read its prerequisites and resolve blocking decisions. Inspect actual implementation/callers/tests rather than relying only on source anchors.
2. Record exact contract and write ownership before implementation. Keep shared interfaces and migration ownership with one lead.
3. For each criterion, identify the wrong implementation the proof would catch and the observation that separates failure from success.
4. Run focused tests, required real-SQL/multiprocess/SDK paths, repository validation and applicable reviews. Verify the integrated candidate after the last relevant change.
5. Write commands, results and limitations in the packet handoff; update ../ACCEPTANCE.md, ../HANDOFF.md and ../NOTEPAD.md.
6. Advance only with required criteria satisfied. A mock, historical report, local self-review or skipped test must not be relabeled as a different category of proof.

The proposed file/command paths must be reconciled against the actual checkout. Updating a path is allowed; weakening the behavioral proof is not.

