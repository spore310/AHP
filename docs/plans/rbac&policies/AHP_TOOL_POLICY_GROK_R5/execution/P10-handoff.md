# P10 candidate handoff

Status: ACCEPTED for P10. Public tool execution remains later packet work.
Base: b7a059da12b23c57a6b9b379946e862a651aaa40. Lead sole writer;
independent p06_review is read-only. P10-plan.md records the approved plan and
evidence-backed ownership/contract amendments. No public tool execution claim.

## Implemented boundary

Explicit protectedViews shares creation's canonical registry/compiler, with
deliberate admitted resource-read policy refs. Discover/reveal, actual bindings,
provider selection, mandatory route constraints and no challenge govern native
resource content. Root provider catalogue is empty, and permitted sessions alone
contribute rows/counts. Global-sequence consent remains separate. Private canonical
proof basis/stamps are never included in a wire response; only value is sent.

One neutral views service and one kernel delivery adapter handle initial/repeated
snapshots, listing, catalogue events and queued native actions. Shared tool metadata
is empty. Existing canonical state, advertisements, reducer and real sequence remain
authoritative. Private advertise/assignment acknowledgement remains P11/P12 work.

Proofs are immutable, issued and recipient-bound. Aggregate freshness uses one
canonical clock sample, followed only by pure local fences. Final sends also check
subscription generation and sequence. Unsubscribe releases channel state and
invalidates late delivery/refresh. Root comparisons use incarnation sets, preserving
observed native additions while closing permission-only membership changes.

Bounds: 128 resource rows, policy refs, binding rows/positive attempts, cursors and
per-peer subscriptions; 64 service preparations; 256 queued/pending records and
2 MiB per peer; 2 MiB captured values; 5-second preparation caller deadline;
30-second opaque cursor TTL. Unsettled direct resolver work retains preparation
admission. Unsupported native transitions close the view. Already-sent data and
authored text are not universally redacted or recalled.

## Criterion evidence

| ID | Distinguishing tests |
| --- | --- |
| V01 | policyEgress: denied mixed initial batch with forged clientId, retry/repeated read; policyProjection: real grant, reveal/challenge/permission/mandatory denial, explicit read consent, provider and origin substitution. |
| V02 | policyEgress: raw initial/repeated snapshot and accepted advertisement frames omit schema canaries; malicious native action produces no raw echo. policyProjection: actual SDK metadata/serverTools/active-client reducer projections; no serverTools producer exists yet. |
| V03 | policyProjection: filtered counts/pages, hidden row canary, opaque cross-recipient/stale cursor; policyEgress: actual SDK root addition/count, row reordering, permission-only gain closure, empty stranger catalogue. |
| V04 | policyEgress: blocked initial revocation, final transport setup revocation, unsubscribe/newer-snapshot races, late allow/deny refresh, count/byte bounds. policyProjection: URI reuse, awaited revocation, source fences, retained timeout capacity. viewFreshness: aggregate expiry and reentrant mutation. |
| V05 | policyProjection: installed session/root reducers; policyEgress: actual SDK transport/repeated snapshot equality, real sequence, canonical addition/count continuity. Existing sdk.test remains internal baseline evidence. |
| V06 | policyProjection: independent recipient permission, immutable issued proof/copy rejection and unchanged canonical source; policyEgress: canonical full advertisement versus projected wire. |
| V07 | policyProjection and public SDK egress retain intentionally authored canary text under resource read permission. Structured descriptors remain private. |

## P00/D1 egress inventory disposition

| Inventoried surface | Candidate check |
| --- | --- |
| Handshake/authenticator/setup | Existing P04/P05 tests preserved; new stranger credential cannot become reader through clientId. |
| Raw connection send/replies | Existing final veto used; final setup revocation tests scan raw frames. |
| Public creation/ownership | Existing canonical creation approval preserved; public SDK root-add uses explicit creator bootstrap, no inferred owner grant. |
| Host/session in-process APIs | Remain trusted canonical kernels; exported createResourceViews is the policy-aware embedding boundary. |
| Initial/repeated subscriptions | Same service; mixed batch atomic; failed reply cannot commit pending subscription. |
| Root snapshot/provider/count/list | agents empty, filtered rows/counts before opaque cursor pagination; real SDK count event. |
| Catalogue added/summary/removed | Fresh per-recipient read decisions; hidden rows skipped; known removal closes view without fabricating authority or native sequence. |
| Application manifest | Shared _meta empty; canonical descriptor manifest untouched. |
| activeClients/serverTools | Snapshot/action projection matched with SDK; raw advertisement canary scan. Future server producer is P15. |
| Accepted actions/rejection echoes | Fresh final guard and projected allowed action whitelist; public mutations remain closed and echo no hidden request metadata. |
| Pending subscription buffers | Bounded intents retain incarnation/basis; fresh authority at flush; revocation and queue races tested. |
| Private invoke/results | P09 implementation and regressions retained; public legacy routes still closed. |
| Artifact locators/bytes | No route exists; stays closed pending P17. |
| Client helper/shared manifest | Transitional helper still cannot bypass public closed legacy tool routes; private assignment client migration remains P11/P12. |

## Evidence and resolved review

P10-aggregate-red.log records missing aggregate API failures; aggregate-green passes.
P10-wire-focused.log preserved initial test fixture failure (SDK subscribe returns
result.snapshot); corrected against installed SDK declaration. All original tests
and assertions remain. P10-first-validate.log passed 83 files / 1013 tests /
187 mappings before later source fixes, so it is not final-candidate evidence.
P10-final-focused.log passed 4 files / 31 tests before final layout/exact-boolean
cleanup. P10-final-validate.log passed 83 files / 1021 tests / 187 mappings for
review candidate 58527e3745f0807d7bd1d79315dacae5313b4abb839ef565abd2acf478586f91.
Independent review verified all 22 hashes and found two final lifecycle gaps:
failed replacement snapshots could lose an in-flight event, and late lists could
recreate a cursor after disposal. P10-final-review-red.log reproduces both failures.
Failed replacements now close the existing view after failure settlement, including
final reply veto. List publication rechecks request liveness/proof freshness before
allocating a cursor; disposed/timed-out continuations cannot recreate ownership.
P10-final-review-all-green.log passes 34 new packet tests, including both regressions,
final replacement veto and late timed-out list settlement. Refreshed full gate and
targeted independent final review followed these fixes.

Final candidate: P10-final-candidate.sha256, 22 paths, SHA256
fed5534ce9db21a91517c6850bbb6d455002920f010cf7b296290e51e0ee8ed6.
P10-reviewed-final-validate.log PASS: 83 files / 1025 tests / 187 mapped source
files, lint/typecheck/build and CHECK_EXIT:0. Lead reverified all 22 hashes.
Independent p06_review PASS: all hashes verified, RED regressions and final gate
inspected, no material findings or scoped documentation drift. Reviewer ran no
runtime checks; all execution evidence is lead-run under the DB-safe child wrapper.
P11 is eligible. Normal tested checkpoint push is already authorized by the user.
