# P04 independent plan review

**Verdict: REVISE before implementation.** The plan's trusted setup design is largely bounded and fail-closed, but its key public/raw binding boundary and old-test migration remain unresolved. Sol should remain in plan phase; no implementation is authorized by this review. No code, test, README, or runtime/DB changes were made.

## Review scope and evidence

Read requirements before plan narrative: `packets/P04.md`, `contracts/AUTHORITY.md`, and `contracts/DELIVERY_WIRE.md`; then inspected `execution/P04-plan.md`, `CONTRACT_CARD.md`, current agent identity/directory types and helpers, security composition ports, websocket host/server/connection/AHP binding and tool invocation source, session creation attach path, websocket public exports, and the affected `ahp.test.ts`, `sdk.test.ts`, and `toolInvocation.test.ts` suites. Also checked the scoped `src/websocket/README.md` and `src/agents/README.md` for documentation drift. No tests or other commands were run.

## Architecture findings

### The proposed `createAHPKernel` split is the sound smallest migration direction, with one important public boundary condition

Current exports make the concern real: `src/websocket/index.ts` publicly exports `createAHPBinding` and its `createAHPConnectionModule` alias; that binding exposes raw initialize/subscribe/list/root snapshots and legacy tool invocation. Current `createAHPServer` also creates this binding with no policy configuration by default. The generic `createWebSocketServer` is separately public and injects handlers; its genericity is not itself an AHP authorization bypass, but it must not receive an exported raw AHP kernel through the supported public surface.

The lead's proposed structural migration is appropriate and is not mere relabeling **if** implemented as follows:

1. Move the existing canonical AHP behavior into a non-exported internal kernel module. It has no public `raw`, `trusted`, or legacy-mode option.
2. The supported public AHP binding/host path becomes fail-closed and cannot select or call the kernel's protected snapshot, subscription, dispatch, or tool routes without the new validated setup/currentness gate. No-security configuration cannot fall through to the kernel.
3. Remove the raw kernel from `src/websocket/index.ts` and all public aliases. If `createAHPBinding` remains public for compatibility, it must itself be the safe facade, not the raw kernel. Update the API docs/source map accordingly. Keep `createWebSocketServer` available for arbitrary application handlers; do not export the kernel to make it usable there.
4. Tests may import the private kernel module for compatibility assertions, but such tests prove only kernel/protocol behavior, never P04 public-host security or P12 interoperability.

With this boundary, existing raw anonymous product behavior is intentionally replaced, while parsing, canonical reducer/action semantics, reply settlement/order, snapshot/buffer rollback, broker correlation, exact completion ownership, and lifecycle algorithms can remain regression-tested against the internal kernel. The existing positive two-SDK shared-session/raw-schema expectations cannot remain public-host positives under the accepted no-config denial contract. Rehome those exact assertions to internal compatibility tests and add actual public API/network negatives and safe public positives; do not delete or weaken the assertions. Keep any independent work-extension security/lifecycle tests on the real public host where they do not depend on forbidden raw snapshots.

This does not overclaim product coverage: public no-config denial and safe setup initialization are real P04 host evidence; internal kernel tests preserve protocol mechanics only; P12 remains responsible for real authorized two-client SDK/reducer/view evidence. It would weaken coverage if the old expectations were simply deleted, marked skipped, or passed using an allow-all/trusted fixture. Rehousing them with unchanged assertions is justified because the formerly public anonymous disclosure/tool behavior is explicitly being removed.

### Required P04 plan amendment

Section 4 currently describes the desired output barrier, but it does not expressly resolve the public `createAHPBinding`/alias exposure or enumerate the migration of existing tests. Its write-set table says affected wire tests are “not pre-authorized,” and its final gate leaves the exact activation/dependency decision to the lead. That is insufficient for an executable, bounded plan and risks either public raw fallback or false-green compatibility changes.

Revise section 4 and the write-set/test table with the structural direction above. Explicitly list the files/tests moved to private-kernel compatibility and the assertions retained. Add concrete public-host tests for:

- no-security `createAHPServer`: minimal native initialize (empty snapshots), safe ping, and denial of root/initialSubscriptions, repeat subscribe, list/counts, session snapshots, create/dispatch, and legacy tool calls before protected getters, subscriptions, backend calls, or other effects;
- any remaining public `createAHPBinding` API is fail-closed and has no raw mode; no public barrel exports the kernel;
- configured security-only/no-DB setup resolves trusted actor plus bounded exact scopes/bindings and still does not expose descriptors or raw snapshots at P04;
- I01 parked authentication and parked authority with immediate initialSubscriptions: no protected bytes/effects before resolution, then safe initialize or bounded close/denial; minimal successful setup is a positive control;
- genuine work/authenticator compatibility where retained, without treating `clientId` as identity.

Keep the internal kernel's original protocol tests as a separate suite/namespace and document their evidence category. Do not make a private test harness a substitute for those public negatives.

## I01–I05 plan adequacy

The listed controls are materially stronger than superficial empty-output tests: deferred gates and sentinel side-effect counters, no persistence setup, spoofed label/no-presence cases, one-source conflicts, and timeout/disconnect/rebind fences are the right discriminators. The plan already calls for single overall deadlines, late-result cleanup, exact scope/actor binding reads, final synchronous check, and no shared P03 install/teardown. Retain those.

Before implementation, sharpen these exact test obligations:

- **I01:** prove immediate `initialSubscriptions` is bounded and rejected before snapshot lookup, pending subscription mutation, backend work, or egress; test both parked authentication and parked scoped-authority preparation. Test minimal initialize success only after current setup, returning no protected snapshot.
- **I02:** label the success “security setup without persistence,” not “protected tool setup”: P04 does not evaluate a P03 operation decision, issue assignments, or expose protected tools. Use real scoped `ResourceResolver`/`BindingResolver` evidence with an exact positive binding and assert no grant issuance/install; protected tool access remains denied pending later packets.
- **I03:** use independent trusted resolver controls for established user and registered agent. Spoof clientId/kind/role and absent/expired agent presence; none may downgrade an agent to user or synthesize admin.
- **I04:** assert one invocation of the selected authenticator, failure of conflicting sources before acquiring host resources/listeners, and the exact adapter bridge/domain when legacy work coexists.
- **I05:** verify close/timeout while each await is parked, late fulfillment/rejection after terminal cancellation, bounded stop even for an uncooperative callback, and an old cleanup's inability to release a newer transport/presence generation. Keep the final currentness check adjacent to attach with no await.

These are test precision amendments, not reasons to add P10 projections, P09 dispatch, or a new public security port.

## Remaining review gate

`REVISE` is limited to making the supported public binding boundary and test migration explicit before Sol's implementation. The exact architecture decision is: **approve a private non-exported canonical kernel consumed only through the fail-closed supported AHP facade/host, with preserved internal compatibility assertions and new actual public-host negatives/safe setup positives.** No public raw mode and no no-config legacy fallback. Lead owns approving that amendment and the write-set; P12 must still prove the later authorized client flow.

## Documentation Drift

No current factual drift was confirmed in the inspected `src/websocket/README.md` or `src/agents/README.md`: they describe the current opt-in authenticator and public AHP binding as implemented today. The P04 packet and contracts describe target behavior, not shipped behavior. If the plan is accepted and implementation removes the public raw binding or changes no-config host semantics, update the scoped websocket API/source-map docs in that implementation; do not prematurely rewrite current-state docs in this plan review.
