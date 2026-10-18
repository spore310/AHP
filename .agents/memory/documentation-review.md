# Documentation Review Preference

This agent-owned project memory controls only the consolidated documentation-update question shown after confirmed drift is reported during an explicit code review.

```text
documentationReviewPrompt = enabled
```

Allowed durable values:

- `enabled`
- `disabled_for_project`

Session-only suppression must remain in the active conversation as `disabled_for_session` and must never be written here.

Prompt suppression does not suppress documentation-drift evidence, security findings, or production-readiness findings.
