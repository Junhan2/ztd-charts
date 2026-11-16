import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { depthRange, rowAfterKey, SkylineChart, skylineLayout, type SkylineChartProps, type SkylineView } from "../src/charts/skyline";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { skylineSample } from "../src/spec/samples";
import { validateSpec } from "../src/spec/validate";

/**
 * The completion criteria of the plan (next-charts SPEC 4.14) that can be checked without a browser.
 * The harness is the same as cartesian-fixes.test.tsx: state.active for the picked period, spy for setActive calls, frame() for the last ChartFrame props
 */
const state = vi.hoisted(() => ({
  active: null as number | null,
  via: "pointer" as "pointer" | "keyboard" | "touch",
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

const frame = () => state.frame as ChartFrameProps<unknown>;
const keyEvent = (key: string) => ({ key, preventDefault() {} }) as never;
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
const VIEWS: SkylineView[] = ["high", "low"];
/** [min, max] depth per view */
const depths = (view: SkylineView) => depthRange(view).slice(0, 2);
const BACK = ["Input", "Cached", "Output", "Reasoning"];
const FRONT = ["Failed", "Retried"];

type Data = Record<string, string | number>[];
const sky = (data: Data, props: Partial<SkylineChartProps<Record<string, string | number>>> = {}) =>
  renderToStaticMarkup(<SkylineChart data={data} x="day" y={BACK} front={FRONT} format="compact" width={760} height={420} animate={false} {...props} />);
const r = (el: ReactElement) => renderToStaticMarkup(el);
const days = (n: number, row: (i: number) => Record<string, number>): Data => Array.from({ length: n }, (_, i) => ({ day: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), ...row(i) }));
/** Two weeks: the example data (7 days) with the week just before it prepended. The numbers match the old 14-day example, so front row segments under 1.5px and the merging of neighboring periods at narrow widths are still covered */
const twoWeeks: Data = [
  { day: "2026-10-23", Input: 410000, Cached: 317223, Output: 186999, Reasoning: 79534, Failed: 11000, Retried: 10000 },
  { day: "2026-10-24", Input: 446030, Cached: 337921, Output: 202044, Reasoning: 87942, Failed: 15314, Retried: 9190 },
  { day: "2026-10-25", Input: 440886, Cached: 336150, Output: 202507, Reasoning: 87489, Failed: 15398, Retried: 6051 },
  { day: "2026-10-26", Input: 472300, Cached: 370227, Output: 221753, Reasoning: 92899, Failed: 13276, Retried: 4626 },
  { day: "2026-10-27", Input: 456358, Cached: 366468, Output: 216506, Reasoning: 88261, Failed: 9041, Retried: 5714 },
  { day: "2026-10-28", Input: 482495, Cached: 386711, Output: 226337, Reasoning: 92466, Failed: 8633, Retried: 9460 },
  { day: "2026-10-29", Input: 519595, Cached: 405554, Output: 238274, Reasoning: 100345, Failed: 12610, Retried: 12608 },
  ...skylineSample,
];

/** Markup chunk per period (class="ztd-mark" group) */
const periods = (h: string) => h.split('<g class="ztd-mark"').slice(1);
const xy = (points: string) => points.split(" ").map((p) => p.split(",").map(Number) as [number, number]);
/** Back row top: the face with a 55% neutralStrong outline. Point order: front left, front right, back right, back left */
const backLid = (g: string) => {
  const m = /<polygon points="([^"]+)" fill="([^"]+)" stroke="[^"]+" stroke-opacity="0.55" stroke-linejoin="round"><\/polygon>/.exec(g);
  return m ? { pts: xy(m[1]), fill: m[2] } : null;
};
/** Front row top: in low, a face blended into the floor color (neutralSoft) with no outline; in high, an unfilled 40% ink outline over faces split by each series' share (lidParts) */
const frontLid = (g: string) => {
  const m = /<polygon points="([^"]+)" fill="([^"]+)"(?: stroke="[^"]+" stroke-opacity="0.4")? stroke-linejoin="round"><\/polygon>/.exec(g);
  return m ? { pts: xy(m[1]), fill: m[2] } : null;
};
/** The spot of a block whose total is 0 in the high view: an unfilled dashed outline */
const emptyPad = (g: string) => /<polygon points="[^"]+" fill="none" stroke="[^"]+" stroke-opacity="0.7" stroke-dasharray="2 2"><\/polygon>/.test(g);
/** The hairline drawn in place of a block (y1 = y2; unlike the vertical gap lines, it has no opacity) */
const hairline = (g: string) => /<line x1="[\d.]+" x2="[\d.]+" y1="([\d.]+)" y2="\1" stroke="[^"]+"><\/line>/.test(g);

