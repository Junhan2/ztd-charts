import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { autoLegend, Chart } from "../src/charts/Chart";
import { Timeline } from "../src/charts/timeline";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { formatDuration } from "../src/core/format";
import { readTimeline, timelineRows } from "../src/layout/timeline";
import { renderSpecToSVG } from "../src/server";
import { CHARTS, suggestCharts, validateSpec } from "../src/spec";
import { timelineSample, timelineSampleKo, timelineScheduleSample } from "../src/spec/samples";
import { ThemeProvider } from "../src/theme/context";

/** tileMap.test.tsx와 같은 틀: active를 주면 고른 항목을, spy를 켜면 setActive 호출을 기록해요. frame은 마지막 ChartFrame props예요 */
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
const draw = (data: Row[], extra: Record<string, unknown> = {}) => r(<Timeline data={data} label="step" start="start" end="end" width={560} animate={false} {...extra} />);
const item = (step: string, start: unknown, end: unknown, extra: Row = {}) => ({ step, start, end, ...extra });
const BAD = /NaN|Infinity|undefined|\[object/;
/** 막대(rect, 줄 칸 rect 빼고)와 점(path) 수 */
const bars = (h: string) => (h.match(/<rect [^>]*class="ztd-mark"/g) ?? []).length;
const points = (h: string) => (h.match(/<path d="M[^"]*Z" [^>]*class="ztd-mark"/g) ?? []).length;
const tickLabels = (h: string) => [...h.matchAll(/<text [^>]*font-size="10.5"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

describe("reading and layout", () => {
  it("one bar per item; the same label shares a row; start equal to end is a point event", () => {
    const h = draw(timelineSample, { unit: " min" });
    expect(bars(h)).toBe(8);
    expect(points(h)).toBe(1);
    const ev = frame().events;
    expect(ev.map((e) => e.label)).toEqual(["Plan", "Search code", "Edit files", "Run tests", "Run tests", "Fix failing test", "Open PR", "Wait for CI", "Merged"]);
    expect(ev[2].formatted).toBe("8 min to 15 min, 7 min");
    expect(ev[8].formatted).toBe("43 min");
    expect(frame().description).toBe("Timeline. 9 items on 8 rows, from 0 min to 43 min. Longest: Wait for CI, 18 min.");
    expect(h).not.toMatch(BAD);
  });

  it("overlapping items on one row split into lanes; touching items share a lane; two points at one instant split", () => {
    const m = (data: Row[]) => timelineRows(readTimeline(data, { label: "step" }).items);
    const twenty = Array.from({ length: 20 }, (_, i) => item("Build", i, i + 30));
    expect(m(twenty).rows[0].lanes).toBe(20);
    expect(m([item("Strip", 0, 5), item("Strip", 5, 9), item("Strip", 9, 9)]).rows[0].lanes).toBe(1);
    expect(m([item("Deploy", 4, 4), item("Deploy", 4, 4)]).rows[0].lanes).toBe(2);
    const h = draw(twenty);
    const ys = new Set([...h.matchAll(/<rect x="[^"]*" y="([^"]*)"[^>]*class="ztd-mark"/g)].map((x) => x[1]));
    expect(ys.size).toBe(20);
  });

  it("dates: ISO, date-times, Korean, quarter and month-name forms and dayFirst go through the shared date reader", () => {
    const kinds = (data: Row[], o = {}) => {
      const t = readTimeline(data, { label: "step" }, o);
      return [t.kind, t.items.map((it) => new Date(it.start).toDateString())];
    };
    expect(kinds([item("a", "2026-03-05", "2026-03-09")])).toEqual(["date", ["Thu Mar 05 2026"]]);
    expect(kinds([item("a", "2026년 3월 5일", "2026년 3월 9일")])[1]).toEqual(["Thu Mar 05 2026"]);
    expect(kinds([item("a", "2024Q2", "2024Q3")])[1]).toEqual(["Mon Apr 01 2024"]);
    expect(kinds([item("a", "Mar 5, 2026", "Apr 2026")])[1]).toEqual(["Thu Mar 05 2026"]);
    expect(kinds([item("a", "05/03/2026", "06/03/2026")], { dayFirst: true })[1]).toEqual(["Thu Mar 05 2026"]);
    expect(kinds([item("a", 1, 5)])).toEqual(["number", ["Thu Jan 01 1970"]]);
  });

  it("date-only schedules count calendar days, also across a daylight-saving change and a leap day", () => {
    // 시간대를 바꿨다가 원래 시간대 이름으로 되돌려요. formatDate가 만든 Intl 포맷터는 그때 시간대를 기억해서, 이 시험만 쓰는 로캘(en-GB)로 그려 뒤 시험과 섞이지 않게 해요
    const tz = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.env.TZ = "America/New_York";
    try {
      const d = draw([item("DST", "2026-03-07", "2026-03-09"), item("Leap", "2024-02-28", "2024-03-01")], { locale: "en-GB" });
      expect(frame().events.map((e) => e.formatted)).toEqual(["7 Mar 2026 to 9 Mar 2026, 2 days", "28 Feb 2024 to 1 Mar 2024, 2 days"]);
      expect(d).not.toMatch(BAD);
    } finally {
      process.env.TZ = tz;
    }
  });

  it("durations are humanised by locale", () => {
    expect(["en-US", "de-DE", "ja-JP", "ko-KR"].map((l) => formatDuration(7 * 60000, l))).toEqual(["7 min", "7 Min.", "7 分", "7분"]);
    expect(formatDuration(52 * 3600000, "en-US")).toBe("2d 4h");
    expect(formatDuration(52 * 3600000, "ko-KR")).toBe("2일 4시간");
    expect([formatDuration(45000), formatDuration(120), formatDuration(86400000 * 365.25 * 30), formatDuration(NaN)]).toEqual(["45 sec", "120 ms", "30 yrs", "-"]);
  });

  it("tick labels fit spans from minutes to years in en-US, de-DE, ja-JP and ko-KR", () => {
    const at = (m: number) => new Date(2026, 10, 10, 9, m).toISOString();
    const spans: [string, Row[]][] = [
      ["5 minutes", [item("a", at(0), at(5))]],
      ["hours", [item("a", at(0), at(60 * 7))]],
      ["days", [item("a", "2026-11-01", "2026-11-09")]],
      ["months", [item("a", "2026-01-01", "2026-08-01")]],
      ["30 years", [item("a", "1996-01-01", "2026-01-01")]],
    ];
    for (const locale of ["en-US", "de-DE", "ja-JP", "ko-KR"])
      for (const [name, data] of spans) {
        const labels = tickLabels(draw(data, { locale }));
        expect(labels.length, `${locale} ${name}`).toBeGreaterThanOrEqual(2);
        expect(new Set(labels).size, `${locale} ${name}: ${labels}`).toBe(labels.length);
        expect(labels.join(" "), locale).not.toMatch(BAD);
      }
    expect(tickLabels(draw(spans[0][1], { locale: "en-US" }))).toContain("9:01 AM");
    // 해 단위는 둥근 해에: 30년은 5년마다, 4년은 해마다, 분기 데이터 2년은 달 단위(timeTicks)
    expect(tickLabels(draw(spans[4][1], { locale: "en-US" }))).toEqual(["2000", "2005", "2010", "2015", "2020", "2025"]);
    expect(tickLabels(draw([item("a", "2021-06-01", "2025-03-01")], { locale: "en-US" }))).toEqual(["2022", "2023", "2024", "2025"]);
    expect(tickLabels(draw([item("a", "2024Q1", "2025Q4")], { locale: "en-US" }))[0]).toMatch(/^(Jan|Apr) 2024$/);
  });

  it("plain-number axes use the compact tick format; tooltip and narration keep full numbers", () => {
    const h = draw([item("A", 0, 4.2e12), item("B", 1e12, 9e12)]);
    expect(tickLabels(h)).toContain("2T");
    expect(tickLabels(h).join(" ")).not.toContain("000,000");
    expect(frame().events[0].formatted).toBe("0 to 4,200,000,000,000, 4,200,000,000,000");
  });

  it("short items on a long axis keep a 3px bar, drawn from their true start, with the true duration", () => {
    const h = draw([item("Leap", "2024-02-28", "2024-03-01"), item("Long", "2024-01-01", "2026-12-31")]);
    const widths = [...h.matchAll(/<rect x="[^"]*" y="[^"]*" width="([\d.]+)"[^>]*class="ztd-mark"/g)].map((m) => +m[1]);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(3);
    expect(frame().events.find((e) => e.label === "Leap")!.formatted).toMatch(/, 2 days$/);
  });
});

describe("edge inputs", () => {
  it("never draws NaN, Infinity or undefined, and keeps what it can", () => {
    const cases: Row[][] = [
      [],
      [item("only", 3, 9)],
      [item("a", 5, 5), item("b", 5, 5)],
      [item("a", 0, 0), item("b", 0, 0)],
      [item("neg", -30, -5), item("pos", -2, 12)],
      [item("x", null, "n/a"), item("y", "Infinity", 4), item("z", Infinity, NaN), item("ok", 1, 2)],
      [item("dup", 1, 4), item("dup", 1, 4)],
      [item("🚀 Launch 🚀", 1, 2), item("عملية النشر", 2, 6), item("A very long step name that does not fit in the label column at all", 0, 9)],
      [item("mixed", 1, "2026-01-01"), item("mixed", "2026-01-02", "2026-01-05"), item("m2", "2026-01-03", "2026-01-04")],
    ];
    for (const data of cases)
      for (const w of [280, 390, 720]) {
        const h = draw(data, { width: w, referenceLines: [{ x: 3, label: "<b>Target</b>" }, { label: "no x" }, { x: "soon" }], now: 4 });
        expect(h, JSON.stringify(data)).not.toMatch(BAD);
        expect(h).not.toContain("<b>");
      }
    // 터무니없는 옵션 값
    const absurd: Row[] = [{ height: 0 }, { height: -50 }, { width: 1, height: 1e6 }, { sort: "bogus", xType: "band" }, { now: {}, referenceLines: "x" }, { stagger: -1, duration: 1e9 }, { highlight: ["nope", 99, -1] }, { hidden: "Design", group: "state" }];
    for (const o of absurd) expect(draw(timelineSample, o), JSON.stringify(o)).not.toMatch(BAD);
  });

  it("end before start is swapped, an empty end runs to now and is drawn open, a missing start is left out", () => {
    draw([item("swap", 9, 3), item("open", 2, null), item("nostart", null, 5), item("end", 0, 6)], { now: 8, unit: " min" });
    const ev = frame().events;
    expect(ev.map((e) => `${e.label}: ${e.formatted}`)).toEqual(["swap: 3 min to 9 min, 6 min", "open: 2 min to 8 min, 6 min", "end: 0 min to 6 min, 6 min"]);
    expect(draw([item("open", 2, ""), item("later", 1, 9)])).toMatch(/stroke-dasharray="3 2"/);
    // 혼자인 열린 항목은 이어 갈 곳이 없어서 점이에요
    expect(points(draw([item("open", 2, "")]))).toBe(1);
  });

  it("500 rows: a row height floor, thinned labels, and every row reachable by keyboard", () => {
    const data = Array.from({ length: 500 }, (_, i) => item(`Job ${i}`, i, i + 5));
    const h = draw(data);
    const height = Number(/viewBox="0 0 560 ([\d.]+)"/.exec(h)![1]);
    expect(height).toBeGreaterThanOrEqual(500 * 2);
    const names = [...h.matchAll(/>Job \d+</g)].length;
    expect(names).toBeGreaterThan(20);
    expect(names).toBeLessThan(500);
    expect(frame().events).toHaveLength(500);
  });
});

describe("interaction", () => {
  const press = (key: string, shiftKey = false) => frame().onKey!({ key, shiftKey } as never);

  it("up and down move between rows (nearest start), left and right between items of a row in time order", () => {
    state.spy = true;
    state.active = 3;
    state.via = "keyboard";
    draw(timelineSample, { unit: " min" });
    // 3번은 Run tests(15~18). 오른쪽은 같은 줄의 다음 Run tests(22~24), 왼쪽은 줄의 처음이라 그대로, 아래는 Fix failing test, 위는 Edit files
    for (const k of ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]) press(k);
    expect(state.calls).toEqual([4, 5, 2]);
    expect(frame().announce).toBe("Run tests, 15 min to 18 min, 3 min");
  });

  it("highlight: the longest item by default, a row label, or a group name", () => {
    const accentBars = (h: string) => (h.match(/fill="var\(--ztd-accent/g) ?? []).length;
    expect(accentBars(draw(timelineSample))).toBe(1);
    expect(accentBars(draw(timelineSample, { highlight: "Run tests" }))).toBe(2);
    const grouped = draw(timelineScheduleSample, { label: "task", group: "team", highlight: "Engineering" });
    expect(accentBars(grouped)).toBe(2);
  });

  it("a status strip: without group, status colors the segments (rarest state darkest) and makes the legend, with no default highlight", () => {
    const data = [item("api", 0, 40, { s: "up" }), item("api", 40, 46, { s: "down" }), item("api", 46, 120, { s: "up" }), item("web", 0, 70, { s: "up" }), item("web", 70, 75, { s: "degraded" }), item("web", 75, 120, { s: "up" })];
    const spec = { type: "timeline", data, encoding: { label: "step", start: "start", end: "end", status: "s" } };
    expect(autoLegend(spec, data, "en-US").map((l) => `${l.label}:${l.color}`)).toEqual(["down:ink", expect.stringMatching(/^degraded:/), "up:neutral"]);
    const h = draw(data, { status: "s" });
    expect(h).not.toMatch(/fill="var\(--ztd-accent/);
    expect(h.match(/<rect [^>]*fill="var\(--ztd-ink[^>]*class="ztd-mark"/g)).toHaveLength(1);
    // 숨기기도 status 값으로
    draw(data, { status: "s", hidden: ["up"] });
    expect(frame().events.map((e) => e.formatted)).toEqual(["40 to 46, 6, down", "70 to 75, 5, degraded"]);
  });

  it("legend from group, with hidden groups left out of the drawing and the legend", () => {
    const spec = { type: "timeline", data: timelineScheduleSample, encoding: { label: "task", start: "start", end: "end", group: "team" }, options: { hidden: ["Design"] } };
    expect(autoLegend(spec, timelineScheduleSample, "en-US").map((l) => l.label)).toEqual(["Product", "Engineering"]);
    expect(autoLegend(spec, timelineScheduleSample, "en-US", true).map((l) => l.label)).toEqual(["Product", "Design", "Engineering"]);
    // 묶음이 빈 행은 범례에 이름 없는 칸을 만들지 않아요
    const blank = [...timelineScheduleSample, { task: "Retro", start: "2026-04-20", end: "2026-04-21", team: "" }];
    expect(autoLegend({ ...spec, data: blank, options: {} }, blank, "en-US").map((l) => l.label)).toEqual(["Product", "Design", "Engineering"]);
    // 시작을 못 읽어 뺀 행의 묶음도 범례와 차트가 같은 색 자리를 써요
    const dropped = [{ task: "Ghost", start: null, end: "2026-01-02", team: "Ops" }, ...timelineScheduleSample];
    const legend = autoLegend({ ...spec, data: dropped, options: {} }, dropped, "en-US");
    const drawn = draw(dropped, { label: "task", group: "team" });
    expect(legend.map((l) => l.label)).toEqual(["Ops", "Product", "Design", "Engineering"]);
    // 첫 색(ink)은 막대가 없는 Ops 자리라 ink 막대가 없어요 (예전엔 Research가 ink였어요)
    expect(drawn.match(/<rect [^>]*fill="var\(--ztd-ink[^>]*class="ztd-mark"/g)).toBeNull();
    expect(draw(timelineScheduleSample, { label: "task", group: "team" }).match(/<rect [^>]*fill="var\(--ztd-ink[^>]*class="ztd-mark"/g)).toHaveLength(1);
    expect(drawn.match(/<rect [^>]*class="ztd-mark"/g)).toHaveLength(4);
    draw(timelineScheduleSample, { label: "task", group: "team", hidden: ["Design"] });
    expect(frame().events.map((e) => e.label)).toEqual(["Research", "Build", "Beta", "Launch"]);
  });

  it("brush turns on drag and keyboard zoom", () => {
    draw(timelineSample, { brush: "zoom" });
    expect(frame().onPointerDown).toBeTypeOf("function");
    draw(timelineSample);
    expect(frame().onPointerDown).toBeUndefined();
  });
});

describe("spec, server and validation", () => {
  const def = CHARTS.find((c) => c.type === "timeline")!;

  it("the server SVG is deterministic and draws the same bars as the browser chart", () => {
    const a = renderSpecToSVG(def.example, { width: 720, theme: "light" });
    expect(renderSpecToSVG(def.example, { width: 720, theme: "light" })).toBe(a);
    const browser = r(
      <ThemeProvider theme="light">
        <Chart spec={{ ...def.example, card: undefined }} width={672} animate={false} />
      </ThemeProvider>,
    );
    const rects = (s: string) => [...s.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"[^>]*class="ztd-mark"/g)].map((m) => m.slice(1).join(","));
    expect(rects(browser)).toHaveLength(8);
    expect(rects(renderSpecToSVG({ ...def.example, card: undefined }, { width: 672 + 48, frame: false, theme: "light" }))).toEqual(rects(browser));
  });

  it("suggest: a label with start and end dates suggests a timeline first, and the spec validates", () => {
    const [top] = suggestCharts(timelineScheduleSample).suggestions;
    expect(top.type).toBe("timeline");
    expect(top.spec.encoding).toEqual({ label: "task", start: "start", end: "end", group: "team" });
    expect(validateSpec(top.spec).errors).toEqual([]);
  });

  it("the example and the Korean sample validate cleanly; gantt is an alias; facet is not supported", () => {
    const issues = (s: unknown) => validateSpec(s).warnings.concat(validateSpec(s).errors).map((i) => i.code);
    expect(issues(def.example)).toEqual([]);
    expect(issues({ ...def.example, data: timelineSampleKo })).toEqual([]);
    expect(issues({ ...def.example, type: "gantt" })).toEqual(["alias"]);
    expect(validateSpec({ ...def.example, facet: { by: "step" } }).errors.map((e) => e.code)).toContain("facet_unsupported");
  });

  it("reports what the chart fixed or left out with stable codes", () => {
    const spec = (data: Row[], options: Row = {}) => ({ type: "timeline", data, encoding: { label: "step", start: "start", end: "end" }, options });
    const codes = (s: unknown, lang: "en" | "ko" = "en") => {
      const v = validateSpec(s, { lang });
      return [...v.errors.map((e) => `E ${e.code}`), ...v.warnings.map((w) => `W ${w.code}`)];
    };
    const data = [item("swap", 9, 3), item("open", 2, null), item("nostart", null, 5), item("bad", 1, "n/a"), item("mixed", 1, "2026-01-01"), item("d", 1, 2), item("d", 1, 2)];
    expect(codes(spec(data))).toEqual(["W timeline_end_before_start", "W timeline_open_end", "W timeline_missing_start", "W timeline_bad_end", "W timeline_mixed_kinds", "W timeline_duplicate"]);
    expect(validateSpec(spec(data), { lang: "ko" }).warnings[0].message).toBe("끝이 시작보다 앞인 항목 1개는 시작과 끝을 바꿔 그려요");
    const lines = spec([item("a", 0, 10)], { referenceLines: [{ x: 5, label: "ok" }, { x: 99 }, { label: "no x" }, { y: 3 }], now: "later" });
    expect(codes(lines)).toEqual(["E bad_reference_line", "E bad_reference_line", "E bad_now", "W reference_line_outside"]);
    expect(codes(spec([item("a", "2026-01-01", "2026-02-01")], { now: "2026-01-15" }))).toEqual([]);
    // 일, 월이 모호한 날짜는 start와 end 두 열을 함께 봐요 (차트의 dayFirstOf와 같은 규칙)
    expect(codes(spec([item("a", "05/03/2026", "06/03/2026")]))).toEqual(["W date_order_ambiguous"]);
    expect(codes(spec([item("a", "05/03/2026", "25/03/2026")]))).toEqual([]);
    expect(codes(spec([item("a", "05/03/2026", "06/03/2026")], { dayFirst: false }))).toEqual([]);
  });
});
