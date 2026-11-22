# P13 final review pass B: behavior, lifecycle, and security

- Reviewer: Codex GPT-6, the implementation author, after pass A.
- Independence: sequential self-review; no independent reviewer or double-blind
  review is claimed.
- Candidate: `d68f7d2` plus the staged RP01 patch, SHA-256
  `EAF8B42A7D69A8AB5DFD6041468AF96B9A7211C24A8039A3B3FEAEACEFEAD9B4`.
- Scope: idempotency, same-client atomic submission, claim and lease fencing,
  authorization, error boundaries, cleanup ownership, and evidence quality.

## Findings

1. **Resolved — conformance payload equality.** The test-only provider in
   `src/tests/persistence/conformance/helpers.ts` compared payloads with
   `JSON.stringify`, which treated object key order as significant unlike the
   PostgreSQL JSONB equality used by the real adapter. RP01 uses structural
   equality and adds conformance cases showing reordered object keys replay the
   same ID while reordered array values conflict. This protects the shared
   contract from a false conformance failure.
2. **Resolved — durable cleanup on failed startup.** The host already stops and
   disposes its optional durable extension when transport startup fails, but
   the prior failed-start test did not attach a durable disposer. RP01 extends
   `src/tests/websocket/composition.test.ts` with a test provider and asserts
   the handed-off disposer runs exactly once. Focused composition tests pass.

## Invariant review

- PostgreSQL `work.submit` invokes its private session ensure, insert, and
  idempotency lookup inside one `withTransaction` callback using one acquired
  client. The facade delegates that atomic method once and does not split it.
- Claim remains one SQL statement with `FOR UPDATE ... SKIP LOCKED`, DB-clock
  expiry, owner/enabled-agent/kind/target/attempt predicates, and token rotation.
  Renew, complete, fail, and reclaim retain token, holder, status, owner, and
  expiry fences in adapter-owned operations.
- Work-service authorization still revalidates the authenticated principal,
  session owner, presence generation, and registration. The neutral portable
  text helper does not replace schema, size, or authorization validation.
- The lifecycle closes admission synchronously, tracks admitted calls before
  invoking a provider, drains all settled operations, and shares one disposal
  promise. Host start failure and host construction failure retain a single
  cleanup owner.
- Query doubles and fake-provider tests do not prove database contention,
  transaction rollback, or database-clock behavior. T04-T06 remain
  **BLOCKED / NOT RUN**; no database was accessed.

## Verdict

**PASS after RP01.** No blocking correctness or security finding remains within
the reviewed code scope. The database execution gate remains blocked separately.
