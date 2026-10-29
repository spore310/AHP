# P06 revised plan recheck

**Verdict: REVISE.** This is a read-only plan review, not implementation authorization. No tests, runtime, or database commands were run.

## Blocker — R1 capability is exposed but not wired to the grant-service consumers

The revisions address the original host-forwarding issue: §2.3 requires `usesRegistry` and `isReady`, preserves strict identity, forwards both through the composed host, fences readiness on terminal stop, and plans a real-host test that reuses the same bare factory. The owner projection now also specifies the stable-reference second getter check.

However, the plan still does not define the consumer contract that makes those capabilities enforce registry coherence and readiness in P06:

- §2.1 declares `createGrantService(options: GrantServiceOptions)` but does not define `GrantServiceOptions` or identify its required session-readiness/registry-identity input.
- §2.1 says the `BindingResolver` must check exact-root readiness, and §2.2/§3 require the final assignment check to call captured SDK `isReady`; neither specifies where those methods are captured or supplied to the service.
- The concrete §2.4 `InitialAuthoritySource` closure uses `hostedIsReady`, but does not call `usesRegistry` before `selectPermittedScopes`/`canonicalRead`. The §2.3 prose requires mismatch rejection before resolvers/effects, but the example and named R1 test do not demonstrate that end-to-end rejection (the test only calls the wrong-registry predicate).
- `createAHPServer` constructs its session factory internally (`src/websocket/helpers/host/helpers.ts`); the current host options do not provide the already-created factory capability to a grant service constructed for `security.composition`. The plan needs to specify the supported wiring, such as a required, fail-closed structural capability/deferred closure that is bound to the actual hosted authorization before `start()`, and prove strict original-registry mismatch is rejected before resolver/approval callbacks. Do not add an always-ready fallback or make the methods optional.

This can be addressed within the proposed grants types/helpers and existing freshness test path; no additional path is necessarily required. Until the service option and concrete host-to-service wiring are explicit, the required final readiness and same-registry fences are not implementable from the plan as written.

## Rechecked items

- **R2: Pass.** The revised plan specifies SDK-issued scoped snapshots and canonical currentness independent of event delivery. The typed `InitialAuthoritySource` retains the snapshots across setup, separates cursor-only permission, and places application/readiness callbacks before canonical checks. The narrow P04 change samples/rechecks deadlines before the prepared-source predicate and makes that predicate the final callback, preserving the existing wire and other guards.
- **R3: Pass.** Preknown SDK-issued, single-use resource/binding tokens are passed through captured install ports; claimed failures are consumed; delayed cleanup is token-conditional and distinct from nominal administrative removal. The plan covers resource-receipt retention after bootstrap withdrawal, after-effect throws, ABA/same-full-ref successor preservation, and stale `getResource`/owner/readiness projections. No cleanup ownership gap was found in the described attach, rollback, withdrawal, or teardown paths.
- **Scope: Pass, conditional on the R1 correction.** The 20-path list is the prior 17 plus `src/websocket/helpers/host/helpers.ts`, `src/websocket/helpers/security/helpers.ts`, and exactly `src/tests/sessions/policyCreation.test.ts`. The existing test file has the four identified adapter sites (binding-install forwarder, resource-install forwarder, withdrawal-fault retarget, and teardown spy retarget); the requested edits preserve the existing assertions and keep the instrumented methods on the exercised path. Optional token parameters leave nominal administrative calls available. No extra source/test consumer or path is apparent from this recheck.

No implementation authorization is implied. Lead review and an explicit execution gate remain required.