describe("skyline: shape (4.14)", () => {
  it("1: periods with the same total share the lid front edge y (even with sub-1px pieces mixed in, both viewpoints × 320·1200px × 7·40 periods × min·max depth)", () => {
    // Every period totals 1000; only the mix differs. Even periods stack in segments of 0.3 (under 1px)
    const data = (n: number) => days(n, (i) => (i % 2 ? { Input: 400, Cached: 300, Output: 200, Reasoning: 100 } : { Input: 999.4, Cached: 0.3, Output: 0.3, Reasoning: 0 }));
    for (const view of VIEWS)
      for (const width of [320, 1200])
        for (const n of [7, 40])
          for (const depth of depths(view)) {
            const groups = periods(sky(data(n).map((d) => ({ ...d, Failed: 10, Retried: 5 })), { width, depth, view }));
            // When periods are merged, the partial first group has a different total, so it is left out
            const full = n % Math.ceil(n / groups.length) === 0 || groups.length === n ? groups : groups.slice(1);
            const tops = full.map((g) => backLid(g)!.pts[0][1]);
            expect(Math.max(...tops) - Math.min(...tops), `${view} ${width}px ${n} periods depth ${depth}`).toBeLessThanOrEqual(0.5);
          }
  });

  it("2: the back row lid's back edge sits on the back-wall gridline for its value (both viewpoints × 390·1200px, 14 periods)", () => {
    // Periods totaling 500K, 1M and 1.5M: they line up with the ticks 0, 500K, 1M, 1.5M
    const totals = [500_000, 1_000_000, 1_500_000];
    const data = days(14, (i) => {
      const t = totals[i % 3];
      return { Input: t * 0.4, Cached: t * 0.3, Output: t * 0.2, Reasoning: t * 0.1, Failed: t * 0.01, Retried: t * 0.01 };
    });
    for (const view of VIEWS)
      for (const width of [390, 1200]) {
        const h = sky(data, { width, view });
        const grid = new Map([...h.matchAll(/<line x1="[\d.]+" x2="[\d.]+" y1="([\d.]+)" y2="\1" stroke="[^"]+"><\/line><text x="[\d.]+" y="[\d.]+"[^>]*>([^<]+)<\/text>/g)].map((m) => [m[2], +m[1]]));
        expect([...grid.keys()], `${view} ${width}px`).toEqual(["0", "500K", "1M", "1.5M"]);
        periods(h).forEach((g, i) => {
          const rear = backLid(g)!.pts[2][1];
          const label = ["500K", "1M", "1.5M"][i % 3];
          expect(Math.abs(rear - grid.get(label)!), `${view} ${width}px period ${i}`).toBeLessThanOrEqual(0.5);
        });
      }
  });

  it("3: back row sides do not enter the next slot, the front row face overlaps the same period's back row by over 50% and neighbouring periods by 0%, and the two rows' bases differ by over 1.5px (both viewpoints)", () => {
    for (const view of VIEWS)
      for (const width of [320, 390, 768, 1200])
        for (const n of [7, 14, 40])
          for (const depth of depths(view)) {
            const L = skylineLayout({ width, height: 400, back: [Array(n).fill(10)], front: [Array(n).fill(1)], n, depth, view, wall: true, legendH: 24, below: 52, tickFmt: () => (v) => String(v) });
            const at = `${view} ${width}px ${n} periods depth ${depth}`;
            expect(L.s, at).toBeGreaterThanOrEqual(20);
            expect(L.shown, at).toBeLessThanOrEqual(40);
            for (let i = 0; i < L.shown; i++) {
              const front: [number, number] = [L.slotX(i), L.slotX(i) + L.w];
              const back = (k: number): [number, number] => [L.slotX(k) + L.shift[0], L.slotX(k) + L.shift[0] + L.w];
              const overlap = (a: [number, number], b: [number, number]) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0])) / L.w;
              if (i < L.shown - 1) expect(back(i)[1] + L.depthBack * L.cx, at).toBeLessThan(L.slotX(i + 1));
              expect(overlap(front, back(i)), at).toBeGreaterThanOrEqual(0.5);
              if (i > 0) expect(overlap(front, back(i - 1)), at).toBe(0);
            }
            expect(L.shift[1], at).toBeGreaterThanOrEqual(1.5);
          }
  });

  it("3b: at the high viewpoint front row lids are tiles over 0.3x the slot width, and over 2px of floor shows between the front lid's back edge and the back row base (low is under 0.07x)", () => {
    for (const width of [320, 390, 768, 1200])
      for (const n of [7, 14, 40]) {
        const input = { width, height: 400, back: [Array(n).fill(10)], front: [Array(n).fill(1)], n, wall: true, legendH: 24, below: 52, tickFmt: () => (v: number) => String(v) };
        const hi = skylineLayout({ ...input, view: "high" });
        const lo = skylineLayout({ ...input, view: "low" });
        const at = `${width}px ${n} periods`;
        expect(hi.depthFront * hi.cy, at).toBeGreaterThan(0.3 * hi.s);
        expect(lo.depthFront * lo.cy, at).toBeLessThan(0.07 * lo.s);
        // Vertical distance between the back edge of the front row top (at floor level) and the back row's floor
        expect(hi.shift[1] - hi.depthFront * hi.cy, at).toBeGreaterThan(2);
      }
  });

  it("3c: in short charts high depth is at most 40% of the vertical space and tick labels are at least 14px apart (both viewpoints, heights 150·200). Normal sizes keep their depth", () => {
    const input = (width: number, height: number, view: SkylineView) => ({ width, height, back: [Array(14).fill(10)], front: [Array(14).fill(1)], n: 14, view, wall: true, legendH: 40, below: 52, tickFmt: () => (v: number) => String(v) });
    for (const view of VIEWS)
      for (const width of [260, 390])
        for (const height of [150, 200]) {
          const L = skylineLayout(input(width, height, view));
          const at = `${view} ${width}px ${height}px`;
          if (view === "high") expect(L.floor - L.wallBase, at).toBeLessThanOrEqual(0.4 * (L.floor - L.top) + 1e-9);
          expect(L.ticks[0], at).toBe(0);
          L.ticks.slice(1).forEach((t, i) => expect((t - L.ticks[i]) * L.k, at).toBeGreaterThanOrEqual(14));
        }
    // Control: at 520px and height 400 the depth is not reduced and no ticks are skipped, so the ticks match low
    const L = skylineLayout(input(520, 400, "high"));
    expect(L.depthBack / L.s).toBeCloseTo(0.42, 6);
    expect(L.ticks.length).toBeGreaterThanOrEqual(3);
    expect(L.ticks).toEqual(skylineLayout(input(520, 400, "low")).ticks);
  });

  it("4: front row height order matches front row total order (both viewpoints, 760px, 2-week data with sub-1.5px pieces)", () => {
    for (const view of VIEWS) {
      const h = sky(twoWeeks, { width: 760, view });
      const groups = periods(h);
      expect(groups).toHaveLength(14);
      // Whether front row segments under 1.5px are really drawn (inflating them would flip the order)
      const thin = groups.flatMap((g) => [...g.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="([\d.]+)" fill="var\(--ztd-(?:neutral|ink|accent2|accent3)/g)].map((m) => +m[1])).filter((v) => v > 0 && v < 1.5);
      expect(thin.length, view).toBeGreaterThan(0);
      const heights = groups.map((g) => -frontLid(g)!.pts[0][1]);
      const totals = twoWeeks.map((d) => Number(d.Failed) + Number(d.Retried));
      const order = (xs: number[]) => xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
      expect(order(heights), view).toEqual(order(totals));
    }
  });

  it("5: low draws a thin line when a nonzero total is under 1px, and nothing at 0. high draws a lid tile even under 1px, and a dashed empty slot at 0 (390px, 14 periods)", () => {
    const data = days(14, (i) => ({ Input: 600, Cached: 300, Output: 80, Reasoning: 20, Failed: i === 3 ? 0.001 : i === 5 ? 0 : 40, Retried: 0 }));
    const low = periods(sky(data, { width: 390, view: "low" }));
    expect(hairline(low[3])).toBe(true);
    expect(frontLid(low[3])).toBeNull();
    expect(hairline(low[5])).toBe(false);
    expect(frontLid(low[5])).toBeNull();
    // An ordinary period with just one back row top and one front row top
    expect(hairline(low[4])).toBe(false);
    expect(frontLid(low[4])).not.toBeNull();
    const high = periods(sky(data, { width: 390 }));
    expect(hairline(high[3])).toBe(false);
    expect(frontLid(high[3])).not.toBeNull();
    expect(emptyPad(high[3])).toBe(false);
    expect(frontLid(high[5])).toBeNull();
    expect(emptyPad(high[5])).toBe(true);
    expect(frontLid(high[4])).not.toBeNull();
    expect(emptyPad(high[4])).toBe(false);
  });

  it("6: back row lids use the same neutral color in every period, never a series color (with and without a front row)", () => {
    for (const front of [FRONT, undefined]) {
      const h = sky(skylineSample, { width: 390, front });
      const groups = periods(h);
      const fills = new Set(groups.map((g) => backLid(g)!.fill));
      expect(fills.size).toBe(1);
      const [lid] = fills;
      expect(lid).toContain("--ztd-panel");
      expect(lid).toContain("--ztd-neutral-soft");
      for (const token of ["accent", "neutral-strong", "ink"]) expect(lid).not.toContain(`--ztd-${token}`);
    }
  });

  it("6b: high front row lids split by series share from the left into accent2, accent3. Zero series drop out, and a front series highlight or low gives a neutral lid as in 0.9", () => {
    const data = days(4, (i) => ({ Input: 600, Cached: 300, Output: 80, Reasoning: 20, Failed: i === 3 ? 0 : 30, Retried: 10 }));
    /** accent2 and accent3 faces with a level top edge = top segments (side faces have a slanted top edge, so they are left out) */
    const parts = (g: string) =>
      [...g.matchAll(/<polygon points="([^"]+)" fill="(var\(--ztd-accent[23][^"]*)"><\/polygon>/g)].map((m) => ({ pts: xy(m[1]), fill: m[2] })).filter((q) => q.pts[0][1] === q.pts[1][1]);
    const width = (q: { pts: [number, number][] }) => q.pts[1][0] - q.pts[0][0];
    const high = periods(sky(data, { width: 520 }));
    for (const g of high.slice(0, 3)) {
      const [a, b, ...rest] = parts(g);
      expect(rest).toHaveLength(0);
      expect(a.fill).toContain("--ztd-accent2");
      expect(b.fill).toContain("--ztd-accent3");
      expect(width(a) / width(b)).toBeCloseTo(3, 0);
      expect(frontLid(g)!.fill).toBe("none");
    }
    const last = parts(high[3]);
    expect(last).toHaveLength(1);
    expect(last[0].fill).toContain("--ztd-accent3");
    for (const g of periods(sky(data, { width: 520, highlight: "Retried" }))) {
      expect(parts(g)).toHaveLength(0);
      expect(frontLid(g)!.fill).toContain("--ztd-neutral");
    }
    for (const g of periods(sky(data, { width: 520, view: "low" }))) expect(parts(g)).toHaveLength(0);
  });
});

describe("skyline: reading and keyboard (4.14)", () => {
  it("7: tooltip rows, the live region sentence and the hidden table read series in the same order (top→bottom)", () => {
    state.active = 8;
    state.via = "keyboard";
    sky(twoWeeks, { width: 390 });
    const f = frame();
    const rows = f.tip!.rows.map((row) => row.label ?? "");
    // Back row top to bottom, back row total, front row top to bottom, front row total, ratio
    expect(rows).toEqual(["Reasoning", "Output", "Cached", "Input", "Back total", "Retried", "Failed", "Front total", "Front ÷ back"]);
    /** Whether the names appear in this order in the text */
    const inOrder = (text: string, names: string[]) => names.map((n) => text.indexOf(`${n} `)).every((at, i, all) => at >= 0 && (i === 0 || at > all[i - 1]));
    const tipBack = rows.slice(0, 4);
    const tipFront = rows.slice(5, 7);
    expect(f.announce).toMatch(/^10\/31 back: Reasoning /);
    expect(inOrder(f.announce!, tipBack)).toBe(true);
    // The hidden table text has the back row, then the front row, both in the same order as the tooltip
    expect(inOrder(f.events[8].formatted!, ["back", ...tipBack, "front", ...tipFront])).toBe(true);
  });

  it("8: the auto description has both rows' peak periods and ratio, and the merged unit when merged (320px, 14·40 periods, with and without a front row)", () => {
    const desc = () => frame().description;
    sky(twoWeeks, { width: 760 });
    expect(desc()).toContain("Peak period 11/5 at 1.5M");
    expect(desc()).toContain("Front row (Failed, Retried) peaks at 10/31 with 216K, 16.4% of the back row");
    expect(desc()).not.toContain("summed");
    sky(twoWeeks, { width: 320 });
    expect(desc()).toContain("Peak period 11/4–11/5");
    expect(desc()).toContain("Front row (Failed, Retried) peaks at 10/31–11/1");
    expect(desc()).toContain("Neighboring periods are summed in groups of 2");
    sky(twoWeeks, { width: 320, front: undefined });
    expect(desc()).not.toContain("Front row");
    const forty = days(40, (i) => ({ Input: 100 + i, Cached: 50, Output: 30, Reasoning: 10, Failed: i === 20 ? 40 : 2, Retried: 1 }));
    sky(forty, { width: 320 });
    expect(desc()).toMatch(/summed in groups of \d/);
    sky(twoWeeks, { width: 320, locale: "ko-KR" });
    expect(desc()).toContain("앞줄(Failed, Retried)이 가장 많은 기간");
    expect(desc()).toContain("이웃 기간을 2개씩 합쳤어요");
  });

  it("9: ←/→/Home/End move only the period and keep the row, ↑/↓ move to the other row in the same period, and without a front row ↑/↓ move the period too. The hidden table is not cut at 40 periods", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End", "Escape", "Enter"]) expect(rowAfterKey(key, true), key).toBeNull();
    expect(rowAfterKey("ArrowDown", true)).toBe("front");
    expect(rowAfterKey("ArrowUp", true)).toBe("back");
    expect(rowAfterKey("ArrowDown", false)).toBeNull();
    // With a front row, the chart takes ↑/↓ and the period stays the same
    state.active = 4;
    state.via = "keyboard";
    state.spy = true;
    sky(skylineSample, { width: 390 });
    expect(frame().onKey!(keyEvent("ArrowDown"))).toBe(true);
    expect(frame().onKey!(keyEvent("ArrowUp"))).toBe(true);
    expect(state.calls).toEqual([]);
    expect(frame().onKey!(keyEvent("ArrowRight"))).toBe(false);
    // Without a front row, the keys go to ChartFrame's default rule (moving between periods)
    sky(skylineSample, { width: 390, front: undefined });
    expect(frame().onKey!(keyEvent("ArrowDown"))).toBe(false);
    // One event per period: even when all 40 periods show (wide charts), the hidden table stays within 60 rows
    state.active = null;
    const forty = days(40, (i) => ({ Input: 100 + i, Cached: 50, Output: 30, Reasoning: 10, Failed: 3, Retried: 1 }));
    for (const width of [390, 2400]) {
      const h = sky(forty, { width });
      const n = frame().events.length;
      expect(n, `${width}px`).toBeLessThanOrEqual(40);
      expect([...h.matchAll(/<th scope="row">/g)]).toHaveLength(n);
      expect(decode(h)).not.toMatch(/and \d+ more/);
    }
    expect(frame().events).toHaveLength(40);
  });

  it("13: bar height ratios in the ratio strip match the ratios, periods with a back row total of 0 have no bar, and the strip has tick labels (768px)", () => {
    const data = days(14, (i) => ({ Input: i === 6 ? 0 : 500 + 10 * i, Cached: i === 6 ? 0 : 300, Output: i === 6 ? 0 : 150, Reasoning: i === 6 ? 0 : 50, Failed: 5 + (i % 5) * 9, Retried: i === 9 ? 160 : 4 }));
    const h = sky(data, { width: 768, frontRate: "strip" });
    const bars = [...h.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="[\d.]+" height="([\d.]+)" rx="[\d.]+" fill="([^"]+)"><\/rect>/g)].filter((m) => !m[0].includes('width="10"'));
    const total = (d: Data[number]) => BACK.reduce((a, k) => a + Number(d[k]), 0);
    const rates = data.map((d) => (total(d) > 0 ? (Number(d.Failed) + Number(d.Retried)) / total(d) : null));
    // The 7th period, whose back row total is 0, has no bar
    expect(bars).toHaveLength(13);
    const heights = bars.map((m) => +m[3]);
    const valid = rates.filter((x): x is number => x !== null);
    const hiK = heights.indexOf(Math.max(...heights));
    heights.forEach((ht, k) => expect(ht / heights[hiK]).toBeCloseTo(valid[k] / valid[hiK], 2));
    // Only the largest ratio gets the accent color
    expect(bars.filter((m) => m[4].includes("--ztd-accent"))).toHaveLength(1);
    const text = decode(h);
    expect(text).toContain(">Front ÷ back<");
    expect(text).toMatch(/>0<\/text>/);
    expect(text).toMatch(/>\d+%<\/text>/);
  });
});

