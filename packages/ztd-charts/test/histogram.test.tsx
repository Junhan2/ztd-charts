import type { KeyboardEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chart } from "../src/charts/Chart";
import { HistogramChart } from "../src/charts/histogram";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { percentile } from "../src/data/percentile";
import { binCounts, binEdges, binIndex, dotUnit } from "../src/layout/stats";
import { renderSpecToSVG } from "../src/server";
import { CHARTS, validateSpec } from "../src/spec";
import { ThemeProvider } from "../src/theme/context";

/**
 * Same harness as cartesian-fixes.test.tsx. active sets the bin picked by hover or keyboard, spy records setActive calls.
 * frame is the last ChartFrame props
 */
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
      if (state.active === null) return out;
      const a = state.active;
      return { ...out, active: a, via: state.via, dim: (i: number, base = 1) => (i === a ? base : base * 0.38) };
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
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
const desc = (h: string) => decode(/<desc[^>]*>([^<]*)<\/desc>/.exec(h)?.[1] ?? "");
const texts = (h: string) => [...h.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: +m[1], y: +m[2], text: decode(m[3]) }));
/** x and dash pattern of vertical lines (x1 = x2) */
const vlines = (h: string) => [...h.matchAll(/<line x1="([-\d.]+)" x2="([-\d.]+)" y1="[-\d.]+" y2="[-\d.]+"([^>]*)>/g)].filter((m) => m[1] === m[2]).map((m) => ({ x: +m[1], dash: /stroke-dasharray="([^"]+)"/.exec(m[3])?.[1] ?? null }));
const counts = () => frame().events.map((e) => e.value);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("histogram bins (layout/stats)", () => {
  it("a value on an edge goes to the bin on its right, and the last edge goes into the last bin", () => {
    const edges = [0, 10, 20];
    expect(binCounts([0, 9.99, 10, 19.99, 20, 20.01, -0.01, NaN], edges)).toEqual({ counts: [2, 3], outside: 2 });
    expect([binIndex(edges, 10), binIndex(edges, 20), binIndex(edges, 20.01)]).toEqual([1, 1, -1]);
  });

  it("edges come first, then binWidth, then bins, then Freedman-Diaconis (Sturges under 30 samples)", () => {
    const v = range(100);
    expect(binEdges(v, { edges: [0, 50, 100], binWidth: 30, bins: 4 })).toEqual([0, 50, 100]);
    expect(binEdges(v, { binWidth: 30, bins: 4 })).toEqual([0, 30, 60, 90, 120]);
    expect(binEdges(v, { bins: 4 })).toEqual([0, 25, 50, 75, 100]);
    // Freedman-Diaconis: 2 × IQR 49.5 / ∛100 = 21.3 → 20
    expect(binEdges(v)).toEqual([0, 20, 40, 60, 80, 100]);
    // Sturges: for 20 values ⌈log₂ 20⌉ + 1 = 6 bins, 19 / 6 = 3.2 → 2.5
    expect(binEdges(range(20))).toEqual([0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20]);
  });

  it("constant values make one bin centered on the value; no values make no bins", () => {
    expect(binEdges([5, 5, 5])).toEqual([4.5, 5.5]);
    expect(binEdges([5, 5], { binWidth: 4 })).toEqual([3, 7]);
    expect(binEdges([5, 5], { log: true })).toEqual([2.5, 10]);
    expect(binEdges([])).toEqual([]);
    expect(binEdges([NaN, 0, -2], { log: true })).toEqual([]);
  });

  it("dotUnit picks the smallest of 1, 2, 5, 10, 20 … that fits the tallest column", () => {
    expect([dotUnit(24, 24), dotUnit(25, 24), dotUnit(48, 24), dotUnit(49, 24), dotUnit(240, 24), dotUnit(241, 24)]).toEqual([1, 2, 2, 5, 10, 20]);
  });
  it("dotUnit has no upper limit, so a huge count still fits the column", () => {
    expect(dotUnit(1e20, 24)).toBe(5e18);
    for (const n of [4e24, 1e300]) expect(Math.ceil(n / dotUnit(n, 24))).toBeLessThanOrEqual(24);
  });
});

describe("HistogramChart", () => {
  it("bin counts + samples outside the edges + values left out of log bins = valid samples", () => {
    const data = [-5, 0, 1, 2, 5, 10, 50, 100, 500, null, "x"].map((value) => ({ value }));
    const h = r(<HistogramChart data={data} log edges={[1, 10, 100]} width={480} animate={false} />);
    const valid = data.filter((d) => typeof d.value === "number").length;
    expect(counts()).toEqual([3, 3]);
    expect(desc(h)).toContain("Histogram. 7 samples");
    expect(desc(h)).toContain("1 outside the edges");
    expect(desc(h)).toContain("2 at or below 0 left out");
    expect(3 + 3 + 1 + 2).toBe(valid);
    // Values outside the edges are not drawn, but the notice line above the plot mentions them too
    expect(texts(h).map((t) => t.text)).toContain("1 outside the edges · 2 at or below 0 left out");
  });

  it("log: true with a value of 0 is a spec error; the component leaves it out and says so", () => {
    const spec = { type: "histogram", data: [{ ms: 0 }, { ms: 12 }, { ms: 40 }], encoding: { value: "ms" }, options: { log: true } };
    const v = validateSpec(spec);
    expect(v.errors.map((e) => `${e.path}:${e.code}`)).toEqual(["options.log:log_not_positive"]);
    expect(validateSpec(spec, { lang: "ko" }).errors[0].message).toBe("log를 쓰려면 모든 값이 0보다 커야 해요(0 이하 1개)");
    expect(validateSpec({ ...spec, options: {} }).valid).toBe(true);
    r(<HistogramChart data={spec.data} value="ms" log width={480} animate={false} />);
    expect(counts().reduce<number>((a, b) => a + (b ?? 0), 0)).toBe(2);
    expect(frame().description).toContain("1 at or below 0 left out");
  });

  it("dots: a bin of 5 with 2 samples per dot is 2 filled dots and 1 ring", () => {
    // At height 200 the tallest column, 30, does not fit at 1 dot = 1 sample, but fits at 2 samples per dot
    const data = [...Array(30).fill(0.5), ...Array(5).fill(1.5)].map((value) => ({ value }));
    const h = r(<HistogramChart data={data} edges={[0, 1, 2]} variant="dots" marks={[]} width={400} height={200} animate={false} />);
    expect(texts(h).map((t) => t.text)).toContain("1 dot = 2 samples");
    expect(frame().description).toContain("1 dot = 2 samples");
    // Dots in the top notice line (above y 22) are the legend
    const circles = [...h.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="[\d.]+" fill="([^"]+)"/g)].map((m) => ({ cx: +m[1], cy: +m[2], ring: m[3] === "none" })).filter((c) => c.cy > 22);
    const cols = [...new Set(circles.map((c) => c.cx))].sort((a, b) => a - b);
    expect(cols).toHaveLength(2);
    const second = circles.filter((c) => c.cx === cols[1]);
    expect(second.filter((c) => !c.ring)).toHaveLength(2);
    expect(second.filter((c) => c.ring)).toHaveLength(1);
    expect(circles.filter((c) => c.cx === cols[0])).toHaveLength(15);
  });

  it("two groups share one set of edges computed from all values", () => {
    const data = [...range(40).map((i) => ({ ms: i % 10, g: "a" })), ...range(40).map((i) => ({ ms: 50 + i, g: "b" }))];
    r(<HistogramChart data={data} value="ms" group="g" width={480} animate={false} />);
    const shared = binEdges(data.map((d) => d.ms));
    expect(frame().events).toHaveLength(shared.length - 1);
    expect(frame().events[0].label).toBe(`${shared[0]} to ${shared[1]}`);
    expect(frame().events.at(-1)!.label).toBe(`${shared.at(-2)} to ${shared.at(-1)}`);
    // Binned on its own values, group a would be 0~10, but it is counted on the shared edges
    const perGroup = (name: string) => frame().events.reduce((s, e) => s + Number(new RegExp(`${name} (\\d+) `).exec(e.formatted ?? "")![1]), 0);
    expect([perGroup("a"), perGroup("b")]).toEqual([40, 40]);
  });

  it("three or more groups: the spec check warns and points to ridgeline, and only the first two are drawn", () => {
    const data = ["a", "b", "c"].flatMap((g, k) => range(30).map((i) => ({ ms: i + k * 10, g })));
    const v = validateSpec({ type: "histogram", data, encoding: { value: "ms", group: "g" } });
    expect(v.valid).toBe(true);
    expect(v.warnings.map((w) => w.code)).toEqual(["too_many_groups"]);
    expect(v.warnings[0].message).toContain("ridgeline");
    const h = r(<HistogramChart data={data} value="ms" group="g" width={480} animate={false} />);
    expect(frame().events[0].formatted).toMatch(/^a \d+ \(.*\), b \d+ \(.*\)$/);
    expect(desc(h)).toContain("Only the first 2 of 3 groups are drawn.");
  });

  it("the p95 line sits at percentile(values, 95) on the x axis, dashed and labelled; p50 is solid", () => {
    const values = [12, 15, 15, 18, 20, 21, 25, 30, 31, 33, 40, 48, 52, 60, 75, 90, 120, 160, 210, 300];
    const h = r(<HistogramChart data={values.map((ms) => ({ ms }))} value="ms" marks={["p50", "p95", "p99"]} width={640} animate={false} />);
    const tx = texts(h);
    // Build a value-to-pixel ruler from two axis tick labels
    const ticks = tx.filter((t) => /^\d+$/.test(t.text) && t.y === Math.max(...tx.map((u) => u.y)));
    const [a, b] = [ticks[0], ticks.at(-1)!];
    const px = (v: number) => a.x + ((v - +a.text) / (+b.text - +a.text)) * (b.x - a.x);
    const lines = vlines(h);
    const p95 = percentile(values, 95);
    const dashed = lines.find((l) => l.dash === "4 3")!;
    expect(dashed.x).toBeCloseTo(px(p95), 0);
    expect(lines.find((l) => l.dash === null)!.x).toBeCloseTo(px(percentile(values, 50)), 0);
    expect(lines.find((l) => l.dash === "1.5 2.5")!.x).toBeCloseTo(px(percentile(values, 99)), 0);
    expect(tx.map((t) => t.text)).toEqual(expect.arrayContaining([`p50 ${percentile(values, 50)}`, `p95 ${Math.round(p95 * 10) / 10}`]));
    const none = r(<HistogramChart data={values.map((ms) => ({ ms }))} value="ms" marks={[]} width={640} animate={false} />);
    expect(vlines(none)).toHaveLength(0);
  });

  it("threshold: bins on the bad side take the accent and the description counts the samples past it", () => {
    const data = range(100).map((i) => ({ ms: i }));
    const h = r(<HistogramChart data={data} value="ms" edges={[0, 25, 50, 75, 100]} threshold={{ value: 75, label: "SLO" }} width={480} animate={false} />);
    const fills = [...h.matchAll(/<g class="ztd-mark"[^>]*><path d="[^"]+" fill="([^"]+)"/g)].map((m) => (m[1].includes("--ztd-accent") ? "accent" : m[1].includes("--ztd-neutral") ? "gray" : m[1]));
    expect(fills).toEqual(["gray", "gray", "gray", "accent"]);
    expect(desc(h)).toContain("24 above the SLO of 75 (24%)");
    const below = r(<HistogramChart data={data} value="ms" edges={[0, 25, 50, 75, 100]} threshold={{ value: 25, side: "below" }} width={480} animate={false} locale="ko" />);
    const fillsBelow = [...below.matchAll(/<g class="ztd-mark"[^>]*><path d="[^"]+" fill="([^"]+)"/g)].map((m) => m[1].includes("--ztd-accent"));
    expect(fillsBelow).toEqual([true, false, false, false]);
    expect(desc(below)).toContain("25 미만 25건(25%)");
  });

  it("a bin the threshold cuts through is split into two colors at the line", () => {
    const h = r(<HistogramChart data={range(100).map((i) => ({ ms: i }))} value="ms" edges={[0, 50, 100]} threshold={{ value: 80 }} width={480} animate={false} />);
    const last = h.split('<g class="ztd-mark"').at(-1)!;
    expect([...last.matchAll(/<path d="[^"]+" fill="([^"]+)"/g)].map((m) => m[1].includes("--ztd-accent"))).toEqual([false, true]);
  });

  it("pre-binned rows with a huge count draw no more dots than fit; a non-finite count or edge is left out", () => {
    const h = r(<HistogramChart data={[{ x0: 0, x1: 1, count: 1e20 }, { x0: 1, x1: 2, count: 3 }]} variant="dots" marks={[]} width={400} height={200} animate={false} />);
    expect((h.match(/<circle /g) ?? []).length).toBeLessThan(60);
    r(<HistogramChart data={[{ x0: 0, x1: 1, count: Infinity }, { x0: 1, x1: Infinity, count: 2 }, { x0: 2, x1: 3, count: 4 }]} variant="dots" width={400} animate={false} />);
    expect(counts()).toEqual([4]);
  });

  it("pre-binned rows: gaps become empty bins and percentiles are estimated inside the bins", () => {
    const data = [
      { x0: 100, x1: 200, count: 50 },
      { x0: 0, x1: 100, count: 50 },
      { x0: 300, x1: 400, count: 0 },
    ];
    const h = r(<HistogramChart data={data} unit="ms" width={480} animate={false} />);
    expect(frame().events.map((e) => `${e.label}=${e.value}`)).toEqual(["0ms to 100ms=50", "100ms to 200ms=50", "200ms to 300ms=0", "300ms to 400ms=0"]);
    // The median of 100 samples is 100ms, the end of the first bin. Pre-binned rows are an estimate, so "about" is added
    expect(desc(h)).toContain("100 samples, median about 100ms, p95 about 190ms");
    expect(validateSpec({ type: "histogram", data }).valid).toBe(true);
    expect(validateSpec({ type: "histogram", data: [{ from: 0, n: 1 }] }).errors.map((e) => e.code)).toEqual(["missing_channel"]);
  });

  it("tooltip: range, count with share, cumulative share", () => {
    const data = [1, 1, 2, 3, 3, 3, 3, 4].map((v) => ({ v }));
    state.active = 2;
    r(<HistogramChart data={data} value="v" edges={[0, 1, 2, 3, 4]} unit="ms" width={480} animate={false} />);
    const tip = frame().tip!;
    expect(tip.title).toBe("2ms to 3ms");
    // Bins [0,1) 0, [1,2) 2, [2,3) 1, [3,4] 5 (4 goes in the last bin)
    // Cumulative shares keep one decimal (so a tail bin does not round to 100% before the last bin)
    expect(tip.rows.map((row) => `${row.label}=${row.value}`)).toEqual(["Count=1 · 12.5%", "Cumulative=37.5%"]);
    state.active = 3;
    r(<HistogramChart data={data} value="v" edges={[0, 1, 2, 3, 4]} unit="ms" width={480} animate={false} locale="ko" />);
    expect(frame().tip!.rows.map((row) => `${row.label}=${row.value}`)).toEqual(["건수=5건 · 62.5%", "누적=100%"]);
  });

  it("the keyboard steps through every bin, empty ones included", async () => {
    const { ChartFrame: RealFrame } = await vi.importActual<typeof import("../src/core/ChartFrame")>("../src/core/ChartFrame");
    const data = [1, 1, 3, 3].map((v) => ({ v }));
    state.spy = true;
    state.active = 1;
    state.via = "keyboard";
    r(<HistogramChart data={data} value="v" edges={[0, 1, 2, 3, 4]} width={480} animate={false} />);
    expect(counts()).toEqual([0, 2, 0, 2]);
    expect(frame().events[2].formatted).toBe("0 (0%), cumulative 50%");
    let root: ReactElement<{ onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void }> | null = null;
    function Probe() {
      root = RealFrame(frame());
      return root;
    }
    r(<Probe />);
    const self = {};
    // ArrowRight from the bin with 2 samples goes to the next bin, which has 0
    root!.props.onKeyDown({ key: "ArrowRight", target: self, currentTarget: self, preventDefault() {} } as never);
    expect(state.calls).toEqual([[2, "keyboard"]]);
  });

  it("no samples: the empty state text, no bins and no keyboard stops", () => {
    const h = r(<HistogramChart data={[{ v: null }, { v: "-" }]} value="v" width={480} animate={false} />);
    expect(frame().events).toEqual([]);
    expect(desc(h)).toBe("No data.");
    expect(texts(h).map((t) => t.text)).toEqual(["No data."]);
    expect(h).not.toContain('tabindex="0"');
    // Even with edges given, no samples means the empty state
    const edged = r(<HistogramChart data={[]} edges={[0, 1, 2]} width={480} animate={false} />);
    expect(frame().events).toEqual([]);
    expect(desc(edged)).toBe("No data.");
  });

  it("variants: dots, step outline, log axis, density curve", () => {
    const def = CHARTS.find((c) => c.type === "histogram")!;
    const draw = (options: Record<string, unknown>) => r(<Chart spec={{ ...def.example, options: { ...def.example.options, ...options } }} width={640} animate={false} />);
    expect((draw({ variant: "dots" }).match(/<circle /g) ?? []).length).toBeGreaterThan(20);
    expect(draw({ variant: "step" })).toMatch(/<path d="M[^"]+" fill="none" stroke="var\(--ztd-neutral-strong/);
    const log = texts(draw({ log: true })).map((t) => t.text);
    expect(log).toEqual(expect.arrayContaining(["100", "1,000"]));
    expect(draw({ kde: true })).toMatch(/<path d="M[\d.,]+C[^"]+" fill="none" stroke="var\(--ztd-ink/);
  });

  it("the server SVG and the browser chart draw the same geometry", () => {
    const def = CHARTS.find((c) => c.type === "histogram")!;
    const geometry = (s: string) => [...s.matchAll(/ (d|x|y|width|height|cx|cy|r|x1|x2|y1|y2)="([-\d.,MLHVACZ ]+)"/g)].map((m) => `${m[1]}=${m[2]}`).join(" ");
    for (const spec of [def.example, { ...def.example, options: { ...def.example.options, variant: "dots" } }]) {
      const server = renderSpecToSVG(spec, { width: 640 + 48, frame: false, theme: "light" });
      const browser = r(
        <ThemeProvider theme="light">
          <Chart spec={{ ...spec, card: undefined }} width={640} animate={false} />
        </ThemeProvider>,
      );
      const body = /<svg[^>]*class="ztd-svg"[^>]*>([\s\S]*?)<\/svg>/.exec(browser)![1];
      expect(geometry(body).length).toBeGreaterThan(1000);
      // The server SVG wraps the chart in an inner svg with x, y, width and height. The shapes after that must be the same
      const inner = server.slice(server.indexOf('<svg x="'));
      expect(geometry(inner).replace(/^x=\S+ y=\S+ width=\S+ height=\S+ /, "")).toBe(geometry(body));
    }
  });
});

describe("작은 눈금 표기 (차례 4)", () => {
  it("로그 히스토그램이 0.01부터 100만까지 퍼져도 첫 x 눈금을 0이 아니라 0.01로 써요", () => {
    const data = Array.from({ length: 33 }, (_, i) => ({ v: 10 ** (-2 + 0.25 * i) }));
    const all = texts(r(<HistogramChart data={data} value="v" log width={640} animate={false} />));
    const bottom = Math.max(...all.map((t) => t.y));
    const xTicks = all.filter((t) => t.y === bottom).map((t) => t.text);
    expect(xTicks).toContain("0.01");
    expect(xTicks).not.toContain("0");
  });
});
