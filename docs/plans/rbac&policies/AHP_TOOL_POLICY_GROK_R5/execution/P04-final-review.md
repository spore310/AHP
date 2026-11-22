# P04 independent final review

**Verdict: REVISE. P04 is not accepted; do not advance to P05.** Review target is the frozen candidate recorded as `9a2c89413d4ba649dedbde6d4be5d1a53ca266bb0812a4018da0fe61e492f754`. This was a read-only review: no source/test edits and no runtime or database commands. The handoff reports the full DB-safe `pnpm validate` passed (70 files/579 tests/159 mapped sources); I did not rerun it.

## Finding

### P1-1 — Minimal public initialize still discloses the global server sequence

`src/websocket/helpers/ahp/helpers.ts:31-41` sends an empty-subscription initialize through the canonical kernel. That kernel returns `serverSeq: factory.getCurrentServerSeq()` at `src/websocket/helpers/ahp/helpers/kernel/helpers.ts:319`; the getter exposes the shared allocator's current value (`src/sessions/helpers/factory/helpers.ts:223`). Thus an unauthenticated/no-config public host, or a client whose configured identity resolves to no setup, can learn the cross-session global mutation sequence through the safe-minimal handshake. The value changes as other resources are mutated, providing an activity/count side channel across scopes.

This is not covered by the empty-`snapshots` assertion: the public tests do not assert that the sequence is non-disclosing or that the sequence getter is avoided. The plan's public boundary denies root/list/count views before protected getters, while `DELIVERY_WIRE.md` D1 explicitly disallows leaking forbidden resources through counts and D2 warns against exposing a replacement/global counter as `serverSeq`. Treating the canonical counter as harmless protocol metadata would need an explicit accepted contract decision and a test proving its privacy implications; the current implementation silently exposes it.

**Required resolution:** prevent the no-authority initialize path from reading/exposing the shared sequence, or obtain an explicit contract amendment that establishes why this global value is safe to disclose and adds a distinguishing test. Do not replace it with a fabricated sequence value that breaks SDK/reducer semantics. Add a public-host test with server-side mutations and a client lacking setup, verifying the accepted safe behavior and that no unauthorized global activity count is disclosed.

## Other reviewed areas

- The supported websocket barrel exports the safe binding/host and does not export the private kernel. The public facade has no raw-mode or missing-security fallback; protected native routes are denied before their kernel handlers. Generic application-supplied websocket handlers remain outside the AHP security guarantee, as authorized.
- Setup uses the selected identity source, validates actor/fence relationships, reads exact existing scope/binding facts, and does not issue/install grants. The bridge's private provenance and work-domain checks are present. Work remains subject/owner/presence checked, and P05 ownership/bootstrap work is not pulled into this review.
- The transport reserves its fence before setup, holds frames, applies one deadline, cancels late attachment, releases late preparations, checks currentness at attach and before egress, and retains the documented exact-instance/presence-generation behavior. No other reproducible regression in the requested owner/lease/principal or lifecycle scope was found by source review.
- The handoff separates internal-kernel compatibility tests from public-host authorization evidence and reports preservation of the migrated assertions. The reported test gate is evidence from the handoff, not an independently rerun result.

## Scoped README drift

No factual drift found in `src/websocket/README.md` or `src/agents/README.md` for the reviewed P04 behavior. Their descriptions accurately distinguish safe public setup from internal kernel compatibility and defer authorized protected views to later packets. The server-sequence disclosure is an implementation/contract gap, not a README correction to make ahead of resolving the behavior.

## Next action

Resolve P1-1 within P04's authorized boundary, freeze the candidate again, and request a narrow independent recheck. P04 remains unaccepted; P05 remains blocked.
