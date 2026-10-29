import {
  capturePlainJson,
  policyLimitsSchema,
  type NamespaceRef,
  type PolicyLimits,
  type PolicyRef,
  type PolicyScopeRules,
} from "@authorization";
import { createToolPolicySchemas } from "@toolPolicy/helpers/validation";

import type { PolicyResolutionContext, ToolExecutionPolicyBase, ToolPolicyNamespace } from "../../types";
import type {
  CompiledToolPolicy,
  PolicySelectionResult,
  ToolPolicyBindingRegistration,
  ToolPolicyFactory,
  ToolPolicyFactoryOptions,
} from "./types";
import { ToolPolicyFactoryError } from "./types";

interface StoredNamespace {
  readonly name: string;
  readonly revision: number;
  readonly policies: readonly CompiledToolPolicy[];
  readonly includes: readonly NamespaceRef[];
  readonly resolve: ToolPolicyNamespace["resolve"];
  expanded: readonly PolicyRef[];
}

const freezeDeep = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const entry of Object.values(value)) {
      freezeDeep(entry);
    }
  }
  return value;
};

const clonePlain = (value: unknown): unknown => {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => clonePlain(entry));
  }
  const clone: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    clone[key] = clonePlain((value as Record<string, unknown>)[key]);
  }
  return clone;
};

const extensionPlainLimits = (limits: PolicyLimits) => ({
  maxDepth: limits.extensionDepth,
  maxKeys: limits.extensionKeys,
  maxBytes: limits.extensionBytes,
});

/** One exact ref is an array element plus id and revision, not one JSON key. */
const REF_TREE_DEPTH = 3;

const refArrayPlainLimits = (limits: PolicyLimits) => ({
  maxDepth: REF_TREE_DEPTH,
  maxKeys: limits.maxPolicyRefs * 3,
  maxBytes: 2 + limits.maxPolicyRefs * (limits.maxIdentifierLength * 6 + 32),
});

const detachPlain = (
  value: unknown,
  limits: { readonly maxDepth: number; readonly maxKeys: number; readonly maxBytes: number },
): unknown => {
  if (!capturePlainJson(value, limits)) {
    throw new ToolPolicyFactoryError("invalid-definition", "Invalid policy configuration.");
  }
  return freezeDeep(clonePlain(value));
};

const plainEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((entry, index) => plainEqual(entry, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  if (leftKeys.length !== Object.keys(rightRecord).length) {
    return false;
  }
  return leftKeys.every((key) => (
    Object.prototype.hasOwnProperty.call(rightRecord, key) && plainEqual(leftRecord[key], rightRecord[key])
  ));
};

const refKey = (ref: { readonly id?: string; readonly name?: string; readonly revision: number }): string => (
  `${ref.id ?? ref.name ?? ""}\u0000${String(ref.revision)}`
);

const copyRef = (ref: PolicyRef): PolicyRef => freezeDeep({ id: ref.id, revision: ref.revision });

const readExactRef = (value: unknown): PolicyRef | undefined => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    const names = Object.getOwnPropertyNames(value);
    if (names.length !== 2 || !names.includes("id") || !names.includes("revision")) {
      return undefined;
    }
    const idDescriptor = Object.getOwnPropertyDescriptor(value, "id");
    const revisionDescriptor = Object.getOwnPropertyDescriptor(value, "revision");
    if (idDescriptor === undefined || revisionDescriptor === undefined
      || idDescriptor.get !== undefined || idDescriptor.set !== undefined
      || revisionDescriptor.get !== undefined || revisionDescriptor.set !== undefined
      || idDescriptor.enumerable !== true || revisionDescriptor.enumerable !== true) {
      return undefined;
    }
    if (typeof idDescriptor.value !== "string" || typeof revisionDescriptor.value !== "number") {
      return undefined;
    }
    return { id: idDescriptor.value, revision: revisionDescriptor.value };
  } catch {
    return undefined;
  }
};

