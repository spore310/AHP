# Test execution runbook

## 1. Toolchain and permissions

Use the repository manifest/lockfile. At the pinned base, package.json pins
Node 24.x and pnpm 10.34.6; the exact existing versions remain authoritative.
Do not upgrade libraries or install a new harness to fix a failing test.

Allowed tests here are local unit tests, fake-adapter conformance and loopback
WebSocket tests with the installed Microsoft SDK. No production DB, identity
provider, artifact host, shell agent, real terminal or deployment is required.
An ambient connection string or token is not permission to use it. Keep original
real-PostgreSQL acceptance blocked unless separately authorized.

## 2. Efficient iteration

During a packet, run only its focused suite and typecheck while fixing failures.
Map new source files to README immediately so docs:check does not accumulate debt.
Run the repository's required final gate before declaring a completed change ready:

```sh
pnpm validate
```

At this base it runs lint, typecheck, Vitest, documentation mapping and production
build. Record the real exit status. Do not claim that all future tests exist before
the owning packets implement them. Never add pass-with-no-tests or skip a security
case to make an intermediate gate green.

Use one writer. Stop after two repairs of the same failing criterion without new
evidence: record exact output, smallest reproducer and likely owning boundary.
A short handoff is cheaper and safer than repeatedly rewriting the architecture.

## 3. Shared fixture strategy

Put test support under src/tests/, not production modules. Build these reusable,
small fixtures rather than copying a full server setup into every test:

| Fixture | What it must model |
| --- | --- |
| Trusted identity source | Distinct users/agents/domains and controlled auth revision; cannot be set by wire params. |
| Binding store | Exact scoped grant IDs, revisions, lineage, expiry and revoke events. |
| Resource resolver | Incarnation and trusted relationships for session/chat/terminal/workspace fixtures. |
| Policy resolver | Explicit allow/deny/reveal/challenge outcomes plus a controllable await barrier. |
| Transport recorder | Raw per-connection outbound frames before client decoding, including snapshots/errors. |
| Deferred operation | Deterministically park a particular stage; expose resolve/reject controls. |
| Clock | Injected now/deadline control; fake timers where compatible with Vitest and WebSocket setup. |
| Executor | Counter for invocation, preparation, cleanup and projection; class-based per-call state. |
| Challenge provider | begin/verify/cancel behavior; invalid, expired, duplicate and delayed proofs. |
| Artifact source | Bounded inert bytes and a fixed test handler; never network download/eval. |

Keep actor grants independent of the policy that is under test. A fake `authorize`
that always returns allow cannot prove default denial or resource constraints.
Use exact assertion counts for side-effect callbacks on negative paths.

## 4. Raw-wire canary technique

Define a test-only tool schema/description with a unique sentinel such as
`HIDDEN_SCHEMA_SENTINEL_FOR_PM`. Give it only to the senior's authorized assignment.
Capture every raw frame delivered to PM and junior connections during initialization,
subscribe, list, advertisement, invocation errors, buffered events and revocation.
Assert the sentinel never appears for those recipients. Also assert the intended
public descriptor is present, so a test that sends nothing at all cannot pass.

Verify raw JSON frames, not just the rendered client menu. Correct discovery output
cannot compensate for a full manifest leaked in an earlier snapshot.

## 5. Deterministic race tests

Do not use arbitrary sleep to hope a race occurs. Place an await barrier in the
exact test adapter, wait until it is reached, change authoritative state, then
release the barrier. Required interleavings include:

1. Identity resolution pending -> initialize requests protected subscription.
2. Invocation/advertisement authorization pending -> grant revoked or executor
   connection replaced -> attempted dispatch/commit.
3. New session attached -> backend startup pending -> session disposed/recreated
   at the same URI -> old startup/cleanup callback completes.
4. Event buffered for a permitted recipient -> scope/grant revoked -> queue flush.
5. Challenge verification pending -> input-bound resource/grant/instance changed.
6. Two valid resumes for one continuation -> one local execution admission.
7. Preparation allocates A -> allocates B -> fails -> cleanup B and A both attempted.
8. Execution ignores AbortSignal -> client timeout -> resources remain owned until
   actual settlement; new work cannot bypass capacity by causing timeouts.

