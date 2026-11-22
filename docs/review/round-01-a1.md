# Round 01 — Blind Review A1 (side A): Identity, Authorization, Work Lifecycle

**Reviewer:** independent subagent, blind to A2 and to side B.
**Candidate:** `7038a08a46321885f4a4c418f3f3cb5f7f87eb03`.
**Verdict:** **CHANGES REQUIRED** — one confirmed (reproduced) race producing cross-principal ownership mismatch at the transport/session/work coupling, plus a sibling reproduced orphan-session race, with several smaller source-inferred items.

## Coverage

Full read of `src/agents/`, `src/work/`, `src/websocket/helpers/ahp/agentWork.ts`, `src/websocket/helpers/ahp/helpers.ts`, supporting: `server/connection/types/constants`, `host/helpers.ts`, persistence helpers, sessions factory/create-session, `src/index.ts`; tests: `src/tests/agents/*`, `src/tests/work/workService.test.ts`, all 5 `agentWork*` test files; module docs (`src/agents/README.md`, `src/work/README.md`, `src/websocket/README.md`), `docs/architecture/agent-task-lifecycle.md`. Did not read `docs/review` or other round reports.

## Findings

### F1 — P2 — REPRODUCED — open — stale owner binding after a failed disposal lets principal A seize work ownership of B's recreated session
- **Location:** `src/websocket/helpers/ahp/helpers.ts:382-398` (`disposeSession` unbinds only on success), `src/sessions/helpers/factory/helpers.ts:194-222` (live record deleted at line 203 *before* awaiting dispose), `src/websocket/helpers/host/helpers.ts:158-170` (unbind only on success), `src/work/helpers/helpers.ts:140-146` (`bind` throws plain `Error`) / `164-182` (`submit`), plus `describeSession` wiring `host/helpers.ts:85-94`.
- **Trigger (reproduced with real binding/directory/owner registry/work service):**
  1. alice `createSession(ahp-session:/stage-1)` (owner binding alice).
  2. alice `disposeSession` where the provider `dispose()` rejects → live record deleted, `unbind` never runs, binding stays `alice`.
  3. bob `createSession` same URI → live record becomes bob's, then `sessionOwners.bind` throws the plain error → bob sees `Internal error` (unmapped).
  4. alice `x-ahp/work/submit` against that URI **succeeds** (`assertOwnedSession` and `describeSession` both read the stale registry) → durable submit recorded with `owner: "alice"` (the durable `sessions` row becomes alice's).
  5. bob's own `x-ahp/work/submit` → `-32602 Request rejected`.
- **Impact:** Cross-principal authority mismatch — work ownership flips to the principal that did not create the live session; the true creator is silently locked out and his error is indistinguishable from a server bug. No unauthorized-data grant beyond the mismatch, but it violates the documented "live session belongs to that principal" invariant.
- **Correction direction:** make "record deleted" the single authoritative point where the owner binding is released (unbind at/before the delete, not after dispose resolution); reject `createSession` *before* creating the record when another principal's binding exists; map the plain `bind` error to a targeted conflict error instead of `Internal error`.
- **Verification needed:** regression test at real factory+binding level with a rejecting provider `dispose()`; prove durable-owner can never contradict the live record's creator.

### F2 — P2 — REPRODUCED — open — recreate landing inside the disposal window (between record delete and unbind) strands the new session ownerless; work permanently dead
- **Location:** same files as F1.
- **Trigger (reproduced):** parking disposal after the record delete, bob's `createSession` creates the live record but `bind(X, bob)` throws (registry still says alice, generic `Internal error`). When alice's disposal later completes, the unbind erases the only binding → bob's live record has **no owner**; `x-ahp/work/submit` fails (`boundOwner === undefined` → `not_found` mapped to `-32602`), bob cannot recreate (`SessionAlreadyExists`) and bob's `disposeSession` of it fails the owner check (masked `Session not found`). Only restart or alice recreating+disposing the URI recovers.
- **Impact:** silent loss of work capability for a legitimate authenticated session; zombie session the true owner cannot name, fix, or dispose.
- **Correction direction:** same coordination fix as F1, plus (a) at unbind time re-check that the binding still corresponds to the disposing record, or (b) let the recreated session rebind to its actual creator when the stale binding clears.

### F3 — P3 — open — `assertSessionDisposable` TOCTOU: concurrently committed work rows retain durable work after live disposal
- **Location:** `src/websocket/helpers/ahp/helpers.ts:386-397`, `src/websocket/helpers/host/helpers.ts:158-170`, `src/persistence/helpers/workItems.ts:389-398`.
- **Contract:** `docs/architecture/agent-task-lifecycle.md:125` states disposal is rejected while *any* work row references the session (absolute).
- **Trigger:** submit's dependency check passes while the work row commits; disposal proceeds and unbinds. Durable work + `ensureSession` session rows survive for a live session that no longer exists (claimable by same-principal agents, visible via `work/get`, cancellable). No deletion path for work rows anywhere.
- **Impact:** same-principal only; stale coordination state contradicting the documented invariant; permanent durable rows.
- **Correction direction:** re-check dependency work inside one serial region with the disposal record deletion, or re-document the claim; optionally reconcile work rows of disposed sessions.
- **Verification needed:** two-socket concurrency test with controlled interleaving.

### F4 — P3 — open — failed `x-ahp/agents/register` after durable row creation: repeated calls grow `agent_registrations` rows + cache with no cleanup path
- **Location:** `src/websocket/helpers/ahp/agentWork.ts:266-289` (register→bind order), `src/agents/helpers/directory.ts:94-138` (conflict thrown *after* durable upsert), `src/persistence/helpers/agentRegistrations.ts` (upsert only).
- **Trigger:** authenticated connection already holding a live binding repeatedly registers fresh `agentKey`s; each call inserts a durable row + caches it before `bindPresence` throws `conflict`.
- **Impact:** unbounded durable-row and cache growth per authenticated principal (authorized-client pollution), no in-repo deletion path. Confined to the caller's principal — no authorization leak.
- **Correction direction:** check presence/live-connection conflict *before* durable creation, or map presence conflict to a no-op reply; add an explicit disable/delete story.
- **Verification needed:** sequence test against a recording fake proving row-count growth via the extension.

### F5 — P3 — open — presence renewals reuse the registration cache, so a DB-disabled registration can keep renewing presence; work mutations fail closed
- **Location:** `src/agents/helpers/directory.ts:99` (`bindPresence` uses `cachedRegistration`) vs `src/work/helpers/helpers.ts:101-110` (`enabledAgent` uses fresh `getById`).
- **Trigger:** registration disabled in the DB while a live binding exists — renew keeps extending presence; all `x-ahp/work/*` agent mutations remain fenced by `enabledAgent`.
- **Impact:** present-but-disabled agents look online (low current influence; no work-push design exists); fragile coupling. Fix: use a fresh `getById` in `bindPresence`.
- **Verification needed:** directory test: bound presence is re-denied when the underlying registration becomes disabled.

### F6 — P3 — open — work-service input bounds allow DB-rejected whitespace-only `requestKey`/`kind` → Internal error (direct service consumers only)
- **Location:** `src/work/helpers/helpers.ts:63-84` (length-only bounds) vs DDL `0002:37-38` (`length(trim(...))` CHECKs); DB failure surfaces as `mapRepositoryFailure` plain `Error` → wire `InternalError`.
- **Trigger:** direct `WorkService` consumer submits whitespace-only `requestKey` or `kind` (the wire extension already enforces non-blank).
- **Impact:** error-classification mismatch only; mirror DB trim rules in the service (or relax the CHECKs) to keep one source of truth.
- **Verification needed:** service-level unit test with whitespace `requestKey`.

## Informational (not findings)

- Baseline AHP surface (subscribe/dispatch/dispose on sessions) is intentionally unauthenticated for unbound sessions per `src/websocket/README.md` — host-global POC objects, documented-by-design.
- `WorkErrorCode "exhausted"` mapped on the wire but never produced by the service (dead code, fixture-pinned).
- Static-token revocation requires reconfig/restart (POC-acknowledged).
- Durable `sessions`/`work_items` rows are never deleted — fail-closed squatting of a durable URI owner by a prior principal; operator-actionable, consistent with the documented figure.

## Documentation drift

None inside scope that constitutes a concrete factual violation. READMEs match observable behavior on fencing, redaction, TTLs, caps, error vocabulary, and identity derivation (verified `toView` redacts lease fields; presence TTL 90 s; input/result caps; bearer parsing and repeated-header rejection). One borderline point folded into F3: `docs/architecture/agent-task-lifecycle.md:125` states the disposal invariant absolutely, while the implementation has the window described there.

## Tests/checks actually run

- `pnpm exec vitest run` on `src/tests/agents`, `src/tests/work`, `agentWork.test.ts`, `agentWork.binding.test.ts`, `agentWork.transport.test.ts` — 6 files / 43 tests passed (743 ms); `agentWork.integration.test.ts` — 1 test passed.
- Reproduction script outside the repo (`C:\Users\Yohan\AppData\Local\Temp\opencode\ahp-review-repro.ts`) via `pnpm exec vite-node` with the real `createAHPBinding`, `createAgentDirectory`, `createSessionOwnerRegistry`, `createWorkService` — deterministically produced F1 and F2 sequences at the real wiring level. Repository untouched.
- `pnpm validate` NOT RUN, per instructions.
