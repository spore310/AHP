import WebSocket from "ws";
import { describe, expect, it } from "vitest";
import { HOST_PROTOCOL_VERSION, bindDigest, createHostAdmission, generateHostCredential } from "@host";
import { parseUnknownJson } from "@jsonrpc";
import { createExampleNode, sessionUri } from "../../../examples/host/support";
import { createCluster, eventually, onCleanup, type Cluster } from "./cluster";

const PROOF = "x-ahp-host-proof";
const FORWARDED = "x-ahp-host-forwarded";
const forwardedFor = (subject: string, extra: Record<string, unknown> = {}): string =>
  Buffer.from(JSON.stringify({ v: 1, hop: 1, headers: { "sec-websocket-protocol": `demo-${subject}` }, ...extra })).toString("base64url");

/** Dials the internal endpoint directly, as a hostile or stale member would. */
function dial(endpoint: string, headers: Record<string, string>): Promise<{ accepted: boolean; code?: number; socket?: WebSocket }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(endpoint, { headers });
    onCleanup(() => {
      socket.terminate();
      return Promise.resolve();
    });
    let settled = false;
    const finish = (result: { accepted: boolean; code?: number; socket?: WebSocket }): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    socket.on("error", () => {
      finish({ accepted: false });
    });
    socket.on("unexpected-response", (_request, response) => {
      finish({ accepted: false, code: response.statusCode ?? 0 });
    });
    socket.on("close", (code) => {
      finish({ accepted: false, code });
    });
    socket.on("open", () => {
      // An accepted relay answers initialize. A refused one is closed by the server instead.
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { channel: "ahp-root://", clientId: "probe", protocolVersions: ["1.0.0"] } }));
    });
    socket.on("message", () => {
      finish({ accepted: true, socket });
    });
  });
}
const frameToText = (data: WebSocket.RawData): string => {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return data.toString("utf8");
};
const rpc = (socket: WebSocket, id: number, method: string, params: unknown): Promise<{ result?: unknown; error?: { code: number; message: string } }> => new Promise((resolve) => {
  const listen = (data: WebSocket.RawData): void => {
    const frame = parseUnknownJson(frameToText(data)) as { id?: number; result?: unknown; error?: { code: number; message: string } };
    if (frame.id !== id) return;
    socket.off("message", listen);
    resolve(frame);
  };
  socket.on("message", listen);
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
});

function memberB(cluster: Cluster) {
  const credential = cluster.membership.credentials.get("review-b");
  if (!credential) throw new Error("fixture");
  const admission = createHostAdmission({ hostId: "review-b", policy: cluster.membership.policy, credential });
  const status = cluster.node("review-b").host.status();
  const sign = (forwarded: string, overrides: Partial<{ audience: string; generation: string; instanceId: string }> = {}): string => admission.sign({
    instanceId: overrides.instanceId ?? status.instanceId ?? "", generation: overrides.generation ?? status.generation ?? "",
    audience: overrides.audience ?? "review-a", purpose: "relay", bind: bindDigest(forwarded) });
  return { admission, sign, credential };
}

