import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "ztd-charts/spec", replacement: r("./packages/ztd-charts/src/spec/index.ts") },
      { find: "ztd-charts/server", replacement: r("./packages/ztd-charts/src/server/index.ts") },
      { find: /^ztd-charts$/, replacement: r("./packages/ztd-charts/src/index.ts") },
      { find: /^ztd-charts-cli$/, replacement: r("./packages/cli/src/api.ts") },
    ],
  },
  test: {
    projects: [
      { extends: true, test: { name: "ztd-charts", include: ["packages/ztd-charts/test/**/*.test.{ts,tsx}"], environment: "node", setupFiles: ["packages/ztd-charts/test/setup-maps.ts"] } },
      { extends: true, test: { name: "cli", include: ["packages/cli/test/**/*.test.ts"], environment: "node", testTimeout: 60_000 } },
      { extends: true, test: { name: "mcp", include: ["packages/mcp/test/**/*.test.ts"], environment: "node", testTimeout: 60_000 } },
    ],
  },
});
