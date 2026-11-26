import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOST_HEALTH_LIVE_PATH, HOST_HEALTH_READY_PATH, HOST_HEALTH_STARTUP_PATH, parseNamespaceId } from "@host";

const directory = new URL("../../../examples/host/", import.meta.url);
const text = (name: string): string => readFileSync(fileURLToPath(new URL(name, directory)), "utf8");
const manifests = readdirSync(fileURLToPath(new URL("kubernetes/", directory))).filter((name) => name.endsWith(".yaml")).sort();
const hostManifests = ["single.yaml", "replicated.yaml", "distributed.yaml"] as const;
const node = text("node.ts");
/** Every `AHP_*` variable the example host program reads. */
const understood = new Set([...node.matchAll(/(?:env|required|integer)\("(AHP_[A-Z_]+)"\)/gu)].map((match) => match[1]));
const all = (source: string, pattern: RegExp): string[] => [...source.matchAll(pattern)].map((match) => match[1] ?? "");

describe("deployment examples", () => {
  it("H9-06 the Kubernetes manifests use the SDK's probe paths, settings the example host reads, and the documented identity mapping", () => {
    expect(manifests).toEqual(["distributed.yaml", "namespace.yaml", "postgres.yaml", "replicated.yaml", "setup.yaml", "single.yaml"]);
    for (const name of hostManifests) {
      const manifest = text(`kubernetes/${name}`);
      // Each probe is wired to the endpoint with that meaning, on the public port.
      expect(all(manifest, /startupProbe:\s+httpGet: \{ path: (\S+), port: ahp \}/gu)).toEqual([HOST_HEALTH_STARTUP_PATH]);
      expect(all(manifest, /livenessProbe:\s+httpGet: \{ path: (\S+), port: ahp \}/gu)).toEqual([HOST_HEALTH_LIVE_PATH]);
      expect(all(manifest, /readinessProbe:\s+httpGet: \{ path: (\S+), port: ahp \}/gu)).toEqual([HOST_HEALTH_READY_PATH]);
      // One failed readiness check removes the pod from its Service: a standby or draining host gets no new connection.
      expect(manifest).toMatch(/readinessProbe:[\s\S]*?failureThreshold: 1\n/u);
      // Every setting is one the host program reads, and each is set once.
      const variables = all(manifest, /name: (AHP_[A-Z_]+)/gu);
      expect(variables.filter((variable) => !understood.has(variable))).toEqual([]);
      expect(new Set(variables).size).toBe(variables.length);
      // The instance identity is the pod UID, never a fixed value shared by replicas.
      expect(manifest).toMatch(/name: AHP_INSTANCE_ID\s+valueFrom: \{ fieldRef: \{ fieldPath: metadata\.uid \} \}/u);
      // The SDK namespace is canonical and configured by the application.
      for (const namespaceId of all(manifest, /name: AHP_NAMESPACE_ID, value: "([^"]+)"/gu)) expect(() => parseNamespaceId(namespaceId)).not.toThrow();
      // The container listens where the probes and the Service look.
      expect(manifest).toContain("{ name: AHP_PUBLIC_PORT, value: \"8080\" }");
      expect(manifest).toContain("{ name: ahp, containerPort: 8080 }");
      // The grace period covers the drain, and the control listener stays on the pod's loopback.
      expect(Number(all(manifest, /terminationGracePeriodSeconds: (\d+)/gu)[0])).toBeGreaterThanOrEqual(30);
      expect(manifest).not.toContain("AHP_CONTROL_HOST");
    }
  });

  it("H9-06 each topology maps onto the workload kind and mode that supports it", () => {
    const single = text("kubernetes/single.yaml");
    const replicated = text("kubernetes/replicated.yaml");
    const distributed = text("kubernetes/distributed.yaml");
    // Single mode has no standby: exactly one replica, replaced rather than surged.
    expect(single).toMatch(/kind: Deployment[\s\S]*replicas: 1\n\s+strategy:\n\s+type: Recreate/u);
    expect(single).toContain("{ name: AHP_HOST_MODE, value: single }");
    // Replicas of one host name are active-passive and need a membership policy with their credential.
    expect(replicated).toMatch(/kind: Deployment[\s\S]*replicas: 2\n/u);
    // A standby is never ready, so the old active pod must be removable before any new pod is ready.
    expect(replicated).toContain("rollingUpdate: { maxSurge: 1, maxUnavailable: \"100%\" }");
    expect(replicated).toContain("{ name: AHP_HOST_ID, value: support-app }");
    expect(replicated).toContain("{ name: AHP_HOST_MODE, value: replicated }");
    expect(replicated).toContain("subPath: support-app.json");
    // Several active hosts are distinct host names: a StatefulSet whose pod name is the host name.
    expect(distributed).toMatch(/kind: StatefulSet[\s\S]*serviceName: support-tools-internal\n\s+replicas: 3\n/u);
    expect(distributed).toMatch(/name: AHP_HOST_ID\s+valueFrom: \{ fieldRef: \{ fieldPath: metadata\.name \} \}/u);
    expect(distributed).toContain("{ name: AHP_HOST_MODE, value: distributed }");
    // The internal endpoint is the pod's stable DNS name on the headless Service, and is never the public Service.
    expect(distributed).toContain("value: \"ws://$(AHP_HOST_ID).support-tools-internal:7000/\"");
    expect(distributed).toMatch(/name: support-tools-internal\nspec:[\s\S]*?clusterIP: None[\s\S]*?publishNotReadyAddresses: true[\s\S]*?- \{ name: internal, port: 7000, targetPort: internal \}/u);
    expect(distributed).toMatch(/name: support-tools\nspec:[\s\S]*?- \{ name: ahp, port: 80, targetPort: ahp \}/u);
    // Each pod mounts only its own credential.
    expect(distributed).toContain("subPathExpr: $(AHP_HOST_ID).json");
    // The acceptance driver creates the policy with exactly these host names and endpoints.
    const driver = text("kubernetes/acceptance.ts");
    expect(driver).toContain("const tools = [\"support-tools-0\", \"support-tools-1\", \"support-tools-2\"] as const;");
    expect(driver).toContain("`ws://${hostId}.support-tools-internal:7000/`");
    // The policy admits the replicas, the surge pod and the pods that may still be terminating.
    expect(driver).toContain("{ hostId: \"support-app\", maxInstances: 5 }");
    expect(replicated).toContain("(maxInstances: 5)");
  });

  it("H9-06 the Compose file uses settings the example host reads and checks health through the readiness endpoint", () => {
    const compose = text("docker-compose.yaml");
    const variables = [...new Set(all(compose, /^\s+(AHP_[A-Z_]+):/gmu))];
    expect(variables.length).toBeGreaterThan(10);
    expect(variables.filter((variable) => !understood.has(variable))).toEqual([]);
    expect(text("haproxy.cfg")).toContain(`option httpchk GET ${HOST_HEALTH_READY_PATH}`);
  });
});
