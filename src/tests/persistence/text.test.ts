import { describe, expect, it } from "vitest";

import { parseUnknownJson } from "@jsonrpc";
import {
  hasPortableTextTree,
  isJsonbSafe,
  isJsonbSafeText,
  isPortableText,
} from "@persistence/helpers/text";

const wrap = (value: unknown, levels: number): unknown => {
  let nested = value;
  for (let level = 0; level < levels; level += 1) {
    nested = { key: nested };
  }
  return nested;
};

describe("portable-text profile v1 — isPortableText", () => {
  it("accepts ordinary ASCII and non-empty plain text", () => {
    expect(isPortableText("")).toBe(true);
    expect(isPortableText("ahp-session:/work-unit-1")).toBe(true);
    expect(isPortableText("Agent Hosting Protocol")).toBe(true);
  });

  it("accepts valid UTF-16 surrogate pairs, including supplementary characters", () => {
    expect(isPortableText("\ud83c\udf89")).toBe(true);
    expect(isPortableText("\ud834\udd1e")).toBe(true); // U+1D11E G clef
    expect(isPortableText("agent\ud83d\ude00work")).toBe(true);
  });

  it("rejects a NUL code unit and isolated surrogates", () => {
    expect(isPortableText("a\u0000b")).toBe(false);
    expect(isPortableText("\ud800")).toBe(false); // isolated high surrogate
    expect(isPortableText("\udc00")).toBe(false); // isolated low surrogate
    expect(isPortableText("a\ud800Z")).toBe(false); // high rejected even when followed by non-low
  });
});

describe("portable-text profile v1 — hasPortableTextTree", () => {
  it("accepts ASCII and valid surrogate pairs nested in arrays and objects", () => {
    expect(hasPortableTextTree({ outer: [{ inner: "plain" }] })).toBe(true);
    expect(hasPortableTextTree({
      outer: [{ inner: "\ud83c\udf89 top pair" }],
    })).toBe(true);
    expect(hasPortableTextTree([[[{ deep: "\ud834\udd1e \ud83d\ude00" }]]])).toBe(true);
  });

  it("rejects a NUL in a string value and recursively in arrays/objects", () => {
    expect(hasPortableTextTree("a\u0000b")).toBe(false);
    expect(hasPortableTextTree({ nested: { deeper: "a\u0000b" } })).toBe(false);
    expect(hasPortableTextTree(["fine", [["\u0000"]]])).toBe(false);
  });

  it("rejects a NUL hidden in an object key (escaped-NUL adversarial case)", () => {
    // The key is built from source escape syntax so it carries a real NUL
    // like a JSON.parse'd payload does.
    const escapedNulKey = parseUnknownJson(String.raw`{"kind\u0000ed": 1}`);
    expect(hasPortableTextTree(escapedNulKey)).toBe(false);
    expect(escapedNulKey).toEqual({ "kind\u0000ed": 1 });
  });

  it("rejects isolated high and low surrogates wherever they appear", () => {
    expect(hasPortableTextTree({ key: "\ud800" })).toBe(false);
    expect(hasPortableTextTree({ key: "\udc00" })).toBe(false);
    expect(hasPortableTextTree({ "\ud800": "value" })).toBe(false);
    expect(hasPortableTextTree(["ok", [null, { deep: "\ud800" }]])).toBe(false);
  });

  it("treats only depth > 512 as failure: exact boundary accepted, 513 rejected", () => {
    // Innermost leaf position: depth = 512 for a plain string leaf, and one
    // level shallower wrappers when the innermost value is an object/array.
    for (const tree of [
      wrap("leaf", 512),
      wrap({ leaf: "ok" }, 511),
      wrap(["leaf"], 511),
    ]) {
      expect(hasPortableTextTree(tree)).toBe(true);
    }
    for (const tree of [
      wrap("leaf", 513),
      wrap({ leaf: "ok" }, 512),
      wrap(["leaf"], 512),
      wrap({ leaf: "ok" }, 513),
    ]) {
      expect(hasPortableTextTree(tree)).toBe(false);
    }
  });

  it("preserves the existing non-string/record acceptance (no broadening)", () => {
    // Numbers (including NaN), booleans, null, and other scalars are not the
    // tree predicate's concern — shape/serialization checks belong to the
    // callers, and this move must not change that policy.
    expect(hasPortableTextTree({ count: 7, ratio: Number.NaN, ok: true })).toBe(true);
    expect(hasPortableTextTree(null)).toBe(true);
    expect(hasPortableTextTree(3.5)).toBe(true);
  });

  it("is consistent whether the budget depth starts at an explicit offset", () => {
    expect(hasPortableTextTree("ok", 511)).toBe(true);
    expect(hasPortableTextTree("ok", 512)).toBe(true);
    expect(hasPortableTextTree("ok", 513)).toBe(false);
  });
});

describe("portable-text profile v1 — temporary legacy aliases", () => {
  it("keeps isJsonbSafeText behavior identical to isPortableText", () => {
    for (const sample of ["plain", "a\u0000b", "\ud800", "\udc00", "\ud834\udd1e"]) {
      expect(isJsonbSafeText(sample)).toBe(isPortableText(sample));
    }
  });

  it("keeps isJsonbSafe depth semantics identical to hasPortableTextTree", () => {
    for (const [sample, expected] of [
      [{ key: "\ud83c\udf89" }, true],
      [{ key: "\u0000" }, false],
      [wrap("leaf", 512), true],
      [wrap("leaf", 513), false],
      [parseUnknownJson(String.raw`{"a\u0000b": 1}`), false],
    ] as [unknown, boolean][]) {
      expect(isJsonbSafe(sample)).toBe(expected);
      expect(isJsonbSafe(sample)).toBe(hasPortableTextTree(sample));
    }
  });
});
