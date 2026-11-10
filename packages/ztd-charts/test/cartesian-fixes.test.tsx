import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BarChart } from "../src/charts/bar";
import { BoxPlot } from "../src/charts/box";
import { BubbleChart, ScatterChart } from "../src/charts/bubble";
import { nearestInDirection } from "../src/charts/scatter-kit";
import { BulletChart } from "../src/charts/bullet";
import { BumpChart } from "../src/charts/bump";
import { CalendarHeatmap } from "../src/charts/calendar";
import { CandlestickChart } from "../src/charts/candlestick";
import { autoLegend, Chart } from "../src/charts/Chart";
import { DumbbellChart } from "../src/charts/dumbbell";
import { Heatmap } from "../src/charts/heatmap";
import { AreaChart, LineChart } from "../src/charts/line";
import { LiveLineChart, stepClock } from "../src/charts/live";
import { LollipopChart } from "../src/charts/lollipop";
import { ParetoChart } from "../src/charts/pareto";
import { RadarChart } from "../src/charts/radar";
import { GaugeChart } from "../src/charts/radial";
import { RidgelineChart } from "../src/charts/ridgeline";
import { Sparkline } from "../src/charts/sparkline";
import { StreamGraph } from "../src/charts/stream";
import { WaterfallChart } from "../src/charts/waterfall";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { MotionEngine } from "../src/core/motion";
import { textWidth } from "../src/core/text";
import { renderSpecToSVG } from "../src/server";
import { CHARTS, localizeDef, variantSpec, VARIANTS } from "../src/spec";
import type { ChartSpec } from "../src/spec/types";
import { validateSpec } from "../src/spec/validate";
import { ThemeProvider } from "../src/theme/context";

/**
 * SSR은 렌더마다 엔진을 새로 만들어 m.items가 늘 데이터 순서예요. 브라우저에서는 엔진이 남아서
 * 데이터가 바뀌어도 m.items가 처음 생긴 순서를 지켜요. engine을 주면 렌더 사이에 엔진을 이어 써서 그 상황을 재현해요.
 * motion을 주면 snap 대신 그 함수가 엔진에 marks를 넘겨요 (전환 중간 프레임을 그릴 때).
 * active를 주면 호버/키보드로 고른 항목을, spy를 켜면 setActive 호출을 기록해요. frame은 마지막 ChartFrame props
 */
const state = vi.hoisted(() => ({
  engine: null as null | { snap: (m: never[]) => void; items: () => unknown[]; get: (k: string) => number[] | undefined },
  motion: null as null | ((marks: never[]) => void),
  active: null as number | null,
  via: "pointer" as "pointer" | "keyboard" | "touch",
  spy: false,
  calls: [] as [number | null, string | undefined][],
  frame: null as unknown,
}));

vi.mock("../src/core/useMotion", async (orig) => {
  const actual = await orig<typeof import("../src/core/useMotion")>();
  return {
    ...actual,
    useMotion: (marks: never[], opts: never) => {
      const e = state.engine;
      if (!e) return actual.useMotion(marks, opts);
      if (state.motion) state.motion(marks);
      else e.snap(marks);
      return { items: e.items(), get: (k: string) => e.get(k), elapsed: Infinity, fade: () => 1, waiting: false, animating: false, generation: 0 };
    },
  };
});
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
  state.engine = null;
  state.motion = null;
  state.active = null;
  state.via = "pointer";
  state.spy = false;
  state.calls = [];
  state.frame = null;
});

const r = (el: ReactElement) => renderToStaticMarkup(el);
const frame = () => state.frame as ChartFrameProps<unknown>;
const keyEvent = (key: string) => ({ key, preventDefault() {} }) as never;
const pointer = { pointerType: "mouse" } as never;
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

interface T {
  x: number;
  y: number;
  anchor: string;
  size: number;
  text: string;
}
function texts(h: string): T[] {
  return [...h.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*font-size="([\d.]+)"[^>]*text-anchor="(\w+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: +m[1], y: +m[2], size: +m[3], anchor: m[4], text: decode(m[5]) }));
}
const textOf = (h: string, s: string) => texts(h).filter((t) => t.text === s);
const tds = (h: string) => [...h.matchAll(/<th scope="row">([^<]*)<\/th><td>([^<]*)<\/td>/g)].map((m) => `${decode(m[1])}=${decode(m[2])}`);
const desc = (h: string) => decode(/<desc[^>]*>([^<]*)<\/desc>/.exec(h)?.[1] ?? "");
/** class="ztd-mark" 묶음마다 마크업 조각 (다음 묶음 전까지) */
const markGroups = (h: string) => h.split('<g class="ztd-mark"').slice(1);
/** path d의 (x, y) 쌍 */
const pairs = (d: string) => [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [+m[1], +m[2]] as [number, number]);
const viewH = (h: string) => +/viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(h)![1];

describe("line, area", () => {
  it("1: reference lines above the data widen the y domain and stay inside the plot", () => {
    const H = 240;
    const h = r(<LineChart data={[1, 2, 3, 4, 5].map((y, x) => ({ x: `p${x}`, y }))} referenceLines={[{ y: 20, label: "Target" }]} width={480} height={H} animate={false} />);
    const ys = [...h.matchAll(/<line [^>]*y1="([-\d.]+)"[^>]*stroke-dasharray="3 3"/g)].map((m) => +m[1]);
    expect(ys).toHaveLength(1);
    expect(ys[0]).toBeGreaterThanOrEqual(10);
    expect(ys[0]).toBeLessThanOrEqual(H - 22);
    expect(textOf(h, "20").length).toBeGreaterThan(0);
    expect(textOf(h, "Target")[0].y).toBeGreaterThan(0);
  });

  it("3: numeric x ticks ignore the value format (no $2,000.00) and years have no thousands separator", () => {
    const H = 240;
    const xTicks = (h: string) => texts(h).filter((t) => t.y === H - 9).map((t) => t.text);
    const years = xTicks(r(<LineChart data={Array.from({ length: 20 }, (_, i) => ({ x: 2000 + i, y: i * 10 }))} format="currency" width={480} height={H} animate={false} />));
    expect(years.length).toBeGreaterThan(1);
    for (const t of years) expect(t).toMatch(/^20\d\d$/);
    const big = xTicks(r(<LineChart data={Array.from({ length: 20 }, (_, i) => ({ x: i * 1000, y: i }))} format="currency" width={480} height={H} animate={false} />));
    expect(big.length).toBeGreaterThan(1);
    for (const t of big) expect(t).not.toContain("$");
    expect(big).toContain("10,000");
  });

  it("10: an area under all-negative values is clamped to the plot (no fill above the top)", () => {
    const H = 240;
    const top = 10;
    const data = [-5, -3, -4, -6].map((y, x) => ({ x: `p${x}`, y }));
    const line = r(<LineChart data={data} area width={480} height={H} animate={false} />);
    const grad = /<path d="([^"]+)" fill="url\(#[^"]+g\)"/.exec(line)![1];
    for (const [, y] of pairs(grad)) expect(y).toBeGreaterThanOrEqual(top - 0.01);
    const area = r(<AreaChart data={data} zero={false} width={480} height={H} animate={false} />);
    const fill = /<g opacity="1"><path d="([^"]+)"/.exec(area)![1];
    for (const [, y] of pairs(fill)) {
      expect(y).toBeGreaterThanOrEqual(top - 0.01);
      expect(y).toBeLessThanOrEqual(H - 22 + 0.01);
    }
  });
});

describe("2: rows follow the datum index after a data update reorders them", () => {
  const ringGroup = (h: string, ring: RegExp) => markGroups(h).filter((g) => ring.test(g));

  it("bullet: rows, keyboard ring and tooltip follow the new order", () => {
    state.engine = new MotionEngine<never>() as never;
    const d1 = ["A", "B", "C"].map((label, i) => ({ label, value: 10 + i, target: 20 }));
    r(<BulletChart data={d1} width={400} animate={false} />);
    state.active = 0;
    state.via = "keyboard";
    const h = r(<BulletChart data={[d1[2], d1[0], d1[1]]} width={400} animate={false} />);
    const y = (s: string) => textOf(h, s)[0].y;
    expect(y("C")).toBeLessThan(y("A"));
    expect(y("A")).toBeLessThan(y("B"));
    const ring = ringGroup(h, /rx="5" fill="none"[^>]*stroke-width="1.5"/);
    expect(ring).toHaveLength(1);
    expect(ring[0]).toContain(">C</text>");
    expect(h).toMatch(/class="ztd-tip"[^>]*>.*?>C<\/div>/);
  });

  it("dumbbell: rows follow the sort order after values change", () => {
    state.engine = new MotionEngine<never>() as never;
    const d1 = [
      { label: "A", start: 1, end: 10 },
      { label: "B", start: 1, end: 5 },
      { label: "C", start: 1, end: 2 },
    ];
    r(<DumbbellChart data={d1} width={400} animate={false} />);
    state.active = 0;
    state.via = "keyboard";
    const h = r(<DumbbellChart data={[d1[0], d1[1], { label: "C", start: 1, end: 20 }]} width={400} animate={false} />);
    const y = (s: string) => textOf(h, s)[0].y;
    expect(y("C")).toBeLessThan(y("A"));
    expect(y("A")).toBeLessThan(y("B"));
    const ring = ringGroup(h, /<circle [^>]*r="5.5"[^>]*stroke="(?!none)[^"]+"/);
    expect(ring).toHaveLength(1);
    expect(ring[0]).toContain(">C</text>");
  });

  it("waterfall: connectors join neighbouring bars and the keyboard ring sits on the chosen step", () => {
    state.engine = new MotionEngine<never>() as never;
    const start = { label: "Start", value: 100 };
    const [a, b, cc] = [
      { label: "A", value: 10 },
      { label: "B", value: -20 },
      { label: "C", value: 5 },
    ];
    r(<WaterfallChart data={[start, a, b, cc]} width={480} animate={false} />);
    state.active = 1;
    state.via = "keyboard";
    const h = r(<WaterfallChart data={[start, cc, a, b]} width={480} animate={false} />);
    const gaps = [...h.matchAll(/<line x1="([-\d.]+)" x2="([-\d.]+)"[^>]*stroke-dasharray="2 3"/g)].map((m) => +m[2] - +m[1]);
    expect(gaps).toHaveLength(3);
    for (const g of gaps) {
      expect(g).toBeGreaterThan(0);
      expect(g).toBeCloseTo(gaps[0], 3);
    }
    const ring = ringGroup(h, /fill="none" stroke="[^"]+" stroke-width="2"/);
    expect(ring).toHaveLength(1);
    expect(ring[0]).toContain(">+5</text>");
    const tipLeft = +/class="ztd-tip"[^>]*style="[^"]*left:([\d.]+)px/.exec(h)![1];
    expect(tipLeft).toBeCloseTo(textOf(h, "+5")[0].x, 0);
  });

  it("pareto: the cumulative line runs left to right after the sort order changes", () => {
    state.engine = new MotionEngine<never>() as never;
    r(<ParetoChart data={[{ label: "A", value: 5 }, { label: "B", value: 3 }, { label: "C", value: 1 }]} width={480} animate={false} />);
    const h = r(<ParetoChart data={[{ label: "A", value: 5 }, { label: "B", value: 3 }, { label: "C", value: 9 }]} width={480} animate={false} />);
    const d = /<path d="([^"]+)" fill="none"[^>]*stroke-width="1.6"/.exec(h)![1];
    const xs = pairs(d).map((q) => q[0]);
    expect(xs).toHaveLength(3);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    // 점도 같은 순서: 누적이 가장 낮은 점(첫 막대 C, 9/17)이 맨 왼쪽
    const dots = [...h.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => [+m[1], +m[2]]);
    expect(dots[0][0]).toBe(Math.min(...dots.map((q) => q[0])));
    expect(dots[0][1]).toBe(Math.max(...dots.map((q) => q[1])));
  });
});

describe("4: duplicate labels keep their own slot", () => {
  it("waterfall, pareto and lollipop place every row in its own band", () => {
    const w = r(<WaterfallChart data={[{ label: "Start", value: 100 }, { label: "Other", value: -10 }, { label: "Tax", value: -20 }, { label: "Other", value: 15 }]} width={480} animate={false} />);
    const wx = markGroups(w).map((g) => +/<rect x="([\d.]+)"/.exec(g)![1]);
    expect(new Set(wx).size).toBe(4);
    const p = r(<ParetoChart data={[{ label: "x", value: 5 }, { label: "x", value: 3 }, { label: "y", value: 1 }]} width={480} animate={false} />);
    const px = markGroups(p).map((g) => +/<rect x="([-\d.]+)"/.exec(g)![1]);
    expect(new Set(px).size).toBe(3);
    const l = r(<LollipopChart data={[{ label: "x", value: 5 }, { label: "x", value: 3 }]} width={400} animate={false} />);
    const ly = [...l.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)"/g)].map((m) => +m[1]);
    expect(new Set(ly).size).toBe(2);
  });
});

