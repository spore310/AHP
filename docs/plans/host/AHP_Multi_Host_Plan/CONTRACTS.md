# Shared contracts and proof rules

These requirements apply to every packet. They derive from the accepted conversation and the observed code boundary; they do not claim the target already exists.

## 1. Extend existing ownership

| Need | Existing concept/owner to start from | Rule |
| --- | --- | --- |
| Composed host lifecycle | createAHPServer under websocket/helpers/host | Move composition to requested @host; retain one server factory and existing behavior. |
| Socket transport | @websocket | Keep framing, listeners and connection lifecycle here; compose through a non-circular public boundary. |
| Actor identity, policies, grants and freshness | @authorization; existing authentication adapters | Extend the existing trusted identity/policy machinery. Do not add a second authorization engine in @host. |
| Durable ownership and state | DurableStorage, DurableHost.epoch and @persistence | Extend scoped ownership and atomic repository operations; SQL stays in its adapter. |
| Canonical session/resource identity and recovery | @sessions and ResourceRef | Preserve incarnations, revisions and provider lifecycle; ownership transfer does not change resource identity. |
| Registration, presence and execution generation | @agents | Add distributed ownership to the meaningful existing directory/registration concepts. |
| Claims, capacity and work restrictions | @work and durable work repository | Preserve existing authorizers, immutable intent, requestKey and lease semantics. |
| Tool assignment and caller/executor separation | @tool and canonical authorization | Route existing capabilities; no copied local proof objects. |
| Client connection and extension traffic | @client | Keep one receive owner and shared lifetime. |
| Events and views | Existing publishers, protected views and reconciliation | Add durable delivery behind those boundaries rather than a competing event/client state stack. |

For every proposed public type, factory, field or module, record the existing alternative considered, the semantic gap and the minimum extension. No new generic manager, registry, scheduler service or wrapper that merely renames a library call.

postgresCoordination, internalHostTransport and distributedEventTransport are the three agreed capabilities. They are descriptive adapter names until the repository naming/API review establishes their exact public surface. They do not automatically require three new top-level feature modules.

## 2. Identities and namespaces

- Network `host` remains the bind address. The existing durable `hostId` has persistence meaning; audit and migrate that meaning before adding logical multi-host membership.
- A logical host name is stable and can resemble the consuming app, such as `support-app`. Multiple replicas use that same logical name and distinct runtime instance identities.
- Applications explicitly choose namespaces; the default may derive one from the app-style host name. An explicit namespace remains stable if another host joins or the display label changes.
- Namespace IDs are not current-owner encodings. Multiple authorized host IDs may share one ID, and advanced allocations may admit a host to more than one explicit namespace.
- Policy NamespaceRef remains a grouping of admitted policy definitions. Inclusion is not a grant. Keep security domain, host namespace, connection generation, session incarnation and execution epoch distinct.
- Start with one public native AHP connection bound to one configured namespace. Trusted application configuration resolves/authorizes that selection. A selector supplied by a caller is not proof of access.
- New readable slug names need deterministic validation and collision rejection. Do not perform lossy normalization on durable identity. Case/Unicode/escape equality and canonical storage must be explicit.
- If using URNs, the app slug belongs in the namespace-specific part under a fixed valid prefix. `urn:example:ahp:support-app:production` illustrates the shape only; it is not a production prefix. Reuse existing URI conventions where appropriate and preserve native `ahp-session:` identifiers.
- Namespace rename/deletion/recreation cannot silently reassign existing data or authorize stale memberships. Prefer immutable canonical identity; define explicit lifecycle behavior.

## 3. Three independent authority questions

1. **Authenticated host:** Does trusted configuration permit this credential to represent this logical host in this namespace?
2. **Authorized operation:** Do the host's infrastructure claims and the original user/agent's current application permissions permit this exact operation and resource route?
3. **Current ownership:** Is this instance/epoch the current owner or authorized route for this session/connection/lease?

All applicable checks must hold. A host secret grants no user role, a role grants no session ownership, and a namespace string grants neither. Do not send work lease tokens, secrets, local stamps or inferred roles as an implicit delegation mechanism.

## 4. Consistency and failure

