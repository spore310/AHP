# Source Evidence and Verification Limits

> **Historical planning input.** This evidence describes the repository before
> implementation. Current behavior and verification are tracked in
> [CURRENT_STATE.md](CURRENT_STATE.md).

## Inspected checkpoint

`spore310/AHP`, branch `develop`, commit `3eeb31eebb0498d4fb1f0a5de60ca3b5677f744e`, checked October 18, 2026. The branch may move after this document is written; WP-00 must refresh it and reconcile source rather than overwrite the local tree.

The current repository was read through the GitHub connector. The supplied `AHP_SESSION_TOOL_PERSISTENCE_PROPOSAL.md` was read as a prior conversation artifact. That proposal supplies target-state context, not evidence of implemented persistence.

## Evidence index

| Ref | Source | What it supports |
|---|---|---|
| E1 | Repository `.agents/AGENTS.md` at the inspected SHA | Architecture, validation, documentation, permissions and instruction-driven workflow |
| E2 | `docs/CodingRules.md` at the inspected SHA | Module naming, schema placement, public exports, tests and alias conventions |
| E3 | `src/sessions/helpers/factory/helpers.ts` at the inspected SHA | Current session ownership, registry, dispatch/publication and creation composition seams |
| E4 | `src/sessions/helpers/configuration/helpers.ts` at the inspected SHA | Existing configuration descriptor/parser helper and its current ownership |
| E5 | Microsoft pinned `types/channels-session/state.ts` | Legal session lifecycle, `_meta`, serverTools versus active-client tools |
| E6 | Microsoft pinned `types/channels-session/commands.ts` | Native creation params and eager activeClient contract |
| E7 | Microsoft pinned actions/overview/reconciliation docs | Action notifications, rejectionReason and notification no-response semantics |
| E8 | Repository `src/websocket/helpers/ahp/helpers.ts` | Native wire binding, current parser and origin publication path |
| E9 | Repository `package.json` | Actual pinned toolchain/dependencies and `pnpm validate` command |
| E10 | Ajv official options documentation | Validator configuration, mutation controls, schema validation and remote-loader behavior |
| E11 | Ajv official strict-mode documentation | Strict-schema checking is distinct from mere JSON object shape |
| E12 | Ajv official security considerations | Resource-conscious schema admission and avoidance of untrusted/expensive validation paths |
| E13 | Repository selective delegation skill | Actual two-concurrent/three-assignment defaults, isolation, evidence and budget rules |
| E14 | Prior supplied `AHP_SESSION_TOOL_PERSISTENCE_PROPOSAL.md` | Five-table direction, version-pinned definitions, live/durable separation; rollout order superseded by this task |

## References

[E1]: https://github.com/spore310/AHP/blob/3eeb31eebb0498d4fb1f0a5de60ca3b5677f744e/.agents/AGENTS.md
[E2]: https://github.com/spore310/AHP/blob/3eeb31eebb0498d4fb1f0a5de60ca3b5677f744e/docs/CodingRules.md
[E3]: https://github.com/spore310/AHP/blob/3eeb31eebb0498d4fb1f0a5de60ca3b5677f744e/src/sessions/helpers/factory/helpers.ts
[E4]: https://github.com/spore310/AHP/blob/3eeb31eebb0498d4fb1f0a5de60ca3b5677f744e/src/sessions/helpers/configuration/helpers.ts
[E5]: https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-session/state.ts
[E6]: https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-session/commands.ts
[E7]: https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/reconciliation.md
[E8]: https://github.com/spore310/AHP/blob/3eeb31eebb0498d4fb1f0a5de60ca3b5677f744e/src/websocket/helpers/ahp/helpers.ts
[E9]: https://github.com/spore310/AHP/blob/3eeb31eebb0498d4fb1f0a5de60ca3b5677f744e/package.json
[E10]: https://ajv.js.org/options.html
[E11]: https://ajv.js.org/strict-mode.html
[E12]: https://ajv.js.org/security.html
[E13]: https://github.com/spore310/AHP/blob/3eeb31eebb0498d4fb1f0a5de60ca3b5677f744e/.agents/skills/architecture-aware-delivery/references/delegation.md

Primary protocol companion references:

- Pinned notification rules: https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/overview.md
- Pinned creation contract: https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-session/commands.ts
- Pinned action envelope: https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/common/actions.ts
- JSON Schema object reference: https://json-schema.org/understanding-json-schema/reference/object

## Verification performed for this handoff

Source inspection and document construction only **at the time this evidence was
captured**. Static delivery checks covered file presence, Markdown structure,
JSON examples, requirement/test/work-packet identifiers, links inside the
bundle, and archive integrity. No implementation had been applied to GitHub.
No Grok, Luna, Haiku, Codex, Pi, or independent reviewer run was launched for
this plan. No repo `pnpm validate`, schema deployment, application integration
test, or live double-blind experiment had been performed for this plan.
Implementation and test evidence were produced later; see
[CURRENT_STATE.md](CURRENT_STATE.md).

Any source-level planning review in this handoff is the author's own review. The supplied independent-review process still needs to run in the local harness and must report its actual isolation and test evidence.
