# Source evidence and current-versus-target boundary

**Repository:** spore310/AHP. **Branch:** agentIdentity. **Pinned source:** `22fa7955b8e43839e041228f647f26e00762ebbe`.
**Commit title:** fix: close persistence review findings. **Commit timestamp:** 2026-10-23T12:35:23Z.

The branch was fetched during this task and still pointed at this commit. Its metadata/diff and the directly participating files were read through GitHub. Earlier pinned reads in this conversation were reused for unchanged same-SHA source; the local implementer still refreshes the full worktree/import map in P00. No source checkout was modified and no repository commands/tests ran here.

| Evidence | Pinned source | What it supports |
| --- | --- | --- |
| Commit | [22fa795](https://github.com/spore310/AHP/commit/22fa7955b8e43839e041228f647f26e00762ebbe) | Pinned branch and actual commit diff read; persistence fixes, not tool-policy implementation. |
| package.json | [package.json](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/package.json) | Pinned dependencies/scripts; historical tests are not our runtime evidence. |
| Repository instructions | [.agents/AGENTS.md](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/.agents/AGENTS.md) | Server authority, modular monolith, no inferred client authority; validation and documentation mapping. |
| Coding conventions | [docs/CodingRules.md](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/docs/CodingRules.md) | index/types/helpers placement, test-root and public aliases. |
| Authenticated identity | [src/agents/types.ts](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/src/agents/types.ts) | Current principal is subject-only; connection/generation and durable agent identity are distinct. |
| Host composition | [src/websocket/helpers/host/helpers.ts](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/src/websocket/helpers/host/helpers.ts) | Authentication currently wired through optional agentWork; target separates general security. |
| Host options | [src/websocket/helpers/host/types.ts](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/src/websocket/helpers/host/types.ts) | No current general security/policy options; proposed extension must be wired. |
| Transport setup | [src/websocket/helpers/server.ts](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/src/websocket/helpers/server.ts) | Accepted socket paused during async authenticator; do not claim existing HTTP pre-upgrade denial. |
| AHP types | [src/websocket/helpers/ahp/types.ts](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/src/websocket/helpers/ahp/types.ts) | ChannelAdapter snapshot lacks actor; initialize capabilities currently unknown; private extension must be explicit. |
| AHP routes/publication | [src/websocket/helpers/ahp/helpers.ts](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/src/websocket/helpers/ahp/helpers.ts) | Shared snapshot/fanout and list paths; owner attach; direct action-to-factory path. |
| Current invocation | [src/websocket/helpers/ahp/toolInvocation.ts](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/src/websocket/helpers/ahp/toolInvocation.ts) | Subscription + typed manifest + unique connected executor; no per-actor policy/challenge enforcement. |
| Connection queue | [src/websocket/helpers/connection.ts](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/src/websocket/helpers/connection.ts) | Deferred request completion matching and serialized frames; avoid held challenge deadlock. |
| Application options | [src/sessions/helpers/application/types.ts](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/src/sessions/helpers/application/types.ts) | Captured host-level role versus new per-actor scoped authority. |
| Application preparation | [src/sessions/helpers/application/helpers.ts](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/src/sessions/helpers/application/helpers.ts) | Current creation-time visible tool selection; old role must not remain a parallel authority. |
| Creation seam | [src/sessions/createSession/helpers.ts](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/src/sessions/createSession/helpers.ts) | Synchronous attach callback precedes publication/backend start; async prep must precede commit. |
| Typed advertisements | [src/sessions/helpers/application/admission.ts](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/src/sessions/helpers/application/admission.ts) | Exact identity/schema validation and canonical descriptor normalization must survive. |
| Tool contracts | [src/tools/types.ts](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/src/tools/types.ts) | Serializable exact revision contract; no executor functions. |
| Tool client | [src/toolClient/index.ts](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/src/toolClient/index.ts) | Direct transport creation, shared manifest consumption, staged acknowledgement activation. |
| Tool-client interfaces | [src/toolClient/types.ts](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/src/toolClient/types.ts) | Current execute callback and simple call API; revised lifecycle/client migration is new work. |
| Work ownership | [src/work/helpers/helpers.ts](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/src/work/helpers/helpers.ts) | Owner registry and same-principal service guards; not general RBAC. |
| Postgres work guard | [src/persistence/helpers/adapters/postgres/helpers/workItems/helpers.ts](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/src/persistence/helpers/adapters/postgres/helpers/workItems/helpers.ts) | Database repeats same-owner/agent principal restrictions; preserve as separate scope. |
| Capabilities | [docs/architecture/capabilities.md](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/docs/architecture/capabilities.md) | Documents baseline privacy/resource limitations; no current chat/terminal/server runtime claim. |
| TypeScript aliases | [tsconfig.json](https://github.com/spore310/AHP/blob/22fa7955b8e43839e041228f647f26e00762ebbe/tsconfig.json) | Strict public module aliases and noUncheckedIndexedAccess; new aliases must be wired consistently. |

## Supplied design input

The user-supplied AHP_TOOL_POLICY_RESOURCE_SCOPE_PLAN.md (R4.1) was read in full and merged with the current notes. Its 35 acceptance cases are traced in TEST_COVERAGE.md. R5 supersedes earlier conflicting sketches on same-owner identity, host-wide roles, mandatory namespaces, reveal-as-permission, generic validated preparation data and shared raw manifests.

Only the architecture and implementation/test requirements are carried into this package. It contains no separate review protocol, skill or reviewer reports.

## Evidence limitations

The base commit records a previous persistence validation run with 407 tests. That is a committed historical report, not a test executed for this plan or its future implementation. All R5 coverage starts NOT RUN. Public source inspection establishes current code paths; it does not establish an uncommitted local tree or production readiness.

No live database, external model API, coding agent, paid reviewer, plugin installation or deployment was used. Artifact creation and structural document checks are not application implementation tests.
