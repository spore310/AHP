# P4 — WorkEventPublisher, protected snapshots, notifications and chat projection

**Outcome:** committed work changes reach currently authorized clients through the existing host binding/delivery machinery, with a reliable reconciliation path when hints are missed.  
**Depends on:** P0–P3 durable identity/state and operation/read authorization.  
**Deliberate limit:** best-effort hints plus authoritative reads; no durable outbox, replay log or automatic chat turn execution.

## 1. Existing extension points

The factory already publishes native catalogue/session envelopes. The AHP kernel owns subscriptions, pending buffers and reply-settlement hooks. Protected delivery owns per-peer ordering, byte/count limits and final-send guards. Its current branches recognize native action/catalogue messages, so merely calling its existing publish closure with a work method will not create a safe work channel.

Extend:

| Owner | Files / responsibility |
| --- | --- |
| Work events and view projection | `src/work/helpers/{events,views}/{types,helpers,index}.ts` |
| Host wiring | `src/websocket/helpers/host/{types,helpers}.ts` |
| V1 wire handlers | `src/websocket/helpers/ahp/agentWork.ts`, constants/types |
| Subscription coordination | `src/websocket/helpers/ahp/helpers/kernel/helpers.ts` |
| Shared protected delivery | `src/websocket/helpers/ahp/helpers/views/{types,helpers}.ts` |
| Client work projection | `src/work/helpers/client/{types,helpers,index}.ts`, existing single transport reader |
| Chat placeholder adapter | `src/work/helpers/chatProjection/{types,helpers,index}.ts` |
| Example/integration evidence | `examples/advanced/`, new work-events sample, mirrored tests |

A standalone generic broadcaster would duplicate the existing ownership and freshness rules; do not add one.

## 2. Post-commit event contract

### Target: `./src/work/helpers/events/types.ts`

```ts
export type WorkEventKind =
  | "submitted" | "claimed" | "renewed" | "completed"
  | "failed" | "requeued" | "cancelled" | "dataUpdated";

export interface WorkEvent {
  readonly version: 1;
  readonly type: WorkEventKind;
  readonly workId: string;
  readonly revision: Revision;
  readonly session: ResourceRef<"session">;
  readonly occurredAt: string;
  // No lease token, input/data/result, raw exception or authorization proof.
}
export interface WorkEventPublisher {
  publish(event: WorkEvent): void;
  subscribe(listener: (event: WorkEvent) => void): () => void;
  dispose(): void;
}
```

A concrete local publisher bounds listeners and catches diagnostic failures. Host subscribers enqueue protected projection; they do not synchronously wait for every recipient to acknowledge. Async listener return values are not silently awaited or allowed to produce unhandled rejections.

Publish after a confirmed commit and live/private-proof invalidation. Identical submit replay, failed transaction/CAS, terminal no-op cancel and stale settlement emit nothing. Unknown commit outcome emits an uncertainty diagnostic and is recovered by reading, not a fabricated event. Callback failure cannot undo a committed mutation.

Events carry per-work revisions. They may arrive late, be duplicated by a consumer's retry or be missed around a crash. Clients discard older/equal item revisions; they do not assume global adjacency. The wire serverSeq is allocated through the shared P0 publication order, not by the repository.

## 3. V1 wire surface

Existing mutation methods use P1–P3 contracts. Add these methods, keeping explicit `version:1` and strict runtime schemas:

| Method | Request | Response / behavior |
| --- | --- | --- |
| `x-ahp/work/list` | session locator and optional announceTo locator, filters, bounded limit/cursor; announceTo alone may imply session | Authorized summaries, nextCursor; no unauthorized totals |
| `x-ahp/work/get` | exact workId | Authorized detailed view or sanitized not-found/denied outcome |
| `x-ahp/work/subscribe` | canonical resource locator and initial page limit | connection-owned subscriptionId, streamEpoch and initial authorized page |
| `x-ahp/work/unsubscribe` | subscriptionId | Removes only this connection's subscription, buffer/cursor/proofs |
| `x-ahp/work/changed` | server notification only | Small authorized change hint |
| `x-ahp/work/reset` | server notification only | Clear/refetch instruction for the known subscription; no hidden resource details |

