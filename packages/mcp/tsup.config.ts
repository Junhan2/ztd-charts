import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", server: "src/server.ts" },
  format: ["esm"],
  dts: { entry: { server: "src/server.ts" } },
  sourcemap: false,
  clean: false,
  target: "node18",
  platform: "node",
  splitting: true,
  external: [/^ztd-charts(-cli)?(\/|$)/, /^@modelcontextprotocol\//, "zod", "react", "react-dom", "@resvg/resvg-js"],
});
