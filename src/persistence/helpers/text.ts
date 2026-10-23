/**
 * Portable-text profile v1 — pure predicates for text every owned store can
 * encode.
 *
 * A NUL code unit fails TEXT and JSONB storage, and an unpaired surrogate
 * cannot be encoded as UTF-8. Service and wire validation run these
 * predicates before any persistence call so such inputs surface as typed
 * domain failures instead of unclassified storage errors. NUL rejection is an
 * owned application interoperability policy, not a universal JSON rule.
 */

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

/** Accepts ASCII and all valid UTF-16 text, including surrogate pairs. */
export const isPortableText = (text: string): boolean => {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit === 0) {
      return false;
    }
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return false;
      }
      index += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
};

/**
 * Maximum nesting level the portability recursion inspects before rejecting.
 *
 * A frame-sized payload can carry hundreds of thousands of nesting levels and
 * `JSON.parse` survives them, while this recursion would overflow the stack a
 * few thousand levels deep and escape as an unclassified error. The budget is
 * a stack-safety bound on this profile's recursion, not a property of any
 * store; it sits far inside the depth a real JSON value round-trips, so no
 * legitimate payload is rejected.
 */
const MAX_PORTABLE_TEXT_TREE_DEPTH = 512;

/**
 * Recursively checks a JSON-shaped value, including object keys: JSON source
 * can escape a NUL or a lone surrogate into a key exactly as into a value.
 * This predicate checks portable text only; it does not certify that an
 * arbitrary object serializes to JSON, satisfies a schema, or is authorized —
 * shape, size, and allowed-kind checks stay in their existing callers, and
 * store-specific encoding checks stay in concrete adapters.
 */
export const hasPortableTextTree = (value: unknown, depth = 0): boolean => {
  if (depth > MAX_PORTABLE_TEXT_TREE_DEPTH) {
    return false;
  }
  if (typeof value === "string") {
    return isPortableText(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => hasPortableTextTree(item, depth + 1));
  }
  if (!isRecord(value)) {
    return true;
  }
  return Object.entries(value).every(
    ([key, item]) => isPortableText(key) && hasPortableTextTree(item, depth + 1),
  );
};

/**
 * TEMPORARY — JSONB-named legacy aliases kept only for build continuity while
 * P09 migrates their four production consumers
 * (`agents/helpers/directory.ts`, `work/helpers/helpers.ts`,
 * `websocket/helpers/ahp/agentWork.ts`, and the `@work` public re-export).
 * Behavior is identical to the neutral names above. **Must be deleted in
 * P09**; they must not appear in the final public API. (Not tagged
 * `@deprecated` on purpose: that marker would fail lint on consumers this
 * packet does not own.)
 */
export const isJsonbSafeText = isPortableText;
export const isJsonbSafe = hasPortableTextTree;
