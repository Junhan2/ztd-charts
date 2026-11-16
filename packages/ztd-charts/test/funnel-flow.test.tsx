import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FunnelChart, type FunnelChartProps } from "../src/charts/funnel";
import { renderSpecToSVG } from "../src/server";
import { CHARTS, validateSpec, variantSpec } from "../src/spec";

/**
 * The funnel's flow: "right": one column per stage (width ÷ stages) with a bar at its left, as tall as its share of the largest stage and centered,
 * and the curved bands between bars. Name and count sit above each bar, left-aligned to it, and each band carries its conversion rate in a pill.
 * When a column is narrower than its bar + pill + 16px, the chart draws the "down" shape instead
 */

type Row = { stage: string; users: number };
const STAGES: Row[] = [
  { stage: "Visit", users: 10000 },
  { stage: "Product view", users: 6200 },
  { stage: "Cart", users: 1900 },
  { stage: "Checkout", users: 1200 },
  { stage: "Payment", users: 900 },
  { stage: "Purchase", users: 760 },
];
const draw = (width: number, extra: Partial<FunnelChartProps<Row>> = {}, data = STAGES) =>
  renderToStaticMarkup(<FunnelChart data={data} label="stage" value="users" width={width} animate={false} {...extra} />);
const texts = (h: string) =>
  [...h.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*? font-weight="(\d+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: +m[1], y: +m[2], weight: +m[3], text: m[4] }));
/** Conversion pills: 18px tall rects with fully rounded ends */
const pills = (h: string) =>
  [...h.matchAll(/<rect ([^>]*)>/g)]
    .map((m) => m[1])
    .filter((a) => / height="18"/.test(a) && / rx="9"/.test(a))
    .map((a) => ({ x: +/(?:^| )x="([-\d.]+)"/.exec(a)![1], w: +/ width="([-\d.]+)"/.exec(a)![1], stroke: / stroke="([^"]+)"/.exec(a)![1] }));
const isRate = (t: { text: string }) => /%$/.test(t.text);

/** Same summary as the structure snapshot in render.test.tsx */
function summarize(svg: string) {
  const count = (re: RegExp) => (svg.match(re) ?? []).length;
  return { paths: count(/<path /g), rects: count(/<rect /g), circles: count(/<circle /g), lines: count(/<line /g), sha1: createHash("sha1").update(svg).digest("hex").slice(0, 12) };
}

describe("funnel flow right", () => {
  it("draws one pill per band (stages - 1), and only the pill into the highlighted stage has the accent border and bold text", () => {
    const h = draw(900, { flow: "right" });
    const col = 900 / STAGES.length;
    const ps = pills(h);
    expect(ps).toHaveLength(STAGES.length - 1);
    // The default highlight is the lowest conversion, Cart (31% of Product view), so the second pill is the accent one
    expect(ps.map((p) => p.stroke.includes("--ztd-accent"))).toEqual([false, true, false, false, false]);
    expect(ps.filter((p) => p.stroke.includes("--ztd-line"))).toHaveLength(4);
    // Each pill sits on the band leaving column k, clear of both bars (bars are at most 34px wide)
    ps.forEach((p, k) => {
      expect(p.x).toBeGreaterThan(k * col + 34);
      expect(p.x + p.w).toBeLessThan((k + 1) * col);
    });
    const rates = texts(h).filter(isRate);
    expect(rates.map((t) => t.text)).toEqual(["62%", "31%", "63%", "75%", "84%"]);
    expect(rates.map((t) => t.weight > 600)).toEqual([false, true, false, false, false]);
    // Names start at each column's left edge, where its bar is
    expect(texts(h).filter((t) => STAGES.some((s) => s.stage === t.text)).map((t) => t.x)).toEqual(STAGES.map((_, k) => k * col));
    // The four-stage example has three bands
    expect(pills(draw(720, { flow: "right" }, STAGES.slice(0, 4)))).toHaveLength(3);
  });

  it("six stages at 390px leave no room for bar + pill + 16px and draw exactly the down picture", () => {
    const down = draw(390);
    expect(draw(390, { flow: "right" })).toBe(down);
    expect(draw(390, { flow: "down" })).toBe(down);
    // Wide enough, it is another picture, and a shorter one
    const wide = draw(900, { flow: "right" });
    expect(wide).not.toBe(draw(900));
    expect(pills(draw(390, { flow: "right" }))).toHaveLength(0);
    const height = (h: string) => +/<svg[^>]* viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(h)![1];
    expect(height(wide)).toBeLessThan(height(draw(900)));
    // Zero stages and a single stage draw no NaN
    for (const data of [STAGES.map((s) => ({ ...s, users: 0 })), STAGES.slice(0, 1), []]) expect(draw(900, { flow: "right" }, data)).not.toMatch(/NaN|Infinity/);
  });

  it('rateBase "first" draws no pills and writes each rate on a third line under the count; showRates false draws neither', () => {
    const h = draw(900, { flow: "right", rateBase: "first" });
    expect(pills(h)).toHaveLength(0);
    const ts = texts(h);
    const rates = ts.filter(isRate);
    expect(rates.map((t) => t.text)).toEqual(["62%", "19%", "12%", "9%", "8%"]);
    for (const r of rates) {
      // Same column: the name above, then the count, then the rate
      const column = ts.filter((t) => t.x === r.x).sort((a, b) => a.y - b.y);
      expect(column.map((t) => t.text)).toEqual([STAGES[rates.indexOf(r) + 1].stage, expect.any(String), r.text]);
    }
    const none = draw(900, { flow: "right", showRates: false });
    expect(pills(none)).toHaveLength(0);
    expect(texts(none).filter(isRate)).toHaveLength(0);
    expect(none).not.toBe(draw(900, { showRates: false }));
  });

  it("the default example and the existing variants keep their structure fingerprints", () => {
    const def = CHARTS.find((c) => c.type === "funnel")!;
    const shot = (spec: typeof def.example) => summarize(renderSpecToSVG(spec, { width: 720, theme: "dark", frame: false }));
    // The funnel entry of render.test.tsx.snap
    expect(shot(def.example)).toEqual({ paths: 7, rects: 5, circles: 0, lines: 0, sha1: "b4fc4c7bf884" });
    expect(shot({ ...def.example, options: { ...def.example.options, flow: "down" } })).toEqual(shot(def.example));
    expect(Object.fromEntries(["from-first", "no-rates"].map((id) => [id, shot(variantSpec(def, id)!)]))).toEqual(FINGERPRINTS);
  });

  it('spec: left-to-right is a funnel variant with flow "right", and other flow values are rejected', () => {
    const def = CHARTS.find((c) => c.type === "funnel")!;
    const spec = variantSpec(def, "left-to-right")!;
    expect(spec.options).toMatchObject({ flow: "right" });
    expect(validateSpec(spec).errors).toEqual([]);
    expect(validateSpec({ ...spec, options: { flow: "up" } }).errors.map((e) => e.code)).toEqual(["bad_enum"]);
    expect(pills(renderSpecToSVG(spec, { width: 720, frame: false }))).toHaveLength(3);
  });
});

/** Funnel variants as drawn before flow was added (720px, dark, no frame) */
const FINGERPRINTS = {
  "from-first": { paths: 7, rects: 5, circles: 0, lines: 0, sha1: "7f6b120927a6" },
  "no-rates": { paths: 7, rects: 5, circles: 0, lines: 0, sha1: "7a21bc1cdf5f" },
};
