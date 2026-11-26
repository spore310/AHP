# Kubernetes example

These manifests run the multi-host topologies on Kubernetes, and a driver
checks them through real pods. They are examples, not a supported chart.
Nothing in the SDK calls the Kubernetes API.

## Files

| File | What it creates |
| --- | --- |
| [`namespace.yaml`](namespace.yaml) | The Kubernetes Namespace `ahp-example`. |
| [`postgres.yaml`](postgres.yaml) | A throwaway PostgreSQL and its connection Secret. |
| [`setup.yaml`](setup.yaml) | A Job that applies the migrations to one schema per SDK namespace. |
| [`single.yaml`](single.yaml) | Scenario A: one host, one derived namespace. |
| [`replicated.yaml`](replicated.yaml) | Scenario B: two replicas of one host name. One is active, one is a standby. |
| [`distributed.yaml`](distributed.yaml) | Scenario D: a StatefulSet of three hosts active in one shared namespace. |
| [`acceptance.ts`](acceptance.ts) | Applies everything, creates the membership Secrets, and runs ten checks. |

Scenario C, independent namespaces, is the single or replicated manifest
applied once per SDK namespace with a different `AHP_NAMESPACE_ID`.

## How SDK settings map onto Kubernetes

| Kubernetes input | SDK meaning |
| --- | --- |
| StatefulSet pod name | `topology.hostId`. Stable when the pod is replaced. |
| Deployment replicas with one fixed name | Replicas of one `hostId` in `replicated` mode. |
| Pod UID | `topology.instanceId`. New for every pod. Never a credential. |
| Secret `<name>-policy` | The membership policy, the same for every member. |
| Secret `<name>-credentials`, one key per host | Host credentials. Each pod mounts only its own key. |
| Headless Service DNS name of a pod | The internal endpoint listed for that host in the policy. |
| `startupProbe`, `livenessProbe`, `readinessProbe` | `/startupz`, `/livez`, `/readyz`. |
| `terminationGracePeriodSeconds` | Covers `drain()` plus the transport shutdown timeout. |
| `AHP_NAMESPACE_ID` | The SDK namespace. Independent of the Kubernetes Namespace. |

## Run it

You need `kubectl`, a cluster, and the example image in that cluster. With
minikube:

```sh
docker compose -f examples/host/docker-compose.yaml build tools-a
minikube image load ahp-multi-host-example:local postgres:17.12-bookworm
pnpm exec vite-node examples/host/kubernetes/acceptance.ts
```

The driver uses the current `kubectl` context. Set `AHP_KUBE_CONTEXT` to
choose another. It deletes the `ahp-example` Namespace when it finishes. Pass
`--keep` to leave everything running, and run it again to repeat the checks
against the same pods. `--json <file>` writes the results.

| Check | What it proves |
| --- | --- |
| K1 | The API server accepts every manifest in a server-side dry run with strict schema validation: unknown or duplicate fields are rejected. |
| K2 | Three hosts become ready. Each pod name is the host identity and each pod UID is the instance identity. |
| K3 | A replicated host has one ready pod and one standby. The standby is alive, started, not ready, not restarting, and absent from the Service. |
| K4 | A client on one pod reaches a session owned by another pod through the headless Service. |
| K5 | The public Service shows one merged catalogue whichever pod answers. |
| K6 | A replaced pod keeps its host name and gets a new instance identity. Its session keeps exactly one owner. |
| K7 | Deleting the active replica makes the standby ready, with the session restored and the ownership epoch advanced. |
| K8 | A rolling restart of every host completes. Each session keeps one owner and its state. |
| K9 | The single-host manifest runs one ready host with its derived namespace. |
| K10 | A rolling update of the replicated host replaces both replicas and ends with one active pod, one standby and the session intact. |

## What to know before adapting these

- To run more than one active host, give each a distinct host name. A
  StatefulSet in `distributed` mode does that. Raising `replicas` on a
  Deployment gives replicas of one name, which are active-passive.
- A standby is never ready. Kubernetes therefore reports a `replicated`
  Deployment as one available replica of two, permanently. `kubectl rollout
  status`, Helm `--wait` and similar checks do not complete for it, and after
  `progressDeadlineSeconds` the Deployment shows `ProgressDeadlineExceeded`.
  The workload is healthy in that state. Judge it by "exactly one ready pod",
  as check K10 does.
- The `replicated` Deployment needs `maxUnavailable: 100%`. With a smaller
  value Kubernetes waits for a new pod to become ready before it removes the
  old active pod, and no new pod can become ready while the old one is active.
  An update then never finishes.
- With that setting Kubernetes replaces both pods without waiting for
  readiness. Expect a few seconds with no ready pod during an update, until a
  new pod has started and taken over.
- Pods that are still terminating are instances of the host too. Set
  `maxInstances` in the policy to at least replicas, plus surge, plus the pods
  that may still be terminating. The example uses five. An instance beyond the
  limit is refused, exits, and is restarted by Kubernetes until one leaves.
- `single` mode has no standby. Keep one replica and `strategy: Recreate`.
- The internal Service sets `publishNotReadyAddresses`. The coordination
  store decides which member may be dialled, not Kubernetes readiness.
- The internal port must not be reachable by clients. Do not add it to an
  Ingress or a public Service. Add a NetworkPolicy if your cluster enforces
  them.
- The example uses `ws:` between pods. For TLS, list `wss:` endpoints in the
  policy and set `requireTls`, `routing.tls` and `routing.clientTls` as the
  [guide](../../../docs/guides/multi-host.md#tls-between-hosts) describes.
  The example host program does not read certificates from the environment.
- All host credentials are keys of one Secret here, and `subPathExpr` mounts
  one key per pod. The kubelet can read the whole Secret. Use one Secret per
  host or a secrets driver if that matters to you.
- The membership Secrets are created once. Creating them again with new keys
  makes a second, conflicting policy at the same revision, and hosts refuse
  it. Change membership by publishing a higher revision.
- The control port (`AHP_CONTROL_PORT`) is example scaffolding for the
  driver. It is bound to the pod's loopback. Remove it in a real deployment.
- PostgreSQL here has no persistent volume. Use your own database.
