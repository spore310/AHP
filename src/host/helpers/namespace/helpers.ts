import { HOST_NAMESPACE_SCHEME, HOST_SLUG_MAX_LENGTH } from "../../constants";

/**
 * Lowercase ASCII letters, digits and inner hyphens. Validation never rewrites
 * its input: a value that is not already canonical is rejected, so two
 * distinct strings can never collapse into one durable identity.
 */
const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

export const isHostSlug = (value: unknown): value is string =>
  typeof value === "string" && value.length <= HOST_SLUG_MAX_LENGTH && SLUG.test(value);

export interface HostNamespaceParts {
  /** Application segment. Defaults to the logical host name. */
  readonly application: string;
  readonly name: string;
}

/** Formats the one canonical namespace identifier. Both segments must already be valid slugs. */
export const formatNamespaceId = (application: string, name: string): string => {
  if (!isHostSlug(application) || !isHostSlug(name)) throw new TypeError("Invalid host namespace segment.");
  return `${HOST_NAMESPACE_SCHEME}${application}/${name}`;
};

/** Parses a canonical identifier exactly. No trimming, case folding, Unicode or percent decoding. */
export const parseNamespaceId = (namespaceId: unknown): HostNamespaceParts => {
  if (typeof namespaceId !== "string" || !namespaceId.startsWith(HOST_NAMESPACE_SCHEME)) throw new TypeError("Invalid host namespace identifier.");
  const segments = namespaceId.slice(HOST_NAMESPACE_SCHEME.length).split("/");
  const [application, name] = segments;
  if (segments.length !== 2 || !isHostSlug(application) || !isHostSlug(name)) throw new TypeError("Invalid host namespace identifier.");
  return { application, name };
};

/**
 * Resolves the configured namespace once, at configuration capture.
 *
 * - `namespaceId` is an explicit canonical identifier and is used verbatim, so
 *   different logical hosts can name the same shared namespace.
 * - `namespace` is a short name expanded under this host's own name.
 * - Neither yields the deterministic default `<hostId>/default`.
 *
 * Supplying both is rejected: a short alias and a canonical identifier are
 * never two competing spellings of one configuration.
 */
export const resolveNamespaceId = (input: { readonly hostId: string; readonly namespace?: string; readonly namespaceId?: string }): string => {
  // Only an absent field selects a default. Any other non-string value is a configuration error.
  if ((input.namespace !== undefined && typeof input.namespace !== "string") || (input.namespaceId !== undefined && typeof input.namespaceId !== "string")) {
    throw new TypeError("Invalid host namespace configuration.");
  }
  if (input.namespace !== undefined && input.namespaceId !== undefined) throw new TypeError("Configure either a namespace name or a canonical namespace identifier.");
  if (input.namespaceId !== undefined) {
    const { application, name } = parseNamespaceId(input.namespaceId);
    return formatNamespaceId(application, name);
  }
  // An existing opaque durable host identifier is never slugified into a namespace.
  if (!isHostSlug(input.hostId)) throw new TypeError("A host name that is not a slug requires an explicit canonical namespace identifier.");
  return formatNamespaceId(input.hostId, input.namespace === undefined ? "default" : input.namespace);
};

/**
 * Derives the PostgreSQL schema that holds a namespace's logical store.
 * The mapping is injective for valid identifiers: `-` and `/` are the only
 * characters outside the schema alphabet and map to distinct sequences.
 */
export const namespaceSchemaName = (namespaceId: string): string => {
  const { application, name } = parseNamespaceId(namespaceId);
  const schema = `ahp_${application.replaceAll("-", "_h")}__${name.replaceAll("-", "_h")}`;
  if (schema.length > 63) throw new TypeError("The namespace identifier is too long for a derived schema name.");
  return schema;
};
