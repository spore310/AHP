# V1 work wire and service contracts

**Status:** normative target supplement to the shared contracts and P1–P4. These are proposed interfaces, not names already exported by develop. Keep all request schemas strict and all replies explicitly serialized. Microsoft native requests and JSON-RPC `"2.0"` remain unchanged.

## 1. Service surface

Target: `./src/work/types.ts`. Reuse the existing WorkStatus and WorkError owners. Replace the old owner-only AuthorizedAgentContext with the shared trusted contexts. Keep full internal repository records out of public replies.

```ts
export interface WorkFailure {
  readonly retryable: boolean;
  readonly code?: string;     // bounded advisory worker input, not a trusted log code
  readonly message?: string;  // <=512 characters; never stored/logged by default
}
export interface WorkCompletion {
  readonly result: JsonObject;
  readonly data?: ReplaceData;
}
export interface WorkFailureCommand extends WorkFailure {
  readonly data?: ReplaceData;
}
export interface WorkService {
  submit(caller: WorkRequestContext, input: WorkSubmission):
    Promise<{ readonly id: string }>;
  claim(caller: WorkAgentContext, session: ResourceLocator):
    Promise<WorkClaimResult>;
  renew(caller: WorkAgentContext, execution: WorkExecutionRef):
    Promise<{ readonly leaseExpiresAt: string; readonly revision: Revision }>;
  complete(caller: WorkAgentContext, execution: WorkExecutionRef,
    command: WorkCompletion): Promise<void>;
  fail(caller: WorkAgentContext, execution: WorkExecutionRef,
    command: WorkFailureCommand): Promise<{ readonly status: WorkStatus }>;
  cancel(caller: WorkRequestContext, workId: string): Promise<void>;
  updateData(caller: WorkRequestContext, workId: string, change: ReplaceData,
    execution?: WorkExecutionRef): Promise<DataSnapshot>;
  get(caller: WorkRequestContext, workId: string): Promise<AuthorizedWorkView | null>;
}
```

`claim` requires a session-kind locator; the claim is session-scoped while capacity is identity-wide. The host resolves it once to an exact incarnation. A WorkExecutionRef on renew/complete/fail supplies the **attempt** as well as ID and token; do not leave the old lease wire schema without attempt. The host derives connection, actor, registration and execution epoch. Work data service conflicts throw the owned WorkError `conflict`; the trusted resource helper may return the shared ReplaceDataResult union. Both represent the same no-write CAS semantics.

Complete/fail/cancel still return their existing simple success shapes on the wire as specified below. The direct claim response is the only ordinary response that contains the newly issued lease token. AuthorizedWorkView is an explicit read projection, never an object spread of the internal record.

## 2. Mutating and direct-read method shapes

All object params below include `version: 1`. Field names are fixed; the wire adapter can flatten WorkExecutionRef while the service accepts its typed object.

| Method | Required/optional params beyond version | Success result |
| --- | --- | --- |
| `x-ahp/work/submit` | Shared WorkSubmission fields: optional session; requestKey, kind, input, scope; optional priority, targetAgentId, announce, data | `{version:1, workId}` |
| `x-ahp/work/claim` | `session: ResourceLocator` with kind=session | `{version:1, ...WorkClaimResult}`; claimed uses `lease`, never the old `work:null` shape |
| `x-ahp/work/renew` | `workId, attempt, leaseToken` | `{version:1, leaseExpiresAt, revision}` |
| `x-ahp/work/complete` | `workId, attempt, leaseToken, result`; optional `data: ReplaceData` | `null` |
| `x-ahp/work/fail` | `workId, attempt, leaseToken, retryable`; optional code, message, `data: ReplaceData` | `{version:1, status}` |
| `x-ahp/work/cancel` | `workId` | `null`, including authorized terminal no-op |
| `x-ahp/work/updateData` | `workId, expectedDataRevision, data`; optional `execution: WorkExecutionRef` | `{version:1, data, dataRevision}` |
| `x-ahp/work/get` | `workId` | `{version:1, work: AuthorizedWorkView | null}`; absent and undisclosable work both use null |