describe("skyline: validation rules and empty state (4.13)", () => {
  const spec = (data: Data, encoding: Record<string, string | string[]> = { x: "day", y: BACK, front: FRONT }, options: Record<string, unknown> = {}) => ({ type: "skyline", data, encoding, options });
  const codes = (s: unknown) => {
    const res = validateSpec(s);
    return [...res.errors.map((e) => e.code), ...res.warnings.map((w) => `!${w.code}`)];
  };
  it("reports negatives, over 40·120 periods, front without y, all zero, 4 front series and depth out of range in English and Korean", () => {
    const ok = days(14, () => ({ Input: 4, Cached: 3, Output: 2, Reasoning: 1, Failed: 1, Retried: 1 }));
    expect(codes(spec(ok))).toEqual([]);
    expect(codes(spec(ok.map((d, i) => (i === 3 ? { ...d, Failed: -1 } : d))))).toEqual(["skyline_negative"]);
    expect(codes(spec(days(41, () => ({ Input: 1, Cached: 1, Output: 1, Reasoning: 1, Failed: 0, Retried: 0 }))))).toEqual(["!skyline_many_periods"]);
    expect(codes(spec(days(121, () => ({ Input: 1, Cached: 1, Output: 1, Reasoning: 1, Failed: 0, Retried: 0 }))))).toEqual(["skyline_too_many_periods"]);
    expect(codes(spec(ok, { x: "day", front: FRONT }))).toContain("missing_channel");
    expect(codes({ type: "skyline", data: { url: "https://x.test/a.json" }, encoding: { x: "day", front: FRONT } })).toContain("skyline_front_without_y");
    expect(codes(spec(days(7, () => ({ Input: 0, Cached: 0, Output: 0, Reasoning: 0, Failed: 0, Retried: 0 }))))).toEqual(["!skyline_all_zero"]);
    expect(codes(spec(ok.map((d) => ({ ...d, A: 1, B: 1 })), { x: "day", y: BACK, front: [...FRONT, "A", "B"] }))).toEqual(["!skyline_front_many"]);
    expect(codes(spec(ok, undefined, { depth: 0.5 }))).toEqual(["!skyline_depth_range"]);
    expect(codes(spec(ok, undefined, { depth: 0.4 }))).toEqual([]);
    expect(codes(spec(ok, undefined, { depth: 0.4, view: "low" }))).toEqual(["!skyline_depth_range"]);
    expect(codes(spec(ok, undefined, { view: "iso" }))).toEqual(["bad_enum"]);
    const ko = validateSpec(spec(ok.map((d, i) => (i === 3 ? { ...d, Input: -1 } : d))), { lang: "ko" });
    expect(ko.errors[0]).toMatchObject({ path: "encoding.y", message: "스카이라인은 0부터 쌓아요. 음수가 있으면 bar를 쓰세요" });
    expect(validateSpec(spec(ok, undefined, { depth: 0.05 }), { lang: "ko" }).warnings[0].message).toContain("high 시점의 depth는 0.1~0.45예요");
    expect(validateSpec(spec(ok, undefined, { depth: 0.05, view: "low" }), { lang: "ko" }).warnings[0].message).toContain("low 시점의 depth는 0.1~0.32예요");
  });

  it("draws empty state text instead of blocks when all values are 0, and clamps depth into range", () => {
    const zero = days(7, () => ({ Input: 0, Cached: 0, Output: 0, Reasoning: 0, Failed: 0, Retried: 0 }));
    const h = sky(zero, { width: 390 });
    expect(h).toContain(">Nothing to draw<");
    expect(periods(h)).toHaveLength(0);
    expect(r(<SkylineChart data={zero} x="day" y={BACK} width={390} locale="ko-KR" animate={false} />)).toContain(">그릴 값이 없어요<");
    const deep = (view: SkylineView) => skylineLayout({ width: 760, height: 400, back: [[1, 2, 3]], front: [], n: 3, depth: 0.9, view, wall: true, legendH: 0, below: 26, tickFmt: () => String });
    expect(deep("high").depthBack / deep("high").s).toBeCloseTo(0.45, 6);
    expect(deep("low").depthBack / deep("low").s).toBeCloseTo(0.32, 6);
  });
});
