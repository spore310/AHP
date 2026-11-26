# Evidence handoffs

These documents record executed evidence for the candidate named in the overall handoff. [../HANDOFF.md](../HANDOFF.md) is the overall resume point; [../ACCEPTANCE.md](../ACCEPTANCE.md) is the status index.

| Handoff | Scope |
| --- | --- |
| [PREFLIGHT](PREFLIGHT.md) | Original-plan verification, selective archive and plan review. |
| [H0](H0.md) | Extract host composition without changing behavior |
| [H1](H1.md) | Host identity, application namespaces and admission |
| [H2](H2.md) | Durable coordination and authorization freshness |
| [H3](H3.md) | Single-host and active-passive lifecycle |
| [H4](H4.md) | Namespace isolation and allocation |
| [H5](H5.md) | Authenticated internal host routing |
| [H6](H6.md) | Committed events, ordering and reconciliation |
| [H7](H7.md) | Session ownership, recovery and transfer |
| [H8](H8.md) | Distributed agents, work claims and tool delivery |
| [H9](H9.md) | A–D acceptance, deployment examples and final handoff |

## Evidence format

Record candidate (commit plus relevant working-tree identity), task/plan revision, runtime/database versions, changed paths, command and working directory, exit/result, exact observations and sanitized log/artifact pointer. Do not include credentials or production data.
Separate original historical evidence from checks actually executed during this run. Record SQL migration versions and independent process count where required. Link related acceptance IDs rather than pasting a terminal transcript repeatedly.
Record review findings with severity, source/criterion, correction and verification. An independent reviewer must inspect the actual candidate; a worker cannot approve its own patch by changing its role label.
After an external edit or a fix, mark affected evidence stale and rerun only the relevant checks plus required repository gates. Keep a clear next safe action for resumption.

