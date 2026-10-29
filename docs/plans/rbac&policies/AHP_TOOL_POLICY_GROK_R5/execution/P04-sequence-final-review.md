# P04 sequence-correction final recheck

**Verdict: PASS — P1-1 is resolved in the frozen correction candidate.** This is the requested narrow recheck, not full P04 acceptance. Candidate identified by `execution/P04-sequence-candidate.sha256`: 85-entry combined manifest SHA-256 `47b9e34efcb5b705de486ea05d9033c167850ad02fcad81698b56d3a25de4e08`. I inspected the sequence permission types/capture/facade, the new public regressions, the authorized eighth public fixture, and the sequence handoff/checks log. No source/test edits or runtime/DB commands were made. The handoff reports worker `pnpm validate` passing at 70 files/591 tests/159 mapped sources; this review did not rerun it. Lead's independent final gate was still in progress per the assignment.

## P1-1 resolution

- `PreparedInitialScopes.allowGlobalSequence` is optional and defaults to false. The setup adapter reads it as `unknown`, accepts only an actual boolean when supplied, rejects malformed/Promise values, and stores a primitive `allowGlobalSequence` in the frozen `ConnectionSecuritySnapshot`. Subsequent mutation of the producer's seed cannot widen the captured false value. The existing synchronous currentness/expiry and connection-fence checks remain required at the facade boundary.
- Public initialize checks captured exact-true permission, matching connection ID/generation and current setup in `mayReadGlobalSequence` before invoking the kernel. The denied path therefore neither calls the canonical `getCurrentServerSeq()` getter nor fabricates/omits a cursor. Stale or expired setups fail before kernel entry; the server's existing final send/currentness fence remains in place.
- The regressions distinguish the defect from an empty-snapshot false positive: the no-config case performs real server-side session mutations first, and the public positive asserts the exact complete initialize result with the genuine, advancing canonical `serverSeq` and empty `snapshots`. Separate controls cover no setup, missing/false permission, invalid identity, wire spoofing, nonboolean/Promise values, post-capture producer mutation, revocation and expiry, with getter/release/effect assertions.
- The additional `agentWork.transport.test.ts` case is the authorized unmocked public fixture, not an internal-kernel migration. It supplies a real bridge/setup, verified fixture subject, empty scopes and explicit metadata permission; anonymous initialization is replaced by early denial and the following work operation stays uninitialized with no registration/work effect. The handoff reports remaining work/principal/effect assertions preserved.
- The safe initialize-positive choice is intentionally tightened: without the explicit capability there is no successful native initialize. This preserves the required current cursor semantics and does not make cursor permission a resource/tool grant. Protected native views, mutations, subscriptions and tools remain denied.

## Candidate and evidence limits

The supplied `P04-sequence-scope.json`/handoff record the 56/56 accepted P03 predecessor check, 29 correction-file hashes, the combined candidate identity, unchanged private kernel/allocator/transport paths and seven unchanged internal compatibility files. The eighth public transport fixture is separately authorized in the sequence resolution. I relied on that candidate-integrity evidence and the handoff's recorded worker gate; I did not independently recompute hashes or run validation. P04 remains subject to lead-owned final validation, integration and acceptance.

## Scoped README diff

No factual README drift found in the inspected `src/websocket/README.md` or `src/agents/README.md`. Both now accurately state that native initialize requires verified live setup with explicit `allowGlobalSequence: true`, default-denies absent/false/stale permission before the getter, returns the real global cursor only when allowed, and does not thereby permit resource/tool disclosure. The agent/work bridge and work authorization caveats remain consistent with the public fixture and source. No README update is indicated by this recheck.

## Gate

No remaining P1-1 blocker found in the frozen sequence-correction candidate. This PASS accepts only the narrow sequence correction; P04 acceptance remains lead-owned and P05 remains blocked pending the required P04 acceptance and separate plan/write-set gates.
