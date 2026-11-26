import { describe, expect, it } from "vitest";
import { bindDigest, createHostAdmission, generateHostCredential } from "@host";

describe("host proof replay protection", () => {
  it("H1-05 refuses new proofs when the replay cache is full instead of forgetting an unexpired one", () => {
    const a = generateHostCredential("a-key");
    const b = generateHostCredential("b-key");
    const policy = { namespaceId: "ahp-namespace:review/shared", revision: 1, members: [{ hostId: "host-a", credentials: [a.verifier] }, { hostId: "host-b", credentials: [b.verifier] }] };
    let now = 1_000_000;
    const clock = (): number => now;
    const sender = createHostAdmission({ hostId: "host-a", policy, credential: a.credential, now: clock });
    const receiver = createHostAdmission({ hostId: "host-b", policy, credential: b.credential, now: clock });
    const bind = bindDigest("content");
    const proof = (): string => sender.sign({ instanceId: "a-1", generation: "1", audience: "host-b", purpose: "relay", bind });
    const accept = (value: string) => receiver.verify(value, { purpose: "relay", bind, operation: "route" });
    const first = proof();
    expect(accept(first)?.hostId).toBe("host-a");
    for (let count = 1; count < 4_096; count += 1) expect(accept(proof())).toBeDefined();
    // The cache is full of unexpired entries: a further proof is refused, and the first is still remembered.
    expect(accept(proof())).toBeUndefined();
    expect(accept(first)).toBeUndefined();
    // Once the earlier entries expire, new proofs are accepted again and the old one is outside its time window.
    now += 61_000;
    expect(accept(proof())?.hostId).toBe("host-a");
    expect(accept(first)).toBeUndefined();
  });
});
