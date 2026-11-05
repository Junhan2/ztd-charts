import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BarChart } from "../src/charts/bar";
import { BoxPlot } from "../src/charts/box";
import { BubbleChart } from "../src/charts/bubble";
import { BulletChart } from "../src/charts/bullet";
import { BumpChart } from "../src/charts/bump";
import { CalendarHeatmap } from "../src/charts/calendar";
import { CandlestickChart } from "../src/charts/candlestick";
import { DumbbellChart } from "../src/charts/dumbbell";
import { Heatmap } from "../src/charts/heatmap";
import { AreaChart, LineChart } from "../src/charts/line";
import { LollipopChart } from "../src/charts/lollipop";
import { ParetoChart } from "../src/charts/pareto";
import { RidgelineChart } from "../src/charts/ridgeline";
import { Sparkline } from "../src/charts/sparkline";
import { StreamGraph } from "../src/charts/stream";
import { WaterfallChart } from "../src/charts/waterfall";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { MotionEngine } from "../src/core/motion";
import { textWidth } from "../src/core/text";

/**
 * SSR은 렌더마다 엔진을 새로 만들어 m.items가 늘 데이터 순서예요. 브라우저에서는 엔진이 남아서
 * 데이터가 바뀌어도 m.items가 처음 생긴 순서를 지켜요. engine을 주면 렌더 사이에 엔진을 이어 써서 그 상황을 재현해요.
 * active를 주면 호버/키보드로 고른 항목을, spy를 켜면 setActive 호출을 기록해요. frame은 마지막 ChartFrame props
 */
const state = vi.hoisted(() => ({
  engine: null as null | { snap: (m: never[]) => void; items: () => unknown[]; get: (k: string) => number[] | undefined },
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
      e.snap(marks);
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