`list` without announceTo considers the exact session's work and applies read policy to every row. With announceTo, it also requires that resource to match the work's announce selection. `subscribe(resource)` follows the latter rule: it observes work announced to that resource. Thus announce=[] suppresses unsolicited hints but does not prevent an authorized owner/application from listing the session's work.

All selectors resolve to exact instances. A cursor/subscription can never follow a reused URI into a new incarnation.

### Changed hint shape

```ts
interface WorkChangedParams {
  readonly version: 1;
  readonly subscriptionId: string;
  readonly streamEpoch: string; // opaque, changes on host ownership generation
  readonly workId: string;
  readonly revision: Revision;
  readonly change: WorkEventKind;
  readonly serverSeq?: number; // only when allowGlobalSequence is explicitly true
}
```

Do not disclose leaseToken, executor-only input, mutable application data or raw errors in a hint. A hint causes get/list invalidation/refetch. Rich chat presentation is an optional separately authorized projection, not an invitation to broadcast full records.

If the consumer has not composed coherent protected view/delivery support, work subscription capability is unavailable; do not fall back to unprotected publication. List/get still use their own canonical authorization. Advertise supported private work methods in the existing extension capability/configuration surface, without inventing a Microsoft-native capability name.

## 4. Authorization and view projection

- Submission authorizes selecting each announcement target with the work announce policy.
- Delivery independently evaluates the current recipient's work read permission and visibility of the target canonical resource.
- A parent's descendants selector is resolved from canonical ancestry. An exclusion is evaluated before projection but does not bypass mandatory denial.
- Being subscribed, being the submitter, or knowing a work ID is not permission to receive its input/result/data.
- Consumer projection callbacks receive only the already authorized work facts for that recipient. Bound their input/output, pending count and deadline; recheck proof/context after callback settlement.
- Private intent storage binds the exact canonical resource/work instance and recipient generation, not just a mutable URI.
- An announcement recipient cannot infer hidden work counts from a global sequence when allowGlobalSequence is false. Do not expose a global work-counter substitute.

For list/get, use detached read snapshots and work revisions. Revalidate data-dependent proof freshness and relevant row revisions before guarded response admission. A page is a current authorized projection at its read/admission boundary; paginated pages are **not** claimed to be one long-lived database transaction or an immutable point-in-time snapshot. Client reconciliation handles concurrent changes.

List/snapshot work is bounded by examined rows as well as returned items: examine at most 128 rows and spend at most 5 seconds per call, with bounded concurrent policy evaluation. A count-budget stop returns an opaque continuation even when it returned zero visible items. Capture a finite sweep upper key at the first page; bind continuations to recipient, exact session/resource, filter, generation and upper key. No cursor means the sweep actually reached its end. A timeout/failed policy preparation returns a retryable incomplete/error outcome, never a false end-of-sweep. Cursors reveal no raw hidden row IDs or counts; this is not a claim to eliminate all timing/pagination-pattern side channels.

No fresh grants are created by a projection. Existing mandatory bindings/external proof rules remain applicable.

## 5. Subscribe/snapshot race, explicitly

1. Validate and authorize the canonical subscription target; allocate a bounded connection-owned pending slot and generation.
2. Begin buffering matching work events **before** starting the asynchronous list query/projection.
3. Read the first authorized page. Capture per-item revisions and streamEpoch.
4. Install the reply's final authority/connection/instance guard through the existing invocation mechanism.
5. In `onReplySettled`, activate only after a successful guarded enqueue. If the reply failed, remove the pending slot and discard its events.
6. Flush buffered hints through the same ordered protected queue, checking current permission for each. Deduplicate a hint only when its item revision is known to be already represented; otherwise keep it as a refetch hint.
7. **Never discard a buffered work hint using only a sampled serverSeq.** SQL snapshot completion and sequence.current() are not an atomic consistency cut.
8. Unsubscribe/replacement/connection-close invalidates the generation and releases every cursor/proof/buffer. A late snapshot completion cannot reactivate it.