export const capturePolicy = (input: unknown, limits: PolicyLimits): CompiledToolPolicy => {
  const schemas = createToolPolicySchemas(limits);
  const parsed = schemas.toolExecutionPolicyManifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ToolPolicyFactoryError("invalid-definition", "Invalid policy configuration.");
  }
  const operations = freezeDeep(clonePlain(parsed.data.operations));
  if (typeof operations !== "object" || operations === null) {
    throw new ToolPolicyFactoryError("invalid-definition", "Invalid policy configuration.");
  }
  const extension = parsed.data.extension === undefined
    ? undefined
    : detachPlain(parsed.data.extension, extensionPlainLimits(limits));
  return freezeDeep({
    id: parsed.data.id,
    revision: parsed.data.revision,
    operations,
    challenge: { required: parsed.data.challenge.required },
    ...(extension !== undefined ? { extension } : {}),
  });
};

/** Validates, then freezes a full clone so the caller type is not stripped. */
export const captureDeclaredPolicy = <T extends ToolExecutionPolicyBase>(input: T, limits: PolicyLimits): T => {
  const compiled = capturePolicy(input, limits);
  const cloned = clonePlain(input);
  if (!plainEqual(compiled, cloned)) {
    throw new ToolPolicyFactoryError("invalid-definition", "Invalid policy configuration.");
  }
  return freezeDeep(cloned) as T;
};

const parseLimits = (input: PolicyLimits | undefined): PolicyLimits => {
  const parsed = policyLimitsSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new ToolPolicyFactoryError("invalid-definition", "Invalid policy configuration.");
  }
  return Object.freeze({ ...parsed.data });
};

const registerPolicy = (
  policies: Map<string, Map<number, CompiledToolPolicy>>,
  policy: CompiledToolPolicy,
): void => {
  let revisions = policies.get(policy.id);
  if (revisions === undefined) {
    revisions = new Map();
    policies.set(policy.id, revisions);
  }
  const existing = revisions.get(policy.revision);
  if (existing !== undefined) {
    if (!plainEqual(existing, policy)) {
      throw new ToolPolicyFactoryError("conflict", "Conflicting policy revision.");
    }
    return;
  }
  revisions.set(policy.revision, policy);
};

const getPolicy = (
  policies: Map<string, Map<number, CompiledToolPolicy>>,
  ref: PolicyRef,
): CompiledToolPolicy | undefined => policies.get(ref.id)?.get(ref.revision);

const requirePolicy = (
  policies: Map<string, Map<number, CompiledToolPolicy>>,
  ref: PolicyRef,
): void => {
  if (getPolicy(policies, ref) === undefined) {
    throw new ToolPolicyFactoryError("unknown-reference", "Unknown policy or namespace reference.");
  }
};

const dedupeIncludes = (includes: readonly NamespaceRef[]): NamespaceRef[] => {
  const seen = new Set<string>();
  const unique: NamespaceRef[] = [];
  for (const include of includes) {
    const key = refKey({ name: include.name, revision: include.revision });
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(include);
  }
  return unique;
};

const expandNamespace = (
  node: StoredNamespace,
  namespaces: Map<string, Map<number, StoredNamespace>>,
  limits: PolicyLimits,
  depth: number,
  stack: Set<string>,
  memo: Map<string, readonly PolicyRef[]>,
): readonly PolicyRef[] => {
  if (depth > limits.namespaceIncludeDepth) {
    throw new ToolPolicyFactoryError("limit", "Policy configuration exceeds a validated limit.");
  }
  const identity = refKey({ name: node.name, revision: node.revision });
  if (stack.has(identity)) {
    throw new ToolPolicyFactoryError("cycle", "Namespace include cycle.");
  }
  const memoKey = `${identity}\u0000${String(depth)}`;
  const cached = memo.get(memoKey);
  if (cached !== undefined) {
    return cached;
  }
  stack.add(identity);
  const unique: PolicyRef[] = [];
  const seen = new Set<string>();
  const add = (ref: PolicyRef): void => {
    const key = refKey(ref);
    if (seen.has(key)) {
      return;
    }
    if (seen.size >= limits.expandedPoliciesPerNamespace) {
      throw new ToolPolicyFactoryError("limit", "Policy configuration exceeds a validated limit.");
    }
    seen.add(key);
    unique.push(copyRef(ref));
  };
  for (const policy of node.policies) {
    add(policy);
  }
  for (const include of dedupeIncludes(node.includes)) {
    const child = namespaces.get(include.name)?.get(include.revision);
    if (child === undefined) {
      throw new ToolPolicyFactoryError("unknown-reference", "Unknown policy or namespace reference.");
    }
    for (const policy of expandNamespace(child, namespaces, limits, depth + 1, stack, memo)) {
      add(policy);
    }
  }
  stack.delete(identity);
  memo.set(memoKey, unique);
  return unique;
};

