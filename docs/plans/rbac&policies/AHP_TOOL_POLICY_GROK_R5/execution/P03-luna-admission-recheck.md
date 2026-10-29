# P03 Luna admission-association recheck

**Verdict: PASS for the narrow prior P1 finding. P03 acceptance remains with the lead; P04 remains blocked.**

## Candidate and evidence

Reviewed the supplied `P03-admission-link-candidate.sha256` snapshot (56 files; supplied aggregate SHA-256 `fa567a9c5558f0c3250d4460ab35846bb7a9e4f6bd818fbf520176cf27c98497`). I did not independently recalculate its digest. Inspected the actual `installResource` guard, all of `src/tests/authorization/resourceAdmissionReview.test.ts`, the scoped authorization README, and the supplied RED and DB-safe validation logs. No code/test edits or test/DB commands were made.

## Prior finding resolution

In `src/authorization/helpers/evaluate/helpers.ts`, the new check runs after calculating the requested admission key but before constructing/storing the replacement resource:

```ts
if (existing?.admissionKey !== undefined && admissionKey !== existing.admissionKey) {
  throw new Error("Resource admission is immutable.");
}
```

This catches both omitted admission (`undefined`) and a different/broader admission key for an already-linked resource. It does not mutate the registry or bump currentness before throwing. An identical linked reinstall takes the existing equality/idempotence path, preserving the relationship revision and stamp currentness. A previously unlinked resource remains eligible for an unlinked reinstall and direct-grant evaluation; the guard does not require synthetic admission or namespace authority.

The three focused tests establish distinguishing controls:

- `rejects omitted admission on a linked resource without widening or invalidating current authority`: inside-ceiling allow, outside-ceiling deny, omitted-link reinstall throws, original stamp remains current, and outside policy remains denied.
- `rejects a different admission and keeps identical linked reinstall idempotent`: identical restricted link preserves currentness; broader link throws; currentness and outside-policy denial remain.
- `preserves explicit unlinked direct grants without manufacturing namespace authority`: unlinked direct policy allows and repeat unlinked install preserves currentness.

The pre-fix `P03-admission-link-red.log` reports the two intended failures (omission and broader-link replacement) and the unlinked positive passes. The post-fix `P03-admission-link-validate.log` reports `VALIDATE_EXIT:0`, 68 test files/533 tests passed, documentation mapping 151 sources, and successful lint, typecheck, test, docs, and build phases. These are supplied execution records, not commands I reran.

## Scoped documentation drift

No confirmed drift in `src/authorization/README.md`: it now states that an established resource admission association cannot be omitted or replaced, that such attempts reject atomically, and that explicitly unlinked direct-grant resources remain supported. This matches the guard and test controls. No broader documentation scan was performed.

The earlier broad P03 review remains context; this narrow recheck does not independently certify the full candidate or accept P03. Lead remains responsible for final candidate/hash integration and acceptance.
