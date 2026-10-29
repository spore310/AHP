# Start here — bounded execution, not another broad redesign

## First assignment

Give Grok [GROK_PROMPT.md](GROK_PROMPT.md) and [P00](packets/P00.md). P00 verifies
the checkout, instructions, baseline gates and import/delivery map. It does not
rewrite production code. Record the actual HEAD and all relevant uncommitted work.

After that, assign one packet at a time. Every packet contains dependencies,
read/write scope, concrete steps, failure cases, test targets and an exit gate.
Do not launch every packet as a separate unattended agent or preload all files.
Use the already configured local harness; do not install another one.

## Low-spend working rules

- Read CONTRACT_CARD once per new context, then only the named detailed contract
  and code needed for the current packet. Use file/symbol references rather than
  pasting prior logs and plans repeatedly.
- One writer by default. Shared public types and wire DTOs have one owner. A second
  terminal requires a separate, disjoint assignment; parallel writes require
  explicit permission and separate worktrees. No recursive delegation or external model/API calls.
- Write a failing focused regression where practical, implement the smallest
  change, run focused tests plus typecheck/docs mapping, and inspect the diff.
- Run the full repository gate at designated milestone/integration boundaries and
  before declaring a completed change ready, as repository instructions require.
  Prefer fewer coherent commits over running full validation after every line.
- Stop after two unsuccessful repairs of one criterion. Preserve the reproducer
  and request a narrower repair assignment; never disable tests or loosen policy.
- Save a short factual handoff. Do not regenerate the plan or narrate internal
  reasoning. Keep logs sanitized and retain only the failure excerpt needed.

## Execution milestones

1. P00–P06: contracts, identity, policies, session-scoped authority and revisions.
2. P07–P12: existing client tool path, lifecycle, recipient views and real SDK tests.
3. P13–P15: challenge continuation, resource-adapter tests and server executor.
4. P16–P17: client-proposal admission and approved-artifact seams.
5. P18–P19: consumer documentation, integration tests and final acceptance evidence.

Each milestone is a safe checkpoint, not permission to omit the rest. Do not
expose an intermediate mixed-protection build to untrusted participants. The
protected capability becomes eligible for a sharing demonstration only after
P12 proves every required existing-tool and delivery path.

## Important limits

No production database, migrations, provisioning, package upgrades, provider
accounts, code installation, push/merge or deployment. Do not implement real
PTYs, chat streaming or filesystem access just to demonstrate their policy scopes.
Use fake resource adapters. Keep cross-principal durable work denied by existing
service and repository guards. That is separate from cross-user tool/resource
permissions introduced here.
