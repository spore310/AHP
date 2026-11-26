import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

const TAG_INTEGER = 0x02;
const TAG_BIT_STRING = 0x03;
const TAG_OID = 0x06;
const TAG_UTF8_STRING = 0x0c;
const TAG_UTC_TIME = 0x17;
const TAG_SEQUENCE = 0x30;
const TAG_SET = 0x31;
/** ecdsa-with-SHA256, 1.2.840.10045.4.3.2. */
const OID_ECDSA_SHA256 = Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
/** commonName, 2.5.4.3. */
const OID_COMMON_NAME = Buffer.from([0x55, 0x04, 0x03]);
const PEM_LINE = /.{1,64}/gu;

/** DER definite length: one byte below 128, otherwise a count byte followed by big-endian length bytes. */
const derLength = (length: number): Buffer => {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 0x100)) bytes.unshift(rest % 0x100);
  return Buffer.from([0x80 + bytes.length, ...bytes]);
};
const der = (tag: number, ...parts: readonly Buffer[]): Buffer => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
};
const sequence = (...parts: readonly Buffer[]): Buffer => der(TAG_SEQUENCE, ...parts);

/**
 * Creates a throwaway self-signed certificate for a test TLS listener.
 *
 * Nothing is read from disk and no external tool runs: the key is generated
 * here and the X.509 version 1 certificate is encoded by hand. Its only name
 * is the subject common name, so a client must dial that name (`localhost`)
 * and trust this exact certificate as its CA.
 */
export const createSelfSignedCertificate = (commonName = "localhost"): { key: string; cert: string } => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const signatureAlgorithm = sequence(der(TAG_OID, OID_ECDSA_SHA256));
  const name = sequence(der(TAG_SET, sequence(der(TAG_OID, OID_COMMON_NAME), der(TAG_UTF8_STRING, Buffer.from(commonName, "utf8")))));
  // A positive INTEGER in its shortest form: the leading byte is neither zero nor has its high bit set.
  const serial = randomBytes(8);
  serial[0] = ((serial[0] ?? 0) % 0x7f) + 1;
  const validity = sequence(der(TAG_UTC_TIME, Buffer.from("200101000000Z", "ascii")), der(TAG_UTC_TIME, Buffer.from("491231235959Z", "ascii")));
  const tbs = sequence(der(TAG_INTEGER, serial), signatureAlgorithm, name, validity, name, publicKey.export({ type: "spki", format: "der" }));
  // The BIT STRING starts with its count of unused bits, which is zero for a DER-encoded ECDSA signature.
  const certificate = sequence(tbs, signatureAlgorithm, der(TAG_BIT_STRING, Buffer.from([0]), sign("sha256", tbs, privateKey)));
  const lines = certificate.toString("base64").match(PEM_LINE) ?? [];
  const key = privateKey.export({ type: "pkcs8", format: "pem" });
  return {
    key: typeof key === "string" ? key : key.toString("utf8"),
    cert: `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`,
  };
};