describe("lollipop", () => {
  it("5: a zero value still shows its dot", () => {
    const h = r(<LollipopChart data={[{ label: "a", value: 5 }, { label: "b", value: 0 }]} width={400} animate={false} />);
    const op = [...h.matchAll(/<circle [^>]*opacity="([\d.]+)"/g)].map((m) => +m[1]);
    expect(op).toEqual([1, 1]);
  });

  it("6: negative value labels sit outside the stem end without covering category names", () => {
    const h = r(<LollipopChart data={[{ label: "a", value: 5 }, { label: "b", value: -5 }]} width={400} animate={false} />);
    const stem = [...h.matchAll(/<line x1="([\d.]+)" x2="([\d.]+)" y1="([\d.]+)"[^>]*stroke-width="2.2"/g)].map((m) => ({ base: +m[1], end: +m[2], y: +m[3] }));
    const negStem = stem.find((s) => s.end < s.base)!;
    const lab = textOf(h, "-5").find((t) => t.size === 11)!;
    const name = textOf(h, "b")[0];
    expect(lab.anchor).toBe("end");
    expect(lab.x).toBeLessThan(negStem.end);
    expect(lab.x - textWidth("-5", 11, 800)).toBeGreaterThan(name.x);
    const v = r(<LollipopChart data={[{ label: "a", value: 5 }, { label: "b", value: -5 }]} orientation="vertical" width={400} animate={false} />);
    const dot = [...v.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)"/g)].map((m) => +m[1]);
    const vl = textOf(v, "-5").find((t) => t.anchor === "middle" && t.size === 10.5 && t.y > 30)!;
    expect(vl.y).toBeGreaterThan(Math.max(...dot));
    expect(vl.y + 6).toBeLessThan(viewH(v) - 22 + 13 - 6);
  });

  it("13: a missing value reads as '-' (not 0) in the table and description", () => {
    const h = r(<LollipopChart data={[{ label: "a", value: 5 }, { label: "b", value: null }]} width={400} animate={false} />);
    expect(tds(h)).toContain("b=-");
    expect(desc(h)).toContain("b -");
    expect(desc(h)).not.toMatch(/b 0/);
  });
});

describe("heatmap", () => {
  it("7: a duplicate cell with a missing value does not wipe the existing value", () => {
    const h = r(<Heatmap data={[{ x: "a", y: "r", value: 5 }, { x: "b", y: "r", value: 2 }, { x: "a", y: "r", value: null }]} width={400} animate={false} />);
    expect(tds(h)).toContain("r · a=5");
  });

  it("18: ArrowUp/ArrowDown move by row in the same column, skipping empty cells", () => {
    // 3열 3줄, 가운데 열 가운데 칸은 비어 있어요
    const data = ["r0", "r1", "r2"].flatMap((y) => ["c0", "c1", "c2"].map((x) => ({ x, y, value: y === "r1" && x === "c1" ? null : 1 })));
    state.spy = true;
    state.active = 1; // r0 · c1
    r(<Heatmap data={data} width={400} animate={false} />);
    expect(frame().onKey!(keyEvent("ArrowDown"))).toBe(true);
    // 빈 r1 · c1 을 건너 r2 · c1: 칸 목록에서 [r0 3개, r1 2개, r2 c0] 다음
    expect(state.calls).toEqual([[6, "keyboard"]]);
    state.calls = [];
    expect(frame().onKey!(keyEvent("ArrowUp"))).toBe(true);
    expect(state.calls).toEqual([]);
    expect(frame().onKey!(keyEvent("ArrowRight"))).toBe(false);
  });
});

describe("candlestick", () => {
  const ohlc = (c: number) => ({ open: c - 1, high: c + 2, low: c - 2, close: c });

  it("8: moving averages use every original close even when candles are merged", () => {
    const d = Array.from({ length: 400 }, (_, i) => ({ date: new Date(2023, 0, 1 + i).toISOString().slice(0, 10), ...ohlc(100 + i) }));
    const h = r(<CandlestickChart data={d} ma={[5]} width={640} animate={false} />);
    // 마지막 다섯 종가 495..499의 평균
    expect(texts(h).map((t) => t.text)).toContain("MA5 497");
  });

  it("9: small numeric x values are labels, not 1970 timestamps", () => {
    const idx = r(<CandlestickChart data={[1, 2, 3].map((date, i) => ({ date, ...ohlc(10 + i) }))} width={480} animate={false} />);
    expect(tds(idx).map((t) => t.split("=")[0])).toEqual(["1", "2", "3"]);
    const years = r(<CandlestickChart data={[2021, 2022, 2023].map((date, i) => ({ date, ...ohlc(10 + i) }))} width={480} animate={false} />);
    expect(tds(years).map((t) => t.split("=")[0])).toEqual(["2021", "2022", "2023"]);
    const ms = r(<CandlestickChart data={[0, 1].map((k) => ({ date: new Date(2023, 10, 14 + k).getTime(), ...ohlc(10 + k) }))} width={480} animate={false} />);
    expect(tds(ms)[0]).toMatch(/^Nov 14, 2023=/);
  });
});

describe("sparkline", () => {
  it("11: all-negative bars keep the zero line inside, and a trailing gap keeps the last value", () => {
    const H = 48;
    const h = r(<Sparkline data={[-5, -3, -4].map((y, x) => ({ x, y }))} variant="bar" width={200} height={H} animate={false} />);
    // 막대 윗변(시작점 y)은 0 자리 = 그림 위 끝(5px)에, 아랫변(V)은 그림 안에
    const bars = [...h.matchAll(/<path d="M[-\d.]+,([-\d.]+)H[^"]*?V([-\d.]+)/g)].map((m) => [+m[1], +m[2]]);
    expect(bars).toHaveLength(3);
    for (const [top, bottom] of bars) {
      expect(top).toBeCloseTo(5, 5);
      expect(bottom).toBeLessThanOrEqual(H);
    }
    const g = r(<Sparkline data={[1, 2, null].map((y, x) => ({ x, y }))} width={200} animate={false} />);
    expect(texts(g).map((t) => t.text)).toContain("2");
    expect(g).toMatch(/<circle [^>]*r="3.2"/);
  });

  it("17: the bar variant buckets thousands of points to the pixel width and keeps the marked bar", () => {
    const data = Array.from({ length: 10000 }, (_, x) => ({ x, y: (x % 97) + 1 }));
    const h = r(<Sparkline data={data} variant="bar" showValue={false} width={300} animate={false} />);
    const paths = (h.match(/<path d="M[^"]+" fill="[^"]+"><\/path>/g) ?? []).length;
    expect(paths).toBeLessThanOrEqual(150);
    expect(paths).toBeGreaterThan(100);
    // 마지막 막대(강조)는 남아요: 강조색 막대가 하나
    const fills = [...h.matchAll(/<path d="M[^"]+" fill="([^"]+)"><\/path>/g)].map((m) => m[1]);
    expect(new Set(fills).size).toBe(2);
    expect(fills[fills.length - 1]).not.toBe(fills[0]);
  });

  it("17: pointer moves find the nearest point by arithmetic (sparkline and bump)", () => {
    state.spy = true;
    r(<Sparkline data={Array.from({ length: 11 }, (_, x) => ({ x, y: x }))} showValue={false} width={222} animate={false} />);
    // x0 = 2, x1 = 218, 점 사이 21.6px
    frame().onPointerMove!(2 + 3 * 21.6 + 8, 10, pointer);
    frame().onPointerMove!(-50, 10, pointer);
    frame().onPointerMove!(999, 10, pointer);
    expect(state.calls.map((c) => c[0])).toEqual([3, 0, 10]);
    state.calls = [];
    const h = r(<BumpChart data={["a", "b", "c", "d"].flatMap((x, k) => [{ x, series: "p", rank: 1 + (k % 2) }, { x, series: "q", rank: 2 - (k % 2) }])} width={480} animate={false} />);
    const cx = [...new Set([...h.matchAll(/<circle cx="([\d.]+)"/g)].map((m) => +m[1]))].sort((a, b) => a - b);
    expect(cx).toHaveLength(4);
    frame().onPointerMove!(cx[2] - 3, 50, pointer);
    frame().onPointerMove!(cx[0] - 40, 50, pointer);
    expect(state.calls.map((c) => c[0])).toEqual([2, 0]);
  });
});

describe("13: missing values are not read as 0", () => {
  it("bullet shows '-' for a missing value in the table, tooltip and description", () => {
    state.active = 0;
    const h = r(<BulletChart data={[{ label: "a", value: null, target: 10 }, { label: "b", value: 5, target: 10 }]} width={400} animate={false} />);
    expect(tds(h)[0]).toBe("a=- / target 10");
    expect(desc(h)).toContain("a - (target 10)");
    expect(h).not.toMatch(/>0%</);
  });

  it("stream leaves out series with no value at a point", () => {
    const h = r(<StreamGraph data={[{ x: "a", s: "p", y: 3 }, { x: "a", s: "q", y: 4 }, { x: "b", s: "p", y: 2 }]} series="s" width={400} animate={false} />);
    expect(tds(h)).toContain("b=p 2");
  });
});

describe("14: accessible text keeps the unit", () => {
  it("bubble table uses the value format with unit, box summary has the unit on q1 and q3", () => {
    const b = r(<BubbleChart data={[{ x: 1, y: 250000, label: "p" }, { x: 2, y: 120000, label: "q" }]} unit="원" width={400} animate={false} />);
    expect(tds(b)).toContain("p=x 1, y 250,000원");
    const x = r(<BoxPlot data={[1, 2, 3, 4, 5].map((value) => ({ group: "g", value }))} unit="원" width={400} animate={false} />);
    expect(tds(x)[0]).toBe("g=median 3원, IQR 2원 to 4원");
  });

  it("a missing value shows the dash without the unit", () => {
    const data = [
      { axis: "Speed", p: 3, q: 4 },
      { axis: "Stability", p: null, q: 5 },
    ];
    const h = r(<RadarChart data={data} value={["p", "q"]} unit="원" width={400} animate={false} />);
    expect(tds(h).join(" | ")).not.toContain("-원");
    expect(tds(h)).toContain("Stability=p -, q 5원");
    // 게이지 가운데 큰 숫자도 fv를 거쳐요
    const g = texts(r(<GaugeChart data={[{ value: null, target: 85 }]} unit="%" width={300} animate={false} />)).map((t) => t.text);
    expect(g).toContain("-");
    expect(g).not.toContain("-%");
  });

  it("box plot whiskers: reversed values draw the same, invalid ones fall back to Tukey without NaN", () => {
    const data = Array.from({ length: 100 }, (_, i) => ({ group: "g", value: i + 1 }));
    const draw = (whiskers?: readonly [number, number]) => r(<BoxPlot data={data} whiskers={whiskers} width={400} animate={false} />);
    expect(draw([95, 5])).toBe(draw([5, 95]));
    expect(draw([5, 150])).toBe(draw());
    expect(draw([5, 150])).not.toContain("NaN");
    expect(draw([5, 95])).not.toBe(draw());
  });
});

describe("15: bar value labels", () => {
  it("thins single-series column labels that would overlap and keeps the highlighted one", () => {
    const d = Array.from({ length: 40 }, (_, i) => ({ x: `c${i}`, y: 10000 + i * 137 }));
    const h = r(<BarChart data={d} width={360} animate={false} />);
    const labels = texts(h).filter((t) => t.anchor === "middle" && /^1\d,\d{3}$/.test(t.text));
    expect(labels.length).toBeGreaterThan(1);
    expect(labels.length).toBeLessThan(40);
    for (let i = 1; i < labels.length; i++) expect(labels[i].x - labels[i - 1].x).toBeGreaterThanOrEqual((textWidth(labels[i].text, labels[i].size, 500) + textWidth(labels[i - 1].text, labels[i - 1].size, 500)) / 2);
    expect(labels.map((l) => l.text)).toContain("15,343");
    // 넉넉하면 모두 그려요
    const few = r(<BarChart data={d.slice(0, 5)} width={360} animate={false} />);
    expect(texts(few).filter((t) => t.anchor === "middle" && /^1\d,\d{3}$/.test(t.text))).toHaveLength(5);
  });

  it("puts a negative bar's label below the bar end, above the x axis", () => {
    const h = r(<BarChart data={[{ x: "a", y: 10 }, { x: "b", y: -10 }]} width={360} height={240} animate={false} />);
    const neg = textOf(h, "-10").find((t) => t.anchor === "middle" && t.size <= 11)!;
    const pos = textOf(h, "10").find((t) => t.anchor === "middle" && t.size <= 11)!;
    const zero = +/<line x1="[\d.]+" x2="[\d.]+" y1="([\d.]+)"[^>]*opacity="0.7"/.exec(h)![1];
    expect(pos.y).toBeLessThan(zero);
    expect(neg.y).toBeGreaterThan(zero + 20);
    expect(neg.y + 6).toBeLessThan(240 - 22 + 13 - 6);
  });
});

