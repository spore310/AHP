# Plan review 2 — transaction, lease and lifecycle correctness

**Reviewer:** same plan author, separate adversarial correctness-focused pass.
**Independence:** sequential self-review, not double-blind or independent review.
**Candidate:** R2 contract and packets after architecture amendments.
**Evidence:** source of work/session/pool implementations, relevant consumer
validation, primary database documentation, and plan failure/test requirements.
**Verdict:** PASS FOR PLAN, subject to explicit implementation and database gates.

## Adversarial findings addressed

| ID | Failure to prevent | Delivered control | Evidence needed on implementation |
| --- | --- | --- | --- |
| CR-01 | Generic sessions.ensure commits, then work.submit fails, leaving a split operation. | C05/P05 prohibit this decomposition. PostgreSQL work submit calls its private ensureSession with the same transaction client. | Client-affinity/rollback tests; authorized real transaction test. |
| CR-02 | Generic find/update claim lets competing workers receive the same assignment. | claim remains an adapter-owned atomic method; existing predicates and SKIP LOCKED SQL move together. | SQL parity now; separate-connection PostgreSQL contention test later. |
| CR-03 | A generic clock/retry wrapper changes expiry, attempts or stale-token acceptance. | C05 preserves DB-clock evaluation points and fencing; facades add no retries or lease arithmetic. | Wrong-agent/token/expiry/retry cases and clock parity. |
| CR-04 | dispose resolves early, drops resources under in-flight queries, or skips cleanup after a rejected operation. | C06 uses synchronous closing admission, tracked all-settled drain and one cached cleanup promise. It does not promise cancellation or a deadline. | Parked promise, concurrent disposal, rejection and cleanup-failure tests. |
| CR-05 | A cleaner API erases null/undefined/false distinctions or leaks ORM objects and raw errors. | C01/C08 preserve DTOs/sentinels and normalize unexpected failures; facade uses receiver-preserving method calls. | Per-method contract tests, canary secret errors and class-based fake. |
| CR-06 | Neutralizing JSONB vocabulary accidentally admits formerly rejected data or pretends the predicate validates all JSON. | C07 retains the exact text/depth policy, separates serialization/shape checks, and explicitly names it a text-tree check. | Escaped-key, Unicode and depth boundary regression cases. |
| CR-07 | A failed async loader/composition leaks a pool or disabled baseline eagerly imports pg. | C09/C10 validate before acquisition, use lazy selection and one ownership handoff, and clean partial construction. | Startup truth table, failure injection and fresh-import sentinel. |
| CR-08 | Generic idempotency compares JSON.stringify output and rejects reordered object keys. | Preserve PostgreSQL comparison now; define structural object/array semantics in conformance scenarios. | Reordered-object versus changed-array payload tests. |
| CR-09 | Fake-port success or skipped database tests is presented as transactional portability. | C12 and P11–P13 separate fake substitution, query-double evidence and real database acceptance. Real DB gate remains blocked without explicit approval. | Three-column evidence report; no pass-with-no-tests. |
| CR-10 | A contract refactor quietly changes incomplete session persistence or unrelated host cleanup semantics. | C08/C10/C11 preserve these boundaries, document current mapping/recovery limitations and forbid opportunistic repairs. | Final diff, unchanged migration hashes and explicit residual list. |

## Residual limitations, not concealed approvals

- Only one production backend exists in this target; fake substitution is not
  evidence that an arbitrary ORM/database satisfies the contract.
- The current source has no completed real-PostgreSQL execution proof in the
  inspected documentation. This plan neither grants DB access nor certifies SQL.
- The new generic persistence disposer can be single-flight without repairing
  every pre-existing host-stop race. The host-level limitation remains separate.
- Existing metadata projection and session-recovery limitations are not solved
  by moving repositories. Keep them visible in current-state documentation.
- Database leases fence result acceptance, not worker side effects. No claim of
  exactly-once execution is introduced.

## Final review requirement

P13 repeats both review lenses on the actual code candidate and test evidence.
These plan reviews cannot substitute for that implementation review. Record
reviewer independence honestly and invalidate affected evidence after repairs.