- All security-sensitive durable mutations use current ownership and appropriate authority checks at their actual transaction admission boundary. Coordinator reads performed earlier are not sufficient.
- Define one lock order and precise expiry/currentness semantics. Use database time where durable lease correctness depends on it; a paused process cannot renew an expired predecessor identity.
- Existing local synchronous final fences remain meaningful locally. A distributed extension must add a coherent shared admission guarantee rather than substituting eventually delivered invalidation hints.
- Preserve the established revocation distinction: an already admitted mutation may commit; authorization is checked again before disclosing a response or projection. Describe the exact boundary and do not promise reversal of committed effects or sent bytes.
- If currentness cannot be established, affected admission fails closed. Readiness changes are an operational signal, not the primary fencing mechanism.
- Unknown COMMIT or response outcomes are uncertain, not automatically failed/rolled back. Reuse immutable-intent replay and authorized read/reconciliation; never blindly retry non-idempotent external effects.
- External providers must state idempotency, recovery and fencing capability. Database ownership cannot itself stop an arbitrary already-running external process.

## 5. Events, native protocol and privacy

- The durable event record and the corresponding mutation commit atomically. Notification failure does not erase a committed record.
- Delivery may be at least once; stable event IDs, exact incarnations and per-entity revisions support deduplication/reconciliation. Do not claim exactly-once external execution.
- All interested consumers need a defined recovery path. A relay work-queue ack is not automatically a per-host subscription ack.
- PostgreSQL notification channels carry minimal wakeups; not private payloads or authorization proofs.
- Native action sequence and snapshot cursors follow the pinned SDK. A unique allocated number alone proves neither commit order nor delivery order.
- Root lists/counts and views must include authorized remote sessions and filter before pagination. No hidden global activity cursor is disclosed without existing explicit consent.
- Bounded retention, slow consumers, gap/reset handling and periodic work reconciliation are part of the contract, not operational afterthoughts.

## 6. Lifecycle and default deployment

- Default single mode remains small and portable. Optional shared modes require explicitly compatible adapters and authentication.
- Healthy active-passive standby can expose liveness/startup while readiness denies public AHP admission. Active-active readiness means the process can safely serve or route under current membership.
- Loss of authority closes admission promptly; orderly drain becomes unready, stops new work, settles or fences admitted work, releases local handles and ownership, and honors bounded shutdown.
- Kubernetes Secrets/downward API/probes are deployment integrations. Do not add Kubernetes SDK/controller dependencies to core host logic.
- Pool counts, listeners, retries, queues, callbacks and retained results must be bounded across replicas; do not equate per-process bounds with a cluster-wide capacity guarantee.

## 7. Evidence requirements

Every acceptance record includes: criterion ID, exact branch/commit plus relevant working-tree identity, test/source path, command, working directory, runtime/database versions, exit/result, sanitized output/artifact pointer, observed assertion and remaining limitation.
Classify evidence as source inspection, recorded historical result, reproduced failure, executed focused check, full repository gate, or real integration proof. These categories are not interchangeable.
For a denial test, verify independently: denial outcome, zero forbidden durable/external effect, and zero unauthorized recipient disclosure. A denied reply alone does not prove a safe mutation boundary.
Use controlled promises, SQL locks and process/network barriers for races. Show why the test catches a plausible wrong implementation. Real multi-host proof uses independent processes; two pools in one host are not a substitute.
Required runtime gates use the pinned toolchain and a disposable local PostgreSQL setup. Prove the migrations actually applied. Do not skip a required database test and report the packet complete.
Proposed test paths in the packets are targets, not files claimed to exist today. Adapt them to actual conventions without weakening the named proof.

## 8. Plan and execution boundaries

The initial orchestrator run may inspect, run authorized local validation, create/update plan documents and selectively archive proven completed plan scope. It may not silently implement H0–H9.
During a separately authorized implementation run, complete one packet at a time, inspect its actual candidate, execute its proofs, record review dispositions and update its handoff before starting dependent work.
Keep review feedback scoped. Current-state READMEs describe shipped behavior; target packets describe accepted future behavior. Do not revise old historical results to match a new run.

