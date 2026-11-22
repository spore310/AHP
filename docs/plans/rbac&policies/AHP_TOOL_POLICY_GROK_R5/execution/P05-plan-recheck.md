# P05 narrow plan recheck

**Verdict: PASS — the amendment closes the three findings from `P05-plan-review.md`.** This is only a recheck of the specified resolutions against `P05-plan-amendment.md` and `P05-plan.md`; it is not a full plan rereview, implementation authorization, or P05 acceptance. No source/test files or runtime/DB commands were used. P04 remains unaccepted and P05 implementation remains blocked.

## Finding resolution

1. **Compiler coherence — closed.** `ReferenceAuthorizer.usesPolicyFactory(factory)` checks strict identity against the compiler captured by the genuine reference authorizer. Construction verifies it before admission installation or host/resource acquisition, without callbacks or registry/epoch mutation. The mismatch/equivalent-distinct-compiler positives and negatives, same-instance positive, post-construction option mutation and unchanged-currentness controls directly distinguish the failure mode. A custom application-supplied dishonest implementation remains within the explicitly trusted in-process adapter boundary; it is not a counterexample to the shipped registry's enforced identity check. This is explicitly a second, narrow P03 amendment alongside `removeBinding`, not a prose-only pairing assumption.
2. **Native cursor/readiness — closed.** The amendment gates network creation on successful same-connection `ready` initialization and currently valid, exactly true captured `allowGlobalSequence`. Pre-initialize, failed initialize, false/missing/stale permission, mismatched fence and wire claims have zero creation effects. It keeps protocol-metadata permission separate from the type/provider creation callback and bootstrap approval, and correctly leaves trusted in-process creation independent of native cursor permission.
3. **URI and byte bounds — closed.** Protected creation validates the candidate `ResourceRef` before reservation/callback, enforcing the existing effective 512-character resource ID limit; the specified at-limit/one-over controls catch inconsistent scope IDs. Both contextual factory and network creation use a 1 MiB default and absolute JSON-byte cap, with smaller configured limits allowed, removing the former 16 MiB widening. The separately scoped bootstrap-binding lifetime cap is explicitly a distinct grant-lifetime purpose, not a duplicate challenge or decision TTL.

No precise counterexample remains within the stated trusted-host boundary. The amendment's tests are implementation obligations, not results; none were run here.

## Gate

The amendment resolves this review's findings when read as the lead's binding decisions alongside `P05-plan.md`; implementation still needs the exact lead plan/write-set gate, both P03 amendments, and P04 acceptance. This PASS does not start P05 or authorize changes to the frozen/active P04 correction.
