import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync, inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findFonts, getChartSchema, listCharts, reactSnippet, render, specSnippet, stripEmoji, suggest, validate } from "../src/api";
import { lightTheme, mixHex } from "ztd-charts";
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

/**
 * Color of one pixel of a PNG from render(): resvg writes 8-bit RGBA without interlacing, so inflating the IDAT chunks and undoing each row's filter is enough.
 * No PNG library, because the public repo's tests have none
 */
function pngPixel(png: Buffer): (x: number, y: number) => string {
  expect([png[24], png[25], png[28]]).toEqual([8, 6, 0]);
  const w = png.readUInt32BE(16);
  const idat: Buffer[] = [];
  for (let o = 8; o < png.length; o += png.readUInt32BE(o) + 12) if (png.toString("latin1", o + 4, o + 8) === "IDAT") idat.push(png.subarray(o + 8, o + 8 + png.readUInt32BE(o)));
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const rows = raw.length / (stride + 1);
  const px = Buffer.alloc(rows * stride);
  for (let y = 0; y < rows; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? px[y * stride + i - 4] : 0;
      const b = y ? px[(y - 1) * stride + i] : 0;
      const c = y && i >= 4 ? px[(y - 1) * stride + i - 4] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      px[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + [0, a, b, (a + b) >> 1, paeth][f]) & 255;
    }
  }
  return (x, y) => {
    const o = Math.round(y) * stride + Math.round(x) * 4;
    return `#${[px[o], px[o + 1], px[o + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  };
}
/** Whether two #RRGGBB colors differ by at most 2 in every channel */
const near = (a: string, b: string) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 2);

let server: Server;
let base = "";
beforeAll(async () => {
  if (!existsSync(CLI)) throw new Error("Build the CLI first with pnpm build");
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
  it("--version, help (English by default, Korean with --locale ko)", async () => {
    expect((await run("--version")).out.trim()).toBe("0.13.1");
    expect((await run("help")).out).toContain("ztd-charts render");
    expect((await run("help")).out).toContain("--locale <code>");
    expect((await run("--locale", "ko", "help")).out).toContain("사용법");
  });
  it("<command> --help prints that command's usage and runs nothing; an unknown command still fails", async () => {
    const h = mkdtempSync(join(tmpdir(), "ztd-help-"));
    writeFileSync(join(h, "spec.json"), JSON.stringify({ type: "pie", data: [{ label: "a", value: 1 }] }));
    const inH = async (...args: string[]) => {
      try {
        const r = await exec("node", [CLI, ...args], { cwd: h });
        return { code: 0, out: r.stdout };
      } catch (e) {
        const x = e as { code: number; stdout: string };
        return { code: x.code, out: x.stdout };
      }
    };
    for (const cmd of ["list", "info", "schema", "example", "validate", "render", "init", "suggest", "snippet"]) {
      const r = await inH(cmd, "--help");
      expect(r.code, cmd).toBe(0);
      expect(r.out, cmd).toContain(`ztd-charts ${cmd}`);
      expect(r.out.match(/^ {2}ztd-charts /gm), cmd).toHaveLength(1);
    }
    expect((await inH("render", "spec.json", "-h")).out).toContain("--out chart.svg");
    expect((await inH("init", "--help")).code).toBe(0);
    expect(readdirSync(h)).toEqual(["spec.json"]);
    expect((await inH("--locale", "ko", "render", "--help")).out).toContain("사용법");
    expect((await inH("rendr", "--help")).code).toBe(1);
    expect((await run("help")).out).toContain("ztd-charts snippet <spec.json>");
  });
  it("list: 47 charts (table, JSON, the level filter takes the id or the old Korean name)", async () => {
    const t = await run("list");
    expect(t.out).toContain("47 charts");
    expect(t.out).toContain("Intermediate");
    expect((await run("list", "--locale=ko")).out).toContain("47종");
    const j = JSON.parse((await run("list", "--json")).out);
    expect(j).toHaveLength(47);
    const adv = JSON.parse((await run("list", "--level", "심화", "--json")).out);
    expect(adv.length).toBeGreaterThan(0);
    expect(adv.every((c: { level: string }) => c.level === "advanced")).toBe(true);
    expect(JSON.parse((await run("list", "--level", "advanced", "--json")).out)).toEqual(adv);
  });
  it("info, schema, example", async () => {
    expect((await run("info", "sankey")).out).toContain("<SankeyChart");
    const all = JSON.parse((await run("schema")).out);
    expect(all.oneOf).toHaveLength(47);
    await run("schema", "pie", "--out", "pie.schema.json");
    expect(JSON.parse(readFileSync(join(dir, "pie.schema.json"), "utf8")).properties.type.const).toBe("pie");
    await run("example", "donut", "--out", "donut.json");
    expect(JSON.parse(readFileSync(join(dir, "donut.json"), "utf8")).type).toBe("donut");
    // Named variants: applied over the example's options, and an unknown name lists the names that exist
    expect(JSON.parse((await run("example", "bar", "--variant", "horizontal")).out).options.orientation).toBe("horizontal");
    const bad = await run("example", "bar", "--variant", "nope");
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("grouped, percent, horizontal");
  });
  it("validate: 0 on success, 1 and a message on failure", async () => {
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
    // The code that hydrates the server-drawn chart (React and one donut) is inlined as plain text. No CDN, no base64
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
    // Only the world map file (US states and Korean provinces are left out)
    expect(html).toContain("Natural Earth 1:110m countries");
    expect(html).not.toContain("US Census Bureau");
    expect(html).not.toContain("geoBoundaries KOR");
    // "auto" also embeds the map the data picks
    writeFileSync(join(dir, "us.json"), JSON.stringify({ ...spec, data: [{ c: "CA", v: 1 }, { c: "TX", v: 2 }], options: {} }));
    await run("render", "us.json", "--out", "us.html", "--interactive");
    expect(readFileSync(join(dir, "us.html"), "utf8")).toContain("US Census Bureau");
    // The React snippet imports the map from its entry point and passes it in; the spec snippet registers it
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
  it("dist/client: one React file and one file per chart, the map attribution notice, no text that breaks inside HTML", () => {
    const client = fileURLToPath(new URL("../dist/client", import.meta.url));
    const files = readdirSync(client).sort();
    expect(files).toEqual(["NOTICE.md", "react.js", ...CHARTS.map((d) => `${d.type}.js`), ...BUILTIN_MAPS.map((m) => `geo-${m}.js`)].sort());
    for (const f of files) expect(readFileSync(join(client, f), "utf8"), f).not.toMatch(/<\/script|<!--/i);
  });
  it("render --locale ko: chart text and badges are in Korean", async () => {
    expect((await run("render", "donut.json", "--out", "d-en.svg")).code).toBe(0);
    expect((await run("render", "donut.json", "--out", "d-ko.svg", "--locale", "ko")).code).toBe(0);
    const en = readFileSync(join(dir, "d-en.svg"), "utf8");
    const ko = readFileSync(join(dir, "d-ko.svg"), "utf8");
    expect(en).toContain("Donut chart. 4 items, total");
    expect(en).toContain(">Basic<");
    expect(ko).toContain("도넛 차트. 4개 항목, 합계");
    expect(ko).toContain(">기본<");
  });
  it("render: fetches data.url (CSV, JSON select) first", async () => {
    writeFileSync(join(dir, "url.json"), JSON.stringify({ type: "line", data: { url: `${base}/sales.csv` }, encoding: { x: "month", y: "revenue" } }));
    const r = await run("render", "url.json", "--out", "u.svg");
    expect(r.code).toBe(0);
    expect(readFileSync(join(dir, "u.svg"), "utf8")).toContain("<path");
    writeFileSync(join(dir, "api.json"), JSON.stringify({ type: "bar", data: { url: `${base}/api`, select: "data.items" }, encoding: { x: "day", y: "n" } }));
    expect((await run("render", "api.json", "--out", "a.svg")).code).toBe(0);
  });
  it("init: creates the files and skips them the second time", async () => {
    const r1 = await run("init", "app", "--type", "funnel");
    expect(r1.out).toContain("Created: charts/funnel.spec.json");
    const r2 = await run("init", "app", "--type", "funnel");
    expect(r2.out).toContain("Skipped (already exists)");
    expect(readdirSync(join(dir, "app/charts")).sort()).toEqual(["Dashboard.tsx", "README.md", "funnel.spec.json", "sales.csv"]);
    expect((await run("validate", "app/charts/funnel.spec.json")).code).toBe(0);
    // "npx ztd-charts" is the library package, which has no command, so the instructions use the CLI package name; the dashboard is made to run in the Next.js App Router too
    const readme = readFileSync(join(dir, "app/charts/README.md"), "utf8");
    expect(readme).toContain("npx ztd-charts-cli validate charts/funnel.spec.json");
    expect(readme).not.toMatch(/npx ztd-charts /);
    expect(readFileSync(join(dir, "app/charts/Dashboard.tsx"), "utf8").startsWith('"use client";')).toBe(true);
  });
  it("suggest: CSV, URL, --out-dir specs render as is", async () => {
    writeFileSync(join(dir, "stages.csv"), "stage,users\n방문,1000\n조회,620\n장바구니,190\n구매,76\n");
    const r = await run("suggest", "stages.csv", "--out-dir", "sugg");
    expect(r.out).toContain("1. Funnel chart (funnel)");
    const files = readdirSync(join(dir, "sugg"));
    expect(files[0]).toBe("01-funnel.json");
    for (const f of files) expect((await run("render", join("sugg", f), "--out", `${f}.svg`)).code).toBe(0);
    const j = JSON.parse((await run("suggest", `${base}/sales.csv`, "--json")).out);
    expect(j.suggestions[0].type).toBe("line");
  });
  it("unknown command and missing file", async () => {
    expect((await run("nope")).code).toBe(1);
    expect((await run("validate", "없음.json")).err).toContain("File not found");
    expect((await run("validate", "없음.json", "--locale", "ko")).err).toContain("파일이 없어요");
    // A missing data file is not read as empty data with exit code 0
    const s = await run("suggest", "없음.csv");
    expect(s.code).toBe(1);
    expect(s.err).toContain("File not found: 없음.csv");
  });
  it("an invalid option value makes no output and exits with 1", async () => {
    const jpg = await run("render", "donut.json", "--out", "d.jpg");
    expect(jpg.code).toBe(1);
    expect(jpg.err).toContain(".svg, .png or .html");
    expect(existsSync(join(dir, "d.jpg"))).toBe(false);
    expect((await run("render", "donut.json", "--out", "w.svg", "--width", "abc")).err).toContain("--width takes a number above 0");
    // Each side is capped at 10,000px: a larger --width or --height is reduced
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
  it("strips only emoji from PNG text and reports it (©, ™ and digits stay, screen reader text stays)", async () => {
    const svg = '<svg><desc>🍎 사과</desc><text x="1">🍎 사과</text><text>Apple 🍎</text><text>👍🏽 ok</text><text>🇰🇷 서울</text><text>#️⃣ 1</text><text>👨‍👩‍👧 가족</text><text>© 2025 ™ 42</text></svg>';
    const out = stripEmoji(svg);
    expect(out.removed).toBe(6);
    expect(out.svg).toBe('<svg><desc>🍎 사과</desc><text x="1">사과</text><text>Apple</text><text>ok</text><text>서울</text><text>1</text><text>가족</text><text>© 2025 ™ 42</text></svg>');
    const res = await render({ type: "bar", data: [{ k: "🍎 사과", v: 4 }, { k: "배", v: 5 }], encoding: { x: "k", y: "v" } }, { format: "png", locale: "ko" });
    expect(res.notes).toEqual(["PNG에는 이모지 글꼴이 없어서 글자에서 이모지 1개를 뺐어요. SVG와 HTML에는 그대로 있어요"]);
    expect((await render({ type: "bar", data: [{ k: "배", v: 5 }], encoding: { x: "k", y: "v" } }, { format: "png" })).notes).toBeUndefined();
  });
  it("listCharts, getChartSchema, validate, reactSnippet", () => {
    expect(listCharts()).toHaveLength(47);
    expect(listCharts({ group: "flow" }).map((c) => c.type)).toEqual(["funnel", "sankey", "chord"]);
    expect(listCharts({ group: "흐름" }).map((c) => c.type)).toEqual(["funnel", "sankey", "chord"]);
    expect(getChartSchema("violin")).toMatchObject({ properties: { type: { const: "box" } } });
    expect(validate({ type: "pie", data: [{ label: "a", value: 1 }] }).valid).toBe(true);
    const code = reactSnippet(CHARTS[0].example);
    expect(code).toContain('import { ChartCard, PieChart } from "ztd-charts"');
    expect(code).toContain('label="device"');
    // Adds a type so card.legend: "auto" does not widen to string (compiles as is in TS)
    expect(specSnippet(CHARTS[0].example)).toContain("const spec: ChartSpec = {");
    const sourced = reactSnippet({ ...CHARTS[0].example, card: { title: "올해 기기 비중", source: "앱 로그", note: "10월", accent: "올해" } });
    for (const s of ['source="앱 로그"', 'note="10월"', 'accent="올해"']) expect(sourced).toContain(s);
    // Download: as with <Chart spec>, only the columns the chart draws and only the chosen formats
    const dl = reactSnippet({ ...CHARTS[0].example, card: { title: "기기 비중", download: ["csv"] } });
    expect(dl).toContain('import { ChartCard, DownloadButtons, PieChart } from "ztd-charts";');
    expect(dl).toContain('actions={<DownloadButtons data={data} columns={["device","sales"]} filename="기기 비중" formats={["csv"]} />}');
    expect(reactSnippet(CHARTS[0].example)).not.toContain("DownloadButtons");
    // A spec tooltip template becomes a templateTooltip(…) call
    const tipped = reactSnippet({ type: "line", data: [{ m: "1월", v: 1 }], encoding: { x: "m", y: "v" }, options: { tooltip: { template: "{label} · {value}" }, locale: "ko" } });
    expect(tipped).toContain('tooltip={templateTooltip("{label} · {value}", "ko")}');
    expect(tipped).toContain('import { LineChart, templateTooltip } from "ztd-charts";');
    // Small multiples (spec.facet) become <ChartFacets>: highlight picks the panel, and the other props go to chartProps
    const faceted = reactSnippet({ type: "line", data: [{ w: "W1", r: "A", v: 1 }], encoding: { x: "w", y: "v" }, options: { highlight: "A", unit: "건" }, facet: { by: "r", columns: 4 } });
    expect(faceted).toContain('import { ChartFacets, LineChart } from "ztd-charts";');
    expect(faceted).toContain('<ChartFacets chart={LineChart} type="line" data={data} by="r" columns={4} highlight="A" chartProps={{ x: "w", y: "v", unit: "건" }} />');
    // The spec is untrusted input: a columns value that is not a positive integer and a scale value that is not one of its two values are left out of the code, and by is escaped
    const hostile = reactSnippet({ type: "line", data: [{ w: "W1", r: "A", v: 1 }], encoding: { x: "w", y: "v" }, facet: { by: 'r" onFocus={alert(3)} x="', columns: "2} onLoad={alert(1)" as unknown as number, scale: "free} onClick={alert(2)" as "free" } });
    expect(hostile).not.toMatch(/columns=|scale=/);
    expect(hostile).not.toContain("alert(1)");
    expect(hostile).not.toContain("alert(2)");
    // by goes only inside a string expression, not into a quoted JSX attribute
    expect(hostile).toContain('by={"r\\" onFocus={alert(3)} x=\\""}');
    // Network groups (node name → group name) also go in only as strings inside an object expression
    const groups = reactSnippet({ type: "network", data: [{ from: "A", to: "B" }], encoding: { source: "from", target: "to" }, options: { groups: { '"} onClick={alert(4)} x={"': "Edge" } } });
    expect(groups).toContain('<NetworkChart data={data} source="from" target="to" groups={{"\\"} onClick={alert(4)} x={\\"":"Edge"}} />');
    // The tree's root label and the names of branches to collapse also go only inside string expressions
    const tree = reactSnippet({ type: "tree", data: [{ g: "A", l: "B" }], encoding: { group: "g", label: "l" }, options: { rootLabel: '"/><b onClick={alert(4)}>', collapsed: ['A"} onLoad={alert(5)'] } });
    expect(tree).toContain('<Tree data={data} label="l" group="g" rootLabel={"\\"/><b onClick={alert(4)}>"} collapsed={["A\\"} onLoad={alert(5)"]} />');
    // The line over bars is a channel too, so it passes through as is
    expect(reactSnippet({ type: "bar", data: [{ m: "1월", 올해: 1, 작년: 2 }], encoding: { x: "m", y: "올해", line: "작년" } })).toContain('line="작년"');
  });
  it("render draws all 47 charts as PNG", async () => {
    for (const c of CHARTS) {
      const r = await render(c.example, { format: "png", width: 560, scale: 1 });
      expect(r.png!.subarray(1, 4).toString(), c.type).toBe("PNG");
      expect(r.width).toBe(560);
    }
  });
  it("render: a horizon band redrawn with <use> keeps its own color in the PNG", async () => {
    // B is 10 (15 / 2 rounded up), so 15 fills band 1 and the lower half of band 2: band 2's color in the lower half of the row, band 1's above it
    const spec = { type: "horizon", data: Array.from({ length: 10 }, (_, i) => ({ t: i, s: "A", v: 15 })), encoding: { x: "t", y: "v", series: "s" }, options: { bands: 2, legend: false, showValues: false } };
    const svg = (await render(spec, { format: "svg", width: 400, theme: "light" })).svg!;
    expect(svg).toMatch(/<use href="#[^"]+" y="[^"]+" fill="#[0-9A-F]{6}"><\/use>/i);
    const [x, y, w, h] = /<clipPath id="[^"]+"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(svg)!.slice(1).map(Number);
    const at = pngPixel((await render(spec, { format: "png", width: 400, theme: "light", scale: 1 })).png!);
    // The chart sits at the 24px padding of an image without a card
    const band2 = mixHex(lightTheme.accent, lightTheme.ink, 0.6);
    expect(at(24 + x + w / 2, 24 + y + h * 0.78), "band 2").toSatisfy((c: string) => near(c, band2));
    expect(at(24 + x + w / 2, 24 + y + h * 0.22), "band 1").toSatisfy((c: string) => near(c, lightTheme.accent));
  });
  it("render makes the same PNG twice from the same skyline spec (default width)", async () => {
    const spec = CHARTS.find((c) => c.type === "skyline")!.example;
    const [a, b] = [await render(spec, { format: "png" }), await render(spec, { format: "png" })];
    expect(a.png!.length).toBeGreaterThan(1000);
    expect(Buffer.compare(a.png!, b.png!)).toBe(0);
  });
  it("the npm package ships five Pretendard weights for PNG and the OFL license", async () => {
    // On Linux with no fonts at all (containers like node:22-slim), all PNG text disappears when these fonts are missing
    const { stdout } = await exec("npm", ["pack", "--dry-run", "--json"], { cwd: fileURLToPath(new URL("..", import.meta.url)) });
    const files = (JSON.parse(stdout) as { files: { path: string }[] }[])[0].files.map((f) => f.path);
    for (const w of ["Regular", "Medium", "SemiBold", "Bold", "ExtraBold"]) expect(files).toContain(`fonts/Pretendard-${w}.otf`);
    expect(files).toContain("fonts/LICENSE.txt");
  });
  it("with --font, the bundled Pretendard is not read", () => {
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
    // The jitter really changes the image
    expect(a.equals(await png(def.example))).toBe(false);
  });
  it("scatter with group outlines (hull) draws the same PNG twice", async () => {
    const def = CHARTS.find((c) => c.type === "scatter")!;
    const spec = { ...def.example, options: { ...def.example.options, hull: true } };
    const png = async (s: Parameters<typeof render>[0]) => (await render(s, { format: "png", width: 560, scale: 1 })).png!;
    const a = await png(spec);
    expect(a.equals(await png(spec))).toBe(true);
    // The outlines really change the image
    expect(a.equals(await png(def.example))).toBe(false);
  });
  it("suggest", () => {
    expect(suggest([{ value: 1, target: 2 }]).suggestions[0].type).toBe("gauge");
  });
});
