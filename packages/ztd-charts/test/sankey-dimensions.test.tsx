import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SankeyChart, type SankeyChartProps } from "../src/charts/sankey";
import { numGetter, strGetter } from "../src/data/accessor";
import { dimensionLinks, sankeyLayout } from "../src/layout/sankey";
import { renderSpecToSVG } from "../src/server";
import { CHARTS, suggestCharts, validateSpec, variantSpec } from "../src/spec";
import { resolveMeta } from "../src/spec/meta";
import { sankeyStagesSample } from "../src/spec/samples";

/**
 * Sankey stages from a wide table (encoding.dimensions): each row is one path through the stage columns, left to right.
 * Node ids carry the column, so a name in two columns is two nodes. A column with more than 12 values keeps the 11 largest plus "Other (n)",
 * and an empty cell is a "(blank)" node, so every row passes every column. The rows through the highlighted (or pointed) node are drawn over the gray links in the accent color
 */

type Row = Record<string, unknown>;
const NAMES = { blank: "(blank)", other: (n: number) => `Other (${n})` };
/** dimensionLinks over field names, then sankeyLayout as the chart calls it */
function stages(rows: Row[], dims: string[], value?: string) {
  const flow = dimensionLinks(rows, dims.map((f) => strGetter<Row>(f, f)), value ? numGetter<Row>(value, value) : () => 1, NAMES);
  return { ...flow, layout: sankeyLayout(flow.nodes, flow.links, { width: 400, height: 300 }) };
}
const draw = (data: Row[], props: Partial<SankeyChartProps<Row>>) => renderToStaticMarkup(<SankeyChart data={data} width={640} animate={false} {...props} />);
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
/** The screen reader table: [name, value] per node, then per link */
const table = (h: string) => [...h.matchAll(/<tr><th scope="row">([^<]*)<\/th><td>([^<]*)<\/td><\/tr>/g)].map((m) => [decode(m[1]), decode(m[2])]);
/** Column titles: the text at the top (y 9) with its anchor */
const titles = (h: string) => [...h.matchAll(/<text x="([-\d.]+)" y="9"[^>]*text-anchor="(\w+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: +m[1], anchor: m[2], text: decode(m[3]) }));
/** Link bands (paths drawn with curves): source x, top at both ends, width at the source end, and whether the fill is the accent color */
const bands = (h: string) =>
  [...h.matchAll(/<path ([^>]*)>/g)]
    .map((m) => ({ d: /d="([^"]*)"/.exec(m[1])?.[1] ?? "", fill: /fill="([^"]*)"/.exec(m[1])?.[1] ?? "" }))
    .filter((b) => /^M[-\d.]+,[-\d.]+C/.test(b.d))
    .map((b) => {
      const n = b.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      return { x: n[0], top: n[1], endTop: n[7], width: n[15] - n[1], accent: b.fill.includes("accent") };
    });

/** Same summary as the structure snapshot in render.test.tsx */
function summarize(svg: string) {
  const count = (re: RegExp) => (svg.match(re) ?? []).length;
  return { paths: count(/<path /g), rects: count(/<rect /g), circles: count(/<circle /g), lines: count(/<line /g), sha1: createHash("sha1").update(svg).digest("hex").slice(0, 12) };
}

describe("sankey stages (encoding.dimensions)", () => {
  it("a name in two columns is two nodes, and screen readers hear its column with it", () => {
    const rows = [
      { before: "Active", after: "Active", n: 5 },
      { before: "Active", after: "Churned", n: 2 },
      { before: "Trial", after: "Active", n: 3 },
    ];
    const s = stages(rows, ["before", "after"], "n");
    expect(s.layout.nodes.filter((n) => n.label === "Active").map((n) => [n.layer, n.value])).toEqual([
      [0, 7],
      [1, 8],
    ]);
    expect(new Set(s.nodes.map((n) => n.id)).size).toBe(s.nodes.length);
    const names = table(draw(rows, { dimensions: ["before", "after"], value: "n", dimensionLabels: { before: "Day 0" } })).map(([name]) => name);
    // Nodes column by column in order of first appearance, then the links
    expect(names.slice(0, 4)).toEqual(["Day 0: Active", "Day 0: Trial", "after: Active", "after: Churned"]);
    expect(names).toContain("Day 0: Active → after: Active");
  });

  it("columns are laid out left to right in the order given, at most 6, with titles left, centered and right", () => {
    const rows = Array.from({ length: 40 }, (_, i) => Object.fromEntries("abcdefg".split("").map((k, j) => [k, `${k}${(i * (j + 1)) % 3}`])));
    const order = ["c", "a", "g", "b"];
    for (const n of stages(rows, order).layout.nodes) expect(n.layer, n.id).toBe(order.indexOf(n.label[0]));
    // Seven fields: only the first 6 are drawn
    const h = draw(rows, { dimensions: ["g", "f", "e", "d", "c", "b", "a"], dimensionLabels: { g: "First", b: "Last" } });
    const t = titles(h);
    expect(t.map((x) => x.text)).toEqual(["First", "f", "e", "d", "c", "Last"]);
    expect(t.map((x) => x.anchor)).toEqual(["start", "middle", "middle", "middle", "middle", "end"]);
    expect([t[0].x, t[5].x]).toEqual([0, 640]);
    expect(table(h).some(([name]) => name.startsWith("a: "))).toBe(false);
  });

  it("a column with more than 12 values keeps the 11 with the largest totals and groups the rest into Other (n), placed last", () => {
    // 15 cities with totals 15, 14 … 1, smallest first in the data
    const rows = Array.from({ length: 15 }, (_, i) => ({ city: `City ${15 - i}`, plan: i % 2 ? "Pro" : "Free", n: i + 1 }));
    const s = stages(rows, ["city", "plan"], "n");
    const city = s.layout.nodes.filter((n) => n.layer === 0);
    expect(city.map((n) => n.label)).toEqual([...Array.from({ length: 11 }, (_, i) => `City ${11 - i}`), "Other (4)"]);
    expect(city.at(-1)!.value).toBe(4 + 3 + 2 + 1);
    expect(s.grouped).toEqual([4, 0]);
    expect(draw(rows, { dimensions: ["city", "plan"], value: "n", locale: "ko" })).toContain("기타 4개");
    const spec = { type: "sankey", data: rows, encoding: { dimensions: ["city", "plan"], value: "n" } };
    const w = validateSpec(spec).warnings;
    expect(w.map((x) => `${x.path}:${x.code}`)).toEqual(["encoding.dimensions:dimension_grouped"]);
    expect(w[0].message).toBe('"city" has 15 values, so the 11 with the largest totals stay and the other 4 are grouped into "Other (4)"');
    expect(validateSpec(spec, { lang: "ko" }).warnings[0].message).toBe('"city" 값이 15개라 합계가 큰 11개만 두고 나머지 4개는 "기타 4개"로 묶어요');
  });

  it("empty cells are a (blank) node, so every row passes every column; without value each row counts 1", () => {
    const rows: Row[] = [
      { plan: "Free", feature: "Charts", n: 3 },
      { plan: "Free", feature: "", n: 2 },
      { plan: "Pro", feature: null, n: 4 },
      { plan: "Pro", n: 1 },
    ];
    const s = stages(rows, ["plan", "feature"], "n");
    expect(s.layout.nodes.filter((n) => n.label === "(blank)").map((n) => [n.layer, n.value])).toEqual([[1, 7]]);
    for (const layer of [0, 1]) expect(s.layout.nodes.filter((n) => n.layer === layer).reduce((a, n) => a + n.value, 0)).toBe(10);
    expect(draw(rows, { dimensions: ["plan", "feature"], value: "n", locale: "ko" })).toContain("(빈 값)");
    const counted = table(draw(rows.map(({ n: _n, ...r }) => r), { dimensions: ["plan", "feature"] }));
    expect(counted.slice(0, 2)).toEqual([
      ["plan: Free", "2"],
      ["plan: Pro", "2"],
    ]);
  });

  it("the highlighted node's rows are drawn over the links on their top edges, and in every gap they add up to that node's value", () => {
    const total = sankeyStagesSample.reduce((a, r) => a + r.users, 0);
    const sum = (field: "feature" | "day30", v: string) => sankeyStagesSample.filter((r) => r[field] === v).reduce((a, r) => a + r.users, 0);
    // Export by name, then the default: the largest node of the last column (Active)
    for (const [highlight, share] of [
      ["Export", sum("feature", "Export")],
      [undefined, sum("day30", "Active")],
    ] as const) {
      const all = bands(draw(sankeyStagesSample, { dimensions: ["plan", "feature", "day30"], value: "users", ...(highlight && { highlight }) }));
      const base = all.filter((b) => !b.accent);
      const over = all.filter((b) => b.accent);
      const gaps = [...new Set(base.map((b) => b.x))];
      expect(gaps).toHaveLength(2);
      expect(over.length).toBeGreaterThan(2);
      for (const x of gaps) {
        const width = (list: typeof all) => list.filter((b) => b.x === x).reduce((a, b) => a + b.width, 0);
        expect(width(over) / width(base), `${highlight} gap ${x}`).toBeCloseTo(share / total, 2);
      }
      // Each band starts and ends on the top edge of a gray link
      for (const o of over) expect(base.some((b) => b.x === o.x && Math.abs(b.top - o.top) < 0.05 && Math.abs(b.endTop - o.endTop) < 0.05 && b.width > o.width - 0.05)).toBe(true);
    }
  });

  it("link input draws what it drew before: the default example and the existing variants keep their fingerprints", () => {
    const def = CHARTS.find((c) => c.type === "sankey")!;
    const shot = (spec: typeof def.example) => summarize(renderSpecToSVG(spec, { width: 720, theme: "dark", frame: false }));
    // The sankey entry of render.test.tsx.snap, and the variants as drawn before dimensions were added
    expect(shot(def.example)).toEqual({ paths: 20, rects: 4, circles: 0, lines: 0, sha1: "4e3a613f21cf" });
    expect(shot(variantSpec(def, "wide-nodes")!).sha1).toBe("de9584d6f0a0");
    expect(shot(variantSpec(def, "roomy")!).sha1).toBe("7b1f89d10910");
  });

  it("the validator: fewer than 2 columns is an error; more than 6, and source or target with dimensions, are warnings", () => {
    const rows = Array.from({ length: 4 }, (_, i) => Object.fromEntries("abcdefg".split("").map((k) => [k, `${k}${i % 2}`])));
    const check = (encoding: Record<string, unknown>, lang?: "ko") => validateSpec({ type: "sankey", data: rows, encoding }, lang && { lang });
    const codes = (encoding: Record<string, unknown>) => {
      const r = check(encoding);
      return [...r.errors.map((e) => `${e.path}:${e.code}`), ...r.warnings.map((w) => `!${w.path}:${w.code}`)];
    };
    expect(codes({ dimensions: ["a", "b"] })).toEqual([]);
    expect(codes({ dimensions: ["a"] })).toEqual(["encoding.dimensions:bad_dimensions"]);
    expect(codes({ dimensions: "a" })).toEqual(["encoding.dimensions:bad_dimensions"]);
    expect(codes({ dimensions: ["a", "b", "c", "d", "e", "f", "g"] })).toEqual(["!encoding.dimensions:too_many_dimensions"]);
    expect(codes({ dimensions: ["a", "b"], source: "a", target: "b" })).toEqual(["!encoding.source:dimensions_with_links"]);
    // Without dimensions, source, target and value are required as before
    expect(codes({})).toEqual(["encoding.source:missing_channel", "encoding.target:missing_channel", "encoding.value:missing_channel"]);
    const messages = (encoding: Record<string, unknown>, lang?: "ko") => [...check(encoding, lang).errors, ...check(encoding, lang).warnings].map((i) => i.message);
    expect(messages({ dimensions: ["a"] })).toEqual(["encoding.dimensions needs 2 or more fields, one per stage column (got 1)"]);
    expect(messages({ dimensions: ["a"] }, "ko")).toEqual(["encoding.dimensions에는 단계 열마다 필드 하나씩 2개 이상이 필요해요(지금 1개)"]);
    expect(messages({ dimensions: ["a", "b", "c", "d", "e", "f", "g"] })).toEqual(["A Sankey diagram draws up to 6 stage columns, so only the first 6 of 7 are used"]);
    expect(messages({ dimensions: ["a", "b", "c", "d", "e", "f", "g"] }, "ko")).toEqual(["생키 다이어그램은 단계 열을 6개까지 그려요. 7개 중 앞의 6개만 써요"]);
    expect(messages({ dimensions: ["a", "b"], source: "a" })).toEqual(["encoding.dimensions is set, so source and target are not used: each row is one path through the dimensions"]);
    expect(messages({ dimensions: ["a", "b"], source: "a" }, "ko")).toEqual(["encoding.dimensions가 있어서 source와 target은 쓰지 않아요. 행마다 dimensions 열을 지나는 경로 하나예요"]);
  });

  it("suggests stages for 3 or more category columns of 2 to 12 values with no date, source or target; the variant and the aliases", () => {
    const s = suggestCharts(sankeyStagesSample).suggestions.find((x) => x.type === "sankey");
    expect(s).toMatchObject({ score: 0.78, spec: { encoding: { dimensions: ["plan", "feature", "day30"], value: "users" } } });
    expect(validateSpec(s!.spec).errors).toEqual([]);
    // Two category columns keep their suggestions (heatmap first), with no sankey
    const two = suggestCharts(sankeyStagesSample.map(({ day30: _d, ...r }) => r)).suggestions.map((x) => x.type);
    expect(two[0]).toBe("heatmap");
    expect(two).not.toContain("sankey");
    // A date column turns the rule off
    expect(suggestCharts(sankeyStagesSample.map((r, i) => ({ ...r, date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}` }))).suggestions.map((x) => x.type)).not.toContain("sankey");
    const def = CHARTS.find((c) => c.type === "sankey")!;
    const variant = variantSpec(def, "stages")!;
    expect(variant.encoding).toEqual({ value: "users", dimensions: ["plan", "feature", "day30"] });
    expect(validateSpec(variant)).toMatchObject({ valid: true, warnings: [] });
    for (const alias of ["alluvial", "parallelSets"]) expect(resolveMeta(alias)?.type, alias).toBe("sankey");
  });
});
