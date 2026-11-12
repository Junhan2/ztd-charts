import type { KeyboardEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScatterChart } from "../src/charts/bubble";
import { Chart, resolveDef } from "../src/charts/Chart";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { planFacets } from "../src/core/facet";
import { hexFacetPlan } from "../src/charts/scatter-hex";
import { HEX_MAX, HEX_MAX_CELLS, HEX_MIN, HEX_SIZE, hexBins, hexCenter, hexGrid, hexNeighbor, hexOf, hexSize } from "../src/layout/hexbin";
import { renderSpecToHTML, renderSpecToSVG } from "../src/server";
import { MAX_CHART_SIZE, validateSpec, type ChartSpec } from "../src/spec";
import { scatterHexSample, scatterHexSampleKo } from "../src/spec/samples";

/** Same harness as tileMap.test.tsx: active sets the picked cell, spy records setActive calls. frame is the last ChartFrame props */
const state = vi.hoisted(() => ({
  active: null as number | null,
  via: "pointer" as "pointer" | "keyboard",
  spy: false,
  calls: [] as [number | null, string | undefined][],
  frame: null as unknown,
}));
vi.mock("../src/core/useChart", async (orig) => {
  const actual = await orig<typeof import("../src/core/useChart")>();
  return {
    ...actual,
    useChart: (props: never, d: never) => {
      const c = actual.useChart(props, d);
      const out = state.spy ? { ...c, setActive: (i: number | null, via?: string) => void state.calls.push([i, via]) } : c;
      return state.active === null ? out : { ...out, active: state.active, via: state.via };
    },
  };
});
vi.mock("../src/core/ChartFrame", async (orig) => {
  const actual = await orig<typeof import("../src/core/ChartFrame")>();
  return {
    ...actual,
    ChartFrame: (p: ChartFrameProps<unknown>) => {
      state.frame = p;
      return actual.ChartFrame(p);
    },
  };
});
afterEach(() => {
  state.active = null;
  state.via = "pointer";
  state.spy = false;
  state.calls = [];
  state.frame = null;
});

