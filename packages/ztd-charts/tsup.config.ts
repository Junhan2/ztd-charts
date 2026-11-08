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
    // 브라우저에서 import map으로 바로 쓰는 한 파일짜리 번들 (CLI의 --interactive HTML)
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
