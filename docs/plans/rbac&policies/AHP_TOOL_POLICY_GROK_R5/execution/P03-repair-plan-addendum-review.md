# P03 repair-plan addendum review — PASS

**Verdict:** PASS. No blocker in the six resolutions.
**Checked:** `execution/P03-repair-plan-addendum.md` against v2, `P03-repair-plan-v2-review.md`, AUTHORITY A3/A6/A9, and POLICY_FACTORY P4/P6.
**Not authorized:** implementation, README edits, or P04. Other v2 decisions stand.

The A3 correction is accepted. Each mandatory rule uses one exact complete binding. Alternative bindings are not ANDed. Denial of the chosen binding fails the decision with no fallback. Requiring an explicit selector when more than one binding matches does not contradict A3: one complete path is sufficient, but the contract does not require guessing which path.

| Boundary | Verdict |
| --- | --- |
| 1. Assignment tuple | PASS. Resource, route, recipient, `{id,key,version}`, operation, and `{bindingId,policyRef}` are one installed identity. Resource A does not authorize B. |
| 2. External proofs | PASS. Every required origin and target needs its own captured proof. The single `external` field covers only that evaluation scope, so the existing one-resource allow-then-expire test still has a real allow. A target requirement is not implied by an origin proof. |
| 3. Mandatory bindings | PASS. Singleton fixtures keep the unique-binding default. Ambiguity denies instead of first-allow. A selector chooses the path and cannot remove a registered obligation. |
| 4. Pre-await snapshot | PASS. The frozen selector is the decision input. The later `currentActor` check is the A6 fence, not a reason to reread the mutated request. The required tests separate capture from deny-all. |
| 5. Registry caps | PASS. The named caps are independent of `maxPolicyRefs`. Overflow latches required-external authority unavailable and does not evict an invalidation to re-allow an old proof. |
| 6. Descriptor provenance | PASS. Materialization verifies the issued frozen tuple and every stamp synchronously before any descriptor. Discovery output still needs discovery allow and `reveal=true`. Invoke alone does not disclose. That matches P4/P6; it is not a new requirement. The permission-deny fixture must still show the callback ran. |
