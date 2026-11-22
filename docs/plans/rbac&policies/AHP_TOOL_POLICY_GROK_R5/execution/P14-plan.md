# P14 execution plan and scoped contract amendment

Execute under the existing R5 goal. Base84bc468f14669ec56aeee42d0278c0669e979b8b,
local GLM/agentIdentity, exact origin/agentIdentity verified. P13 accepted with
90files1156tests202mappings full gate and independent C01-C07 PASS. P14 PLAN
REVIEW PASS after joint authority/deadline refinements; implementation in progress. Lead sole writer/runtime; p06_review
read-only plan/final reviewer. Preserve unrelated p12-debug.mts and failed logs.

## Observed current boundaries

ResourceRegistration in authorization/helpers/resources/types.ts stores one route,
owner, optional sessionType/provider admission, mandatory refs and external mode.
ReferenceAuthorizer.installResource in helpers/evaluate/helpers.ts is canonical
owner/installation/relationship-revision authority. evaluate requires exact route
for the selected scope and applies mandatory policies across every route resource.
It accepts ToolOperation (discover/invoke/etc.), not arbitrary application actions.
Existing ResourceResolver describes supported operation strings but has no kind
registration implementation. No second owner/grant store is needed.

Dispatcher validates output, then cleans up, then guards delivery and returns its
private outcome. It has no result projector. SessionFactory.dispatchAction validates
existing pinned action schemas and calls its synchronous admission veto after clock
and sequence callbacks, immediately before existing reducer mutation; this is the
correct real-service test seam. No new chat/terminal reducer action is required.

## Bounded resource operation service

Extend authorization/helpers/resources with a trusted createResourceOperations
service and schemas/types. Static registrations bind exact kind, application type
key/version and provider ID to supported named application operations. Each operation
maps to an explicit existing policy purpose (ToolOperation) and a finite positive
policy-ref ceiling. This deliberately retains the frozen tool-policy vocabulary;
read/input/write/terminate are application operations, never inferred from names.
Their policy paths are separate even if two map to invoke. Type-level admitted and
mandatory refs come from the existing compiler binding for that exact type/provider;
the existing sessionType slot is the compiler's structural binding key. Document
this mapping rather than inventing a second policy compiler or mandatory-rule set.

Kinds have an injected resolve(selector, signal) -> actual ResourceRef and current /
pure fence ports over the provider's current instance. Caller kind/id are selectors,
not type/provider facts. Resolve requires an already canonically installed resource;
missing/unregistered kind/type/provider/instance returns safe unsupported/denied.
Expose trusted install through this service for fake/application resources, using
exact registered type/provider and canonical registry installation. Native sessions
continue using P05 canonical installation. Do not maintain a parallel owner map.

Minimal canonical amendments in evaluate/types+helpers: expose a frozen public
registered-resource read (without installation capability), including exact admission
association; and optional bounded additional allowedRoutes on ResourceRegistration /
RegisteredResource. Existing route remains the primary path and existing behavior
is unchanged when no alternatives exist. Capture/validate every full route, unique
refs/domain, resource membership and finite counts before installation. Evaluation
accepts only a byte-equivalent/full-ref registered route, never a caller-invented
parent or partial target list. Relation updates bump canonical revisions and
invalidate prior proofs. Shared terminal/workspace can have two explicitly registered
full origin routes without reinstalling it on each invocation. Owner and admission
immutability and installation-token cleanup remain unchanged.

Operation authorization requires the exact original full route, target in that
route, and the same actual caller. For each unique route resource, require its exact
registered type/provider and supported application operation, one complete positive
binding under that operation's finite policy ceiling, and all canonical mandatory
constraints. Use existing policy select/evaluate/matchesAll and canonical invalidation;
never synthesize grant fragments. A read-only triage origin cannot approve a write
operation just because the shared target permits another origin. Each scope's
application operation rule maps to its own policy purpose/refs. Missing evaluator,
required external authority or unsupported operation denies. External proofs, when
required, come from the registered provider port, never the projection request.

The returned operation ticket is private service-issued state: exact caller,
operation, full resource/relationship/type/provider identities, captured action data
and issued policy proofs. Currentness runs provider callbacks first, then aggregate
canonical freshness, then pure registry/provider/instance fences. No host callback
or await may separate the last fence from owner-service admission. Bounds: at most
32 kinds/128 type-provider registrations/64 operations per type/64 route resources,
16 allowed routes per resource, existing policy-ref ceilings and registry capacities.
Async resolver/proof/select work has finite active count64 and5s deadline, with a
slot retained through actual late settlement; aborted work cannot install or commit.

## Joint final admission refinement

Extend the existing canonical validateAssignmentCohort implementation with
validateAuthorityCohort(assignments, decisions), where decisions are bounded
issued LocalDecisionStamp + actual TrustedRequestContext pairs. Validate issued
identity, capture actors, then sample the canonical clock once and check every
assignment tuple and every decision at that same time. Existing assignment-only
validation delegates to it; no second clock domain or freshness implementation.

The resource service's final admission presents its registry identity and issued
operation stamps to a trusted invocation admission port. ToolDispatchPorts gains
optional admitProjection(context, authority) for this exact final boundary; absence
denies configured projection. The client broker retains its original three private
proofs and uses the same registry's aggregate for them AND the operation stamps,
requiring exact registry identity. Its external currentness callbacks run before
that aggregate, its pure owned connection/registration fences after. The resource
service runs provider currentness callbacks before invoking that port, then pure
canonical/provider/instance fences after it. The dispatcher samples its own deadline
before invoking the port and checks callback-free cancellation/closed state AND a
pure dispatcher deadline fence after all admission callbacks. Custom clocks with
projection require paired fenceNow just as challenges do; reject nonfinite or
backwards time at the fence.
No callback or await separates those final pure checks from owning-service mutation.
P15's server composition must provide the equivalent original-proof admission.

