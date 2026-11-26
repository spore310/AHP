# Overall handoff

## Current status

- **Mode:** preflight completed, then feature execution H0-H9, in one run that
  the user authorized on November 26, 2026.
- **Candidate:** `feature/ahp-v1` at `324fd60634e3d93aa4af59da98263c1cac0deb3b`
  plus five local commits, made at the user's request after every gate had
  passed on the same files. Nothing was pushed or merged.
- **Result:** scenarios A, B, C and D work. They were proven live with
  independent processes, PostgreSQL and a load balancer under Docker Compose,
  and with real pods on Kubernetes.
- **Acceptance:** every criterion is `PASS`: 12 of 12 preflight and 95 of 95
  feature criteria. See [ACCEPTANCE.md](ACCEPTANCE.md). Limitations that a
  reader should know are recorded on the criterion and listed below.
- **Review:** three independent reviews. The last one was done after the
  final fix and ended with the verdict PASS on the same tree the final gates
  ran on. See [the H9 handoff](handoffs/H9.md).
- **Decisions:** D01-D08 are Established. See [DECISIONS.md](DECISIONS.md).
- **Previous plan:** P0-P5 verified and archived under
  `docs/archive/plans/ahp-v1/`. The providers plan stays active.

## What exists now

| Area | Where |
| --- | --- |
| Composed host, topology, namespaces, admission, routing, probes | [`src/host`](../../../../src/host/README.md) |
| Membership, per-session ownership, revocation, events (PostgreSQL and memory) | [`src/persistence`](../../../../src/persistence/helpers/adapters/postgres/README.md) |
| Migration | `database/migrations/0005_host_coordination.sql` |
| User guide | [`docs/guides/multi-host.md`](../../../guides/multi-host.md) |
| Runnable topologies | `examples/host-single.ts`, `host-replicated.ts`, `host-partitioned.ts`, `host-distributed.ts` |
| Live multi-process stack and driver | `examples/host/docker-compose.yaml`, `examples/host/acceptance.ts` |
| Kubernetes manifests and driver | [`examples/host/kubernetes/`](../../../../examples/host/kubernetes/README.md) |
| Tests | `src/tests/host/`, `src/tests/persistence/conformance/hostCoordination.ts`, `src/tests/persistence/adapters/postgres/hostCoordination.ts` |

## How to verify

```sh
pnpm validate
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/Invoke-LocalPostgres.ps1

docker compose -f examples/host/docker-compose.yaml up --build -d
pnpm exec vite-node examples/host/acceptance.ts
docker compose -f examples/host/docker-compose.yaml down -v

minikube image load ahp-multi-host-example:local postgres:17.12-bookworm
pnpm exec vite-node examples/host/kubernetes/acceptance.ts
```

The local PostgreSQL runner applies only git-tracked migrations.
`0005_host_coordination.sql` is now committed.

## Defects found by the proofs added last

Each was found by a new executed proof and fixed in the same run.

| Defect | Found by | Fix |
| --- | --- | --- |
| Adoption and namespace revocation could deadlock in PostgreSQL | Contention probe (H2-10) | Adoption tests the previous owner's lease without waiting, then locks rows in the one documented order |
| A transfer arriving while a retirement committed tore down handles the retirement needed; the retirement finished through recovery but its caller got an error | Retirement, transfer and settlement race (H7-08) | Retirement and relocation exclude each other in the session lifecycle |
| The in-memory store kept its work page index per host, so a moved session's work view was empty | Client lifetime test (H8-10) | One index per store |
| The retained PostgreSQL ownership connection relied on the driver's implicit statement queue, which is deprecated | Conformance output | Statements on that connection are queued explicitly, in the same order |
| An ingress could answer a subscription whose owner link had already closed | Dropped-hint revocation test | The ingress ends the connection instead |
| The namespace guard could be bypassed or misdirected (search path, truncate, insert), and reconciliation could restore a session retired or moved in the meantime | Second review | Guards hardened and probed; each session is read again before it is restored |
| The replicated Kubernetes Deployment could not complete a rolling update | Second review | `maxUnavailable: 100%`, and a live check that performs the update |
| A partly failed reconciliation did not announce what it restored; a failed transfer with a failed restoration was not retried; an interrupted restoration left a record that later passes skipped | Third review | All fixed and tested |

## Known limits

None of these is a failed criterion. Each is stated on its criterion or in
the guide.

1. **The live examples use `ws:` between hosts.** TLS between hosts is
   proven by in-process hosts with real TLS sockets, not by the Compose or
   Kubernetes examples.
2. **Kubernetes was exercised on one local single-node cluster.** No Ingress,
   NetworkPolicy or cloud load balancer was used.
3. **Provider relocation is the application's responsibility.** A provider
   that cannot restore a session on another host leaves it suspended after a
   transfer or adoption. A provider that ignores `operationId` can create a
   duplicate external resource after a crash.
4. **An ordering confirmation can be delayed by a slow owner.** It queues
   behind that owner's in-flight relayed request and its write queue. After
   10 seconds the affected connection is closed and the caller reconnects.
5. **Work requests that name only a non-session resource are not routed.**
   They must be sent to the owning host or name the session.
6. **A tool execution whose executor disconnected stays counted on its owner
   until that host stops.** This is the documented single-host contract and
   is unchanged.
7. **Outside distributed mode a catalogue cursor is a plain offset.** It
   carries no data, so presenting it to another namespace pages that
   namespace's own catalogue.

## Design limits to keep in mind

- Members of a namespace are trusted parts of one deployment and share a
  store. A compromised member is out of scope.
- Hosts that share a name are active-passive, in every mode. Scale out with
  distinct host names.
- A frozen owner keeps its database session, so no takeover happens until it
  resumes or its connection closes. It stops itself on resume.
- Sessions are never rebalanced automatically.
- There is no down migration for 0005.

## Next safe action

Review the five local commits and push or open a pull request when ready.
They are: archive of the previous plan; coordination and migration 0005;
host admission and routing between hosts; host extraction and composition;
examples, tests and documentation. The gates were run on the final tree, not
on each commit separately.

## Resume rules

[ACCEPTANCE.md](ACCEPTANCE.md) is the status index. The handoffs carry the
evidence. After any change to the candidate, rerun the affected checks and
the gates above before relying on a recorded result.
