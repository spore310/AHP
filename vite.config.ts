import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    ssr: "src/index.ts",
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rolldownOptions: {
      output: {
        entryFileNames: "index.js",
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/tests/**/*.{test,spec}.ts"],
  },
});
