# Current state and gaps

**Superseded:** this was the state before the work started. The gaps below were closed or recorded as open items; see [HANDOFF.md](HANDOFF.md) and [ACCEPTANCE.md](ACCEPTANCE.md).

**Evidence level:** source inspection and committed historical reports. The rows are gaps relative to the requested multi-host target; they are not a claim that the completed single-host scope is defective.

## What the previous plan actually completed

P0–P5 cover durable sessions/resources, exact identities, work contracts, authorization/hooks, claims/capacity, best-effort events and reconciliation, and client/tool ownership. The acceptance ledger reports completion. The original handoff explicitly excluded active-active hosts, a SQL-backed grant store and a durable work-event outbox. Do not reopen P0–P5 solely because these newly requested capabilities do not exist. [S02–S03 in SOURCES](SOURCES.md)
The active `docs/plans/work/` directory also contains `ProvidersPlan.md`, which mixes an implemented provider baseline and proposed client/Pi/replay milestones. Moving the entire directory to an archive would hide work whose status requires separate classification. [S04–S06](SOURCES.md)

## Material gaps to close

| Gap | Observed source fact | Required resolution/proof |
| --- | --- | --- |
| Shared authorization | AuthorityRevisionStamp and FreshnessPort explicitly describe local semantics; canonical registries and provenance tokens live in Maps/WeakMaps. | D04 and H2: authoritative revocation/currentness and safe reconstruction. Dropped events must not permit stale admission. |
| Namespace terminology | NamespaceRef/definePolicyNamespace already group versioned policies. No explicit host namespace configuration appears in current AHPServerOptions. | D01/H1: preserve policy meaning, define one host namespace identity and reuse existing identifiers where correct. |
| Host admission | Current transport authentication establishes users/agents; current durable acquire takes a hostId, not a verified host credential/namespace claim. | D02–D03/H1: trusted bootstrap, credential binding, rotation/revocation and separation from actor permissions. |
| Ownership granularity | PostgreSQL owns the resolved host_state relation with one advisory lock; migration 0003 constrains it to one logical-store row. | D05/H2/H7: namespace membership and per-session fences with an explicit data/old-writer migration. Never just delete the singleton index. |
| Local connections/presence | AgentDirectory and hosted work use process-local presence and connection maps. | H5/H8: exact remote owner/generation, original actor proof and cross-host reconnect/capacity tests. |
| Event recovery | WorkEventPublisher is a bounded local best-effort callback publisher. | H6: same-transaction outbox, recoverable fan-out, retention bounds and authorized reconciliation. |
| Native sequence/order | The current host owns ActionSequence and the native wire contract preserves actual serverSeq/fromSeq. | D06/H6: inspect pinned SDK, every producer and snapshot path; prove order under stalled commits and takeover. |
| Recovery/placement | Recovery acquires one store and iterates all recoverable sessions, installing fresh local authority. | D08/H7: recover only owned sessions; explicit external-resource portability and fencing. |
| Deployment lifecycle | The current HTTP listener answers ordinary requests with upgrade-required and starts after recovery. | H3/H9: observable standby/health, loss admission fence, drain and real load-balancer tests. |
| Compatibility/data | Current schema keys and caches assume the current store boundary; dynamic policies/hooks are local application code. | D05/H4: complete scoping inventory, preserved data, compatible configuration revisions and deliberate cutover. |

## Review limits

No new bug was reproduced in this session. No code, repository plan or archive was modified remotely. No runtime acceptance criterion has been marked complete. The local orchestrator must inspect its actual candidate and execute required gates before archival or implementation claims.
The active-plan navigation should change as part of authorized selective archival. Historical handoff baselines and checksums should retain their historical meaning, not be relabeled as current test results. The proposed provider/client scope must remain discoverable.

