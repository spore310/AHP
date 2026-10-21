import { createHash, timingSafeEqual } from "node:crypto";

import type {
  AuthenticatedPrincipal,
  ConnectionAuthenticator,
  TrustedHandshakeContext,
} from "../types";

const AUTHORIZATION_HEADER = "authorization";
const BEARER_CREDENTIAL = /^Bearer\s+(\S+)$/i;

const readAuthorization = (
  headers: TrustedHandshakeContext["headers"],
): string | undefined => {
  let authorization: string | undefined;
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== AUTHORIZATION_HEADER) {
      continue;
    }
    // Ambiguous repeated headers are rejected rather than guessed.
    if (authorization !== undefined || typeof value !== "string") {
      return undefined;
    }
    authorization = value;
  }
  return authorization;
};

const digestToken = (token: string): Buffer =>
  createHash("sha256").update(token, "utf8").digest();

/**
 * Create an authenticator backed by a host-configured bearer-token map.
 *
 * The map key is the exact bearer token and the value is the trusted principal
 * subject. Only the WebSocket upgrade `Authorization` header is read; AHP
 * `initialize.clientId` is never considered. Missing, malformed, or unknown
 * credentials resolve to `undefined`. Tokens are never logged or echoed.
 *
 * Lookup is constant-time per configured token: both sides are reduced to
 * SHA-256 digests compared with `timingSafeEqual`, so handshake cost is one
 * hash plus one digest comparison per token and reveals nothing about shared
 * prefixes or lengths.
 */
export const createStaticTokenAuthenticator = (
  tokens: ReadonlyMap<string, string>,
): ConnectionAuthenticator => {
  const subjectsByToken = new Map(tokens);
  for (const [token, subject] of subjectsByToken) {
    if (token.length === 0 || subject.trim().length === 0) {
      throw new Error("Static token authenticator requires non-empty tokens and subjects");
    }
  }
  const digests = [...subjectsByToken].map(
    ([token, subject]): readonly [Buffer, string] => [digestToken(token), subject],
  );

  return {
    authenticate: (input: TrustedHandshakeContext): Promise<AuthenticatedPrincipal | undefined> => {
      const authorization = readAuthorization(input.headers);
      if (authorization === undefined) {
        return Promise.resolve(undefined);
      }
      const credential = BEARER_CREDENTIAL.exec(authorization.trim());
      const token = credential?.[1];
      if (token === undefined) {
        return Promise.resolve(undefined);
      }
      const presented = digestToken(token);
      let subject: string | undefined;
      for (const [digest, candidateSubject] of digests) {
        if (timingSafeEqual(presented, digest)) {
          subject = candidateSubject;
          break;
        }
      }
      return Promise.resolve(subject === undefined ? undefined : { subject });
    },
  };
};
