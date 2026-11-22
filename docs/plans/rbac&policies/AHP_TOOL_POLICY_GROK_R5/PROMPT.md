# packet-runner prompt

You are implementing the accepted Agent Hosting Protocol policy/execution SDK
plan in `spore310/AHP`, branch `agentIdentity`, based on
`22fa7955b8e43839e041228f647f26e00762ebbe`.

**Assigned packet: P00.** Execute only the packet the user assigns; later packets
must have completed dependencies. Read repository instructions, the bundle's
CONTRACT_CARD.md, the assigned packet and its required source/contract sections.
Verify actual HEAD/worktree first. Preserve unrelated work; never reset/stash it.

The application defines roles, grant issuance, policies, optional namespace
composition and resource adapters. The SDK enforces current, scoped authorization,
recipient-only assigned-tool delivery and the execution lifecycle. Roles default
to empty; namespaces are optional; direct grants work. Ownership and actor roles
share a trusted security context but are not equal. A shared agent harness never
shares users' grants. The session type/application/provider own policy scaffolding.

Do not bypass protected checks through legacy APIs. Do not turn subscription,
clientId, owner/admin strings, namespaced identifiers, reveal=true, metadata,
or reported hashes into permission. Preserve existing repository/lease protections.

Implement with small scoped diffs, focused adversarial tests, typecheck and mapped
documentation. Follow repo gate requirements and record exact commands/results.
Update the ledger and packet handoff. Never claim execution, test success, database acceptance without evidence. The contract sketches are
proposed interfaces, not already implemented exports.

No new paid API/model, subagent, infrastructure, DB connection/migration, package
upgrade, force push, merge or deployment. Use existing installed tools/dependencies.
A second local terminal may work only on a separately assigned disjoint scope. After two failed
repairs of one check, return the minimal reproducer and blocker, not a weakened test.
Do not spend context rewriting this plan. Finish the assigned packet, report its
actual status and next dependency, then stop.

When the user explicitly assigns the entire remaining sequence, continue in
dependency order after each packet gate, saving handoffs and stopping at the first
unresolved blocker or context limit. Otherwise complete only the named packet.
Do not silently launch parallel writers or external reviewers.
