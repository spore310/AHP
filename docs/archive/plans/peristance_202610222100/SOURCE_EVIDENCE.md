# Source evidence and authority

**Repository checkpoint:** `f2804963129403e666a6e929db92beb9b2ab761d` on `agentIdentity`.

GitHub read operations were used. No local user worktree was changed. A read-only archive download attempt failed because the container could not resolve the public host; no repository tests were run here. This does not prevent a source-grounded plan, but local import scans and baseline validation are assigned to P00.

## Repository sources

| ID | Source | What it supports |
| --- | --- | --- |
| S01 | [Branch checkpoint](https://github.com/spore310/AHP/tree/f2804963129403e666a6e929db92beb9b2ab761d) | Pinned via GitHub branch read; source, not local execution. |
| S02 | [src/persistence/types.ts](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/src/persistence/types.ts) | Existing ports, DTOs, absence sentinels and owned errors. |
| S03 | [src/persistence/index.ts](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/src/persistence/index.ts) | Current neutral root re-exports concrete PostgreSQL implementations. |
| S04 | [src/persistence/helpers/pool.ts](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/src/persistence/helpers/pool.ts) | pg Pool/PoolClient, transaction helper and SQLSTATE mapping. |
| S05 | [src/persistence/helpers/agentRegistrations.ts](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/src/persistence/helpers/agentRegistrations.ts) | Parameterized upsert, row mapping and optional display-name behavior. |
| S06 | [src/persistence/helpers/sessions.ts](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/src/persistence/helpers/sessions.ts) | Internal ensureSession and session projection implementation. |
| S07 | [src/persistence/helpers/workItems.ts](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/src/persistence/helpers/workItems.ts) | Atomic work operations, same-client submit, clock, fences and retry policy. |
| S08 | [src/persistence/helpers/text.ts](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/src/persistence/helpers/text.ts) | Current text/tree predicates and explicit depth bound. |
| S09 | [src/work/helpers/helpers.ts](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/src/work/helpers/helpers.ts) | Direct JSONB helper consumption and owned-error mapping. |
| S10 | [src/websocket/helpers/ahp/agentWork.ts](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/src/websocket/helpers/ahp/agentWork.ts) | Wire-boundary JSONB terminology/import leakage; v1 schemas. |
| S11 | [src/index.ts](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/src/index.ts) | Direct concrete pool/repository construction and disposal. |
| S12 | [env/types.ts](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/env/types.ts) | Current optional database/auth keys and TTL limits. |
| S13 | [src/tests/index.test.ts](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/src/tests/index.test.ts) | Existing entrypoint/signal tests; startup configuration needs added coverage. |
| S14 | [src/persistence/README.md](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/src/persistence/README.md) | Current adapter semantics and explicit unrun real-database acceptance. |
| S15 | [.agents/AGENTS.md](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/.agents/AGENTS.md) | Modular-monolith constraints, validation and plan/execute scope. |
| S16 | [docs/CodingRules.md](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/docs/CodingRules.md) | types/helpers/index boundaries; source spelling and tests placement. |
| S17 | [.agents/skills/architecture-aware-delivery/SKILL.md](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/.agents/skills/architecture-aware-delivery/SKILL.md) | Bounded packets, evidence and delegation limits. |
| S18 | [.agents/skills/architecture-aware-delivery/references/review.md](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/.agents/skills/architecture-aware-delivery/references/review.md) | Honest self-review labels and plan/implementation distinction. |
| S19 | [src/agents/helpers/directory.ts](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/src/agents/helpers/directory.ts) | Direct consumer already inspected in this conversation; P00 must refresh full file. |
| S20 | [src/websocket/helpers/host/types.ts](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/src/websocket/helpers/host/types.ts) | Existing repository injection contract; P00 must refresh full file. |
| S21 | [src/websocket/helpers/host/helpers.ts](https://github.com/spore310/AHP/blob/f2804963129403e666a6e929db92beb9b2ab761d/src/websocket/helpers/host/helpers.ts) | Current composition and owner/projection handling; P00 must refresh full file. |

## Primary technical references

- [node-postgres: transactions](https://node-postgres.com/features/transactions): a PostgreSQL transaction must use one client. This supports keeping the transaction-local session ensure inside work submit, not splitting it across generic repositories.
- [PostgreSQL: SELECT locking clauses](https://www.postgresql.org/docs/current/sql-select.html): SKIP LOCKED is suitable for queue-like consumers, not a universal consistent-read abstraction. It stays an adapter mechanism.
- [PostgreSQL: JSON types](https://www.postgresql.org/docs/current/datatype-json.html): jsonb text restrictions explain the current implementation. The target portable-text policy is explicitly a project contract, not a claim that all stores or JSON share these restrictions.
- [node-postgres: pooling](https://node-postgres.com/features/pooling): pool/client ownership and release remain backend-specific; the public facade exposes only disposal.

## User-defined target decisions

The user requested an agnostic persistence refactor, adapters inside persistence/helpers, a shared ORM-like provider return object, connected-module migration, a double review, and packetized GLM 5.3 Flash execution. These are target requirements, not facts inferred from current code. No new model-performance claims or database deployment authorization are assumed.

## Verification limits

This handoff is plan-only. Artifact link/fence/coverage checks are separate from application tests. The repository documents blocked real-PostgreSQL acceptance; that remains blocked. Two plan review passes are performed by the same author and are not independent-review evidence.