Example race to test: SQL reads work at revision 4; work commits revision 5 and publishes while the page is being authorized; the page captures a larger global sequence afterward. Revision 5 must still be delivered/refetched after the reply. A naive fromSeq cutoff would lose it.

Extend the existing delivery intent to a discriminated union for native messages and work hints. Work subscriptions may have their own typed entries, but **share** pending/queued byte and entry accounting with native delivery. No parallel unbounded fan-out queue. Retain final-send guards immediately before actual socket writes.

## 6. Reconciliation, resets and failure handling

The work client helper consumes one generic extension request/notification port; it does not start another transport recv loop. Until P5 extraction, extend the existing transport's single-reader observer seam and adapt it; P5 moves that generic seam to client without rewriting work semantics.

Client behavior:

- On changed(workId, revision), mark the known item dirty and coalesce an authorized get/list refresh.
- Compare decimal-string revisions numerically, not lexically and not through unsafe Number conversion.
- On fresh subscription, epoch change, reset, reconnect or queue overflow, discard the old subscription generation/cursors and reconcile from list.
- While actively connected/subscribed, reconcile every 30 seconds by default (configurable, minimum 5 seconds), even with no hints. This resolves a lost final notification without requiring another work change.
- Pagination accumulates a current view; revisions prevent older pages from overwriting newer item data. Remove vanished items only after a complete successful finite sweep for that exact filter/generation. An empty page with a continuation, a timeout or partial refresh must not be treated as a complete empty snapshot.
- No timer/read continues after dispose or while disconnected. No automatic work submission or execution is retried because a view refreshed.
- A permission change invalidates pending projections; emit only a safe reset for an already-known subscription or close it. Never expose the denied item's identity as an explanation.
- Retiring the target invalidates the subscription. A replacement URI requires a fresh explicit subscription and current authorization.

Bound client-retained state as well as each server page. Default to 500 tracked items (hard maximum 5,000) and at most 20 pages / 10 seconds in one refresh. Dirty sets, revision maps and pending gets are bounded by the tracked set and existing request limits. If a refresh reaches a retention/page/time limit, expose an explicit incomplete/limit result and its continuation, cancel that scan generation, and do not report authoritative deletion of unseen items. Do not automatically accumulate an entire unbounded terminal history. The consumer can narrow filters or read more history through explicit pages. A cache reset caused by capacity is a local invalidation, not evidence that the server deleted items; pause automatic full-view accumulation until the consumer chooses a bounded view. Reconciliation's convergence guarantee applies to an actively maintained view that fits its declared bounds.

Overflow follows existing fail-closed close/reset behavior. The server records a bounded diagnostic; it does not enqueue another huge error payload into the same exhausted queue.

## 7. Microsoft chat placeholder, verified at the pinned version

The repository pins `@microsoft/agent-host-protocol@1.0.0`. The corresponding upstream `v1.0.0` tag points to commit `5f16d81bb7045b66d7bc768d244feab75002d943`. Its root exports include Message/MessageKind, ChatState and ChatAction. MessageKind includes SystemNotification. Source:

- [package manifest](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/typescript/package.json)
- [chat state/message types](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/state.ts)
- [chat actions](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/actions.ts)

Use these actual types through one replaceable adapter:

```ts
// Target ./src/work/helpers/chatProjection/types.ts
import { MessageKind } from "@microsoft/agent-host-protocol";
import type { Message, ChatState, ChatAction } from "@microsoft/agent-host-protocol";

export type WorkChatState = ChatState;
export type WorkChatAction = ChatAction;
export type WorkChatMessage = Pick<Message, "text" | "_meta"> & {
  readonly origin: { readonly kind: MessageKind.SystemNotification };
};

export interface WorkChatProjectionAdapter {
  project(input: {
    readonly chat: ResourceRef<"chat">;
    readonly event: WorkEvent;
    readonly work: AuthorizedWorkView;
    readonly recipient: TrustedRequestContext;
    readonly signal: AbortSignal;
  }): WorkChatMessage | undefined | Promise<WorkChatMessage | undefined>;
}
```

