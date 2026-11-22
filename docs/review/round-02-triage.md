# Round 02 — Triage & Consolidation (coordinator)

**Candidate reviewed:** `27ff2bb` ("fix: close disposal/ownership races and
harden work input bounds") — the round-01 fix bundle, superseding `7038a08`.

**Round verdicts received (blind, independent):**

| Reviewer | Lens | Verdict |
| --- | --- | --- |
| A1-r2 (side A) | identity / authorization / binding lifecycle / wire mapping (adversarial rigs over real wiring) | **CHANGES REQUIRED** (F1 P2 reproduced; F2–F5 P3) |
| A2-r2 (side A) | persistence / SQL / validation contracts / documentation truth | **CHANGES REQUIRED** (F1–F5 P3) |
| B1-r2 (side B) | adversarial agent/work end-to-end (per-row verification ledger) | **CHANGES REQUIRED** (B1-R2-01 P2 code-analytical; rest P3) |
| B2-r2 (side B) | full-scope static verification (ledger + trace) | **PASS** (P3s only) |

Convergence: A1-r2 reproduced, and B1-r2 analytically derived, the **same
incomplete closure** — the owner's (same-principal) mid-window recreate
survives and is then stripped by the settlement unbind — while B2-r2 filed the
identical gap as a P3 hardening item (work fails closed, recoverable) and
B1-b/r2-A2 additionally reconverged on the JSONB-key/scalar-carrier gap. Every
blocking axiom below is closed in this round's bundle.

## Findings and decisions

### Reproduced P2 — fixed

**Owner's own recreate inside the disposal window gets stripped at settlement
(A1-r2 F1).** The record-less binding marks the settling window, but the
create-path pre-check only denied *other* principals; the owner's own recreate
succeeded and the unconditional settlement unbind then deleted the binding the
recreate had (re)acquired, leaving a live ownerless record any principal could
seize. **Fix:** the create-path pre-check (AHP handler and host facade now both)
denies *any* create while an owner binding exists without a live record — the
window is closed to everyone; after the settlement releases the binding,
creation proceeds and rebinds to the true creator. Regression:
`agentWork.disposal.test.ts` "denies the owner's own recreate inside the
settling window" (denial in-window, settlement release, post-settle rebind).

### P3 cluster — JSONB/SQL-shape gate extended (A2-r2 F1–F3, A1-r2 F2)

All three share one root: the round-01 guard covered payload *values* only.

1. **Object keys unguarded.** `isJsonbSafe` recursed `Object.values` only;
   `{"a\u0000b": ""}` reached the JSONB cast (PG 22P05 → unclassified
   `InternalError`). **Fix:** the predicates now live in a single source of
   truth, `src/persistence/helpers/text.ts`, and the recursive check inspects
   every object key (`Object.entries`) as well as values. Both the service and
   the wire schemas share it.
2. **Scalar TEXT carriers unguarded.** `requestKey`, `sessionUri`, `agentKey`,
   `displayName` accepted NUL/lone surrogates and failed server-side text
   encoding (class 22021 → `InternalError`). **Fix:** `isJsonbSafeText` gates
   `requestKey`/`sessionUri` in `WorkService.submit`, `sessionUri` in `claim`,
   the agents directory `register` (module boundary, before any repository
   work), and the wire schemas for all four fields.
3. **Durable projection unguarded.** The client-reachable session state
   (`workingDirectories`, etc.) embedded in `durableState` reached `$8::jsonb`
   unchecked, poisoning every subsequent submit for that session. **Fix:**
   `WorkService.submit` gates `live.durableState` through the same predicate
   (`invalid` → `InvalidParams`) before the repository write.

Regressions: service NUL tests for `sessionUri`/`requestKey`/claim URI, the
unsafe-projection refusal, wire `ZodError` cases for NUL in `agentKey` and in
the session URI, and a directory-level NUL rejection test.

### P3 — terminal-key replay after a reconciled cancel (A2-r2 F4)

A submission whose write loses to a disposal/owner race is cancelled and
reported as `conflict`; a retry with the *same* request key resolved through the
idempotent-replay path to the (terminal) cancelled row and returned success
while the work could never be claimed. **Fix:** `WorkService.submit` now, for
replays only (`created === false`, cheap rare path), reads the landed row and
refuses terminal statuses (`cancelled`/`failed`) with a typed `conflict`;
`queued`/`leased`/`completed` replays keep today's idempotency contract. The
frozen `WorkRepository` contracts are untouched. Regressions: terminal-replay
refusal (cancelled + failed, including the principal-bound `get` argument) and
the non-terminal replay resolves as before.

### P3 — same-owner recreate during a submission write (A1-r2 F3) — accepted and documented

After checking the real projection: the host `describeSession` synthesizes
`createdAt` from fetch time (`host/helpers.ts`), and `SessionSnapshot` exposes
only `{ resource, state, fromSeq }`. There is **no stable session-generation
field** in the current projection, so the reconciliation (owner binding +
liveness) cannot detect a same-owner recreate that lands mid-write. Detecting it
would require an identity field on `SessionSnapshot` — a wire-visible contract
change that does not belong in a hardening round. **Documented** in
`src/work/README.md` ("Same-owner recreate residual") and in the M2 schema doc's
reconciliation bullet, alongside stating the cancel is **best-effort** and
cross-principal/owner-removal cases are caught.

### P3 — observation only (A1-r2 F5)

In the host wiring, the live projection's owner and the service's checked owner
are the same registry, so the submit pre-check corroborates one source. Noted in
`src/work/README.md` ("One owner authority in the host wiring"); a production
projection would read the durable `sessions` owner.

### Documentation regressions introduced by round-01 fixes (both reviewers) — corrected

1. `src/work/README.md` carried **two** `## Caveats` sections. Merged back into
   one (all caveats retained, including the two newly-added ones), plus the
   2,048-char session-URI cap and the now-accurate text-gate scope.
2. `src/agents/README.md` claimed the *renewal* path consults the registration
   cache — wrong mechanism (renewals consult neither cache nor repository).
   Rewritten: the bind path consults the cache; renewals never do; disable-path
   coupling unchanged. Added the bounded-growth nuance for same-principal
   concurrent registrations (A1-r2 F4 residual note).
3. `database/session-tables.md`: `ownedPrincipalSubject` →
   `owner_principal_subject`; "reconciled into those migrations and was never
   implemented" → "superseded by those shipped migrations and never implemented
   as specified" (de-contradicted).
4. `docs/architecture/agent-task-lifecycle.md:27`: restored the literal `;`
   (`push#59;` entity corruption from the round-01 fix commit).
5. `database/M2_AGENT_WORK_DATABASE_SCHEMA.md`: reconciliation bullet now says
   best-effort cancel with the same-owner residual note.
6. `src/persistence/README.md`: added the `helpers/text.ts` row (also required
   by the docs gate for the new module).

### SQL statement-validity (A2-r2 scope 1) — validated, nothing to change

Both `schema_migrations` INSERTs are valid against the `schema_migrations` DDL
(column list, DEFAULT `applied_at`, text literals), correctly placed, and
version strings match the filenames. No code references the table; no drift
elsewhere in the migrations. Runtime behavior remains gated on the
user-authorized database.

### Frozen contracts

Verified untouched by both reviewers (`git diff` over `src/*/types.ts` is
empty); the new round of fixes also does not touch them, including the
terminal-replay fix (service-level only).

## Side-B round-02 findings → resolution

| Finding | Decision | Where |
| --- | --- | --- |
| B1-R2-01 (P2, analytic) = B2R2-P3-01 (P3) — same-principal mid-window recreate stripped at settle | **Fixed** — identical to A1-r2 F1; the all-principal window closure and the owner-recreate regression test cover it | see "reproduced P2" section above |
| B1-R2-02 (P3) / B2R2-P3-04 / A2-r2 F5.1 — duplicated `## Caveats` in the work README | **Fixed** — merged into one section, new bullets kept | `src/work/README.md` |
| B1-R2-04 (P3) / B2R2-P3-03 / A1-r2 / A2-r2 F5.2 — renewal path misdescribed in the agents README | **Fixed** — rewritten: bind consults the cache; renewal consults neither cache nor repository; disable-path coupling and work-mutation re-reads unchanged | `src/agents/README.md` |
| B1-R2-03 (P3) / B2R2-P3-05 — dead 1 MiB `MAX_AGENT_WORK_PAYLOAD_BYTES` with a stale comment | **Fixed** — constant deleted after a repo-wide reference check (only the definition remained) | `src/websocket/helpers/ahp/constants.ts` |
| B1-R2-05 (P3) — session-tables banner nits + body "Disposed sessions are deleted" | **Fixed** — column name corrected, self-contradiction removed, and the banner now flags lifecycle statements inside the body as proposal-only (shipped behavior keeps durable rows, retention deferred) | `database/session-tables.md` |
| B1-R2-06 (P3) — `schema_migrations` absent from the migrations README; non-idempotent re-apply undocumented | **Fixed** — table set corrected (eight) and the single-shot version-INSERT semantics documented | `database/migrations/README.md` |
| B2R2-P3-02 (P3) — best-effort reconciliation cancel stated unconditionally in two docs | **Fixed** — both the M2 bullet and the lifecycle paragraph now state best-effort cancel, the conflict reply, and the operational consequence of a failed cancel | `database/M2_AGENT_WORK_DATABASE_SCHEMA.md`, `docs/architecture/agent-task-lifecycle.md` |
| B1-R2-07 (P3/hypothetical) / B2R2-P3-N — register pre-check read outside the mapped try | **Accepted observation** — today's only reachable failure class (`database`) maps to the same `InternalError` either way; moving the read inside the mapped `try` would risk diverging the conflict-mapping path for zero observable gain | recorded here, no change |
| B2R2-P3-N — mermaid `#59;` entity is render-equivalent | **Normalized** — restored to the literal `;` (three reviewers preferred the literal; renders identically) | `docs/architecture/agent-task-lifecycle.md:27` |
| B2 evidence gap — swallowed-cancel path untested | **Tested** — new service regression: a rejecting repository cancel still yields the typed conflict, never a false success | `src/tests/work/workService.test.ts` |
| B2 evidence gap — replaced-owner reconciliation untested | **Accepted with rationale** — the session-owner registry's typed `bind` conflict makes a crossed-subject replace unreachable through any public path; the branch is defensive parity with the vanished-owner case (same conditional) | recorded here |

## Validation after the round-02 fixes

`pnpm validate` green: lint 0 warnings, `tsc --noEmit` clean, vitest 40 files /
298 tests (291 previous + 7 new regressions), docs gate 96 files, build passes.

## Next

- Side-A re-review verdicts registered CHANGES REQUIRED on the incomplete
  closure and incomplete text gate, addressed above; side-B issued one
  code-analytical P2 (same shape), addressed above, and one PASS.
- A third blind re-review will cover this round's fix bundle (candidate =
  the round-02 fix commit) on both sides; a PASS from all four reviewers ends
  the loop.
