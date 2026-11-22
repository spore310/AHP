import { describe, expect, it } from "vitest";

import { createStaticTokenAuthenticator, type TrustedHandshakeContext } from "@agents";

const tokens = new Map([
  ["alice-token", "alice"],
  ["bob-token", "bob"],
]);

describe("createStaticTokenAuthenticator", () => {
  it("accepts a valid bearer token from the handshake authorization header", async () => {
    const authenticator = createStaticTokenAuthenticator(tokens);
    await expect(authenticator.authenticate({
      headers: { Authorization: "Bearer alice-token" },
      remoteAddress: "127.0.0.1",
    })).resolves.toEqual({ subject: "alice" });

    await expect(authenticator.authenticate({
      headers: { authorization: "bearer bob-token" },
    })).resolves.toEqual({ subject: "bob" });
  });

  it("rejects missing, malformed, unknown, and ambiguous credentials", async () => {
    const authenticator = createStaticTokenAuthenticator(tokens);
    const contexts: TrustedHandshakeContext[] = [
      { headers: {} },
      { headers: { authorization: "Basic alice-token" } },
      { headers: { authorization: "Bearer" } },
      { headers: { authorization: "Bearer unknown-token" } },
      { headers: { authorization: ["Bearer alice-token", "Bearer bob-token"] } },
      {
        headers: {
          Authorization: "Bearer alice-token",
          authorization: "Bearer bob-token",
        },
      },
    ];
    for (const context of contexts) {
      await expect(authenticator.authenticate(context)).resolves.toBeUndefined();
    }
  });

  it("never uses an AHP clientId as a credential", async () => {
    const authenticator = createStaticTokenAuthenticator(tokens);
    await expect(authenticator.authenticate({
      headers: { authorization: "Bearer client-a" },
    })).resolves.toBeUndefined();
  });

  it("distinguishes tokens that are prefixes of one another", async () => {
    const authenticator = createStaticTokenAuthenticator(new Map([
      ["token", "short-owner"],
      ["token-extended", "long-owner"],
    ]));
    await expect(authenticator.authenticate({
      headers: { authorization: "Bearer token" },
    })).resolves.toEqual({ subject: "short-owner" });
    await expect(authenticator.authenticate({
      headers: { authorization: "Bearer token-extended" },
    })).resolves.toEqual({ subject: "long-owner" });
    await expect(authenticator.authenticate({
      headers: { authorization: "Bearer token-extr" },
    })).resolves.toBeUndefined();
  });

  it("rejects an empty token or subject at construction", () => {
    expect(() => createStaticTokenAuthenticator(new Map([["", "alice"]])))
      .toThrow("non-empty tokens and subjects");
    expect(() => createStaticTokenAuthenticator(new Map([["token", " "]])))
      .toThrow("non-empty tokens and subjects");
  });
});
