import { defineConfig } from "tsup";

const external = ["react", "react-dom", "react-dom/server", "react/jsx-runtime"];
// Keeps Hangul as is instead of \uXXXX escapes (6 bytes -> 3 bytes per character)
const esbuildOptions = (o: { charset?: string }) => {
  o.charset = "utf8";
};
// Source maps are not shipped: they were 60% of the npm package size, and the published JS (all but the minified standalone.js) is not minified, so it reads as is

export default defineConfig([
  {
    entry: { index: "src/index.ts", spec: "src/spec/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: false,
    clean: false,
    treeshake: false,
    splitting: true,
    target: "es2020",
    external,
    esbuildOptions,
    banner: { js: '"use client";' },
  },
  {
    // Map boundaries get their own entry points (ztd-charts/geo/world and so on). Code that draws no map ships no boundary data.
    // Bundled apart from index and spec, so their chunk splitting stays as it is (only the small name tables krRegions and usStates get one copy per entry)
    entry: { "geo/world": "src/geo/world.ts", "geo/us-states": "src/geo/us-states.ts", "geo/kr-sido": "src/geo/kr-sido.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: false,
    clean: false,
    splitting: false,
    treeshake: true,
    target: "es2020",
    external,
    esbuildOptions,
  },
  {
    entry: { server: "src/server/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: false,
    clean: false,
    treeshake: true,
    target: "node18",
    external,
    esbuildOptions,
  },
  {
    // A single-file bundle used directly in the browser through an import map (the old { libraryUrl } way of renderSpecToHTML. CLI --interactive now uses dist/client, which carries a single chart)
    entry: { standalone: "src/index.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: false,
    clean: false,
    splitting: false,
    minify: true,
    treeshake: true,
    target: "es2020",
    external,
    esbuildOptions,
  },
]);
