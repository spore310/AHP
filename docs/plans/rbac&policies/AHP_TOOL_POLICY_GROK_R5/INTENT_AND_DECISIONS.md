# R5 intent, corrections and decisions

**Authority:** current user requirements supersede earlier sketches where noted.
R4.1 remains the source for unchanged design requirements. Code is current-state
truth; this bundle specifies target behavior. Later source changes must be assessed
before implementation, not silently treated as already conforming.

| Topic | Decision carried into R5 | Source |
| --- | --- | --- |
| Ownership and roles | One trusted subject/domain identity source; ownership and per-actor scoped roles are different facts. Never require every participant to equal the owner. | Latest note 1; source has owner Map versus host-wide application.role. |
| Host application control | Session types, creation admission, application bindings and resource providers supply policies and resolvers; SDK enforces composition. | Latest notes 2–3. |
| Shared coding agents | Runtime/harness definition may be shared. Effective grants are keyed to actual actor, initiating/delegating user, connection, scope and revisions—not model/harness name. | Latest additional example. |
| Reveal | Application/provider can impose reveal conditions. A reveal flag cannot add tools to the SDK assignment allowlist or override another mandatory restriction. | Latest note 4. |
| Resource specificity | Chat, terminal and workspace operations have independent policies and trusted relationships. Integrate existing sessions/tools now; use fake adapters for absent resources. | R4.1 §6; latest note 5. |
| Namespace | Optional named, generic readonly policy array with resolver and compositional includes. Direct policy grants remain supported. | Accepted earlier design and R4.1. |
| Roles | Generic application-defined strings; empty by default. User and agent rules independent. No built-in admin, PM or developer permission semantics. | Accepted earlier design. |
| Grant semantics | A complete valid scoped grant path can authorize; every applicable mandatory restriction still applies. No mixing partial grants into a stronger synthetic grant. | R4.1 §3.1. |
| Pipeline | SDK-controlled; optional supplementary auth hook; one canonical input; prepare uses input/context/cleanup registrar, not a separate validated parameter. | R4.1 §7. |
| Distribution | Approved-artifact contract/verification/transport seam only. No generic installer, automatic execution, attestation claim or mandated format. | R4.1 scope and accepted Phase 4. |
| Deliverable scope | Detailed implementation plan and test coverage only; no review protocol, reports or agent-review gate. | Latest user correction. |

## Challenge to the phrase “same auth subject”

The requirement is correct as **same trusted identity lineage**. It would be
incorrect as “all role checks must use the owner's subject” or “all clients must
have the owner's roles.” An invited PM has their own verified subject and scoped
bindings. Substituting the owner's subject would impersonate the owner; rejecting
every non-owner would defeat the requested multi-user SDK.

`SessionOwnerRegistry.owner(sessionUri)` remains the authenticated creator/owner
fact for that instance. Replace the static `SessionApplicationOptions.role` as a
security decision source with actor-and-scope resolution; don't copy the creator's
role into a shared application object. A detected mismatch in a claimed binding
versus its trusted actor denies—it is not repaired by borrowing the owner identity.

## Scenario that must remain representable

An organization provides one coding-agent harness to a senior engineer and a
junior engineer. The senior owns a particular project/session; the junior is a
contributor. Both use the same code/model, but separate trusted invocations or
agent bindings enforce different grants. Their triage chat may permit summary
and read tools while their terminal and production workspace impose stricter
input/write permissions. The SDK sends only each recipient's assigned, revealable
tool descriptors; it never sends the full internal policy implementation.

“Server access” (connect/register/enter a resource) is distinct from discover,
invoke, advertise, execute, publish and approve permissions. A shared executor can
serve multiple users only through separately authorized invocation contexts; it
cannot treat its own broad service credential as the caller's permission.

## Deliberate scope choices

Do not expand @persistence or cross-principal durable @work in this task. Preserve
its current narrower same-owner rule and explain it in docs. No real chat/terminal/
workspace implementations are promised. Extendable resource interfaces plus fake
adapters demonstrate the policy capability without provisioning runtimes.
