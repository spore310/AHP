# P15 execution plan and scoped contract amendment

Execute under the active R5 goal. Base23a4fd23247f2c2e6ff5d1819064e9880c485f9a,
local GLM/agentIdentity; exact remote agentIdentity verified. P14 accepted R01-R05,
43packet tests, full92files1199tests205mappings and independent PASS. Lead sole
writer/runtime; p06_review read-only plan/final review. P15 PLAN REVIEW PASS after normalization/lifecycle refinements;
implementation and source/docs review PASS; acceptance evidence in P15-handoff.md. Preserve p12-debug.mts, prior manifests and failed logs.

## Observed ownership

AHPServerOptions.toolExecution and AHPBindingOptions.toolExecution currently accept
ClientToolBrokerOptions only. Host creation already requires exact session registry
and policy-factory coherence. websocket/helpers/ahp/toolInvocation.ts owns private
assignment/ad readiness, route selection, connection/session fences and remote
completion correlation. Its calls map and private retained-call service own
cancellation/status; no additional call registry is needed.

createClientToolPolicy currently owns canonical registration capture, trusted route
resolution, actual-actor policy selection and projectAssignments. It rejects server
bindings. createClientToolDispatcher owns a remote proxy through createToolDispatcher,
with three invoke/advertise/execute proofs, actual enqueue receipt, refresh/status and
P14 joint projection authority. The core dispatcher already supplies required
schema/hooks/challenge/cleanup/draining/projection behavior. No server runtime seam
exists. Native session-provider identity is distinct from tool implementation.

## Contracts and bounded implementation

1. Extract the existing neutral policy selection/registration/proof behavior into
   toolExecution/helpers/policy/{types,helpers,index}.ts. Registration metadata accepts
   either existing execution binding variant; construction explicitly selects allowed
   location. Keep createClientToolPolicy's current client-only boundary as a wrapper
   and preserve its public aliases and behavior. Reuse this one policy implementation
   for server registrations; no copied evaluator or second authority cache. Existing
   original actors, complete grants, exact approved contract/implementation and
   aggregate proof semantics remain intact.

2. Add toolExecution/helpers/server/{types,helpers,index}.ts with explicit public
   @toolExecution/server entrypoint (tsconfig alias), not exported eagerly by root
   or client entrypoints. ServerToolRegistration captures compiled action registration,
   exact server/host binding, positive registration revision and source id/revision.
   A generic createServerToolRegistration helper compiles schemas with the existing
   createToolActionRegistration; action factories remain local trusted callbacks.
   Reject mismatched definitions, client bindings, duplicates/ambiguous contract
   registrations and nonfinite/malformed identity metadata. A registry does not
   manufacture grants or install executor assignments on behalf of callers.

3. ServerToolBrokerOptions supplies the same registry/policies, static registrations,
   trusted route resolver and explicit host executor identity: TrustedRequestContext,
   host generation, current callback and pure owned fence. No default admin/service
   account or inferred user identity. Per-registration ExecutorRevision carries
   this actor, host-owned identity id/generation and registration revision. Trusted
   host registration is the executor authentication boundary; it is not a client
   socket, session provider, model runtime or remote attestation claim.

   createServerToolDispatcher resolves and authorizes caller invoke independently
   from the exact host executor's execute/receive assignment, using the original
   caller for canonical authority stamps and the executor context for executor
   policy selection. It combines invoke+execute challenge requirements. Neither
   server trust nor executor role supplies caller authority. Raw context/currentness
   callbacks precede one canonical cohort check; pure caller/session/host fences
   follow. P14 admitProjection combines original invocation and operation proofs.
   Initial resource resolution is provisional: pin caller, executor, implementation
   and origin, but permit trusted validation to normalize target input. At full
   authorize, capture the normalized input and full resolved route. Continuation,
   projection and later status refresh reuse that exact canonical pair, never the
   raw request input. Once fully authorized, a changed target/route denies rather
   than reroutes. Test a successful target-changing normalization, denial of the
   normalized target and revocation of that target before refresh.
   Dispatch executes the registered action through the shared core, never directly.
   Return the same private call handle contract (admitted/current/refresh/resume)
   used by existing retention/protocol; ready reflects core full admission, with
   no fabricated remote enqueue or pending completion for a local action.

