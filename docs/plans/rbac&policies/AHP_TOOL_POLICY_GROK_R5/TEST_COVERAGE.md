# R5 test coverage — 100 required criteria

**Status:** test specification only. Every row begins **NOT RUN**. No AHP code was executed in preparing this package. Rows are behavioral acceptance criteria, not a fabricated count of implemented tests. Several scenarios may share one parameterized suite, and one criterion may require several tests.

Use the exact packet test targets as the initial suite map. Record actual test names and commands in the handoff and ledger. A mock pass proves only the mocked boundary; actual Microsoft SDK client/reducer tests prove the stated protocol integration, not real MFA, filesystem, database locking or runtime attestation.

## Coverage map

| Packet | Criteria | Primary test files |
| --- | --- | --- |
| [P00](packets/P00.md) | B01, B02, B03 | Source/baseline inventory and existing repository gate |
| [P01](packets/P01.md) | K01, K02, K03 | `src/tests/authorization/contracts.test.ts` |
| [P02](packets/P02.md) | N01, N02, N03, N04, N05 | `src/tests/toolPolicy/factory.test.ts` |
| [P03](packets/P03.md) | A01, A02, A03, A04, A05, A06 | `src/tests/authorization/evaluate.test.ts`, `src/tests/toolPolicy/assignments.test.ts` |
| [P04](packets/P04.md) | I01, I02, I03, I04, I05 | `src/tests/websocket/policyInitialization.test.ts`, `src/tests/agents/policyActor.test.ts`, `src/tests/agents/authenticator.test.ts` |
| [P05](packets/P05.md) | S01, S02, S03, S04, S05 | `src/tests/sessions/policyCreation.test.ts`, `src/tests/sessions/createSession.test.ts`, `src/tests/websocket/agentWork.disposal.test.ts` |
| [P06](packets/P06.md) | G01, G02, G03, G04, G05, G06 | `src/tests/authorization/delegation.test.ts`, `src/tests/authorization/freshness.test.ts`, `src/tests/work/workService.test.ts` |
| [P07](packets/P07.md) | M01, M02, M03 | `src/tests/toolExecution/clientBoundary.test.ts`, `src/tests/toolClient.test.ts`, `src/tests/toolClient/transport.test.ts` |
| [P08](packets/P08.md) | L01, L02, L03, L04, L05, L06, L07, L08 | `src/tests/toolExecution/pipeline.test.ts`, `src/tests/toolExecution/cleanup.test.ts` |
| [P09](packets/P09.md) | T01, T02, T03, T04, T05, T06 | `src/tests/toolExecution/clientDispatch.test.ts`, `src/tests/websocket/toolPolicyAdmission.test.ts`, `src/tests/websocket/toolInvocation.test.ts` |
| [P10](packets/P10.md) | V01, V02, V03, V04, V05, V06, V07 | `src/tests/websocket/policyProjection.test.ts`, `src/tests/websocket/policyEgress.test.ts`, `src/tests/websocket/sdk.test.ts` |
| [P11](packets/P11.md) | W01, W02, W03, W04, W05, W06 | `src/tests/toolExecution/clientProtocol.test.ts`, `src/tests/websocket/toolProtocolV2.test.ts`, `src/tests/toolClient/connection.test.ts` |
| [P12](packets/P12.md) | X01, X02, X03, X04, X05, X06 | `src/tests/websocket/policyIntegration.test.ts` |
| [P13](packets/P13.md) | C01, C02, C03, C04, C05, C06, C07 | `src/tests/toolExecution/challenge.test.ts`, `src/tests/websocket/challengeContinuation.test.ts`, `src/tests/websocket/deferred.test.ts` |
| [P14](packets/P14.md) | R01, R02, R03, R04, R05 | `src/tests/authorization/resourceScopes.test.ts`, `src/tests/toolExecution/resultProjection.test.ts` |
| [P15](packets/P15.md) | E01, E02, E03, E04, E05 | `src/tests/toolExecution/serverExecutor.test.ts`, `src/tests/websocket/serverTools.integration.test.ts` |
| [P16](packets/P16.md) | Q01, Q02, Q03, Q04 | `src/tests/toolPolicy/proposals.test.ts`, `src/tests/websocket/toolProposals.test.ts` |
| [P17](packets/P17.md) | F01, F02, F03, F04 | `src/tests/toolExecution/artifacts.test.ts` |
| [P18](packets/P18.md) | D01, D02, D03 | `src/tests/applicationPolicyExamples.test.ts`, `src/tests/application.test.ts` |
| [P19](packets/P19.md) | Z01, Z02, Z03 | `src/tests/authorization`, `src/tests/toolPolicy`, `src/tests/toolExecution` |

