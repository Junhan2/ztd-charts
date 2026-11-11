import type { ReactElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BarRace } from "../src/charts/barRace";
import { Chart } from "../src/charts/Chart";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { textWidth } from "../src/core/text";
import { renderSpecToSVG } from "../src/server";
import { CHARTS, validateSpec } from "../src/spec";
import { barRaceSample, barRaceSampleKo } from "../src/spec/samples";
import { ThemeProvider } from "../src/theme/context";

/** tileMap.test.tsx와 같은 틀: active를 주면 고른 막대를, frame은 마지막 ChartFrame props예요 */
const state = vi.hoisted(() => ({ active: null as number | null, via: "pointer" as "pointer" | "keyboard", frame: null as unknown }));
vi.mock("../src/core/useChart", async (orig) => {
  const actual = await orig<typeof import("../src/core/useChart")>();
  return {
    ...actual,
    useChart: (props: never, d: never) => {
      const c = actual.useChart(props, d);
      return state.active === null ? c : { ...c, active: state.active, via: state.via };
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
  state.frame = null;
});

const r = (el: ReactElement) => renderToStaticMarkup(el);
const frame = () => state.frame as ChartFrameProps<unknown>;
type R = Record<string, unknown>;
const draw = (data: R[], extra: R = {}) => r(<BarRace data={data} label="brand" value="sales" frame="year" width={720} animate={false} {...extra} />);
/** 지금 보이는 막대: "이름=값" (순위 순) */
const bars = () => frame().events.map((e) => `${e.label}=${e.value}`);
const row = (brand: string, year: unknown, sales: unknown) => ({ brand, year, sales });
/** 시점 글자 (크게 깔리는 글자, 굵기 800, 크기 18 이상) */
const bigLabel = (h: string) => /<text [^>]*font-size="(?:1[89]|[2-7]\d)(?:\.\d+)?" [^>]*font-weight="800"[^>]*>([^<]*)<\/text>/.exec(h)?.[1];
const top = (year: number, n = 8) =>
  barRaceSample
    .filter((x) => x.year === year)
    .sort((a, b) => b.sales - a.sales)
    .slice(0, n)
    .map((x) => `${x.brand}=${x.sales}`);

describe("BarRace", () => {
  it("draws the top N of one frame in value order, the last frame unless startFrame picks one", () => {
    const h = draw(barRaceSample, { top: 8 });
    expect(bars()).toEqual(top(2026));
    expect(bigLabel(h)).toBe("2026");
    draw(barRaceSample, { top: 8, startFrame: 2020 });
    expect(bars()).toEqual(top(2020));
    draw(barRaceSample, { top: 8, startFrame: "2020" });
    expect(bars()).toEqual(top(2020));
    // 데이터에 없는 시점이면 마지막 시점
    draw(barRaceSample, { top: 8, startFrame: 1999 });
    expect(bars()).toEqual(top(2026));
    expect(frame().description).toBe("Bar race chart. 12 items ranked over 12 frames, from 2015 to 2026. At 2026, Lumen leads with 900.");
  });

  it("orders number and date frames by value, and mixed or text frames by first appearance", () => {
    const pick = (frames: unknown[], startFrame?: unknown) => bigLabel(draw(frames.map((f, i) => row("A", f, i + 1)), { startFrame }));
    expect(pick([2021, 2019, 2020])).toBe("2021");
    expect(pick([2021, 2019, 2020], 2019)).toBe("2019");
    expect(frame().description).toMatch(/from 2019 to 2021/);
    // 날짜 글자는 라인 차트와 같은 규칙(prepSeries)으로 로캘에 맞춰요
    expect(pick(["2024-03-01", "2024-01-01", "2024-02-01"])).toBe("3/1");
    expect(frame().description).toMatch(/from 1\/1 to 3\/1/);
    // 두 해에 걸친 달은 연도까지 (시점 글자가 겹치지 않게)
    expect(pick(["2023-12-01", "2024-12-01", "2024-01-01"])).toBe("Dec 2024");
    expect(pick(["b", 2, "a"])).toBe("a");
    expect(frame().description).toMatch(/from b to a/);
  });

  it("an item missing in a frame is absent there (not zero), then comes back without a rank-change mark", () => {
    const data = [row("A", 1, 5), row("B", 1, 4), row("C", 1, 3), row("A", 2, 5), row("C", 2, 3), row("B", 2, null), row("A", 3, 5), row("B", 3, 9), row("C", 3, 3)];
    draw(data, { startFrame: 2 });
    expect(bars()).toEqual(["A=5", "C=3"]);
    expect(frame().events[1].formatted).toBe("3, 2nd, up 1 place");
    draw(data, { startFrame: 3 });
    expect(bars()).toEqual(["B=9", "A=5", "C=3"]);
    expect(frame().events.map((e) => e.formatted)).toEqual(["9, 1st", "5, 2nd, down 1 place", "3, 3rd, down 1 place"]);
  });

  it("ties keep the order of first appearance in every frame, so they do not swap", () => {
    const data = [row("A", 1, 5), row("B", 1, 5), row("B", 2, 7), row("A", 2, 7), row("B", 3, 1), row("A", 3, 1)];
    for (const f of [1, 2, 3]) {
      draw(data, { startFrame: f });
      expect(frame().events.map((e) => e.label), String(f)).toEqual(["A", "B"]);
    }
    expect(frame().events.map((e) => e.formatted)).toEqual(["1, 1st", "1, 2nd"]);
  });

  it("narration names the frame, item, place, value and move, in the locale's words", () => {
    state.via = "keyboard";
    state.active = 3;
    draw(barRaceSample, { top: 8 });
    expect(frame().announce).toBe("2026, Vertex, 4th, 512, up 3 places");
    expect(frame().tip!.rows.map((x) => `${x.label}=${x.value}`)).toEqual(["2026=512", "Rank=4th (up 3 places)"]);
    draw(barRaceSampleKo, { top: 8, locale: "ko-KR" });
    expect(frame().announce).toBe("2026, 버텍스, 4위, 512, 3계단 오름");
    // 키보드로 고르지 않았고 넘겨 보지도 않았으면 읽지 않아요 (재생 중에도)
    state.active = null;
    draw(barRaceSample);
    expect(frame().announce).toBe("");
    // 영어 서수: 11th, 12th, 13th, 21st, 22nd
    const many = Array.from({ length: 23 }, (_, i) => row(`I${i}`, 1, 100 - i));
    draw(many, { top: 23 });
    expect([10, 11, 12, 20, 21, 22].map((i) => frame().events[i].formatted!.split(", ")[1])).toEqual(["11th", "12th", "13th", "21st", "22nd", "23rd"]);
  });

  it("highlight stays with the item by name in every frame; the default is the last frame's leader", () => {
    const accent = (extra: R) => {
      draw(barRaceSample, { top: 12, ...extra });
      return frame().events.map((e, i) => {
        state.active = i;
        draw(barRaceSample, { top: 12, ...extra });
        return String(frame().tip!.rows[0].color).startsWith("var(--ztd-accent,") ? e.label : null;
      }).filter(Boolean);
    };
    const light = (extra: R) => {
      state.active = null;
      return accent(extra);
    };
    expect(light({})).toEqual(["Lumen"]);
    // 2015년 Lumen은 10위지만 강조는 그대로 Lumen이에요 (순위가 아니라 이름)
    expect(light({ startFrame: 2015 })).toEqual(["Lumen"]);
    expect(frame().events.findIndex((e) => e.label === "Lumen")).toBe(9);
    expect(light({ highlight: "Aurora", startFrame: 2015 })).toEqual(["Aurora"]);
    expect(light({ highlight: "Aurora", startFrame: 2020 })).toEqual(["Aurora"]);
    expect(light({ highlight: "none" })).toEqual([]);
  });

  it("negative, zero, non-numeric, infinite and missing values never draw NaN", () => {
    const data = [row("Gain", 1, 12), row("Flat", 1, 0), row("Loss", 1, -8), row("Bad", 1, "n/a"), row("Inf", 1, Infinity), row("None", 1, null), row("Gain", 2, -3), row("Loss", 2, 4), row("Flat", 2, 0)];
    for (const f of [1, 2]) {
      const h = draw(data, { startFrame: f });
      expect(h, String(f)).not.toMatch(/NaN|Infinity|undefined/);
    }
    expect(bars()).toEqual(["Loss=4", "Flat=0", "Gain=-3"]);
    draw(data, { startFrame: 1 });
    expect(bars()).toEqual(["Gain=12", "Flat=0", "Loss=-8"]);
    // 모두 0, 빈 데이터, 이름 없는 행
    expect(draw([row("A", 1, 0), row("B", 1, 0)])).not.toMatch(/NaN/);
    expect(draw([])).not.toMatch(/NaN|role="slider"/);
    expect(frame().events).toEqual([]);
    draw([{ year: 1, sales: 3 }]);
    expect(frame().events).toEqual([]);
  });

  it("rows with the same frame and label add up, unless aggregate says otherwise", () => {
    const data = [row("A", 1, 2), row("A", 1, 3), row("B", 1, 4)];
    draw(data);
    expect(bars()).toEqual(["A=5", "B=4"]);
    draw(data, { aggregate: "last" });
    expect(bars()).toEqual(["B=4", "A=3"]);
  });

  it("absurd top and stepMs values fall back or clamp, and never throw", () => {
    const count = (t: unknown) => (draw(barRaceSample, { top: t }), frame().events.length);
    expect([0, -3, NaN, "5", undefined].map(count)).toEqual([10, 10, 10, 10, 10]);
    expect([1, 2.6, 12, 1e6].map(count)).toEqual([1, 3, 12, 12]);
    for (const stepMs of [0, -1, 1e12, NaN, "fast"]) expect(() => draw(barRaceSample, { stepMs, autoplay: true })).not.toThrow();
  });

  it("one frame draws ranked bars without the controls; two or more frames get play and a frame slider", () => {
    const one = draw([row("A", 2025, 3), row("B", 2025, 5)]);
    expect(bars()).toEqual(["B=5", "A=3"]);
    expect(one).not.toMatch(/role="slider"|aria-label="Play"/);
    expect(draw([row("Solo", 1, 3)])).not.toMatch(/NaN/);
    const two = draw([row("A", 1, 3), row("A", 2, 5)]);
    expect(two).toMatch(/aria-label="Play"/);
    expect(two).toMatch(/role="slider"[^>]*aria-valuemax="1" aria-valuenow="1" aria-valuetext="2"/);
    // 정적 그림에는 단추가 없어요 (SVG 밖 HTML)
    const ex = CHARTS.find((c) => c.type === "barRace")!.example;
    expect(renderSpecToSVG(ex)).not.toMatch(/<button|role="slider"/);
  });

  it("the slider handle sits on the track's centre line whatever box-sizing the page uses", () => {
    const h = draw([row("A", 1, 3), row("A", 2, 5), row("A", 3, 4)], { startFrame: 2 });
    const spans = [...h.slice(h.indexOf('role="slider"')).matchAll(/<span style="([^"]+)"/g)].slice(0, 3).map((m) => m[1]);
    const num = (s: string, k: string) => Number(new RegExp(`(?:^|;)${k}:(-?[\\d.]+)px`).exec(s)?.[1]);
    const [track, , handle] = spans;
    // 테두리를 넣은 크기로 정해 두어서 content-box 페이지와 border-box 페이지에서 같아요
    expect(handle).toContain("box-sizing:border-box");
    expect(num(handle, "top") + num(handle, "height") / 2).toBe(num(track, "top") + num(track, "height") / 2);
    // 가로 가운데는 값 자리 (가운데 시점 50%)
    expect(handle).toContain(`left:calc(50% - ${num(handle, "width") / 2}px)`);
  });

  it("long, right-to-left and emoji labels are cut to the label column at narrow widths", () => {
    const names = ["International Business Machines Corporation of America", "شركة الاتصالات السعودية المتحدة", "🚀🚀🚀 Rocket Launch Brand", "東京都中央区の長い会社名株式会社"];
    for (const width of [280, 390]) {
      const h = r(<BarRace data={names.map((n, i) => row(n, 1, 100 - i * 10))} label="brand" value="sales" frame="year" width={width} animate={false} />);
      expect(h).not.toMatch(/NaN/);
      const xs = [...h.matchAll(/<text x="([-\d.]+)"/g)].map((m) => +m[1]);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs)).toBeLessThanOrEqual(width);
      expect(h).toContain("…");
    }
  });

  it("the frame label never overlaps a bar, value or rank mark in any frame, and keeps one size and place", () => {
    type Box = { x0: number; x1: number; y0: number; y1: number };
    const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    const n = (x: string | undefined) => Number(x ?? 0);
    const attr = (tag: string, k: string) => new RegExp(`\\s${k}="([^"]*)"`).exec(tag)?.[1];
    /** 그린 그림에서 시점 글자 상자와, 그 밖의 막대, 값, 순위 표시 상자 */
    const boxes = (h: string, label: string) => {
      let big: (Box & { key: string }) | null = null;
      const others: Box[] = [];
      for (const m of h.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)) {
        const [tag, text] = [m[1], m[2]];
        const x = n(attr(tag, "x"));
        const y = n(attr(tag, "y"));
        const size = n(attr(tag, "font-size"));
        const w = textWidth(text, size, n(attr(tag, "font-weight")));
        if (text === label && size >= 18) big = { x0: x - w, x1: x, y0: y - size * 0.74, y1: y + size * 0.08, key: `${x},${y},${size}` };
        else if (attr(tag, "text-anchor") === "start") others.push({ x0: text.length <= 3 && /^\d+$/.test(text) ? x - 9 : x, x1: x + w, y0: y - size / 2, y1: y + size / 2 });
      }
      // 막대: roundRectPath는 "M{왼쪽+모서리},{위}H{오른쪽-모서리}"로 시작하고, 첫 V가 오른쪽 아래 모서리 앞이에요
      for (const m of h.matchAll(/<path d="M([\d.]+),([\d.]+)H([\d.]+)A[^V]*V([\d.]+)/g)) others.push({ x0: n(m[1]) - 4, x1: n(m[3]) + 4, y0: n(m[2]), y1: n(m[4]) + 4 });
      return { big, others };
    };
    const ties = [2015, 2016, 2017, 2018].flatMap((f) => ["Vertex", "Nimbus", "Atlas", "Quanta", "Helix", "Orbit"].map((b) => row(b, f, 100)));
    const solo = [2015, 2016, 2017, 2018, 2019].map((f, i) => row("Solo", f, 120 + i * 16));
    const cases: [string, R[], number, R][] = [
      ["ties", ties, 720, {}],
      ["one item", solo, 720, {}],
      ["sample at 390px", barRaceSample, 390, { top: 8 }],
      ["sample at 720px", barRaceSample, 720, { top: 8 }],
    ];
    for (const [name, data, width, extra] of cases) {
      const frames = [...new Set(data.map((d) => d.year as number))];
      const keys = new Set<string>();
      for (const f of frames) {
        const h = draw(data, { width, startFrame: f, ...extra });
        const { big, others } = boxes(h, String(f));
        expect(big, `${name} ${f}: frame label drawn`).not.toBeNull();
        keys.add(big!.key);
        for (const o of others) expect(hit(big!, o), `${name} ${f}: label ${JSON.stringify(big)} hits ${JSON.stringify(o)}`).toBe(false);
      }
      expect([...keys], `${name}: one size and place in every frame`).toHaveLength(1);
    }
  });

  it("1,000 items with top 10 over 500 frames draws only 10 bars", () => {
    const data: R[] = [];
    for (let f = 0; f < 500; f++) for (let i = 0; i < 1000; i++) data.push(row(`Item ${i}`, 2000 + f, ((i * 7919 + f * 104729) % 1000) + i / 1000));
    const t0 = performance.now();
    const h = draw(data, { top: 10 });
    const ms = performance.now() - t0;
    expect(frame().events).toHaveLength(10);
    expect(h).toMatch(/aria-valuemax="499" aria-valuenow="499"/);
    expect(ms).toBeLessThan(3000);
  });

  it("server markup is the same with motion on or off, and matches the static SVG frame", () => {
    const ex = CHARTS.find((c) => c.type === "barRace")!.example;
    const spec = { ...ex, card: undefined, options: { ...ex.options, startFrame: 2019 } };
    const svgOf = (h: string) => /<svg[^>]*class="ztd-svg"[^>]*>([\s\S]*?)<\/svg>/.exec(h)?.[1];
    const html = (animate?: boolean) => renderToString(<ThemeProvider theme="light" cssVars={false}><Chart spec={spec} width={672} animate={animate} /></ThemeProvider>);
    const on = svgOf(html());
    expect(on).toBeTruthy();
    expect(on).toBe(svgOf(html(false)));
    // 독립 SVG의 차트 몸통은 같은 마크업이에요 (useId 값만 그 렌더의 것)
    const stat = renderSpecToSVG(spec, { theme: "light", width: 720, padding: 24 });
    const strip = (s: string) => s.replace(/«[^»]*»|:r[0-9a-z]+:|_r_[0-9a-z]+_|r[0-9a-z]+c\b/g, "ID");
    expect(strip(stat)).toContain(strip(on!));
  });
});

describe("barRace spec checks", () => {
  const codes = (spec: R) => {
    const v = validateSpec(spec);
    return [...v.errors.map((e) => e.code), ...v.warnings.map((w) => `!${w.code}`)];
  };
  const base = { type: "barRace", data: barRaceSample, encoding: { label: "brand", value: "sales", frame: "year" } };
  it("reports one frame, an unknown startFrame, duplicates and out-of-range options with stable codes", () => {
    expect(codes(base)).toEqual([]);
    expect(codes({ ...base, options: { startFrame: 2020 } })).toEqual([]);
    expect(codes({ ...base, options: { startFrame: "2020" } })).toEqual([]);
    expect(codes({ ...base, options: { startFrame: 1999 } })).toEqual(["!frame_not_found"]);
    expect(codes({ ...base, data: [row("A", 1, 1), row("B", 1, 2)] })).toEqual(["!single_frame"]);
    const dup = validateSpec({ ...base, data: [row("A", 1, 1), row("A", 1, 2), row("A", 2, 2)] });
    expect(dup.warnings.map((w) => `${w.path}:${w.code}`)).toEqual(["encoding.frame:duplicate_x"]);
    expect(dup.warnings[0].message).toMatch(/^Rows with the same year and brand are added together/);
    expect(codes({ ...base, data: [row("A", 1, 1), row("A", 1, 2), row("A", 2, 2)], options: { aggregate: "last" } })).toEqual([]);
    expect(codes({ ...base, options: { top: 0, stepMs: -1, autoplay: "yes" } })).toEqual(["out_of_range", "out_of_range", "bad_option_type"]);
    expect(codes({ ...base, options: { highlight: "Nobody" } })).toEqual(["!highlight_not_found"]);
    expect(codes({ ...base, encoding: { label: "brand", value: "sales" } })).toEqual(["missing_channel"]);
  });
});