For external policy sources, tests exercise the documented revision/expiry contract.
They do not prove instantaneous distributed revocation or a cross-service transaction.

## 6. SDK conformance, not just JSON equality

Use the installed @microsoft/agent-host-protocol client/reducers with real loopback
connections for P10–P12. Feed each client's projected snapshot and permitted events
through the actual reducer and compare with that client's expected next view.

Test both the advertising client (private exact accepted-descriptor response) and
an observer (no hidden tool list in native events). Preserve native serverSeq and
use a separately named viewRevision for private assignment changes. Test invalidation,
resubscription and denied legacy clients, not only initial happy-path connection.

## 7. Failure injection and outcome assertions

For each injected failure, assert response category, zero unauthorized effects,
cleanup ownership, registry/view state and safe outbound data. Include failed
initial auth, missing required provider, custom validation throw, normalized path
change, preparation failure, output schema failure, duplicate completion, cleanup
failure, stale status access and expired continuation.

A successful tool side effect followed by projection or cleanup failure must not be
reported as permission to retry. Distinguish execution result from delivery/projection
outcome. No automatic rerun is authorized by an ambiguous connection failure.

## 8. Evidence record

Each packet handoff names source HEAD plus patch/worktree identity, command, working
directory, relevant toolchain, exit code and concise sanitized result. Record tests
passed/failed/skipped and acceptance IDs covered. Avoid secrets and full payloads.
A final HEAD alone is insufficient when relevant files are uncommitted.

Source checks, typecheck, fake-adapter tests, loopback SDK tests, real external
integration and production behavior are different evidence categories. Only claim
what was actually exercised. Existing persistence test reports remain historical.

## 9. Public execution acceptance additions

Required by the execution goal; these are target checks, not implemented evidence.
P12 owns X05 (a client invokes its own supplied tool) and X06 (client A invokes
distinct client B's supplied tool). P15 owns E05 (client invokes server-provided
tool). P19 must execute all three complete matrices on the final integrated
candidate after every later packet is integrated.

Use real public `createAHPServer`, public tool-client entrypoints and the installed
pinned SDK transport. Trusted fixture registration must name the exact approved
contract/schema/version, implementation identity/revision, execution location,
source path/export and candidate identity. Authenticate actual caller and executor
and record their connection generations separately. Install separate invoke and
execute/receive permissions, full resource incarnation and origin/target route.
Namespace membership remains only an admission ceiling.

Each positive must observe the distinctive intended handler and schema-validated
result, with zero competing-handler calls. For cross-client execution use distinct
A and B connections; sharing one fixture object or relabeling a caller is not proof.
The server route must prove that no client implementation was selected. Self-tool
execution must still pass independent caller and executor gates.

For each route exercise missing/invalid authentication, missing caller grant,
missing executor/receive grant, contract/schema/revision substitution,
implementation/source/revision/location substitution, wrong resource incarnation
or origin/target route, provider denial or missing mandatory constraint, unsatisfied
challenge, revocation during an awaited decision, and stale connection generation.
Assert zero forbidden dispatch/handler effects. Resume challenges only when the
owning packet has implemented the exact continuation contract; challenge is not
permission to execute early or silently substitute another handler.

Capture recipient-specific raw frames with distinct canaries for arguments,
results, descriptors, schemas and private metadata. Include an authorized positive
recipient and an unauthorized observer. Use explicit reached/release barriers and
causal RPC/close acknowledgements before asserting absence; no timing sleeps.
Inspect initialize, snapshot/action, advertisement, error, buffer, private invoke,
completion/status and revocation paths applicable to the route. Preserve reducer,
sequencing, cleanup/draining, compatibility and owner/lease assertions.

Source binding proves the trusted registration and the exact fixture handler
observed in this test. It is not remote code attestation, and a client-reported hash
cannot establish what an arbitrary remote process ran. Preserve EXECUTION E6/E8
and F03's existing proof boundary; no attestation mechanism or dependency is added.
