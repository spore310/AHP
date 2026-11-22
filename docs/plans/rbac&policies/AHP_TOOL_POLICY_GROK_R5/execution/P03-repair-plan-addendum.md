# P03 focused repair-plan addendum

**Status: proposed targeted resolution; no implementation authorization.** This modifies only the six outstanding boundaries in `P03-repair-plan-v2-review.md`. All other v2 decisions stand. P01/P02 contracts remain unchanged; P04 remains blocked. Lead verified AUTHORITY A3/A6/A9, POLICY_FACTORY P4/P6, and current `ToolContractDefinition`/`ToolContractRef` before these decisions.

## 1. Exact assignment identity

A trusted installed tool assignment captures its full resource ref, registered permitted origin/target route, recipient actor, exact canonical contract identity `{id,key,version}`, operation, and exact `{bindingId,policyRef}` pair. Resource and route must exist and match the authoritative registration; binding actor/scope/policy membership must agree. The assignment references the resource's captured admission/revision, never a live caller-provided ceiling. An assignment for resource A cannot authorize the same contract on B.

Execute additionally captures the full executor fence and approved `ToolExecutionBinding`. Caller and executor identities remain distinct; the chosen recipient's binding is evaluated without substituting the caller context. Existing resource/grant/assignment revisions invalidate decisions on replacement or teardown. No silent contract replacement under an existing id.

## 2. All-resource external requirements

Evaluation gathers the deduplicated origin and every target from the registered route. Every required resource must have a captured trusted proof scoped to that full resource identity. Missing registration or required proof denies before allow.

Helper-local selectors may add `externalProofs: readonly {resource: ResourceRef; revision: string; validUntil: number}[]`. The existing single `external` field is only a compatibility shorthand for the evaluation scope's proof; it never covers a different target implicitly. Reject conflicting duplicate proofs. All proofs remain trusted in-process adapter outputs, not wire credentials. Validate finite deadlines and bound the collection with the route/resource budget. Snapshot every contributing proof before callbacks. The decision deadline is the minimum of every required proof, binding deadline and explicit decision TTL. Any contributing proof's invalidation invalidates the decision.

Tests: origin none/target required without proof denies; an origin proof cannot cover another target; two required targets use the earlier deadline; proof mutation cannot extend either one. Existing single-resource expiry tests retain a real allow before expiry.

## 3. Mandatory bindings: exact alternatives, not AND of all grants

Reviewer wording "any deny among those bindings denies" must not accidentally contradict AUTHORITY A3: alternative role variants are not all ANDed. Every mandatory **rule** must pass; unrelated alternative grants are not additional mandatory rules.

For each authoritative `(resource, mandatoryPolicyRef)` obligation, use one complete binding matching the evaluated recipient's full actor identity, that exact resource scope, and that policy ref. A helper-local `mandatoryBindings` selector may name `{resource,policyRef,bindingId}` for each obligation. It selects a path, never whether the rule applies. If omitted, use the unique matching installed binding; zero matches denies and multiple matches require an explicit selector rather than first-allow scanning. Duplicate/conflicting selectors deny. Unknown supplied obligations cannot remove or override registered ones.

Evaluate the chosen binding fully; expiry, missing evaluator, denial or error fails that mandatory obligation and the whole decision. Never retry a different binding after callback denial. Every authoritative obligation remains mandatory even when the request supplies an empty list. The singleton existing fixtures need no extra binding selector. Add tests for wrong actor/scope, ambiguous omission, explicit valid alternative, and denial on the explicitly chosen path without fallback.

## 4. Whole-input immutable snapshot

Before the first callback or await, validate and deep-capture actor context, operation, positive pair, resource, route, executor, all proofs and mandatory selectors. Use only that frozen snapshot through evaluation and stamp construction. Capture projection selection inputs and exact tuples before any item is awaited as well. Caller mutation must neither retarget a later item nor alter an earlier decision. Final checks compare captured facts to current registry state and the actual caller-supplied current context at the subsequent admission boundary; no self-comparison.

Add deferred-callback tests mutating actor, scope, route, policy pair and later projection items. Assertions must distinguish capture from simply denying all work.

## 5. Finite registry ownership

Use independent P03-local validated integer caps (defaults 128, absolute 1024), not `maxPolicyRefs`:

| Cap | Entries counted |
| --- | --- |
| maxResources | full resource registrations |
| maxBindings | installed binding ids |
| maxTools | canonical contract definitions |
| maxExecutors | exact executor-assignment records (no additional executor map required) |
| maxAdmissions | installed type/provider admission records |
| maxToolAssignments | exact tool-assignment records |
| maxPermissionEvaluators | registered own-key permission callbacks |
| maxExtensionEvaluators | exact-policy extension callback associations |
| maxExternalInvalidations | retained invalidated proof revisions |

Constructor callbacks count against their caps. Idempotent identical installs do not consume another slot; conflicting installs fail. Check capacity before committing an install. Bound all per-entry lists with applicable existing validated budgets; callback/deadline configuration is captured, not borrowed. Test at-limit and one-over, including custom lower caps independent of `maxPolicyRefs`.

External invalidation exhaustion must not silently preserve authority: if a new revision cannot be retained, synchronously advance the local epoch and latch external authority unavailable before reporting the capacity error. This bounded fail-closed state rejects required-external decisions until a new host registry is deliberately created. Never evict invalidations to re-allow old proofs.

## 6. Decision-to-descriptor correlation

Each admitted item carries its full installed assignment tuple from section 1, its exact contributing allow decisions, and corresponding stamps. Authorization returns deeply frozen, authorizer-issued records. `AdmissionView` adds a synchronous `validateAssignments(authorization, currentActor)` check that verifies record provenance, complete tuple equality with current installed assignments, and every contributing stamp. A private WeakSet of issued records/stamps is sufficient; do not introduce an unbounded retained decision map. Copied or fabricated admission records fail validation; unknown contract lookup never adds authority.

The toolPolicy materializer calls this check for the entire selected set before producing any descriptors, then obtains the exact canonical definitions and verifies `{id,key,version}` equality. No awaits or untrusted callbacks between this check and materialization. All relevant definitions are immutable. Discovery output still requires discovery allow plus reveal; execute delivery requires its own exact executor assignment. Invoke alone does not disclose. Use `toAhpToolDefinition`, not arbitrary injected builders.

Tests: substitute another registered contract, alter purpose/resource/binding, reuse another actor's authorization, and revoke the first item while awaiting a second. None may emit descriptors. A genuine unmodified authorization must still produce the expected canonical descriptor. Permission-deny projection tests must prove the callback ran rather than relying on invoke non-disclosure.

## Targeted gate

Independent recheck is restricted to these six concrete resolutions and their compatibility with v2 and accepted contracts. It is not another broad design rewrite. Identify any remaining blocking contradiction precisely. After a PASS, lead may authorize the existing single writer for the P03 repair scope; that does not accept implementation or authorize P04.
