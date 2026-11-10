// render --interactive 로 내보낸 HTML이 서버 그림을 이어받을 때 쓰는 브라우저 코드를 dist/client/ 에 만들어요.
// react.js 는 React, React DOM client, JSX 런타임을 globalThis.__ztdReact 에 올리고, <type>.js 는 그 차트 하나와 스펙 렌더러, 이어받기 시작점을 담아요.
// api.ts 의 clientScript 가 react.js 와 그 차트의 파일 하나를 HTML에 글자 그대로 넣어요 (CDN, base64, import map 없음)
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHARTS } from "ztd-charts/spec";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
// 새 의존성 없이 tsup 이 쓰는 esbuild 를 빌려요
const esbuild = createRequire(require.resolve("tsup"))("esbuild");
// 작업 공간의 라이브러리 소스를 묶어요. package.json 의 "sideEffects": false 덕에 쓰지 않는 차트 35종은 빠져요
const lib = dirname(require.resolve("ztd-charts/package.json"));
const out = join(root, "dist/client");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 차트 파일의 React import 는 react.js 가 올린 전역을 읽어요. 그래서 React 는 페이지에 한 벌만 있어요
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
  // <script> 안에 그대로 넣으므로 태그를 닫거나 주석을 여는 글자가 있으면 멈춰요 (esbuild 는 브라우저용 출력에서 </script> 를 이미 바꿔 줘요)
  if (/<\/script|<!--/i.test(code)) throw new Error(`${name}: </script or <!-- left in the bundle`);
  writeFileSync(join(out, `${name}.js`), code);
}

await build("react", `import * as R from "react"; import * as J from "react/jsx-runtime"; import * as C from "react-dom/client"; globalThis.__ztdReact = { react: R, "react/jsx-runtime": J, "react-dom/client": C };`);
const hydrate = JSON.stringify(join(lib, "src/client/hydrate.tsx"));
const index = JSON.stringify(join(lib, "src/index.ts"));
await Promise.all(
  CHARTS.map((d) => build(d.type, `import { hydrateChart } from ${hydrate}; import { ${d.component} } from ${index}; hydrateChart(${JSON.stringify(d.type)}, ${d.component});`, [reactGlobal])),
);
console.log(`client: react + ${CHARTS.length} charts -> dist/client/`);