const captureNamespace = (
  input: ToolPolicyNamespace,
  limits: PolicyLimits,
): StoredNamespace => {
  const schemas = createToolPolicySchemas(limits);
  const name = schemas.toolPolicyNamespaceManifestSchema.safeParse({
    name: input.name,
    revision: input.revision,
    policies: [],
  });
  if (!name.success || typeof input.resolve !== "function") {
    throw new ToolPolicyFactoryError("invalid-definition", "Invalid policy configuration.");
  }
  if ((input.includes?.length ?? 0) > limits.maxNamespaceIncludes
    || input.policies.length > limits.expandedPoliciesPerNamespace) {
    throw new ToolPolicyFactoryError("limit", "Policy configuration exceeds a validated limit.");
  }
  const policies = input.policies.map((policy) => capturePolicy(policy, limits));
  const includes = (input.includes ?? []).map((include) => {
    const parsed = schemas.toolPolicyNamespaceManifestSchema.safeParse({
      name: input.name,
      revision: input.revision,
      policies: [],
      includes: [include],
    });
    if (!parsed.success || parsed.data.includes === undefined) {
      throw new ToolPolicyFactoryError("invalid-definition", "Invalid policy configuration.");
    }
    const [captured] = parsed.data.includes;
    if (captured === undefined) {
      throw new ToolPolicyFactoryError("invalid-definition", "Invalid policy configuration.");
    }
    return freezeDeep({ name: captured.name, revision: captured.revision });
  });
  return {
    name: name.data.name,
    revision: name.data.revision,
    policies: freezeDeep(policies),
    includes: freezeDeep(includes),
    resolve: input.resolve,
    expanded: [],
  };
};

const captureBinding = (
  input: ToolPolicyBindingRegistration,
  limits: PolicyLimits,
  policies: Map<string, Map<number, CompiledToolPolicy>>,
  namespaces: Map<string, Map<number, StoredNamespace>>,
): { readonly key: string; readonly version: number; readonly providerId: string; readonly rules: PolicyScopeRules } => {
  const schemas = createToolPolicySchemas(limits);
  const session = schemas.toolPolicyNamespaceManifestSchema.safeParse({
    name: input.sessionType.key,
    revision: input.sessionType.version,
    policies: [],
  });
  const provider = schemas.toolPolicyNamespaceManifestSchema.safeParse({
    name: input.providerId,
    revision: 1,
    policies: [],
  });
  if (!session.success || !provider.success) {
    throw new ToolPolicyFactoryError("invalid-definition", "Invalid policy configuration.");
  }
  if (input.admitted.policies.length > limits.maxPolicyRefs
    || input.admitted.namespaces.length > limits.maxNamespaceIncludes
    || input.mandatory.length > limits.maxPolicyRefs) {
    throw new ToolPolicyFactoryError("limit", "Policy configuration exceeds a validated limit.");
  }
  for (const policy of [...input.admitted.policies, ...input.mandatory]) {
    const refParsed = schemas.toolExecutionPolicyManifestSchema.safeParse({
      id: policy.id,
      revision: policy.revision,
      operations: {},
      challenge: { required: false },
    });
    if (!refParsed.success) {
      throw new ToolPolicyFactoryError("invalid-definition", "Invalid policy configuration.");
    }
    requirePolicy(policies, policy);
  }
  for (const include of input.admitted.namespaces) {
    const included = schemas.toolPolicyNamespaceManifestSchema.safeParse({
      name: include.name,
      revision: include.revision,
      policies: [],
    });
    if (!included.success || namespaces.get(include.name)?.get(include.revision) === undefined) {
      throw new ToolPolicyFactoryError("unknown-reference", "Unknown policy or namespace reference.");
    }
  }
  return {
    key: session.data.name,
    version: session.data.revision,
    providerId: provider.data.name,
    rules: freezeDeep({
      admitted: {
        policies: input.admitted.policies.map((item) => copyRef(item)),
        namespaces: input.admitted.namespaces.map((item) => freezeDeep({ name: item.name, revision: item.revision })),
      },
      mandatory: input.mandatory.map((item) => copyRef(item)),
    }),
  };
};

