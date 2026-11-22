# P16 verified handoff

The bounded proposal service owns exact IDs, revisions, provenance, capacity, and
expiry. The negotiated `manage` adapter derives the actor and scope from the live
connection. Approval and publication have independent canonical policy checks.
The trusted session operation uses an expected revision, updates the canonical
metadata through the SDK reducer, and fences existing views and pending dispatch.
Invocation and executor assignments remain separate operations.

| Criteria | Executed evidence |
| --- | --- |
| Q01, Q03, Q04 | `toolProposals.test.ts` · “publishes an exact proposal, activates the current instance, and requires separate executor authority.” Includes concurrent approval, unchanged pre-activation snapshots, native reducer parity, reentrant allocation, and URI replacement. |
| Q02, Q03 | `toolProposals.test.ts` · “bounds proposal input and permits explicit self-approval without publication authority.” |
| Q02 | `proposals.test.ts` · “rejects collisions, bounds pending proposals per actor and releases expired reservations.” |
| Q04 | `toolProposals.test.ts` · “retires a parked invocation when activation replaces the manifest even if its definition is already registered.” |
| Q04, F04 | `toolProposals.test.ts` · “loads and executes an approved artifact bound to a published proposal after exact activation.” |

Independent review identified two activation fences. The revised candidate
rechecks record ownership and authorization after sequence allocation and pins
the exact manifest revision across views, advertisements, and pending dispatch.
The reviewer verified both corrections. Commands and candidate identity are in
the [P19 handoff](P19-handoff.md).
