# Round 04 triage — the closing round

**Candidate:** `65127f6` ("fix: bind owner at attach and finish the round-03 closures"), HEAD of `agentIdentity`.
**Review base:** round-01..03 triages only; blind reviewers per side; side-A review against `65127f6` with fix-diff base `d3c33d1`; side-B same-plus frozen-contract baselining against `7038a08`.

## Verdict matrix — round 04

| Reviewer | Verdict (findings) | Round items closed |
| ---- | ---- | ---- |
| A1-r4 | **PASS** | F1 (P2 takeover), F2 (P3 ghost), F3 (P3 in-flight window) — closed; F4 pinned per triage decision; B1-R2-equivalent facade probe closed; A2 adjacents (dispose text gate, depth budget, request-key cap) observed closed |
| A2-r4 | **PASS** | F1 (dispose-channel text gate) — closed; F2 (JSONB depth budget 512, explicit lambdas, no index leak) — closed; request-key cap alignment — closed; frozen contracts `7038a08..65127f6` empty diff; baseline wire surface unchanged except declared caps/validations |
| B1-r4 | **PASS** | R1 (shared settle-window predicate + facade probe) — closed; R5 (`WORK_MAX_REQUEST_KEY_LENGTH` alignment) — closed; R3/R4 doc corrections verified accurate; frozen diffs empty; 103 targeted tests green |
| B2-r4 | **PASS** | F-01 (attach-hook owner binding) — closed; F-02 (bounded-growth example) — verified accurate; F-03 (retention citation) — verified accurate; closure family (settle probe, cap, dispose gate, depth budget, loud unbind, migrations wording) — verified |

**All four verdicts PASS ⇒ the loop closes on `65127f6`.**

## Convergence

Three of four reviewers (B1, B2, and A1 via its D2/O-observations) and A2's advisory converge on the same small advisory surface; no P1/P2 anywhere; the round-03 fix mechanism (single synchronous bind-at-attach + resolution-time verification + unconditional settle-unbind) was independently traced-correct by A1, A2, and B2 event-loop reasoning, and the settle-window probe's single-source property by B1.

## Round-04 findings

| # | Where | Severity | Nature | Triage decision |
| ---- | ---- | ---- | ---- | ---- |
| RF-1 | B1r4 + B2r4 + (A1-r4 D2/O): `src/websocket/README.md` caveat — the "same-principal successor attach" parenthetical and the typed-Conflict sentence over-claim: the resolution check enforces "record alive + not owned by a different principal", so a same-principal successor attach resolves plain success (the explicitly deferred same-owner residual family) | P3 (doc-truth) | Docs (+ one paired code comment wording) | **Fix** — reword the caveat for both imperfections (remove-behavior wording per A1-D2; same-principal residual named per B1/B2 with cross-reference to `src/work/README.md` "Same-owner recreate residual"); scope the paired comment in `ahp/helpers.ts` to a *foreign* successor |
| RF-2 | A1-r4 D1: `src/sessions/README.md:62` still shows the old `createSession(params)` factory signature, missing the optional attach hook | P3 (doc drift) | Docs | **Fix** — signature + one clause pointing at the attach-hook contract |
| RF-3 | A2-r4-1 (advisory): the 512-level depth-budget boundary is unpinned by tests — a one-directional off-by-one (`>` → `>=`) would ship silently | P3 (test gap, advisory) | Tests only | **Fix** — pin 512-pass/513-fail once at the service level (durableState projection) and once at the wire (depth-512 accepted / 513 refused) |
| RF-4 | A1-r4 O1 + A2-r4 observation: facade-created records are ownerless by design (pre-existing, covered by the existing "does not add authorization" boundary note); enter-window races on ownerless records end typed | P3 (observation) | None | **Accepted, no change** — A1 explicitly optional; both reviewers recorded it as verified-unchanged behavior |

## Declared shared write set for the closing bundle (side-A coordinator owns all edits)

- `docs/review/round-04-triage.md` (this file)
- `src/sessions/README.md` — RF-2
- `src/websocket/README.md` — RF-1 (caveat rewording)
- `src/websocket/helpers/ahp/helpers.ts` — RF-1 (paired comment only; no logic change)
- `src/tests/work/workService.test.ts` — RF-3 (boundary test)
- `src/tests/websocket/agentWork.test.ts` — RF-3 (boundary test)

No production logic changes; frozen contracts untouched; `docs/review/` stays untracked in commits. Verification: full `pnpm validate` (~313 tests: 310 + 2 new boundary tests + any exact-boundary variants), then commit.

## Process notes

- First A2-r4 launch hit the platform rate limit and was relaunched fresh (same deterministic prompt; blindness unaffected). Side-B's coordinator hit its daily message cap after writing both verdict files; its reviewer outputs are on disk.
- Real-PostgreSQL acceptance remains BLOCKED (user instruction: no SQL applied; read/write-only validation only). The blocker persists into the final report.
