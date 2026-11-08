import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts", api: "src/api.ts" },
  format: ["esm"],
  dts: { entry: { api: "src/api.ts" } },
  sourcemap: false,
  clean: false,
  target: "node18",
  platform: "node",
  splitting: true,
  external: ["ztd-charts", "ztd-charts/spec", "ztd-charts/server", "@resvg/resvg-js", "react", "react-dom", "pretendard"],
});
