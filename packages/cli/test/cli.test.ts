import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findFonts, getChartSchema, listCharts, reactSnippet, render, specSnippet, suggest, validate } from "../src/api";
import { CHARTS } from "ztd-charts/spec";

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "ztd-charts-"));
const run = async (...args: string[]) => {
  try {
    const r = await exec("node", [CLI, ...args], { cwd: dir, maxBuffer: 20 * 1024 * 1024 });
    return { code: 0, out: r.stdout, err: r.stderr };
  } catch (e) {
    const x = e as { code: number; stdout: string; stderr: string };
    return { code: x.code, out: x.stdout, err: x.stderr };
  }
};

let server: Server;
let base = "";
beforeAll(async () => {
  if (!existsSync(CLI)) throw new Error("먼저 pnpm build로 CLI를 빌드하세요");
  server = createServer((req, res) => {
    if (req.url?.startsWith("/sales.csv")) {
      res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
      res.end("month,revenue\n2025-01,120\n2025-02,135\n2025-03,128\n2025-04,150\n");
    } else if (req.url?.startsWith("/api")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { items: [{ day: "월", n: 3 }, { day: "화", n: 5 }] } }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => server?.close());

describe("ztd-charts CLI", () => {
  it("--version, help (기본 영어, --locale ko면 한국어)", async () => {
    expect((await run("--version")).out.trim()).toBe("0.5.0");
    expect((await run("help")).out).toContain("ztd-charts render");
    expect((await run("help")).out).toContain("--locale <code>");
    expect((await run("--locale", "ko", "help")).out).toContain("사용법");
  });
  it("list: 36종 (표, JSON, 필터는 id와 예전 한글 이름 모두)", async () => {
    const t = await run("list");
    expect(t.out).toContain("36 charts");
    expect(t.out).toContain("Intermediate");
    expect((await run("list", "--locale=ko")).out).toContain("36종");
    const j = JSON.parse((await run("list", "--json")).out);
    expect(j).toHaveLength(36);
    const adv = JSON.parse((await run("list", "--level", "심화", "--json")).out);
    expect(adv.length).toBeGreaterThan(0);
    expect(adv.every((c: { level: string }) => c.level === "advanced")).toBe(true);
    expect(JSON.parse((await run("list", "--level", "advanced", "--json")).out)).toEqual(adv);
  });
  it("info, schema, example", async () => {
    expect((await run("info", "sankey")).out).toContain("<SankeyChart");
    const all = JSON.parse((await run("schema")).out);
    expect(all.oneOf).toHaveLength(36);
    await run("schema", "pie", "--out", "pie.schema.json");
    expect(JSON.parse(readFileSync(join(dir, "pie.schema.json"), "utf8")).properties.type.const).toBe("pie");
    await run("example", "donut", "--out", "donut.json");
    expect(JSON.parse(readFileSync(join(dir, "donut.json"), "utf8")).type).toBe("donut");
    // 이름 붙은 변형: 예시 options 위에 덮어쓰고, 모르는 이름은 있는 이름을 알려 줘요
    expect(JSON.parse((await run("example", "bar", "--variant", "horizontal")).out).options.orientation).toBe("horizontal");
    const bad = await run("example", "bar", "--variant", "nope");
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("grouped, percent, horizontal");
  });
  it("validate: 성공 0, 실패 1과 메시지", async () => {
    expect((await run("validate", "donut.json")).code).toBe(0);
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ type: "pie", data: [{ a: "x", b: 1 }], encoding: { label: "aa", value: "b" } }));
    const bad = await run("validate", "bad.json");
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('Did you mean "a"?');
    expect((await run("validate", "bad.json", "--locale", "ko")).out).toContain('"a"인가요?');
    const j = JSON.parse((await run("validate", "bad.json", "--json")).out);
    expect(j.errors[0].code).toBe("field_not_found");
  });
  it("render: svg, png, html, interactive html", async () => {
    await run("render", "donut.json", "--out", "d.svg");
    expect(readFileSync(join(dir, "d.svg"), "utf8")).toMatch(/^<svg xmlns/);
    await run("render", "donut.json", "--out", "d.png", "--theme", "light", "--scale", "1");
    const png = readFileSync(join(dir, "d.png"));
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(720);
    await run("render", "donut.json", "--out", "d.html", "--interactive");
    const html = readFileSync(join(dir, "d.html"), "utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('"ztd-charts":"data:text/javascript;base64,');
  });
  it("render --locale ko: 차트 글자와 배지가 한국어", async () => {
    expect((await run("render", "donut.json", "--out", "d-en.svg")).code).toBe(0);
    expect((await run("render", "donut.json", "--out", "d-ko.svg", "--locale", "ko")).code).toBe(0);
    const en = readFileSync(join(dir, "d-en.svg"), "utf8");
    const ko = readFileSync(join(dir, "d-ko.svg"), "utf8");
    expect(en).toContain("Donut chart. 4 items, total");
    expect(en).toContain(">Basic<");
    expect(ko).toContain("도넛 차트. 4개 항목, 합계");
    expect(ko).toContain(">기본<");
  });
  it("render: data.url (CSV, JSON select)를 먼저 가져와요", async () => {
    writeFileSync(join(dir, "url.json"), JSON.stringify({ type: "line", data: { url: `${base}/sales.csv` }, encoding: { x: "month", y: "revenue" } }));
    const r = await run("render", "url.json", "--out", "u.svg");
    expect(r.code).toBe(0);
    expect(readFileSync(join(dir, "u.svg"), "utf8")).toContain("<path");
    writeFileSync(join(dir, "api.json"), JSON.stringify({ type: "bar", data: { url: `${base}/api`, select: "data.items" }, encoding: { x: "day", y: "n" } }));
    expect((await run("render", "api.json", "--out", "a.svg")).code).toBe(0);
  });
  it("init: 파일을 만들고 두 번째는 건너뛰어요", async () => {
    const r1 = await run("init", "app", "--type", "funnel");
    expect(r1.out).toContain("Created: charts/funnel.spec.json");
    const r2 = await run("init", "app", "--type", "funnel");
    expect(r2.out).toContain("Skipped (already exists)");
    expect(readdirSync(join(dir, "app/charts")).sort()).toEqual(["Dashboard.tsx", "README.md", "funnel.spec.json", "sales.csv"]);
    expect((await run("validate", "app/charts/funnel.spec.json")).code).toBe(0);
    // "npx ztd-charts" 는 명령이 없는 라이브러리 패키지라 안내 명령은 CLI 패키지 이름으로, 대시보드는 Next.js App Router에서도 돌게
    const readme = readFileSync(join(dir, "app/charts/README.md"), "utf8");
    expect(readme).toContain("npx ztd-charts-cli validate charts/funnel.spec.json");
    expect(readme).not.toMatch(/npx ztd-charts /);
    expect(readFileSync(join(dir, "app/charts/Dashboard.tsx"), "utf8").startsWith('"use client";')).toBe(true);
  });
  it("suggest: CSV, URL, --out-dir 스펙은 바로 렌더돼요", async () => {
    writeFileSync(join(dir, "stages.csv"), "stage,users\n방문,1000\n조회,620\n장바구니,190\n구매,76\n");
    const r = await run("suggest", "stages.csv", "--out-dir", "sugg");
    expect(r.out).toContain("1. Funnel chart (funnel)");
    const files = readdirSync(join(dir, "sugg"));
    expect(files[0]).toBe("01-funnel.json");
    for (const f of files) expect((await run("render", join("sugg", f), "--out", `${f}.svg`)).code).toBe(0);
    const j = JSON.parse((await run("suggest", `${base}/sales.csv`, "--json")).out);
    expect(j.suggestions[0].type).toBe("line");
  });
  it("모르는 명령과 없는 파일", async () => {
    expect((await run("nope")).code).toBe(1);
    expect((await run("validate", "없음.json")).err).toContain("File not found");
    expect((await run("validate", "없음.json", "--locale", "ko")).err).toContain("파일이 없어요");
    // 없는 데이터 파일을 빈 데이터로 읽고 0으로 끝나지 않아요
    const s = await run("suggest", "없음.csv");
    expect(s.code).toBe(1);
    expect(s.err).toContain("File not found: 없음.csv");
  });
  it("잘못된 옵션 값은 결과를 만들지 않고 1로 끝나요", async () => {
    const jpg = await run("render", "donut.json", "--out", "d.jpg");
    expect(jpg.code).toBe(1);
    expect(jpg.err).toContain(".svg, .png or .html");
    expect(existsSync(join(dir, "d.jpg"))).toBe(false);
    expect((await run("render", "donut.json", "--out", "w.svg", "--width", "abc")).err).toContain("--width takes a number above 0");
    expect(existsSync(join(dir, "w.svg"))).toBe(false);
    expect((await run("render", "donut.json", "--out", "t.png", "--theme", "blue")).code).toBe(1);
    const g = await run("list", "--group", "foo");
    expect(g.code).toBe(1);
    expect(g.err).toContain("proportion");
  });
});

describe("CLI API", () => {
  it("listCharts, getChartSchema, validate, reactSnippet", () => {
    expect(listCharts()).toHaveLength(36);
    expect(listCharts({ group: "flow" }).map((c) => c.type)).toEqual(["funnel", "sankey", "chord"]);
    expect(listCharts({ group: "흐름" }).map((c) => c.type)).toEqual(["funnel", "sankey", "chord"]);
    expect(getChartSchema("violin")).toMatchObject({ properties: { type: { const: "box" } } });
    expect(validate({ type: "pie", data: [{ label: "a", value: 1 }] }).valid).toBe(true);
    const code = reactSnippet(CHARTS[0].example);
    expect(code).toContain('import { ChartCard, PieChart } from "ztd-charts"');
    expect(code).toContain('label="device"');
    // card.legend: "auto"가 string으로 넓어지지 않게 타입을 달아요 (TS에서 바로 컴파일)
    expect(specSnippet(CHARTS[0].example)).toContain("const spec: ChartSpec = {");
  });
  it("render는 36종 모두 PNG로 그려요", async () => {
    for (const c of CHARTS) {
      const r = await render(c.example, { format: "png", width: 560, scale: 1 });
      expect(r.png!.subarray(1, 4).toString(), c.type).toBe("PNG");
      expect(r.width).toBe(560);
    }
  });
  it("render는 같은 스카이라인 스펙에서 두 번 같은 PNG를 만들어요 (기본 폭)", async () => {
    const spec = CHARTS.find((c) => c.type === "skyline")!.example;
    const [a, b] = [await render(spec, { format: "png" }), await render(spec, { format: "png" })];
    expect(a.png!.length).toBeGreaterThan(1000);
    expect(Buffer.compare(a.png!, b.png!)).toBe(0);
  });
  it("npm 패키지에 PNG용 Pretendard 다섯 굵기와 OFL 라이선스가 실려요", async () => {
    // 글꼴이 하나도 없는 리눅스(node:22-slim 같은 컨테이너)에서는 이 글꼴이 빠지면 PNG의 글자가 모두 사라져요
    const { stdout } = await exec("npm", ["pack", "--dry-run", "--json"], { cwd: fileURLToPath(new URL("..", import.meta.url)) });
    const files = (JSON.parse(stdout) as { files: { path: string }[] }[])[0].files.map((f) => f.path);
    for (const w of ["Regular", "Medium", "SemiBold", "Bold", "ExtraBold"]) expect(files).toContain(`fonts/Pretendard-${w}.otf`);
    expect(files).toContain("fonts/LICENSE.txt");
  });
  it("--font로 글꼴을 주면 패키지에 실은 Pretendard는 읽지 않아요", () => {
    const fromBundle = (list: string[]) => list.filter((f) => f.includes(`${sep}cli${sep}fonts${sep}`));
    const bundled = fromBundle(findFonts());
    expect(bundled).toHaveLength(5);
    const mine = bundled.find((f) => f.endsWith("Pretendard-Regular.otf"))!;
    expect(fromBundle(findFonts([mine]))).toEqual([mine]);
  });
  it("scatter with jitter draws the same PNG twice (fixed seed)", async () => {
    const def = CHARTS.find((c) => c.type === "scatter")!;
    const spec = { ...def.example, options: { ...def.example.options, jitter: { amount: 0.4 } } };
    const png = async (s: Parameters<typeof render>[0]) => (await render(s, { format: "png", width: 560, scale: 1 })).png!;
    const a = await png(spec);
    expect(a.equals(await png(spec))).toBe(true);
    // 흔들림이 실제로 그림을 바꿔요
    expect(a.equals(await png(def.example))).toBe(false);
  });
  it("suggest", () => {
    expect(suggest([{ value: 1, target: 2 }]).suggestions[0].type).toBe("gauge");
  });
});
