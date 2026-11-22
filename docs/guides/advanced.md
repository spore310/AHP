# Run a protected review application

```sh
pnpm exec vite-node examples/advanced/index.ts
```

The default run selects policies through an included namespace. To see the
same workflow with direct admission, run:

```sh
pnpm exec vite-node examples/advanced/index.ts -- --direct
```

The script binds to loopback, creates a typed review session, connects real SDK
clients over WebSocket, and stops the host when the assertions finish. The demo
uses fixed local identities, an inert artifact, and a process-local repository
adapter. The [PostgreSQL chapter](postgresql.md) covers an optional storage run.

## Who can do what

| Actor | What the demo authorizes |
| --- | --- |
| Senior owner | Owns the session, calls the client and host tools, and proposes, publishes, and activates an approved tool. |
| Junior agent | Has a delegated binding and a distinct executor assignment. Runs the inspection and loads the assigned artifact. |
| Project manager | Can read the session and approve a proposal. The example grants no invoke assignment. |
| Observer | Can read the protected session view. Private tool metadata stays out of that snapshot. |
| Owner's worker | Registers on a separate connection under the owner's verified principal and claims the owner's work. |

`clientId` labels a connection. The demo authenticator resolves the principal
from its loopback handshake, then the host classifies the actor and installs
scoped bindings and exact assignments. Namespace selection supplies a policy
ceiling. The registered binding and assignment supply the actual authority.

## Follow one review

1. **Subscribe to the protected session.** The observer gets a `ready` snapshot
   without the private tool manifest. The application separately grants SDK
   initialization access to the host-wide sequence cursor.
2. **Call the client executor.** The junior agent calls its own tool. The senior
   calls the same executor over a distinct connection. Each call stops at a
   challenge before execution. The fixture proof resumes the original call. It
   is local example data, not a real verification service.
3. **Try a denial.** With provider consent disabled, the senior's otherwise
   eligible call is denied. The PM's separate attempt has no invoke assignment.
   Both leave the handler count, canonical snapshot, and observer snapshot unchanged.
4. **Project a host result.** The server echo returns `Review ready`. A separate
   resource operation validates that result and updates the title through the
   native reducer. The client receives the tool result privately.
5. **Complete a work lease.** The owner submits a review item. Its registered
   worker claims, renews, and completes it. A different principal gets `work: null`
   when it asks for the same item. This same-owner rule is narrower than scoped
   tool access. [Work lifecycle](../architecture/agent-task-lifecycle.md)
6. **Publish and load a tool.** The senior proposes, the PM approves, and the
   senior publishes. The live manifest changes only after trusted activation.
   The junior then receives the exact assignment, verifies the artifact, and
   advertises the resulting local handler before executing it.

```mermaid
flowchart TB
    P["Senior proposes"] --> A["PM approves"]
    A --> U["Senior publishes"]
    U --> M["Host activates and assigns the revision"]
    M --> V["Junior verifies, advertises, and runs it"]
```

Each step has its own authority. An approved definition becomes usable only
after the host activates it and grants the exact assignment.

## Read the example code

| File | Why to read it |
| --- | --- |
| [index.ts](../../examples/advanced/index.ts) | Runs both forms of client invocation, the denial, the host action, and the proposal-to-artifact flow. |
| [host.ts](../../examples/advanced/host.ts) | Composes the registry, provider rules, SDK host, and public extension ports. |
| [work.ts](../../examples/advanced/work.ts) | Exercises registration and leases through versioned requests on real connections. |
| [persistence.ts](../../examples/advanced/persistence.ts) | Supplies local storage through the same repository ports used by the conformance tests. |

The artifact loader selects a known local handler for the verified fixture bytes.
Your application owns publisher trust, the artifact format, and runtime isolation.
The fixture adapter's work and registration data lasts for the run. For network
and storage integration details, see the [wire contract](../technical/wire-contract.md)
and the [persistence module](../../src/persistence/README.md).

## Adapt the composition

1. Supply your provider and typed session catalogue. Keep application config,
   provider config, and the pinned revision of each tool explicit. [Sessions](../../src/sessions/README.md)
2. Use a trusted authenticator, resolve the real user or agent, and scope each
   grant to the intended resource. Enable cursor consent and protected views for
   the SDK peers that need native subscriptions. [Authorization](../../src/authorization/README.md)
3. Supply exact caller and executor assignments for each tool. Use a host
   registration for trusted local code and an SDK advertisement for a client
   handler. The client API also exposes status, cancellation, and approved
   artifact loading. [SDK tool client](../../src/toolClient/README.md)
4. Add the work repositories only if your application needs durable
   coordination. Keep work payloads separate from session state and let each
   registered worker claim under a current lease. [Work service](../../src/work/README.md)

[Five-minute example](quickstart.md) · [Documentation index](../README.md)
