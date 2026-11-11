import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findFonts, getChartSchema, listCharts, reactSnippet, render, specSnippet, stripEmoji, suggest, validate } from "../src/api";
import { BUILTIN_MAPS, CHARTS } from "ztd-charts/spec";

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
    expect((await run("--version")).out.trim()).toBe("0.8.0");
    expect((await run("help")).out).toContain("ztd-charts render");
    expect((await run("help")).out).toContain("--locale <code>");
    expect((await run("--locale", "ko", "help")).out).toContain("사용법");
  });
  it("list: 44종 (표, JSON, 필터는 id와 예전 한글 이름 모두)", async () => {
    const t = await run("list");
    expect(t.out).toContain("44 charts");
    expect(t.out).toContain("Intermediate");
    expect((await run("list", "--locale=ko")).out).toContain("44종");
    const j = JSON.parse((await run("list", "--json")).out);
    expect(j).toHaveLength(44);
    const adv = JSON.parse((await run("list", "--level", "심화", "--json")).out);
    expect(adv.length).toBeGreaterThan(0);
    expect(adv.every((c: { level: string }) => c.level === "advanced")).toBe(true);
    expect(JSON.parse((await run("list", "--level", "advanced", "--json")).out)).toEqual(adv);
  });
  it("info, schema, example", async () => {
    expect((await run("info", "sankey")).out).toContain("<SankeyChart");
    const all = JSON.parse((await run("schema")).out);
    expect(all.oneOf).toHaveLength(44);
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
    // 서버 그림을 이어받는 코드(React와 도넛 하나)를 글자 그대로 넣어요. CDN도 base64도 없어요
    expect(html).toContain('id="ztd-chart-config"');
    expect(html).not.toContain("esm.sh");
    expect(html).not.toContain("data:text/javascript;base64,");
    expect(gzipSync(html).length).toBeLessThan(120_000);
  });
  it('render: a "map": "world" choropleth draws with no setup, and the interactive HTML carries that one map', async () => {
    const spec = { type: "choropleth", data: [{ c: "France", v: 3 }, { c: "Japan", v: 5 }], encoding: { region: "c", value: "v" }, options: { map: "world" } };
    writeFileSync(join(dir, "world.json"), JSON.stringify(spec));
    expect((await run("validate", "world.json")).code).toBe(0);
    await run("render", "world.json", "--out", "geo-w.svg");
    expect((readFileSync(join(dir, "geo-w.svg"), "utf8").match(/fill-rule="evenodd"/g) ?? []).length).toBeGreaterThan(160);
    await run("render", "world.json", "--out", "geo-w.png", "--scale", "1");
    expect(readFileSync(join(dir, "geo-w.png")).subarray(1, 4).toString()).toBe("PNG");
    await run("render", "world.json", "--out", "geo-w.html", "--interactive");
    const html = readFileSync(join(dir, "geo-w.html"), "utf8");
    // 세계 지도 파일 하나만 (미국 주, 한국 시도는 빼요)
    expect(html).toContain("Natural Earth 1:110m countries");
    expect(html).not.toContain("US Census Bureau");
    expect(html).not.toContain("geoBoundaries KOR");
    // "auto"도 데이터로 고른 지도를 넣어요
    writeFileSync(join(dir, "us.json"), JSON.stringify({ ...spec, data: [{ c: "CA", v: 1 }, { c: "TX", v: 2 }], options: {} }));
    await run("render", "us.json", "--out", "us.html", "--interactive");
    expect(readFileSync(join(dir, "us.html"), "utf8")).toContain("US Census Bureau");
    // React 코드는 지도를 입구에서 불러와 넘기고, 스펙 코드는 등록해요
    expect(reactSnippet(spec)).toContain('import { world } from "ztd-charts/geo/world";');
    expect(reactSnippet(spec)).toContain("map={world}");
    expect(specSnippet(spec)).toContain("registerMap(world);");
  });
  it("render: symbol and flow maps draw the same in svg, png and interactive html, and the html carries the one map the data picks", async () => {
    const spec = { type: "symbolMap", data: [{ n: "NYC", lon: -74, lat: 40.7, v: 5 }, { n: "LA", lon: -118.2, lat: 34.1, v: 3 }, { n: "Anchorage", lon: -149.9, lat: 61.2, v: 1 }], encoding: { size: "v", label: "n" } };
    writeFileSync(join(dir, "sym.json"), JSON.stringify(spec));
    expect((await run("validate", "sym.json")).code).toBe(0);
    await run("render", "sym.json", "--out", "sym.svg");
    const circles = (h: string) => [...h.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)" fill="(?!none)/g)].map((m) => m.slice(1, 4).join(" "));
    const fromCli = circles(readFileSync(join(dir, "sym.svg"), "utf8"));
    expect(fromCli).toHaveLength(3);
    expect(circles((await render(spec, { format: "svg" })).svg!)).toEqual(fromCli);
    await run("render", "sym.json", "--out", "sym.png", "--scale", "1");
    expect(readFileSync(join(dir, "sym.png")).subarray(1, 4).toString()).toBe("PNG");
    await run("render", "sym.json", "--out", "sym.html", "--interactive");
    const html = readFileSync(join(dir, "sym.html"), "utf8");
    expect(html).toContain("US Census Bureau");
    expect(html).not.toContain("Natural Earth 1:110m countries");
    expect(circles(html)).toHaveLength(3);
    const flow = { type: "flowMap", data: [{ a: "France", b: "Japan", v: 3 }, { a: "Japan", b: "France", v: 1 }], encoding: { source: "a", target: "b", value: "v" } };
    writeFileSync(join(dir, "flow.json"), JSON.stringify(flow));
    await run("render", "flow.json", "--out", "flow.html", "--interactive");
    expect(readFileSync(join(dir, "flow.html"), "utf8")).toContain("Natural Earth 1:110m countries");
    expect(reactSnippet(flow)).toContain('import { world } from "ztd-charts/geo/world";');
  });
  it("dist/client: React 한 파일과 차트마다 한 파일, 지도 출처 고지, HTML 안에서 깨지는 글자가 없어요", () => {
    const client = fileURLToPath(new URL("../dist/client", import.meta.url));
    const files = readdirSync(client).sort();
    expect(files).toEqual(["NOTICE.md", "react.js", ...CHARTS.map((d) => `${d.type}.js`), ...BUILTIN_MAPS.map((m) => `geo-${m}.js`)].sort());
    for (const f of files) expect(readFileSync(join(client, f), "utf8"), f).not.toMatch(/<\/script|<!--/i);
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
    // 한 변은 10,000px까지: 더 큰 --width, --height는 줄여서 그려요
    expect((await run("render", "donut.json", "--out", "huge.svg", "--width", "1e9", "--height", "1e9")).code).toBe(0);
    expect(/^<svg[^>]*? width="(\d+)"/.exec(readFileSync(join(dir, "huge.svg"), "utf8"))?.[1]).toBe("10000");
    expect(existsSync(join(dir, "w.svg"))).toBe(false);
    expect((await run("render", "donut.json", "--out", "t.png", "--theme", "blue")).code).toBe(1);
    const g = await run("list", "--group", "foo");
    expect(g.code).toBe(1);
    expect(g.err).toContain("proportion");
  });
});

