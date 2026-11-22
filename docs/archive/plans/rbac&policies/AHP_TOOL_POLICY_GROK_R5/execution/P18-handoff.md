# P18 verified handoff

The consumer examples demonstrate direct policies and included namespaces,
application-defined roles, empty initial grants, separate resource ownership,
and mandatory provider consent. The public namespace loopback verifies both
an assigned call and denial for an unassigned observer. The module, capability,
and wire documentation describes the supported client and host operations.

| Criteria | Executed evidence |
| --- | --- |
| D01 | `applicationPolicyExamples.test.ts` · “direct example admits explicit policy, starts without grants and preserves owner/agent identity” and the corresponding `namespace` case. |
| D01 | `applicationPolicyExamples.test.ts` · “real namespace SDK setup grants a junior agent one assigned call and a mandatory provider can deny it.” |
| D02 | `pnpm docs:check` mapped 217 source files. The full gate also typechecked the examples. |
| D03 | Scoped inspection of application, sessions, tool policy, tool execution, and wire docs against the implemented APIs. The examples use fixture authority and inert artifacts. |

Commands and candidate identity are in the [P19 handoff](P19-handoff.md).
