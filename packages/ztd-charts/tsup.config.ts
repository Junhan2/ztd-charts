import { defineConfig } from "tsup";

const external = ["react", "react-dom", "react-dom/server", "react/jsx-runtime"];
// 한글을 \uXXXX로 바꾸지 않아요 (글자당 6바이트 -> 3바이트)
const esbuildOptions = (o: { charset?: string }) => {
  o.charset = "utf8";
};
// 소스 맵은 싣지 않아요: npm 묶음 크기의 60% 였고, 배포 JS 는 압축하지 않아 그대로 읽혀요

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
    // 지도 경계는 입구마다 따로예요 (ztd-charts/geo/world 등). 지도를 그리지 않는 쪽은 경계 데이터를 싣지 않아요.
    // index, spec과 따로 묶어서 그 둘의 조각 나눔이 그대로예요 (작은 이름표 krRegions, usStates만 입구마다 한 벌씩 들어요)
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
    // 브라우저에서 import map으로 바로 쓰는 한 파일짜리 번들 (renderSpecToHTML의 예전 { libraryUrl } 방식. CLI --interactive는 이제 차트 하나만 실은 dist/client를 써요)
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