## P00 — Pin the actual candidate and characterize all protected paths

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| B01 | Candidate and baseline are factual | HEAD plus dirty-state evidence; no reset/stash; baseline command/exits recorded. | NOT RUN |
| B02 | Every protected ingress and egress path has an owner | Inventory includes initialization, shared snapshots, listings, advertisements, buffers, errors and private results. | NOT RUN |
| B03 | Pinned dependency and database constraints preserved | Installed SDK API notes, unchanged DDL/dependencies and explicit no-live-DB evidence. | NOT RUN |

## P01 — Freeze portable public contracts and runtime schemas

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| K01 | No built-in role or implicit grant | Two independent role vocabularies compile; missing/empty role branches and assignments deny in schema/contract fixtures. | NOT RUN |
| K02 | One typed portable contract boundary | No driver/framework types; explicit caller/executor/resource identities; custom extensions accepted without unsafe casts. | NOT RUN |
| K03 | Malformed policy/config values fail deterministically | Finite limits, unknown effects/revisions and invalid execution combinations have runtime rejection tests. | NOT RUN |

## P02 — Build direct-policy and compositional namespace factories

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| N01 | Namespaces are optional | Direct exact policies compile and resolve with an empty namespace list. | NOT RUN |
| N02 | Namespace includes are safe and finite | Cycle, conflict, oversized expansion, prototype selector and unknown reference tests reject. | NOT RUN |
| N03 | Names are not authority | Suffix/prefix names neither create a role nor identify a filesystem/resource. | NOT RUN |
| N04 | Mandatory constraints survive resolution | Permissive resolver selection cannot omit registered mandatory provider/session rules. | NOT RUN |
| N05 | Registrations are immutable and version-pinned | Caller mutation and a later namespace revision do not expand an already compiled assignment. | NOT RUN |

## P03 — Implement scoped authorization and the assignment allowlist

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| A01 | No authority is the default | Empty policy/role/grant arrays assign no tools; explicit direct grant can work without namespace or invented role. | NOT RUN |
| A02 | Valid scope-specific grant plus all constraints | Application allow/provider deny, missing evaluator and expired grant deny; same actor differs across scopes. | NOT RUN |
| A03 | No grant-fragment synthesis | Resource from one grant plus operation from another cannot create a new permission. | NOT RUN |
| A04 | Reveal never grants authority | True reveal with missing assignment/registration denies disclosure; conditional false hides an otherwise assigned descriptor. | NOT RUN |
| A05 | Caller and executor purposes are separate | Invoke-only recipient cannot advertise/publish; executor receives only its explicit execution assignment. | NOT RUN |
| A06 | Reusable harness does not share authority | Two contexts using one harness/model name receive different exact assignments; no cross-user cache hit. | NOT RUN |

## P04 — Move security composition to initialization without requiring work storage

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| I01 | Protected initialization waits for identity/grants | Park auth and send immediate initialSubscriptions; no protected payload or side effect escapes before resolution. | NOT RUN |
| I02 | Security can work without persistence | Authenticated protected tool setup with fake security and no agentWork/DB composition. | NOT RUN |
| I03 | No human or role inference from client labels | Spoofed kind/role/clientId and missing presence do not create a human/admin actor. | NOT RUN |
| I04 | One authenticator source | Conflicting legacy/new wiring fails; identical explicit bridge works; invalid credential fails protected requests. | NOT RUN |
| I05 | Identity lifecycle is fenced | Timeout/disconnect/rebind cannot attach late grants or reuse old connection admissions. | NOT RUN |

