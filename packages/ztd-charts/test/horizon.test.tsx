import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chart } from "../src/charts/Chart";
import { HorizonChart, horizonBandColors, horizonBandSize } from "../src/charts/horizon";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { renderSpecToSVG } from "../src/server";
import { CHARTS, localizeDef, suggestCharts, validateSpec, variantSpec } from "../src/spec";
import { horizonSample, horizonSampleKo } from "../src/spec/samples";
import { contrastRatio, mixHex } from "../src/theme/color";
import { makePainter, ThemeProvider } from "../src/theme/context";
import { darkTheme, lightTheme } from "../src/theme/tokens";

/** Same harness as timeline.test.tsx (active, via, spy, frame), plus the pointed time: the useState(null) called directly by horizon.tsx returns state.time and records what the chart sets */
const state = vi.hoisted(() => ({
  active: null as number | null,
  via: "pointer" as "pointer" | "keyboard",
  spy: false,
  calls: [] as (number | null)[],
  time: null as number | null,
  timeCalls: [] as (number | null)[],
  frame: null as unknown,
}));
vi.mock("react", async (orig) => {
  const R = await orig<typeof import("react")>();
  return {
    ...R,
    useState: (init: unknown) => {
      const st = R.useState(init);
      return init === null && /horizon\.tsx/.test(new Error().stack?.split("\n")[2] ?? "") ? [state.time, (v: number | null) => void state.timeCalls.push(v)] : st;
    },
  };
});
vi.mock("../src/core/useChart", async (orig) => {
  const actual = await orig<typeof import("../src/core/useChart")>();
  return {
    ...actual,
    useChart: (props: never, d: never) => {
      const c = actual.useChart(props, d);
      const out = state.spy ? { ...c, setActive: (i: number | null) => void state.calls.push(i) } : c;
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
  state.time = null;
  state.timeCalls = [];
  state.frame = null;
});

type Row = Record<string, unknown>;
const r = (el: ReactElement) => renderToStaticMarkup(el);
const frame = () => state.frame as ChartFrameProps<unknown>;
const BAD = /NaN|Infinity|undefined|\[object/;
/** A long table, one row per (t, series), from { series: values } */
const long = (series: Record<string, number[]>): Row[] => Object.entries(series).flatMap(([s, vs]) => vs.map((v, t) => ({ t, s, v })));
const draw = (data: Row[], extra: Record<string, unknown> = {}) => r(<HorizonChart data={data} x="t" y="v" series="s" width={600} animate={false} {...extra} />);
const rowOf = (id: string) => {
  const m = /([ud])(\d+)$/.exec(id)!;
  return { kind: m[1], row: Number(m[2]) };
};
/** Each row's band-1 path (u above the baseline, d below), with the fill its group gives it */
const bandPaths = (h: string) => [...h.matchAll(/<g fill="([^"]+)"><path id="([^"]+)" d="([^"]+)"><\/path><\/g>/g)].map((m) => ({ fill: m[1], ...rowOf(m[2]), d: m[3] }));
/** Band 2 and up: the band-1 path of one row drawn again with <use>, moved down by whole rows */
const uses = (h: string, kind: "u" | "d", row = 0) =>
  [...h.matchAll(/<use href="#([^"]+)" y="([^"]+)" fill="([^"]+)"><\/use>/g)].filter((m) => rowOf(m[1]).kind === kind && rowOf(m[1]).row === row).map((m) => ({ y: Number(m[2]), fill: m[3] }));
/** Each row's clip box (the row itself) */
const clips = (h: string) => [...h.matchAll(/<clipPath id="[^"]+"><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"><\/rect><\/clipPath>/g)].map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
const points = (d: string) => [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
const legendTexts = (h: string) => [...h.matchAll(/<text [^>]*font-size="10.5"[^>]*text-anchor="start"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const valueTexts = (h: string, w = 600) => [...h.matchAll(new RegExp(`<text x="${w}" [^>]*text-anchor="end"[^>]*>([^<]*)</text>`, "g"))].map((m) => m[1]);

describe("bands and scale", () => {
  it("band size B: robustMax(|value - baseline|) / bands, rounded up to 1, 2, 2.5 or 5 x 10^n", () => {
    expect(horizonBandSize([13, -2, 5], 0, 1)).toBe(20);
    expect(horizonBandSize([13, -2, 5], 0, 2)).toBe(10);
    expect(horizonBandSize([10], 0, 1)).toBe(10);
    expect(horizonBandSize([2.2], 0, 1)).toBe(2.5);
    expect(horizonBandSize([0.37, -0.1], 0, 1)).toBe(0.5);
    expect(horizonBandSize([104, 92], 100, 2)).toBe(5);
    // From 24 values on robustMax is the 95th percentile, so one spike does not flatten the rest
    expect(horizonBandSize(Array.from({ length: 100 }, (_, i) => i + 1), 0, 2)).toBe(50);
    expect(horizonBandSize([0, 0, NaN], 0, 2)).toBe(1);
  });

  it("the band count is automatic by row height (1, the mirror alone, from 24px; otherwise 2); bands sets it, up to 3", () => {
    const data = long({ a: [1, 5, 9, 14, 20], b: [2, 4, 6, 8, 10], c: [-3, 1, 3, 5, 7] });
    // Band 1 is the path itself; every further band is a <use> of it
    const bands = (extra: Record<string, unknown>) => uses(draw(data, extra), "u").length + 1;
    expect(bands({})).toBe(2);
    expect(bands({ rowHeight: 23 })).toBe(2);
    expect(bands({ rowHeight: 24 })).toBe(1);
    expect(bands({ rowHeight: 28 })).toBe(1);
    expect(bands({ rowHeight: 28, bands: 3 })).toBe(3);
    expect(bands({ bands: 5 })).toBe(3);
    expect(uses(draw(data, { bands: 3 }), "u").map((u) => u.y)).toEqual([18, 36]);
    // Rows are 18px with up to 24 series and 14px with more, 2px apart
    const cs = clips(draw(data));
    expect(cs.map((c) => c.h)).toEqual([18, 18, 18]);
    expect(cs[1].y - (cs[0].y + cs[0].h)).toBe(2);
    const many = draw(long(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`s${i}`, [1, 5, 9]]))));
    expect(clips(many)[0].h).toBe(14);
    expect(uses(many, "u")).toHaveLength(1);
  });

  it("values below the baseline mirror into the same row in the down color, rising from the row bottom", () => {
    const h = draw(long({ a: Array(10).fill(-15) }), { legend: false, showValues: false });
    const [box] = clips(h);
    const bottom = box.y + box.h;
    const paths = bandPaths(h);
    expect(paths.map((p) => p.kind)).toEqual(["d"]);
    const ys = points(paths[0].d).map(([, y]) => y);
    expect(Math.max(...ys)).toBeCloseTo(bottom, 1);
    // B is 10 (15 / 2 rounded up), so -15 rises one and a half rows: band 2 covers the lower half
    expect(Math.min(...ys)).toBeCloseTo(bottom - 1.5 * box.h, 1);
    expect(uses(h, "d").map((u) => u.y)).toEqual([18]);
    // A baseline moves the split: 5 is above 4 and below 6
    const up = bandPaths(draw(long({ a: [5, 5] }), { baseline: 4 }));
    const dn = bandPaths(draw(long({ a: [5, 5] }), { baseline: 6 }));
    expect([up.map((p) => p.kind), dn.map((p) => p.kind)]).toEqual([["u"], ["d"]]);
  });

  it("where neighbouring points lie on opposite sides of the baseline, the up and down areas meet at the crossing", () => {
    const h = draw(long({ a: [10, -10] }), { legend: false, showValues: false });
    const up = points(bandPaths(h).find((p) => p.kind === "u")!.d);
    const dn = points(bandPaths(h).find((p) => p.kind === "d")!.d);
    const [x0, x1, bottom] = [up[0][0], up[up.length - 1][0], up[0][1]];
    // Up: from the top of +10 down to the baseline at the midpoint. Down: from the baseline there up to -10
    expect(up[1]).toEqual([x0, bottom - 36]);
    // (within the 0.1px rounding of the path)
    expect(up[2][0]).toBeCloseTo((x0 + x1) / 2, 0);
    expect(up[2][1]).toBe(bottom);
    expect(dn[2]).toEqual(up[2]);
    expect(dn[3]).toEqual([x1, bottom - 36]);
    // The crossing follows the values: +30 then -10 crosses three quarters of the way
    const q = points(bandPaths(draw(long({ a: [30, -10] }), { legend: false, showValues: false })).find((p) => p.kind === "u")!.d);
    expect(q[2][0]).toBeCloseTo(x0 + 0.75 * (x1 - x0), 0);
    // Between the points LTTB keeps too: the two areas never rise in the same segment
    const noisy = Array.from({ length: 2000 }, (_, i) => Math.sin(i / 7) * 10 + ((i * 37) % 11) - 5);
    const n = draw(long({ a: noisy }), { width: 400, legend: false, showValues: false });
    const heights = (kind: string) => {
      const ps = points(bandPaths(n).find((p) => p.kind === kind)!.d);
      return ps.slice(1, -1).map(([, y]) => ps[0][1] - y);
    };
    const [hu, hd] = [heights("u"), heights("d")];
    expect(hu.length).toBe(hd.length);
    expect(hu.length).toBeLessThan(noisy.length);
    for (let i = 0; i + 1 < hu.length; i++) expect(Math.max(hu[i], hu[i + 1]) > 0 && Math.max(hd[i], hd[i + 1]) > 0, `segment ${i}`).toBe(false);
  });

  it("values past the top band are clipped there, and each row draws inside its own clip box", () => {
    // 31 values: B ignores the top 5%, so B is 2 (3 / 2 rounded up). 3 rises 1.5 rows and the spike stops at the top of band 2 instead of 500 rows up
    const h = draw(long({ a: [...Array(30).fill(3), 1000] }), { legend: false, showValues: false });
    const [box] = clips(h);
    const bottom = box.y + box.h;
    const ys = points(bandPaths(h)[0].d).map(([, y]) => y);
    expect(Math.min(...ys)).toBeCloseTo(bottom - 2 * box.h, 1);
    expect(ys.filter((y) => Math.abs(y - (bottom - 1.5 * box.h)) < 0.06).length).toBeGreaterThan(20);
    const two = draw(long({ a: [1, 2], b: [2, 1] }));
    expect(two.match(/<g clip-path="url\(#[^"]+\)">/g)).toHaveLength(2);
    expect(clips(two)).toHaveLength(2);
  });

  it("band colors: every band at least 3:1 against the card in both default themes, neighbours at least 1.5:1 apart", () => {
    for (const theme of [darkTheme, lightTheme]) {
      const p = makePainter(theme, false);
      for (const base of ["accent", "neutralStrong"])
        for (const n of [1, 2, 3]) {
          const cols = horizonBandColors(p, base, n);
          expect(cols, `${theme.name} ${base} ${n}`).toHaveLength(n);
          cols.forEach((col, i) => {
            expect(contrastRatio(col, theme.panel), `${theme.name} ${base} ${n} bands, band ${i + 1}`).toBeGreaterThanOrEqual(3);
            if (i) expect(contrastRatio(col, cols[i - 1]), `${theme.name} ${base} ${n} bands, bands ${i}/${i + 1}`).toBeGreaterThanOrEqual(1.5);
          });
        }
    }
    // The two steps of the rule: dark mixes toward the card from the lightest share that reaches 3:1 (40%), light darkens toward the text color
    const dark = makePainter(darkTheme, false);
    const light = makePainter(lightTheme, false);
    // Three bands in step 2 darken by s x [1, 0.74, 0.49] (the plan's [1, 0.75, 0.5] left the light gray bands 1 and 2 at 1.48:1)
    expect(horizonBandColors(light, "neutralStrong", 3)).toEqual([0.75, 0.75 * 0.74, 0.75 * 0.49].map((k) => mixHex(lightTheme.neutralStrong, lightTheme.ink, k)));
    expect(horizonBandColors(light, "accent", 3)).toEqual([lightTheme.accent, mixHex(lightTheme.accent, lightTheme.ink, 0.74), mixHex(lightTheme.accent, lightTheme.ink, 0.49)]);
    expect(horizonBandColors(dark, "accent", 2)).toEqual([mixHex(darkTheme.accent, darkTheme.panel, 0.4), darkTheme.accent]);
    expect(horizonBandColors(dark, "accent", 3)).toEqual([mixHex(darkTheme.accent, darkTheme.panel, 0.4), mixHex(darkTheme.accent, darkTheme.panel, 0.7), darkTheme.accent]);
    expect(horizonBandColors(light, "accent", 2)).toEqual([lightTheme.accent, mixHex(lightTheme.accent, lightTheme.ink, 0.6)]);
    expect(horizonBandColors(light, "neutralStrong", 2)).toEqual([mixHex(lightTheme.neutralStrong, lightTheme.ink, 0.75), mixHex(lightTheme.neutralStrong, lightTheme.ink, 0.45)]);
    expect(horizonBandColors(dark, "neutralStrong", 1)).toEqual([darkTheme.neutralStrong]);
    // The chart paints with these colors (accent above, neutralStrong below by default)
    const h = r(
      <ThemeProvider theme="light" cssVars={false}>
        <HorizonChart data={long({ a: [5, 15, -15, -5] })} x="t" y="v" series="s" width={600} animate={false} />
      </ThemeProvider>,
    );
    const up = horizonBandColors(light, "accent", 2);
    const down = horizonBandColors(light, "neutralStrong", 2);
    expect(bandPaths(h).map((p) => p.fill)).toEqual([up[0], down[0]]);
    expect([uses(h, "u")[0].fill, uses(h, "d")[0].fill]).toEqual([up[1], down[1]]);
  });

  it('scale "free" fits each row to its own values, and the legend reads Lower to Higher', () => {
    const data = long({ big: [100, 200, 400], small: [1, 2, 4] });
    const top = (h: string, row: number) => {
      const box = clips(h)[row];
      return box.y + box.h - Math.min(...points(bandPaths(h).find((p) => p.row === row)!.d).map(([, y]) => y));
    };
    const shared = draw(data);
    expect(top(shared, 0)).toBeCloseTo(36, 1);
    expect(top(shared, 1)).toBeLessThan(1);
    const free = draw(data, { scale: "free" });
    expect([top(free, 0), top(free, 1)]).toEqual([36, 36]);
    expect(legendTexts(free)).toEqual(["Lower", "Higher"]);
    expect(frame().description).toContain("own scale");
  });
});

describe("layout and hover", () => {
  const data = long({ api: [3, 8, -2, 5], web: [1, -4, 6, 9] });

  it("the reading legend on top shows each band's range and the down color; legend: false removes it", () => {
    const h = draw(long({ a: [5, 15, -15, -5] }), { unit: "%" });
    expect(legendTexts(h)).toEqual(["0 to 10%", "10 to 20%", "below 0%"]);
    const legendY = Math.max(...[...h.matchAll(/<text x="[^"]+" y="([^"]+)"[^>]*text-anchor="start"[^>]*>[^<]*to[^<]*<\/text>/g)].map((m) => Number(m[1])));
    expect(legendY).toBeLessThan(clips(h)[0].y);
    // Nothing below the baseline: no down entry
    expect(legendTexts(draw(long({ a: [5, 15] }), { unit: "%" }))).toEqual(["0 to 10%", "10 to 20%"]);
    expect(legendTexts(draw(long({ a: [5, 15] }), { legend: false }))).toEqual([]);
  });

  it("when the shared scale clips values into the top band, its legend range stays open; scale free keeps Lower and Higher", () => {
    // 31 values: B is 2 (the top 5% ignored), so 1000 lies past the top of band 2
    const spiky = long({ a: [...Array(30).fill(3), 1000] });
    expect(legendTexts(draw(spiky, { unit: "%" }))).toEqual(["0 to 2%", "2% and above"]);
    expect(legendTexts(draw(spiky, { unit: "%", locale: "ko-KR" }))).toEqual(["0~2%", "2% 이상"]);
    // Below the baseline counts too, since the bands mirror
    expect(legendTexts(draw(long({ a: [...Array(30).fill(3), -1000] }), { unit: "%" }))).toEqual(["0 to 2%", "2% and above", "below 0%"]);
    // Nothing past the top band (4 is its top): closed ranges
    expect(legendTexts(draw(long({ a: [...Array(30).fill(3), 4] }), { unit: "%" }))).toEqual(["0 to 2%", "2 to 4%"]);
    // A single band keeps its range even when values are clipped: its height is the only scale (B is 5 here)
    expect(legendTexts(draw(spiky, { unit: "%", bands: 1 }))).toEqual(["0 to 5%"]);
    expect(legendTexts(draw(spiky, { scale: "free" }))).toEqual(["Lower", "Higher"]);
  });

  it("names on the left, the last value of each row on the right; showValues: false removes the value column", () => {
    const h = draw(data, { unit: "%" });
    expect(valueTexts(h)).toEqual(["5%", "9%"]);
    expect(h).toMatch(/<text x="0" [^>]*>api<\/text>/);
    expect(valueTexts(draw(data, { showValues: false }))).toEqual([]);
    // The rows widen when the value column goes
    expect(clips(draw(data, { showValues: false }))[0].w).toBeGreaterThan(clips(h)[0].w);
  });

  it("pointing at a time moves every row's value to that time and shows the period pill, a line across the rows and the hovered row's tooltip", () => {
    state.active = 1;
    state.time = 1;
    const h = draw(data, { unit: "%" });
    expect(valueTexts(h)).toEqual(["8%", "-4%"]);
    expect(frame().tip).toMatchObject({ title: "1", rows: [{ label: "web", value: "-4%" }] });
    expect(h).toMatch(/<rect x="[^"]+" y="-9" width="[^"]+" height="18" rx="9"/);
    expect(h).toMatch(/class="ztd-guide"/);
  });

  it("the description gives series, points, bands and B, and the largest and smallest last values", () => {
    draw(data, { unit: "%" });
    expect(frame().description).toBe("Horizon chart. 2 series, 4 points each, 2 bands of 5%. Largest last value: web 9%. Smallest: api 5%.");
    draw(data, { unit: "%", locale: "ko-KR" });
    expect(frame().description).toBe("호라이즌 차트. 계열 2개, 계열마다 4개 지점, 층 2개(한 층 5%). 마지막 값이 가장 큰 계열은 web 9%, 가장 작은 계열은 api 5%.");
  });

  it("each row is reduced with LTTB to about one point per pixel of the plot", () => {
    const vals = Array.from({ length: 3000 }, (_, i) => Math.sin(i / 50) * 10);
    const h = draw(long({ a: vals }), { width: 400, legend: false, showValues: false });
    const [box] = clips(h);
    const ps = bandPaths(h);
    expect(ps.map((p) => p.kind)).toEqual(["u", "d"]);
    // Plus one point where kept neighbours lie on opposite sides of the baseline (the crossing)
    const crossings = vals.filter((v, i) => i > 0 && v * vals[i - 1] < 0).length;
    for (const p of ps) expect(points(p.d).length).toBeLessThanOrEqual(Math.round(box.w) + 2 + crossings);
  });

  it("highlight names a series (none by default)", () => {
    const bold = (h: string) => [...h.matchAll(/<text x="0" [^>]*font-weight="700"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(bold(draw(data))).toEqual([]);
    expect(bold(draw(data, { highlight: "web" }))).toEqual(["web"]);
  });
});

describe("keyboard and narration", () => {
  const press = (key: string) => frame().onKey!({ key } as never);
  const data = long({ api: [3, 8, -2, 5], web: [1, -4, 6, 9], db: [2, 2, 2, 2] });

  it("one item per series reads latest, min and max; up and down are the default row moves", () => {
    draw(data, { unit: "%" });
    expect(frame().events.map((e) => [e.label, e.formatted])).toEqual([
      ["api", "latest 5%, min -2%, max 8%"],
      ["web", "latest 9%, min -4%, max 9%"],
      ["db", "latest 2%, min 2%, max 2%"],
    ]);
    expect(press("ArrowDown")).toBe(false);
    expect(press("ArrowUp")).toBe(false);
  });

  it("left and right move in time on the selected row and announce it; Escape clears both", () => {
    state.spy = true;
    state.active = 1;
    state.via = "keyboard";
    state.time = 2;
    draw(data, { unit: "%" });
    expect(frame().announce).toBe("web, 2: 6%");
    expect(press("ArrowRight")).toBe(true);
    expect(press("ArrowLeft")).toBe(true);
    expect(state.timeCalls).toEqual([3, 1]);
    expect(state.calls).toEqual([1, 1]);
    expect(press("Escape")).toBe(true);
    expect(state.timeCalls.at(-1)).toBeNull();
    expect(state.calls.at(-1)).toBeNull();
  });

  it("with nothing selected, right starts at the latest point on the first row; time stops at the ends; Escape passes through", () => {
    state.spy = true;
    draw(data);
    expect(frame().announce).toBeUndefined();
    expect(press("ArrowRight")).toBe(true);
    expect(state.timeCalls).toEqual([3]);
    expect(state.calls).toEqual([0]);
    expect(press("Escape")).toBe(false);
    state.active = 0;
    state.via = "keyboard";
    state.time = 3;
    state.timeCalls = [];
    draw(data);
    press("ArrowRight");
    state.time = 0;
    draw(data);
    press("ArrowLeft");
    expect(state.timeCalls).toEqual([3, 0]);
  });
});

describe("limits and edge cases", () => {
  const nSeries = (n: number) => long(Object.fromEntries(Array.from({ length: n }, (_, i) => [`s${i + 1}`, [1, 2, -3]])));

  it("over 60 series draws the first 60 (too_many_series); 7 or fewer suggests a line chart (few_series); 4 bands is an error", () => {
    const codes = (data: Row[], options: Row = {}) => {
      const v = validateSpec({ type: "horizon", data, encoding: { x: "t", y: "v", series: "s" }, options });
      return [...v.errors.map((e) => `E ${e.code}`), ...v.warnings.map((w) => `W ${w.code}`)];
    };
    expect(codes(nSeries(61))).toEqual(["W too_many_series"]);
    expect(codes(nSeries(60))).toEqual([]);
    expect(codes(nSeries(8))).toEqual([]);
    expect(codes(nSeries(7))).toEqual(["W few_series"]);
    expect(codes(nSeries(12), { bands: 4 })).toEqual(["E bad_bands"]);
    const h = draw(nSeries(61));
    expect(frame().events).toHaveLength(60);
    expect(frame().events.at(-1)?.label).toBe("s60");
    expect(clips(h)).toHaveLength(60);
  });

  it("never draws NaN, Infinity or undefined", () => {
    const cases: Row[][] = [
      [],
      long({ a: [5] }),
      long({ a: [0, 0, 0] }),
      long({ a: [NaN, NaN] }),
      long({ a: [1e12, -1e12, 3] }),
      [{ t: 0, s: "a", v: null }, { t: 1, s: "a", v: "n/a" }, { t: 2, s: "a", v: 4 }, { t: 3, s: "b", v: -2 }],
    ];
    for (const data of cases)
      for (const extra of [{}, { scale: "free" }, { bands: 3, baseline: 2 }, { rowHeight: 48, legend: false }]) {
        const h = draw(data, extra);
        expect(h, `${JSON.stringify(data).slice(0, 60)} ${JSON.stringify(extra)}`).not.toMatch(BAD);
        expect(frame().description).not.toMatch(BAD);
      }
    // Hovering a missing value, dates as text and a wide table
    state.active = 0;
    state.time = 1;
    expect(draw(cases[5])).not.toMatch(BAD);
    state.active = null;
    const wide = [{ week: "2026-05-04", a: 1, b: -2 }, { week: "2026-05-11", a: 3, b: null }];
    expect(r(<HorizonChart data={wide} x="week" y={["a", "b"]} width={360} animate={false} />)).not.toMatch(BAD);
    expect(frame().events.map((e) => e.label)).toEqual(["a", "b"]);
  });
});

describe("spec, server and suggestions", () => {
  const def = CHARTS.find((c) => c.type === "horizon")!;

  it("the example and its Korean version validate cleanly; horizonChart and horizonGraph draw a horizon chart", () => {
    const issues = (s: unknown) => [...validateSpec(s).errors, ...validateSpec(s).warnings].map((i) => i.code);
    expect(issues(def.example)).toEqual([]);
    expect(issues(localizeDef(def, "ko").example)).toEqual([]);
    // horizonChart is also the component name, which getChartDef reads without a warning (as treeChart)
    expect(issues({ ...def.example, type: "horizonChart" })).toEqual([]);
    expect(issues({ ...def.example, type: "horizonGraph" })).toEqual(["alias"]);
    for (const type of ["horizonChart", "horizonGraph"]) expect(renderSpecToSVG({ ...def.example, type, card: undefined }, { width: 600 })).toMatch(/<desc[^>]*>Horizon chart\. 12 series/);
    expect(horizonSample).toHaveLength(12 * 26);
    expect(new Set(horizonSample.map((d) => d.service)).size).toBe(12);
    expect(new Set(horizonSample.map((d) => d.week)).size).toBe(26);
    expect(horizonSampleKo.map((d) => d.change)).toEqual(horizonSample.map((d) => d.change));
    expect(horizonSample.some((d) => d.change < 0)).toBe(true);
  });

  it("the server SVG is deterministic and draws the same rows as the browser chart", () => {
    const a = renderSpecToSVG(def.example, { width: 720, theme: "light" });
    expect(renderSpecToSVG(def.example, { width: 720, theme: "light" })).toBe(a);
    expect(a).not.toMatch(BAD);
    const browser = r(
      <ThemeProvider theme="light">
        <Chart spec={{ ...def.example, card: undefined }} width={672} animate={false} />
      </ThemeProvider>,
    );
    const ds = (s: string) => bandPaths(s).map((p) => p.d);
    expect(clips(browser)).toHaveLength(12);
    expect(ds(renderSpecToSVG({ ...def.example, card: undefined }, { width: 672 + 48, frame: false, theme: "light" }))).toEqual(ds(browser));
  });

  it("variants: one band on 28px rows, three bands, and each row on its own scale", () => {
    const svg = (id: string) => renderSpecToSVG(variantSpec(def, id)!, { width: 720, theme: "light" });
    const one = svg("one-band");
    expect(uses(one, "u")).toEqual([]);
    expect(clips(one)[0].h).toBe(28);
    expect(uses(svg("three-bands"), "u")).toHaveLength(2);
    expect(svg("own-scale")).toContain(">Higher<");
  });

  it("suggest: a date, a value and 13 to 60 series suggest a horizon chart at 0.84; 12 or fewer or over 60 do not", () => {
    const weekly = (n: number) =>
      Array.from({ length: 8 }, (_, w) => Array.from({ length: n }, (_, i) => ({ week: new Date(Date.UTC(2026, 4, 4 + 7 * w)).toISOString().slice(0, 10), service: `svc ${i + 1}`, change: ((w * 7 + i * 3) % 23) - 8 }))).flat();
    const pick = (n: number) => suggestCharts(weekly(n), { limit: 20 }).suggestions.find((s) => s.type === "horizon");
    expect(pick(13)).toMatchObject({ score: 0.84, spec: { encoding: { x: "week", y: "change", series: "service" } } });
    expect(pick(60)?.score).toBe(0.84);
    expect(pick(12)).toBeUndefined();
    expect(pick(61)).toBeUndefined();
    expect(validateSpec(pick(13)!.spec).errors).toEqual([]);
  });
});
