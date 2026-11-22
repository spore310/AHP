# P15 accepted handoff

Status: ACCEPTED E01-E05. Base23a4fd23247f2c2e6ff5d1819064e9880c485f9a,
local GLM/agentIdentity. Lead sole writer/runtime, p06_review independent read-only
plan/source/docs review. Tested normal checkpoint pushes are explicitly authorized.
P16-P19 remain outstanding; P19 must rerun all three public execution matrices on
the final integrated candidate. Preserve p12-debug.mts and failed evidence.

## Scope and invariant preservation

The neutral canonical policy module now serves client and server adapters. The
client entry remains client-only. The new @toolExecution/server entry compiles
static host actions, captures exact approved implementation/source/revisions and
requires explicit trusted executor context/generation/current/pure fence. It never
creates caller or executor grants. Independent caller invoke and host execute
assignments, mandatory constraints and original full routes remain canonical.

Initial resolution is provisional. Trusted action validation can normalize target
input; full authorization pins the canonical input/full route for effects, challenge,
projection and status refresh. Later target changes deny. Host action execution
uses the existing ordered schema/auth/validation/prepare/execute/output/cleanup
pipeline. Safe errors, no retries, draining and output ownership remain shared.

AHPServerOptions.serverToolExecution flows through the public binding/kernel. It
requires the session creation registry/compiler. Host-only and mixed configurations
work. Both routes share one dispatcher; overlapping contract IDs or conflicting
option objects reject. Host descriptors require reveal and offer discover/invoke
only. Client advertisements cannot select a host registration. Local calls use the
existing private retention/status/resume owner and have no remote completion slot.
No denied host route falls back to a client handler. Server projection joins the
original invoke/execute proofs with resource-operation decisions before owner commit.

The application exports an inert bounded echo registration (no automatic installation,
filesystem, shell, network or model runtime). No dependencies, persistence, work
owner/lease equality, credentials or protocol version changes. Source binding names
the trusted registration and observed fixture export; it is not remote attestation.

## Criteria and exact evidence

Unit file: src/tests/toolExecution/serverExecutor.test.ts (14 tests).
Public file: src/tests/websocket/serverTools.integration.test.ts (29 tests).
Public support reuses toolPolicyFixture and policyIntegrationFixture. Explicit
host-service identity is excluded from client credential roles. serverFixture.ts
exports createServerHarness; its actual SHA256 is captured into source metadata,
with registration5/source7 and host generation11. Public execution uses the real
createAHPServer, public connectToolClient and pinned SDK WebSocketTransport.

| ID | Distinguishing test names / observations |
| --- | --- |
| E01 | Unit 'executes only the exact host registration with independent caller and executor'; deny caller/executor/provider/evaluator/challenge with zero effects. Public user and agent calls yield exact validated host results; missing caller/executor/evaluator/challenge deny. 'a live host assignment cannot bypass an invoke-only mandatory provider denial' preserves native discovery, denies execution and admits a restored control. |
| E02 | Unit 'rejects forged registration and stale host identity'; public strict dispatch contract/schema/identity/implementation substitutions, attempted advertisement of a host contract, server-only and mixed configurations, overlap/dispatcher-conflict rejection, and 'forged client completion cannot replace an admitted local result'. |
| E03 | Unit event order proves authentication, normalization, preparation, execution and reverse cleanup. 'pins normalized target input for execution and status refresh' plus independent normalized-target denial/revocation. Actual client/server shared capacity and output-budget ownership; joint resource projection allowed/revoked controls. Public challenge one-attempt resume, sanitized execute/cleanup/output failure, noncooperative cancellation/draining and mixed host/client capacity. |
| E04 | Unit 'one host executor keeps two callers isolated'; public 'shared host identity preserves senior/junior scopes and native snapshot/action sequencing'. Senior write succeeds; junior write denies; separate contexts, exact executor and schema privacy remain intact. |
| E05 | Complete public route matrix below, exact host handler/result, zero competing/client handler calls and source/identity/route assertions. |

