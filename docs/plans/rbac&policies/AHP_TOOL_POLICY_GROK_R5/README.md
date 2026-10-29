# Agent Hosting Protocol — tool policy implementation packets for Grok

**Revision:** R5. **Status:** PLAN READY / implementation NOT STARTED.
**Repository:** `spore310/AHP`, branch `agentIdentity`.
**Pinned base:** `22fa7955b8e43839e041228f647f26e00762ebbe`.
**Base commit:** `fix: close persistence review findings` (2026-10-23).

This bundle merges the supplied R4.1 architecture plan and the user's latest
ownership, reveal, resource-policy and per-client-agent requirements. The live branch was read again and still pointed to the pinned base.
No repository edits, coding agents, live database operations or application tests
were performed in preparing this bundle.

## Start

Read [START_HERE.md](START_HERE.md), then assign **P00 only** using
[GROK_PROMPT.md](GROK_PROMPT.md). The [packet map](MASTER_PLAN.md) controls order.
The executor should load the [contract card](CONTRACT_CARD.md), its assigned
packet, linked contract sections, and the necessary source—not the entire bundle
on every turn. Use [the handoff template](templates/HANDOFF.md) after each packet.

Suggested placement: `docs/plans/tool-policy-r5/`. Keep relative links intact.
These are planning files, not a source patch or installed agent hook.

## Central distinction

The SDK reuses one trusted identity context. It does **not** equate all session
participants with the owner. Ownership is resource metadata. Roles/grants are
actor-and-scope-specific. Reusing a coding-agent harness does not reuse another
user's authority. Policies, namespaces and role labels never grant access merely
because they are declared or sent in a client request.

## Supporting files

- [Master plan](MASTER_PLAN.md) and [accepted decisions/change map](INTENT_AND_DECISIONS.md).
- [Authority contracts](contracts/AUTHORITY.md), [policy factory](contracts/POLICY_FACTORY.md),
  [execution lifecycle](contracts/EXECUTION.md), [delivery and wire](contracts/DELIVERY_WIRE.md),
  [repository integration](contracts/INTEGRATION.md).
- [Acceptance matrix](TEST_COVERAGE.md), [worked scenarios](SCENARIOS.md),
  [source evidence](SOURCE_EVIDENCE.md).
- [Execution ledger](templates/LEDGER.md) and [artifact validation](DELIVERY_VALIDATION.md).

The $30 subscription is a reason to keep work bounded, not a verified token budget
or a promise about model cost. No benchmark/model capability assumptions are made.
This bundle contains implementation instructions and test specifications only.
No review workflow or independent-approval gate is included.