describe("16: edge layouts", () => {
  it("calendar keeps a year of days inside the chart width, down to 160px", () => {
    const data = Array.from({ length: 365 }, (_, i) => ({ date: new Date(2025, 0, 1 + i), value: i % 7 }));
    for (const w of [160, 240, 260, 600]) {
      const h = r(<CalendarHeatmap data={data} width={w} animate={false} />);
      const edges = [...h.matchAll(/<rect x="([\d.-]+)" y="[\d.-]+" width="([\d.]+)" height="[\d.]+" rx=/g)].map((m) => Number(m[1]) + Number(m[2]));
      expect(edges.length).toBe(365);
      expect(Math.max(...edges)).toBeLessThanOrEqual(w);
    }
  });

  it("ridgeline with overlap 0 and one group has no NaN", () => {
    const h = r(<RidgelineChart data={[1, 2, 3].map((value) => ({ group: "a", value }))} overlap={0} width={400} animate={false} />);
    expect(h).not.toContain("NaN");
    expect(h).not.toContain("Infinity");
  });

  it("bullet with a shared axis keeps tick labels inside the chart", () => {
    const h = r(<BulletChart data={[{ label: "a", value: 50, target: 70 }, { label: "b", value: 30, target: 40 }]} independent={false} width={400} animate={false} />);
    const H = viewH(h);
    const ticks = texts(h).filter((t) => t.anchor === "middle" && t.size === 10.5);
    expect(ticks.length).toBeGreaterThan(1);
    for (const t of ticks) expect(t.y + t.size * 0.6).toBeLessThanOrEqual(H);
    // 눈금 글자는 마지막 줄 띠(가운데 ± 13px) 아래에 와요
    const lastRow = Math.max(...textOf(h, "b").map((t) => t.y));
    for (const t of ticks) expect(t.y - t.size * 0.6).toBeGreaterThan(lastRow + 13);
  });

  it("calendar colours negative days instead of drawing them as empty", () => {
    const h = r(<CalendarHeatmap data={[{ date: "2024-01-01", value: -50 }, { date: "2024-01-02", value: 0 }, { date: "2024-01-03", value: 50 }]} width={500} animate={false} />);
    const cells = [...h.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" rx="[\d.]+" fill="([^"]+)"/g)].map((m) => m[1]);
    const [neg, zero, posi] = cells;
    expect(neg).toBe(posi);
    expect(neg).not.toBe(zero);
  });

  it("18: calendar ArrowLeft/ArrowRight move by a week, Up/Down keep the day-by-day default", () => {
    const data = Array.from({ length: 28 }, (_, k) => ({ date: new Date(2024, 0, 1 + k), value: k }));
    state.spy = true;
    state.active = 3;
    r(<CalendarHeatmap data={data} width={500} animate={false} />);
    expect(frame().onKey!(keyEvent("ArrowRight"))).toBe(true);
    expect(frame().onKey!(keyEvent("ArrowLeft"))).toBe(true);
    expect(state.calls).toEqual([[10, "keyboard"]]);
    expect(frame().onKey!(keyEvent("ArrowDown"))).toBe(false);
  });
});

describe("17: annotations", () => {
  const months = ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06"].map((m, i) => ({ m, v: 10 + i * 2 }));

  it("line draws a target band, a reference line and an event, and widens the y axis to fit them", () => {
    const h = r(<LineChart data={months} x="m" y="v" width={480} animate={false} annotations={[{ type: "band", y: [30, 40], label: "Target" }, { type: "line", y: 5, label: "Floor" }, { type: "event", x: "2025-03", label: "Launch" }]} />);
    for (const s of ["Target", "Floor", "Launch"]) expect(textOf(h, s).length).toBe(1);
    // 데이터는 10~20이지만 축이 40까지 넓어지고, 5의 기준선도 x축 글자 위 그림 안에 와요 (이름표는 선 10px 위)
    const ticks = texts(h).filter((t) => t.anchor === "end").map((t) => Number(t.text.replace(/,/g, "")));
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(40);
    const axisY = Math.min(...texts(h).filter((t) => t.anchor === "middle").map((t) => t.y));
    expect(textOf(h, "Floor")[0].y + 10).toBeLessThan(axisY - 8);
    expect(desc(h)).toContain("Annotations: band 30 to 40 (Target); reference line at 5 (Floor); Launch at Mar.");
  });

  it("forecast keeps the line solid before its x and dashes it after", () => {
    const h = r(<LineChart data={months} x="m" y="v" width={480} animate={false} locale="ko-KR" annotations={[{ type: "forecast", from: "2025-04" }]} />);
    expect(h).toMatch(/<clipPath id="[^"]*pre">/);
    expect(h).toMatch(/<clipPath id="[^"]*post">/);
    expect(h).toContain('stroke-dasharray="5 4"');
    expect(textOf(h, "예측").length).toBe(1);
    expect(desc(h)).toContain("주석: 4월부터 예측.");
  });

  it("signColors paints the highlighted series below the baseline in downColor", () => {
    const data = [5, -3, 4, -2, 6].map((v, i) => ({ m: i, v }));
    const h = r(<LineChart data={data} x="m" y="v" width={480} animate={false} signColors downColor="#d00000" />);
    expect(h).toMatch(/<path[^>]*stroke="#d00000"[^>]*clip-path="url\(#[^"]*dn\)"/);
    // 기준값 아래 점도 같은 색이에요
    expect(h).toMatch(/<circle[^>]*fill="#d00000"/);
    // 없으면 예전처럼 한 색
    expect(r(<LineChart data={data} x="m" y="v" width={480} animate={false} downColor="#d00000" />)).not.toContain("#d00000");
  });

  it("weekends shade Saturday and Sunday on a daily date axis", () => {
    const days = Array.from({ length: 14 }, (_, k) => ({ d: new Date(2025, 0, 6 + k), v: k }));
    const h = r(<LineChart data={days} x="d" y="v" width={480} animate={false} annotations={[{ type: "weekends" }]} />);
    expect([...h.matchAll(/<rect [^>]*opacity="0.045"/g)].length).toBe(2);
  });

  it("bar forecast fades later bars with a dashed outline, and horizontal bars draw no annotations", () => {
    const data = ["Q1", "Q2", "Q3", "Q4"].map((x, i) => ({ x, y: 40 + i * 5 }));
    const notes = [{ type: "forecast" as const, from: "Q3" }, { type: "line" as const, y: 50, label: "Goal" }];
    const h = r(<BarChart data={data} width={480} animate={false} annotations={notes} />);
    const faded = markGroups(h).map((g) => g.includes('fill-opacity="0.42"') && g.includes('stroke-dasharray="3 2"'));
    expect(faded).toEqual([false, false, true, true]);
    expect(textOf(h, "Goal").length).toBe(1);
    const flat = r(<BarChart data={data} width={480} animate={false} orientation="horizontal" annotations={notes} />);
    expect(textOf(flat, "Goal").length).toBe(0);
    expect(flat).not.toContain('fill-opacity="0.42"');
  });

  it("candlestick fits a trend on the closes and places an event by time", () => {
    const data = Array.from({ length: 10 }, (_, k) => ({ date: `2025-01-${String(k + 1).padStart(2, "0")}`, open: 100 + k, high: 104 + k, low: 98 + k, close: 102 + k }));
    const h = r(<CandlestickChart data={data} width={480} animate={false} annotations={[{ type: "trend" }, { type: "event", x: "2025-01-05", label: "Earnings" }]} />);
    expect(textOf(h, "Trend").length).toBe(1);
    expect(textOf(h, "Earnings").length).toBe(1);
    expect(h).toContain('stroke-dasharray="6 4"');
    expect(desc(h)).toContain("Annotations: trend line; Earnings at Jan 5, 2025.");
  });
});

describe("18: live line", () => {
  const T0 = Date.UTC(2025, 5, 3, 3, 0, 0);
  const data = Array.from({ length: 200 }, (_, i) => ({ t: T0 + i * 1000, v: 100 + (i % 7) }));

  it("keeps the window, puts the newest value at the right edge and labels time from now", () => {
    const h = r(<LiveLineChart data={data} width={480} animate={false} />);
    // 1분 창 + 왼쪽 밖 몇 점만 그려요 (200점을 다 그리지 않아요)
    const d = /<path d="(M[^"]+)" fill="none"/.exec(h)![1];
    const n = d.split("L").length;
    expect(n).toBeGreaterThanOrEqual(61);
    expect(n).toBeLessThan(70);
    for (const s of ["now", "1m ago", "30s ago", "103"]) expect(textOf(h, s).length).toBe(1);
    expect(desc(h)).toContain("Last 1m, 61 points. Latest 103");
    expect(h).not.toContain("<animate");
    const ko = r(<LiveLineChart data={data} width={480} animate={false} locale="ko-KR" />);
    for (const s of ["지금", "1분 전", "30초 전"]) expect(textOf(ko, s).length).toBe(1);
  });

  it("keeps the clock moving through a data gap instead of freezing and rushing after it", () => {
    const s = { tA: 10_000, gap: 250, win: 60_000, paused: false };
    // 끊김: 가장 새 점을 넘어서도 프레임마다 같은 속도로 흘러요 (예전에는 tA에서 멈췄어요)
    let clock = 9_900;
    for (let f = 0; f < 120; f++) clock = stepClock(clock, 16, s);
    expect(clock).toBe(9_900 + 120 * 16);
    // 끊김 뒤 실시간으로 온 점(tA가 시계 근처)이면 따라잡기 없이 평소 속도예요
    expect(stepClock(clock, 16, { ...s, tA: clock + 100 })).toBe(clock + 16);
    // 두 간격 넘게 뒤처지면(쌓인 점) 빨리 따라잡고, 멈춤(짚는 중)이면 그대로, 창 하나보다 앞서면 가장 새 점으로
    expect(stepClock(9_000, 16, s) - 9_000).toBe(16 * (1_000 / 500));
    expect(stepClock(9_000, 16, { ...s, paused: true })).toBe(9_000);
    expect(stepClock(s.tA + s.win, 16, s)).toBe(s.tA);
  });

  it("points at the nearest point by time", () => {
    state.spy = true;
    r(<LiveLineChart data={data} width={480} animate={false} />);
    frame().onPointerMove!(479, 50, pointer);
    frame().onPointerMove!(0, 50, pointer);
    const n = frame().events.length;
    expect(state.calls).toEqual([
      [n - 1, "pointer"],
      [0, "pointer"],
    ]);
  });
});

/** 키보드로 k를 고른 상태로 그려요. 툴팁과 라이브 영역 글이 같이 찍혀요 */
const atKey = (k: number, draw: () => string) => {
  state.active = k;
  state.via = "keyboard";
  try {
    return draw();
  } finally {
    state.active = null;
    state.via = "pointer";
  }
};
const bigLine = Array.from({ length: 10000 }, (_, i) => ({ x: i, y: Math.round((Math.sin(i / 60) * 40 + (i % 13) - 6) * 100) / 100 }));
const bigArea = Array.from({ length: 10000 }, (_, i) => ({ x: i, a: 10 + (i % 17), b: 20 + Math.round(Math.cos(i / 90) * 8) }));
/**
 * 이름 → 그림. 레지스트리 예시(영어, 한국어), 변형, 서버 SVG(PNG 원본), 키보드로 고른 상태, 1만 점 줄이기(라인은 LTTB, 쌓은 영역은 구간 평균).
 * 다크 테마는 맨 앞 테마 변수만 달라서 라이트만 둬요
 */
function plainCases(): Record<string, () => string> {
  const out: Record<string, () => string> = {};
  for (const type of ["line", "area"]) {
    const def = CHARTS.find((c) => c.type === type)!;
    for (const lang of ["en", "ko"] as const)
      out[`${type}/${lang}`] = () =>
        r(
          <ThemeProvider theme="light">
            <Chart spec={localizeDef(def, lang).example} width={640} animate={false} />
          </ThemeProvider>,
        );
    // 띠를 켜는 변형(band, forecast-band)은 띠 그림이라 빼요
    for (const v of VARIANTS[type].filter((x) => !x.encoding?.lower)) out[`${type}/variant/${v.id}`] = () => r(<Chart spec={variantSpec(def, v.id)!} width={480} animate={false} />);
    out[`${type}/svg`] = () => renderSpecToSVG(def.example, { width: 720, theme: "light" });
    out[`${type}/keyboard`] = () => atKey(5, () => r(<Chart spec={def.example} width={640} animate={false} />));
  }
  out["line/10k"] = () => r(<LineChart data={bigLine} maxPoints={200} width={640} animate={false} />);
  out["area/10k"] = () => r(<AreaChart data={bigArea} y={["a", "b"]} maxPoints={200} width={640} animate={false} />);
  return out;
}

