# P05 bounded execution contract

**Plan gate PASS / P05 EXECUTION AUTHORIZED by lead.** P04 is accepted (`P04-handoff.md`, 85-file accepted hash `47b9e34efcb5b705de486ea05d9033c167850ad02fcad81698b56d3a25de4e08`). Sol w8:p4 is assigned as sole P05 writer. User already authorized the remaining dependency sequence; this is an internal technical gate, not another user-permission request.

## Binding plan and ownership

Use `P05-plan.md` with `P05-plan-amendment.md` as the authoritative amended design. Luna's initial `P05-plan-review.md` findings are closed by `P05-plan-recheck.md` PASS. `P05-lead-decisions.md` and `P05-preflight.md` explain prior choices; the amended exact plan wins where earlier proposals differ.

After the dependency gate, Sol w8:p4 is the sole P05 production/test/owning-README writer; lead owns amendments, integration, hashes and acceptance; Luna independently reviews the stable candidate. No parallel production edits or children. P06 may be preflighted read-only, but not implemented before P05 acceptance.

## Scope and approved amendments

Approve the exact bounded source/API write set in P05-plan section 7, with the amendment's narrowed defaults and native-readiness requirements. This includes session-owned creation/capability registration, immutable runtime capture, finite URI reservations/receipts/settle markers, contextual public create only, and canonical work owner projection. Work modifications are lookup interface/export/type narrowing and composition only; do not change owner equality, lease/presence enforcement, persistence/repositories or SQL.

Explicitly approve ONLY these P03 evaluator-local additions when execution begins:

1. `usesPolicyFactory(factory: ToolPolicyFactory): boolean`: strict identity against the captured compiler; no callback, mutation or epoch effect. Protected composition rejects mismatches before installing admissions or acquiring resources. Equivalent-looking separate compilers also reject.
2. `removeBinding({bindingId,scope,revision}): boolean`: validated conditional exact-full-scope/revision removal; stale/missing/mismatched requests no-op without epoch change. Matching removal deletes referring tool/executor assignments, advances existing epoch/revision once and preserves resource/owner/admission. No general issuance or lineage engine, no owner teardown/reinstall.

Allowed P03 source changes: `src/authorization/helpers/evaluate/types.ts`, `helpers.ts`, owning README; add the prescribed focused removal/coherence tests. All other accepted P01–P03 files remain unchanged unless a new exact amendment is approved. Record the superseding hashes; keep previous accepted manifests as historical evidence.

## Nonnegotiable behavior

- Creation is separately authorized by the exact registered type/provider application capability, never by invoke permission, role string, namespace, metadata flag or mere template presence.
- Bootstrap is materialized only from immutable registered templates for the actual creator and new full instance; no owner impersonation, arbitrary returned roles/policies, or invited-participant/P06 issuance.
- Network creation requires successful same-connection native ready state and current explicit `allowGlobalSequence`; this is only protocol permission. In-process contextual creation requires real current context and creation authorization, not a native cursor grant.
- Validate the accepted default ResourceRef schema (effective URI max512) and 1MiB default/absolute creation-intent budget before reservation/approval. Keep deadline/count/lifetime budgets as amended; no 16MiB path.
- Reserve synchronously before awaits; cancellation/stop cannot attach late results. Final currentness/reservation check and record/resource/owner/bootstrap attach have no intervening await. Roll back only the exact failed candidate before publication/backend startup.
- Failed backend retains inspectable record and canonical owner, but withdraws exact bootstrap before failure publication. No silent ownership erasure/reconstruction or false cleanup claim.
- Dispose/settle/late callback cleanup uses expected instance; no URI-wide successor deletion. Work sees only the current live canonical owner in its configured domain; lifecycle markers contain no alternative owner fact.
- P05 may open only authorized native create with `null` reply. Do not reopen raw snapshots/subscriptions/counts/tools, legacy invocation or private projections. P10/P12 remain mandatory.
- Preserve existing assertions and legitimate trusted-kernel lifecycle fixtures. New public tests must use genuine finite authority, not default allow callbacks or internal-kernel mocks. Any extra fixture/path migration stops for exact scope approval.

## Verification / completion

Start with focused RED/GREEN controls for the two P03 additions, then implement the ordered slices in P05-plan section 8. Map every S01–S05 requirement and all three plan-review findings to distinguishing positives/negatives, including mismatch/no-effect checks, partial install failure, malformed/replayed approvals, callback/config mutation, bounded cancellation and same-URI races. Do not claim coverage from an invalid positive fixture.

Run focused ESLint/typecheck/tests and final full DB-safe `pnpm validate` with established child DB/auth/provider exclusions. No live database/services, dependencies, deploy, commits, reset/stash, unrelated edits or account/model changes. After two failed repairs of one criterion, preserve the smallest reproducer and stop that loop for diagnosis.

Return `execution/P05-worker-handoff.md`, retained actual checks log, precise changed paths and S01–S05/control mapping. Verify predecessor hashes outside the explicitly approved coupling. Freeze source/tests/docs and actively notify w8:p2. Do not start P06; lead validates/reviews/accepts the exact candidate first.
