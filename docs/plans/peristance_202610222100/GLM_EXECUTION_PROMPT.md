# GLM 5.3 Flash — persistence refactor packet runner

Work in the user's existing authorized local runner. Do not install a harness,
switch accounts/models, call a paid reviewer, launch a background coding service,
or infer special goal-mode syntax from the model name.

You are implementing the database/ORM portability refactor for `spore310/AHP` on
`agentIdentity`. The target source checkpoint is
`f2804963129403e666a6e929db92beb9b2ab761d`; the live worktree takes precedence for
observed behavior. Read AGENTS.md, .agents/AGENTS.md and docs/CodingRules.md.

Read the supplied CORE_CONTRACT.md, then execute ONLY the assigned packet.
Initial assignment: P00. Subsequent packets are selected by the user/integrator
from TASKPLAN.md after checking their dependencies and predecessor evidence.

Do not regenerate the plan. Do not redesign repository interfaces mid-packet.
Keep `types.ts` authoritative and `index.ts` an export-only public boundary.
All driver, SQL, ORM, transaction, raw-row and SQLSTATE behavior belongs under
`src/persistence/helpers/adapters/`. Other persistence helpers consume the
common provider contract. The executable composition root may import the
adapter-selection entrypoint but may not contain vendor logic.

Preserve atomic `work.submit` and `work.claim`; never implement them using a
sequence of independently committed generic repository/CRUD calls. Preserve
identity, ownership, presence generations, lease tokens, retries and wire contracts.
No migrations, live DB queries or provisioning are allowed without separate
explicit permission. A database URL in the environment is not permission.

Before editing: identify the packet outcome, owned paths, checks and forbidden
changes. Inspect working-tree changes; never reset/stash/overwrite others' work.
After editing: run the packet checks, inspect the diff, and return the handoff
with exact evidence. Do not claim tests passed if you did not execute them.
A blocked test stays blocked; do not use pass-with-no-tests or weaken assertions.

Keep scratch reasoning out of project docs. Record decisions, source references,
checks and findings. When context is tight, save a concise task-local ledger,
then stop; do not use remaining context to start an unassigned packet.

Two terminals: by default one writes, one reviews read-only. Shared contracts
are integrator-owned. Parallel writers require disjoint files and separate
worktrees with a declared integration point. No nested delegation.

Final status must separate code validation from real database acceptance. A
fake adapter proves substitution, not PostgreSQL concurrency. A self-review
must be labelled self-review. No push, merge or deployment is authorized.
