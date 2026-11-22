# P03 preflight — dependent on accepted P02

Worker `w8:p4` supplied read-only preflight against P01/current source; did not inspect evolving P02 files or implement anything. Plan gate: conditional PASS after integrating the accepted P02 factory API and the corrections below. No P03 execution yet.

## Minimal owner boundary

Per-host in-memory bindings/resources, narrow evaluator, and assignment projector. Do not extend legacy `visibleTools` as the new authority. GrantIssuer ceilings/lineage and delegation remain P06; trusted-host registry installation must be labeled as such, not advertised as authenticated grant issuance.

One `ScopedPolicyBinding` must supply a complete valid actor/scope/policy/role path. Never combine fragments from unrelated bindings. Direct mode is explicit and needs no synthetic role. Empty role branches deny. Mandatory host/session/provider/resource rules apply independently; namespace selection cannot omit them. Explicit trusted inapplicability can be a P03 registration flag; missing required evaluators deny. No new PolicyDecision effect is needed.

Assignments derive only from canonical registered/admitted contracts and the actual recipient's authority. Invoke and execute purposes are separate; invoke does not grant advertisement/publication. Reveal cannot add an unknown or unassigned descriptor. Use the existing canonical descriptor projector rather than arbitrary policy-returned metadata.

## Freshness correction

External authority is not merely advisory: required external decisions must have enforced finite validity/expiry and defined invalidation/revision semantics. Missing/expired authority denies. Async resolution precedes the final local admission check. That final check is synchronous with no intervening await, compares captured local epoch/revisions and trusted-clock expiry, and never calls an async FreshnessPort there.

Stamp comparisons include full actor, domain, delegation, auth revision, connection/generation, full resource route refs (domain/kind/id/instance), relationship/policy/grant revisions and selected executor identity/generation/revision. Matching only instance ID or role text is insufficient. No instantaneous distributed-revocation guarantee is claimed.

Helper-local registry/evaluation contracts may carry a finite validity deadline/local epoch without prematurely changing the shared P01 interfaces. Any necessary shared amendment must be requested before dependent edits.

## Acceptance counterexamples

- A01: empty/default authority denies; explicit direct grant works without namespace/role.
- A02: application allow/provider deny, missing evaluator, expiry, and same actor in distinct instances/scopes.
- A03: unrelated bindings cannot synthesize a permission; one complete positive path still needs all mandatory restrictions.
- A04: permissive reveal cannot add unknown/unassigned tools; false discovery reveal hides a descriptor without fabricating invoke permission.
- A05: invoke-only cannot advertise/publish; execute assignment is purpose-specific.
- A06: identical harness/model labels with different actors/domains/connections/scopes cannot share authority.

Tests belong in `src/tests/authorization/evaluate.test.ts` and `src/tests/toolPolicy/assignments.test.ts`, alongside precise await-barrier/freshness assertions needed to make these claims meaningful. Exact API integration remains pending accepted P02.