/** 띠 path(불투명도 0.16)와 칠한 색 */
const bandPaths = (h: string) => [...h.matchAll(/<path d="([^"]+)" fill="([^"]+)" opacity="0.16"/g)].map((m) => ({ d: m[1], fill: m[2] }));
/** 선 path. 굵기 2.6은 강조 계열, 1.7은 나머지 */
const linePaths = (h: string) => [...h.matchAll(/<path d="([^"]+)" fill="none" stroke="([^"]+)" stroke-width="([\d.]+)"/g)].map((m) => ({ d: m[1], stroke: m[2], width: +m[3] }));
/** 툴팁 글 (태그를 빼고 빈칸 하나로) */
const tipText = (h: string) => decode((/<div class="ztd-tip"[^>]*>(.*?)<\/div><span class="ztd-sr"/.exec(h)?.[1] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const liveText = (h: string) => decode(/aria-live="polite" aria-atomic="true">([^<]*)</.exec(h)![1]);

describe("19: range band", () => {
  /** 띠를 넣기 전(0.4.1, d806a87) 마크업. 띠가 없는 라인, 영역 그림은 이것과 바이트까지 같아야 해요 */
  const BEFORE = new URL("./fixtures/line-area-before.json", import.meta.url);

  it("charts without a band render the same markup as before the band", () => {
    const cases = plainCases();
    const before = JSON.parse(readFileSync(BEFORE, "utf8")) as Record<string, string>;
    expect(Object.keys(before).sort()).toEqual(Object.keys(cases).sort());
    for (const [name, draw] of Object.entries(cases)) expect(draw(), name).toBe(before[name]);
  });

  /** 계단 띠의 가로 변 (M, H, V만 써요) */
  const hsegs = (d: string) => {
    const out: { a: number; b: number; y: number }[] = [];
    let x = 0;
    let y = 0;
    for (const [, c, p, q] of d.matchAll(/([MHVZ])([-\d.]*)(?:,([-\d.]+))?/g)) {
      if (c === "M") [x, y] = [+p, +q];
      else if (c === "H") {
        out.push({ a: Math.min(x, +p), b: Math.max(x, +p), y });
        x = +p;
      } else if (c === "V") y = +p;
    }
    return out;
  };
  /** x에서 띠의 위, 아래 y (그 x를 지나는 가로 변 중 가장 위, 가장 아래) */
  const bandAt = (segs: ReturnType<typeof hsegs>, x: number) => {
    const ys = segs.filter((g) => g.a - 1e-6 <= x && x <= g.b + 1e-6).map((g) => g.y);
    return { top: Math.min(...ys), bottom: Math.max(...ys) };
  };
  /** 매끈한 선(M x,y C … C …)의 꼭짓점과 구간 가운데 점 (3차 베지어 t = 0.5) */
  const curveSamples = (d: string) => {
    const p = pairs(d);
    const out: { vertex: [number, number]; mid?: [number, number] }[] = [{ vertex: p[0] }];
    for (let i = 1; i + 2 < p.length; i += 3) {
      const [a, c1, c2, b] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
      out.push({ vertex: b, mid: [(a[0] + 3 * c1[0] + 3 * c2[0] + b[0]) / 8, (a[1] + 3 * c1[1] + 3 * c2[1] + b[1]) / 8] });
    }
    return out;
  };
  /** 1만 점, 두 계열(넓은 표). 위 경계에 한 점짜리 뾰족한 값이 있고, 97번째 점마다 선이 위 경계에 닿아요 (구간 평균이면 둘 다 띠 밖으로 나가요) */
  const noise = (i: number) => {
    const v = Math.sin(i * 12.9898) * 43758.5453;
    return (v - Math.floor(v)) * 2 - 1;
  };
  const tenK = Array.from({ length: 10000 }, (_, i) => {
    const a = 150 + 60 * Math.sin(i / 500) + 5 * noise(i);
    const b = 70 + 25 * Math.cos(i / 300) + 4 * noise(i + 1e5);
    const wa = 10 + 6 * Math.abs(noise(i + 2e5));
    const wb = 8 + 5 * Math.abs(noise(i + 3e5));
    const aHi = a + wa + (i === 4321 ? 80 : 0);
    return { x: i, a: i % 97 ? a : aHi, aLo: a - wa, aHi, b: i % 97 ? b : b + wb, bLo: b - wb, bHi: b + wb };
  });
  const H10K = 300;
  // yDomain을 정해서 값 → 픽셀을 테스트가 직접 계산해요 (위 여백 10, 아래 22)
  const yPx = (v: number) => H10K - 22 - (v / 300) * (H10K - 22 - 10);
  const drawTenK = () => r(<LineChart data={tenK} y={["a", "b"]} lower={["aLo", "bLo"]} upper={["aHi", "bHi"]} yDomain={[0, 300]} width={640} height={H10K} animate={false} />);
  const tenKBands = (h: string) => {
    const lines = linePaths(h);
    const bands = bandPaths(h);
    // 강조 계열(a)은 accent, 나머지(b)는 회색이에요
    const accent = (f: string) => f.includes("accent");
    return [
      { lo: "aLo", hi: "aHi", line: lines.find((l) => l.width === 2.6)!, band: hsegs(bands.find((b) => accent(b.fill))!.d) },
      { lo: "bLo", hi: "bHi", line: lines.find((l) => l.width === 1.7)!, band: hsegs(bands.find((b) => !accent(b.fill))!.d) },
    ] as const;
  };

  it("10k points in two series: every pixel column covers the lowest lower and the highest upper of its points", () => {
    const h = drawTenK();
    expect(bandPaths(h)).toHaveLength(2);
    for (const { lo, hi, line, band } of tenKBands(h)) {
      // 선은 첫 점과 끝 점을 남겨요: 그 x가 데이터의 x 범위예요
      const p = pairs(line.d);
      const [x0, x1] = [p[0][0], p[p.length - 1][0]];
      const cols = new Map<number, { lo: number; hi: number }>();
      tenK.forEach((d, i) => {
        const c = Math.floor(x0 + ((x1 - x0) * i) / (tenK.length - 1));
        const m = cols.get(c) ?? { lo: Infinity, hi: -Infinity };
        cols.set(c, { lo: Math.min(m.lo, d[lo]), hi: Math.max(m.hi, d[hi]) });
      });
      expect(cols.size).toBeGreaterThan(500);
      for (const [c, want] of cols) {
        if (c + 0.5 < x0 || c + 0.5 > x1) continue;
        const got = bandAt(band, c + 0.5);
        // 픽셀은 아래로 커져요: 아래 경계는 원본 lower 최솟값 이하(더 아래), 위 경계는 upper 최댓값 이상(더 위)
        expect(got.bottom, `column ${c}`).toBeGreaterThanOrEqual(yPx(want.lo) - 0.006);
        expect(got.top, `column ${c}`).toBeLessThanOrEqual(yPx(want.hi) + 0.006);
      }
    }
    // 한 점짜리 위 경계(80 높은 값)도 남아요
    const spike = tenK[4321].aHi;
    expect(Math.min(...tenKBands(h)[0].band.map((g) => g.y))).toBeLessThanOrEqual(yPx(spike) + 0.006);
  });

  it("200 samples of each drawn line (points and curve midpoints) lie inside its band", () => {
    for (const { line, band } of tenKBands(drawTenK())) {
      const all = curveSamples(line.d);
      // LTTB로 줄여도 점이 200개보다 많아요
      expect(all.length).toBeGreaterThan(200);
      const step = (all.length - 1) / 199;
      for (let i = 0; i < 200; i++) {
        const s = all[Math.round(i * step)];
        for (const [x, y] of s.mid ? [s.vertex, s.mid] : [s.vertex]) {
          const got = bandAt(band, x);
          expect(y, `x ${x}`).toBeGreaterThanOrEqual(got.top - 0.01);
          expect(y, `x ${x}`).toBeLessThanOrEqual(got.bottom + 0.01);
        }
      }
    }
  });

  const days = (n: number) => Array.from({ length: n }, (_, i) => `2025-01-${String(i + 1).padStart(2, "0")}`);

  it("crossed bounds draw the same band as the bounds in order", () => {
    const rows = days(8).map((day, i) => ({ day, v: 50 + i, lo: 40 + i, hi: 62 + i * 2 }));
    // 셋째, 여섯째 행은 아래와 위가 바뀌었어요
    const crossed = rows.map((d, i) => (i === 2 || i === 5 ? { ...d, lo: d.hi, hi: d.lo } : d));
    const band = (data: typeof rows) => bandPaths(r(<LineChart data={data} x="day" y="v" lower="lo" upper="hi" width={480} animate={false} />));
    expect(band(crossed)).toHaveLength(1);
    expect(band(crossed)).toEqual(band(rows));
  });

  it("a missing bound breaks the band at that x and the tooltip there has no range", () => {
    const rows = days(9).map((day, i) => ({ day, v: 50 + i, lo: 40 + i, hi: i === 4 ? null : 60 + i }));
    const draw = () => r(<LineChart data={rows} x="day" y="v" lower="lo" upper="hi" width={480} animate={false} />);
    const h = draw();
    const [band] = bandPaths(h);
    const runs = band.d.split("M").slice(1).map((d) => pairs(`M${d}`).map((q) => q[0]));
    expect(runs).toHaveLength(2);
    const xs = pairs(linePaths(h)[0].d).filter((_, i) => i % 3 === 0).map((q) => q[0]);
    expect(xs).toHaveLength(9);
    expect(Math.max(...runs[0])).toBeCloseTo(xs[3], 1);
    expect(Math.min(...runs[1])).toBeCloseTo(xs[5], 1);
    state.active = 4;
    expect(tipText(draw())).toBe("1/5 v 54");
    state.active = 5;
    expect(tipText(draw())).toBe("1/6 v 55 (lo 45 ~ hi 65)");
  });

  it('bandFrom "forecast" starts the band at the forecast x, and without a forecast draws no band', () => {
    const rows = days(10).map((day, i) => ({ day, v: 50 + i, lo: 40 + i, hi: 60 + i * 2 }));
    const notes = [{ type: "forecast" as const, from: "2025-01-07" }];
    const draw = (extra: object) => r(<LineChart data={rows} x="day" y="v" lower="lo" upper="hi" width={480} animate={false} {...extra} />);
    const h = draw({ bandFrom: "forecast", annotations: notes });
    const xf = +/<line x1="([\d.]+)" x2="[\d.]+" y1="[\d.]+" y2="[\d.]+" stroke="[^"]+" stroke-dasharray="2 3"/.exec(h)![1];
    const start = (html: string) => Math.min(...pairs(bandPaths(html)[0].d).map((q) => q[0]));
    expect(start(h)).toBeCloseTo(xf, 1);
    // 기본("start")은 첫 x부터
    expect(start(draw({ annotations: notes }))).toBeLessThan(xf - 100);
    expect(bandPaths(draw({ bandFrom: "forecast" }))).toHaveLength(0);
  });

  it("a chart narrower than its margins draws without throwing", () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ x: i, v: 50 + (i % 7), lo: 40 + (i % 5), hi: 60 + (i % 9) }));
    for (const width of [0, 20, 40]) expect(() => r(<LineChart data={rows} x="x" y="v" lower="lo" upper="hi" width={width} animate={false} />), `width ${width}`).not.toThrow();
  });

  it("lower and upper with nothing to draw render the same as a chart without a band", () => {
    const rows = days(10).map((day, i) => ({ day, v: 50 + i, lo: 40 + i, hi: 60 + i * 2 }));
    state.active = 4;
    const plain = r(<LineChart data={rows} x="day" y="v" width={480} animate={false} />);
    expect(r(<LineChart data={rows} x="day" y="v" lower="lo" upper="hi" bandFrom="forecast" width={480} animate={false} />)).toBe(plain);
  });

  it("outside marks the drawn points outside the band and counts them in the description", () => {
    const rows = days(8).map((day, i) => ({ day, v: i === 2 ? 75 : i === 6 ? 30 : 50 + i, lo: 40 + i, hi: 60 + i }));
    const marks = (h: string) => [...h.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="3.6"/g)].map((m) => +m[1]);
    const on = r(<LineChart data={rows} x="day" y="v" lower="lo" upper="hi" outside width={480} animate={false} />);
    const xs = pairs(linePaths(on)[0].d).filter((_, i) => i % 3 === 0).map((q) => q[0]);
    expect(marks(on)).toHaveLength(2);
    expect(marks(on)[0]).toBeCloseTo(xs[2], 1);
    expect(marks(on)[1]).toBeCloseTo(xs[6], 1);
    expect(desc(on)).toContain("Range lo to hi. 2 points outside the range: 1/3, 1/7.");
    const off = r(<LineChart data={rows} x="day" y="v" lower="lo" upper="hi" width={480} animate={false} />);
    expect(marks(off)).toEqual([]);
    expect(desc(off)).not.toContain("outside");
  });

  it('tooltip and live region read the value, then the range: "p50 820ms (p5 410 ~ p95 2,300)"', () => {
    const rows = days(10).map((day, i) => ({ day, p50: i === 4 ? 820 : 700 + i * 10, p5: i === 4 ? 410 : 400, p95: i === 4 ? 2300 : 1900 }));
    const draw = (extra: object = {}) => r(<LineChart data={rows} x="day" y="p50" lower="p5" upper="p95" unit="ms" width={480} animate={false} {...extra} />);
    state.active = 4;
    state.via = "keyboard";
    const h = draw();
    expect(tipText(h)).toBe("1/5 p50 820ms (p5 410 ~ p95 2,300)");
    expect(liveText(h)).toBe("1/5: p50 820ms (p5 410 ~ p95 2,300) (5/10)");
    // 범위가 축 밖으로 넘치지 않아요 (축이 p95까지 넓어져요)
    for (const [, y] of pairs(bandPaths(h)[0].d)) expect(y).toBeGreaterThanOrEqual(10 - 0.01);
    // 함수로 준 경계는 이름 대신 "하한", "상한"
    const ko = draw({ lower: (d: { p5: number }) => d.p5, upper: (d: { p95: number }) => d.p95, locale: "ko-KR" });
    expect(liveText(ko)).toContain("p50 820ms (하한 410 ~ 상한 2,300)");
  });

  it("long and wide tables draw the same bands, the highlight in accent and the others gray, and stacked areas draw none", () => {
    const long = days(6).flatMap((day, i) => [
      { day, app: "A", v: 50 + i, lo: 45 + i, hi: 56 + i },
      { day, app: "B", v: 30 + i, lo: 26 + i, hi: 35 + i },
    ]);
    const wide = days(6).map((day, i) => ({ day, A: 50 + i, A_lo: 45 + i, A_hi: 56 + i, B: 30 + i, B_lo: 26 + i, B_hi: 35 + i }));
    const fromLong = bandPaths(r(<LineChart data={long} x="day" y="v" series="app" lower="lo" upper="hi" width={480} animate={false} />));
    const fromWide = bandPaths(r(<LineChart data={wide} x="day" y={["A", "B"]} lower={["A_lo", "B_lo"]} upper={["A_hi", "B_hi"]} width={480} animate={false} />));
    expect(fromLong).toEqual(fromWide);
    expect(fromLong.map((b) => b.fill.includes("accent"))).toEqual([false, true]);
    const area = (stack: "none" | "stacked") => bandPaths(r(<AreaChart data={long} x="day" y="v" series="app" lower="lo" upper="hi" stack={stack} width={480} animate={false} />));
    expect(area("none")).toHaveLength(2);
    expect(area("stacked")).toHaveLength(0);
  });
});

