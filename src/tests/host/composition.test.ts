import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const sources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return entry.name === "tests" ? [] : sources(path);
  return entry.name.endsWith(".ts") ? [path] : [];
});
const imports = (file: string): string[] => [...readFileSync(file, "utf8").matchAll(/(?:from|import\()\s*"([^"]+)"/gu)].map((match) => match[1] ?? "");

describe("host composition boundary", () => {
  it("H0-02 keeps the resolved import graph acyclic between @host and @websocket", () => {
    const host = sources(join(root, "host"));
    expect(host.length).toBeGreaterThan(10);
    // @host consumes lower transport entry points only. The @websocket barrel re-exports @host,
    // so importing the barrel from here would close the cycle @host -> @websocket -> @host.
    const barrel = host.flatMap((file) => imports(file).filter((specifier) => specifier === "@websocket" || /(^|\/)websocket(\/index)?$/u.test(specifier)).map((specifier) => `${file}: ${specifier}`));
    expect(barrel).toEqual([]);
    expect(host.some((file) => imports(file).some((specifier) => specifier.startsWith("@websocket/helpers/")))).toBe(true);
    // Nothing below the barrel reaches back up into @host.
    const transport = sources(join(root, "websocket")).filter((file) => !file.endsWith(join("websocket", "index.ts")));
    const upward = transport.flatMap((file) => imports(file).filter((specifier) => specifier === "@host" || specifier.startsWith("@host/") || /(^|\/)host(\/|$)/u.test(specifier)).map((specifier) => `${file}: ${specifier}`));
    expect(upward).toEqual([]);
    // The compatibility export is the single, one-directional edge.
    expect(imports(join(root, "websocket", "index.ts")).filter((specifier) => specifier === "@host")).toHaveLength(2);
  });

  it("H0-05 keeps portable client entry points free of the host and of PostgreSQL", () => {
    for (const entry of ["client", "tool"]) {
      const offenders = sources(join(root, entry)).flatMap((file) => imports(file).filter((specifier) => specifier === "pg" || specifier === "@host" || specifier.startsWith("@host/")
        || specifier.includes("adapters/postgres")).map((specifier) => `${file}: ${specifier}`));
      expect(offenders).toEqual([]);
    }
  });
});
