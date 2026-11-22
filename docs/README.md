# AHP documentation

## Use the SDK

| If you want to | Start here |
| --- | --- |
| Bring up a typed session from application code | [Five-minute quick start](guides/quickstart.md) |
| Use authenticated clients, tools, and work leases | [Advanced review application](guides/advanced.md) |
| Choose the public API for a capability | [Source modules](../src/README.md) |
| Implement a protocol client or debug a frame | [Wire contract](technical/wire-contract.md) |
| Configure the default process | [Environment settings](../env/README.md) |
| Try the opt-in PostgreSQL adapter locally | [PostgreSQL setup and conformance](guides/postgresql.md) |

## Contribute to AHP

| If you want to | Start here |
| --- | --- |
| Find where state or policy decisions live | [Capability map](architecture/capabilities.md) |
| Understand readiness, sequencing, and shutdown | [Runtime lifecycles](technical/runtime-lifecycles.md) |
| Follow registration, presence, and work ownership | [Agent work lifecycle](architecture/agent-task-lifecycle.md) |
| Read the database shape | [Schema and invariants](../database/M2_AGENT_WORK_DATABASE_SCHEMA.md) |
| Follow project conventions | [Coding rules](CodingRules.md) and [repository instructions](../AGENTS.md) |
| Understand the source-to-README gate | [Documentation coverage](gates/documentation.md) |

## Verification

`pnpm validate` runs the repository gate. The walkthroughs also have their own
commands so you can check their output independently. Public loopback tests
exercise actual WebSocket and SDK behavior using local fixtures. Installation,
queries, and concurrency against a real PostgreSQL instance are covered by
the [separate opt-in conformance run](guides/postgresql.md#run-conformance).

## Project history

[Active plans](plans/README.md) describe proposed work. The [archive](archive/README.md)
holds completed and superseded plans, review records, and historical test evidence.

[Repository home](../README.md)