describe("20: lines break at missing values", () => {
  /** 빠진 값에서 선을 끊기 전(764eb2b) 마크업. 빠진 값이 없는 그림과 쌓은 영역은 이것과 바이트까지 같아야 해요 */
  const BEFORE = new URL("./fixtures/line-gaps-before.json", import.meta.url);
  const DAYS = Array.from({ length: 14 }, (_, i) => `2025-01-${String(i + 1).padStart(2, "0")}`);
  /** 긴 표, 14일. Ours는 4, 5일(null, undefined)과 10일(NaN)이 빠지고, Rival은 첫날 행이 없고 끝 이틀이 null, Other는 7일 하나만 이웃 없이 남아요 */
  const longGaps = DAYS.flatMap((day, i) => [
    { day, app: "Ours", v: i === 3 ? null : i === 4 ? undefined : i === 9 ? NaN : 50 + i * 2 + (i % 3) },
    ...(i === 0 ? [] : [{ day, app: "Rival", v: i >= 12 ? null : 40 + (i % 4) * 3 }]),
    { day, app: "Other", v: i < 6 || i === 7 ? null : 30 + i },
  ]);
  /** 넓은 표, x 0~23. a는 8, 9가 값과 범위 모두 빠지고 15는 값만 빠져요(범위는 있어요). 5는 범위 밖. b는 앞 셋과 끝 둘이 빠지고 12는 이웃 없이 남아요 */
  const wideGaps = Array.from({ length: 24 }, (_, i) => {
    const mid = Math.round((60 + 10 * Math.sin(i / 3)) * 10) / 10;
    const gap = i === 8 || i === 9;
    return { t: i, a: gap || i === 15 ? null : i === 5 ? mid + 14 : mid, aLo: gap ? null : mid - 6, aHi: gap ? null : mid + 6, b: i < 3 || i === 11 || i === 13 || i >= 22 ? null : 40 + (i % 5) * 2 };
  });
  /** 12개월 영역(겹치기, 손익 색, 계단). p는 5, 6월이 빠지고 음수도 있어요. q는 앞 두 달, 7월, 9월, 12월이 빠져서 8월이 혼자 남아요 */
  const areaGapsSpec = (extra: object): ChartSpec => ({
    type: "area",
    data: Array.from({ length: 12 }, (_, i) => ({ m: `2025-${String(i + 1).padStart(2, "0")}`, p: i === 4 || i === 5 ? null : Math.round(20 * Math.sin(i / 2)), q: i < 2 || i === 6 || i === 8 || i === 11 ? null : 10 + i })),
    encoding: { x: "m", y: ["p", "q"] },
    options: { stack: "none", signColors: true, curve: "step", ...extra },
  });
  /** 1만 점. 앞 10점, 2000~2049, 5000, 6990~7020(7000만 남아요), 끝 50점이 빠져요 */
  const tenKGaps = bigLine.map((d, i) => ({ x: d.x, y: i < 10 || (i >= 2000 && i < 2050) || i === 5000 || (Math.abs(i - 7005) <= 15 && i !== 7000) || i >= 9950 ? null : d.y }));

  /** 빠진 값이 없는 그림: 위 plainCases에 띠 변형, 1만 점 띠, 1만 점 겹친 영역(LTTB)을 더해요. 쌓은 영역은 빠진 값이 있어도 예전 그대로라 같이 둬요 */
  function gapFreeCases(): Record<string, () => string> {
    const out = plainCases();
    const line = CHARTS.find((c) => c.type === "line")!;
    for (const v of VARIANTS.line.filter((x) => x.encoding?.lower)) out[`line/variant/${v.id}`] = () => r(<Chart spec={variantSpec(line, v.id)!} width={480} animate={false} />);
    out["line/10k-band"] = () => r(<LineChart data={bigLine.map((d) => ({ ...d, lo: d.y - 6, hi: d.y + 6 }))} lower="lo" upper="hi" maxPoints={200} width={640} animate={false} />);
    out["area/10k-overlap"] = () => r(<AreaChart data={bigArea} y={["a", "b"]} stack="none" maxPoints={200} width={640} animate={false} />);
    out["area/stacked-gaps"] = () => atKey(3, () => r(<AreaChart data={longGaps} x="day" y="v" series="app" width={480} animate={false} />));
    return out;
  }
  /** 빠진 값이 있는 그림. 끊기 전에는 이웃 점을 이었어요. 지금은 connectNulls를 켜면 그때와 같아요 */
  function gapCases(extra: { connectNulls?: boolean } = { connectNulls: true }): Record<string, () => string> {
    return {
      // 키보드로 Ours가 빠진 4일을 골라요
      "gaps/long-keyboard": () => atKey(3, () => r(<LineChart data={longGaps} x="day" y="v" series="app" width={480} animate={false} {...extra} />)),
      "gaps/wide-band": () => r(<LineChart data={wideGaps} x="t" y={["a", "b"]} lower={["aLo"]} upper={["aHi"]} area outside annotations={[{ type: "trend" }, { type: "forecast", from: 18 }]} width={640} animate={false} {...extra} />),
      "gaps/area-svg": () => renderSpecToSVG(areaGapsSpec(extra), { width: 640, theme: "light" }),
      "gaps/10k": () => r(<LineChart data={tenKGaps} maxPoints={200} width={640} animate={false} {...extra} />),
    };
  }
  const before = () => JSON.parse(readFileSync(BEFORE, "utf8")) as Record<string, string>;

  it("charts without missing values, and stacked areas with them, render the same markup as before", () => {
    const pinned = before();
    expect(Object.keys(pinned).sort()).toEqual([...Object.keys(gapFreeCases()), ...Object.keys(gapCases())].sort());
    for (const [name, draw] of Object.entries(gapFreeCases())) expect(draw(), name).toBe(pinned[name]);
  });

  it("connectNulls draws the same data with missing values as before: neighbours joined", () => {
    const pinned = before();
    for (const [name, draw] of Object.entries(gapCases())) expect(draw(), name).toBe(pinned[name]);
  });

  /** path의 하위 경로마다 (x, y) 쌍. curve "linear"면 꼭짓점이에요 */
  const subpaths = (d: string) => d.split("M").slice(1).map((s) => pairs(`M${s}`));
  /** 점 [cx, cy, r]. 점 좌표는 반올림하지 않아서 path와 같은 0.01 단위로 맞춰요 */
  const circles = (h: string) => [...h.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"/g)].map((m) => [Math.round(+m[1] * 100) / 100, Math.round(+m[2] * 100) / 100, +m[3]]);
  /** 칠한 path (영역 면, 선 아래 그라데이션, 손익 색 면) */
  const fills = (h: string) => [...h.matchAll(/<path d="([^"]+)" fill="(?!none)[^"]*"/g)].map((m) => m[1]);

  it("a missing value in the middle splits the line into two runs; connectNulls joins them", () => {
    const rows = DAYS.slice(0, 10).map((day, i) => ({ day, v: i === 4 ? null : 10 + i }));
    const line = (extra: object) => linePaths(r(<LineChart data={rows} x="day" y="v" curve="linear" width={480} animate={false} {...extra} />))[0].d;
    const joined = subpaths(line({ connectNulls: true }));
    const runs = subpaths(line({}));
    expect(joined).toHaveLength(1);
    expect(runs.map((q) => q.length)).toEqual([4, 5]);
    // 점은 그대로이고, 빠진 5일을 건너 잇는 선만 없어요
    expect(runs.flat()).toEqual(joined[0]);
  });

  it("a point with no neighbours shows as a dot, also with dots off and on an overlapping area", () => {
    // 20개라 dots "auto"는 점을 그리지 않아요. 10, 12번째가 빠져서 11번째가 혼자 남아요
    const rows = Array.from({ length: 20 }, (_, i) => ({ x: i, v: i === 9 || i === 11 ? null : 10 + (i % 4) }));
    for (const Kind of [LineChart, AreaChart]) {
      const draw = (extra: object) => r(<Kind data={rows} x="x" y="v" curve="linear" width={480} animate={false} {...extra} />);
      const at = pairs(linePaths(draw({ connectNulls: true }))[0].d)[9];
      for (const h of [draw({}), draw({ dots: false })]) {
        expect(circles(h)).toEqual([[...at, 3]]);
        // 선은 그 점에서 긋는 게 없어요 (M 하나)
        expect(subpaths(linePaths(h)[0].d).map((q) => q.length)).toEqual([9, 1, 8]);
      }
      expect(circles(draw({ connectNulls: true }))).toEqual([]);
    }
  });

  it("a chart with one x has nothing missing and renders exactly as before (no added dot)", () => {
    const one = [{ x: "a", s: "p", v: 5 }, { x: "a", s: "q", v: 7 }];
    for (const Kind of [LineChart, AreaChart]) {
      const draw = (extra: object) => r(<Kind data={one} x="x" y="v" series="s" stack="none" dots={false} width={480} animate={false} {...extra} />);
      expect(draw({})).toBe(draw({ connectNulls: true }));
      expect(circles(draw({}))).toEqual([]);
    }
  });

  it("gaps at the start and the end: the line and the area cover only the x with values", () => {
    const full = DAYS.slice(0, 10).map((day, i) => ({ day, v: 10 + i }));
    const rows = full.map((d, i) => ({ ...d, v: i < 2 || i > 7 ? null : d.v }));
    const xs = pairs(linePaths(r(<LineChart data={full} x="day" y="v" curve="linear" width={480} animate={false} />))[0].d).map((q) => q[0]);
    const line = r(<LineChart data={rows} x="day" y="v" curve="linear" dots={false} width={480} animate={false} />);
    expect(subpaths(linePaths(line)[0].d).map((q) => q.map(([x]) => x))).toEqual([xs.slice(2, 8)]);
    expect(circles(line)).toEqual([]);
    const [fill] = fills(r(<AreaChart data={rows} x="day" y="v" curve="linear" width={480} animate={false} />));
    const fx = subpaths(fill).map((q) => q.map(([x]) => x));
    expect(fx).toHaveLength(1);
    expect([Math.min(...fx[0]), Math.max(...fx[0])]).toEqual([xs[2], xs[7]]);
  });

  it("long and wide tables break at the same x: a missing row and a null make the same gap", () => {
    const long = DAYS.flatMap((day, i) => [...(i === 3 ? [] : [{ day, s: "A", v: 10 + i }]), { day, s: "B", v: i === 6 ? null : 5 + (i % 3) }]);
    const wide = DAYS.map((day, i) => ({ day, A: i === 3 ? null : 10 + i, B: i === 6 ? null : 5 + (i % 3) }));
    const fromLong = linePaths(r(<LineChart data={long} x="day" y="v" series="s" width={480} animate={false} />));
    expect(fromLong).toEqual(linePaths(r(<LineChart data={wide} x="day" y={["A", "B"]} width={480} animate={false} />)));
    expect(fromLong.map((l) => subpaths(l.d).length)).toEqual([2, 2]);
  });

  it("fills break with the line: an overlapping area, the gradient under a line, and sign colours", () => {
    const rows = DAYS.slice(0, 10).map((day, i) => ({ day, v: i === 4 || i === 5 ? null : i % 2 ? 6 : -3 }));
    const p = { data: rows, x: "day", y: "v", curve: "linear", width: 480, animate: false } as const;
    for (const h of [r(<AreaChart {...p} />), r(<AreaChart {...p} signColors />), r(<LineChart {...p} area />), r(<LineChart {...p} area signColors />)]) {
      const [left, right] = subpaths(linePaths(h)[0].d);
      const gap = [left[left.length - 1][0], right[0][0]];
      const list = fills(h);
      expect(list.length).toBeGreaterThan(0);
      for (const d of list) {
        expect(subpaths(d)).toHaveLength(2);
        // 면도 빠진 두 날 사이를 칠하지 않아요
        for (const [x] of pairs(d)) expect(x <= gap[0] + 0.01 || x >= gap[1] - 0.01, `x ${x}`).toBe(true);
      }
    }
  });

  it("stacked areas keep today's treatment of missing values, with or without connectNulls", () => {
    for (const stack of ["stacked", "percent"] as const) {
      const draw = (extra: object) => r(<AreaChart data={longGaps} x="day" y="v" series="app" stack={stack} width={480} animate={false} {...extra} />);
      expect(draw({})).toBe(draw({ connectNulls: true }));
      for (const d of fills(draw({}))) expect(subpaths(d)).toHaveLength(1);
    }
  });

  it("10k points with gaps keep every gap and the lone point after LTTB", () => {
    const draw = (extra: object) => r(<LineChart data={tenKGaps} curve="linear" maxPoints={200} width={640} animate={false} {...extra} />);
    const h = draw({});
    const runs = subpaths(linePaths(h)[0].d);
    // 데이터의 조각: 10~1999, 2050~4999, 5001~6989, 7000(혼자), 7021~9949
    const ends = [[10, 1999], [2050, 4999], [5001, 6989], [7000, 7000], [7021, 9949]];
    expect(runs).toHaveLength(ends.length);
    const total = runs.reduce((n, q) => n + q.length, 0);
    expect(total).toBeGreaterThan(150);
    expect(total).toBeLessThanOrEqual(200 + 3 * runs.length);
    // x 픽셀은 데이터 x에 비례해요. 첫 점(10)과 끝 점(9949)으로 자를 만들어 조각 양끝이 데이터 조각의 양끝인지 봐요
    const [x0, x1] = [runs[0][0][0], runs[4][runs[4].length - 1][0]];
    const X = (k: number) => x0 + ((x1 - x0) * (k - 10)) / (9949 - 10);
    runs.forEach((q, i) => {
      expect(q[0][0], `run ${i} start`).toBeCloseTo(X(ends[i][0]), 1);
      expect(q[q.length - 1][0], `run ${i} end`).toBeCloseTo(X(ends[i][1]), 1);
    });
    expect(circles(h).map((c) => c[0])).toEqual([runs[3][0][0]]);
    // 한 번에 줄이면(connectNulls) 예전처럼 하나로 이어요
    expect(subpaths(linePaths(draw({ connectNulls: true }))[0].d)).toHaveLength(1);
  });

  it("animation across changing gaps (real engine): every frame is finite and draws the new runs, and each transition ends as a still render", () => {
    const sets = [
      DAYS.map((day, i) => ({ day, a: 10 + i, b: 20 - i })),
      DAYS.map((day, i) => ({ day, a: i === 6 ? null : 12 + (i % 5), b: 20 - i })),
      // a는 혼자 남은 점 하나와 세 조각, b는 두 곳이 빠져요
      DAYS.map((day, i) => ({ day, a: i % 4 === 1 ? null : 9 + i, b: i === 3 || i === 5 ? null : 15 })),
      DAYS.slice(0, 9).map((day, i) => ({ day, a: 30 - i, b: 5 + i })),
      DAYS.map((day, i) => ({ day, a: i < 3 ? null : 10 + i, b: 20 - i })),
    ];
    const views = [(rows: (typeof sets)[number]) => <LineChart data={rows} x="day" y={["a", "b"]} width={480} animate={false} />, (rows: (typeof sets)[number]) => <AreaChart data={rows} x="day" y={["a", "b"]} stack="none" width={480} animate={false} />];
    const shape = (h: string) => linePaths(h).map((l) => subpaths(l.d).map((q) => q.length));
    const still = (el: ReactElement) => {
      const [engine, motion] = [state.engine, state.motion];
      state.engine = null;
      state.motion = null;
      try {
        return r(el);
      } finally {
        [state.engine, state.motion] = [engine, motion];
      }
    };
    for (const view of views) {
      const e = new MotionEngine<never>();
      e.configure("spring", 1100);
      state.engine = e as never;
      let changeAt = 0;
      let frameAt = 0;
      // 실제 훅처럼: 목표가 바뀌면 지금 값에서 새 목표로, 같으면 그리기 정보만
      state.motion = (marks) => {
        if (!e.size) e.snap(marks);
        else if (!e.sameTargets(marks)) e.update(marks, changeAt);
        else e.refreshData(marks);
        e.step(frameAt);
      };
      sets.forEach((rows, n) => {
        changeAt = n * 10000;
        const target = still(view(rows));
        for (const dt of [0, 40, 160, 400, 900]) {
          frameAt = changeAt + dt;
          const h = r(view(rows));
          expect(h, `set ${n} +${dt}ms`).not.toMatch(/NaN|Infinity/);
          expect(shape(h), `set ${n} +${dt}ms`).toEqual(shape(target));
        }
        frameAt = changeAt + 5000;
        expect(r(view(rows)), `set ${n} settled`).toBe(target);
      });
    }
    // 등장: 조각마다 제 차례에 그려져요 (왼쪽 조각이 더 많이 그려져 있어요)
    const e = new MotionEngine<never>();
    e.configure("spring", 1100);
    state.engine = e as never;
    let frameAt = 0;
    state.motion = (marks) => {
      if (!e.size) {
        e.hold(marks);
        e.start(0);
      }
      e.step(frameAt);
    };
    const offsets = (h: string) => [...h.matchAll(/stroke-width="2.6"[^>]*pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="([-\d.e]+)"/g)].map((m) => +m[1]);
    for (const t of [80, 250, 450, 700]) {
      frameAt = t;
      const h = r(views[0](sets[2]));
      expect(h).not.toMatch(/NaN|Infinity/);
      const o = offsets(h);
      // a의 조각 셋 (혼자 남은 첫 점은 점으로만)
      expect(o, `${t}ms`).toHaveLength(3);
      for (let i = 0; i < o.length; i++) {
        expect(o[i]).toBeGreaterThanOrEqual(0);
        expect(o[i]).toBeLessThanOrEqual(1);
        if (i) expect(o[i]).toBeGreaterThanOrEqual(o[i - 1]);
      }
    }
    frameAt = 5000;
    expect(r(views[0](sets[2]))).toBe(still(views[0](sets[2])));
  });

  it("a broken line and its band break at the same x, the line stays inside the band, and the trend line is unchanged", () => {
    // A는 6, 7일에 값과 범위가 모두 비고, B는 10일에 행이 없어요
    const rows = DAYS.slice(0, 12).flatMap((day, i) => {
      const off = i === 5 || i === 6;
      return [{ day, s: "A", v: off ? null : 50 + (i % 4) * 3, lo: off ? null : 45 + (i % 4) * 3, hi: off ? null : 58 + (i % 4) * 3 }, ...(i === 9 ? [] : [{ day, s: "B", v: 30 + (i % 3), lo: 26 + (i % 3), hi: 33 + (i % 3) }])];
    });
    const draw = (extra: object) => r(<LineChart data={rows} x="day" y="v" series="s" lower="lo" upper="hi" curve="linear" annotations={[{ type: "trend" }]} width={480} animate={false} {...extra} />);
    const h = draw({});
    const lines = linePaths(h);
    const bands = bandPaths(h);
    expect(lines).toHaveLength(2);
    lines.forEach((line, s) => {
      const runs = subpaths(line.d);
      const bandRuns = subpaths(bands[s].d);
      expect(runs).toHaveLength(2);
      expect(bandRuns).toHaveLength(2);
      runs.forEach((q, i) => {
        const bx = bandRuns[i].map(([x]) => x);
        expect([Math.min(...bx), Math.max(...bx)]).toEqual([q[0][0], q[q.length - 1][0]]);
        for (const [x, yy] of q) {
          const ys = bandRuns[i].filter(([b]) => Math.abs(b - x) < 0.01).map(([, b]) => b);
          expect(yy).toBeGreaterThanOrEqual(Math.min(...ys));
          expect(yy).toBeLessThanOrEqual(Math.max(...ys));
        }
      });
    });
    // connectNulls면 선만 예전처럼 이어지고, 띠와 추세선은 같아요
    const joined = draw({ connectNulls: true });
    expect(linePaths(joined).map((l) => subpaths(l.d).length)).toEqual([1, 1]);
    expect(bandPaths(joined)).toEqual(bands);
    const trend = (html: string) => /<line [^>]*stroke-dasharray="6 4"[^>]*>/.exec(html)?.[0];
    expect(trend(h)).toBeDefined();
    expect(trend(h)).toBe(trend(joined));
  });

  it("tooltip, keyboard, live region, hidden table, description and events read missing values as before", () => {
    // 4일: Ours가 빠졌어요. 7일: Other가 혼자 남은 점이에요
    for (const k of [3, 6]) {
      const read = (extra: object) => {
        const h = atKey(k, () => r(<LineChart data={longGaps} x="day" y="v" series="app" width={480} animate={false} {...extra} />));
        return { tip: tipText(h), live: liveText(h), table: tds(h), desc: desc(h), events: frame().events.map((ev) => `${ev.label}: ${ev.formatted} (${ev.value})`) };
      };
      expect(read({}), `day ${k + 1}`).toEqual(read({ connectNulls: true }));
    }
  });
});

