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
 * Recursively checks a JSON-shaped value, including object keys: JSON source
 * can escape a NUL or a lone surrogate into a key exactly as into a value, and
 * JSONB stores keys as TEXT.
 */
export const isJsonbSafe = (value: unknown): boolean => {
  if (typeof value === "string") {
    return isJsonbSafeText(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonbSafe);
  }
  if (!isRecord(value)) {
    return true;
  }
  return Object.entries(value).every(
    ([key, item]) => isJsonbSafeText(key) && isJsonbSafe(item),
  );
};