For updateData with execution, its workId must equal the outer workId. A token does not grant an independently authenticated caller worker identity. Reject writable domain/owner/submitter/registration/epoch/capacity fields. ResourceLocator.instanceId is opaque text; workId, lease token and durable registration IDs use the existing UUID validation.

Agent register/renew/unregister method names stay unchanged. Their schemas still accept no claimed principal/epoch. Register becomes async through durable binding, keeps idempotent same-connection behavior and returns `{version:1, agentId, presenceExpiresAt}`. Registration IDs may be returned; a client cannot choose them. Expose execution epochs only in trusted server context, not as client-selected configuration.

## 3. Lists and subscriptions

Target: `./src/work/helpers/views/types.ts` and `./src/work/helpers/client/types.ts`.

```ts
export interface WorkListSummary {
  readonly id: string;
  readonly session: ResourceRef<"session">;
  readonly kind: string;
  readonly priority: number;
  readonly status: WorkStatus;
  readonly revision: Revision;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface AuthorizedWorkView extends WorkListSummary {
  readonly input?: JsonObject;
  readonly data?: JsonObject;
  readonly dataRevision?: Revision;
  readonly result?: JsonObject;
  readonly entities?: WorkEntityFacts;
  readonly scope?: readonly WorkResourceSelection[];
  readonly announce?: readonly WorkResourceSelection[];
  readonly attemptCount?: number;
  readonly maxAttempts?: number;
  readonly failure?: { readonly code: string; readonly summary: string;
    readonly occurredAt: string };
}
export interface WorkListFilter {
  readonly kinds?: readonly string[];      // <=64 unique registered kinds
  readonly statuses?: readonly WorkStatus[]; // omitted = all; [] = none
}
export interface WorkListRequest {
  readonly version: 1;
  readonly session?: ResourceLocator;
  readonly announceTo?: ResourceLocator;
  readonly filter?: WorkListFilter;
  readonly limit?: number;                 // default 50; 1..100
  readonly cursor?: string;                // opaque server-owned handle
  readonly subscriptionId?: string;        // active subscription owning this refresh
}
export interface WorkPage {
  readonly items: readonly WorkListSummary[];
  readonly nextCursor?: string;
}
export interface WorkSubscribeRequest {
  readonly version: 1;
  readonly resource: ResourceLocator;
  readonly filter?: WorkListFilter;
  readonly limit?: number;
}
export interface WorkSubscribeReply extends WorkPage {
  readonly version: 1;
  readonly subscriptionId: string;
  readonly streamEpoch: string;
}
```

The authorized detail serializer may include the listed optional fields only within its current read projection. A consumer can narrow that projection; it cannot add unapproved fields or disclose internal records. Default list and hints never contain these detail fields. A summary is not a valid lease response. There is deliberately no leaseToken, executionEpoch, submitted_data or recovery metadata member on AuthorizedWorkView.

A list request requires session or announceTo; the latter may infer the one canonical session. Omitted kinds means the current allowed registered kind set, not unknown kinds. An explicit empty kinds list returns no items. Unknown kinds/statuses reject before SQL. Cursors bind the complete normalized filter/limit, actor/connection generation, exact resource/session, authority basis and finite upper key. A subsequent list request must match that binding. Every refresh of an active subscription carries its returned `subscriptionId`, including the first cursorless page and manual continuations. The server checks the subscription owner and the exact view and releases its cursors on unsubscribe. Subscriptions apply the same optional filter as their initial snapshot and hints.

Return `{version:1, ...WorkPage}` for list. WorkPage.nextCursor is present even on a zero-visible-item page when the examined-row budget stopped the scan. It is absent only at the actual end of the finite sweep. Keep at most 1,024 server list cursor handles, expire them after 60 seconds of inactivity and invalidate them with their owning connection/subscription/authority generation. Claim continuations have a separate bounded 1,024-entry owner; neither exposes raw hidden row IDs/counts. An expired cursor is a sanitized stale request requiring restart, not an empty page.

