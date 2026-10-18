# Worked Example — AHP Stabilization, Not Feature Implementation

**Illustrative work contract only. No fixes or checks are performed by this file.**
Starting evidence: `develop` at `1c5f4fc3572f1af9797a59d59d1b3f915761f178`.
Reinspect the current candidate before using any defect description.
The user's stabilization task plan is the authority for its detailed scope.

## Intake

Mode: execute stabilization and prepare the future plan, **only when the user
explicitly assigns that task**. Installing this skill does not assign it.
Risk: elevated because lifecycle ordering and cleanup promises are changing.

Outcome: fix startup/disposal races and prepare `docs/ProvidersPlan.md` without
adding model execution to the server or implementing client-handshake features.

## Architecture evidence to collect

| Evidence | Path / symbol | Check |
| --- | --- | --- |
| E1 | `src/websocket/helpers/server.ts`: `start`, `beginListening`, `performShutdown` | Who owns bind/listening/heartbeat and how can callbacks interleave with stop? |
| E2 | `src/websocket/types.ts`: `WebSocketServerHandle` | What does resolving `stop()` promise to callers? |
| E3 | `src/sessions/helpers/factory/helpers.ts`: `createSessionsFactory`, `performDispose` | Can new sessions enter while disposal is pending? |
| E4 | `src/sessions/createSession/helpers.ts`: `startBackend` | How are late completions and reused URIs handled? |
| E5 | `src/sessions/helpers/sequence/helpers.ts` and state helpers | What is actually sequenced, versus replay only planned? |
| E6 | `docs/ProvidersPlan.md` and the accepted stabilization handoff | Which phases are documentation-only now? |

Target invariant I1: no server-side Pi runtime, model inference, or prompt execution.
Target invariant I2: preparing `ProvidersPlan.md` does not implement it.
Target invariant I3: session reuse after disposal remains unless the user accepts
a different contract; creation during disposal must have a defined safe policy.

## Example plan critique

Weak draft: “Add a starting flag, fix disposal, and wire Pi afterward.”

Review verdict: `REVISE`.

Reason: a flag alone does not establish what a late listening callback can do;
the disposal acceptance criterion lacks a gated concurrency test; “wire Pi”
exceeds the stabilization and plan-preparation scope.

Revised contract: define lifecycle transitions and stop completion; reject new
session creation during the disposal critical section while preserving permitted
reuse afterward; verify record-identity handling; amend the future plan only.
The next plan gate remains pending until this matches current source evidence.

## Bounded work split

| Owner | Outcome | Owns | Does not own |
| --- | --- | --- | --- |
| Lead | Baseline, contract decisions, integration, sequencing audit, plan/doc amendments | Shared contracts and `docs/ProvidersPlan.md`; explicitly assigned doc claims | Server-side model runtime or future feature work |
| Worker A | WebSocket lifecycle fix | `src/websocket/helpers/server.ts`, `src/websocket/types.ts`, `src/tests/websocket.test.ts`; constants only if assigned | Session module, dependency upgrades, unrelated entrypoint changes |
| Worker B | Session disposal critical section | Session factory/createSession helpers and their assigned tests/types | WebSocket files, Pi packages, provider-plan implementation |
| Reviewer | Independent plan/final review | Read-only access to relevant contracts, combined candidate, tests | All source edits and commits |

Worker A and B can run in parallel only with stable contracts and safe resource
isolation. Reuse one reviewer before and after implementation when the harness
permits it. At most two subagents run at once; the lead does not spawn a fourth
“documentation reviewer.” If delegation is unavailable, perform the slices
sequentially and report the independent-review gap.

The lead reserves shared `src/index.ts`, manifest/lockfile changes, and future
connection APIs; workers request changes rather than editing those opportunistically.

## Acceptance that catches plausible wrong fixes

| Criterion | Required proof | Current result |
| --- | --- | --- |
| AC1 | `start(); stop();` before listening settles cannot later expose a live listener or heartbeat. | NOT RUN |
| AC2 | Concurrent starts/stops have the documented single-flight behavior; late errors cannot resurrect the server. | NOT RUN |
| AC3 | A gate holds an existing disposal pending; creating a session during that interval follows the chosen rejection/serialization contract. | NOT RUN |
| AC4 | A late backend cannot attach to a replacement record with the same URI; cleanup failures have the agreed sanitized diagnostic route. | NOT RUN |
| AC5 | Sequence tests establish the stated ordering only; docs do not claim replay exists. | NOT INSPECTED |
| AC6 | Future-plan ownership is client-vs-server explicit; no feature implementation or new model dependencies appears. | NOT INSPECTED |
| AC7 | Final integrated `pnpm validate` passes on the repository's pinned toolchain. | NOT RUN |

## Suggested checks, not claimed results

Run from the repository root after inspecting current scripts:

```sh
node --version
pnpm --version
pnpm test -- src/tests/websocket.test.ts
pnpm test -- src/tests/sessions/factory.test.ts src/tests/sessions/createSession.test.ts
pnpm validate
```

Verify test argument forwarding against the installed runner; these focused
commands follow the reviewed `vitest run` script but are not a substitute for
checking the actual local manifest. Any command failure is evidence to report,
not permission to silently upgrade the toolchain or skip the final gate.

## Example scope stop

Worker proposes importing Pi's SDK in the server to test connections.

Lead response: do not apply that edit. A real SDK client test can exercise a
mock-backed host without executing Pi inside the server. Designing the client
extension remains a future client-side milestone, subject to the accepted plan.

## Final handoff shape

State actual changes and candidate, each AC's evidence/status, plan amendments,
review findings, tests not run, and remaining target work. Until the above checks
are executed, do not turn this example into a “VERIFIED” completion report.