const r = (el: ReactElement) => renderToStaticMarkup(el);
const frame = () => state.frame as ChartFrameProps<unknown>;
type P = { x: number; y: number };
const draw = (data: Record<string, unknown>[], extra: Record<string, unknown> = {}) => r(<ScatterChart data={data} x="x" y="y" bin="hex" width={480} height={300} animate={false} {...extra} />);
/** Color step paths (cell groups), and the number of cells in one: each cell starts with "M…l" */
const hexPaths = (h: string) => [...h.matchAll(/<path class="ztd-mark" d="([^"]+)"/g)].map((m) => m[1]);
const cellCount = (d: string) => (d.match(/M/g) ?? []).length;
/** Seeded random numbers, the same generator as the seeded used earlier */
function rnd(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const cloud = (n: number, seed = 3): P[] => {
  const u = rnd(seed);
  return Array.from({ length: n }, (_, i) => (i % 3 ? { x: 20 + u() * 30, y: 10 + u() * 20 } : { x: 70 + u() * 20, y: 50 + u() * 30 }));
};
const BAD = /NaN|Infinity|undefined/;

describe("hex grid", () => {
  it("every point lands in the hexagon whose center is nearest", () => {
    const g = hexGrid(13, { x0: 7, x1: 307, y0: 5, y1: 205 });
    const u = rnd(9);
    for (let k = 0; k < 4000; k++) {
      const x = 7 + u() * 300;
      const y = 5 + u() * 200;
      const [i, j] = hexOf(g, x, y);
      const [cx, cy] = hexCenter(g, i, j);
      const d = Math.hypot(x - cx, y - cy);
      let best = Infinity;
      for (let jj = j - 3; jj <= j + 3; jj++) for (let ii = i - 3; ii <= i + 3; ii++) best = Math.min(best, Math.hypot(x - hexCenter(g, ii, jj)[0], y - hexCenter(g, ii, jj)[1]));
      expect(d).toBeLessThanOrEqual(best + 1e-9);
    }
  });
  it("counts in one pass, leaves out points outside the box and non-finite points, and handles a million points", () => {
    const g = hexGrid(16, { x0: 0, x1: 720, y0: 0, y1: 300 });
    const xs = new Float64Array([1, 2, 3, NaN, 500, Infinity, 50]);
    const ys = new Float64Array([1, 2, 3, 4, 5, 6, 50]);
    const cells = hexBins(g, xs, ys, { x0: 0, x1: 100, y0: 0, y1: 100 });
    expect(cells.reduce((s, c) => s + c.count, 0)).toBe(4);
    const n = 1_000_000;
    const bx = new Float64Array(n);
    const by = new Float64Array(n);
    const u = rnd(4);
    for (let k = 0; k < n; k++) {
      bx[k] = u() * 720;
      by[k] = u() * 300;
    }
    const t0 = performance.now();
    const all = hexBins(g, bx, by, { x0: 0, x1: 720, y0: 0, y1: 300 });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(all.reduce((s, c) => s + c.count, 0)).toBe(n);
  });
  it("binSize falls back to 16 when it is not a finite number and is clamped to 4..200", () => {
    expect([hexSize(undefined), hexSize("12"), hexSize(NaN), hexSize(Infinity)]).toEqual([HEX_SIZE, HEX_SIZE, HEX_SIZE, HEX_SIZE]);
    expect([hexSize(0), hexSize(-5), hexSize(1), hexSize(10_000), hexSize(24)]).toEqual([HEX_MIN, HEX_MIN, HEX_MIN, HEX_MAX, 24]);
  });
  it("a huge plot area widens the hexagons so the grid stays within HEX_MAX_CELLS, and normal sizes keep binSize", () => {
    expect(hexGrid(4, { x0: 0, x1: 2400, y0: 0, y1: 1000 }).w).toBe(4);
    for (const box of [{ x0: 0, x1: 2400, y0: 0, y1: 1e9 }, { x0: 30, x1: 1e7, y0: 20, y1: 300 }, { x0: 0, x1: 1e6, y0: 0, y1: 1e6 }]) {
      const g = hexGrid(4, box);
      const cols = Math.ceil((box.x1 - box.x0) / g.w) + 3;
      const rows = Math.ceil((box.y1 - box.y0) / (1.5 * g.r)) + 3;
      expect(cols * rows, JSON.stringify(box)).toBeLessThanOrEqual(HEX_MAX_CELLS);
      expect(g.w).toBeGreaterThan(4);
    }
    // Even when the server render gets a huge height, it draws within the set limit, and the tooltip ranges are those of the cells actually drawn (widened)
    const t0 = performance.now();
    const h = r(<ScatterChart data={cloud(5000)} x="x" y="y" bin="hex" binSize={4} width={2400} height={1e9} animate={false} />);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(h).not.toMatch(BAD);
    expect(frame().events.length).toBeGreaterThan(0);
    expect(frame().events.length).toBeLessThanOrEqual(HEX_MAX_CELLS);
    // A spec height goes up to 10,000px, so the server render is checked at that limit (10,000 × 10,000, 7 million cells at width 4)
    const svg = renderSpecToSVG({ type: "scatter", data: cloud(2000), encoding: { x: "x", y: "y" }, options: { bin: "hex", binSize: 4, height: MAX_CHART_SIZE } }, { width: MAX_CHART_SIZE });
    expect(svg).not.toMatch(BAD);
    expect(validateSpec({ type: "scatter", data: cloud(5), options: { bin: "hex", height: 1e9 } }).errors.map((e) => e.code)).toEqual(["out_of_range"]);
  });
  it("arrow keys go to the neighbour in that direction, skip empty cells and do not drift sideways going up", () => {
    const g = hexGrid(10, { x0: 0, x1: 100, y0: 0, y1: 100 });
    const at = (col: number, row: number) => ({ col, row, cx: hexCenter(g, col, row)[0], cy: hexCenter(g, col, row)[1] });
    const cells = [at(2, 2), at(3, 2), at(5, 2), at(2, 1), at(1, 1), at(2, 0), at(2, 4)];
    expect(hexNeighbor(cells, 0, [1, 0])).toBe(1);
    expect(hexNeighbor(cells, 1, [1, 0])).toBe(2);
    expect(hexNeighbor(cells, 2, [1, 0])).toBe(-1);
    // On an even row (2), up goes to the upper right (the same index on the odd row); on an odd row, up goes to the upper left, so it returns to the same column
    expect(hexNeighbor(cells, 0, [0, -1])).toBe(3);
    expect(hexNeighbor(cells, 3, [0, -1])).toBe(5);
    // The row below (3) is empty, so it skips two rows down
    expect(hexNeighbor(cells, 0, [0, 1])).toBe(6);
  });
});

describe("scatter bin hex", () => {
  it("draws one path per color step, not one node per hexagon, and the legend swatches use the same colors", () => {
    const h = draw(cloud(20000));
    const paths = hexPaths(h);
    expect(paths.length).toBeGreaterThan(1);
    expect(paths.length).toBeLessThanOrEqual(5);
    expect(h).not.toContain("<circle");
    const cells = paths.reduce((s, d) => s + cellCount(d), 0);
    expect(cells).toBe(frame().events.length);
    expect(frame().events.reduce((s, e) => s + (e.value as number), 0)).toBe(20000);
    // The cell groups and the legend swatches share the same step opacity (the darkest step is 1)
    const fills = new Set([...h.matchAll(/<path class="ztd-mark" d="[^"]+" fill="([^"]+)" opacity="([^"]+)"/g)].map((m) => `${m[1]}|${Number(m[2]).toFixed(3)}`));
    const swatches = new Set([...h.matchAll(/<rect x="[^"]+" y="3" width="12" height="9" rx="2" fill="([^"]+)" opacity="([^"]+)"/g)].map((m) => `${m[1]}|${Number(m[2]).toFixed(3)}`));
    expect(swatches.size).toBe(5);
    for (const f of fills) expect(swatches.has(f), f).toBe(true);
    expect(h).toContain("clip-path=");
  });
  it("orders hexagons densest first, so Home and End reach the densest and sparsest, and arrows move between neighbours", async () => {
    const { ChartFrame: RealFrame } = await vi.importActual<typeof import("../src/core/ChartFrame")>("../src/core/ChartFrame");
    draw(cloud(3000));
    const ev = frame().events;
    const counts = ev.map((e) => e.value as number);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    state.spy = true;
    state.active = 0;
    state.via = "keyboard";
    draw(cloud(3000));
    let root: ReactElement<{ onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void }> | null = null;
    function Probe() {
      root = RealFrame(frame());
      return root;
    }
    r(<Probe />);
    const self = {};
    const press = (key: string) => root!.props.onKeyDown({ key, target: self, currentTarget: self, preventDefault() {} } as never);
    press("End");
    press("Home");
    press("ArrowRight");
    expect(state.calls[0]).toEqual([ev.length - 1, "keyboard"]);
    expect(state.calls[1]).toEqual([0, "keyboard"]);
    const [cx0, cx1] = [ev[0].key, ev[state.calls[2][0]!].key].map((k) => k.split(",").map(Number));
    expect(cx1[1]).toBe(cx0[1]);
    expect(cx1[0]).toBeGreaterThan(cx0[0]);
  });
  it("tooltip and narration give the count and the ranges the hexagon covers, in the locale with the unit", () => {
    state.active = 0;
    state.via = "keyboard";
    const rows = Array.from({ length: 658 }, (_, i) => ({ x: 275 + (i % 7) * 0.5, y: 530 + (i % 5) }));
    draw([...rows, { x: 100, y: 100 }, { x: 400, y: 800 }], { unit: " ms", xLabel: "Size (KB)", yLabel: "Latency" });
    const f = frame();
    expect(f.tip?.title).toBe("658 points");
    expect(f.tip?.rows.map((x) => x.label)).toEqual(["Size (KB)", "Latency"]);
    expect(f.tip?.rows[1].value).toMatch(/^\d+(\.\d)? to \d+(\.\d)? ms$/);
    // The announcement adds the axis names too, like the tooltip
    expect(f.announce).toMatch(/^658 points, Size \(KB\) \d+(\.\d)? to \d+(\.\d)?, Latency \d+(\.\d)? to \d+(\.\d)? ms$/);
    expect(f.description).toContain("Binned into 3 hexagons. Densest: 658 points");
    const de = Array.from({ length: 1500 }, () => ({ x: 1000.5, y: 2.25 }));
    draw(de, { locale: "de-DE" });
    expect(frame().tip?.title).toBe("1.500 points");
    draw(de, { locale: "ko-KR" });
    expect(frame().tip?.title).toBe("점 1,500개");
    expect(frame().tip?.rows[0].value).toContain("~");
    // Edge cells' ranges also stay within the axis range (no values below 0 are mentioned)
    draw([...cloud(2000), { x: 0, y: 0 }], { zero: true });
    const lows = frame().events.map((e) => e.label);
    expect(lows.some((l) => l.startsWith("x 0 to ") || l.includes(", y 0 to "))).toBe(true);
    expect(lows.every((l) => !l.includes("-"))).toBe(true);
  });
  it("reference lines draw on top of the hexagons, quadrant names and the trend line still draw", () => {
    const h = draw(cloud(2000), { refLines: { x: 50, y: 40 }, quadrants: ["A", "B", "C", "D"], fit: "linear" });
    expect(h.lastIndexOf('stroke-dasharray="3 3"')).toBeGreaterThan(h.lastIndexOf('class="ztd-mark"'));
    for (const q of ["A", "B", "C", "D"]) expect(h).toContain(`>${q}</text>`);
    expect(h).toContain('stroke-dasharray="6 4"');
  });
  it("a fixed or zoomed domain bins only the visible points", () => {
    const pts = cloud(3000);
    draw(pts, { xDomain: [0, 55], yDomain: [0, 40] });
    const visible = pts.filter((q) => q.x <= 55 && q.y <= 40).length;
    expect(frame().events.reduce((s, e) => s + (e.value as number), 0)).toBe(visible);
  });
  it("series, size, labels, jitter and the canvas switch are ignored with a named warning, and size keeps it a scatter", () => {
    const spec: ChartSpec = { type: "scatter", data: [{ a: 1, b: 2, s: 3, g: "x", n: "p" }], encoding: { x: "a", y: "b", size: "s", series: "g", label: "n" }, options: { bin: "hex", jitter: { amount: 0.3 }, canvasThreshold: 10, maxLabels: 3 } };
    const v = validateSpec(spec);
    expect(v.valid).toBe(true);
    expect(v.warnings.filter((w) => w.code === "ignored_option").map((w) => w.path).sort()).toEqual(["encoding.label", "encoding.series", "encoding.size", "options.canvasThreshold", "options.jitter", "options.maxLabels"]);
    expect(v.warnings.some((w) => w.code === "alias" || w.code === "unknown_channel")).toBe(false);
    expect(resolveDef("scatter", spec.encoding, spec.options)?.type).toBe("scatter");
    expect(resolveDef("scatter", spec.encoding)?.type).toBe("bubble");
    const svg = renderSpecToSVG(spec, { width: 400 });
    expect(svg).not.toContain("<circle");
    expect(svg).toContain('class="ztd-mark"');
    const unused = validateSpec({ type: "scatter", data: [{ x: 1, y: 2 }], options: { binSize: 10, colorSteps: 3 } });
    expect(unused.warnings.filter((w) => w.code === "ignored_option").map((w) => w.path)).toEqual(["options.binSize", "options.colorSteps"]);
  });
  it("binSize outside 4..200 or not a number is reported and the chart still draws", () => {
    for (const [binSize, code] of [[0, "out_of_range"], [-3, "out_of_range"], [1, "out_of_range"], [10_000, "out_of_range"], ["big", "bad_option_type"], [Number.NaN, "bad_option_type"]] as const) {
      const spec: ChartSpec = { type: "scatter", data: cloud(500), options: { bin: "hex", binSize } };
      expect(validateSpec(spec).errors.map((e) => e.code), String(binSize)).toEqual([code]);
      const h = r(<Chart spec={spec} width={400} animate={false} />);
      expect(h, String(binSize)).not.toMatch(BAD);
      expect(hexPaths(h).length, String(binSize)).toBeGreaterThan(0);
    }
    expect(validateSpec({ type: "scatter", data: cloud(5), options: { bin: "square" } }).errors.map((e) => e.code)).toEqual(["bad_enum"]);
  });
  it("edge inputs draw without NaN, Infinity or undefined", () => {
    const line = (n: number, f: (i: number) => P) => Array.from({ length: n }, (_, i) => f(i));
    const cases: [string, Record<string, unknown>[], Record<string, unknown>?][] = [
      ["empty", []],
      ["one", [{ x: 3, y: 4 }]],
      ["identical", line(5000, () => ({ x: 7, y: 7 }))],
      ["vertical", line(800, (i) => ({ x: 5, y: i }))],
      ["horizontal", line(800, (i) => ({ x: i, y: 5 }))],
      ["non-finite", [...cloud(300), { x: null, y: 3 }, { x: "n/a", y: 2 }, { x: Infinity, y: 1 }, { x: 4, y: Number.NaN }]],
      ["log", [...cloud(300), { x: 1, y: 0 }, { x: 2, y: -5 }], { yScale: "log" }],
      ["narrow", cloud(3000), { width: 280 }],
      ["dates", [{ x: "2025-01-01", y: 3 }, { x: "2025-02-01", y: 4 }]],
      ["huge bins", cloud(300), { binSize: 10_000 }],
      ["hostile", cloud(50), { xLabel: '<script>alert("x")</script>', yLabel: "🧪 مرحبا 日本語 ".repeat(6) }],
    ];
    for (const [name, data, extra] of cases) {
      const h = draw(data, extra);
      expect(h, name).not.toMatch(BAD);
      expect(h, name).not.toContain("<script>");
      expect(frame().description, name).not.toMatch(BAD);
    }
    draw(line(5000, () => ({ x: 7, y: 7 })));
    expect(frame().events).toHaveLength(1);
    expect(frame().events[0].value).toBe(5000);
    // When every count is the same, no legend is drawn
    expect(draw([{ x: 3, y: 4 }])).not.toContain('y="3" width="12" height="9"');
    draw([...cloud(300), { x: 1, y: 0 }, { x: 2, y: -5 }], { yScale: "log" });
    expect(frame().description).toContain("2 points with y at or below 0 are not shown on the log scale.");
    expect(validateSpec({ type: "scatter", data: [{ x: 1, y: 0 }, { x: 2, y: 3 }], options: { bin: "hex", yScale: "log" } }).warnings.map((w) => w.code)).toContain("nonpositive_log");
  });
  it("a long y title is shortened so it never runs into the legend", () => {
    const h = draw(cloud(3000), { width: 280, yLabel: "Latency of the request measured at the edge (ms)" });
    const title = /<text[^>]*>([^<]*)<\/text>/.exec(h)?.[1] ?? "";
    expect(title.endsWith("…")).toBe(true);
  });
  it("small multiples share one color scale when the scale is shared, and each panel has its own when free", () => {
    const cp = { x: "kb", y: "ms", bin: "hex" };
    const shared = hexFacetPlan(planFacets({ type: "scatter", data: scatterHexSample, by: "route", chartProps: cp, width: 632, locale: "en-US", lang: "en" }), cp, "en-US");
    const doms = shared.panels.map((pn) => JSON.stringify(pn.props.binDomain));
    expect(new Set(doms).size).toBe(1);
    // The top of the shared range equals the fullest cell a panel counts on its own (counted on the same plot area as the panel)
    const maxes = shared.panels.map((pn) => {
      draw(pn.props.data as Record<string, unknown>[], { ...cp, ...pn.props, binDomain: undefined });
      return Math.max(...frame().events.map((e) => e.value as number));
    });
    expect((shared.panels[0].props.binDomain as number[])[1]).toBe(Math.max(...maxes));
    const free = hexFacetPlan(planFacets({ type: "scatter", data: scatterHexSample, by: "route", chartProps: cp, scale: "free", width: 632, locale: "en-US", lang: "en" }), cp, "en-US");
    expect(free.panels.every((pn) => pn.props.binDomain === undefined)).toBe(true);
    // A panel that draws no points at all does not break either
    const withEmpty = [...scatterHexSample.slice(0, 400), { route: "Broken", kb: "n/a", ms: null }];
    const svg = renderSpecToSVG({ type: "scatter", data: withEmpty, encoding: { x: "kb", y: "ms" }, options: { bin: "hex" }, facet: { by: "route" } }, { width: 632 });
    expect(svg).not.toMatch(BAD);
  });
  it("a shared-scale facet draws one color legend above the panels, a free-scale facet one per panel", () => {
    const swatches = (h: string) => (h.match(/y="3" width="12" height="9"/g) ?? []).length;
    const ends = (h: string) => [...h.matchAll(/font-size="10"[^>]*>([\d,]+)<\/text>/g)].map((m) => m[1]);
    const spec = (scale?: "free"): ChartSpec => ({ type: "scatter", data: scatterHexSample, encoding: { x: "kb", y: "ms" }, options: { bin: "hex" }, facet: { by: "route", ...(scale && { scale }) } });
    const sharedPlan = hexFacetPlan(planFacets({ type: "scatter", data: scatterHexSample, by: "route", chartProps: { x: "kb", y: "ms", bin: "hex" }, width: 632, locale: "en-US", lang: "en" }), { x: "kb", y: "ms", bin: "hex" }, "en-US");
    expect(sharedPlan.legend).toBeDefined();
    expect(sharedPlan.panels.every((pn) => pn.props.binLegend === false)).toBe(true);
    // In both the browser (<Chart>) and the server SVG there is one legend with five swatches, and its end numbers cover all panels
    const html = r(<Chart spec={spec()} width={632} animate={false} />);
    expect((html.match(/class="ztd-facet-legend"/g) ?? []).length).toBe(1);
    const svg = renderSpecToSVG(spec(), { width: 632 });
    expect(swatches(html)).toBe(5);
    expect(swatches(svg)).toBe(5);
    expect(ends(svg)).toHaveLength(2);
    expect(ends(svg)[0]).toBe("1");
    expect(svg).not.toMatch(BAD);
    // When each panel has its own axes (scale "free"), each panel gets its own legend
    const free = renderSpecToSVG(spec("free"), { width: 632 });
    expect(free).not.toContain("ztd-facet-legend");
    expect(swatches(free)).toBe(10);
  });
  it("xDomain and yDomain are registered: they zoom and re-bin, bad shapes are reported and ignored, an empty range says so", () => {
    const base = (options: Record<string, unknown>): ChartSpec => ({ type: "scatter", data: scatterHexSample, encoding: { x: "kb", y: "ms" }, options: { bin: "hex", ...options } });
    const ok = validateSpec(base({ xDomain: [240, 320], yDomain: [450, 600] }));
    expect(ok.valid).toBe(true);
    expect(ok.warnings.map((w) => w.code)).not.toContain("unknown_option");
    for (const bad of [[5], [10, 0], [3, 3], [Number.NaN, 1], [0, Infinity], ["0", "9"]]) {
      expect(validateSpec(base({ xDomain: bad })).errors.map((e) => e.code), JSON.stringify(bad)).toEqual(["bad_domain"]);
      // The chart counts every point with the data range instead of the invalid range
      const h = r(<Chart spec={base({ xDomain: bad })} width={480} animate={false} />);
      expect(h, JSON.stringify(bad)).not.toMatch(BAD);
      expect(frame().events.reduce((sum, e) => sum + (e.value as number), 0)).toBe(scatterHexSample.length);
    }
    expect(validateSpec(base({ yScale: "log", yDomain: [0, 100] })).warnings.map((w) => w.code)).toContain("ignored_option");
    const empty = base({ xDomain: [5000, 6000], yDomain: [0, 10] });
    expect(validateSpec(empty).warnings.map((w) => w.code)).toContain("domain_empty");
    const h = r(<Chart spec={empty} width={480} animate={false} />);
    expect(h).toContain(">No points in this range.</text>");
    expect(frame().description).toBe("No points in this range.");
    r(<Chart spec={{ ...empty, options: { ...empty.options, locale: "ko-KR" } }} width={480} animate={false} />);
    expect(frame().description).toBe("이 범위에는 점이 없어요.");
  });
  it("server render shows the end state with no entrance animation, and the ko sample matches the English one", () => {
    const svg = renderSpecToSVG({ type: "scatter", data: scatterHexSample, encoding: { x: "kb", y: "ms" }, options: { bin: "hex" } }, { width: 720 });
    expect(svg).not.toContain("animation");
    expect(scatterHexSampleKo.map((q) => [q.kb, q.ms])).toEqual(scatterHexSample.map((q) => [q.kb, q.ms]));
    expect(svg).toBe(renderSpecToSVG({ type: "scatter", data: scatterHexSample, encoding: { x: "kb", y: "ms" }, options: { bin: "hex" } }, { width: 720 }));
  });
});

describe("chart size limit", () => {
  const spec = (options: Record<string, unknown> = {}): ChartSpec => ({ type: "bar", data: [{ x: "a", y: 1 }, { x: "b", y: 2 }], encoding: { x: "x", y: "y" }, options });
  const size = (svg: string) => /^<svg[^>]*? width="([\d.]+)" height="([\d.]+)"/.exec(svg)!.slice(1).map(Number);
  it("validateSpec reports width and height above 10,000 px as out of range, and names NaN in the message", () => {
    for (const k of ["width", "height"]) {
      expect(validateSpec(spec({ [k]: 1e9 })).errors.map((e) => `${e.path} ${e.code}`), k).toEqual([`options.${k} out_of_range`]);
      expect(validateSpec(spec({ [k]: MAX_CHART_SIZE })).errors, k).toEqual([]);
    }
    expect(validateSpec(spec({ height: Number.NaN })).errors[0].message).toBe("options.height must be a number (got NaN)");
    expect(validateSpec(spec({ height: Infinity })).errors[0].message).toBe("options.height must be a number (got Infinity)");
  });
  it("renderSpecToSVG and renderSpecToHTML clamp a huge width and height option to 10,000 px instead of drawing it", () => {
    const t0 = performance.now();
    const [w, h] = size(renderSpecToSVG(spec(), { width: 1e9, height: 1e9 }));
    expect(w).toBe(MAX_CHART_SIZE);
    expect(h).toBeLessThanOrEqual(MAX_CHART_SIZE + 400);
    expect(performance.now() - t0).toBeLessThan(5000);
    // Normal sizes are unchanged
    expect(size(renderSpecToSVG(spec(), { width: 720, height: 300 }))[0]).toBe(720);
    const html = renderSpecToHTML(spec(), { width: 1e9, height: 1e9 });
    expect(html).not.toContain("1000000000");
    expect(Math.max(...[...html.matchAll(/(?:width|height)="([\d.]+)"/g)].map((m) => Number(m[1])))).toBeLessThanOrEqual(MAX_CHART_SIZE);
  });
  it("the outer SVG keeps each side within 250,000 px by scaling the whole drawing (viewBox unchanged), and padding is capped", () => {
    // 40,000 legend items in a 160px card go one per line, so the document is taller than 700,000 px
    const legend = Array.from({ length: 40000 }, (_, i) => ({ label: `Item ${i}`, color: "accent" }));
    const svg = renderSpecToSVG({ ...spec(), card: { title: "Long legend", legend } }, { width: 160 });
    const [w, h] = size(svg);
    const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!.slice(1).map(Number);
    expect(Math.max(w, h)).toBeLessThanOrEqual(250000);
    expect(vb[1]).toBeGreaterThan(250000);
    expect(w / h).toBeCloseTo(vb[0] / vb[1], 2);
    const padded = size(renderSpecToSVG(spec(), { width: 720, padding: 1e9 }));
    expect(padded[1]).toBeLessThan(2000);
  });
});