const deny = (code: string): PolicySelectionResult => freezeDeep({ effect: "deny", code });

const callResolver = async (
  resolve: ToolPolicyNamespace["resolve"],
  context: PolicyResolutionContext,
  deadlineMs: number,
): Promise<{ readonly kind: "value"; readonly value: unknown } | { readonly kind: "failed" } | { readonly kind: "timeout" }> => (
  new Promise((done) => {
    let settled = false;
    const finish = (
      result: { readonly kind: "value"; readonly value: unknown } | { readonly kind: "failed" } | { readonly kind: "timeout" },
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      done(result);
    };
    const timer = setTimeout(() => {
      finish({ kind: "timeout" });
    }, deadlineMs);
    try {
      Promise.resolve(resolve(context)).then(
        (value) => {
          finish({ kind: "value", value });
        },
        () => {
          finish({ kind: "failed" });
        },
      );
    } catch {
      finish({ kind: "failed" });
    }
  })
);

export const createToolPolicyFactory = (options: ToolPolicyFactoryOptions): ToolPolicyFactory => {
  const limits = parseLimits(options.limits);
  const policies = new Map<string, Map<number, CompiledToolPolicy>>();
  const namespaces = new Map<string, Map<number, StoredNamespace>>();
  const bindings = new Map<string, Map<number, Map<string, PolicyScopeRules>>>();
  const expansionMemo = new Map<string, readonly PolicyRef[]>();

  if ((options.policies?.length ?? 0) > limits.expandedPoliciesPerNamespace
    || (options.namespaces?.length ?? 0) > limits.expandedPoliciesPerNamespace
    || (options.bindings?.length ?? 0) > limits.maxPolicyRefs) {
    throw new ToolPolicyFactoryError("limit", "Policy configuration exceeds a validated limit.");
  }

  for (const policy of options.policies ?? []) {
    registerPolicy(policies, capturePolicy(policy, limits));
  }
  for (const namespace of options.namespaces ?? []) {
    const captured = captureNamespace(namespace, limits);
    let revisions = namespaces.get(captured.name);
    if (revisions === undefined) {
      revisions = new Map();
      namespaces.set(captured.name, revisions);
    }
    if (revisions.has(captured.revision)) {
      throw new ToolPolicyFactoryError("conflict", "Conflicting policy revision.");
    }
    revisions.set(captured.revision, captured);
    for (const policy of captured.policies) {
      registerPolicy(policies, policy);
    }
  }
  for (const namespace of namespaces.values()) {
    for (const node of namespace.values()) {
      node.expanded = expandNamespace(node, namespaces, limits, 0, new Set(), expansionMemo);
    }
  }
  for (const binding of options.bindings ?? []) {
    const captured = captureBinding(binding, limits, policies, namespaces);
    let versions = bindings.get(captured.key);
    if (versions === undefined) {
      versions = new Map();
      bindings.set(captured.key, versions);
    }
    let providers = versions.get(captured.version);
    if (providers === undefined) {
      providers = new Map();
      versions.set(captured.version, providers);
    }
    if (providers.has(captured.providerId)) {
      throw new ToolPolicyFactoryError("conflict", "Conflicting policy revision.");
    }
    providers.set(captured.providerId, captured.rules);
  }

  const findBinding = (key: string, version: number, providerId: string): PolicyScopeRules => {
    const found = bindings.get(key)?.get(version)?.get(providerId);
    if (found === undefined) {
      throw new ToolPolicyFactoryError("binding-not-found", "Session-type and provider binding was not found.");
    }
    return found;
  };

  const admissionSet = (rules: PolicyScopeRules): Set<string> => {
    const admitted = new Set<string>();
    for (const policy of rules.admitted.policies) {
      admitted.add(refKey(policy));
    }
    for (const include of rules.admitted.namespaces) {
      const node = namespaces.get(include.name)?.get(include.revision);
      if (node === undefined) {
        throw new ToolPolicyFactoryError("unknown-reference", "Unknown policy or namespace reference.");
      }
      for (const policy of node.expanded) {
        admitted.add(refKey(policy));
      }
    }
    return admitted;
  };

  return {
    getPolicy: (ref) => {
      const found = getPolicy(policies, ref);
      return found === undefined ? undefined : freezeDeep(clonePlain(found) as CompiledToolPolicy);
    },
    forSessionType: (sessionType, providerId) => freezeDeep(
      clonePlain(findBinding(sessionType.key, sessionType.version, providerId)) as PolicyScopeRules,
    ),
    select: async ({ sessionType, providerId, context }) => {
      const rules = findBinding(sessionType.key, sessionType.version, providerId);
      const admitted = admissionSet(rules);
      const mandatory = rules.mandatory.map((item) => copyRef(item));
      if (rules.admitted.namespaces.length === 0) {
        return freezeDeep({
          effect: "selected",
          alternatives: rules.admitted.policies.map((item) => copyRef(item)),
          mandatory,
        });
      }
      const alternatives: PolicyRef[] = rules.admitted.policies.map((item) => copyRef(item));
      const seen = new Set<string>(alternatives.map((item) => refKey(item)));
      for (const include of rules.admitted.namespaces) {
        const node = namespaces.get(include.name)?.get(include.revision);
        if (node === undefined) {
          return deny("out-of-admission");
        }
        const called = await callResolver(node.resolve, context, limits.asyncHookDeadlineMs);
        if (called.kind === "timeout") {
          return deny("resolver-timeout");
        }
        if (called.kind === "failed" || !Array.isArray(called.value)) {
          return deny(called.kind === "failed" ? "resolver-failed" : "resolver-output");
        }
        try {
          if (!capturePlainJson(called.value, refArrayPlainLimits(limits))) {
            return deny("resolver-output");
          }
          if (called.value.length > limits.maxPolicyRefs) {
            return deny("resolver-output");
          }
          for (const item of called.value) {
            const exact = readExactRef(item);
            if (exact === undefined) {
              return deny("resolver-output");
            }
            if (!admitted.has(refKey(exact))) {
              return deny("out-of-admission");
            }
            const key = refKey(exact);
            if (!seen.has(key)) {
              seen.add(key);
              alternatives.push(copyRef(exact));
            }
          }
        } catch {
          return deny("resolver-output");
        }
      }
      return freezeDeep({ effect: "selected", alternatives, mandatory });
    },
    inspect: () => freezeDeep({
      policies: [...policies.values()].flatMap((revisions) => [...revisions.values()])
        .sort((left, right) => left.id.localeCompare(right.id) || left.revision - right.revision)
        .map((policy) => clonePlain(policy) as CompiledToolPolicy),
      namespaces: [...namespaces.values()].flatMap((revisions) => [...revisions.values()])
        .sort((left, right) => left.name.localeCompare(right.name) || left.revision - right.revision)
        .map((namespace) => ({
          name: namespace.name,
          revision: namespace.revision,
          policies: namespace.policies.map((policy) => copyRef(policy)),
          includes: namespace.includes.map((include) => ({ name: include.name, revision: include.revision })),
          expanded: namespace.expanded.map((policy) => copyRef(policy)),
        })),
    }),
  };
};
