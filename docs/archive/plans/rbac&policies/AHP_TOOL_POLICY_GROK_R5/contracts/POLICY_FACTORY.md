# Policy factory, generic roles and reveal

**Target contract, R5.** Preserve @tools contracts; add separate policy/execution
bindings. Factories compile declarations, not permanent permission decisions.

## P1. Minimal surface and generics

```ts
// ./src/toolPolicy/types.ts — proposed
export interface ToolActorPolicy<TRole extends string = string> {
  readonly user?: { readonly anyOf: readonly TRole[] };
  readonly agent?: { readonly anyOf: readonly TRole[] };
}
export type ToolOperation =
  | 'discover' | 'propose' | 'approve' | 'advertise'
  | 'publish' | 'invoke' | 'execute';

export type ToolActorRule<TRole extends string = string> =
  | { readonly mode: 'roles'; readonly actors: ToolActorPolicy<TRole> }
  | {
      readonly mode: 'direct-grant';
      readonly actors: readonly ('user' | 'agent')[];
    };

export interface ToolOperationRule<TRole extends string = string> {
  readonly actor: ToolActorRule<TRole>;
  readonly requiredPermissions?: readonly string[];
  /** Discovery only. Missing is false; never creates a grant. */
  readonly reveal?: boolean;
}

export interface ToolExecutionPolicyBase {
  readonly id: string;
  readonly revision: number;
  readonly operations: Readonly<Partial<Record<ToolOperation, ToolOperationRule>>>;
  readonly challenge: { readonly required: boolean };
}

export interface ToolExecutionPolicy<
  TRole extends string = string,
  TExtension = Readonly<Record<string, unknown>>
> extends ToolExecutionPolicyBase {
  readonly operations: Readonly<Partial<Record<ToolOperation, ToolOperationRule<TRole>>>>;
  readonly extension?: Readonly<TExtension>;
}
```

The role type is generic; **runtime role sets default empty**, not a built-in union.
The extension is parsed by its registered domain validator/evaluator, not trusted
because TypeScript says object. Do not constrain the factory to a default
`Record<string, never>` extension that rejects legitimate consumer extensions.

Keep execution identity/provenance in a separately approved binding:

```ts
export type ToolExecutionBinding =
  | { readonly location: 'server'; readonly suppliedBy: 'server'; readonly implementation: 'host'; readonly implementationId: string }
  | { readonly location: 'client'; readonly suppliedBy: 'server' | 'client'; readonly implementation: 'client-owned'; readonly implementationId: string }
  | { readonly location: 'client'; readonly suppliedBy: 'server'; readonly implementation: 'approved-artifact'; readonly artifactRef: string };
```

`suppliedBy` is the contract origin in this model, not runtime attestation. An
approved publisher may supply an artifact on behalf of the server. Registry facts
—not arbitrary metadata—determine source and implementation. A remote machine
under host control is a server-controlled backend; another connected executor is
client execution. Do not invent a third ambiguous `remote` trust category.

Policy declarations may constrain allowed binding variants; they do not rewrite
the selected binding. Explicitly reject unsupported or conflicting combinations.

## P2. Optional compositional namespaces

```ts
// Proposed signatures; types/schemas are implemented in the contract packet.
export interface ToolPolicyNamespace<TPolicy extends ToolExecutionPolicyBase> {
  readonly name: string;
  readonly revision: number;
  readonly policies: readonly TPolicy[];
  readonly includes?: readonly NamespaceRef[];
  readonly resolve: (context: PolicyResolutionContext) =>
    readonly PolicyRef[] | Promise<readonly PolicyRef[]>;
}
export declare function defineToolPolicyNamespace<
  const TPolicies extends readonly ToolExecutionPolicyBase[]
>(input: {
  readonly name: string;
  readonly revision: number;
  readonly policies: TPolicies;
  readonly includes?: readonly NamespaceRef[];
  readonly resolve: ToolPolicyNamespace<TPolicies[number]>['resolve'];
}): ToolPolicyNamespace<TPolicies[number]>;
```

`PolicyResolutionContext` carries already verified actor/resource/session/tool
facts and canonical input; never raw framework request objects or arbitrary roles.
The namespace is a convenience. The factory also accepts direct policy definitions
without any namespace. Use exactly registered IDs/revisions. An ID such as
`workspace.review@pm` is opaque; never parse `pm` into a role or `workspace` into a
filesystem authorization boundary.

Validate definitions, operation keys, revisions, includes, extension data and
registered resolver outputs. Reject unknown/conflicting IDs, cycles, duplicate
conflicting revisions, excessive includes/expansion, reserved/prototype key tricks,
and resolver outputs outside the admitted set. Use Map or own-key guards. Include
finite configuration limits with explicit test coverage. Capture/freeze data;
keep functions in a private runtime registry, not a public serializable manifest.

