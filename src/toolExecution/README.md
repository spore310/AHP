# Tool execution contracts

R5 action and challenge contracts. The P01 contract boundary is accepted; later changes require an explicit amendment. Importing this module does not load a transport, database, or executor. There is no dispatcher, cleanup runner, or artifact verifier here.

Current behavior is the `ToolAction` type contract and presentation schemas. Optional `prepare` means `execute` receives `TPrepared | undefined`. Validation has one canonical input, not a separate validated argument. `executor` is an `ExecutorRevision`, not only an actor ref.

## Files

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | Action, challenge, and artifact contracts. `challengePresentationSchema` rejects non-HTTP redirects. |
| `index.ts` | Public exports. |

## Public names

Types: `Awaitable`, `ValidationResult`, `ToolPreparationHooks`, `ToolActionContext`, `ToolAction`, `ChallengePresentation`, `ChallengeContinuation`, `ChallengeProof`, `ChallengeVerification`, `ChallengeStatus`, `ChallengeAdapter`, `ArtifactDescriptor`.

Values: `ToolAction`, `challengePresentationSchema`, `createChallengePresentationSchema`.

`ToolActionContext` keeps caller, executor revision, origin, targets, contract revision, implementation binding, call id, `AbortSignal`, and an authority stamp separate. Redirect text is length-bounded and must be a syntactically valid `http` or `https` URL. That check is not approval.

## Omissions

No action pipeline, challenge store, output validator, or artifact transport. Client and server entrypoints are later packets. This module must stay free of server and framework imports.