Add an actual SessionsFactory.dispatchAction guarded-mutation regression: original
invocation stamp expires at10, operation stamp at20; a provider/owner callback moves
time9 to11. Mutation must be denied. Cover the symmetric expiration ordering and
fresh positive control. Also set dispatcher deadline10 and both proof deadlines20;
an admission callback advancing9 to11 must deny mutation despite valid proofs.
Sequential invocation-current and resource-current checks
alone are expressly insufficient.

## Optional result projection

Add toolExecution/helpers/projection/{index,types,helpers}.ts owning the application
projector port and registered operation adapter. A trusted projector receives only
frozen validated output and captured ToolActionContext; it returns one bounded
resource-action request (target full ref, named operation, payload) or undefined.
It cannot return executable callbacks, SessionState or a trusted reducer patch.
The target must belong to the invocation's original full route. Action validation
and synchronous commit belong to a statically registered owning-service operation.
The commit port receives a final admission callback; the real SessionFactory adapter
passes it to dispatchAction. No SDK code blindly calls dispatchAction on executor
JSON. Rejected native/unknown actions never become accepted state mutations.

Configure an optional projection service in ToolDispatcherOptions (trusted host
configuration, never wire input), reused by client/server dispatchers. Invoke it once
only after execution output validation AND successful cleanup, before sensitive
result release. It independently authorizes the requested resource operation and
rechecks original invocation currentness after every await. Projection cannot use
MFA to satisfy a new distinct challenge: a required unsatisfied resource-action
challenge denies projection, with no execution retry. Preserve the original full
route, actor/delegation and selected implementation throughout.

Add projection phase and safe projection-failed outcome code while preserving
existing succeeded/failed vocabulary. A failed projection is distinguishable from
failed execution, effectPossible stays true, no raw output/adapter error leaks, and
execution is not rerun. Cancellation/timeout during projector/authorization retains
the dispatcher job/output budget until actual settlement; late callbacks cannot
commit after cancellation or shutdown. One dispatcher lifecycle can invoke one
projection ticket once; copied/foreign/replayed tickets fail by identity/state.
The owning service performs synchronous guarded mutation; asynchronous external
transactions and rollback/exactly-once external effects are not claimed.

## Ownership and invariants

Owned: resources types/helpers/index, narrow canonical resource read/allowed-route
changes in evaluate types/helpers and public exports, projection supporting module,
dispatcher types/helpers, client broker joint-proof admission, narrow canonical
cohort extension, source-map/contract documentation, requested
resourceScopes.test.ts and resultProjection.test.ts plus scoped fixture updates.
This expands the packet's listed paths only where the existing canonical owner must
implement route/read support; recorded here before implementation. No dependency,
wire extension, persistence/work-owner/lease change, real process/filesystem/chat
runtime or new policy compiler. Preserve P13 challenge and all existing tests.

## Slices and distinguishing evidence

1. Resource service + canonical route support: R01 fake terminal read/input/terminate,
   workspace read/write and chat read/mutate separate grants. R02 one shared target
   with two registered sessions; origin-specific allow/deny, forged relation and
   omitted chat/full-route target reject. R03 absent kind/type/provider/evaluator,
   unsupported operation, stale instance and external proof deny. Test route updates
   invalidate issued stamps and old teardown cannot remove replacement incarnation.
2. Projection integration: R04 executor-returned action-shaped output alone never
   mutates; only configured projector+registered validated owner action can commit.
   Positive real SessionsFactory title action runs existing reducer/sequence once;
   fake terminal/workspace actions stay fake. No arbitrary patch/native action.
3. R05 controlled revoke/replace-instance while projector/authorization is parked,
   final callback reentrancy, duplicate/foreign ticket, cancellation/late settlement,
   cleanup failure, schema-invalid output and projection rejection: one execution,
   zero forbidden commit/output, safe distinguishable failure, preserved cleanup.
   Positive fresh control after each race. Bound resolver/projector/provider work
   and malformed limits/action metadata. Run affected legacy policy/session/dispatcher
   gates, required packet command and full DB-safe validate before acceptance.

All tests/checks use execution/Invoke-DbSafeCheck.ps1. Required focused command:
vitest run src/tests/authorization/resourceScopes.test.ts
src/tests/toolExecution/resultProjection.test.ts. Then independent exact candidate
source/docs review, resolve findings, final gate/handoff/ledger/manifests, scoped
normal approved checkpoint push and remote SHA verification. Continue P15-P19.

## Candidate review refinements

Independent review required four bounded fixes: close retained owner admission on
return/throw; capture cohort lengths and stamp identity once with finite integer
bounds; retain dispatcher output through resource work settlement; preflight extra
route target counts before clone. Lead regression also proved same-full-ref
reinstallation during resolution could outlive a stale snapshot; pin canonical
epoch before resolution and keep it through final mutation.

ResourceOperations.authorize returns { ticket, settled }; ticket may resolve
undefined on timeout/cancel while settled waits for actual adapter work. Projection
awaits both, keeping job/output ownership. No new wire contract or dependency.
P14-review-regressions-red.log has8failures; green counterpart passes42tests.
