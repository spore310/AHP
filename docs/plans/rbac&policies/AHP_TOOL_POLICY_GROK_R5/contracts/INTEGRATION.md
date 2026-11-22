# Source ownership and migration map

**Base:** `22fa7955b8e43839e041228f647f26e00762ebbe`. Refresh local dirty tree in P00.
These are targeted integration changes, not a repository-wide rewrite.

## Target capability boundaries

```text
src/
├── authorization/                  # shared small security kernel
│   ├── index.ts / types.ts / constants.ts / README.md
│   └── helpers/
│       ├── context/                # trusted identity/binding/freshness
│       ├── resources/              # instance and relationship resolution
│       ├── bindings/               # issuer bounds, scoped grants, revisions
│       └── evaluate/               # grant paths plus mandatory constraints
├── toolPolicy/
│   ├── index.ts / types.ts / constants.ts / README.md
│   └── helpers/
│       ├── namespace/              # generic definitions/includes
│       ├── factory/                # manifest compilation and validation
│       ├── assignments/            # invoke/executor assignment allowlists
│       └── admission/              # proposals, approval and exact binding
├── toolExecution/
│   ├── index.ts / types.ts / constants.ts / README.md
│   └── helpers/
│       ├── action/                 # ToolAction and canonical input
│       ├── dispatcher/             # mandatory lifecycle
│       ├── challenge/              # continuation/provider seam
│       ├── views/                  # private assignment projection
│       ├── client/                 # moved toolClient implementation
│       ├── server/                 # host executor adapter
│       └── artifacts/              # descriptor/verifier/transport seam only
└── toolClient/                     # compatibility exports, no alternate broker
```

Each helper capability uses index.ts/types.ts/helpers.ts as needed, not generic
utils or operation-named source files. Do not scaffold empty directories just to
match this drawing. Add aliases only when implemented and justified. Internal
leaf contracts must avoid parent barrel cycles; all tests remain src/tests/.

## Existing files to change and why

| Path / symbol | Required change | Must preserve |
| --- | --- | --- |
| agents/types.ts, directory.ts | Trusted actor/presence integration; compatibility exports if shared identity types move. | subject-bound registration; exact connection/generation fencing. |
| sessions/helpers/application/types.ts | Replace global role-as-authority with policy admission/binding references. | tool catalogue/type/config contracts; missing policy cannot enable tools. |
| sessions/helpers/application/define.ts, helpers.ts | Accept compiled admission/mandatory/bootstrap refs; do not clone callbacks into state. | typed config normalization and provider matching. |
| sessions/helpers/sessionTypes/types.ts/helpers.ts | Extend registration contract/binding references without embedding executable authorization in serializable definitions. | exact revision identity and catalogue validation. |
| sessions/types.ts | Resource instance identity, prepared creation context and policy-aware façade seams. | synchronous reducer/registry; provider backend lifecycle remains separate. |
| sessions/createSession/helpers.ts | Pre-authorized prepare/attach commit, owner/binding co-install and rollback before publication. | existing backend failure/readiness/disposal semantics. |
| sessions/helpers/application/admission.ts | Structural exact descriptor gate stays; host performs async actor/executor admission before commit. | atomic rejection and catalogue-normalized advertisements. |
| tools/types.ts/public exports | Keep callable schema contracts; export separate registration references where appropriate. | no execute functions or roles in contract definitions. |
| toolClient/index.ts, transport.ts, types.ts | Move actual client runtime to toolExecution helpers; consume assignments and injected transport. | stage/activate acknowledgement, exact correlation, sanitation. |
| websocket/helpers/host/types.ts/helpers.ts | Independent security composition; inject policy dispatcher; bridge legacy agentWork authenticator deliberately. | persistence disposal and existing work/owner restrictions. |
| websocket/helpers/server.ts, connection.ts | Protected initialization barrier and safe delivery/deferred semantics only where needed. | frame bounds, handshake containment, request ordering and close cleanup. |
| websocket/helpers/ahp/helpers.ts/types.ts | Policy-aware init/subscription/list/dispatch; recipient projection; nonleaking catalogue updates. | native protocol types and host-owned sequencing. |
| websocket/helpers/ahp/toolInvocation.ts | Delegate authority/lifecycle to shared dispatcher, retain correlation mapping in transport adapter. | bounded calls, private outputs, selected-connection completion. |
| application/helpers.ts, index.ts process composition | Explicit example policies/adapters; no built-in production roles in SDK. | inert imports and explicit application wiring. |
| tsconfig.json + Vite/Vitest aliases as found | Wire actual new public capabilities consistently. | pinned package/toolchain; no dependency upgrades. |
| relevant READMEs / docs/technical/wire-contract.md | Describe new API, compatibility boundary and actual limitations. | current-vs-target distinction; source mapping required. |

## Scaffolding roles through a session type

A session type registers policy refs, trusted provider binding, allowed tool ceiling
and optional creator bootstrap. Session creation passes intent; the SDK resolves
authority, checks bootstrap permission, and commits owner/local bindings on the
new instance. The application may supply more sensitive session variants, chat
or terminal type policies and domain resolvers without new SDK role enums.

Use a separate owner fact and scoped-binding authority under the same trusted
context. Existing SessionOwnerRegistry may remain a compatibility projection for
@work. Do not inject the current participant's roles into its owner map or replace
the owner's subject during guest authorization.

## Domain-specific resources

Expose a registration port for resource kind, current instance, parent/related
session edges, owner/provider authorities and operations. The SDK is not required
to know a filesystem path or PTY API. Tests register fake session/chat/terminal/
workspace resources; no real chat or terminal resource is claimed implemented.
A terminal linked to two sessions retains its independent owner/provider policy.

## Migration checkpoints

Before enabling the protected route, update its directly coupled clients/tests.
Don't rename toolClient first and leave a working bypass elsewhere. P07 relocates
without behavior claims; P09 adds real authorization; P10 proves projection; P11–P12
finish delivery and SDK-client migration. Until then sharing is not release-ready.

Record every public source API change. Old role inputs either fail explicit protected
configuration validation or remain deprecated only for inert legacy description;
they must not grant privileges alongside the new engine. Compatibility exports
preserve import convenience, not insecure behavior. Direct kernel calls remain
trusted-host operations, distinctly documented from the authorized SDK facade.
