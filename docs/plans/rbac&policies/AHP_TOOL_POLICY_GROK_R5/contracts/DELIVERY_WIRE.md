# Assigned views, protocol compatibility and mutation timing

**Target contract, R5.** This is the highest-risk integration boundary. Nothing
in this document claims the current shared AHP snapshot is already per-user private.

## D1. Complete egress inventory

Check all paths, not only discovery:

| Path | Required behavior |
| --- | --- |
| initialize initialSubscriptions | Resolve identity/grants and resource access before any protected snapshot leaves. |
| root snapshot/listSessions/counts | Do not leak forbidden resources through identities, summaries, counts or pages. |
| subscribe and repeated subscribe | Same actor-aware projection and current instance checks. |
| `_meta['x-ahp-application']` | No full internal catalogue in a protected client view. |
| activeClients tools and future serverTools | Filter authorized descriptor sets without fabricating executor capabilities. |
| accepted actions and rejection echoes | No replay of another client's hidden descriptors or malicious requested metadata. |
| initial-subscription buffers/replay | Recheck at delivery; do not retain a preauthorized raw payload indefinitely. |
| private invoke/results | Authorize actual selected executor/recipient and resource route, not just channel membership. |
| artifact URLs/bytes | Only admitted recipients; locators themselves can be sensitive. |
| in-process embedding APIs | Provide policy-aware facade; low-level SessionFactory remains a trusted kernel, not an endpoint safe for arbitrary clients. |

Unstructured chat/output content has its own resource access policy. The SDK's
structured-tool metadata guarantee is not universal redaction of a tool name that
someone typed into text, cached earlier, or placed in a log.

## D2. Canonical state versus private view

One authoritative state/reducer remains. Project read-only copies per recipient.
Maintain a separate assigned-tool view with its own revision, never a replacement
counter disguised as AHP serverSeq. Keys include identity/delegation, scope,
resource instance, policy/grant revisions and executor admission.

The SDK reducer compatibility spike (P10) must prove:
`projected snapshot + delivered valid actions == next permitted projected view`.
Do not remove arbitrary required action fields until it happens to compile. Preserve
valid private acknowledgement for an advertiser's exact accepted descriptor set;
observers may receive a different permitted projection. If the pinned SDK cannot
represent a filtered transition safely, use a negotiated private-view resnapshot
extension and deny the unsupported old view—never full-manifest fallback.

Before P10 freezes the wire, inspect the installed pinned SDK types/behavior in
the local checkout. No guessed native methods, invented Microsoft protocol
versions or assumptions about contiguous sequence numbers. Type and integration
tests must exercise actual SDK reducers/clients, not just a local JSON comparator.

## D3. Versioned private extension — target baseline

Native AHP stays pinned to 1.0.0. The following names are **project-owned proposed
methods**, not Microsoft-standard commands. New request/response envelopes carry
`version: 2`; unknown versions fail closed. Do not add guessed fields or methods
to the upstream SDK. Negotiate after minimal native initialization with no initial
subscriptions. P00 inspects the installed transport contract; P11 supplies the
injection adapter instead of guessing browser/Node credential overloads.

| Method | Direction / purpose |
| --- | --- |
| `x-ahp/tools/capabilities` | Request `{version: 2}`; confirm private assignment/continuation support without revealing tool inventory. |
| `x-ahp/tools/assigned` | Request permitted origin/session/resource view; returns safe exact descriptors, purposes, conditions and view revision. |
| `x-ahp/tools/advertise` | Private bounded request for exact admitted local implementations; reply carries exact normalized accepted descriptors and revision. |
| `x-ahp/tools/dispatch` | Start invocation; promptly return accepted call ID, challenge-required or safe denied outcome. |
| `x-ahp/tools/status` | Read authorized call status/result; no other actor can enumerate it. |
| `x-ahp/tools/resume` | Continue challenge by opaque ID/proof reference; no new input, actor, role or executor. |
| `x-ahp/tools/cancel` | Authorized cooperative cancellation of one admitted call. |
| `x-ahp/tools/assignmentsChanged` | Private invalidation hint with revision; no hidden schemas in the hint. |
| `x-ahp/tools/invoke`, `x-ahp/tools/complete` | Existing directions retained, with negotiated v2 envelopes and exact invocation/connection/implementation correlation. |

`dispatch` returns after admission and records an in-memory call; it does not hold
a JSON-RPC request throughout execution. The client helper may poll `status` with
a bounded backoff until completion. A challenge suspends before preparation. Call
state and retained output have finite TTLs/counts/bytes, distinct from challenge
TTL. Keep execution capacity occupied by draining work until it actually settles;
a disconnected caller must not free execution slots for work still running.

Use this small result vocabulary, with runtime schemas in types.ts:

```ts
type DispatchReply =
  | { version: 2; status: 'accepted'; callId: string }
  | { version: 2; status: 'challenge-required'; callId: string;
      continuationId: string; expiresAt: string; presentation: ChallengePresentation }
  | { version: 2; status: 'denied'; code: string };

type ChallengePresentation =
  | { kind: 'wait'; message?: string }
  | { kind: 'redirect'; url: string; message?: string };
```

Status includes waiting/running/draining/completed/failed/cancelled states; an
expired ID and an inaccessible ID use the same safe public absence outcome.
No automatic dispatch retry after ambiguous network failure. A lost reply is not
proof the action did not execute. This milestone promises correlated single
settlement of a known call, not exactly-once external side effects.

The JavaScript compatibility `callTool()` wrapper uses dispatch/status internally
and returns completed output or a typed challenge-required error. A richer
`dispatchTool()`/`resumeTool()` surface exposes continuation. No token is placed in
URL/query parameters. Inject a connected SDK-compatible transport or a trusted
connect factory. Transport disposal ownership is explicit.

Old unversioned wire calls and old shared-manifest clients must not become a bypass.
Return a safe extension-required/unsupported result in protected hosts unless the
same dispatcher can serve an explicitly negotiated compatible completed-call path.
Do not retain a second unchecked broker. Source import shims preserve convenience,
not insecure behavior. The protected default has zero tool assignments.

## D4. Atomic authorization effects

An async decision is a snapshot, not an indefinitely valid permission. Capture
local security epoch, policy/binding revisions, scope instance, agent generation
and chosen implementation. After awaits and immediately before enqueue/commit,
check freshness with no intervening await. If changed, reauthorize or deny with
bounded retries. The consuming application's external resolver has explicit
freshness/invalidation semantics; no invented distributed linearizability.

On grants/policy/relationship change: increment host revision, invalidate positive
and negative decision caches, refresh affected assignments, invalidate challenges
where required, and recheck buffered messages at send. Expiration must be handled
on access and during bounded cleanup, not only when an unrelated timer runs.

A still-running call does not automatically reroute or rerun after permission
loss. Its completion is correlated; sensitive result delivery/projection is freshly
authorized. Cleanup proceeds even when result disclosure is denied. Already admitted
remote side effects cannot be rolled back by pretending the response was denied.

## D5. Protected migration gate

P01–P09 introduce contracts/integration incrementally; do not advertise intermediate
builds as safe for shared users. Existing raw source contracts may survive during
migration, but no external route may select an older unguarded path once protected
mode is assembled. Sample and test callers must install explicit narrow fixtures;
never preserve old tests by leaving anonymous tool execution enabled.

No security configuration means no protected tool assignment/execution. Basic native
initialization/ping and trusted in-process domain construction can still exist, but
they do not expose protected descriptors/resources by implication. The full privacy
milestone requires P10–P12 and real SDK two-client evidence on the final candidate.

## D6. Conservative projection strategy for the first implementation

In protected views, place all callable schemas/implementation lists in the private
assignment API. Shared session snapshots/actions do not publish any raw tools in
`activeClients`; project their `tools` arrays to empty. Omit or replace the internal
application tool list with its safe non-descriptor projection. Provider/root
metadata is projected too. Do not leak descriptors in rejected action echoes.

The advertiser receives its exact accepted descriptor list through the private
`advertise` response, not a special raw broadcast action. Stage local handlers
before request; activate only after exact response and current view/generation
checks. Maintain canonical advertisements internally for routing and structural
admission. Observers do not need another client's executable schema list to see
that an authorized participant exists.

Use the pinned SDK's actual reducer/client tests to confirm that the projected
native snapshots plus projected native actions stay coherent. Permission changes
refresh the separate assignment view. A revoked subscription cannot keep receiving
native events; close its authorized view and require a permitted resubscribe rather
than sending a made-up upstream action. If a necessary upstream state transition
cannot be represented safely, document a project-owned resnapshot extension and
prove it with a test before enabling it. Do not approximate native serverSeq.

Filtering list results must precede pagination/count calculation. Cursor contents
must not encode hidden rows; bind them to scope and view revision and invalidate
on changes. A listener/publisher cannot cache a raw pre-revocation payload as a
permanent permission to send it later. Recheck every queued protected payload at
the final local send admission point.

## P11 correlation amendment

The host may send notification x-ahp/tools/cancel to the selected executor using
the exact invoke correlation fields, excluding input. The same method in the
caller-to-host request direction still accepts only version and callId. The client
aborts only the matching active local call. This is cooperative; cancellation,
timeout or disconnect never proves remote work has stopped or frees its draining
slot. Exact completion can retire owned work even after policy revocation, without
releasing a result to an unauthorized caller.