describe("internal host endpoint", () => {
  it("H5-02 H5-03 H1-05 H1-07 admits only a current member relaying a caller the owner authenticates itself", async () => {
    const cluster = await createCluster(["review-a", "review-b"]);
    const endpoint = cluster.endpoints.get("review-a") ?? "";
    const { sign } = memberB(cluster);
    const senior = forwardedFor("senior");
    const refused = async (headers: Record<string, string>): Promise<void> => {
      const outcome = await dial(endpoint, headers);
      expect(outcome.accepted).toBe(false);
    };
    // No host proof, and a proof with no forwarded caller.
    await refused({});
    await refused({ [PROOF]: sign(senior) });
    await refused({ [FORWARDED]: senior });
    // Addressed to a different member, or naming another namespace member as the sender.
    await refused({ [PROOF]: sign(senior, { audience: "review-b" }), [FORWARDED]: senior });
    const [payload = "", signature = ""] = sign(senior).split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as object, hostId: "review-a" })).toString("base64url");
    await refused({ [PROOF]: `${forged}.${signature}`, [FORWARDED]: senior });
    // A self-issued key that trusted policy does not list.
    const outsider = generateHostCredential("review-b-key-1");
    const selfIssued = createHostAdmission({ hostId: "review-b", credential: outsider.credential,
      policy: { ...cluster.membership.policy, members: cluster.membership.policy.members.map((member) => member.hostId === "review-b" ? { ...member, credentials: [outsider.verifier] } : member) } });
    const status = cluster.node("review-b").host.status();
    await refused({ [FORWARDED]: senior, [PROOF]: selfIssued.sign({ instanceId: status.instanceId ?? "", generation: status.generation ?? "", audience: "review-a", purpose: "relay", bind: bindDigest(senior) }) });
    // A valid signature from an instance generation that is not the current member.
    await refused({ [PROOF]: sign(senior, { generation: "999999" }), [FORWARDED]: senior });
    await refused({ [PROOF]: sign(senior, { instanceId: "replaced-pod" }), [FORWARDED]: senior });
    // The proof binds the forwarded content: swapping the caller invalidates it.
    await refused({ [PROOF]: sign(forwardedFor("observer")), [FORWARDED]: senior });
    // A valid host cannot mint a caller: the owner's own authenticator rejects the forwarded credential.
    const nobody = forwardedFor("nobody");
    await refused({ [PROOF]: sign(nobody), [FORWARDED]: nobody });
    // A relayed connection cannot be relayed again.
    const twoHops = forwardedFor("senior", { hop: 2 });
    await refused({ [PROOF]: sign(twoHops), [FORWARDED]: twoHops });
    expect(cluster.node("review-a").host.sessions.listSessionSnapshots()).toHaveLength(0);

    // The legitimate relay is admitted, exactly once per proof.
    const observer = forwardedFor("observer");
    const proof = sign(observer);
    const admitted = await dial(endpoint, { [PROOF]: proof, [FORWARDED]: observer });
    expect(admitted.accepted).toBe(true);
    await refused({ [PROOF]: proof, [FORWARDED]: observer });
    // Authority is the forwarded caller's own, never the relaying host's: an observer cannot create a session.
    const socket = admitted.socket;
    if (!socket) throw new Error("no socket");
    const created = await rpc(socket, 2, "createSession", { channel: sessionUri("forged") });
    expect(created.error).toBeDefined();
    expect(cluster.node("review-a").host.sessions.getSessionSnapshot(sessionUri("forged"))).toBeUndefined();
    expect((await rpc(socket, 3, "x-ahp-host/sync", { version: 1 })).result).toEqual({ version: HOST_PROTOCOL_VERSION });
    // No agent presence can be attached for a caller the owner did not authenticate as that agent.
    expect((await rpc(socket, 4, "x-ahp-host/agents/attach", { version: 1, agentKey: "review-worker-v1", executionEpoch: "1" })).error).toBeDefined();
  });

  it("H1-06 H5-09 refuses a revoked or unlisted member and never dials an untrusted endpoint", async () => {
    const cluster = await createCluster(["review-a", "review-b"]);
    const alpha = sessionUri("alpha");
    const onA = await cluster.peer("review-a", "senior");
    await onA.call("createSession", { channel: alpha });
    // An endpoint that trusted policy does not list for this host is rejected before any traffic.
    expect(() => createExampleNode({ hostId: "review-b", mode: "distributed", namespaceId: cluster.membership.policy.namespaceId, membership: cluster.membership,
      storage: cluster.storage, persistence: cluster.persistence, routing: { host: "127.0.0.1", port: 0, endpoint: "ws://attacker.invalid:9/" } })).toThrow(/not listed/);
    // review-b restarts with a credential that policy no longer accepts: it cannot even start.
    await cluster.node("review-b").stop();
    const revoked = { ...cluster.membership, policy: { ...cluster.membership.policy, revokedCredentialIds: ["review-b-key-1"] } };
    expect(() => createExampleNode({ hostId: "review-b", mode: "distributed", namespaceId: revoked.policy.namespaceId, membership: revoked,
      storage: cluster.storage, persistence: cluster.persistence, routing: { host: "127.0.0.1", port: 0, endpoint: cluster.endpoints.get("review-b") ?? "" } })).toThrow();
    // The old instance's still-valid signature is refused once its membership is gone.
    const { sign } = memberB(cluster);
    const senior = forwardedFor("senior");
    await eventually(async () => (await cluster.node("review-a").host.members()).length === 1 ? true : undefined, "membership released");
    expect((await dial(cluster.endpoints.get("review-a") ?? "", { [PROOF]: sign(senior), [FORWARDED]: senior })).accepted).toBe(false);
    expect(cluster.node("review-a").host.sessions.getSessionSnapshot(alpha)?.state.lifecycle).toBe("ready");
  });

  it("H5-05 H5-07 reports an unknown outcome and releases every routing resource when an owner disappears", async () => {
    const cluster = await createCluster(["review-a", "review-b"], { routing: undefined }, false);
    const [a, b] = ["review-a", "review-b"];
    for (const hostId of [a, b]) {
      await cluster.start(hostId, { routing: { host: "127.0.0.1", port: Number(new URL(cluster.endpoints.get(hostId) ?? "").port), endpoint: cluster.endpoints.get(hostId) ?? "",
        requestTimeoutMs: 400, orderTimeoutMs: 300 } });
    }
    const alpha = sessionUri("alpha");
    const onA = await cluster.peer("review-a", "senior");
    await onA.call("createSession", { channel: alpha });
    const onB = await cluster.peer("review-b", "senior");
    await onB.call("subscribe", { channel: alpha });
    expect(cluster.node("review-b").host.routingStats()).toMatchObject({ connections: 1, links: 1 });
    // The owner stops while this caller holds a routed subscription.
    await cluster.node("review-a").stop();
    // The ingress ends the affected public connection: the caller reconnects and reconciles from snapshots.
    await eventually(() => onB.closed ? true : undefined, "routed connection closed");
    await eventually(() => {
      const stats = cluster.node("review-b").host.routingStats();
      return stats.connections === 0 && stats.links === 0 && stats.pending === 0 && stats.held === 0 ? true : undefined;
    }, "routing resources released");
    // With no live owner the request fails closed. It is not answered from another host's stale view.
    const retry = await cluster.peer("review-b", "senior", "retry");
    const reply = await retry.request("subscribe", { channel: alpha });
    expect(reply.error).toBeDefined();
    expect(cluster.node("review-b").host.sessions.getSessionSnapshot(alpha)).toBeUndefined();
    await cluster.node("review-b").stop();
    expect(cluster.node("review-b").host.routingStats()).toEqual({ connections: 0, links: 0, pending: 0, held: 0 });
  });
});
