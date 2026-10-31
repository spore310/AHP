# P12 protected client-execution proof plan

Status: PLAN REVIEW PASS (independent p06_review). Execute authorized by active P06-P19 goal.
Base: 8189e1da3d4abb64594aa01dc271d8f27b24f2e4, P11 accepted and exact remote
origin/agentIdentity identity verified. Lead is the sole writer; p06_review is
read-only. No production edits are assumed necessary by this packet.

## Evidence and ownership

P11 public tests now prove one distinct authenticated caller/executor roundtrip,
exact correlation, private observer frames, cancellation and revocation. They do
not prove X01-X06's full scenarios or route matrix. Historical P09 fixtures remain
internal native-broker evidence. P12 must use public createAHPServer and both
public tool-client imports, with the pinned SDK transport and actual credential
classification. No kernel substitution, allow-all policy mocks or fabricated
identity proof is permitted.

Own policyIntegration.test.ts, bounded shared fixture support, and packet/coverage/
runbook/acceptance records. Evidence-backed test-support amendment: extend existing
websocket/toolPolicyFixture.ts with opt-in trusted actor/delegation, exact per-tool
assignment selection, canonical route/mandatory-policy setup and source registration
options; defaults retain all existing tests. Put scenario composition beside it in
policyIntegrationFixture.ts when that keeps one host harness and clear ownership.
The shared client handler/source evidence may live in toolExecution/fixtures.ts.
Do not duplicate the complete host harness or change production contracts merely
to make a fixture pass. A production defect requires a narrow failing reproducer,
recorded amendment and independent review before the dependent repair.

## Scenario model

One immutable coding harness supplies read, summary, write and terminal-input
contracts/handlers with separate identifiable outputs. Verified credentials create
senior user, junior user, PM user and distinct classified agent contexts. Agent
contexts retain agent ID/generation/delegation reference; real canonical child
grant lineage derives only the explicitly installed subset of each user's grant.
Exact per-contract discover/invoke/advertise/execute assignments stay independent.
The session owner is not substituted for any caller, and arbitrary role/clientId/
agent/model fields cannot manufacture authority.

The existing public broker accepts native session channels and resolves an origin
whose canonical kind is session. Model triage chat as an ordinary typed triage-chat
session origin, with explicitly registered chat/workspace target constraints.
This is fixture data and does not add a new chat service/channel or bypass trusted
origin resolution. Parent session admission may include write/terminal contracts;
missing child assignments and mandatory chat/provider rules still prevent them.
Document this representation rather than claiming a generic non-session transport.
All route components retain full incarnation identities. Namespace selection is
only a ceiling. Required provider proof/evaluator absence and explicit denial
must prevent effects even when application grants allow.

Source evidence records exact trusted registration ID/revision, binding/location,
contract/schema/version, source path/export and fixture candidate digest. Observe
the distinctive handler/result and zero competing handler counters. This proves
which approved fixture implementation ran; it is not remote process attestation.
Never accept a client-reported source hash as host authority.

## Thin execution slices

1. Extend bounded fixtures and add real public positive X05 self-client and X06
   A-to-distinct-B execution. Capture actual host setup identities/generations,
   raw per-recipient frames and exact assigned/ack/invoke/completion tuples. Use
   approved source exports and validated distinctive outputs; assert zero A or
   competing-handler calls on X06. Add explicit competing registrations/candidates
   only with canonical assignments that select the intended one unambiguously.
2. Parameterize both routes over missing/invalid auth, missing caller invoke,
   missing executor receive, contract/schema/version substitution, approved source/
   implementation/revision/location substitution, wrong origin/incarnation/target,
   provider denial/missing mandatory authority, unsatisfied challenge and stale
   connection generation. Exercise manual forged selector fields and legacy aliases
   as well as typed SDK helpers. Every forbidden path has zero handler effects.
   Where testing wire tampering, retain the original exact frame only for explicit
   cleanup after a causal barrier; never count a synthetic wire success as the
   public positive proof. Invalid output must never become a successful result.
3. Add senior/junior/PM and agent lineage scenarios from SCENARIOS sections1/2/5,
   including distinct assignments, guessed writes/terminal input, foreign result
   reads, parent revocation and no implicit implementation replacement. Observe
   actual SDK native reducers and private inventories together.
4. Add deterministic reached/release barriers for revocation/disconnect/rebind and
   same-URI incarnation reuse during awaited policy decisions and publication.
   Inspect init/subscription/metadata/action/error/ack/invoke/status frames using
   distinct descriptor/schema/input/output/private-metadata canaries. A permitted
   recipient must receive the positive canary; the observer must not. Use causal
   ping/close/response barriers, not sleeps, for absence claims.
5. Run the exact packet command and full DB-safe pnpm validate; inspect unchanged
   database/migrations and src/persistence/work guards. Update TEST_COVERAGE,
   TEST_RUNBOOK, SCENARIOS and E2E-ACCEPTANCE with current evidence rather than the
   old 730-test snapshot. Freeze hashes, independent final source/docs review,
   scoped commit, approved normal push and exact remote SHA verification.

## Acceptance and exclusions

X01: actual verified delegation and canonical lineage, same harness/different
assignments/results; no shared cache leakage. X02: PM inspection/summary cannot
become write/terminal/replacement through session membership. X03: private DTOs and
actual native SDK views/raw frames agree across all egress paths. X04: full gate
and untouched work/persistence predicates. X05/X06: each positive plus complete
TEST_RUNBOOK section9 matrix, exact source/identity/route/revision and zero competing
effects. Test method names and handoff tables must map every negative separately.

No challenge success before P13; missing challenge verification denies. No server
execution claim (P15 E05), artifact runtime or deployment. P19 must rerun all three
routes and negatives after later packets. No DB access, dependencies, reset/stash,
force push, model changes or unrelated staging. All checks use Invoke-DbSafeCheck.
After two failed repairs of a criterion obtain a new diagnostic, not another blind
edit or a weaker assertion. Preserve every failing log and actual proof boundary.

Plan review accepted the typed-session triage representation. Preserve distinct
parent/triage/chat/workspace identities and test omitted/substituted route against
otherwise valid grants. Mandatory rules must be registered on resources, required
provider authority uses externalAuthority, and agent lineage uses parentGrantId.
Review input SHA20e8f1daadb106f1b0026172d9ccfd6a9e73dda674c997516f283a7961fe39b4.
