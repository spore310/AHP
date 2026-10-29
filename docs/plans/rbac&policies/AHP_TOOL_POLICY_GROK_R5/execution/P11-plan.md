# P11 execution contract

Status: Independent integrated plan PASS after one revision. Base:
`941fe855b312e1102f67d75cd63c15f9f8e66b97` (P10 accepted and pushed).
The lead is the sole writer; the existing independent reviewer is read-only.
The unrelated untracked `nul` remains excluded. The goal authorizes P11 and
subsequent packets, scoped documentation, DB-safe checks and normal checkpoint pushes.

Independent `p06_review` approved the DTO/host-retention slice and unchanged
extraction of bounded value capture. The browser graph must sentinel-reject Ajv,
server and Node imports. Activation after reply enqueue uses only the exact owned
staged ticket and callback-free fences. An absent receipt after execute admission
is ambiguous, not evidence of no effect. Fresh status proofs are isolated from
execution proofs and pin the original full route with `sameRoute`. Keep P08's
completion/output guards. Extract `captureToolValue` unchanged into
`helpers/value`, retaining action imports as compatibility reexports.

Integrated-plan revision from review: extend the canonical authorizer with
`validateAssignmentCohort([{ authorization, actor }])`, bounded to 512 issued
authorizations/1024 total stamps. Sample the canonical clock and prune once, then
validate every genuine stamp and exact installed tuple at that same time. No
callbacks occur inside or after that cohort check except pure owned-state fences.
Single `validateAssignments` uses the same helper with one member. The client
policy service exposes a cohort check for its own issued proofs and retains each
proof's actual caller context privately. Use it for advertisement, invoke and
fresh status proofs. Regress staggered short-TTL caller/executor proofs where
sequential validation would admit an expired earlier proof; reentrant mutation and
foreign/copied proofs must fail. This is a narrow correction to P09/P10 freshness,
not a new policy engine or exemption from any mandatory constraint.

Checkpoint review refinements: indexed single capture preserves proof provenance
even with input accessors or overridden array methods. Delayed admission/result
publication samples logical TTL as well as owned state. The cohort cap is 512
authorizations (unchanged 1024 stamp limit), sufficient for four purposes across
the DTO ceiling of 128 tools. Actual canonical session types remain capped at 64
tools (`src/tools/constants.ts`); no session capacity expansion is authorized.
The initial reviewer inference of an existing 128-tool positive wire path was
disproved by the actual catalogue gate. Test 64-tool successful advertisement and
execution, 65/128 session-type rejection, 129-advertisement rejection preserving
prior handlers, and 128/130/256/512 neutral proof cohort acceptance with 513 denial.

## Ownership and implementation slices

1. ToolExecution owns strict v2 DTOs and bounded private call retention. Keep
   imports browser-safe. Add tested waiting/running/draining/completed/failed/
   cancelled status, safe absence, finite TTL/count/output bytes, monotonic cleanup,
   and caller-specific access ports. Retention expiry cancels but never releases
   the dispatcher's unsettled-work capacity. No automatic dispatch retry.
2. Extend the sole P09 broker and kernel adapter with negotiation, assignment,
   private advertisement and receipt/status/cancel methods. Reuse canonical policy
   selection, exact tuples and P08 dispatch. Do not create a second executor.
3. Migrate the one client runtime and both import surfaces to minimal native init,
   capabilities, private assignments/advertisement, exact invoke/completion, bounded
   status polling and typed challenge/pending errors. Preserve owned/borrowed disposal.
4. Add adversarial client and public-wire tests, update scoped READMEs/wire docs,
   run focused and full DB-safe gates, review the exact final candidate and push.

## Wire amendment (project extension, native AHP remains 1.0.0)

Every extension envelope has `version: 2`; the tool contract version is nested
in `contract`. All selectors are strict and bounded. Assigned requests contain
only channel; advertisement contains channel, issued view revision and contract
selectors. Dispatch contains channel, contract selector and input. Status/cancel
contain only callId. Resume is explicitly unsupported until P13. Capabilities
contains no inventory. Unknown versions and all old public wire aliases fail closed.

Assigned responses carry the full resource incarnation, actual connection fence,
an opaque view revision and exact descriptors/definitions with allowed purposes.
Discovery requires reveal as well as permission. Execute/advertise require the
approved registration/source/implementation and actual executor identity; an
assignment is never authority for later invocation. No challenge is admitted in
P11. Each assigned view is recipient-bound, bounded and current at final send.

Private advertisements are broker-owned canonical routing records; they do not
publish raw native activeClient actions. Stage a candidate against an exact issued
view, verify current policy and connection, and atomically replace the routing
record only after successful local response enqueue. Failure preserves the previous
record. The exact acknowledgement contains accepted descriptors, the view revision,
resource/connection fence and an advertisement ID. Client handlers stage before the
request and activate only on that exact acknowledgement; early invoke messages are
bounded and correlated to that advertisement, never executed against a different one.
This preserves canonical session state and P10's empty structured-tool projection.

Invoke and complete bind callId, channel/resource incarnation, contract,
implementation/source/registration revision, executor connection/generation and
advertisement ID. Complete is accepted only from the exact selected connection;
unrecognized notifications gain no special connection-pump bypass. Execution source
binding remains host approval, not remote code attestation.

Dispatch reserves a bounded record before starting the existing dispatcher and
returns accepted only after input/schema/full authorization admission. Expose an
admission signal at the proxy action's execute boundary (no preparation hook in
this proxy), race against terminal denial, and never await remote completion to
produce the receipt. Cancel settles the caller but retains draining work. Result
reads freshly authorize the original caller, route and selected executor through
the same policy path, never reroute/re-execute. Final reply guards bind the record,
recipient, current authorization, resource incarnation and connection generation.

## Verification contract

W01: unknown version, absent negotiation/configuration, authority-bearing extra
fields and old aliases disclose no catalogue and execute nothing.
W02: exact acknowledgement; altered/stale view, resource, generation, descriptor or
advertisement cannot activate; failure retains previous handlers and routing.
W03: a pending handler permits receipt, ping, status, cancel and exact completion;
completion from a guessed/foreign connection never settles it.
W04: foreign actor/connection status is safe absence; revocation/expiry and final
reply races suppress results; TTL/count/bytes bounded; draining capacity retained.
W05/W06: both import surfaces, real pinned SDK and injected owned/borrowed transports;
no root autosubscription or raw-manifest fallback; bounded polling never resubmits.

Keep all existing assertion intent; migrate fixture wire responses where required,
without weakening denial coverage. Preserve every failed log. Required commands:
DB-safe typecheck; focused clientProtocol/toolProtocolV2/connection suites; docs:check;
full `pnpm validate`; independent final review. P12 remains responsible for the
expanded X05/X06 proof matrix; this packet still requires a real successful public
client invocation and private result as its own outcome.