## P05 — Wire session-type admission and owner bootstrap atomically

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| S01 | Ownership and participant roles are different facts | Senior creator and invited junior/PM share session but use distinct subjects and local roles; no owner impersonation. | NOT RUN |
| S02 | Bootstrap is explicitly authorized | Unauthenticated/unauthorized sensitive type creation produces no usable record, grant or catalogue event. | NOT RUN |
| S03 | Atomic local attach and rollback | Injected binding-install failure removes the new instance/owner/bindings before publication. | NOT RUN |
| S04 | Same URI has different incarnations | Late create/dispose/grant completion cannot mutate or authorize a same-subject successor. | NOT RUN |
| S05 | Backend lifecycle remains compatible | Ready/failure/disposal behavior and work owner projection remain correct without granting on startup failure. | NOT RUN |

## P06 — Add bounded delegation and current grant revocation

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| G01 | Use permission is not delegation | Invoker/owner without assign authority cannot grant another actor tools. | NOT RUN |
| G02 | Delegation is bounded and acyclic | Overreach in actor/scope/policy/duration/depth and lineage cycles reject. | NOT RUN |
| G03 | Ancestor revocation removes dependent authority | Child decisions and assignments become unusable; expiry behaves the same without waiting for a timer. | NOT RUN |
| G04 | Async decision does not outlive revisions | Revoke during an awaited evaluation; final admission fails before dispatch/send/commit. | NOT RUN |
| G05 | No cross-session, actor or domain cache reuse | Same role/harness/URI strings across distinct instances or identities remain isolated. | NOT RUN |
| G06 | Work identity restriction unchanged | Existing non-owner work tests continue to deny; no owner-subject substitution. | NOT RUN |

## P07 — Move the client implementation into toolExecution without a bypass copy

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| M01 | One client runtime behind both imports | New and compatibility imports use the same behavior; dependency inspection finds no duplicate invocation implementation. | NOT RUN |
| M02 | Staging semantics survive the move | Rejected/mismatched acknowledgement leaves prior handlers intact; shutdown releases owned transport. | NOT RUN |
| M03 | No framework lock-in in connect surface | Fake supplied transport works; borrowed ownership is explicit; credentials never enter URL logs; neutral/client imports do not eagerly load server runtimes. | NOT RUN |

## P08 — Implement the class action pipeline and safe resource lifecycle

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| L01 | Typed hooks never see unbounded unvalidated data | Oversized/schema-invalid input rejects before custom action hooks. | NOT RUN |
| L02 | Auth hook cannot bypass initial authority | Successful optional hook does not grant a denied actor; missing hook does not skip SDK checks. | NOT RUN |
| L03 | Normalization cannot redirect after authorization | Changed path/resource gets schema and policy rechecked; frozen canonical input is used downstream. | NOT RUN |
| L04 | Generic preparation is local and optional | Void/no prepare and custom callback/handle preparation work without framework or unsafe non-null casts. | NOT RUN |
| L05 | All cleanup is attempted once | Partial prepare, execution failure, output failure and cleanup failure exercise correct LIFO/primary-error behavior. | NOT RUN |
| L06 | Timeout does not release live resources | Park action after abort or host stop; track draining/capacity, prevent late publication and delay cleanup until safe settlement. | NOT RUN |
| L07 | No shared action state across users | Concurrent calls use separate action instances/prepared resources; no cross-request mutation. | NOT RUN |
| L08 | Errors and outcomes preserve uncertainty | Secret-bearing thrown errors are sanitized; post-effect cleanup failure does not trigger automatic retry. | NOT RUN |

