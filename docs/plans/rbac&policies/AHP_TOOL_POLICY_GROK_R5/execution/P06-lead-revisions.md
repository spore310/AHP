# P06 plan revisions required — no execution authorization

Luna's `P06-plan-review.md` REVISE is accepted. Preserve the one canonical store/private CAS architecture and separate assign/revoke control. Proposed limit table is ratified in principle as separate finite dimensions; do not change accepted P01/P03/P05 limits. Exact APIs/write set still need the revised plan/recheck before implementation.

## R1: supported composed-host capability

Add `src/websocket/helpers/host/helpers.ts` to the proposed scope. Forward BOTH required capabilities (`usesRegistry`, `isReady`) using captured original methods. Identity stays a pure strict-original-registry predicate. Hosted readiness must also fail closed on the composed host's terminal stopped state, not merely delegate to a bare factory that may later be reusable. Do not make required methods optional to compile. Tests in the new freshness suite must use the real composed host and cover ready exact instance plus creating/failed/settling/stopped/stale-instance negatives. No work/lease changes.

## R2: executable canonical connection-currentness contract

Use an SDK-issued scoped snapshot and add a synchronous canonical snapshot-currentness predicate (proposed name `isBindingSnapshotCurrent(snapshot): boolean`) on the SAME authorizer. Matching JSON/cross-registry snapshots are not valid receipts. Check exact captured canonical revision/resource installation/liveness, including expiry, without relying on event delivery. Snapshot checks are read/currentness capabilities, not assignment or mutation authority.

Specify the trusted `InitialAuthoritySource` composition explicitly: select permitted scopes from actual context, obtain each snapshot from canonical readBindings, seed grantRevision from that snapshot, and return `PreparedInitialScopes.isCurrent` that runs its captured identity/application guards FIRST and then synchronously checks every issued canonical snapshot. This can be application composition demonstrated by a concrete typed integration fixture and owning README example; do not import websocket/agent runtime types into neutral authorization or pretend BindingResolver.read by itself provides this connection fence. Empty-scope cursor-only initialization remains explicitly separate from scoped authority.

There must be no application clock callback AFTER that final canonical predicate. Current P04 `isCurrent = () => current() && now() < validUntil` runs a callback afterward. Add `src/websocket/helpers/security/helpers.ts` to the proposed scope for the narrowly ordered deadline/currentness check (sample deadlines before the final prepared-source currentness). Preserve all other P04 behavior and guards; if a larger change proves necessary, request it explicitly.

New-suite integration uses actual P05 bootstrap + real createConnectionSetupAdapter: canonical read succeeds, then canonical grant revision changes/revokes during/after setup; prepared currentness and protected native admission deny without an event. Include a reentrant clock invalidation control to distinguish correct final ordering. No public view/SDK/privacy certification or new wire method.

## R3: installation ownership must reach delayed cleanup

The revised plan must give exact token-bearing install/cleanup APIs, not just private incarnations in child envelopes. SDK-owned P05 bootstrap withdrawal AND resource teardown must carry the actual installation identity; same ID/scope/revision or identical full resource text after reinstall is a successor, never a cleanup match. Legacy privileged administrative remove/teardown may retain their existing nominal signatures, but distinguish them from expected-installation SDK cleanup.

Critical preservation case: P05 already proves rollback when a trusted fault-injection adapter installs a resource/binding and then throws. A receipt returned only AFTER that call is insufficient for this failure mode. Propose the smallest coherent ownership mechanism that is already known before a potentially failing installation (for example an SDK-issued single-use installation token passed through the install operation). Do not recover ownership by querying whatever matching nominal record happens to be present after failure, and do not delete a successor as compensation. Prevent consumed installation-token reuse; use bounded canonical state/weak provenance rather than ever-growing tombstones.

Retain the resource cleanup receipt after bootstrap withdrawal so later failed-record disposal can safely tear down only its own installation. Readiness must verify that the actual factory record still owns the canonical resource installation, not merely that equal ResourceRef text exists. Review getResource/owner projection coherence if the canonical resource has been reinstalled behind an old record; a stale record must not confer another installation's owner or readiness. No competing owner/lifecycle cache or work implementation change.

If existing P05 test adapters need to forward a newly added optional installation token, identify exact wrappers and minimal TEST-only edits in the revised proposal. Such forwarding can preserve the existing after-effect-fault assertions; do not drop those tests, bypass their instrumented mutation path, or redefine their failures as unsupported merely to obtain green. That extra path is not yet authorized.

## Clarifications

- Invalidation hints are explicitly best-effort/coalesced; subscribers cannot use them as sole freshness. A reentrant pending hint may wait for the next outer mutation or an explicit drain. No promise of automatic delivery for every change; no event-driven authorization.
- Synchronous rollback closes the caller's receipt promptly but cannot free a slot while cleanup is actually unsettled. Limits apply across all contexts/service handles; disposal never resets draining occupancy.
- Preserve higher-budget canonical compiler selector compatibility, explicit grantParent relationships, separate relationship/delegation depth, complete bounded cascade, and expiry enforcement without maintenance.

Sol should update ONLY the proposal after completing its active P07 read-only preflight. Return exact revised signatures/scope/controls for Luna's narrow plan recheck; lead will issue execution authorization only after all three findings are resolved.
