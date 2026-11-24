import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { build } from "vite";

it("bundles the public client and wire entry points for browsers without host dependencies", async () => {
  const modules = new Set<string>();
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    root, configFile: false, logLevel: "silent", resolve: { tsconfigPaths: true },
    plugins: [{
      name: "inspect-portable-client",
      moduleParsed(info) { modules.add(info.id.replaceAll("\\", "/")); },
    }],
    build: { write: false, minify: false, lib: { entry: {
      client: "src/client/index.ts", tools: "src/tool/helpers/client/index.ts", protocol: "src/tool/helpers/protocol/index.ts",
    }, formats: ["es"] } },
  });
  const loaded = [...modules];
  for (const path of ["/src/client/", "/src/tool/helpers/client/", "/src/tool/helpers/protocol/"]) {
    expect(loaded.some((id) => id.includes(path))).toBe(true);
  }
  expect(loaded.filter((id) => /(?:^node:|vite-browser-external|\/node_modules\/(?:ajv|pg|ws)\/|\/src\/(?:application|websocket)\/|\/src\/tool\/helpers\/execution\/helpers\/(?:server|remote|dispatcher)\/)/u.test(id))).toEqual([]);
});