describe("툴팁 줄 수 한도", () => {
  // 계열 12개, 점 3개씩. 툴팁은 8줄까지 보여 주고, 빠진 계열 수를 마지막 줄에 알려요
  const names = Array.from({ length: 12 }, (_, s) => `S${s + 1}`);
  const rows = (k = 0) => ["a", "b", "c"].flatMap((x) => names.map((s, i) => ({ x, s, y: i + 1 + k })));
  const lastRows = () => (frame().tip?.rows ?? []).slice(-2);

  it("선 차트는 9번째 줄에 '외 N개'를 붙여요", () => {
    state.active = 1;
    r(<LineChart data={rows()} series="s" width={480} height={240} animate={false} />);
    expect(frame().tip?.rows).toHaveLength(9);
    expect(lastRows()[1]).toEqual({ label: "and 4 more", value: "" });
  });

  it("스트림도 같아요", () => {
    state.active = 1;
    r(<StreamGraph data={rows()} series="s" width={480} animate={false} />);
    expect(frame().tip?.rows).toHaveLength(9);
    expect(lastRows()[1]).toEqual({ label: "and 4 more", value: "" });
  });

  it("범프도 같아요", () => {
    state.active = 1;
    r(<BumpChart data={["a", "b", "c"].flatMap((x) => names.map((series, i) => ({ x, series, rank: i + 1 })))} series="series" width={480} animate={false} />);
    expect(frame().tip?.rows).toHaveLength(9);
    expect(lastRows()[1]).toEqual({ label: "and 4 more", value: "" });
  });

  it("8개 이하면 줄을 더하지 않아요", () => {
    state.active = 1;
    r(<LineChart data={["a", "b", "c"].flatMap((x) => names.slice(0, 8).map((s, i) => ({ x, s, y: i + 1 })))} series="s" width={480} height={240} animate={false} />);
    expect(frame().tip?.rows).toHaveLength(8);
    expect(frame().tip?.rows.some((row) => row.value === "")).toBe(false);
  });
});

describe("stacked area, stream: hover reads a real row, not a bucket average", () => {
  // 짝수 날 a 10 · b 7, 홀수 날 a 30 · b 3. 이틀을 평균하면 20 · 5라서 데이터에 없는 값이 보여요
  const daily = (n: number) => Array.from({ length: n }, (_, i) => ({ d: new Date(2025, 0, 1 + i), a: i % 2 ? 30 : 10, b: i % 2 ? 3 : 7 }));
  /** 가리킨 칸의 이벤트 key(날짜 ms)로 원래 행을 찾아요 */
  const rowOf = (data: ReturnType<typeof daily>, k: number) => data.find((d) => String(d.d.getTime()) === frame().events[k].key)!;
  const tipValues = () => frame().tip!.rows.map((t) => t.value);

  it("when a stacked area buckets, the tooltip and event show the representative row", () => {
    const data = daily(2000);
    state.active = 100;
    r(<AreaChart data={data} x="d" y={["a", "b"]} width={400} animate={false} />);
    expect(frame().events.length).toBeLessThan(2000);
    const e = frame().events[100];
    const row = rowOf(data, 100);
    expect(e.datum).toBe(row);
    expect(e.value).toBe(row.a);
    expect(e.formatted).toBe(`a ${row.a}, b ${row.b}`);
    expect(tipValues()).toEqual([String(row.a), String(row.b)]);
    // 100% 쌓기의 몫도 그 행의 값으로 나눠요
    r(<AreaChart data={data} x="d" y={["a", "b"]} stack="percent" width={400} animate={false} />);
    const t = row.a + row.b;
    expect(tipValues()).toEqual([`${Math.round((row.a / t) * 100)}% · ${row.a}`, `${Math.round((row.b / t) * 100)}% · ${row.b}`]);
  });

  it("a bucketed stream shows the representative row", () => {
    for (const n of [365, 2000]) {
      const data = daily(n);
      state.active = 100;
      r(<StreamGraph data={data} x="d" y={["a", "b"]} width={400} animate={false} />);
      expect(frame().events.length).toBeLessThan(n);
      const row = rowOf(data, 100);
      expect(frame().events[100].value).toBe(row.a + row.b);
      expect(tipValues()).toEqual([String(row.a), String(row.b)]);
    }
  });
});

