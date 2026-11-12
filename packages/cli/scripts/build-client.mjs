// Builds into dist/client/ the browser code that HTML exported with render --interactive uses to hydrate the server-drawn chart.
// react.js puts React, the React DOM client and the JSX runtime on globalThis.__ztdReact; <type>.js holds that one chart, the spec renderer and the hydration entry point.
// clientScript in api.ts inlines react.js, the map file geo-<name>.js for a map chart, and that chart's file into the HTML as plain text (no CDN, base64 or import map)
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_MAPS, CHARTS, mapExportName } from "ztd-charts/spec";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
// Borrows the esbuild that tsup uses, so no new dependency
const esbuild = createRequire(require.resolve("tsup"))("esbuild");
// Bundles the library source from the workspace. Thanks to "sideEffects": false in package.json, the 43 unused charts are left out
const lib = dirname(require.resolve("ztd-charts/package.json"));
const out = join(root, "dist/client");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// React imports in a chart file read the global that react.js set up, so the page has only one copy of React
const REACT = /^(react|react\/jsx-runtime|react-dom\/client)$/;
const reactGlobal = {
  name: "react-global",
  setup(b) {
    b.onResolve({ filter: REACT }, (a) => ({ path: a.path, namespace: "ztd-react" }));
    b.onLoad({ filter: /.*/, namespace: "ztd-react" }, (a) => ({ contents: `module.exports = globalThis.__ztdReact[${JSON.stringify(a.path)}];`, loader: "js" }));
  },
};
const common = {
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  charset: "utf8",
  jsx: "automatic",
  nodePaths: [join(root, "node_modules")],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
};
async function build(name, contents, plugins = []) {
  const r = await esbuild.build({ ...common, stdin: { contents, resolveDir: root, loader: "tsx" }, plugins });
  const code = r.outputFiles[0].text;
  // The code goes into a <script> as is, so text that closes the tag or opens a comment stops the build (esbuild already rewrites </script> in browser output)
  if (/<\/script|<!--/i.test(code)) throw new Error(`${name}: </script or <!-- left in the bundle`);
  writeFileSync(join(out, `${name}.js`), code);
}

await build("react", `import * as R from "react"; import * as J from "react/jsx-runtime"; import * as C from "react-dom/client"; globalThis.__ztdReact = { react: R, "react/jsx-runtime": J, "react-dom/client": C };`);
const hydrate = JSON.stringify(join(lib, "src/client/hydrate.tsx"));
const index = JSON.stringify(join(lib, "src/index.ts"));
await Promise.all(
  CHARTS.map((d) => build(d.type, `import { hydrateChart } from ${hydrate}; import { ${d.component} } from ${index}; hydrateChart(${JSON.stringify(d.type)}, ${d.component});`, [reactGlobal])),
);
// Each map's geo-<name>.js registers that map. The registry sits in one place on globalThis, so the map chart in a chart file finds this map
const registry = JSON.stringify(join(lib, "src/geo/registry.ts"));
await Promise.all(
  BUILTIN_MAPS.map((name) => {
    const exported = mapExportName(name);
    return build(`geo-${name}`, `import { registerMap } from ${registry}; import { ${exported} } from ${JSON.stringify(join(lib, `src/geo/${name}.ts`))}; registerMap(${exported});`);
  }),
);
// Ships the sources and licenses of the map boundary data (ISC notice included) next to the geo-*.js files that carry that data
copyFileSync(join(lib, "NOTICE.md"), join(out, "NOTICE.md"));
console.log(`client: react + ${CHARTS.length} charts + ${BUILTIN_MAPS.length} maps -> dist/client/`);
