# Tool policy

Tool admission and proposal publication use the application's canonical authorizer and policy factory. The binding entry point supplies the portable execution-location schema.

## Files

| File | Responsibility |
| --- | --- |
| `helpers/assignments/types.ts` | Admitted tool projection input. |
| `helpers/assignments/helpers.ts` | `projectAssignedDescriptors` calls `toAhpToolDefinition` only after `validateAssignments`. |
| `helpers/assignments/index.ts` | Assignment exports. |
| `helpers/admission/index.ts` | Proposal and publication service exports. |
| `helpers/admission/types.ts` | Trusted session scope, proposal transition, and approved provenance contracts. |
| `helpers/admission/helpers.ts` | Bounded proposal store and independently authorized approval, publication, and activation preparation. |
| `index.ts` | Tool admission and assignment projection exports. |
| `helpers/binding/helpers.ts` | Validates host, client-owned and approved-artifact bindings under the supplied identifier budget. |
| `helpers/binding/types.ts` | Execution binding type inferred from the schema. |
| `helpers/binding/index.ts` | Portable binding entry point. |

## Assignment descriptors

`createToolAdmission` uses the same canonical authorizer and policy factory as
protected session creation. Propose, approve, and publish use independent policy
operations. The host may explicitly allow an authorized proposer to approve their
own proposal. Pending proposals expire after five minutes with eight per principal
and 64 per host, within 128 total records. The service reserves immutable contract
identity and keeps the proposer, scope, and provenance server-owned.

The trusted review method reads a detached candidate under approval authority.
Publication makes the approved revision available to the host. Live session
activation additionally requires a separate policy in `activationPolicies` and
an expected manifest revision. Execute and invoke assignments are separate grants.

`projectAssignedDescriptors(view, authorization, currentCaller, purpose)` consumes an authorizer-issued assignment projection. Pass the original caller's current trusted context even for execute delivery: the executor has its own captured identity and registration fence. Replacing the caller context with the executor's context does not validate that authority.

The authorizer validates the entire projection synchronously before descriptor materialization. A copied/cross-host authorization, stale contributor, mismatched purpose, missing exact assignment, or mismatched canonical contract yields no descriptors. Discovery requires an allowed discovery assignment and `reveal=true`; an invoke assignment alone does not disclose. Execute delivery requires the exact installed executor assignment and approved implementation, without granting broad discovery.

The host checks the resulting projection again before sending it to the recipient.
