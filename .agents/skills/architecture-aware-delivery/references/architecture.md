# Architecture Checks

Use for nontrivial plans and boundary changes. Start with the task's module,
not the entire repository. Stop expanding once ownership, contracts, and likely
failure paths are understood well enough to plan safely.

## Evidence-first architecture brief

| Question | Evidence to collect | Why it changes the plan |
| --- | --- | --- |
| Where does intent enter? | Caller, route, command, transport, or lifecycle entrypoint. | Prevents fixing only an internal helper while the public path stays broken. |
| Who owns the behavior? | Public exports and the module implementing policy. | Prevents duplicating policy in clients or transport wrappers. |
| What contracts cross the boundary? | Inputs, outputs, errors, events, promises, versions. | Reveals downstream compatibility and timing obligations. |
| What state/resources are owned? | Mutation paths, registries, handles, timers, cancellation. | Identifies cleanup, aliasing, and concurrency risks. |
| Who observes the output? | Callers, subscribers, serializers, tests. | Reveals stale state, race windows, and false completion signals. |
| What establishes authority? | Validated identity, authorization checks, trusted configuration. | Keeps client intent separate from server facts. |
| What verifies behavior? | Existing tests, missing counterexamples, real SDK smoke path. | Prevents treating type compatibility as full interoperability. |

Reference actual files and symbols. `unknown` is better than a fabricated owner.
An old plan is evidence of intent, not proof of implementation.

## State and lifecycle work

Before an async fix, write the legal transitions, forbidden transitions, and
meaning of completion. For each acquired resource, name who releases it and
what happens if acquisition resolves after cancellation/disposal.

Check these interleavings where relevant:

1. Work begins, shutdown starts, acquisition completes late.
2. Shutdown is already pending, a new call tries to register work.
3. Two callers request the same operation; decide shared result vs rejection.
4. Failure occurs after partial acquisition; cleanup also fails.
5. A stale callback targets an identifier that now belongs to a new record.

For each, distinguish “operation requested,” “local cleanup complete,” and
“remote acknowledgement received.” A timeout that initiates forced cleanup does
not by itself prove every close callback has completed. State the actual guarantee.

Use controlled promises/events for race tests where practical. Avoid long sleeps
and cleanup that runs only on the passing path.

## Contract and protocol work

Check the installed dependency version, its exported types, and the corresponding
primary contract. Keep package version, protocol version, and application version
separate. A cast is not runtime validation. A supplied client ID is not authentication.

Verify producer -> wire boundary -> consumer behavior, not merely two helpers that
share the same assumptions. Label application-defined operations as custom; do not
invent standard methods or fields because their names look reasonable.

## Change-impact test

For every proposed modified contract, ask:

- Which known callers and tests must be reconsidered?
- Does the change alter ownership, failure behavior, ordering, or deployment?
- Can the existing abstraction be extended without introducing a second authority?
- What simple counterexample would show the planned solution is insufficient?

For elevated risk, compare at least the chosen option with the smallest viable
alternative. Record the tradeoff briefly; do not generate speculative architectures.

## Plan gate

`PASS` requires an identifiable owner, preserved user invariants, a feasible
implementation boundary, acceptance evidence, and no blocking unknowns.

`REVISE` means an actionable local deficiency: missing failure test, overlapping
ownership, untested caller, or an unnecessary new abstraction.

`BLOCKED` means a material permission/contract/policy question prevents the
relevant work. Return the exact decision and safe independent work, not a vague
“needs more context.” Ordinary technical choices within the contract remain the
implementer's responsibility.
