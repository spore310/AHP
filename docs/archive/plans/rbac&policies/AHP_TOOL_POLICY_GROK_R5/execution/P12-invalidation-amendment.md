# P12 private advertisement invalidation amendment

Status: IMPLEMENTED; independent repair-plan and bounded implementation review PASS. This is a narrow
production defect found by the authorized P12 integration matrix, not acceptance.

The production SDK transport deletes its registered channel implementations on
`x-ahp/tools/assignmentsChanged`. The host private protocol drops assignment views
and sends that hint on registry invalidation, but the broker retains the private
advertisement as a candidate for new dispatch. With an unrelated parent grant
revoked, a still-authorized senior caller receives an accepted receipt and its
call is sent to an executor that no longer has an active local registration.

Evidence: `P12-invalidation-routing-red.log`, X01/X02/X03 one-harness public test,
expects new dispatch denial but receives `accepted`. Earlier diagnostic logs show
the revoked junior's calls/snapshots reject and its transport reaches EOF. The
later independent senior call hangs because of the stale advertisement, not
because the revoked junior retains native access. Preserve those failed logs.

Reviewed repair: invalidate eligibility of private advertisements for new calls
synchronously with assignment-view invalidation; a fresh exact advertisement
acknowledgement is needed before selecting that executor again. Do not reroute or
rerun any call. Preserve captured active-call identity, exact completion cleanup,
cancellation/draining and fresh caller/executor policy checks. A naive deletion
must not accidentally invalidate active-call fences merely because an unrelated
grant changed. Review the existing broker fences before choosing the edit.

Owned production boundary: `src/websocket/helpers/ahp/toolInvocation.ts` and only
the private protocol port if required. Tests remain in policyIntegration.test.ts
and bounded fixture support. Update owning README current-state claims. No new
dependency, persistence, public wire shape, policy authority or execution route.

Required regression: real public self and cross routes execute before change;
process an unrelated authoritative invalidation; reject new calls before a new
acknowledgement with zero extra handler/input delivery; advertise afresh and
execute once. Separately retain a running authorized handler across invalidation
and prove its exact completion/status and cleanup remain correct. Run affected
P09-P11 suites and full DB-safe validation before packet acceptance.

Implementation uses a private readiness epoch and a WeakMap stamped only at fresh
acknowledgement commit. Selection and both current/final fences require readiness
until successful invocation enqueue; existing active-call ownership is unchanged.
P12-invalidation-routing-green and P12-invalidation-active-first pass. Full current
gate P12-expanded-validate-first passes 88 files / 1108 tests and all other stages.
Whole-packet final independent review PASS; P12 X01-X06 accepted.
