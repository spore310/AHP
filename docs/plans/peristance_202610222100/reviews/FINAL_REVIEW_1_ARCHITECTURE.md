# P13 final review pass A: architecture and boundaries

- Reviewer: Codex GPT-6, the implementation author.
- Independence: sequential self-review; no independent reviewer or double-blind
  review is claimed.
- Candidate: `d68f7d2` plus the staged RP01 patch, SHA-256
  `EAF8B42A7D69A8AB5DFD6041468AF96B9A7211C24A8039A3B3FEAEACEFEAD9B4`.
- Scope: shared contracts and root exports, adapter selection, process
  composition, consumer imports, adapter placement, and scoped documentation.

## Finding

1. **Resolved — allowlist prototype keys.** In the pre-repair candidate,
   `src/persistence/helpers/adapters/helpers.ts` indexed a normal object by the
   configured selector. Inherited keys such as `constructor` and `toString`
   could be treated as loaders, so those unknown names did not get the required
   unsupported-provider error. RP01 now requires an own key before lookup.
   `src/tests/persistence/adapters/selection.test.ts` verifies `unknown`,
   `constructor`, `toString`, and `__proto__` all reject without loading the
   adapter. Focused selection tests and the final `pnpm validate` pass.

## Boundary review

- `src/persistence/index.ts` exports the neutral contract, facade constructor,
  and portable-text helpers only. Adapter constructors are available through
  explicit adapter entrypoints.
- Production SQL, `pg`, pool/client shapes, row mapping, SQLSTATE handling,
  transaction functions, database-clock logic, and query behavior remain under
  `src/persistence/helpers/adapters/postgres/`. The only production source
  match outside that subtree is the allowlisted lazy import in the adapter
  registry.
- `@agents`, `@work`, and WebSocket/host modules consume neutral repository
  ports and policy helpers. The composition root validates feature configuration
  before selecting the provider, and hands the facade repositories plus one
  disposer to the host.
- Module READMEs and linked architecture/wire docs match the current selector,
  provider ownership, portable-text, atomic-submit, and session limitations.
  Documentation-drift review found no remaining confirmed factual drift in this
  scope after the P12 updates.

## Verdict

**PASS after RP01.** No required architecture finding remains. Database
portability is not claimed as runtime-verified; real database acceptance is
tracked separately as blocked.