## P09 — Route existing client tool calls and advertisements through policy

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| T01 | Guessed tool IDs cannot bypass assignment | A caller with a session subscription but no invoke grant is denied before executor send. | NOT RUN |
| T02 | Advertising is separately authorized | Invoke-only client cannot register/replace executor; mismatched descriptor rejects whole advertisement. | NOT RUN |
| T03 | Post-await checks fence stale ads | Revocation/disconnect/rebind during policy evaluation prevents reducer mutation and activation. | NOT RUN |
| T04 | Exact executor identity enforced | Wrong connection/contract/implementation/instance/generation completion rejects; ambiguous candidates deny. | NOT RUN |
| T05 | No result or invocation payload leakage | Only admitted executor gets arguments and authorized caller gets output; other subscribers get neither. | NOT RUN |
| T06 | Existing defensive broker bounds retained | Input/output limits, call capacity, timeout, disconnect and duplicate completion regressions remain meaningful. | NOT RUN |

## P10 — Protect snapshots, events, catalogues and queued deliveries

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| V01 | Initial snapshots never bypass resource/tool privacy | Forbidden initial subscription returns no protected snapshot/descriptor before grants; mixed subscription batch is atomic or explicitly documented safe filtering. | NOT RUN |
| V02 | Shared tool metadata is private by construction | Scan raw snapshot/action frames for hidden schema sentinel across meta, activeClients, serverTools and error echoes. | NOT RUN |
| V03 | Listings and counts are recipient-scoped | Forbidden rows never affect returned items, counts or cursor contents; stale view cursor is invalid. | NOT RUN |
| V04 | Queued events obey revocation | Revoke while initial/subscription delivery is buffered; hidden payload is dropped before send. | NOT RUN |
| V05 | Native snapshot/event projections remain coherent | Apply delivered events using installed SDK reducer and compare to next permitted snapshot. | NOT RUN |
| V06 | Canonical server state is not mutated by projection | Two recipients with different views cannot affect each other or the internal catalogue. | NOT RUN |
| V07 | No unstructured-content overclaim | Tests/notes distinguish structured descriptor privacy from text intentionally authored inside an authorized stream. | NOT RUN |

## P11 — Implement private protocol views and migrate client APIs

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| W01 | Protocol version boundaries are explicit | Unknown extension version and incompatible legacy clients fail without leaking a catalogue or executing. | NOT RUN |
| W02 | Private advertisement preserves exact activation | Mismatched/stale/failed response cannot activate new handlers; observers do not receive raw descriptors. | NOT RUN |
| W03 | Long invocation does not block control traffic | Dispatch returns receipt; status/cancel and completion operate without original-request deadlock. | NOT RUN |
| W04 | Call state/result APIs are scoped and bounded | Another actor guessing callId gets safe denial; TTL, retained bytes/count and draining capacity tested. | NOT RUN |
| W05 | Compatibility is not a bypass | Both @toolClient/new import route to protected runtime; old RPC aliases either gate or reject. | NOT RUN |
| W06 | Authentication transport is injected | Fake authenticated transport and real SDK connection path work without URL tokens or framework-specific public types. | NOT RUN |

## P12 — Prove the protected existing-tool milestone with actual SDK clients

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| X01 | Senior and junior agents have separate effective authority | Same harness + different verified delegation/roles yields different assignments, calls and cached results. | NOT RUN |
| X02 | PM triage scenario is least-privileged | Read/summary grant does not become terminal input, production write or implementation replacement. | NOT RUN |
| X03 | Actual SDK and raw wire agree with policy | Multi-client reducer/view and canary frame capture prove no alternate metadata route. | NOT RUN |
| X04 | Existing regression gate stays meaningful | Full pnpm validate passes on candidate or exact blockers are reported; work/persistence guards unchanged. | NOT RUN |
| X05 | Client invokes its own supplied implementation through public APIs | Real public server/tool client and pinned SDK transport execute the exact approved client handler and validate its distinctive result; prove the full identity, grant, contract/source/revision, resource/route, provider and raw-wire negative matrix in TEST_RUNBOOK §9. Zero competing-handler calls. | NOT RUN |
| X06 | Distinct client A invokes client B's supplied implementation | Separate authenticated callers/executors and generations, independent invoke/execute assignments, exact selected B handler/result, zero A/competing handler calls and recipient-specific disclosure/negative matrix through the same public path. | NOT RUN |