describe("CLI API", () => {
  it("PNG 글자에서 이모지만 빼고 알려요 (©, ™, 숫자는 그대로, 화면 낭독 글은 그대로)", async () => {
    const svg = '<svg><desc>🍎 사과</desc><text x="1">🍎 사과</text><text>Apple 🍎</text><text>👍🏽 ok</text><text>🇰🇷 서울</text><text>#️⃣ 1</text><text>👨‍👩‍👧 가족</text><text>© 2025 ™ 42</text></svg>';
    const out = stripEmoji(svg);
    expect(out.removed).toBe(6);
    expect(out.svg).toBe('<svg><desc>🍎 사과</desc><text x="1">사과</text><text>Apple</text><text>ok</text><text>서울</text><text>1</text><text>가족</text><text>© 2025 ™ 42</text></svg>');
    const res = await render({ type: "bar", data: [{ k: "🍎 사과", v: 4 }, { k: "배", v: 5 }], encoding: { x: "k", y: "v" } }, { format: "png", locale: "ko" });
    expect(res.notes).toEqual(["PNG에는 이모지 글꼴이 없어서 글자에서 이모지 1개를 뺐어요. SVG와 HTML에는 그대로 있어요"]);
    expect((await render({ type: "bar", data: [{ k: "배", v: 5 }], encoding: { x: "k", y: "v" } }, { format: "png" })).notes).toBeUndefined();
  });
  it("listCharts, getChartSchema, validate, reactSnippet", () => {
    expect(listCharts()).toHaveLength(44);
    expect(listCharts({ group: "flow" }).map((c) => c.type)).toEqual(["funnel", "sankey", "chord"]);
    expect(listCharts({ group: "흐름" }).map((c) => c.type)).toEqual(["funnel", "sankey", "chord"]);
    expect(getChartSchema("violin")).toMatchObject({ properties: { type: { const: "box" } } });
    expect(validate({ type: "pie", data: [{ label: "a", value: 1 }] }).valid).toBe(true);
    const code = reactSnippet(CHARTS[0].example);
    expect(code).toContain('import { ChartCard, PieChart } from "ztd-charts"');
    expect(code).toContain('label="device"');
    // card.legend: "auto"가 string으로 넓어지지 않게 타입을 달아요 (TS에서 바로 컴파일)
    expect(specSnippet(CHARTS[0].example)).toContain("const spec: ChartSpec = {");
    const sourced = reactSnippet({ ...CHARTS[0].example, card: { title: "올해 기기 비중", source: "앱 로그", note: "10월", accent: "올해" } });
    for (const s of ['source="앱 로그"', 'note="10월"', 'accent="올해"']) expect(sourced).toContain(s);
    // 내려받기: <Chart spec>처럼 차트가 그리는 열만, 고른 형식만
    const dl = reactSnippet({ ...CHARTS[0].example, card: { title: "기기 비중", download: ["csv"] } });
    expect(dl).toContain('import { ChartCard, DownloadButtons, PieChart } from "ztd-charts";');
    expect(dl).toContain('actions={<DownloadButtons data={data} columns={["device","sales"]} filename="기기 비중" formats={["csv"]} />}');
    expect(reactSnippet(CHARTS[0].example)).not.toContain("DownloadButtons");
    // 스펙 툴팁 틀(차례 3 ⑩)은 templateTooltip(…) 함수로
    const tipped = reactSnippet({ type: "line", data: [{ m: "1월", v: 1 }], encoding: { x: "m", y: "v" }, options: { tooltip: { template: "{label} · {value}" }, locale: "ko" } });
    expect(tipped).toContain('tooltip={templateTooltip("{label} · {value}", "ko")}');
    expect(tipped).toContain('import { LineChart, templateTooltip } from "ztd-charts";');
    // 작은 여러 개(spec.facet)는 <ChartFacets>로: highlight는 패널을 고르고 다른 프롭은 chartProps로
    const faceted = reactSnippet({ type: "line", data: [{ w: "W1", r: "A", v: 1 }], encoding: { x: "w", y: "v" }, options: { highlight: "A", unit: "건" }, facet: { by: "r", columns: 4 } });
    expect(faceted).toContain('import { ChartFacets, LineChart } from "ztd-charts";');
    expect(faceted).toContain('<ChartFacets chart={LineChart} type="line" data={data} by="r" columns={4} highlight="A" chartProps={{ x: "w", y: "v", unit: "건" }} />');
    // 스펙은 믿을 수 없는 입력: 양의 정수가 아닌 columns와 두 값이 아닌 scale은 코드에서 빼고, by는 이스케이프해요
    const hostile = reactSnippet({ type: "line", data: [{ w: "W1", r: "A", v: 1 }], encoding: { x: "w", y: "v" }, facet: { by: 'r" onFocus={alert(3)} x="', columns: "2} onLoad={alert(1)" as unknown as number, scale: "free} onClick={alert(2)" as "free" } });
    expect(hostile).not.toMatch(/columns=|scale=/);
    expect(hostile).not.toContain("alert(1)");
    expect(hostile).not.toContain("alert(2)");
    // by는 JSX 속성이 아니라 문자열 식 안에만 들어가요
    expect(hostile).toContain('by={"r\\" onFocus={alert(3)} x=\\""}');
    // 네트워크 묶음(노드 이름 → 묶음 이름)도 객체 식 안의 문자열로만 들어가요
    const groups = reactSnippet({ type: "network", data: [{ from: "A", to: "B" }], encoding: { source: "from", target: "to" }, options: { groups: { '"} onClick={alert(4)} x={"': "Edge" } } });
    expect(groups).toContain('<NetworkChart data={data} source="from" target="to" groups={{"\\"} onClick={alert(4)} x={\\"":"Edge"}} />');
    // 트리의 뿌리 이름과 접을 가지 이름도 문자열 식 안에만 들어가요
    const tree = reactSnippet({ type: "tree", data: [{ g: "A", l: "B" }], encoding: { group: "g", label: "l" }, options: { rootLabel: '"/><b onClick={alert(4)}>', collapsed: ['A"} onLoad={alert(5)'] } });
    expect(tree).toContain('<Tree data={data} label="l" group="g" rootLabel={"\\"/><b onClick={alert(4)}>"} collapsed={["A\\"} onLoad={alert(5)"]} />');
    // 막대 위 선(차례 3 ⑪)도 채널이라 그대로 넘어가요
    expect(reactSnippet({ type: "bar", data: [{ m: "1월", 올해: 1, 작년: 2 }], encoding: { x: "m", y: "올해", line: "작년" } })).toContain('line="작년"');
  });
  it("render는 44종 모두 PNG로 그려요", async () => {
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
