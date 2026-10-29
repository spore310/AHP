# P03 bounded freshness correction slice

**Execute authorized only for this slice. Not P03 acceptance.** Two broad repair candidates failed review; do not repeat the full assignment. Lead verified the three concrete defects in the current source after `P03-correction-final-review.md`.

## Owner / boundaries

w8:p4 is sole production writer. Allowed source: `src/authorization/helpers/evaluate/helpers.ts`, only callback deadline capture, extension evaluator registration lifecycle, and final all-binding freshness. Allowed new test: `src/tests/authorization/freshnessReview.test.ts`. Owning authorization README may receive its source-map entry and correction of the already-reported schema-only/evaluator contradiction. No other production/type/test changes without asking; no P01/P02 changes, namespace/input-limit implementation, DB, installs, commits or P04.

## Three exact fixes

1. `runCallback` must use the already validated/captured local `hookDeadlineMs`, never `options.hookDeadlineMs`. Mutation of the original options cannot alter later or pending hook behavior.
2. `installPolicyExtensionEvaluator`: choose the accepted **immutable registration** policy. Same exact policy key + same callback is idempotent, including at capacity; different callback at that key throws before modifying registry/revisions. New entries check capacity and advance epoch so relevant pending/current evaluations cannot silently use changed evaluator registration. No override/replace API is introduced. A rejected conflicting replacement leaves the original registration authoritative; an original pending allow may still complete because no replacement occurred. Do not write a test demanding stale merely because a rejected mutation was attempted.
3. Before issuing allow, synchronously recheck **every** contributing binding, including mandatory ones, not just the positive binding, plus the existing proof checks. Missing/replaced/expired contributors deny. Use the captured all-binding set; no await between this check and allow return. Preserve a genuinely current positive control and expiry checks at later `matches` admission.

## Evidence-first sequence

- Add focused regressions and run them against the unchanged production file. Record actual RED output before fixes.
- Deadline test uses fake timers or controlled promises, restores timers and releases pending operations; no long real sleeps or dangling 60-second timers. Prove behavior with captured deadline versus mutated option.
- Extension tests cover same-callback idempotence at cap, conflicting registration rejection with the original retained, and pending decision behavior under the selected immutable policy.
- Mandatory-expiry test has a real pre-expiry allow control, then advances the supplied clock past a mandatory binding deadline inside a deferred callback and requires evaluation denial. Also retain positive-binding/proof expiry protections.
- Make only these narrow production fixes. Rerun the new suite, all authorization/toolPolicy tests, and typecheck. Do not remove or weaken existing assertions. This is an internal slice, so a full `pnpm validate` remains required after all P03 obligations are complete; do not report this slice as a completed candidate.
- After two failed attempts on one criterion, stop with the precise reproducer and evidence.

Use DB-safe child environment exclusions as recorded in prior regression logs. Write `execution/P03-freshness-slice-handoff.md` and `execution/P03-freshness-slice-checks.log` containing RED and GREEN results, actual exit codes and exact changed paths. Actively notify w8:p2, then stop for integration review. Another worker may prepare read-only namespace/input-limit diagnosis, but you must not implement that scope yet.