describe("scatter", () => {
  /** 산점도를 정식 타입으로 올리기 전(0.4.1, d806a87)의 마크업. 기록한 스펙과 테마도 같이 들어 있어요 */
  const BEFORE: { name: string; spec: ChartSpec; theme: "dark" | "light"; server?: boolean; html: string }[] = JSON.parse(readFileSync(new URL("./fixtures/bubble-scatter-before.json", import.meta.url), "utf8"));
  /** 정수만 쓰는 고정 난수 (0 이상 1 미만) */
  const lcg = (seed: number) => {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  };
  const circles = (h: string) => [...h.matchAll(/<circle class="ztd-mark" cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)" fill="([^"]+)"/g)].map((m) => ({ x: +m[1], y: +m[2], r: +m[3], fill: m[4] }));

  it("a scatter spec with a size channel still draws as bubble, as it did when scatter was an alias", () => {
    const data = [{ x: 1, y: 2, s: 10 }, { x: 2, y: 3, s: 40 }, { x: 3, y: 1, s: 90 }];
    const spec = (type: string) => ({ type, data, encoding: { x: "x", y: "y", size: "s" } }) as ChartSpec;
    const scatter = r(<Chart spec={spec("scatter")} width={400} animate={false} />);
    expect(scatter).toBe(r(<Chart spec={spec("bubble")} width={400} animate={false} />));
    expect(new Set(circles(scatter).map((c) => c.r)).size).toBe(3);
    expect(renderSpecToSVG(spec("scatter"), { width: 400 })).toBe(renderSpecToSVG(spec("bubble"), { width: 400 }));
    const codes = validateSpec(spec("scatter")).warnings.map((w) => w.code);
    expect(codes).toContain("alias");
    expect(codes).not.toContain("unknown_channel");
  });

  it("existing bubble and scatter specs draw the same markup as 0.4.1 (bubble example, plain scatter, server SVG)", () => {
    expect(BEFORE.map((b) => b.name)).toEqual(expect.arrayContaining(["bubble example, dark", "bubble example, Korean", "scatter plain, dark", "scatter plain, server SVG", "scatter with bubble options", "bubble without size"]));
    for (const b of BEFORE) {
      const html = b.server
        ? renderSpecToSVG(b.spec, { width: 720, theme: b.theme, frame: false })
        : r(
            <ThemeProvider theme={b.theme}>
              <Chart spec={b.spec} width={640} animate={false} />
            </ThemeProvider>,
          );
      expect(html, b.name).toBe(b.html);
    }
  });

  it("an arrow key picks the nearest dot in that half-plane (1,000 random dots against brute force)", () => {
    const rnd = lcg(5);
    const pts = Array.from({ length: 1000 }, () => ({ x: rnd() * 640, y: rnd() * 320 }));
    const brute = (from: number, [ux, uy]: readonly [number, number]) => {
      let best: number | null = null;
      let bd = Infinity;
      pts.forEach((q, k) => {
        const dx = q.x - pts[from].x;
        const dy = q.y - pts[from].y;
        if (k === from || dx * ux + dy * uy <= 0 || Math.hypot(dx, dy) >= bd) return;
        bd = Math.hypot(dx, dy);
        best = k;
      });
      return best;
    };
    let edges = 0;
    for (let from = 0; from < pts.length; from++)
      for (const step of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const want = brute(from, step);
        if (want === null) edges++;
        expect(nearestInDirection(pts, from, step), `${from} ${step}`).toBe(want);
      }
    // 끝에 있는 점에서는 그 방향으로 갈 점이 없어요
    expect(edges).toBeGreaterThanOrEqual(4);
  });

  it("arrow keys follow screen directions, the first key goes to the highlighted dot, and bubble keeps data order", () => {
    // 가운데 점과 네 방향의 점. 화면 위(ArrowUp)는 y 값이 큰 쪽이에요
    const data = [
      { x: 5, y: 5, name: "center" },
      { x: 7, y: 5, name: "right" },
      { x: 9, y: 5, name: "far right" },
      { x: 5, y: 8, name: "up" },
      { x: 2, y: 5, name: "left" },
      { x: 5, y: 1, name: "down" },
    ];
    state.spy = true;
    state.active = 0;
    r(<ScatterChart data={data} label="name" width={480} height={300} animate={false} />);
    for (const key of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"]) expect(frame().onKey!(keyEvent(key)), key).toBe(true);
    expect(state.calls).toEqual([
      [1, "keyboard"],
      [4, "keyboard"],
      [3, "keyboard"],
      [5, "keyboard"],
    ]);
    // 첫 키: 강조 점으로. 강조가 없으면 키 반대쪽 끝(오른쪽 키면 가장 왼쪽 점)부터
    state.active = null;
    state.calls = [];
    r(<ScatterChart data={data} label="name" highlight="far right" width={480} height={300} animate={false} />);
    frame().onKey!(keyEvent("ArrowLeft"));
    r(<ScatterChart data={data} label="name" width={480} height={300} animate={false} />);
    frame().onKey!(keyEvent("ArrowRight"));
    expect(state.calls).toEqual([
      [2, "keyboard"],
      [4, "keyboard"],
    ]);
    // Home, End는 ChartFrame 몫이에요
    expect(frame().onKey!(keyEvent("Home"))).toBe(false);
    r(<BubbleChart data={data} label="name" width={480} animate={false} />);
    expect(frame().onKey).toBeUndefined();
  });

  it("hiding series C keeps series B's fill token, in the chart and in the card legend", () => {
    // C가 B보다 먼저 나와요. 남은 계열로 색을 다시 정하면 B가 C 자리(ink)로 올라가요
    const data = ["A", "C", "B"].flatMap((g, si) => [0, 1, 2, 3].map((k) => ({ g, x: k + si * 4, y: k * 2 + si })));
    state.active = 8;
    r(<ScatterChart data={data} series="g" width={480} animate={false} />);
    const all = frame().tip!.rows[0];
    expect(frame().events[8].series).toBe("B");
    // C를 숨기면 B의 첫 점은 4번이에요
    state.active = 4;
    r(<ScatterChart data={data} series="g" hidden={["C"]} width={480} animate={false} />);
    expect(frame().events).toHaveLength(8);
    expect(frame().tip!.rows[0]).toEqual(all);
    expect(all).toMatchObject({ label: "B", color: expect.stringContaining("--ztd-neutral-strong") });
    state.active = null;
    const h = r(<ScatterChart data={data} series="g" hidden={["C"]} width={480} animate={false} />);
    expect(new Set(circles(h).map((c) => c.fill))).toEqual(new Set([expect.stringContaining("--ztd-accent"), all.color]));
    const spec: ChartSpec = { type: "scatter", data, encoding: { x: "x", y: "y", series: "g" } };
    const tokens = (s: ChartSpec) => autoLegend(s, data, "en-US").map((l) => `${l.label}:${l.color}:${l.shape}`);
    expect(tokens(spec)).toEqual(["A:accent:circle", "C:ink:circle", "B:neutralStrong:circle"]);
    expect(tokens({ ...spec, options: { hidden: ["C"] } })).toEqual(["A:accent:circle", "B:neutralStrong:circle"]);
    // 판별 함수 강조도 범례와 점이 같은 계열을 강조해요
    const isB = (d: { g: string }) => d.g === "B";
    expect(tokens({ ...spec, options: { highlight: isB } })).toEqual(["A:ink:circle", "C:neutralStrong:circle", "B:accent:circle"]);
    state.active = 8;
    r(<ScatterChart data={data} series="g" highlight={isB} width={480} animate={false} />);
    expect(frame().tip!.rows[0].color).toContain("--ztd-accent");
  });

  it("jitter spreads dots that share an x value the same way on every render, without Math.random", () => {
    const data = Array.from({ length: 30 }, (_, i) => ({ x: i % 3, y: i }));
    const random = vi.spyOn(Math, "random");
    const plain = circles(r(<ScatterChart data={data} width={480} animate={false} />));
    const a = r(<ScatterChart data={data} jitter={{ amount: 0.4 }} width={480} animate={false} />);
    const again = r(<ScatterChart data={data} jitter={{ amount: 0.4 }} width={480} animate={false} />);
    const otherSeed = r(<ScatterChart data={data} jitter={{ amount: 0.4, seed: 2 }} width={480} animate={false} />);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
    expect(again).toBe(a);
    expect(otherSeed).not.toBe(a);
    expect(new Set(plain.map((c) => c.x)).size).toBe(3);
    // 점은 데이터 순서로 그려요. 세 줄이 퍼지되 옆 줄과 섞이지 않아요 (간격의 ±40%)
    const cols = [0, 1, 2].map((k) => circles(a).filter((_, i) => i % 3 === k).map((c) => c.x));
    for (const col of cols) expect(new Set(col).size).toBe(10);
    expect(Math.max(...cols[0])).toBeLessThan(Math.min(...cols[1]));
    expect(Math.max(...cols[1])).toBeLessThan(Math.min(...cols[2]));
  });

  it("fit draws a least-squares trend line, and the tooltip shows its slope and R²", () => {
    const data = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 2 * i + 1 }));
    expect(r(<ScatterChart data={data} width={480} animate={false} />)).not.toContain('stroke-dasharray="6 4"');
    state.active = 3;
    const h = r(<ScatterChart data={data} fit="linear" width={480} animate={false} />);
    expect(textOf(h, "Trend")).toHaveLength(1);
    expect(frame().tip!.rows.slice(-2)).toEqual([
      { label: "Trend slope", value: "+2", strong: false },
      { label: "R²", value: "1.00", strong: false },
    ]);
    // y = 2x + 1이라 선이 첫 점과 마지막 점을 지나요
    const [x1, y1, x2, y2] = /<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"[^>]*stroke-dasharray="6 4"/.exec(h)!.slice(1).map(Number);
    const dots = circles(h);
    expect([x1, y1, x2, y2]).toEqual([dots[0].x, dots[0].y, dots[9].x, dots[9].y].map((v) => expect.closeTo(v, 6)));
    // 사분면 이름과 함께여도 추세선 이름표가 이름을 덮지 않아요 (오른쪽 위 이름이 그 자리에 있어요)
    const names = ["Slow and cheap", "Slow and costly", "Fast and cheap", "Fast and costly"];
    const both = r(<ScatterChart data={data} fit="linear" refLines={{ x: 4, y: 8 }} quadrants={names} width={480} animate={false} />);
    // 이름표 글자는 늘 왼쪽 정렬이라 글자 상자는 x부터 글자 폭까지예요
    const box = (t: T) => ({ x: t.x, y: t.y - 8, w: textWidth(t.text, t.size, 500), h: 16 });
    const trend = box(textOf(both, "Trend")[0]);
    for (const q of names.map((s) => box(textOf(both, s)[0]))) expect(trend.x + trend.w <= q.x || q.x + q.w <= trend.x || trend.y + trend.h <= q.y || q.y + q.h <= trend.y).toBe(true);
  });

  it("refLines draw an x and a y line under the dots, stretch the axes to reach them, and name the four quadrants", () => {
    const H = 300;
    const data = Array.from({ length: 12 }, (_, i) => ({ x: i, y: i * 3 }));
    const names = ["Slow and cheap", "Slow and costly", "Fast and cheap", "Fast and costly"];
    const refLines = (h: string) => [...h.matchAll(/<line x1="([-\d.]+)" x2="([-\d.]+)" y1="([-\d.]+)" y2="([-\d.]+)" stroke="[^"]+" stroke-dasharray="3 3"/g)].map((m) => m.slice(1).map(Number));
    const h = r(<ScatterChart data={data} refLines={{ x: 5, y: 15 }} quadrants={names} width={480} height={H} animate={false} />);
    const [[vx, vx2], [, , hy, hy2]] = refLines(h);
    expect([vx, hy]).toEqual([vx2, hy2]);
    expect(h.indexOf('stroke-dasharray="3 3"')).toBeLessThan(h.indexOf('class="ztd-mark"'));
    const [tl, tr, bl, br] = names.map((s) => textOf(h, s)[0]);
    expect([tl.x < vx, tr.x > vx, bl.x < vx, br.x > vx, tl.y < hy, tr.y < hy, bl.y > hy, br.y > hy]).toEqual(Array(8).fill(true));
    // 선 위의 점은 오른쪽, 위쪽 칸으로 세요
    expect(desc(h)).toContain(" Reference lines at x 5 and y 15. Quadrants: Slow and cheap 0; Slow and costly 7; Fast and cheap 5; Fast and costly 0.");
    // y 60은 데이터(최대 33)보다 위라서 축이 거기까지 늘어나요. 위 두 칸은 이름이 들어갈 높이가 없어 빼요
    const far = r(<ScatterChart data={data} refLines={{ x: 5, y: 60 }} quadrants={names} width={480} height={H} animate={false} />);
    const [, [, , fy]] = refLines(far);
    expect(fy).toBeGreaterThanOrEqual(10);
    expect(fy).toBeLessThan(Math.min(...circles(far).map((c) => c.y)));
    expect([names[0], names[1]].map((s) => textOf(far, s).length)).toEqual([0, 0]);
  });

  it("the description counts dots per series and says which way y goes with x, in English and Korean", () => {
    const data = ["A", "B", "C"].flatMap((g, si) => [0, 1, 2, 3].map((k) => ({ g, x: k + si * 4, y: (k % 2 ? 7 : 0) + si * 6 })));
    // 피어슨 상관계수의 제곱으로 따로 계산해요
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const [mx, my] = [mean(data.map((d) => d.x)), mean(data.map((d) => d.y))];
    const cov = (f: (d: (typeof data)[number]) => number, g: (d: (typeof data)[number]) => number) => data.reduce((a, d) => a + f(d) * g(d), 0);
    const r2 = (cov((d) => d.x - mx, (d) => d.y - my) ** 2 / (cov((d) => d.x - mx, (d) => d.x - mx) * cov((d) => d.y - my, (d) => d.y - my))).toFixed(2);
    expect(Number(r2)).toBeGreaterThan(0.1);
    expect(Number(r2)).toBeLessThan(0.99);
    expect(desc(r(<ScatterChart data={data} series="g" xLabel="Cost" yLabel="Latency" width={480} animate={false} />))).toMatch(new RegExp(` 3 series: A 4 points, B 4 points, C 4 points\\. Latency rises as Cost rises, R² ${r2}\\.$`));
    expect(desc(r(<ScatterChart data={data} series="g" xLabel="비용" yLabel="응답 시간" locale="ko-KR" width={480} animate={false} />))).toMatch(new RegExp(` 계열 3개: A 4개, B 4개, C 4개\\. 비용 값이 클수록 응답 시간 값도 커요\\(R² ${r2}\\)\\.$`));
    expect(desc(r(<ScatterChart data={data.map((d) => ({ ...d, y: -d.y }))} series="g" width={480} animate={false} />))).toContain(` y falls as x rises, R² ${r2}.`);
    const zigzag = [1, -1, 1, -1, 1, -1].map((y, x) => ({ x, y }));
    expect(desc(r(<ScatterChart data={zigzag} fit="linear" width={480} animate={false} />))).toContain(" No clear straight-line relationship between x and y, R² 0.09.");
  });

  it("4 or fewer series get their names beside the dots without covering any, 5 or more leave it to the legend", () => {
    const make = (k: number) => Array.from({ length: k }, (_, si) => `S${si}`).flatMap((g, si) => [0, 1, 2, 3, 4].map((j) => ({ g, x: si * 10 + j, y: si * 6 + j * 2 })));
    const three = r(<ScatterChart data={make(3)} series="g" width={640} height={320} animate={false} />);
    const dots = circles(three);
    for (const s of ["S0", "S1", "S2"]) {
      const t = textOf(three, s);
      expect(t, s).toHaveLength(1);
      // 글자 상자와 점이 겹치지 않아요
      const w = textWidth(s, t[0].size, s === "S0" ? 700 : 600);
      for (const d of dots) {
        const nx = Math.max(t[0].x, Math.min(d.x, t[0].x + w));
        const ny = Math.max(t[0].y - 7, Math.min(d.y, t[0].y + 7));
        expect(Math.hypot(d.x - nx, d.y - ny), s).toBeGreaterThan(d.r);
      }
    }
    // 이름표는 실제 점 바로 옆에 붙고, 데이터가 아닌 색 점은 그리지 않아요
    expect((three.match(/<circle /g) ?? []).length).toBe(dots.length);
    for (const s of ["S0", "S1", "S2"]) {
      const t = textOf(three, s)[0];
      const w = textWidth(s, t.size, s === "S0" ? 700 : 600);
      const gap = Math.min(...dots.map((d) => Math.hypot(d.x - Math.max(t.x, Math.min(d.x, t.x + w)), d.y - Math.max(t.y - 7, Math.min(d.y, t.y + 7))) - d.r));
      expect(gap, s).toBeLessThanOrEqual(6);
    }
    const five = r(<ScatterChart data={make(5)} series="g" width={640} height={320} animate={false} />);
    for (const s of ["S0", "S1", "S2", "S3", "S4"]) expect(textOf(five, s), s).toHaveLength(0);
  });
});