4. Add optional AHPServerOptions.serverToolExecution and matching binding/kernel
   injection. Require exact same canonical registry/policies as protected session
   creation, including server-only host configurations. Capture both configurations
   before accepting calls. Client and server registration sets cannot overlap a
   contract id: reject ambiguity at configuration rather than fallback at runtime.
   A denied/missing host route never selects a client handler for that contract.

   Both adapters use ONE core ToolDispatcher in the transport composition. Existing
   standalone adapter factories may accept an explicit shared dispatcher as a second
   trusted argument; otherwise they create their own. If both configuration objects
   specify dispatcher options they must be the same instance, avoiding silent limit
   or challenge-policy precedence. One supplied configuration or defaults creates
   the shared core. All calls share limits, action ownership, challenge capacity,
   retained output budget, invalidation, stats and shutdown/draining.

5. Extend private assignment preparation with server tools. For each permitted exact
   server contract, require discover/reveal and independently expose invoke affordance
   only when caller invoke + host execute checks pass. Reuse existing bounded AssignedTool
   execution metadata for host binding/source/revisions; no actor proofs or secrets.
   Host rows never offer advertise/execute purposes to clients. Private and legacy
   client advertisements cannot install host actions; server-only views advertise an
   empty client set safely. No wire schema/version expansion is needed.

   startCall selects the statically registered server branch before client routing,
   retaining authenticated caller subscription/session/connection-generation fences.
   Host execution uses existing call retention/status/resume; calls map records an
   optional remote executor for client-only cancellation correlation. Session removal,
   caller disconnect, host stop and authority invalidation fence/cancel local work.
   Completed status refresh reacquires fresh same-route caller+executor authority;
   source/registration/generation stay pinned. Remote completion notifications never
   match local calls. Stats/drain delegate once to the shared lifecycle owner.

6. Add an inert bounded example action through application/helpers.ts and public
   application export, plus concise server consumer example. It returns in-memory
   data only; no filesystem, shell, network, model, credentials or automatic runtime
   installation. Root/client portable imports remain free of eager server imports.

## Owned paths and preserved invariants

New neutral policy and server supporting modules; narrow existing client broker
extraction/shared-dispatcher parameter; host/binding/kernel/toolInvocation injection;
tsconfig alias; inert application example; scoped module README/contract/source maps;
requested serverExecutor.test.ts and serverTools.integration.test.ts; bounded shared
fixture additions to toolPolicyFixture/policyIntegrationFixture only where needed.
This is the packet's approved executor registry/application seam amendment.

No dependency/lockfile changes, live persistence, server inference, processes,
filesystem adapters, work owner/lease changes, general RPC priority bypass, new
wire version, duplicate canonical grants, fallback routing or scope expansion to
artifacts/P16. Preserve all prior assertions and failed evidence.

## Slices and acceptance evidence

- E01/E02 core: distinct caller/executor grants; denied caller/provider/missing
  evaluator/challenge produces zero prepare/execute effects; zero action factory
  calls is required for initial/coarse rejection only, because supplementary auth
  and validation run before full policy/challenge. Preserve that core order. Exact successful
  validated output. Reject client binding/source/registration/contract mutation,
  duplicate host registration and stale executor generation, with fresh controls.
- E03/E04 core: full schema/auth/custom-normalization/prepare/execute/output/cleanup
  order; optional prepare, reverse cleanup, safe errors, challenge resume; cancellation
  and noncooperative draining; shared client/server capacity/output budget; P14 actual
  guarded projection and joint authority; senior/junior context isolation. No retry.
- E05 public: use createAHPServer + public connectToolClient + pinned SDK transport.
  Extend the real P12 fixture where useful, do not copy its host/security stack.
  Distinct authenticated user/agent callers, explicit registered host executor
  identity/generation, exact approved source path/export/hash/revisions, schema,
  full session/chat/workspace route and mandatory provider policies. Observe exact
  server handler and validated distinctive result, zero competing/client handlers.
- Run complete TEST_RUNBOOK section9 negatives: missing/invalid authentication,
  missing caller and executor grants, strict contract/schema/revision and execution
  metadata substitution, wrong instance/route, provider denial/missing evaluator,
  unsatisfied challenge, revocation during causal awaited decision, stale caller
  and host generations. Add successful fresh controls. Capture authorized caller
  and observer raw frames with argument/result/descriptor/schema/private canaries;
  use explicit reached/release and RPC/close barriers, no timing sleeps. Cover
  initialization/snapshot/action/advertisement/errors/buffer/status/revocation paths
  applicable to local execution; assert no private invoke/completion sent to clients.

Run focused tests through execution/Invoke-DbSafeCheck.ps1, including exact packet
command vitest run src/tests/toolExecution/serverExecutor.test.ts
src/tests/websocket/serverTools.integration.test.ts. Then required DB-safe pnpm
validate, independent exact candidate source/docs review, repair with reproducible
regressions, acceptance records/final manifest/gate, scoped normal approved push
and remote identity verification. Continue P16-P19; P19 owns final all-route rerun.
