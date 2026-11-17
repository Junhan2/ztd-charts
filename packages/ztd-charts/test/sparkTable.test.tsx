import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SparkTable } from "../src/charts/sparkTable";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { renderSpecToSVG } from "../src/server";
import { CHARTS, localizeDef, VARIANTS, variantSpec } from "../src/spec";
import { sparkTableSample } from "../src/spec/samples";
import { contrastRatio, mixHex } from "../src/theme/color";
import { darkTheme, lightTheme } from "../src/theme/tokens";

/** Same harness as timeline.test.tsx: active sets the picked row, spy records setActive calls. frame is the last ChartFrame props */
const state = vi.hoisted(() => ({
  active: null as number | null,
  via: "pointer" as "pointer" | "keyboard",
  spy: false,
  calls: [] as (number | null)[],
  frame: null as unknown,
}));
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
  state.frame = null;
});

const r = (el: ReactElement) => renderToStaticMarkup(el);
const frame = () => state.frame as ChartFrameProps<unknown>;
type Row = Record<string, unknown>;
const METRICS = { Revenue: { format: "currency" }, "Churn rate": { unit: "%", better: "down" }, "p95 response time": { unit: "ms", better: "down" } } as const;
const SAMPLE = { label: "metric", x: "week", value: "value", target: "target", metrics: METRICS };
const draw = (data: readonly Row[], extra: Record<string, unknown> = {}) => r(<SparkTable data={data} label="metric" x="week" value="value" width={720} animate={false} {...extra} />);
const sample = (extra: Record<string, unknown> = {}) => draw(sparkTableSample, { ...SAMPLE, ...extra });
const BAD = /NaN|Infinity|undefined|\[object/;
const texts = (h: string) => [...h.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const labels = () => frame().events.map((e) => e.label);
/** Change pills in row order: [pill fill, text fill, text] */
const pills = (h: string) => [...h.matchAll(/<rect [^>]*height="18" rx="9" fill="([^"]+)"><\/rect><text [^>]*fill="([^"]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => [m[1], m[2], m[3]]);
const WEEKS = ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27", "2026-08-03"];
const SPARK = CHARTS.find((c) => c.type === "sparkTable")!;

/** Replaces only the period state (useState(-1)) of sparkTable.tsx with a fixed value and records what the chart sets it to */
async function withPeriod(period: number, run: (mod: typeof import("../src/charts/sparkTable"), calls: number[]) => void) {
  const calls: number[] = [];
  vi.resetModules();
  vi.doMock("react", async (orig) => {
    const R = await orig<typeof import("react")>();
    return {
      ...R,
      useState: (init: unknown) => {
        const st = R.useState(init);
        return init === -1 && /sparkTable\.tsx/.test(new Error().stack?.split("\n")[2] ?? "") ? [period, (v: number) => void calls.push(v)] : st;
      },
    };
  });
  try {
    run(await import("../src/charts/sparkTable"), calls);
  } finally {
    vi.doUnmock("react");
    vi.resetModules();
  }
}

describe("layout", () => {
  it("drops the target column first, then the change column, when the trend column would get narrower than 64px", () => {
    const wide = texts(sample({ width: 720 }));
    expect(wide).toEqual(expect.arrayContaining(["7/6 to 9/21", "Latest", "Change", "Target", "$190,000.00", "+7.6%"]));
    const phone = texts(sample({ width: 390 }));
    expect(phone).toEqual(expect.arrayContaining(["Latest", "Change", "+7.6%"]));
    expect(phone).not.toContain("Target");
    expect(phone).not.toContain("$190,000.00");
    const narrow = texts(sample({ width: 260 }));
    expect(narrow).toContain("Latest");
    for (const gone of ["Target", "Change", "+7.6%"]) expect(narrow).not.toContain(gone);
    // The screen reader table keeps every column at every width
    expect(frame().events[0].formatted).toBe("$184,200.00 · +7.6% · Target $190,000.00");
  });

  it("one row per metric with a header row; the screen reader table is the metric table", () => {
    const h = sample();
    expect(labels()).toEqual(["Revenue", "Active users", "Churn rate", "p95 response time", "NPS", "Weekly signups"]);
    expect((h.match(/<th scope="row">/g) ?? []).length).toBe(6);
    expect(frame().description).toBe("KPI table. 6 rows over 12 periods, 7/6 to 9/21.");
    // Default height: header 24 + 6 rows × 32
    expect(h).toMatch(/viewBox="0 0 720 22\d"/);
    expect(texts(sample({ header: false }))).not.toContain("Latest");
  });

  it("an explicit height too small for every row shrinks the rows to fit, down to 20px, and leaves out the rows that still do not fit", () => {
    // Every drawn y stays inside the chart: texts, row lines and end dots (the README gallery's 150px tile drew rows 5 and 6 below it)
    const ys = (h: string) => [...h.matchAll(/ (?:y|y1|y2|cy)="([\d.]+)"/g)].map((m) => Number(m[1]));
    const tight = sample({ height: 150 });
    expect(tight).toMatch(/viewBox="0 0 720 150"/);
    expect(labels()).toHaveLength(6);
    expect(Math.max(...ys(tight))).toBeLessThanOrEqual(150);
    // 120px fits four rows of 23px; the description says how many were left out, as past 60 rows
    const tiny = sample({ height: 120 });
    expect(labels()).toEqual(["Revenue", "Active users", "Churn rate", "p95 response time"]);
    expect(frame().description).toBe("KPI table. 4 of 6 rows over 12 periods, 7/6 to 9/21.");
    expect(texts(tiny)).not.toContain("NPS");
    expect(Math.max(...ys(tiny))).toBeLessThanOrEqual(120);
    // A height with room to spare keeps rowHeight, the rows do not stretch: the second row line sits at 24 + 32
    expect(sample({ height: 400 })).toContain('y1="56.5"');
  });
});

describe("values and colors", () => {
  it("formats each row with its own metrics entry, and rows without one use the shared format and unit", () => {
    sample();
    expect(frame().events.map((e) => e.formatted)).toEqual([
      "$184,200.00 · +7.6% · Target $190,000.00",
      "48,310 · +17.3% · Target 50,000",
      "2.1% · -19.2% · Target 2%",
      "312ms · +11.4% · Target 300ms",
      "42 · +16.7% · Target 45",
      "3,905 · +14.2% · Target 4,000",
    ]);
    sample({ metrics: { NPS: { unit: " pts" } }, format: "integer" });
    const f = frame().events.map((e) => e.formatted?.split(" · ")[0]);
    expect(f).toEqual(["184,200", "48,310", "2", "312", "42 pts", "3,905"]);
    // change "previous" compares the last value with the one before it; "none" drops the column
    sample({ change: "previous" });
    expect(frame().events[0].formatted).toBe("$184,200.00 · -0.5% · Target $190,000.00");
    expect(texts(sample({ change: "previous" }))).toContain("vs. previous");
    const none = sample({ change: "none" });
    expect(texts(none)).not.toContain("Change");
    expect(pills(none)).toEqual([]);
    expect(texts(sample({ changeLabel: "Since July" }))).toContain("Since July");
  });

  it('a fall is the good direction for better: "down": accent pill for good moves, gray pill for the rest, no glyphs', () => {
    const p = pills(sample());
    expect(p.map((x) => x[2])).toEqual(["+7.6%", "+17.3%", "-19.2%", "+11.4%", "+16.7%", "+14.2%"]);
    const good = (x: string[]) => x[0].includes("color-mix") && x[0].includes("--ztd-accent,") && x[1].includes("--ztd-accent-text");
    const gray = (x: string[]) => x[0].includes("--ztd-line,") && x[1].includes("--ztd-muted");
    // Churn rate fell (better: "down"): good. p95 rose (better: "down"): worse
    expect(p.map(good)).toEqual([true, true, true, false, true, true]);
    expect(gray(p[3])).toBe(true);
    // The shared better flips rows without their own entry
    const flipped = pills(sample({ better: "down", metrics: {} }));
    expect(flipped.map(good)).toEqual([false, false, true, false, false, false]);
    expect(sample()).not.toMatch(/[▲▼△▽↑↓]/);
    // Pill text and highlighted lines keep their contrast in both themes (the pill is an opaque 14% accent mix, so a hovered row's background does not change it)
    for (const t of [lightTheme, darkTheme]) {
      expect(contrastRatio(t.accentText, mixHex(t.accent, t.panel, 0.14))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.muted, t.line)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.accent, t.panel)).toBeGreaterThanOrEqual(3);
    }
  });

  it('sort "none" keeps the data order, "value" puts the largest latest value first, "change" the best change first', () => {
    sample();
    expect(labels()).toEqual(["Revenue", "Active users", "Churn rate", "p95 response time", "NPS", "Weekly signups"]);
    sample({ sort: "value" });
    expect(labels()).toEqual(["Revenue", "Active users", "Weekly signups", "p95 response time", "NPS", "Churn rate"]);
    // A fall counts as a gain for better: "down" rows, so the only row that got worse comes last
    const h = sample({ sort: "change" });
    expect(labels()).toEqual(["Churn rate", "Active users", "NPS", "Weekly signups", "Revenue", "p95 response time"]);
    expect(frame().events.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(texts(h).filter((s) => labels().includes(s))).toEqual(labels());
  });

  it("highlight paints that row's line, area and end dot with the accent; the default highlights nothing", () => {
    const accentStroke = (h: string) => (h.match(/stroke="var\(--ztd-accent,[^"]*"/g) ?? []).length;
    expect(accentStroke(sample())).toBe(0);
    expect(accentStroke(sample({ highlight: "NPS" }))).toBe(1);
    expect(accentStroke(sample({ highlight: ["NPS", "Revenue"] }))).toBe(2);
  });

  it("value bars beside the values, relative to the largest; ignored when rows use different formats", () => {
    const bars = (h: string) => [...h.matchAll(/<rect [^>]*width="([\d.]+)" height="6" rx="3"/g)].map((m) => Number(m[1]));
    const same = draw(sparkTableSample.filter((d) => d.metric === "Active users" || d.metric === "Weekly signups"), { valueBar: true, sort: "value" });
    const w = bars(same);
    expect(w).toHaveLength(2);
    expect(w[1] / w[0]).toBeCloseTo(3905 / 48310, 1);
    expect(bars(sample({ valueBar: true }))).toEqual([]);
    // A row with no value keeps the other rows' bars (its own bar has no length)
    const empty = WEEKS.map((week) => ({ metric: "New metric", week, value: null }));
    const kept = bars(draw([...sparkTableSample.filter((d) => d.metric === "Active users" || d.metric === "Weekly signups"), ...empty], { valueBar: true, sort: "value" }));
    expect(kept.filter((x) => x > 0)).toEqual(w);
  });
});

describe("interaction and accessibility", () => {
  it("hovering a row selects it; inside the trend column the period follows the pointer", async () => {
    state.spy = true;
    state.active = 3;
    await withPeriod(-1, (mod, calls) => {
      const h = r(<mod.SparkTable data={sparkTableSample} {...SAMPLE} width={720} animate={false} />);
      // The range header starts where the first period is drawn
      const x0 = Number(/<text x="([\d.]+)"[^>]*>7\/6 to 9\/21<\/text>/.exec(h)?.[1]);
      expect(x0).toBeGreaterThan(100);
      const move = (x: number, y: number) => frame().onPointerMove!(x, y, { pointerType: "mouse" } as never);
      move(x0, 24 + 32 * 2 + 16);
      expect(state.calls).toEqual([2]);
      expect(calls).toEqual([0]);
      move(10, 24 + 32 * 5 + 16);
      expect(state.calls).toEqual([2, 5]);
      // Over the header: nothing is selected
      move(x0, 10);
      expect(state.calls).toEqual([2, 5, null]);
    });
  });

  it("left and right move the period on the selected row: the value column, tooltip and announcement follow it", async () => {
    state.active = 1;
    state.via = "keyboard";
    await withPeriod(4, (mod, calls) => {
      const h = r(<mod.SparkTable data={sparkTableSample} {...SAMPLE} width={720} animate={false} />);
      const f = frame();
      expect(f.announce).toBe("Active users, 8/3: 43,900");
      expect(f.tip).toMatchObject({ title: "Active users · 8/3", rows: [{ value: "43,900" }] });
      // Every row shows that period, and the value header names it
      expect(texts(h)).toEqual(expect.arrayContaining(["8/3", "$178,100.00", "43,900", "2.4%"]));
      expect(texts(h)).not.toContain("Latest");
      // A vertical line on every row at that period
      expect(h).toContain('class="ztd-guide"');
      const key = (k: string) => f.onKey!({ key: k } as never);
      expect(key("ArrowLeft")).toBe(true);
      expect(key("ArrowRight")).toBe(true);
      expect(calls).toEqual([3, 5]);
      // Up and down move rows, Escape clears the row (default handling) and the period resets with it
      expect(key("ArrowUp")).toBe(false);
      expect(key("Escape")).toBe(false);
    });
    // From the latest value, Right goes to the first period and Left to the last
    await withPeriod(-1, (mod, calls) => {
      r(<mod.SparkTable data={sparkTableSample} {...SAMPLE} width={720} animate={false} />);
      const key = (k: string) => frame().onKey!({ key: k } as never);
      key("ArrowRight");
      key("ArrowLeft");
      expect(calls).toEqual([0, 11]);
      // Without a period, keyboard selection reads the row's summary (default sentence)
      expect(frame().announce).toBeUndefined();
    });
    // Ends stop instead of wrapping
    await withPeriod(11, (mod, calls) => {
      r(<mod.SparkTable data={sparkTableSample} {...SAMPLE} width={720} animate={false} />);
      frame().onKey!({ key: "ArrowRight" } as never);
      expect(calls.filter((k) => k !== 11)).toEqual([]);
    });
  });

  it("with no row selected, left and right select the first row", async () => {
    state.spy = true;
    await withPeriod(-1, (mod, calls) => {
      r(<mod.SparkTable data={sparkTableSample} {...SAMPLE} width={720} animate={false} />);
      expect(frame().onKey!({ key: "ArrowLeft" } as never)).toBe(true);
      expect(state.calls).toEqual([0]);
      expect(calls).toEqual([11]);
    });
  });
});

describe("data edges", () => {
  it("draws the first 60 rows and says how many were left out", () => {
    const data = Array.from({ length: 75 }, (_, m) => WEEKS.slice(0, 3).map((week, w) => ({ metric: `Metric ${m + 1}`, week, value: m * 10 + w }))).flat();
    const h = draw(data);
    expect(frame().events).toHaveLength(60);
    expect(labels().at(-1)).toBe("Metric 60");
    expect(frame().description).toContain("60 of 75 rows");
    expect((h.match(/<th scope="row">/g) ?? []).length).toBe(60);
    expect(texts(h)).not.toContain("Metric 61");
    expect(h).not.toMatch(BAD);
  });

  it("skips empty values, draws a one-point row as a dot only, and shows a dash for a row with no value", () => {
    const data = [
      ...[10, null, 14, "", 13].map((value, w) => ({ metric: "Gaps", week: WEEKS[w], value })),
      { metric: "Single", week: WEEKS[2], value: 7 },
      { metric: "Empty", week: WEEKS[0], value: null },
    ];
    const h = draw(data);
    expect(frame().events.map((e) => [e.label, e.value, e.formatted])).toEqual([
      ["Gaps", 13, "13 · +30%"],
      ["Single", 7, "7 · 0%"],
      ["Empty", null, "-"],
    ]);
    // One line (the gaps are joined, as in Sparkline) and two end dots
    expect((h.match(/fill="none" stroke="[^"]+" stroke-width="1.6"/g) ?? []).length).toBe(1);
    expect((h.match(/<circle [^>]*r="3.2"/g) ?? []).length).toBe(2);
    expect(h).not.toMatch(BAD);
  });

  it("leaves no NaN or Infinity in the SVG: examples and variants in both languages and themes, one period, no values, narrow widths", () => {
    for (const def of [SPARK, localizeDef(SPARK, "ko")]) {
      for (const theme of ["light", "dark"] as const) {
        for (const width of [720, 390, 260]) expect(renderSpecToSVG(def.example, { width, theme }), `${def.name} ${width}`).not.toMatch(BAD);
        for (const v of VARIANTS.sparkTable) expect(renderSpecToSVG(variantSpec(def, v.id)!, { width: 640, theme }), v.id).not.toMatch(BAD);
      }
    }
    const one = draw(sparkTableSample.filter((d) => d.week === "2026-07-06"), SAMPLE);
    expect(one).not.toMatch(BAD);
    expect(frame().events[0].formatted).toBe("$171,200.00 · 0% · Target $190,000.00");
    const empty = draw([{ metric: "A", week: WEEKS[0], value: null }]);
    expect(empty).not.toMatch(BAD);
    expect(frame().events).toEqual([]);
    expect(draw([])).not.toMatch(BAD);
    expect(sample({ width: 120 })).not.toMatch(BAD);
  });
});