## Public E05 negative and disclosure map

| Requirement | Actual test |
| --- | --- |
| Authentication | 'rejects absent, invalid and host-identity client credentials before authority'; valid raw initialize envelopes and dispatch deny, authenticated control succeeds. |
| Invoke vs receive | 'public denies missing caller/executor authority'; exact host assignment is separate from client actor grants. |
| Contract/schema/revision/source/location | 'strict dispatch rejects contract, schema, identity and implementation substitution without fallback'; invalid input and unassigned client registration also deny. Approved source metadata equals trusted hashed fixture registration. |
| Full route/provider incarnation | 'exact full route denies substitutions and missing provider proof then admits a fresh control': missing/expired/wrong proof, omitted chat/workspace, replaced origin/instance/target. |
| Provider and mandatory constraints | Invoke-only provider-deny test with live host affordance; missing evaluator test; 'mandatory changed during awaited authorization' removes the chat constraint. |
| Challenge | Unsatisfied condition denies with zero prepare/execute. 'server challenge resumes once and private status never discloses to another client' verifies the original call and foreign/replay denial. |
| Revocation / stale identities | Parameterized 'changed during awaited authorization suppresses host execution' covers caller grant, executor grant, host generation, caller generation and mandatory policy, with reached/release and fresh generation controls. |
| Resource replacement | 'a parked server call cannot cross session destruction and same-URI recreation' rejects old work and admits a new incarnation. |
| Raw-wire privacy | Authorized caller and observer captures cover initialize/subscription, assignment/advertisement, errors, private dispatch/status/cancel/resume, revocation and output. Distinct input/result/descriptor/schema/source/private-adapter canaries remain recipient-scoped. No host invoke/completion is sent to clients. Native action/reducer/sequence control passes. |
| Buffering | 'initial snapshot revocation drops buffered host-session content and descriptors' reaches an awaited permission, buffers native content, revokes, releases and observes denial plus a causal ping barrier without buffered canaries. |
| Completion isolation | Forged remote completion cannot replace local output; running status persists until genuine local settlement. |

All absence assertions follow operation receipts, reached/release points, RPC or
connection-close barriers; no wall-clock sleeps choose races. Fixture callbacks
are fake trusted policies/providers; these are loopback public integration tests,
not external credential, production MFA or remote-code attestation tests.

## Reproducible evidence and review

Every check used execution/Invoke-DbSafeCheck.ps1 with the complete sanitized child
environment. Logs remain local/ignored; no live persistence or dependency install.

- P15-review-candidate.sha256: initial28paths, SHA1f5c68e2b26db9e0299241776c619658d5f12aee686cd36bb8107587ba45a2b9.
  P15-candidate-validate.log PASS all stages94files1240tests211mappings.
- Reviewer requested invoke-only provider denial; lead added buffering evidence.
  No production defect was found by independent review. Both additions passed.
- P15-review-additions-focused.log PASS2files43tests.
- P15-review-candidate-2.sha256: revised28paths, SHAbe9fe26ddb9d02b95e1ce98b0de1755216bd9f436b4593375058ad5f6bc4ca44.
  P15-reviewed-validate.log PASS all stages94files1242tests211mappings,CHECK_EXIT0.
- Failed evidence retained: fixture generic variance typechecks; scoped/full lint
  unused test parameter; cancellation expected cancelled instead of existing draining;
  buffer test initially omitted the required raw initialize channel. These are fixture/
  validation repairs, not claims of reproduced production security regressions.
- P15-final-candidate.sha256 identifies the final acceptance-record candidate;
  P15-final-validate.log must pass all stages before commit/push. Independent final
  record/hash verification supplements source/docs review; runtime is lead-produced.

Continue directly to P16 after verified normal push, preserving all earlier gates.