describe("스펙 툴팁 틀이 차트에 함수로 가요 (차례 3 ⑩)", () => {
  const data = [{ m: "1월", v: 300, owner: "민지" }, { m: "2월", v: 340, owner: "" }];
  const spec = (tooltip: unknown): ChartSpec => ({ type: "line", data, encoding: { x: "m", y: "v" }, options: { tooltip } as never });
  it("template이면 그 틀로 쓰는 함수, false면 그대로 false", () => {
    r(<Chart spec={spec({ template: "{label} · 담당 {owner}" })} width={480} animate={false} />);
    const tip = frame().renderTip as (e: unknown) => ReactElement;
    expect(typeof tip).toBe("function");
    expect(r(<>{tip({ label: "1월", formatted: "300", datum: data[0] })}</>)).toBe("<div>1월 · 담당 민지</div>");
    r(<Chart spec={spec(false)} width={480} animate={false} />);
    expect(frame().renderTip).toBe(false);
  });
});

describe("막대와 선 (차례 3 ⑪)", () => {
  const months = Array.from({ length: 12 }, (_, i) => ({ m: `${i + 1}월`, 올해: 100 + i * 4, 작년: 70 + i * 5 }));
  const dots = (h: string) => [...h.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="3" fill="([^"]+)"/g)].map((m) => ({ cx: +m[1], cy: +m[2], fill: m[3] }));
  const linePath = (h: string) => /<path d="([^"]+)" fill="none" stroke="var\(--ztd-accent[^"]*" stroke-width="2"/.exec(h)?.[1];
  const tableRows = (h: string) => [...h.matchAll(/<tr><th scope="row">([^<]*)<\/th><td>([^<]*)<\/td><\/tr>/g)].map((m) => [m[1], m[2]]);
  const bar = (data: Record<string, unknown>[], extra: Record<string, unknown> = {}) => r(<BarChart data={data} x="m" y="올해" line="작년" width={600} animate={false} {...extra} />);

  it("선 하나는 막대 칸 가운데를 지나는 강조색 선과 점이고, 막대는 회색이에요", () => {
    const h = bar(months);
    expect(linePath(h)).toBeDefined();
    const centers = [...h.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="[\d.]+" fill="transparent"/g)].map((m) => +m[1] + +m[2] / 2);
    const pts = dots(h);
    expect(pts).toHaveLength(12);
    pts.forEach((p, i) => expect(Math.abs(p.cx - centers[i]), `${i}`).toBeLessThan(0.1));
    expect(h).not.toMatch(/fill="var\(--ztd-accent[^"]*" stroke="none"/);
    expect(r(<BarChart data={months} x="m" y="올해" width={600} animate={false} />)).not.toBe(h);
  });
  it("선 값으로 축 범위를 넓혀 점이 잘리지 않아요", () => {
    const h = r(<BarChart data={[{ m: "A", 올해: 100, 작년: 200 }, { m: "B", 올해: 150, 작년: 120 }]} x="m" y="올해" line="작년" width={500} height={300} animate={false} />);
    expect(h).toMatch(/>200<\/text>/);
    expect(Math.min(...dots(h).map((p) => p.cy))).toBeGreaterThanOrEqual(8);
  });
  it("빈 값에서 선이 끊기고, 혼자 남은 점은 점만 그려요", () => {
    const gap = (idx: number[]) => months.map((d, i) => (idx.includes(i) ? { ...d, 작년: null } : d));
    const h = bar(gap([3, 4, 9]));
    expect(linePath(h)!.match(/M/g)).toHaveLength(3);
    expect(dots(h)).toHaveLength(9);
    const lone = bar(gap([3, 4, 9, 10]));
    expect(linePath(lone)!.match(/M/g)).toHaveLength(2);
    expect(dots(lone)).toHaveLength(8);
  });
  it("키보드는 막대를 모두 지난 뒤 선을 지나요 (숨은 표도 막대 다음 선)", () => {
    const rows = tableRows(bar(months));
    expect(rows).toHaveLength(24);
    expect(rows[12]).toEqual(["1월 · 작년", "70"]);
  });
  it("가로 막대와 100% 막대에는 그리지 않고 알려요", () => {
    for (const extra of [{ orientation: "horizontal" }, { layout: "percent" }]) {
      expect(linePath(bar(months, extra)), JSON.stringify(extra)).toBeUndefined();
      expect(validateSpec({ type: "bar", data: months, encoding: { x: "m", y: "올해", line: "작년" }, options: extra }).warnings.map((w) => w.code), JSON.stringify(extra)).toContain("line_ignored");
    }
  });
  it("긴 표에서는 같은 x의 선 값을 평균해요 (계열마다 되풀이한 목표가 두 배가 되지 않아요)", () => {
    const long = ["1월", "2월"].flatMap((m) => ["A", "B"].map((team) => ({ m, team, v: 40, goal: 95 })));
    const rows = tableRows(r(<BarChart data={long} x="m" y="v" series="team" line="goal" width={500} height={300} animate={false} />));
    expect(rows.filter(([l]) => l.endsWith("· goal")).map(([, v]) => v)).toEqual(["95", "95"]);
  });
  it("카드 범례는 막대(회색)와 선(강조색 선 모양)을 함께 적어요", () => {
    const spec: ChartSpec = { type: "bar", data: months, encoding: { x: "m", y: "올해", line: "작년" }, card: { title: "T", legend: "auto" } };
    expect(autoLegend(spec, months, "ko-KR")).toEqual([
      { label: "올해", color: "neutral" },
      { label: "작년", color: "accent", shape: "line" },
    ]);
    const svg = renderSpecToSVG(spec, { width: 560 });
    for (const s of [">올해<", ">작년<"]) expect(svg).toContain(s);
    expect(svg).toMatch(/<line [^>]*stroke-width="2"/);
  });
  it("빈 선 목록(line: [])은 선이 없는 것과 같아요 (막대 색, 설명, 경고)", () => {
    expect(bar(months, { line: [] })).toBe(r(<BarChart data={months} x="m" y="올해" width={600} animate={false} />));
    expect(validateSpec({ type: "bar", data: months, encoding: { x: "m", y: "올해", line: [] }, options: { orientation: "horizontal" } }).warnings.map((w) => w.code)).not.toContain("line_ignored");
  });
});

describe("로그 y축 (차례 4 ⑯)", () => {
  const growth = Array.from({ length: 24 }, (_, i) => ({ m: `M${i + 1}`, users: Math.round(120 * 1.62 ** i) }));
  const edge = [10, 100, 0, 1000, -50, 1e6, 0.001].map((y, i) => ({ x: i + 1, y }));
  const yTicks = (h: string) => texts(h).filter((t) => t.anchor === "end").map((t) => t.text);
  const dots = (h: string) => (h.match(/<circle /g) ?? []).length;
  it("1,000배 넘게 퍼진 값도 읽혀요: 10배마다 같은 간격의 눈금과 고르게 오르는 선", () => {
    const h = r(<LineChart data={growth} x="m" y="users" yScale="log" width={560} animate={false} />);
    expect(yTicks(h)).toEqual(["100", "1K", "10K", "100K", "1M", "10M"]);
    const pts = pairs(/<path d="(M[^"]+)" fill="none"/.exec(h)![1]);
    const ys = pts.filter((_, i) => i % 3 === 0).map((pt) => pt[1]);
    expect(ys).toHaveLength(24);
    const steps = ys.slice(1).map((v, i) => v - ys[i]);
    for (const s of steps) expect(Math.abs(s - steps[0])).toBeLessThan(0.6);
    const svg = renderSpecToSVG({ type: "line", data: growth, encoding: { x: "m", y: "users" }, options: { yScale: "log" } }, { width: 560, frame: false });
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).toContain(">10M<");
  });
  it("산점도·버블은 y가 0 이하인 점만 빼고, 그 수를 설명에 적어요", () => {
    const h = r(<ScatterChart data={edge} x="x" y="y" yScale="log" width={480} height={320} animate={false} />);
    expect(dots(h)).toBe(5);
    expect(desc(h)).toContain("2 points with y at or below 0 are not shown on the log scale.");
    expect(yTicks(h)).toContain("0.001");
    expect(yTicks(h)).not.toContain("0");
    expect(h).not.toMatch(/NaN|Infinity/);
    expect(desc(r(<ScatterChart data={edge} x="x" y="y" yScale="log" locale="ko-KR" width={480} height={320} animate={false} />))).toContain("로그 눈금이라 y가 0 이하인 점 2개는 뺐어요.");
    expect(dots(r(<BubbleChart data={edge} x="x" y="y" size="x" yScale="log" width={480} height={320} animate={false} />))).toBe(5);
  });
  it("선은 0 이하 값에서 끊기고, 그 수를 설명에 적어요", () => {
    const h = r(<LineChart data={[5, 50, 0, 500, 5000].map((v, i) => ({ m: `p${i}`, v }))} x="m" y="v" yScale="log" curve="linear" width={480} animate={false} />);
    expect(/<path d="(M[^"]+)" fill="none"/.exec(h)![1].match(/M/g)).toHaveLength(2);
    expect(desc(h)).toContain("1 value at or below 0 is not shown on the log scale.");
    expect(h).not.toMatch(/NaN|Infinity/);
  });
  it("영역 차트는 yScale이 있어도 그림이 같아요 (0부터의 길이가 값)", () => {
    const data = growth.slice(0, 6);
    expect(r(<AreaChart data={data} x="m" y="users" {...({ yScale: "log" } as object)} width={480} animate={false} />)).toBe(r(<AreaChart data={data} x="m" y="users" width={480} animate={false} />));
  });
});

describe("숨긴 계열 (차례 4 ⑫)", () => {
  const CH = ["Search", "Social", "Ads", "Referral", "Direct"];
  const five = ["Jan", "Feb", "Mar", "Apr"].flatMap((m, k) => CH.map((ch, s) => ({ m, ch, v: 40 + s * 10 + k * 3 })));
  const strokes = (h: string) => [...h.matchAll(/<path d="M[^"]*" fill="none" stroke="([^"]+)"/g)].map((m) => m[1]);
  const line = (extra: Record<string, unknown> = {}) => r(<LineChart data={five} x="m" y="v" series="ch" width={560} animate={false} {...extra} />);
  const bar = (extra: Record<string, unknown> = {}) => r(<BarChart data={five} x="m" y="v" series="ch" width={560} animate={false} {...extra} />);
  const barFills = (h: string) => markGroups(h).map((g) => /<path d="[^"]+" fill="([^"]+)"/.exec(g)![1]);
  const yTicks = (h: string) => texts(h).filter((t) => t.anchor === "end").map((t) => t.text);

  it("숨겨도 남은 계열의 색이 그대로예요 (강조 계열을 숨기면 강조색이 없어요)", () => {
    const full = strokes(line({ colorMode: "categorical" }));
    expect(full).toHaveLength(5);
    const accent = full.find((s) => s.includes("--ztd-accent"));
    expect(accent).toBeDefined();
    expect(strokes(line({ colorMode: "categorical", hidden: ["Search"] }))).toEqual(full.filter((s) => s !== accent));
    const plain = strokes(line({ hidden: ["Search"] }));
    expect(plain).toHaveLength(4);
    expect(plain.some((s) => s.includes("--ztd-accent"))).toBe(false);
    const fills = barFills(bar());
    expect(new Set(barFills(bar({ hidden: ["Social"] })))).toEqual(new Set(fills.filter((f) => f !== fills[1])));
  });
  it("y축은 보이는 계열에 다시 맞추고, yDomain을 주면 그대로예요", () => {
    const data = ["a", "b", "c"].flatMap((m, k) => [{ m, s: "big", v: 1000 + k * 250 }, { m, s: "small", v: 10 + k * 2.5 }]);
    const draw = (extra: Record<string, unknown> = {}) => r(<LineChart data={data} x="m" y="v" series="s" width={480} height={240} animate={false} {...extra} />);
    const top = (h: string) => Math.max(...yTicks(h).map((t) => Number(t.replace(/,/g, ""))));
    expect(top(draw())).toBeGreaterThan(1000);
    expect(top(draw({ hidden: ["big"] }))).toBeLessThan(100);
    expect(yTicks(draw({ yDomain: [0, 2000], hidden: ["big"] }))).toEqual(yTicks(draw({ yDomain: [0, 2000] })));
  });
  it("자동 범례는 숨긴 계열을 빼고, 켜고 끄는 범례(all)는 모두 적어요", () => {
    for (const type of ["line", "area", "bar"]) {
      const spec = { type, data: five, encoding: { x: "m", y: "v", series: "ch" }, options: { hidden: ["Ads"] } } as ChartSpec;
      expect(autoLegend(spec, five, "en-US").map((i) => i.label), type).toEqual(["Search", "Social", "Referral", "Direct"]);
      expect(autoLegend(spec, five, "en-US", true).map((i) => i.label), type).toEqual(CH);
    }
  });
  it("모든 계열을 숨기면 선과 영역도 막대, 산점도처럼 빈 차트예요", () => {
    for (const h of [line({ hidden: CH }), r(<AreaChart data={five} x="m" y="v" series="ch" hidden={CH} width={560} animate={false} />)]) {
      expect(desc(h)).toBe("No data.");
      expect(tds(h)).toEqual([]);
    }
  });
});
