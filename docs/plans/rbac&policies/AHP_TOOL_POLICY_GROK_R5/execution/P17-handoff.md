# P17 verified handoff

The optional artifact source uses trusted opaque references and a bounded
256 KiB byte response. The server verifies the exact approved source, recipient,
contract, registration, and digest. The host records delivery on the same
assignment view. The SDK client validates the descriptor and bytes before its
explicit loader and uses normal advertisement and invocation after loading.

| Criteria | Executed evidence |
| --- | --- |
| F01, F03 | `artifacts.test.ts` · “verifies the pinned digest, runtime and trusted verifier before handing exact bytes to the explicit loader.” |
| F01, F02 | `artifacts.test.ts` · “trusts registered metadata only and rejects an oversized or revoked source before delivery.” |
| F02, F03, F04 | `toolArtifacts.test.ts` · “delivers only to the assigned executor and uses the normal challenge and execution path.” Covers a denied raw advertisement before delivery, ordinary SDK registration, and verifier refusal. |
| F02 | `toolArtifacts.test.ts` · “rechecks the exact recipient after a parked read and drops bytes after revocation.” |
| F04 | `toolProposals.test.ts` · “loads and executes an approved artifact bound to a published proposal after exact activation.” |

The reference tests use inert bytes and known local handlers. The consumer
owns artifact format, publisher trust, and runtime isolation. The SDK proves
authorized delivery and its own local verification. A later load uses the
ordinary replacement semantics of a connection's advertisement. Independent
review passed. Commands and candidate identity are in the [P19 handoff](P19-handoff.md).
