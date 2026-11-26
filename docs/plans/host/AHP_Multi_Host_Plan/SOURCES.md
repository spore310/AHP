# Source evidence

## Inspected baseline

Repository: https://github.com/spore310/AHP
Remote `feature/ahp-v1` HEAD: `324fd60634e3d93aa4af59da98263c1cac0deb3b`.
Source facts below were inspected through repository reads on November 26, 2026. No local repository test suite or migration was run in this planning session. Sources cited as files to inspect inside a packet may include additional coupled files the local orchestrator must read.

| ID | Source | Relevance |
| --- | --- | --- |
| S01 | [package.json](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/package.json) | Pinned toolchain and validation command. |
| S02 | [docs/plans/work/03_Acceptance_Matrix.md](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/docs/plans/work/03_Acceptance_Matrix.md) | Historical P0–P5 completion and acceptance evidence. |
| S03 | [docs/plans/work/README_Codex_Handoff.md](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/docs/plans/work/README_Codex_Handoff.md) | Original packet boundary, non-goals and verification requirements. |
| S04 | [docs/plans/work/ProvidersPlan.md](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/docs/plans/work/ProvidersPlan.md) | Mixed completed provider baseline and proposed client milestones. |
| S05 | [docs/plans/README.md](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/docs/plans/README.md) | Current active-plan navigation. |
| S06 | [docs/archive/README.md](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/docs/archive/README.md) | Existing archive convention and historical checksum caveat. |
| S07 | [src/websocket/helpers/host/helpers.ts](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/src/websocket/helpers/host/helpers.ts) | Current composed host, coherent security wiring and startup order. |
| S08 | [src/websocket/helpers/host/types.ts](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/src/websocket/helpers/host/types.ts) | Current public options; host is the network bind address. |
| S09 | [src/websocket/helpers/host/work.ts](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/src/websocket/helpers/host/work.ts) | Hosted work depends on local connections, presence and canonical authorization. |
| S10 | [src/authorization/types.ts](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/src/authorization/types.ts) | Security domains, policy namespaces, local freshness stamps and ports. |
| S11 | [src/authorization/helpers/evaluate/helpers.ts](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/src/authorization/helpers/evaluate/helpers.ts) | Canonical registries and weak-provenance tokens are process-local. |
| S12 | [src/authorization/helpers/evaluate/types.ts](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/src/authorization/helpers/evaluate/types.ts) | Local decision stamps, matching and callback-free local fences. |
| S13 | [src/authorization/README.md](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/src/authorization/README.md) | Local/currentness guarantees and limits of grant/proof transport. |
| S14 | [src/authorization/helpers/policies/helpers/namespace/helpers.ts](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/src/authorization/helpers/policies/helpers/namespace/helpers.ts) | Existing policy namespace capture; grouping is not host ownership. |
| S15 | [src/persistence/helpers/durability/types.ts](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/src/persistence/helpers/durability/types.ts) | DurableStorage.acquire and DurableHost.epoch contracts. |
| S16 | [src/persistence/helpers/adapters/postgres/helpers/ownership/helpers.ts](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/src/persistence/helpers/adapters/postgres/helpers/ownership/helpers.ts) | Dedicated advisory-lock connection and transaction epoch fencing. |
| S17 | [database/migrations/0003_durable_session_resources.sql](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/database/migrations/0003_durable_session_resources.sql) | Singleton logical-store constraint and exact resource/session schema. |
| S18 | [src/persistence/helpers/adapters/postgres/helpers/durableWork/scheduling.ts](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/src/persistence/helpers/adapters/postgres/helpers/durableWork/scheduling.ts) | Registration-locked capacity and exact work lease checks. |
| S19 | [src/agents/helpers/directory.ts](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/src/agents/helpers/directory.ts) | Explicitly process-local live presence and connection generations. |
| S20 | [src/sessions/helpers/recovery/helpers.ts](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/src/sessions/helpers/recovery/helpers.ts) | Whole-store recovery and reinstallation of fresh local authority. |
| S21 | [src/sessions/helpers/sequence/helpers.ts](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/src/sessions/helpers/sequence/helpers.ts) | Current host-owned action sequence port. |
| S22 | [src/work/helpers/events/helpers.ts](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/src/work/helpers/events/helpers.ts) | Bounded best-effort local work event publisher. |
| S23 | [src/websocket/helpers/server.ts](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/src/websocket/helpers/server.ts) | WebSocket listener and ordinary HTTP upgrade-required response. |
| S24 | [docs/technical/wire-contract.md](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/docs/technical/wire-contract.md) | Current action ordering, native cursor and protected view semantics. |
| S25 | [docs/guides/postgresql.md](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/docs/guides/postgresql.md) | Disposable PostgreSQL test setup and migration verification. |
| S26 | [.agents/AGENTS.md](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/.agents/AGENTS.md) | Repository rules, authority and validation. |
| S27 | [.agents/skills/architecture-aware-delivery/SKILL.md](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/.agents/skills/architecture-aware-delivery/SKILL.md) | Planning, review and bounded delegation workflow. |
| S28 | [.agents/skills/architecture-aware-delivery/references/delegation.md](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/.agents/skills/architecture-aware-delivery/references/delegation.md) | Default two concurrent subagents, three assignments, no nested delegation. |
| S29 | [docs/CodingRules.md](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/docs/CodingRules.md) | Module/type/helper/test conventions. |
| S30 | [src/work/README.md](https://github.com/spore310/AHP/blob/324fd60634e3d93aa4af59da98263c1cac0deb3b/src/work/README.md) | Existing restrictive work guards and reconciliation behavior. |

## Primary technical references

- [PostgreSQL 17 NOTIFY](https://www.postgresql.org/docs/17/sql-notify.html): transaction delivery timing, payload bounds and notification behavior. Notifications are wakeups; durable recovery needs its own design.
- [PostgreSQL 17 sequence functions](https://www.postgresql.org/docs/17/functions-sequence.html): sequence allocation is not a substitute for a complete publication-order contract.
- [Kubernetes Pod lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/): distinct startup/liveness/readiness and termination responsibilities.
- [Kubernetes namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/): namespace-scoped names are useful precedent; do not import unrelated Kubernetes semantics into this SDK.
- [RFC 8141](https://www.rfc-editor.org/rfc/rfc8141): URN syntax and registered namespace identifiers. A host slug belongs inside the assigned identifier, not as an automatically invented registered NID.
- [RFC 6963](https://www.rfc-editor.org/rfc/rfc6963): `urn:example:` is for documentation/experimentation, not the production namespace prefix.

Use the installed `@microsoft/agent-host-protocol` version and its actual source/types for the native ordering decision. Package version 1.0.0 is verified in the pinned manifest; exact multi-host ordering compatibility remains a required local investigation.

