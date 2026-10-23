# Plan review 1 — architecture, scope and portability

**Reviewer:** plan author, separate architecture-focused self-review.
**Independence:** none claimed; no subagent was invoked.
**Candidate:** initial handoff draft, corrected into design R2.
**Evidence:** inspected pinned repository source, repository instructions,
consumer examples, and the drafted contract/packet graph. No application tests.
**Verdict after amendments:** PASS FOR PLAN; implementation remains unstarted.

## Findings and corrections

| ID | Finding / counterexample | Amendment in delivered plan | Verification still required |
| --- | --- | --- | --- |
| AR-01 | Moving pg files alone leaves concrete root re-exports, so importing RepositoryError can still evaluate the driver. | C03 separates the neutral root from explicit adapter entrypoints; P10 removes legacy exports; P11 checks the transitive graph. | Fresh-module pg sentinel and dependency test. |
| AR-02 | “Everything outside adapters is neutral” was ambiguous at the executable selection point. A vendor switch in src/index would violate intent. | C03/C09 put the allowlisted lazy selector and default provider inside helpers/adapters. Root composition passes opaque options only. | No concrete constructors, SQL or pool operations in entrypoint/domain modules. |
| AR-03 | Removing root exports at P08 would break src/index before P10 migrated it. | P08–P09 retain only existing temporary concrete root forwards to moved implementations; P10 deletes them with the caller change. Final import-isolation gate moves to P10/P11. | Typecheck each intermediate packet; no legacy forwards in final tree. |
| AR-04 | Generic wrappers could merely rename calls and add no ownership value. | C06 assigns one shared admission/drain/disposal scope and a safe error boundary; facades do not duplicate domain policy. | Lifecycle and receiver-preserving delegation tests. |
| AR-05 | JSONB-shaped predicates would keep storage assumptions in agents/work/wire even after SQL moved. | C07 defines a deliberate portable-text profile, neutral names and unchanged bounds. P09 targets every consumer and removes aliases. | Text/key/depth characterization and symbol scan. |
| AR-06 | Requiring a pool or transaction in the common provider would force every backend into a relational driver API. | C02 contains only the existing repository namespaces and dispose. No public query or transaction callback. | Public type fixture and non-pg fake substitution. |
| AR-07 | Interpreting “implementation in index.ts” literally would conflict with current repository file rules. | C03 keeps index as exports and locates runtime behavior in helpers. The user gets one public construction API without a monolithic index. | Module map and source review. |
| AR-08 | A full ORM, additional database or mass rename would exceed the requested refactor. | C04 and task non-goals prohibit speculative adapters/DSLs, preserve current helper filenames, and keep DDL unchanged. | Final diff and dependency review. |

An additional dependency check requires persistence internals to import the leaf
contract/error module rather than their own parent barrel. This avoids a circular
adapter -> root -> adapter graph during the temporary export transition. P10 also
explicitly owns root-export cleanup and the final import-boundary test.

## Architectural result

The target preserves existing repository contracts and application behavior while
making the concrete provider selectable. It is a domain repository facade, not
an abstraction over SQL syntax. The default remains PostgreSQL only as a deployment
selection inside the adapter boundary. An independently authored test provider
can exercise the same generic code without loading that driver.

## Remaining conditions

The local implementer must refresh the complete worktree/import inventory. The
remote branch read cannot establish staged/untracked code or a green local suite.
The plan must not be described as implemented, and the root remains intentionally
non-isolated only during the explicitly tracked P08–P09 migration window.