## P13 — Implement nonblocking challenge and verified continuation

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| C01 | Required challenge cannot be skipped | No verifier, false proof or client mfaPassed flag produces zero prepare/execute calls. | NOT RUN |
| C02 | Continuation is nonblocking | Same-socket challenge/status/resume succeeds without holding the first dispatch. | NOT RUN |
| C03 | Exact request binding enforced | Input, actor, resource instance, policy revision or selected executor substitution invalidates approval. | NOT RUN |
| C04 | Continuation is atomic single use | Two simultaneous valid resumes result in one admitted execution; duplicate completion cannot project twice. | NOT RUN |
| C05 | Current revocation still wins | Grant revoked during verify causes denial; replay/expiry/disconnect/restart cannot resurrect authority. | NOT RUN |
| C06 | MFA is not delegation or human consent | Agent remains agent; satisfied identity step-up alone does not authorize a separate approval obligation. | NOT RUN |
| C07 | Challenge metadata and storage are bounded | Unapproved redirects, secret metadata, excessive pending/proof bytes and hanging verifier fail safely. | NOT RUN |

## P14 — Exercise resource-specific policies and authorized result projection

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| R01 | Resource operation permissions are independent | Terminal read cannot send input/terminate; workspace read cannot write; chat read cannot mutate. | NOT RUN |
| R02 | Trusted relations prevent scope laundering | Shared terminal/workspace cannot use a caller-invented permissive parent; origin and target constraints both apply. | NOT RUN |
| R03 | Unknown resource/provider fails closed | Missing adapter or mandatory evaluator never becomes unrestricted access. | NOT RUN |
| R04 | Result is not an arbitrary state patch | Executor-returned action JSON is untrusted; approved projector uses registered owning service only. | NOT RUN |
| R05 | State commit respects freshness and single settlement | Revoke/replace instance/duplicate result prevents unauthorized or repeated projection; completed effect is not retried. | NOT RUN |

## P15 — Add host-controlled executors behind the same dispatcher

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| E01 | Server implementation does not bypass policy | Denied caller/provider/challenge conditions yield no execute; permitted caller gets exact validated result. | NOT RUN |
| E02 | Provenance and executor revision are pinned | Client cannot replace host action or change location/implementation via metadata. | NOT RUN |
| E03 | Host/client routes share mandatory lifecycle | Equivalent cases both enforce validation, preparation, challenge and sanitized cleanup. | NOT RUN |
| E04 | Multi-user service account is not caller authority | Same server executor receives separate minimal authorized contexts; senior grants cannot leak to junior. | NOT RUN |
| E05 | Client invokes server-provided implementation through public APIs | Public server/tool client and pinned SDK transport execute the exact approved server handler and validate its distinctive result; prove TEST_RUNBOOK §9 matrix with zero client/competing-handler calls. | NOT RUN |

## P16 — Add bounded client proposals and explicit contract approval

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| Q01 | Proposal does not grant discovery/invocation | Unapproved candidates never appear in assignments or executor routing. | NOT RUN |
| Q02 | Schema intake is bounded and conservative | Oversize/deep/unsupported or identity-colliding definitions reject before expensive/unbounded compilation. | NOT RUN |
| Q03 | Approval/publication authority is explicit | Invoker/publisher without approve cannot self-approve; explicit domain rule is tested separately. | NOT RUN |
| Q04 | Approval does not silently widen old sessions | New revision requires scoped assignment/update; existing exact contract and views remain pinned until authorized change. | NOT RUN |

