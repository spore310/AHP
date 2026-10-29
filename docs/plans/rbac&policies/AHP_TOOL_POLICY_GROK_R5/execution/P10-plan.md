# P10 execution amendment and plan

Execute, elevated risk. Base b7a059da12b23c57a6b9b379946e862a651aaa40;
P06-P09 accepted and pushed. Lead is sole writer; p06_review is read-only.
P10 is not accepted. No public tool execution or private v2 API is claimed here.

## Contract and ownership

Add an explicit opt-in `protectedViews` host configuration using the identical
canonical registry/compiler as session creation, plus a required bounded list of
policy refs deliberately admitted for resource reads. Selected `discover` with
`reveal:true`, no challenge, an actual scoped binding and all mandatory constraints
authorizes the resource snapshot/native stream, including authored text. Existing
tool discovery grants alone never open this seam. Selection omits the optional
tool. Each admitted alternative is evaluated independently. Trusted route resolution
supplies full origin/targets and optional external/mandatory selectors; it cannot
replace the canonical origin. No new operation or parallel authority registry.

Root provider catalogue is conservatively `agents: []`: there is no independent
provider-catalogue grant. Permitted session summaries retain their provider identity.
Root counts and lists use only permitted resources, filtered before pagination.
Opaque bounded cursors bind the connection/actor, permitted view, catalogue basis
and expiry; hidden offsets/revisions never appear on the wire. Empty views reveal
no rows. All native responses still require explicit global-sequence permission.

Amend packet ownership to the current private kernel, its views adapter helper,
host types/helpers, shared
bounded test fixture, and authorization evaluate types/helpers for a callback-free
local revision fence. That fence proves only no intervening registry mutation,
never permission or expiry; actual issued decision freshness still runs first.
Aggregate `matchesAll` uses one final canonical clock sample and checks every
issued stamp at that time, then the callback-free revision/ownership fences.
Individual matches followed by a mutation fence are insufficient: a later clock
callback can expire an earlier proof without any mutation. Add the distinguishing
deadline-10/deadline-20 regression with a final clock advance from 9 to 11.
This closes multi-proof trailing-callback races without duplicating authorization.
The existing sessions constants module adds the two pinned metadata/server-tool
action discriminants rather than duplicating ambient SDK enums or weakening lint.
Neutral source ports explicitly capture pure resource/catalogue ownership fences;
ordinary source callbacks never run after aggregate freshness. Proofs and stamp
arrays are immutable, service-issued and recipient-bound. Private canonical basis
refs (including excluded rows) never form part of the wire `value`.

## Slices and invariants

1. Neutral views service owns policy decisions, defensive projection, list cursors
   and proof freshness. Sessions remain the sole canonical state owner. Strip the
   internal application descriptor metadata; empty active-client/server tools in
   both snapshots and matching native actions. Unknown structured transitions deny.
2. Kernel snapshot/list replies use issued proofs and the actual reply guard.
   Initial subscriptions are atomic. Repeated subscriptions use the same gate.
   No pending subscription commits on denied/stale/failed response delivery.
3. Per-peer bounded ordered delivery queues retain intents and reauthorize at
   delivery. Capture exact resource incarnation at enqueue; never retarget URI reuse.
   Final transport admission follows all callback-bearing checks with owned fences.
   Revoked/unrepresentable views close and require permitted resubscription; no
   fabricated upstream actions or sequence. Removal never discloses unknown URIs.
   Canonical root counts are projected using captured catalogue rows for their real
   native event, not a fabricated per-recipient sequence.
4. Public facade opens only configured protected initialize/subscribe/list routes.
   Native mutations/tool wire remain closed until their owning later packets.
   In-process canonical factory remains trusted; export the neutral view service
   for policy-aware embedding. Existing private invoke/result checks remain P09.

Finite admission/concurrency, input/resource/cursor counts, queued bytes, hook
deadlines and cleanup are required. Timeout may release a caller but must retain
unsettled work ownership. No unbounded Promise chain from repeated publications.

## Evidence

V01: denied/mixed initial requests and repeated subscribe; no descriptor before grant.
V02: raw-wire canaries in manifest, active clients, server tools and error echoes.
V03: two recipients, hidden provider/row/count, pagination, cross-actor/stale cursor.
V04: revocation during async decisions, initial reply, buffered replay, final setup
callback; URI reuse, bounded queue and shutdown. Preserve failed reproduction logs.
V05: installed SDK session/root reducers and real SDK client snapshots/events equal
the next permitted projection, genuine sequence values retained.
V06: canonical and other-recipient snapshots unchanged by projection mutations.
V07: authored text remains governed by resource permission; no universal redaction.
Attach a check/status for every P00 inventory row in final handoff. Artifact routes
remain unavailable; P11/P12 private acknowledgements are later acceptance work.

Run focused DB-safe typecheck/tests/docs checks, then full DB-safe `pnpm validate`.
Independent final source/documentation review must cover the exact hashed candidate.
Record accepted evidence only after all gates, then scoped tested commit/push and P11.

Plan gate: PASS from independent p06_review after the aggregate-expiry correction.
Early source review found final subscription/sequence fencing, trailing source
callbacks and unsubscribe/refresh ownership gaps. Fixes and focused regressions
exist; final candidate review and refreshed full validation remain required.
Root membership comparison uses full-incarnation sets. Observed canonical additions
retain native catalogue/count continuity; permission-only gains/losses close the
view. A late invalidation refresh cannot revive or close an unsubscribed generation.