A work client can choose active-status filters to keep a dashboard small; the SDK does not silently change an explicitly requested historical view. The P4 tracked-item/page/time limits make an overlarge automatic view explicitly incomplete. Manual history pagination remains possible within each server request's limits.

Unsubscribe params are `{version:1, subscriptionId}`, reply null. Reset params are `{version:1, subscriptionId, streamEpoch}` only; do not add a denied work/resource ID. Use the P4 WorkChangedParams shape for changed. A rich chat projection is an explicitly opted-in, separately guarded presentation field owned by the work view adapter; it is absent by default and obeys the same output budget.

## 4. Errors, uncertain outcomes and consumer formatting

Reuse `src/jsonrpc/helpers.ts`'s owned RpcError, the protocol's existing numeric code vocabulary and `agentWork.ts`'s sanitized mapping. Do not add arbitrary numeric error codes.

| Condition | Public behavior |
| --- | --- |
| Malformed request, unknown or unauthorized target | Existing generic InvalidParams / `Request rejected`; get uses the null projection above |
| Idempotency or data CAS conflict | Existing AhpErrorCodes.Conflict / `Conflict`; no winner payload |
| Stale attempt, expired cursor or exhausted retry | Existing generic InvalidRequest / `Request rejected` |
| Claim capacity or scan budget | Typed capacity/deferred claim result, not an authorization error or hidden queue count |
| Known database failure | Generic InternalError; diagnostic correlation only |
| Unknown COMMIT result | Owned RepositoryError `outcome_unknown`, mapped to InternalError with bounded `{version:1, kind:"outcome_unknown", correlationId}` data |

The unknown-outcome marker tells an authorized caller to reconcile, not blindly resubmit effects. Submit reconciles with the same idempotency key; get reconciles work state. Complete/fail may subsequently be stale because the first command committed. Never map an unconfirmed commit to a definite rollback or invent a successful result. Keep existing error-object identity checks; an arbitrary thrown object with a numeric code must not become trusted wire data.

Consumer failure formatting extends the existing work hooks:

```ts
interface ApprovedWorkFailure {
  readonly code: string;    // <=64, application-approved safe identifier
  readonly summary: string; // <=512, no secrets; generic fallback
}
interface WorkFailureFormattingContext {
  readonly workId: string;
  readonly kind: string;
  readonly attempt: number;
  readonly reported: WorkFailure;
  readonly signal: AbortSignal;
}
// WorkServiceHooks.formatFailure?(context):
//   ApprovedWorkFailure | Promise<ApprovedWorkFailure>
```

Apply existing callback count/deadline/settlement rules, run the formatter before SQL locking, and recapture its output. Missing/failed formatter uses code `execution_failed` and a generic summary. Raw worker code/message is untrusted advisory input and never automatically becomes a persisted diagnostic. Internal lease-expiry/lifecycle failures use server-defined codes. Default logs contain the approved stable code and correlation fields, not raw messages or payloads.

## 5. Contract acceptance additions

- Every new work method has exact positive/negative Zod fixtures, including unknown-field rejection and attempt required on lease mutations.
- Service results, wire serializers and client parsers agree on the single V1 shapes; no old `work:null` claim fallback remains.
- Undisclosable and nonexistent work have identical public get outcomes; no invalid request leaks data through an error.
- Bounded cursor expiry, actor/filter binding and zero-item continuation are covered by P4-14/P4-21; client capacity by P4-22.
- Work and resource CAS use consistent no-write conflict semantics while keeping their explicit service return styles.
- Unknown outcome uses an owned error; arbitrary thrown `{code,data}` objects still receive generic internal mapping.
- The approved-failure formatter cannot bypass lease/policy checks, run while holding SQL locks or expose unapproved worker text by default.
