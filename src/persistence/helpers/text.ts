/**
 * Pure predicates for the text PostgreSQL can store.
 *
 * A NUL code unit fails TEXT and JSONB storage, and an unpaired surrogate
 * cannot be encoded as UTF-8. Service and wire validation run these predicates
 * before SQL so such inputs surface as typed domain failures instead of
 * unclassified storage errors.
 */

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

export const isJsonbSafeText = (text: string): boolean => {
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
 * Maximum nesting level the JSONB-safety recursion inspects before rejecting.
 *
 * A frame-sized payload can carry hundreds of thousands of nesting levels and
 * `JSON.parse` survives them, while this recursion would overflow the stack a
 * few thousand levels deep and escape as an unclassified error. The budget is
 * a stack-safety bound, not a PostgreSQL mirror: it sits far inside the depth
 * real JSONB storage round-trips, so no legitimate payload is rejected.
 */
const JSONB_SAFE_DEPTH = 512;

/**
 * Recursively checks a JSON-shaped value, including object keys: JSON source
 * can escape a NUL or a lone surrogate into a key exactly as into a value, and
 * JSONB stores keys as TEXT.
 */
export const isJsonbSafe = (value: unknown, depth = 0): boolean => {
  if (depth > JSONB_SAFE_DEPTH) {
    return false;
  }
  if (typeof value === "string") {
    return isJsonbSafeText(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonbSafe(item, depth + 1));
  }
  if (!isRecord(value)) {
    return true;
  }
  return Object.entries(value).every(
    ([key, item]) => isJsonbSafeText(key) && isJsonbSafe(item, depth + 1),
  );
};