The initial implementation supports only the bounded system-notification subset above. Default text derives from permitted kind/status; metadata may contain workId/revision. A consumer can supply its formatter. Validate text length, permitted origin, bounded plain metadata and no extra fields after the callback. Do not invent an upstream MessageSchema runtime export.

Expose this optional message in the extension's authorized work presentation, or pass it to an explicitly registered consuming application's chat handler. The default adapter **does not dispatch a native chat action** and does not alter native chat turn state.

This distinction matters: upstream Message participates in turn initiation/steering; pendingMessageSet can schedule a turn; backgroundWork represents currently running shells/subagents. Queued AHP coordination work must not be disguised as either. Provider-created canonical chat resources and a typed work presentation do not mean the host implements every native chat lifecycle method.

Future custom chat handling replaces this one adapter/handler seam. Work storage, lease authority and selectors do not depend on a proprietary chat message representation.

## 8. Acceptance tests

| ID | Observable evidence |
| --- | --- |
| P4-01 | Each confirmed mutation emits its expected event/revision; replay/rollback/conflict/no-op emits none |
| P4-02 | Subscriber receives a hint only when announce selection and current recipient read/target authority allow |
| P4-03 | Excluded child, private result/data and target from another incarnation never leak |
| P4-04 | Queue before snapshot → commit during query → guarded reply → correct later revision hint |
| P4-05 | The async SQL/global-cursor race above cannot lose revision 5 |
| P4-06 | Reply denied/failed/disconnected leaves no active subscription or retained buffer |
| P4-07 | Unsubscribe/re-subscribe/retire/URI reuse invalidates old generation and late completions |
| P4-08 | Mixed native/work bursts share entry/byte limits; overflow resets/closes without unbounded memory |
| P4-09 | Revocation during projection and immediately before send suppresses payload |
| P4-10 | Recipient without global-sequence permission sees no serverSeq/global hidden count |
| P4-11 | Deliberately drop the final hint; periodic reconciliation converges without another event |
| P4-12 | Reordered/duplicate hints and stale pages cannot roll an item backward |
| P4-13 | Restart changes streamEpoch, preserves data/work, requires a fresh subscription and snapshot |
| P4-14 | Pagination is bounded, cursor-bound to actor/filter/instance, preserves SQL timestamp precision and omits unauthorized totals |
| P4-15 | Exact Microsoft v1 types compile at the adapter; callback output is runtime-bounded and cannot forge user-message origin |
| P4-16 | Work announcement never emits pendingMessageSet, backgroundWorkSet or an unsupported native ChatAction by default |
| P4-17 | One SDK/transport reader handles native messages, work RPC and work notifications concurrently |
| P4-18 | Dispose cancels periodic refresh, pending RPC/projection, listeners and subscriptions; late callbacks do not send |
| P4-19 | Publisher/diagnostic callback failures do not roll back committed work |
| P4-20 | Public createAHPServer + real pinned AhpClient demonstrates the full authorized work flow; no kernel substitution is mistaken for public proof |
| P4-21 | More than 128 denied rows before an allowed row yields bounded empty continuation pages and eventually the authorized item; no timeout/partial page triggers vanished-item deletion |
| P4-22 | Large terminal history respects tracked-item/page/time limits, returns explicit incomplete/limit state and never grows hidden dirty/revision maps without bound |

Add `src/tests/work/events.test.ts`, `views.test.ts`, `client.test.ts`, `chatProjection.test.ts`, and `src/tests/websocket/workEvents.integration.test.ts`. Extend existing protected egress/projection tests. Add `examples/work-events.ts` with two differently authorized recipients, an excluded chat, a dropped hint, reconnect and successful reconciliation.

Commands:

```sh
pnpm exec vitest run src/tests/work src/tests/websocket
pnpm exec vite-node examples/work-events.ts
pnpm exec vite-node examples/advanced/index.ts
pnpm exec vite-node examples/postgresql-conformance.ts
pnpm validate
```

**Exit gate:** missed notifications recover through current authorized reads, all delivery shares the established boundaries, chat types are pinned and replaceable, and no test claims native chat behavior the host has not implemented.

