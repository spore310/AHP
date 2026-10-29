# P05 plan amendment — compiler coherence, native readiness and bounds

**Lead decisions for narrow plan recheck; no source implementation authorization.** Read with `P05-plan.md` and `P05-plan-review.md`. P04 must be accepted first. This resolves the three review findings without a new issuer, projection engine or trust-by-comment pairing.

## P05-1: exact captured compiler identity

Propose this additional P03-local capability alongside the already proposed conditional removal:

```ts
usesPolicyFactory(factory: ToolPolicyFactory): boolean;
```

The genuine reference authorizer implements it as strict object identity against its **captured** compiler (`factory === policyRegistry`), not against mutable constructor options, structural rules, matching IDs or caller-provided metadata. It invokes no callbacks, returns no mutable state, and makes no registry/epoch mutation. P02's immutable compiled factory remains the actual source; this method does not expose another compiler or administration hook.

Protected session/host construction checks this BEFORE installing admissions, allocating/attaching sessions or acquiring host resources. A different factory, including an equivalent-looking separately created compiler, fails closed. Only then validate exact registered type rules/template/namespace closure with that same factory and call installAdmission. Application-supplied replacement registry ports remain trusted in-process implementations obligated to honor the interface; TypeScript cannot sandbox arbitrary dishonest application code. The shipped registry enforces the check, rather than merely documenting that two independently supplied objects should match.

Tests must cover broader actual registry compiler vs narrower supplied compiler/type; equal identifiers with different policy semantics; separately constructed equivalent compiler rejection; exact same compiler positive; options mutation after authorizer construction; and a mismatch probe leaving existing decision currentness/capacity untouched. This adds only the method to P03 evaluator types/helper plus owning docs/tests, with an explicit superseding hash record after acceptance. No P01/P02 changes. Combined P03 amendment scope is this identity predicate plus the conditional removeBinding already precisely specified in the plan.

## P05-2: native handshake and creation are separate permissions

The network route requires the existing same-connection canonical `ready` phase resulting from a successfully enqueued initialize reply, before any creation callback/reservation. Preserve the facade/kernel beforeDispatch order; do not shortcut it while adding createSession handling. Require the P04 captured global-sequence permission to remain exactly true and its connection setup current. Denied/unattempted initialize, failed initialize reply, false/missing/stale permission, mismatched connection/generation and JSON claims all cause zero creation effects.

That permission enables native protocol metadata only. The exact type/provider creation callback and entire declared bootstrap approval still separately decide creation. Add controls for pre-initialize create despite a live setup, false metadata permission, failed reply, true metadata permission plus creation denial, and initialized/current metadata permission plus explicit creation approval returning only null. In-process trusted contextual creation has no protocol-initialize or global-cursor requirement; it still enforces its actual context, creation policy and instance/currentness rules.

## P05-3: one effective resource-ID bound and aligned input ceilings

Protected creation validates the candidate full ResourceRef with the SAME accepted default `resourceRefSchema` before reservation or application callbacks. Its effective URI/ResourceRef.id length is therefore **512**, from `POLICY_LIMIT_DEFAULTS.maxResourceIdLength`, not the wider 2048 work limit or 4096 absolute customization ceiling. Do not relax the existing shared schema to accommodate long URIs. At-limit/one-over tests must prove that the 512 case creates a usable binding scope and 513 creates no reservation/callback/record/owner/event. Legacy trusted-kernel URI behavior can remain separate.

Set P05 creation input byte limit default and absolute cap to **1 MiB**, for both contextual factory and network routes; allow validated smaller configured limits. Drop the proposed 16 MiB ceiling. Transport's envelope budget may reject a message even earlier, but the contextual API cannot accept a larger creation intent budget. Validate the UTF-8 JSON input budget before deep copying/parsing/authority callbacks. This is a creation-intent budget, not P01's extension metadata budget or a registry-cap alias. Keep the session capability independent of websocket implementation imports; a test may compare the cap with the current transport ceiling and exercise both boundaries.

Keep the separately purposed finite pending/settle/bootstrap entry budgets and existing deadline/horizon reuse. Approve proposed bootstrap lifetime default host cap 1 hour / absolute 24 hours, with an explicit positive finite per-template maximum no greater than the host cap; this is not challenge TTL or a decision-cache lifetime. Both approval and connection validity still cap the moment of attachment, while the granted binding has its independently authorized expiry and later P06 revocation semantics.

## Gate

Luna should recheck only these resolutions against its three findings, not redesign the whole feature. Once P04 is accepted and this plan/amendment gate passes, lead can issue an exact P05 execution authorization covering both narrow P03 methods and the bounded plan write set. Until then, Sol writes only the active P04 correction; P05 source/tests remain untouched.
