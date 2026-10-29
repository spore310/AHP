# P05 bounded correction authorization

**Execute these corrections only; P05 remains unaccepted.** Luna's `P05-final-review.md` identifies two material gaps and one scoped documentation omission. Lead accepts the findings and the indicated bounded correction directions. Sol must first hand off or explicitly pause its P06 plan, then remain the sole P05 correction writer. No P06 implementation.

## P1 — draining preparation capacity

URI reservations and underlying application callback work are different owned state. Preserve prompt rejection/cancellation and release the URI reservation, but retain a separate bounded occupied slot for every still-unsettled prepare invocation, including canceled/timed-out/disposed attempts. Count before starting/scheduling a callback and release only when that invocation actually settles (synchronous throw counts as settlement). Observe late fulfill/reject and release late prepared results exactly once.

`maxPendingCreates` bounds underlying outstanding preparation work as well as visible attempts; never reset/evict draining occupancy on cancel, timeout, factory disposal or bare-factory reuse. Stop/dispose must not wait indefinitely for an ignored signal. If draining work fills the cap, new attempts fail closed until it settles; cleanup does not manufacture capacity. Do not add an unbounded map/timer or a second callback queue.

Add a real max1 never-settling callback control: repeated canceled requests cannot start another callback. Cover timeout, request abort, global dispose/reuse and late rejection/fulfillment; after actual settlement a valid successor can start. Prove reservation release remains separate (same URI can be retried when legitimate work capacity exists), prompt stop remains bounded and no late authority attaches. Existing assertions may only be strengthened where they incorrectly equate cancellation with callback settlement; record exact changes.

## P2 — atomic admission installation

Approve this additional narrow P03-local method:

```ts
installAdmissions(inputs: readonly {
  readonly sessionType: { readonly key: string; readonly version: number };
  readonly providerId: string;
}[]): void;
```

Stage/validate/capture every exact canonical compiler admission first. Validate duplicate/conflict conditions and aggregate NEW-entry capacity against current canonical state before any mutation. Idempotent existing admissions consume no new slot. A failure leaves admissions, registry capacity, epoch/grant revision and issued-stamp currentness unchanged; do not compensate by removing pre-existing admissions. Apply the validated cohort synchronously with no intervening await/callback, then advance revision once only when something changed. Empty/all-identical batches are no-ops. Preserve single-install behavior by using the same internal staged implementation for `installAdmission`.

Add a separate captured P03 input-list limit `ReferenceInputLimits.maxAdmissionInstalls` with default128 / absolute1024, validated like the existing input limits before copy/iteration. It is a per-call list bound, distinct from total maxAdmissions capacity; duplicates count toward the input bound. This explicitly adds the evaluator constants file to the prior P03 helper/types/README scope. No P01 global limits/schemas or P02 compiler change.

Protected session construction must perform one atomic cohort installation rather than sequential mutation. Tests: real registry capacity1 with two valid types rejects and preserves a genuine old allow stamp; afterward installing either previously attempted type individually succeeds, proving no hidden occupied slot. Mixed existing/new over-capacity and invalid later selector also preserve old admissions/currentness; at-cap identical batches remain idempotent; fitting batch positive, duplicates and at-limit/one-over input controls. No introspection-only or already-invalid fixture.

## Documentation and exact write scope

- P1: `src/sessions/helpers/creation/helpers.ts`, necessary session-owned types/constants only if directly required; new P05 creation regressions.
- P2: `src/authorization/helpers/evaluate/{helpers,types,constants}.ts`, protected creation cohort caller, existing new P05 bindingRemoval/coherence tests and creation tests.
- Scoped READMEs: document draining capacity, batch installation and `ownerLookup` in `src/websocket/README.md`'s AHP binding options. These owning docs are already authorized by P05; no separate broad documentation rewrite.
- Exact additional TEST-only amendment approved after the first focused run: in `src/tests/authorization/admissionInputReview.test.ts`, add `maxAdmissionInstalls: 128` to the exact default-object assertion and add that key to the immediately following independent invalid-value/1024-boundary loop (around lines326–327). Preserve the four old keys, all their assertions and every other body. This extends coverage of the approved fifth limit; it does not loosen a denial or threshold.
- Preserve all other P03/P04 behavior, canonical kernel/sequence/transport/identity, work helper/lease/SQL, seven internal suites and eighth public transport suite. Extra source or fixture changes require exact approval first.

Reproduce intended REDs before implementation; retain logs and any failed iterations. Run focused checks and final full DB-safe `pnpm validate` on the frozen corrected candidate. Return `P05-correction-handoff.md` and retained checks log, exact scope/hashes and distinguishing controls. Actively notify w8:p2 and stop for Luna's narrow recheck/lead acceptance. Two failed repairs of a criterion require bounded diagnosis, not a broad speculative loop or weaker tests.