## P17 — Provide approved-artifact verification and transport extension points

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| F01 | Artifact identity and exact bytes are bound | Wrong digest/publisher/contract/revision/runtime rejects before loader execution. | NOT RUN |
| F02 | Only assigned recipients receive artifact data | Hidden locator/metadata/bytes never reach unassigned clients; size/count bounds enforced. | NOT RUN |
| F03 | No code-distribution fallback or hash attestation claim | Missing/declining loader denies; client-reported verification cannot alone authorize an executor. | NOT RUN |
| F04 | Loaded tools use existing execution boundary | Fake approved artifact handler still obeys all policy and challenge gates; no eval/package installation occurs. | NOT RUN |

## P18 — Finish consumer examples, migrations and module documentation

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| D01 | Examples use actual public APIs with explicit policy | Typechecked examples prove direct/namespace modes, generic role strings and empty secure defaults. | NOT RUN |
| D02 | Documentation maps every implemented source file | pnpm docs:check passes; public API and wire migration are documented. | NOT RUN |
| D03 | Capabilities/limits are accurate | No claims of real MFA, PTYs, filesystem isolation, distributed revocation, attestation or cross-principal durable work from fake tests. | NOT RUN |

## P19 — Run full coverage, failure interleavings and final acceptance

| ID | Requirement | Distinguishing assertion / evidence | Status |
| --- | --- | --- | --- |
| Z01 | Coverage is evidenced for the final candidate | Every matrix row maps to actual executed evidence. Re-run X05, X06 and E05 with all negative/disclosure matrices on the exact final integrated candidate; historical packet acceptance is insufficient. Missing evidence remains failure/blocker, never completion. | NOT RUN |
| Z02 | All enforced boundaries remain connected | No old unchecked broker, shared descriptor leak, role fallback or stale-view admission in final source scan/integration. | NOT RUN |
| Z03 | Repository final gate and scope constraints hold | pnpm validate and diff checks recorded; no DB/migration/dependency changes without approval; unrun external integrations disclosed. | NOT RUN |

## R4.1 scenario traceability

The supplied 35-scenario baseline is preserved below. R5 adds explicit ownership/source consistency, reveal allowlisting, same-harness isolation, client migration, safe execution contracts, runtime proposal admission and bounded artifact seams. These are mappings, not passes.

| Earlier case | R5 coverage |
| --- | --- |
| A01 | K01, A01 |
| A02 | N01, A01 |
| A03 | I03 |
| A04 | S02 |
| A05 | S01, A02 |
| A06 | G02, C06 |
| A07 | T02, A05 |
| A08 | G02 |
| A09 | G03 |
| A10 | N05, Q04 |
| A11 | S04 |
| A12 | A02, E01 |
| A13 | V02 |
| A14 | V01 |
| A15 | V04 |
| A16 | T01 |
| A17 | R02 |
| A18 | R01 |
| A19 | L03 |
| A20 | C02, W03 |
| A21 | C03, C04 |
| A22 | R05, G04 |
| A23 | L05 |
| A24 | G06 |
| A25 | V05 |
| A26 | R03, A02 |
| A27 | Z02, T01 |
| A28 | G05 |
| A29 | T03, T04, I05 |
| A30 | C01, E02, F03 |
| A31 | N04 |
| A32 | G04 |
| A33 | W01, W05 |
| A34 | A01, X04 |
| A35 | W02, V05 |

## Evidence status rules

Use NOT RUN, PASS (with actual candidate/command/test), FAIL, or BLOCKED (with the specific missing prerequisite). Do not mark PASS for a missing/skipped test, an unchecked type assertion, a helper returning a hardcoded allow, or a historical commit report. After changing related behavior, invalidate that evidence and rerun the affected checks.

No numeric statement-coverage threshold replaces these cases. The priority is a regression that catches a plausible incorrect implementation—especially metadata leakage, caller/executor confusion, legacy bypass, grant races and continuation reuse.