Application/provider resolution selects admitted alternatives but cannot remove
mandatory constraints. Do not implement security inheritance as object spreads
or last-write-wins. Preserve exact definition versions at assignment; changing a
namespace does not silently upgrade existing assignments.

## P3. Session and provider manifest binding

`createToolPolicyFactory({ policies, namespaces })` compiles a per-host immutable
registry. The application registers explicit type-to-admission bindings. Its
`manifest.forSessionType(typeRef)` returns policy and namespace lists that the type
may admit, plus separately declared mandatory requirements. It is **not** a set of
permissions for all users. Unknown types fail; no implicit match by name prefix.

The consuming application passes this manifest through its session application
configuration; each `SessionProvider`/resource adapter supplies its registered
restrictions and applicability. Do not copy resolver functions into session state.
One shared engine evaluates both. An explicitly inapplicable provider scope is
allowed only by trusted registration; a required missing provider evaluator denies.

## P4. Reveal and the SDK allowlist

For descriptor delivery, require all of:

```text
exact canonical contract + admitted session/resource tool
+ current recipient invoke/discovery assignment
+ trusted resource relationship + applicable provider restrictions
+ allowed discovery decision with reveal=true
```

The implementation may make reveal conditional. Missing/false reveal hides the
descriptor. A true reveal flag cannot create membership, grant invocation or
bypass a mandatory deny. Unknown contracts are not sent even if a buggy evaluator
returns their name. Send bounded, validated descriptors and safe affordances—not
raw internal policies, evaluator code, role inventories, credentials or proofs.

Executor assignments are separate: an admitted executor may receive the minimum
contract and input needed for its authorized execution without broad discovery
rights. That purpose-specific delivery is explicitly authorized, not a loophole
that reveals all tools. An invoker does not automatically become an advertiser,
executor, contract approver or publisher.

Visibility and invocation remain distinct. A known hidden ID still needs current
invoke assignment. A policy may hide a tool from listing while allowing a specifically
assigned internal/headless invocation; it cannot let an unassigned client guess
its way into execution. Sensitive tools may be visible with a challenge-required
indicator; visibility does not satisfy that challenge.

## P5. Client proposals and publication

An authenticated proposal is a candidate, not a catalogue entry. Bound size/depth,
validate the current supported schema subset and permissions before compiling.
Require separate approval authority. Policy controls whether self-approval is
permitted; default is no inferred self-approval. Publish and approve are different
operations. Namespace/config authors are trusted host code; client requests are not.

On approval register an immutable exact contract revision and origin. Existing
sessions do not gain it automatically; an authorized assignment/manifest revision
is required. Advertising still requires exact normalized descriptors and executor
permission. Client-owned code remains untrusted beyond its admitted trust policy;
matching schema/hash is not proof of honest execution.

## P6. Minimal evaluation result and assignment contract

Use an SDK-owned decision type, not loose truthiness:

```ts
export type PolicyDecision =
  | { readonly effect: 'deny'; readonly code: string }
  | {
      readonly effect: 'allow';
      readonly reveal: boolean;
      readonly challengeRequired: boolean;
    };
```

A decision is valid only alongside the SDK-captured exact authority/instance
revision stamp. Unknown effect, missing mandatory fields, errors and timeout deny.
An evaluator's allow cannot manufacture a policy grant, add an unregistered tool,
change provenance or weaken compiled mandatory restrictions. Normalize errors
before returning anything to untrusted clients.

The server materializes private assignments containing exact tool revision,
implementation registration, purpose (`invoke` or `execute`), recipient,
resource/origin scope, view revision and conditions. Clients receive only safe
wire projections, not the private authority proof. Evaluate reveal for the delivery
purpose: discovery reveal does not authorize execute-payload delivery; an explicit
executor assignment and its own receive/execute decision are required. A mandatory
resource confidentiality denial blocks both.

Factory responsibilities are finite: validate/compile definitions, resolve explicit
references and selected alternatives, preserve mandatory constraints and provide
session/provider bindings. It is not a plugin loader, credential manager or database.

## P7. Bounded configuration is explicit, not an access default

P01 exposes finite configurable limits with runtime validation. Preserve current
contract definition/depth/manifest/payload and invocation limits where unchanged.
For new structures, the consuming app may supply bounded limits; safe library
fallbacks are limits only, never roles or grants. Suggested initial testable defaults:
namespace include depth 16; expanded policies per namespace 256; delegation depth 8;
pending challenges per actor 8 and per host 64; challenge lifetime 300 seconds;
retained completed calls per host 256 with a 16 MiB aggregate result budget and
60-second retention. Cap roles/grants/metadata strings and async hook deadlines too.
These are proposed configurable safety budgets, not universal performance claims.
Reject non-finite, negative and unbounded values. Test custom lower budgets as well
as defaults; expiration/eviction must never evict an in-use execution resource or
convert missing state to permission. Large applications may deliberately raise
validated limits without changing authorization semantics.
