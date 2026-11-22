import { describe, expect, it, vi } from "vitest";

import {
  POLICY_LIMIT_ABSOLUTE,
  POLICY_LIMIT_DEFAULTS,
  policyLimitsSchema,
  policyRefSchema,
  scopedPolicyBindingSchema,
  type GrantIssuer,
} from "@authorization";
import { challengePresentationSchema, createChallengePresentationSchema } from "@toolExecution";
import {
  boundedExtensionSchema,
  createToolPolicySchemas,
  toolExecutionPolicyManifestSchema,
  toolPolicyNamespaceManifestSchema,
} from "@toolPolicy";

const policy = {
  id: "review",
  revision: 1,
  operations: {},
  challenge: { required: false },
};

describe("P01 contract review regressions", () => {
  it("validates portable extension data without a Node Buffer global", () => {
    vi.stubGlobal("Buffer", undefined);
    try {
      expect(boundedExtensionSchema.safeParse({ lane: "chat" }).success).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects reserved identity selectors consistently in definitions and references", () => {
    for (const id of ["__proto__", "constructor", "prototype"]) {
      expect(policyRefSchema.safeParse({ id, revision: 1 }).success).toBe(false);
      expect(toolExecutionPolicyManifestSchema.safeParse({ ...policy, id }).success).toBe(false);
      expect(toolPolicyNamespaceManifestSchema.safeParse({ name: id, revision: 1, policies: [] }).success).toBe(false);
    }
  });

  it("accepts the same application-defined role vocabulary in bindings and policy rules", () => {
    const roles = ["workspace:review", "équipe/édition"];
    expect(scopedPolicyBindingSchema.safeParse({
      id: "binding",
      actor: { kind: "user", principal: { domainId: "domain", subject: "user" } },
      scope: { domainId: "domain", kind: "session", id: "session", instanceId: "instance" },
      roles,
      policies: [{ id: "review", revision: 1 }],
      authority: { kind: "host-policy", policy: { id: "review", revision: 1 } },
      revision: 1,
    }).success).toBe(true);
    expect(toolExecutionPolicyManifestSchema.safeParse({
      ...policy,
      operations: { invoke: { actor: { mode: "roles", actors: { user: { anyOf: roles } } } } },
    }).success).toBe(true);
  });

  it("rejects executable accessors without invoking them while validating plain extension data", () => {
    let reads = 0;
    const extension = Object.defineProperty({}, "lane", {
      enumerable: true,
      get: () => {
        reads += 1;
        return "chat";
      },
    });
    const parsed = boundedExtensionSchema.safeParse(extension);
    expect(parsed.success).toBe(false);
    expect(reads).toBe(0);
  });

  it("bounds challenge redirect metadata before any continuation can retain it", () => {
    expect(challengePresentationSchema.safeParse({
      kind: "redirect",
      url: `https://example.invalid/${"x".repeat(100_000)}`,
    }).success).toBe(false);
  });

  it("counts escaped JSON bytes rather than only unescaped string bytes", () => {
    const limits = policyLimitsSchema.parse({ extensionBytes: 32 });
    const value = { text: "\u0000".repeat(10) };
    expect(JSON.stringify(value).length).toBeGreaterThan(limits.extensionBytes);
    expect(createToolPolicySchemas(limits).boundedExtensionSchema.safeParse(value).success).toBe(false);
    const exact = { text: "\u0000" };
    const exactBytes = new TextEncoder().encode(JSON.stringify(exact)).length;
    expect(createToolPolicySchemas(policyLimitsSchema.parse({ extensionBytes: exactBytes }))
      .boundedExtensionSchema.safeParse(exact).success).toBe(true);
    expect(createToolPolicySchemas(policyLimitsSchema.parse({ extensionBytes: exactBytes - 1 }))
      .boundedExtensionSchema.safeParse(exact).success).toBe(false);
    const quoted = { q: "\"\\" };
    const quotedBytes = new TextEncoder().encode(JSON.stringify(quoted)).length;
    expect(createToolPolicySchemas(policyLimitsSchema.parse({ extensionBytes: quotedBytes }))
      .boundedExtensionSchema.safeParse(quoted).success).toBe(true);
    expect(createToolPolicySchemas(policyLimitsSchema.parse({ extensionBytes: quotedBytes - 1 }))
      .boundedExtensionSchema.safeParse(quoted).success).toBe(false);
    const accented = { t: "é😀" };
    const accentedBytes = new TextEncoder().encode(JSON.stringify(accented)).length;
    expect(accentedBytes).toBeGreaterThan(JSON.stringify(accented).length);
    expect(createToolPolicySchemas(policyLimitsSchema.parse({ extensionBytes: accentedBytes }))
      .boundedExtensionSchema.safeParse(accented).success).toBe(true);
    expect(createToolPolicySchemas(policyLimitsSchema.parse({ extensionBytes: accentedBytes - 1 }))
      .boundedExtensionSchema.safeParse(accented).success).toBe(false);
    const nested = { a: [1, "\""] };
    const nestedBytes = new TextEncoder().encode(JSON.stringify(nested)).length;
    expect(createToolPolicySchemas(policyLimitsSchema.parse({ extensionBytes: nestedBytes }))
      .boundedExtensionSchema.safeParse(nested).success).toBe(true);
    expect(createToolPolicySchemas(policyLimitsSchema.parse({ extensionBytes: nestedBytes - 1 }))
      .boundedExtensionSchema.safeParse(nested).success).toBe(false);
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(createToolPolicySchemas(policyLimitsSchema.parse({ extensionBytes: 64 }))
      .boundedExtensionSchema.safeParse(cycle).success).toBe(false);
  });

  it("rejects executable properties on arrays without invoking them", () => {
    let calls = 0;
    const value = Object.defineProperty(["chat"], "toJSON", {
      value: () => {
        calls += 1;
        return "changed";
      },
    });
    expect(boundedExtensionSchema.safeParse(value).success).toBe(false);
    expect(calls).toBe(0);
  });

  it("rejects a nonenumerable toJSON function on an ordinary object without invoking it", () => {
    let calls = 0;
    const extension = Object.defineProperty({ lane: "chat" }, "toJSON", {
      enumerable: false,
      value: () => {
        calls += 1;
        return { lane: "executed" };
      },
    });
    const parsed = boundedExtensionSchema.safeParse(extension);
    expect(parsed.success).toBe(false);
    expect(calls).toBe(0);
    if (parsed.success) {
      expect(parsed.data).not.toBe(extension);
    }
  });

  it("retains valid URL syntax checks as well as redirect length bounds", () => {
    for (const url of ["https://", "http://[", "https://not a host/"]) {
      expect(challengePresentationSchema.safeParse({ kind: "redirect", url }).success).toBe(false);
    }
  });

  it("keeps local grant commit and rollback synchronous", () => {
    type CommitIsSync = ReturnType<GrantIssuer["commit"]> extends Promise<unknown> ? never : true;
    type RollbackIsSync = ReturnType<GrantIssuer["rollback"]> extends Promise<unknown> ? never : true;
    const commitIsSync: CommitIsSync = true;
    const rollbackIsSync: RollbackIsSync = true;
    expect(commitIsSync).toBe(true);
    expect(rollbackIsSync).toBe(true);
    expect(Object.isFrozen(POLICY_LIMIT_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(POLICY_LIMIT_ABSOLUTE)).toBe(true);
  });

  it("applies lower and higher budgets without treating include depth as a count", () => {
    const low = policyLimitsSchema.parse({
      ...POLICY_LIMIT_DEFAULTS,
      extensionDepth: 2,
      expandedPoliciesPerNamespace: 1,
      maxNamespaceIncludes: 1,
      namespaceIncludeDepth: 16,
      maxMetadataStringLength: 32,
    });
    const high = policyLimitsSchema.parse({
      ...POLICY_LIMIT_DEFAULTS,
      extensionDepth: 4,
      expandedPoliciesPerNamespace: 3,
      maxNamespaceIncludes: 4,
      namespaceIncludeDepth: 1,
      maxMetadataStringLength: 4_000,
    });
    const lowSchemas = createToolPolicySchemas(low);
    const highSchemas = createToolPolicySchemas(high);
    const nested = { child: { child: { leaf: true } } };
    expect(lowSchemas.boundedExtensionSchema.safeParse(nested).success).toBe(false);
    expect(highSchemas.boundedExtensionSchema.safeParse(nested).success).toBe(true);
    const includes = [1, 2, 3, 4].map((revision) => ({ name: `ns-${String(revision)}`, revision }));
    expect(lowSchemas.toolPolicyNamespaceManifestSchema.safeParse({
      name: "workspace",
      revision: 1,
      policies: [],
      includes,
    }).success).toBe(false);
    expect(highSchemas.toolPolicyNamespaceManifestSchema.safeParse({
      name: "workspace",
      revision: 1,
      policies: [],
      includes,
    }).success).toBe(true);
    const longUrl = `https://example.invalid/${"y".repeat(300)}`;
    expect(challengePresentationSchema.safeParse({ kind: "redirect", url: longUrl }).success).toBe(false);
    expect(createChallengePresentationSchema(high).safeParse({ kind: "redirect", url: longUrl }).success).toBe(true);
  });
});
