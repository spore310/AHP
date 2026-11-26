import { describe, expect, it, vi } from "vitest";
import assert from "node:assert/strict";
import {
  captureHostTopology, formatNamespaceId, isHostSlug, namespaceSchemaName, parseNamespaceId, resolveNamespaceId,
  type AHPServerOptions, type HostTopologyMode, type HostTopologyOptions,
} from "@host";
import { createMemoryDurableStorage } from "@persistence";
import { mockProvider } from "@sessions/mock";
import { createExampleMembership } from "../../../examples/host/support";

const hostId = "support-app";
const defaultNamespaceId = "ahp-namespace:support-app/default";

describe("host namespace identifiers", () => {
  it("H1-02 resolves the deterministic default namespace from the host name", () => {
    const first = resolveNamespaceId({ hostId });
    expect(first).toBe(defaultNamespaceId);
    expect(resolveNamespaceId({ hostId })).toBe(first);
    expect(resolveNamespaceId({ hostId })).toBe(first);
  });

  it("H1-02 expands a short namespace name under the host name", () => {
    expect(resolveNamespaceId({ hostId, namespace: "production" })).toBe("ahp-namespace:support-app/production");
    expect(resolveNamespaceId({ hostId, namespace: "production" })).toBe(resolveNamespaceId({ hostId, namespace: "production" }));
    expect(resolveNamespaceId({ hostId, namespace: "default" })).toBe(defaultNamespaceId);
  });

  it("H1-02 uses an explicit namespaceId verbatim so different hosts name one shared namespace", () => {
    const shared = "ahp-namespace:acme/shared";
    const forSupport = resolveNamespaceId({ hostId, namespaceId: shared });
    const forBilling = resolveNamespaceId({ hostId: "billing-app", namespaceId: shared });
    expect(forSupport).toBe(shared);
    expect(forBilling).toBe(shared);
    expect(forSupport).toBe(forBilling);
    // Without the explicit identifier the same two hosts never share a namespace.
    expect(resolveNamespaceId({ hostId })).not.toBe(resolveNamespaceId({ hostId: "billing-app" }));
  });

  it("H1-02 rejects a short namespace name together with a canonical namespaceId", () => {
    expect(() => resolveNamespaceId({ hostId, namespace: "production", namespaceId: "ahp-namespace:support-app/production" })).toThrow(TypeError);
    // Even when both spell the same namespace.
    expect(() => resolveNamespaceId({ hostId, namespace: "default", namespaceId: defaultNamespaceId })).toThrow(TypeError);
  });

  const invalidSegments: readonly (readonly [string, unknown])[] = [
    ["uppercase letters", "Support-App"],
    ["one uppercase letter", "supporT"],
    ["leading whitespace", " support"],
    ["trailing whitespace", "support "],
    ["a leading tab", "\tsupport"],
    ["a trailing newline", "support\n"],
    ["inner whitespace", "support app"],
    // U+FF53 FULLWIDTH LATIN SMALL LETTER S renders like "s".
    ["a full-width look-alike", "ｓupport"],
    // U+0455 CYRILLIC SMALL LETTER DZE renders like "s".
    ["a Cyrillic look-alike", "ѕupport"],
    ["a precomposed accented letter", "suppört"],
    ["a combining mark", "suppört"],
    ["a zero-width space", "sup​port"],
    ["a percent-encoded separator", "support%2Fapp"],
    ["a percent-encoded space", "support%20app"],
    ["no characters", ""],
    ["a leading hyphen", "-support"],
    ["a trailing hyphen", "support-"],
    ["only a hyphen", "-"],
    ["an underscore", "support_app"],
    ["a colon", "support:app"],
    ["a separator", "support/app"],
    ["a dot", "support.app"],
    ["64 characters", "a".repeat(64)],
    ["thousands of characters", "a".repeat(4096)],
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["a boolean", true],
    ["an object", {}],
    ["an array", ["support"]],
    ["a boxed string", Object("support")],
  ];

  it.each(invalidSegments)("H1-04 rejects a segment with %s without normalizing it", (_label, value) => {
    expect(isHostSlug(value)).toBe(false);
    const segment = value as string;
    expect(() => formatNamespaceId(segment, "default")).toThrow(TypeError);
    expect(() => formatNamespaceId(hostId, segment)).toThrow(TypeError);
    expect(() => resolveNamespaceId({ hostId: segment })).toThrow(TypeError);
    expect(() => resolveNamespaceId({ hostId: segment, namespace: "production" })).toThrow(TypeError);
    // An absent namespace name is the default, so only supplied values are checked. A null name has its own test below.
    if (value !== undefined && value !== null) expect(() => resolveNamespaceId({ hostId, namespace: segment })).toThrow(TypeError);
    if (typeof value === "string") {
      expect(() => parseNamespaceId(`ahp-namespace:${value}/default`)).toThrow(TypeError);
      expect(() => parseNamespaceId(`ahp-namespace:${hostId}/${value}`)).toThrow(TypeError);
    }
  });

  it("H1-04 rejects a null namespace name without normalizing it to the default", () => {
    expect(() => resolveNamespaceId({ hostId, namespace: null as unknown as string })).toThrow(TypeError);
  });

  const invalidNamespaceIds: readonly (readonly [string, unknown])[] = [
    ["an empty application segment", "ahp-namespace:/x"],
    ["an empty name segment", "ahp-namespace:a/"],
    ["an empty middle segment", "ahp-namespace:a//b"],
    ["an extra separator", "ahp-namespace:a/b/c"],
    ["a trailing separator", "ahp-namespace:a/b/"],
    ["a leading separator", "ahp-namespace:/a/b"],
    ["no separator", "ahp-namespace:a"],
    ["only the scheme", "ahp-namespace:"],
    ["no scheme", "a/b"],
    ["a foreign scheme", "urn:example:ahp:a:b"],
    ["the session scheme", "ahp-session:a/b"],
    ["an uppercase scheme", "AHP-NAMESPACE:a/b"],
    ["a repeated scheme", "ahp-namespace:ahp-namespace:a/b"],
    ["an uppercase segment", "ahp-namespace:Support-App/default"],
    ["leading whitespace", " ahp-namespace:a/b"],
    ["trailing whitespace", "ahp-namespace:a/b "],
    ["a trailing newline", "ahp-namespace:a/b\n"],
    ["whitespace after the scheme", "ahp-namespace: a/b"],
    ["inner whitespace", "ahp-namespace:a b/c"],
    ["a full-width look-alike", "ahp-namespace:ｓupport/default"],
    ["a precomposed accented letter", "ahp-namespace:suppört/default"],
    ["a percent-encoded separator", "ahp-namespace:a%2Fb"],
    ["a percent-encoded segment", "ahp-namespace:support%2Fapp/default"],
    ["a backslash separator", "ahp-namespace:a\\b"],
    ["a leading hyphen", "ahp-namespace:-a/b"],
    ["a trailing hyphen", "ahp-namespace:a/b-"],
    ["an underscore", "ahp-namespace:a_b/c"],
    ["a colon in a segment", "ahp-namespace:a:b/c"],
    ["an oversized application segment", `ahp-namespace:${"a".repeat(64)}/b`],
    ["an oversized name segment", `ahp-namespace:a/${"b".repeat(64)}`],
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["an object", {}],
    ["an array", ["ahp-namespace:a/b"]],
  ];

  it.each(invalidNamespaceIds)("H1-04 rejects a namespace identifier with %s without normalizing it", (_label, value) => {
    const namespaceId = value as string;
    expect(() => parseNamespaceId(value)).toThrow(TypeError);
    expect(() => namespaceSchemaName(namespaceId)).toThrow(TypeError);
    // An absent identifier selects the default, so only supplied values are checked.
    if (value !== undefined) expect(() => resolveNamespaceId({ hostId, namespaceId })).toThrow(TypeError);
  });

  const slugs = [
    "a", "b", "c", "d", "h", "0", "a0", "ab", "ah", "hb", "a-b", "b-c", "a-h", "h-b", "a-b-c", "a--b", "support", "app", "support-app",
    "default", "production", "a".repeat(63),
  ];

  it("H1-04 accepts canonical slugs up to the length limit", () => {
    for (const slug of slugs) expect(isHostSlug(slug)).toBe(true);
    expect(isHostSlug("a".repeat(63))).toBe(true);
    expect(isHostSlug("a".repeat(64))).toBe(false);
  });

  it("H1-04 never maps two distinct valid inputs to one identifier and round-trips every identifier", () => {
    const pairs = slugs.flatMap((application) => slugs.map((name) => ({ application, name })));
    const identifiers = pairs.map(({ application, name }) => formatNamespaceId(application, name));
    expect(new Set(identifiers).size).toBe(pairs.length);
    for (const { application, name } of pairs) {
      const identifier = formatNamespaceId(application, name);
      expect(identifier).toBe(`ahp-namespace:${application}/${name}`);
      expect(parseNamespaceId(identifier)).toEqual({ application, name });
      expect(resolveNamespaceId({ hostId: application, namespace: name })).toBe(identifier);
      expect(resolveNamespaceId({ hostId: "another-host", namespaceId: identifier })).toBe(identifier);
    }
  });

  it("H1-04 refuses to slugify a legacy opaque host identity and accepts it with an explicit canonical namespaceId", () => {
    const legacy = "Legacy Host #1";
    expect(isHostSlug(legacy)).toBe(false);
    expect(() => resolveNamespaceId({ hostId: legacy })).toThrow(TypeError);
    expect(() => resolveNamespaceId({ hostId: legacy, namespace: "production" })).toThrow(TypeError);
    expect(resolveNamespaceId({ hostId: legacy, namespaceId: "ahp-namespace:legacy-host-1/default" })).toBe("ahp-namespace:legacy-host-1/default");
    expect(resolveNamespaceId({ hostId: legacy, namespaceId: defaultNamespaceId })).toBe(defaultNamespaceId);
  });

  it("H1-04 derives an injective schema name that only uses the schema alphabet", () => {
    const short = slugs.filter((slug) => slug.length <= 16);
    const identifiers = [
      "ahp-namespace:a-b/c", "ahp-namespace:a/b-c", "ahp-namespace:a-b-c/d",
      ...short.flatMap((application) => short.map((name) => formatNamespaceId(application, name))),
    ];
    const distinct = [...new Set(identifiers)];
    const schemas = distinct.map((identifier) => namespaceSchemaName(identifier));
    expect(new Set(schemas).size).toBe(distinct.length);
    for (const [index, schema] of schemas.entries()) {
      expect(schema).toMatch(/^[a-z0-9_]+$/u);
      expect(schema.length).toBeLessThanOrEqual(63);
      expect(namespaceSchemaName(distinct[index] ?? "")).toBe(schema);
    }
    const hyphenPlacements = ["ahp-namespace:a-b/c", "ahp-namespace:a/b-c", "ahp-namespace:a-b-c/d"].map((identifier) => namespaceSchemaName(identifier));
    expect(new Set(hyphenPlacements).size).toBe(3);
    expect(namespaceSchemaName(defaultNamespaceId)).toBe("ahp_support_happ__default");
    // A derived name that PostgreSQL would truncate is refused instead of colliding.
    expect(() => namespaceSchemaName(formatNamespaceId("a".repeat(63), "b"))).toThrow(TypeError);
  });
});

