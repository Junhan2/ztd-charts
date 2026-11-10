import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarHeatmap } from "../src/charts/calendar";
import { FunnelChart } from "../src/charts/funnel";
import { Heatmap } from "../src/charts/heatmap";
import { DonutChart, PieChart } from "../src/charts/pie";
import { allocateCells } from "../src/charts/waffle";
import { chordLayout } from "../src/layout/chord";
import { squarify } from "../src/layout/hierarchy";
import { sankeyLayout } from "../src/layout/sankey";
import { textWidth } from "../src/core/text";
import { renderSpecToSVG } from "../src/server";
import { darkTheme } from "../src/theme/tokens";

const paths = (html: string) => [...html.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);

describe("part-to-whole and flow fixes", () => {
  it("funnel draws each repeated stage label at its own width", () => {
    const data = [{ stage: "Visit", users: 1000 }, { stage: "Step", users: 600 }, { stage: "Step", users: 100 }];
    const html = renderToStaticMarkup(<FunnelChart data={data} label="stage" value="users" width={480} animate={false} />);
    const bars = paths(html).filter((d) => d.startsWith("M") && !d.includes("C"));
    expect(new Set(bars).size).toBe(bars.length);
  });

  it("funnel keeps a stage larger than the first inside the chart", () => {
    const html = renderToStaticMarkup(<FunnelChart data={[{ s: "a", n: 100 }, { s: "b", n: 300 }]} label="s" value="n" width={480} animate={false} />);
    const xs = paths(html).flatMap((d) => [...d.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0])));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
  });

  it("chord gives a node that only receives its own arc", () => {
    const { groups } = chordLayout([[0, 10, 5], [0, 0, 0], [0, 0, 0]]);
    expect(groups.map((g) => g.value)).toEqual([15, 10, 5]);
    for (const g of groups) expect(g.a1 - g.a0).toBeGreaterThan(0);
  });

  it("sankey ignores the link that closes a cycle when it sets depths", () => {
    const { nodes } = sankeyLayout([], [{ source: "A", target: "B", value: 1 }, { source: "B", target: "C", value: 1 }, { source: "C", target: "A", value: 1 }], { width: 600, height: 300 });
    expect(Object.fromEntries(nodes.map((n) => [n.id, n.depth]))).toEqual({ A: 0, B: 1, C: 2 });
  });

  it("waffle never hands out more cells than the total", () => {
    expect(allocateCells([60, 60], 100, 100).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("squarify still covers the box exactly", () => {
    const rects = squarify([6, 6, 4, 3, 2, 2, 1], { x: 0, y: 0, w: 600, h: 400 });
    expect(rects.reduce((a, r) => a + r.w * r.h, 0)).toBeCloseTo(240000, 6);
  });

  it("donut legend rows stay inside the chart with many slices", () => {
    const data = Array.from({ length: 12 }, (_, i) => ({ label: `s${i}`, value: 12 - i }));
    const html = renderToStaticMarkup(<DonutChart data={data} width={480} animate={false} />);
    const vb = /viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(html);
    const ys = [...html.matchAll(/<text[^>]* y="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(Number(vb?.[1]));
  });

  it("pie keeps outside labels inside the chart width", () => {
    const W = 240;
    const html = renderToStaticMarkup(<PieChart width={W} animate={false} labelMode="label" data={[{ label: "Big", value: 20 }, { label: "Television", value: 3 }, { label: "Rest", value: 77 }]} />);
    const texts = [...html.matchAll(/<text x="([\d.-]+)" y="[\d.-]+"[^>]*font-size="([\d.]+)"[^>]*text-anchor="(\w+)"[^>]*font-weight="(\d+)"[^>]*>([^<]*)<\/text>/g)];
    expect(texts.length).toBeGreaterThan(0);
    for (const m of texts) {
      const w = textWidth(m[5], Number(m[2]), Number(m[4]));
      const right = m[3] === "start" ? Number(m[1]) + w : m[3] === "middle" ? Number(m[1]) + w / 2 : Number(m[1]);
      expect(right).toBeLessThanOrEqual(W);
    }
  });
});

describe("gauge", () => {
  it("reads as empty with no rows and no value", async () => {
    const { GaugeChart } = await import("../src/charts/radial");
    const html = renderToStaticMarkup(<GaugeChart data={[]} width={320} animate={false} />);
    expect(html).toMatch(/No data\.|데이터가 없어요/);
  });
});

describe("axis tick fallback", () => {
  it("keeps the chart's locale when rounded tick labels collide", async () => {
    const { tickLabels } = await import("../src/core/axis");
    expect(tickLabels([0, 0.25, 0.5], (v) => String(Math.round(v)), "de-DE")).toEqual(["0", "0,25", "0,5"]);
  });
});

describe("leftover chart edges", () => {
  it("sparkline with no values reads as empty", async () => {
    const { Sparkline } = await import("../src/charts/sparkline");
    const html = renderToStaticMarkup(<Sparkline data={[{ v: null }, { v: null }]} y="v" width={200} animate={false} />);
    expect(html).not.toContain("high 1");
  });
  it("calendar keeps a missing day missing in the table", async () => {
    const { CalendarHeatmap } = await import("../src/charts/calendar");
    const html = renderToStaticMarkup(<CalendarHeatmap data={[{ date: "2024-03-01", value: 5 }, { date: "2024-03-02", value: null }]} width={480} animate={false} />);
    const cells = [...html.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]);
    expect(cells).toContain("-");
    expect(cells).not.toContain("0");
  });
  it("candlestick reads four-digit year strings as labels", async () => {
    const { CandlestickChart } = await import("../src/charts/candlestick");
    const html = renderToStaticMarkup(<CandlestickChart data={[{ date: "2020", open: 1, high: 2, low: 0.5, close: 1.5 }, { date: "2021", open: 1.5, high: 2.5, low: 1, close: 2 }]} width={480} animate={false} />);
    expect(html).not.toContain("Jan 1, 2020");
  });
});

describe("locale and date labels", () => {
  it("reads ko_KR as Korean", async () => {
    const { langOf } = await import("../src/core/i18n");
    expect(langOf("ko_KR")).toBe("ko");
  });
  it("slope names Date periods by day, not by Date.toString", async () => {
    const { SlopeChart } = await import("../src/charts/slope");
    const data = [{ k: "a", x: new Date(2024, 0, 1), v: 1 }, { k: "a", x: new Date(2024, 5, 1), v: 3 }];
    const html = renderToStaticMarkup(<SlopeChart data={data} label="k" x="x" value="v" width={480} animate={false} />);
    expect(html).not.toContain("GMT");
    expect(html).toContain("2024-01-01");
  });
});

describe("색 척도 옵션: 뒤집기, 가운데 값, 단계 (차례 2 ⑬)", () => {
  const cellOpacity = (html: string) => [...html.matchAll(/<path d="[^"]*" fill="([^"]*)" opacity="([\d.]+)" class="ztd-mark"/g)].map((m) => ({ fill: m[1], opacity: +m[2] }));
  const heat = (vals: number[], props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(<Heatmap data={vals.map((v, i) => ({ x: `c${i}`, y: "r", v }))} x="x" y="y" value="v" width={480} animate={false} {...props} />);
  it("colorReverse면 1위(가장 작은 값)가 가장 진해요", () => {
    const cells = cellOpacity(heat([1, 2, 3, 4], { colorReverse: true }));
    expect(cells[0].opacity).toBe(1);
    expect(cells[3].opacity).toBeCloseTo(0.08, 5);
  });
  it("colorReverse면 기본 강조(테두리)도 가장 작은 값으로 가고, highlight를 주면 그걸 따라요", () => {
    const vals = [3, 1, 4, 2];
    expect(heat(vals, { colorReverse: true })).toBe(heat(vals, { colorReverse: true, highlight: "min" }));
    expect(heat(vals, { colorReverse: true })).not.toBe(heat(vals, { colorReverse: true, highlight: "max" }));
    expect(heat(vals)).toBe(heat(vals, { highlight: "max" }));
    // 캘린더: 데이터가 없는 날(0)이 아니라 가장 작은 실제 값이 강조돼요
    const cal = (props: Record<string, unknown>) => renderToStaticMarkup(<CalendarHeatmap data={[{ date: "2024-03-01", value: 7 }, { date: "2024-03-05", value: 2 }, { date: "2024-03-09", value: 9 }]} width={480} animate={false} {...props} />);
    const outlined = (html: string) => [...html.matchAll(/<rect [^>]*stroke="var\(--ztd-ink[^"]*"[^>]*>/g)].length;
    expect(outlined(cal({ colorReverse: true }))).toBe(1);
    expect(cal({ colorReverse: true })).toBe(cal({ colorReverse: true, highlight: "2024-03-05" }));
  });
  it("colorCenter: 0보다 작은 칸은 회색, 같은 크기면 같은 진하기 (SVG 내보내기도 테마 색으로)", () => {
    const cells = cellOpacity(heat([-4, -2, 2, 4], { colorCenter: 0 }));
    expect(cells.map((c) => (c.fill.startsWith("var(--ztd-neutral-strong") ? "gray" : c.fill.startsWith("var(--ztd-accent") ? "accent" : c.fill))).toEqual(["gray", "gray", "accent", "accent"]);
    expect(cells[0].opacity).toBeCloseTo(cells[3].opacity, 5);
    expect(cells[1].opacity).toBeCloseTo(cells[2].opacity, 5);
    const svg = renderSpecToSVG({ type: "heatmap", data: [-4, 4].map((v, i) => ({ x: `c${i}`, y: "r", v })), encoding: { x: "x", y: "y", value: "v" }, options: { colorCenter: 0 } });
    expect(svg).toContain(`fill="${darkTheme.neutralStrong}"`);
  });
  it("colorSteps: 3이면 칸 진하기가 3가지, 범례도 3칸", () => {
    const html = heat([1, 2, 3, 4, 5, 6, 7, 8, 9], { colorSteps: 3 });
    expect(new Set(cellOpacity(html).map((c) => c.opacity)).size).toBe(3);
    expect(html.match(/<rect x="[\d.]+" y="3" width="12" height="9" rx="2"/g)).toHaveLength(3);
  });
  it("캘린더도 가운데 값보다 작은 날은 회색, 큰 날은 강조색이에요", () => {
    const html = renderToStaticMarkup(<CalendarHeatmap data={[{ date: "2024-03-01", value: -3 }, { date: "2024-03-02", value: 5 }]} colorCenter={0} width={480} animate={false} />);
    const fills = [...html.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" rx="[\d.]+" fill="([^"]*)"/g)].map((m) => m[1]);
    expect(fills.some((f) => f.startsWith("var(--ztd-neutral-strong"))).toBe(true);
    expect(fills.some((f) => f.startsWith("var(--ztd-accent"))).toBe(true);
  });
});
