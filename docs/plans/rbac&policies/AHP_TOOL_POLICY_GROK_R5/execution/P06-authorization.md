# P06 execution — current terminal owns delivery

User explicitly transferred end-to-end execution to this terminal and reaffirmed the feature plans' intent. Herdr reports only w8:p2 remains; the other panes no longer exist. Luna's terminal `P06-plan-recheck.md` is available: R2/R3/scope PASS, one remaining R1 wiring omission. External assignments are closed; no further pane delegation. This is not completion of the remaining packets.

## Final R1 decision / plan gate

Required neutral `GrantServiceOptions.sessions` is a structural capability with required `usesRegistry(registry): boolean` and `isReady(expectedSession): boolean`. Construction captures both bound methods and requires exact true registry identity BEFORE publishing service configuration or invoking target/approval callbacks. No optional/always-ready/deferred identity fallback.

Supported real-host wiring is two-phase, without new host options: create fail-closed BindingResolver/InitialAuthoritySource closures first; construct the host without starting it; obtain its actual hosted authorization capability; construct the grant service with that capability; bind the closures once; only then start the host. An unbound closure rejects, rebinding rejects, and a mismatched registry rejects before callbacks. The typed fixture and README must show this complete sequence, not just call the predicate in isolation. A bare factory may supply its own actual capability directly.

Lead self-recheck: PASS for this explicit wiring; prior independent R2/R3 checks remain applicable. No additional independent PASS is claimed for this last clarification. Required actual-host positive/mismatch/unbound tests must prove it.

## Authorized implementation

Proceed through the revised P06 plan in thin tested slices. Ratify its explicit limit table and20-path source/test scope, including precisely four adapter-forwarding/retargeting edits in policyCreation.test.ts, preserving every assertion. Add owning `src/websocket/README.md` to scope for the newly changed host/security composition contract (21 paths); current-state docs must follow implemented behavior. P01/P02/work/transport/kernel/package/DB changes remain excluded without concrete need and recorded amendment.

Begin with preknown installation tokens and exact cleanup/rollback regressions, then canonical lineage/scoped reader, bounded issuer/CAS, readiness/security composition, invalidation, integration and documentation. Use the accepted106-file P05 manifest as baseline; all106 hashes verified before first edit. Never describe a slice as the full P06 or P01–P19 outcome. Preserve intended REDs, existing gates, private canonical algorithms and owner/lease fences. Full DB-safe validation and security/documentation review remain required before packet acceptance.