describe("host topology capture", () => {
  const endpoint = "ws://127.0.0.1:7443/";
  const routing = { host: "127.0.0.1", port: 7443, endpoint };
  // captureHostTopology only checks that protected connection setup is present.
  const security = {} as unknown as NonNullable<AHPServerOptions["security"]>;
  const creationSecurity = {} as unknown as NonNullable<AHPServerOptions["sessions"]["creationSecurity"]>;

  const options = (topology?: HostTopologyOptions, sessions: Partial<AHPServerOptions["sessions"]> = {}, extra: Partial<AHPServerOptions> = {}): AHPServerOptions => ({
    host: "127.0.0.1", port: 0, ...extra,
    sessions: { providers: [mockProvider], ...sessions },
    ...(topology === undefined ? {} : { topology }),
  });
  const durable = (durableHostId = hostId): Pick<AHPServerOptions["sessions"], "durability"> => ({ durability: { storage: createMemoryDurableStorage(), hostId: durableHostId } });
  const admissionFor = (namespaceId: string, listedEndpoint?: string): NonNullable<HostTopologyOptions["admission"]> => {
    const membership = createExampleMembership(namespaceId, [{ hostId, ...(listedEndpoint === undefined ? {} : { endpoint: listedEndpoint }) }, { hostId: "billing-app", endpoint: "ws://127.0.0.1:7555/" }]);
    const credential = membership.credentials.get(hostId);
    assert.ok(credential);
    return { policy: membership.policy, credential };
  };
  const replicated = (overrides: Partial<HostTopologyOptions> = {}, sessions: Partial<AHPServerOptions["sessions"]> = durable()): AHPServerOptions =>
    options({ hostId, mode: "replicated", admission: admissionFor(defaultNamespaceId), ...overrides }, sessions);
  const partitioned = (overrides: Partial<HostTopologyOptions> = {}, sessions: Partial<AHPServerOptions["sessions"]> = durable()): AHPServerOptions =>
    options({ hostId, mode: "partitioned", namespace: "tenant-one", admission: admissionFor("ahp-namespace:support-app/tenant-one"), ...overrides }, sessions);
  const distributed = (overrides: Partial<HostTopologyOptions> = {}, sessions: Partial<AHPServerOptions["sessions"]> = { ...durable(), creationSecurity },
    extra: Partial<AHPServerOptions> = { security }): AHPServerOptions =>
    options({ hostId, mode: "distributed", admission: admissionFor(defaultNamespaceId, endpoint), routing, ...overrides }, sessions, extra);
  const runtime = () => ({ signal: new AbortController().signal, onStandby: vi.fn<() => void>() });

  it("H1-01 leaves a host without topology unchanged", () => {
    expect(captureHostTopology(options())).toBeUndefined();
  });

  it("H1-01 resolves a minimal host name to single mode with the default namespace", () => {
    const captured = captureHostTopology(options({ hostId }));
    assert.ok(captured);
    expect(captured).toMatchObject({ mode: "single", hostId, namespaceId: defaultNamespaceId, shared: false, standby: false, adoption: "manual" });
    expect(typeof captured.instanceId).toBe("string");
    expect(captured.instanceId.trim().length).toBeGreaterThan(0);
    expect(captured.admission).toBeUndefined();
    expect(captured.routing).toBeUndefined();
  });

  it("H1-01 gives every capture its own runtime instance and the same namespace", () => {
    const first = captureHostTopology(options({ hostId }));
    const second = captureHostTopology(options({ hostId }));
    assert.ok(first && second);
    expect(first.instanceId).not.toBe(second.instanceId);
    expect(first.namespaceId).toBe(second.namespaceId);
    expect(first.hostId).toBe(second.hostId);
    expect(captureHostTopology(options({ hostId, instanceId: "replica-7" }))?.instanceId).toBe("replica-7");
  });

  it("H1-01 claims a single host without standby, membership policy or credential", () => {
    const captured = captureHostTopology(options({ hostId }));
    assert.ok(captured);
    const claim = captured.claim(runtime());
    expect(claim).not.toHaveProperty("standby");
    expect(claim).not.toHaveProperty("credentialId");
    expect(claim).not.toHaveProperty("endpoint");
    expect(claim).toMatchObject({ namespaceId: defaultNamespaceId, instanceId: captured.instanceId, shared: false, policy: { revision: 0, digest: "" } });
    expect(claim.capabilities).toEqual({ providers: [mockProvider.providerId] });
  });

  it("H1-10 captures a replicated host as a standby-capable claim bound to policy and credential", () => {
    const captured = captureHostTopology(replicated({ standbyRetryMs: 250, leaseMs: 5_000 }));
    assert.ok(captured);
    expect(captured).toMatchObject({ mode: "replicated", shared: false, standby: true, namespaceId: defaultNamespaceId });
    expect(captured.admission?.hostId).toBe(hostId);
    const hooks = runtime();
    const claim = captured.claim(hooks);
    expect(claim).toHaveProperty("standby");
    expect(claim.standby?.signal).toBe(hooks.signal);
    expect(claim.standby?.retryMs).toBe(250);
    // The claim reports standby through the runtime's own callback.
    expect(hooks.onStandby).not.toHaveBeenCalled();
    claim.standby?.onStandby?.();
    expect(hooks.onStandby).toHaveBeenCalledOnce();
    expect(claim.policy.revision).toBe(1);
    expect(claim.policy.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(claim.policy).toEqual(captured.admission?.policy);
    expect(claim.credentialId).toBe("support-app-key-1");
    expect(claim.capabilities?.providers).toContain(mockProvider.providerId);
    expect(claim).toMatchObject({ namespaceId: defaultNamespaceId, instanceId: captured.instanceId, shared: false, leaseMs: 5_000 });
  });

  it("H1-10 captures a partitioned host with its explicit namespace", () => {
    const captured = captureHostTopology(partitioned());
    assert.ok(captured);
    expect(captured).toMatchObject({ mode: "partitioned", shared: false, standby: false, namespaceId: "ahp-namespace:support-app/tenant-one" });
    expect(captured.claim(runtime())).not.toHaveProperty("standby");
  });

  it("H1-10 captures a distributed host with bounded routing defaults and its advertised endpoint", () => {
    const captured = captureHostTopology(distributed({ adoption: "automatic" }));
    assert.ok(captured);
    expect(captured).toMatchObject({ mode: "distributed", shared: true, standby: false, adoption: "automatic", namespaceId: defaultNamespaceId });
    expect(captured.routing).toMatchObject({ ...routing, requestTimeoutMs: 30_000, maxPending: 256, maxLinksPerConnection: 8, orderTimeoutMs: 10_000 });
    const claim = captured.claim(runtime());
    expect(claim).toMatchObject({ shared: true, endpoint, credentialId: "support-app-key-1", policy: { revision: 1 } });
    expect(claim).not.toHaveProperty("standby");
  });

  it.each(["replicated", "partitioned", "distributed"] as const)("H1-10 rejects %s mode without durable storage", (mode) => {
    const withoutDurability = { replicated: replicated({}, {}), partitioned: partitioned({}, {}), distributed: distributed({}, { creationSecurity }) }[mode];
    expect(withoutDurability.sessions.durability).toBeUndefined();
    expect(() => captureHostTopology(withoutDurability)).toThrow(/requires durable storage/u);
    expect(() => captureHostTopology(options({ hostId, mode }))).toThrow(/requires durable storage/u);
  });

  it.each(["replicated", "partitioned", "distributed"] as const)("H1-10 rejects %s mode with durable storage but no admission", (mode) => {
    const withoutAdmission = { replicated: replicated({ admission: undefined }), partitioned: partitioned({ admission: undefined }), distributed: distributed({ admission: undefined }) }[mode];
    expect(() => captureHostTopology(withoutAdmission)).toThrow(/requires host admission credentials/u);
  });

  it("H1-10 rejects partitioned mode without an explicit namespace", () => {
    expect(() => captureHostTopology(partitioned({ namespace: undefined, admission: admissionFor(defaultNamespaceId) }))).toThrow(/requires an explicit namespace/u);
    // A canonical identifier is as explicit as a short name.
    expect(captureHostTopology(partitioned({ namespace: undefined, namespaceId: "ahp-namespace:support-app/tenant-one" }))?.namespaceId).toBe("ahp-namespace:support-app/tenant-one");
  });

  it("H1-10 rejects partitioned mode whose namespace name is null", () => {
    expect(() => captureHostTopology(partitioned({ namespace: null as unknown as string, admission: admissionFor(defaultNamespaceId) }))).toThrow();
  });

  it("H1-10 rejects internal routing outside distributed mode", () => {
    expect(() => captureHostTopology(options({ hostId, routing }))).toThrow(/routing belongs to distributed mode/u);
    expect(() => captureHostTopology(replicated({ routing, admission: admissionFor(defaultNamespaceId, endpoint) }))).toThrow(/routing belongs to distributed mode/u);
    expect(() => captureHostTopology(partitioned({ routing, admission: admissionFor("ahp-namespace:support-app/tenant-one", endpoint) }))).toThrow(/routing belongs to distributed mode/u);
  });

  it("H1-10 rejects distributed mode without internal routing or protected connection setup", () => {
    expect(() => captureHostTopology(distributed({ routing: undefined }))).toThrow(/requires internal routing/u);
    expect(() => captureHostTopology(distributed({}, { ...durable(), creationSecurity }, {}))).toThrow(/protected connection setup/u);
    expect(() => captureHostTopology(distributed({}, durable()))).toThrow(/protected connection setup/u);
  });

  it("H1-10 rejects a host name that differs from the durable host identity", () => {
    expect(() => captureHostTopology(options({ hostId }, durable("billing-app")))).toThrow(/must equal the durable host identity/u);
    expect(() => captureHostTopology(replicated({}, durable("support-app-2")))).toThrow(/must equal the durable host identity/u);
    expect(captureHostTopology(options({ hostId }, durable()))?.hostId).toBe(hostId);
  });

  it("H1-10 rejects a membership policy that names another namespace", () => {
    expect(() => captureHostTopology(replicated({ admission: admissionFor("ahp-namespace:support-app/production") }))).toThrow(/names another namespace/u);
    expect(() => captureHostTopology(replicated({ namespace: "production" }))).toThrow(/names another namespace/u);
    expect(captureHostTopology(replicated({ namespace: "production", admission: admissionFor("ahp-namespace:support-app/production") }))?.namespaceId)
      .toBe("ahp-namespace:support-app/production");
  });

  it("H1-10 rejects an advertised routing endpoint the policy does not list for this host", () => {
    expect(() => captureHostTopology(distributed({ routing: { ...routing, endpoint: "ws://127.0.0.1:7444/" } }))).toThrow(/endpoint is not listed/u);
    // Exact match only: an equivalent spelling is still another endpoint.
    expect(() => captureHostTopology(distributed({ routing: { ...routing, endpoint: "ws://127.0.0.1:7443" } }))).toThrow(/endpoint is not listed/u);
    // An endpoint listed for another member is not this host's endpoint.
    expect(() => captureHostTopology(distributed({ routing: { ...routing, endpoint: "ws://127.0.0.1:7555/" } }))).toThrow(/endpoint is not listed/u);
    expect(() => captureHostTopology(distributed({ admission: admissionFor(defaultNamespaceId) }))).toThrow(/endpoint is not listed/u);
  });

  it("H1-10 rejects automatic adoption outside distributed mode", () => {
    expect(() => captureHostTopology(options({ hostId, adoption: "automatic" }))).toThrow(/adoption belongs to distributed mode/u);
    expect(() => captureHostTopology(replicated({ adoption: "automatic" }))).toThrow(/adoption belongs to distributed mode/u);
    expect(() => captureHostTopology(partitioned({ adoption: "automatic" }))).toThrow(/adoption belongs to distributed mode/u);
    expect(captureHostTopology(replicated({ adoption: "manual" }))?.adoption).toBe("manual");
  });

  it("H1-10 rejects an unknown mode", () => {
    const mode = "clustered" as unknown as HostTopologyMode;
    expect(() => captureHostTopology(options({ hostId, mode }))).toThrow(/unknown mode/u);
    expect(() => captureHostTopology(replicated({ mode }))).toThrow(/unknown mode/u);
  });

  it.each([999, 300_001, 0, -1, 1_500.5, Number.NaN, Number.POSITIVE_INFINITY])("H1-10 rejects leaseMs %d as out of range", (leaseMs) => {
    expect(() => captureHostTopology(options({ hostId, leaseMs }))).toThrow(/leaseMs is out of range/u);
    expect(() => captureHostTopology(replicated({ leaseMs }))).toThrow(/leaseMs is out of range/u);
  });

  it.each([1_000, 300_000])("H1-10 accepts the boundary leaseMs %d", (leaseMs) => {
    expect(captureHostTopology(replicated({ leaseMs }))?.claim(runtime()).leaseMs).toBe(leaseMs);
  });
});
