# P03 Luna independent final review

**Verdict: CHANGES REQUIRED. P03 is not accepted; P04 remains blocked.** This is a read-only review of the specified stable takeover candidate. No source, test, README, or validation changes were made and no tests/DB operations were run.

## Candidate and evidence boundary

- Claimed candidate: `HEAD 22fa7955b8e43839e041228f647f26e00762ebbe` plus the 55-file uncommitted P03 snapshot named by `execution/P03-final-candidate.sha256`; supplied aggregate SHA-256: `8af025e1b010965b6c1f795ae12615a11752586247878048ccf7b94765c29f6a`.
- Scope manifest `P03-final-candidate-scope.json` reports 25 unchanged, five changed, none missing, and the approved import-only validation leaf amendment verified. I did not independently recalculate the snapshot digest or audit all 55 file contents; that hash/log audit belongs to the lead as requested.
- Read requirements first: `packets/P03.md`, contracts `AUTHORITY.md` and `POLICY_FACTORY.md`, accepted repair v2/addendum, correction authorization, and coverage completion. Then inspected evaluator/types, resources/bindings/context helpers, assignment materializer, both module READMEs, shared schema-import leaf, and representative owning/final/input/completion/assignment tests. Handoffs/logs are corroborating evidence, not proof of code correctness.
- Lead-reported DB-safe `pnpm validate` exit 0 and 67 files/530 tests was not rerun or independently verified. Review is based on source inspection and reported checks only.

## P1 — Resource reinstall can silently remove a linked admission ceiling

**Location:** `src/authorization/helpers/evaluate/helpers.ts`, `installResource` (resource construction around `admissionKey` and the subsequent `resources.set`).

**Expected:** An installed resource's policy ceiling is frozen by its linked admission. A linked resource must not become unlinked through an otherwise ordinary reinstall; an unlinked resource intentionally uses a different host registration. The accepted v2 contract makes requests selectors and authority host registration plus compiled admission, and the correction requires enforcing linked admission ceilings.

**Observed:** The installer derives `admissionKey` solely from the new optional `input.admission`. If an existing resource is reinstalled with the same full resource/owner/route but omits `admission`, the stored record omits its former `admissionKey`. This is accepted as an update and bumps the epoch. `evaluateSnapshot` enforces the policy ceiling only when `scopeResource?.admissionKey !== undefined`; the now-unlinked resource skips that check.

**Concrete source-inferred repro:** Register a factory admission that admits policy A only. Install the resource linked to it. Install a valid actor/scope binding for compiled policy B (which the factory can compile but does not admit). Evaluation of B is denied while linked. Reinstall the same resource with same owner/route/mandatory/external settings but no `admission`; the existing code replaces the record without its key. The same B evaluation can then pass its valid binding and direct-grant rule. This changes only the trusted registration call's optional field, not the policy binding; it drops the ceiling instead of preserving or explicitly rejecting it.

**Impact:** Loss of least-privilege admission at the reference-authorizer boundary; a stale/partial resource update can widen the set of selectable positive policies. This is distinct from permitted namespace-free direct-grant resources, because it starts with an explicitly linked, constrained resource.

**Correction direction:** Treat the resource's admission association as captured authority. On identical reinstall preserve the key; on omitted/different admission for an already-linked resource, reject atomically unless a separately authorized explicit update contract exists. Add a regression with a genuine compiled but out-of-ceiling binding: linked denial, failed/benign reinstall, continued denial and currentness behavior. Keep the direct no-admission positive control.

**Evidence level:** Source inspection; not runtime reproduced. The current `denies a positive policy outside the linked admission ceiling` test covers an intact link, not removal by reinstall.

## Acceptance/coverage assessment

The inspected tests provide meaningful positive controls rather than deny-all substitutes for the major assigned boundaries: namespace closure/direct grants, linked admission, proof expiry/invalidation, mandatory target callbacks and alternatives, immutable selector/projection capture under deferred work, exact execute recipient/fence/implementation delivery, descriptor provenance/canonical contracts, finite input limits, and registry idempotence/conflict/overflow. Sol's coverage mapping names the actual test cases; I did not treat the reported pass counts as proof beyond those assertions.

The finding above remains uncovered and blocks the P03 acceptance gate. In addition, the packet's broader A01–A06 suite remains part of acceptance; this review did not certify every test's contract trace solely from the handoff.

## Documentation Drift

No confirmed factual drift was found in the scoped `src/authorization/README.md` or `src/toolPolicy/README.md` based on the inspected implementation. Their descriptions accurately distinguish the in-memory host reference boundary from transport/shared-host acceptance and describe exact assignment/projection behavior. Accepted plans are target-state requirements, not stale current-state documentation. The scope is these two colocated module READMEs and the expressly supplied P03 contract/plan evidence; no repository-wide documentation scan was performed.

## Limits

This review does not require P04 transport wiring, P06 issuance, P10 privacy, or a shared-host release. Host installation remains trusted administration. It does not accept P03; acceptance remains with the lead after correction and review/validation of the exact updated candidate.
