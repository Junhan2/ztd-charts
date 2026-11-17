import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chart } from "../src/charts/Chart";
import { CohortChart } from "../src/charts/cohort";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { baseColumn, COHORT_MAX_CELLS, cohortAverages, readCohort } from "../src/layout/cohort";
import { renderSpecToSVG } from "../src/server";
import { CHARTS, suggestCharts, validateSpec, variantSpec } from "../src/spec";
import { cohortSample, cohortSampleKo } from "../src/spec/samples";
import { ThemeProvider } from "../src/theme/context";

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

type Row = Record<string, unknown>;
const r = (el: ReactElement) => renderToStaticMarkup(el);
const frame = () => state.frame as ChartFrameProps<unknown>;
const FIELDS = { cohort: "cohort", period: "month", value: "active" } as const;
const draw = (data: readonly Row[], extra: Row = {}) => r(<CohortChart data={data as Row[]} {...FIELDS} width={560} animate={false} {...extra} />);
const sample = (extra: Row = {}) => draw(cohortSample, { size: "size", ...extra });
const BAD = /NaN|Infinity|undefined|\[object/;
/** Cell shapes in drawing order (the average row first, then each cohort row, the same order as the items): top edge, fill and opacity */
const marks = (h: string) => [...h.matchAll(/<path d="M[\d.]+,([\d.]+)[^"]*" fill="([^"]*)" opacity="([\d.]+)" class="ztd-mark"/g)].map((m) => ({ y: Number(m[1]), fill: m[2], opacity: Number(m[3]) }));
/** Text inside cells (10.5px, centered, weight 600), in drawing order */
const values = (h: string) => [...h.matchAll(/font-size="10.5" fill="[^"]*" text-anchor="middle" font-weight="600"[^>]*>([^<]*)</g)].map((m) => m[1]);
/** Item number of a cell by its key ("cohort|period") in the last render */
const at = (key: string) => frame().events.findIndex((e) => e.key === key);
const keyEvent = (key: string) => ({ key, preventDefault() {} }) as never;
/** Long rows from one list of values per cohort (period 0, 1, 2 ...). null is a missing value */
const table = (cohorts: Record<string, (number | null)[]>) => Object.entries(cohorts).flatMap(([cohort, vals]) => vals.map((active, month) => ({ cohort, month, active })));

describe("reading (readCohort)", () => {
  it("rates are the people still active over each cohort's size, taken from the size channel", () => {
    const m = readCohort(cohortSample, { ...FIELDS, size: "size" });
    expect(m).toMatchObject({ type: "count", guessed: false, counted: true, total: 36, trimmed: 0 });
    expect(m.cohorts).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    expect(m.periods).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"]);
    expect(m.sizes).toEqual([1240, 1385, 1310, 1502, 1647, 1590, 1733, 1810]);
    expect(m.cells).toHaveLength(36);
    expect(m.cells.find((c) => c.row === 2 && c.col === 3)).toMatchObject({ count: 524, rate: 524 / 1310 });
  });

  it("auto reading in the plan's order: a size channel means counts, then ratios (all at most 1), percents (all at most 100), otherwise counts sized by the first period", () => {
    const read = (data: Row[], size?: string, valueType?: string) => readCohort(data, { ...FIELDS, size }, valueType);
    const rates = (m: ReturnType<typeof read>) => m.cells.map((c) => c.rate);
    // Values of at most 100 still read as counts when there is a size channel
    const sized = read([{ cohort: "A", month: 0, active: 40, size: 40 }, { cohort: "A", month: 1, active: 10, size: 40 }], "size");
    expect(sized).toMatchObject({ type: "count", guessed: false, counted: true, sizes: [40] });
    expect(rates(sized)).toEqual([1, 0.25]);
    const ratio = read(table({ A: [1, 0.42] }));
    expect(ratio).toMatchObject({ type: "ratio", guessed: true, counted: false });
    expect(rates(ratio)).toEqual([1, 0.42]);
    expect(ratio.cells[1].count).toBeNaN();
    const percent = read(table({ A: [100, 42] }));
    expect(percent).toMatchObject({ type: "percent", guessed: true, counted: false });
    expect(rates(percent)).toEqual([1, 0.42]);
    const counts = read(table({ A: [250, 105, 60] }));
    expect(counts).toMatchObject({ type: "count", guessed: true, counted: true, sizes: [250] });
    expect(rates(counts)).toEqual([1, 0.42, 0.24]);
    // A set valueType wins and is not a guess
    const set = read(table({ A: [1, 0.5] }), undefined, "percent");
    expect(set).toMatchObject({ type: "percent", guessed: false });
    expect(rates(set)).toEqual([0.01, 0.005]);
  });

  it("cohorts go in date order when all read as dates and periods in number order when all are numbers, otherwise in order of first appearance", () => {
    const order = (cohorts: string[], periods: unknown[]) => {
      const m = readCohort(cohorts.flatMap((cohort) => periods.map((month) => ({ cohort, month, active: 0.5 }))), FIELDS);
      return [m.cohorts, m.periods];
    };
    expect(order(["2026-03", "2026-01", "2026-02"], [2, 10, 1])).toEqual([["2026-01", "2026-02", "2026-03"], ["1", "2", "10"]]);
    // Day-first dates read day-first throughout, as the other charts read a date column
    expect(order(["13/01/2024", "05/02/2024", "20/02/2024"], [0])[0]).toEqual(["13/01/2024", "05/02/2024", "20/02/2024"]);
    expect(order(["Spring", "2026-01", "Autumn"], ["Week 2", "Week 1", "Week 10"])).toEqual([["Spring", "2026-01", "Autumn"], ["Week 2", "Week 1", "Week 10"]]);
  });

  it("over 2,500 cells only the most recent cohorts that fit are kept; the 50 x 50 triangle stays whole", () => {
    const grid = (n: number, periods: (i: number) => number) => Array.from({ length: n }, (_, i) => Array.from({ length: periods(i) }, (_, month) => ({ cohort: `C${i}`, month, active: 100 - month }))).flat();
    expect(COHORT_MAX_CELLS).toBe(2500);
    const big = readCohort(grid(60, () => 50), FIELDS);
    expect(big).toMatchObject({ total: 3000, trimmed: 10 });
    expect(big.cohorts[0]).toBe("C10");
    expect(big.cells).toHaveLength(2500);
    expect(readCohort(grid(50, (i) => 50 - i), FIELDS)).toMatchObject({ total: 1275, trimmed: 0 });
    // 2,500 cohort cells and the 50 cells of the average row
    expect(marks(draw(grid(60, () => 50)))).toHaveLength(2550);
  });
});

describe("average row and color scale", () => {
  it("the average weighs each cohort by its size, counting only the cohorts that reached the period; without counts it is the plain mean", () => {
    const avg = cohortAverages(readCohort(cohortSample, { ...FIELDS, size: "size" }));
    const month = (k: number) => cohortSample.filter((d) => d.month === k);
    const kept = month(1).reduce((a, d) => a + d.active, 0);
    const size = month(1).reduce((a, d) => a + d.size, 0);
    expect([kept, size]).toEqual([6279, 10407]);
    expect(avg[1]).toEqual({ rate: kept / size, count: kept, size });
    // Only 2026-01 reached month 7
    expect(avg[7]).toEqual({ rate: 384 / 1240, count: 384, size: 1240 });
    const plain = cohortAverages(readCohort(table({ A: [1, 0.5], B: [1, 0.3] }), FIELDS));
    expect(plain[1].rate).toBeCloseTo(0.4, 12);
    expect(plain[1].count).toBeNaN();
  });

  it("the base column (every cohort at 99.5% or more) is painted neutralSoft and left out of the color scale", () => {
    expect(baseColumn(readCohort(cohortSample, { ...FIELDS, size: "size" }).cells)).toBe(0);
    const ms = marks(sample());
    expect(ms).toHaveLength(44);
    // 8 cohorts and the average row
    expect(ms.filter((x) => x.fill.includes("--ztd-neutral-soft"))).toHaveLength(9);
    expect(ms[at("2026-01|0")].fill).toContain("--ztd-neutral-soft");
    // The scale runs from the lowest share (31%) to the 95th percentile of the other cells, so 63% takes the darkest step (with month 0 in the scale it would sit in the middle)
    expect(ms[at("2026-06|1")]).toMatchObject({ fill: expect.stringContaining("--ztd-accent"), opacity: 1 });
    expect(ms[at("2026-01|7")].opacity).toBe(0.14);
    // One cohort below 99.5% in the first column: no base column
    const below = table({ "2026-01": [0.99, 0.5], "2026-02": [1, 0.4] });
    expect(baseColumn(readCohort(below, FIELDS).cells)).toBe(-1);
    expect(marks(draw(below)).filter((x) => x.fill.includes("--ztd-neutral-soft"))).toEqual([]);
  });

  it("empty cells draw nothing, while 0% is a light cell that says 0%", () => {
    const data = table({ "2026-01": [1, 0.5, 0.3, 0], "2026-02": [1, null, 0.35], "2026-03": [1, 0.45] });
    const h = draw(data);
    const ms = marks(h);
    // 4 + 2 + 2 cohort cells and 4 average cells: the missing value and the periods not reached yet have no shape
    expect(ms).toHaveLength(12);
    expect(frame().events.map((e) => e.key)).not.toContain("2026-02|1");
    expect(ms[at("2026-01|3")].opacity).toBe(0.14);
    expect(values(h)[at("2026-01|3")]).toBe("0%");
  });
});

describe("layout and text", () => {
  it("names, the size column (header n), period names on top, the average row, a 6px gap, then the cohort rows", () => {
    const h = sample();
    const ms = marks(h);
    expect(h).toMatch(/text-anchor="end" font-weight="500"[^>]*>n</);
    expect(h).toMatch(/text-anchor="end" font-weight="500"[^>]*>1,240</);
    expect(h).toMatch(/text-anchor="start" font-weight="600"[^>]*>Average</);
    // The period names sit above the average row
    const header = [...h.matchAll(/<text x="[\d.]+" y="([\d.]+)"[^>]*text-anchor="middle" font-weight="400"[^>]*>0</g)].map((m) => Number(m[1]));
    expect(header).toHaveLength(1);
    expect(header[0]).toBeLessThan(ms[0].y);
    // Rows are 26px apart, with 6px more between the average row and the first cohort
    expect(ms[at("2026-01|0")].y - ms[0].y).toBeCloseTo(26 + 6, 6);
    expect(ms[at("2026-02|0")].y - ms[at("2026-01|0")].y).toBeCloseTo(26, 6);
    // The name column fits the widest name, so no name is cut (Korean names included)
    const ko = draw(cohortSampleKo, { size: "size", locale: "ko-KR" });
    expect(ko).toMatch(/font-weight="500"[^>]*>2026년 1월</);
    expect(ko).not.toMatch(/…</);
    // Narrow: the cells would get narrower than 20px, so the size column goes first, and values no longer fit
    const narrow = sample({ width: 240 });
    expect(narrow).not.toMatch(/>n</);
    expect(narrow).not.toMatch(/>1,240</);
    expect(values(narrow)).toEqual([]);
  });

  it("shares in cells by default, people with show count (the average row keeps shares), shares when counts are unknown, nothing with showValues false", () => {
    const rates = values(sample());
    expect(rates).toHaveLength(44);
    expect(rates.slice(0, 3)).toEqual(["100%", "60%", "48%"]);
    expect(rates[at("2026-03|3")]).toBe("40%");
    const people = values(sample({ show: "count" }));
    expect(people[at("2026-03|3")]).toBe("524");
    expect(people.slice(0, 2)).toEqual(["100%", "60%"]);
    expect(values(draw(table({ A: [1, 0.5] }), { show: "count" }))).toEqual(["100%", "50%", "100%", "50%"]);
    expect(values(sample({ showValues: false }))).toEqual([]);
  });

  it("the description gives the size of the table and the average of the first 6 periods after the base column", () => {
    sample();
    expect(frame().description).toBe("Cohort chart. 8 cohorts × 8 periods. Average retention: 1 60%, 2 48%, 3 41%, 4 38%, 5 35%, 6 33%.");
    draw(cohortSampleKo, { size: "size", locale: "ko-KR" });
    expect(frame().description).toBe("코호트 차트. 코호트 8개 × 기간 8개. 평균 잔존율: 1 60%, 2 48%, 3 41%, 4 38%, 5 35%, 6 33%.");
    expect(frame().events[at("2026년 3월|3")].formatted).toBe("40%, 1,310 중 524");
    draw([]);
    expect(frame().description).toBe("");
  });

  it("highlight names a cohort: its name turns bold and its row gets an outline; nothing by default", () => {
    const outline = /fill="none" stroke="var\(--ztd-ink[^"]*" stroke-width="1.5"/g;
    expect(sample().match(outline)).toBeNull();
    const h = sample({ highlight: "2026-03" });
    expect(h.match(outline)).toHaveLength(1);
    expect(h).toMatch(/font-weight="700"[^>]*>2026-03</);
  });
});

describe("interaction", () => {
  const data = table({ "2026-01": [1, 0.5, 0.3, 0], "2026-02": [1, null, 0.35], "2026-03": [1, 0.45] });
  /** Items: the average row 0~3, 2026-01 4~7, 2026-02 8 (period 0) and 9 (period 2), 2026-03 10 (period 0) and 11 (period 1) */
  const press = (active: number, key: string, extra: Row = {}) => {
    state.spy = true;
    state.active = active;
    state.calls = [];
    draw(data, extra);
    return [frame().onKey!(keyEvent(key)), state.calls];
  };

  it("ArrowUp/ArrowDown move within the column through the average row, skip empty cells and stop at the ends", () => {
    expect(press(5, "ArrowDown")).toEqual([true, [[11, "keyboard"]]]);
    expect(press(4, "ArrowUp")).toEqual([true, [[0, "keyboard"]]]);
    expect(press(0, "ArrowUp")).toEqual([true, []]);
    expect(press(11, "ArrowDown")).toEqual([true, []]);
    expect(press(5, "ArrowRight")[0]).toBe(false);
    // Without the average row, up from the first cohort stays put
    expect(press(0, "ArrowUp", { average: false })).toEqual([true, []]);
  });

  it("one item per cell including the average row, row by row; the table and the keyboard announcement read the cohort, period, share and people", () => {
    state.active = 26;
    state.via = "keyboard";
    const h = sample();
    const ev = frame().events;
    expect(ev).toHaveLength(44);
    expect(ev.slice(0, 2).map((e) => `${e.label}=${e.formatted}`)).toEqual(["Average · 0=100%, 12,217 of 12,217", "Average · 1=60%, 6,279 of 10,407"]);
    expect(ev[0].datum).toBeNull();
    expect(ev[26]).toMatchObject({ key: "2026-03|3", label: "2026-03 · 3", value: 40, formatted: "40%, 524 of 1,310", datum: { cohort: "2026-03", month: 3, active: 524, size: 1310 } });
    expect(h).toContain("2026-03 · 3: 40%, 524 of 1,310 (27/44)");
    expect(h.match(/<tr>/g)).toHaveLength(44);
  });

  it("hover: a border on the cell, its row and column stay, the rest is shaded to 0.55, the row and period names turn bold, and the tooltip names both", () => {
    state.active = 26;
    const h = sample();
    expect(h.match(/fill="none" stroke="var\(--ztd-ink[^"]*" stroke-width="2"/g)).toHaveLength(1);
    expect(h).toMatch(/<path d="M[^"]+" fill="var\(--ztd-panel[^"]*" opacity="0.45" pointer-events="none"/);
    expect(h).toMatch(/text-anchor="start" font-weight="700"[^>]*>2026-03</);
    expect(h).toMatch(/text-anchor="middle" font-weight="700"[^>]*>3</);
    expect(frame().tip).toMatchObject({ title: "2026-03 · 3", rows: [{ label: "Retained", value: "40%" }, { label: "People", value: "524 of 1,310" }] });
    state.active = 1;
    sample();
    expect(frame().tip).toMatchObject({ title: "Average · 1", rows: [{ value: "60%" }, { value: "6,279 of 10,407" }] });
    // Without counts there is no people line
    state.active = 3;
    draw(table({ A: [1, 0.5] }));
    expect(frame().tip!.rows).toHaveLength(1);
  });
});

describe("edge inputs", () => {
  it("odd input draws no NaN: no data, missing and text values, zero sizes, all zeros, one cell, negative and huge values, one cohort over the cap", () => {
    const cases: [Row[], Row][] = [
      [[], {}],
      [[{ cohort: "A", month: 0, active: null }], {}],
      [[{ cohort: "A", month: 0, active: "n/a" }, { cohort: "", month: 1, active: 3 }, { cohort: "B", month: null, active: 2 }], {}],
      [[{ cohort: "A", month: 0, active: 5, size: 0 }, { cohort: "A", month: 1, active: 2, size: 0 }], { size: "size" }],
      [table({ A: [0, 0] }), { valueType: "count", show: "count" }],
      [[{ cohort: "A", month: 3, active: 0.4 }], { highlight: "A" }],
      [[{ cohort: "A", month: 0, active: -5 }, { cohort: "B", month: 0, active: 1e12 }], {}],
      [Array.from({ length: 2600 }, (_, month) => ({ cohort: "Only", month, active: 1 })), { width: 320 }],
    ];
    for (const [data, extra] of cases) {
      const h = draw(data, extra);
      const label = `${data.length} rows ${JSON.stringify(extra)}`;
      expect(h, label).not.toMatch(BAD);
      expect(frame().description ?? "", label).not.toMatch(BAD);
      for (const e of frame().events.slice(0, 40)) expect(`${e.label} ${e.formatted}`, label).not.toMatch(BAD);
    }
  });
});

describe("spec, server and suggestions", () => {
  const def = CHARTS.find((c) => c.type === "cohort")!;

  it("the server SVG is deterministic and draws the same cells as the browser chart", () => {
    const a = renderSpecToSVG(def.example, { width: 720, theme: "light" });
    expect(renderSpecToSVG(def.example, { width: 720, theme: "light" })).toBe(a);
    const browser = r(
      <ThemeProvider theme="light">
        <Chart spec={{ ...def.example, card: undefined }} width={672} animate={false} />
      </ThemeProvider>,
    );
    const cells = (s: string) => [...s.matchAll(/<path d="([^"]+)"[^>]*class="ztd-mark"/g)].map((m) => m[1]);
    expect(cells(browser)).toHaveLength(44);
    expect(cells(renderSpecToSVG({ ...def.example, card: undefined }, { width: 672 + 48, frame: false, theme: "light" }))).toEqual(cells(browser));
  });

  it("the example, the Korean sample, the variants and the aliases validate cleanly", () => {
    const issues = (s: unknown) => [...validateSpec(s).errors, ...validateSpec(s).warnings].map((i) => i.code);
    expect(issues(def.example)).toEqual([]);
    expect(issues({ ...def.example, data: cohortSampleKo })).toEqual([]);
    for (const id of ["counts", "no-average", "no-values"]) expect(issues(variantSpec(def, id)), id).toEqual([]);
    for (const alias of ["retention", "cohortTable", "retentionTable"]) expect(issues({ ...def.example, type: alias }), alias).toEqual(["alias"]);
    expect(variantSpec(def, "counts")!.options).toMatchObject({ show: "count" });
    expect(variantSpec(def, "no-average")!.options).toMatchObject({ average: false });
    expect(variantSpec(def, "no-values")!.options).toMatchObject({ showValues: false });
  });

  it("suggest: a cohort column, a small whole-number period column from 0 and a number column suggest a cohort chart first at 0.95", () => {
    const [top] = suggestCharts(cohortSample).suggestions;
    expect(top).toMatchObject({ type: "cohort", score: 0.95 });
    expect(top.spec.encoding).toEqual({ cohort: "cohort", period: "month", value: "active" });
    expect(validateSpec(top.spec).errors).toEqual([]);
    // Without a cohort-like name there is no cohort suggestion
    const renamed = cohortSample.map(({ cohort, ...rest }) => ({ group: cohort, ...rest }));
    expect(suggestCharts(renamed).suggestions.map((s) => s.type)).not.toContain("cohort");
  });
});
