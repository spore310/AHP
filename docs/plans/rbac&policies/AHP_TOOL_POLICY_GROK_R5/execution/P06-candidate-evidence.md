# P06 candidate evidence — acceptance pending

Candidate: cd659a919f90c977706aadd6846e313ae574bfb2 plus the current P06 scoped
changes. The checkpoint is verified on origin/agentIdentity. User explicitly
approved subsequent tested R5 checkpoint pushes in chat after automatic review
rejected the first attempt. No further push clarification is required.

Lead-run DB-safe `P06-codex-acceptance-candidate-validate.log` passes lint,
typecheck, **74 files / 854 tests**, **167 source mappings**, build, CHECK_EXIT:0.
The two P06 suites contain 170 tests. Counts are not acceptance criteria; the
behavioral mapping below identifies the distinguishing evidence. Runtime checks
were performed by the lead; independent review is a separate source/evidence step.

## Contract resolutions

- Preserve accepted P06-plan §6: `maxBindingsPerActor` counts all canonical
  bindings for the full actor across scopes. The older handoff's actor/scope
  description was inaccurate. Regression reproduced the old overly narrow count.
- Canonical token incarnation is an opaque `BindingInstallationToken`, as already
  implemented and described in the continuation handoff, not a serialized string.
  Weak per-registry provenance remains authoritative; JSON copying cannot mint it.
- `GrantService.isBindingSnapshotCurrent(snapshot, identityGuard)` samples time
  before identity/readiness and processes expiry before callback-free comparison.
- Assignment target and control approval callbacks now check bound currentness
  and canonical basis at their actual queued invocation boundary. Initial false,
  throwing and Promise-valued guards reproduced unwanted target callbacks. Caller
  identity is checked after target/approval guards, before final SDK readiness and
  canonical CAS. The target-guard invalidation regression first committed wrongly.
- No P01 portable signatures, work/lease equality, dependencies, transport wire
  formats or persistence implementation changed in this continuation.

## Required mapping

Unless noted, names refer to `src/tests/authorization/freshness.test.ts`.

| Criterion | Executed distinguishing tests |
| --- | --- |
| G01 | `genuine invocation and ownership do not supply a missing role gate or combine fragmented bindings`; `grant assignment does not imply a missing revoke branch`; root control/control-only positives; invalid initial caller and queued generation-loss zero-adapter controls |
| G02 | `rejects ... overreach before external callbacks with unchanged authority`; actual agent delegation; `grant lifetime cannot exceed the actual ancestor and known policies still obey the admission ceiling`; target kind/subject/domain/agent-id substitution; rule depth; mandatory provider deny/challenge; independent limit invalids, global binding storage, actor/global pending and captured fanout limits |
| G03 | Agent caller/executor tuple allow positives followed by ancestor deletion, false old views and no tuple resurrection after reinstall; private snapshot/CAS unrelated-expiry regressions; `delegation.test.ts` ancestor expiry, descendant relationship changes, saturated descendant-resource closure and higher-revision root reuse; bounded one-root maintenance cohorts |
| G04 | Revoke during awaited target and approval; reentrant final clock and later target guard; no-event real-host source/setup/native revocation; copied/double receipts; cancelled/timeout/disposed target and approval occupancy, late success/rejection and owned cleanup; malformed/cloned/mutating approval |
| G05 | Foreign registry snapshots/tokens, copied tokens, cross-handle receipt; agent identity/selected generation substitution and separate caller/executor tuples; same-full-ref canonical successors; registry mismatch before effects. Existing exact actor/context/stamp isolation suites rerun in full gate. |
| G06 | `a genuine junior tool grant does not authorize owner-only durable work`: real grant+invoke allow then junior WorkService denial with zero repository calls; genuine owner positive. Existing work/lease/presence and persistence fake-contract suites unchanged and rerun. |
| R1 | Actual creating/ready/settling/stopped capability; failed startup ownership without readiness; same genuine bare factory reused after terminal host stop; reentrant canonical owner replacement; unbound/rebound/mismatched composition |
| R2 | Real P05 catalogue/bootstrap/source/service/P04 setup/native initialize. Revocation during read/after read with unchanged external freshness. Armed trailing-clock RED, finite final/intermediate clocks, release/abort reentrancy; canonical expiry/negative snapshot. Existing P04 explicit cursor-only and actual reconnect tests remain unchanged. |
| R3 | Actual factory resource and binding install-then-throw; same-full-ref resource+binding successors; stale failed-record disposal; later bootstrap withdrawal; standalone preknown-token ownership/consumption/copy controls. Four original P05 adapter-forwarding edits remain the only changes to that existing test file. |

Additional coverage: atomic invalid-later/duplicate/over-cap/unknown-child
catalogue, captured rules/limits and caller-intent mutation; bounded getter-free
input; registered default/absolute limit configuration; explicit resource depth,
cycle/domain rejection; lossy/throwing/reentrant/async observer behavior and
retained listener occupancy (delegation suite).

## Preserved counterexamples and scope

Local ignored RED logs: P06-codex-expiry-red, P06-codex-clock-red,
P06-codex-deadline-red, P06-codex-cap-guard-red, P06-codex-initial-guard-red.
Each includes an actual failing assertion before correction. Fixture-only failures
remain preserved and are not presented as security defects. Commands use the
committed Invoke-DbSafeCheck.ps1 with the full handoff environment removal list.

Independent final review, exact final manifest reconciliation and explicit packet
acceptance remain pending. P06 tests establish authority composition, not successful
public tool execution or recipient-safe protected views. X05/X06/E05 and P07–P19
must still be implemented and evidenced on their owning/final candidates.
