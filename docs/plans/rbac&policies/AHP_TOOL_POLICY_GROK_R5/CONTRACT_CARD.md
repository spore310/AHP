# R5 contract card — read with every assigned packet

**Base:** `agentIdentity@22fa7955b8e43839e041228f647f26e00762ebbe`.
**Status:** proposed target; implementation/tests not run here.

1. One trusted security context; owner identity is not every participant's identity.
   Derive current roles/grants for the actual user or agent and resource instance.
   Never use clientId, a caller-supplied role, UI appearance, or model name as proof.
2. Roles are generic strings, default `[]`. Empty/missing role branches deny.
   Explicit direct-policy grants are a separate admitted mode and need no invented
   role or namespace. Namespace declaration/inclusion is not a grant.
3. Separate policy definitions, admission ceiling, scoped assignments, mandatory
   restrictions and recipient projections. A complete valid grant path is required;
   all applicable restrictions apply; deny wins; challenges accumulate.
4. Session types and trusted creation scaffolding may explicitly bootstrap local
   owner bindings. Authorize creation first. Never default owner to global admin.
   Async checks precede attach; atomically commit instance/owner/bindings before
   publication; stale async completion cannot authorize a replacement URI instance.
5. Delegation requires explicit issuer authority, bounded subject/scope/roles/time,
   lineage and revocation. Using a tool is not the ability to grant it.
6. Same agent harness != same effective security identity. Separate caller,
   executor, originating/delegating user and connection generation; key caches
   using domain+actor+instance+resource+policy/grant revisions, not agent model.
7. Effective client descriptors = canonical registered/admitted tools ∩ actual
   recipient assignment ∩ permitted resource route ∩ current reveal approval.
   `reveal: true` is necessary only where declared, never sufficient alone.
   Invoke and executor assignments are independent; no client receives another's
   hidden schemas, auth proofs, private rules or outputs.
8. Protect initialize snapshots, subscribe/repeat subscribe, list/root counts,
   shared metadata, activeClients, actions/rejections, buffers and private calls.
   Canonical state remains server-owned. Projection/reducer consistency must be
   tested against the pinned SDK. No unsafe legacy fallback.
9. Check revision/instance/generation freshness after awaits and before local
   send/dispatch/commit. Revocation invalidates both grants and views. Already sent
   bytes/remote side effects cannot be recalled. External auth freshness has an
   explicit adapter contract; do not claim distributed instantaneous revocation.
10. Policies/resources/namespace names resolve through trusted registration.
    No URI-prefix ownership, role suffix magic, or skipping mandatory provider rules.
11. SDK pipeline: bounded input -> trusted current context/coarse access -> optional
    supplementary auth/custom validation -> canonical schema/resource check -> full
    policy -> challenge if needed -> prepare -> execute -> output validation ->
    cleanup -> authorized delivery/state projection. No separate validated argument
    in prepare. Input/resource mutation after authorization is not permitted.
12. Challenge returns bounded wait/redirect/display metadata and opaque continuation.
    No indefinite original-request wait. Trusted verify, exact request/executor/
    resource/revision binding, expiry and atomic single use. MFA != human consent.
13. @toolClient becomes a shim to @toolExecution client capability, never a bypass.
    @tools retains serializable contracts. Implementations/provenance/policy bindings
    live in separate trusted registrations. Caller and executor are both checked.
14. @authorization is a small policy kernel, not an IAM product. Keep identity,
    resource, challenge and transport providers injectable. No ORM/UI/OS dependency
    in the public policy contracts.
15. Keep database-agnostic persistence and current owner-only durable work intact.
    No DB queries/migrations, new packages, external coding agents, infrastructure or deployment.
16. One packet at a time. Exact read/write scope, tests, evidence and handoff.
    No partial security rollout is a multi-user release. No invented test evidence.

Detailed definitions: [authority](contracts/AUTHORITY.md),
[factory](contracts/POLICY_FACTORY.md), [execution](contracts/EXECUTION.md),
[delivery](contracts/DELIVERY_WIRE.md), [integration](contracts/INTEGRATION.md).
