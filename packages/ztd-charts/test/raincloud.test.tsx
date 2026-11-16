import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoxPlot, type BoxPlotProps } from "../src/charts/box";
import { renderSpecToSVG } from "../src/server";
import { CHARTS, validateSpec, variantSpec } from "../src/spec";
import { resolveMeta } from "../src/spec/meta";

/**
 * The box plot's raincloud variant: a half density curve right of each group's center line, a thin box on it and the samples as dots on its left.
 * The value axis is cut into 5px rows, and a row holds at most as many dots as fit in the dot area (42% of the band, at most 44px, so 8).
 * Past that, one dot stands for N samples (1, 2, 5, 10 …), a hollow ring holds the remainder, and the chart writes "1 dot = N samples"
 */

type Row = { g: string; v: number | null | string };
/** Deterministic normal samples (linear congruential generator + Box-Muller), so counts are the same on every run */
function normal(seed: number, n: number, mu: number, sd: number): number[] {
  let s = seed;
  const u = () => ((s = (s * 1664525 + 1013904223) % 4294967296) + 0.5) / 4294967296;
  return Array.from({ length: n }, () => mu + sd * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()));
}
const rows = (groups: Record<string, readonly (number | null | string)[]>): Row[] => Object.entries(groups).flatMap(([g, vs]) => vs.map((v) => ({ g, v })));
const draw = (data: Row[], width: number, extra: Partial<BoxPlotProps<Row>> = {}) =>
  renderToStaticMarkup(<BoxPlot data={data} group="g" value={(d) => d.v as number} variant="raincloud" width={width} animate={false} {...extra} />);
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
const desc = (h: string) => decode(/<desc[^>]*>([^<]*)<\/desc>/.exec(h)?.[1] ?? "");
const texts = (h: string) => [...h.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: +m[1], y: +m[2], text: decode(m[3]) }));
/** Every circle: filled dots, and rings (fill="none") for the remainder */
const circles = (h: string) => [...h.matchAll(/<circle ([^>]*)>/g)].map((m) => ({ x: +/cx="([-\d.]+)"/.exec(m[1])![1], y: +/cy="([-\d.]+)"/.exec(m[1])![1], ring: /fill="none"/.test(m[1]) }));
const unitOf = (h: string) => Number(/1 dot = (\d+) samples/.exec(h)?.[1] ?? 1);
/** Dots grouped by row (cy), for the dots left of x = right */
function byRow(h: string, left: number, right: number) {
  const out = new Map<number, { x: number; ring: boolean }[]>();
  for (const c of circles(h).filter((d) => d.x > left && d.x < right)) out.set(c.y, [...(out.get(c.y) ?? []), c]);
  return out;
}

/** Same summary as the structure snapshot in render.test.tsx */
function summarize(svg: string) {
  const count = (re: RegExp) => (svg.match(re) ?? []).length;
  return { paths: count(/<path /g), rects: count(/<rect /g), circles: count(/<circle /g), lines: count(/<line /g), sha1: createHash("sha1").update(svg).digest("hex").slice(0, 12) };
}

describe("box raincloud", () => {
  it("each 5px row holds at most 8 dots, stacked outward from the box, and 5,000 samples draw at most 400 dots per group", () => {
    const groups = { A: normal(1, 5000, 100, 15), B: normal(2, 5000, 130, 25) };
    const h = draw(rows(groups), 720);
    const centers = texts(h).filter((t) => t.text === "A" || t.text === "B").map((t) => t.x);
    expect(centers).toHaveLength(2);
    const N = unitOf(h);
    expect(N).toBeGreaterThanOrEqual(2);
    for (const [k, [name, vs]] of Object.entries(groups).entries()) {
      const cx = centers[k];
      const rowsOf = byRow(h, k ? (centers[0] + cx) / 2 : 0, cx);
      const all = [...rowsOf.values()].flat();
      expect(all.length, name).toBeGreaterThan(20);
      expect(all.length, name).toBeLessThanOrEqual(400);
      const ys = [...rowsOf.keys()].sort((a, b) => a - b);
      for (const y of ys) {
        // Rows sit on a 5px grid
        expect(Math.abs(((y - ys[0]) / 5) % 1), `${name} row ${y}`).toBeLessThan(1e-6);
        const xs = rowsOf.get(y)!.map((d) => d.x).sort((a, b) => b - a);
        expect(xs.length, `${name} row ${y}`).toBeLessThanOrEqual(8);
        // The first dot sits next to the box and the rest follow every 5px outward; only the outermost can be a ring
        expect(cx - xs[0]).toBeLessThan(10);
        xs.forEach((x, j) => expect(xs[0] - x).toBeCloseTo(j * 5, 5));
        const rings = rowsOf.get(y)!.filter((d) => d.ring);
        expect(rings.length).toBeLessThanOrEqual(1);
        if (rings.length) expect(rings[0].x).toBe(xs[xs.length - 1]);
      }
      // Each filled dot is N samples and each ring fewer than N, so together they account for every sample
      const filled = all.filter((d) => !d.ring).length;
      const rings = all.length - filled;
      expect(filled * N).toBeLessThanOrEqual(vs.length);
      expect(filled * N + rings * (N - 1)).toBeGreaterThanOrEqual(vs.length);
    }
  });

  it("N of 2 or more is written at the top right and at the end of the description; N = 1 writes neither", () => {
    const many = rows({ A: normal(3, 4000, 50, 8), B: normal(4, 4000, 60, 12) });
    const h = draw(many, 640);
    const N = unitOf(h);
    expect([2, 5, 10, 20, 50, 100, 200, 500]).toContain(N);
    const label = texts(h).find((t) => t.text === `1 dot = ${N} samples`)!;
    expect(label).toBeDefined();
    // Right end of the plot, above every dot
    expect(label.x).toBeGreaterThan(640 - 10);
    expect(label.y).toBeLessThan(Math.min(...circles(h).map((c) => c.y)) - 6);
    expect(desc(h).endsWith(`. 1 dot = ${N} samples.`)).toBe(true);
    const ko = draw(many, 640, { locale: "ko" });
    expect(texts(ko).some((t) => t.text === `점 하나 = ${N}건`)).toBe(true);
    expect(desc(ko).endsWith(`. 점 하나 = ${N}건.`)).toBe(true);

    const few = draw(rows({ A: [3, 5, 8, 13, 21, 34], B: [2, 4, 6, 8, 10, 12] }), 640);
    expect(circles(few)).toHaveLength(12);
    expect(few).not.toMatch(/1 dot =/);
    expect(desc(few)).not.toMatch(/dot/);
  });

  it("a band narrower than 44px draws exactly what both draws", () => {
    const data = rows(Object.fromEntries(["a", "b", "c", "d", "e"].map((g, i) => [g, normal(10 + i, 60, 100 + i * 20, 15)])));
    const both = (w: number) => renderToStaticMarkup(<BoxPlot data={data} group="g" value={(d) => d.v as number} variant="both" width={w} animate={false} />);
    expect(draw(data, 300)).toBe(both(300));
    // Wide enough, it is a different picture with dots
    expect(draw(data, 720)).not.toBe(both(720));
    expect(circles(draw(data, 720)).length).toBeGreaterThan(50);
  });

  it("odd data draws no NaN or Infinity", () => {
    const data = rows({
      one: [42],
      flat: [7, 7, 7, 7, 7],
      mixed: [1, null, "x", Number.NaN, Number.POSITIVE_INFINITY, 3, -4, 12, 12, 12],
      empty: [null, Number.NaN],
      wide: normal(7, 300, 0, 1e6),
    });
    for (const width of [120, 300, 720])
      for (const animate of [false, true])
        for (const extra of [{}, { zero: true }, { whiskers: [5, 95] as const }, { locale: "ko" }]) {
          const h = draw(data, width, { animate, ...extra });
          expect(h, `${width} ${animate} ${JSON.stringify(extra)}`).not.toMatch(/NaN|Infinity/);
        }
    // A group with no values is not drawn
    expect(texts(draw(data, 720)).some((t) => t.text === "empty")).toBe(false);
  });

  it("the default example and the existing variants keep their structure fingerprints", () => {
    const def = CHARTS.find((c) => c.type === "box")!;
    const shot = (spec: typeof def.example) => summarize(renderSpecToSVG(spec, { width: 720, theme: "dark", frame: false }));
    // The box entry of render.test.tsx.snap and the variants as drawn before raincloud
    expect(shot(def.example)).toEqual({ paths: 5, rects: 6, circles: 8, lines: 29, sha1: "2469b62cc218" });
    expect(Object.fromEntries(["violin", "both", "no-outliers"].map((id) => [id, shot(variantSpec(def, id)!)]))).toEqual(FINGERPRINTS);
  });

  it("spec: raincloud is a box variant option, a named variant and an alias of box", () => {
    const def = CHARTS.find((c) => c.type === "box")!;
    const spec = variantSpec(def, "raincloud")!;
    expect(spec.options).toMatchObject({ variant: "raincloud" });
    const r = validateSpec(spec);
    expect(r.errors).toEqual([]);
    expect(resolveMeta("raincloud")?.type).toBe("box");
  });
});

/** Box variants as drawn before raincloud was added (720px, dark, no frame) */
const FINGERPRINTS = {
  violin: { paths: 10, rects: 6, circles: 8, lines: 19, sha1: "13abbc48c74d" },
  both: { paths: 10, rects: 6, circles: 8, lines: 19, sha1: "13abbc48c74d" },
  "no-outliers": { paths: 5, rects: 6, circles: 0, lines: 29, sha1: "6fc3184d1c0b" },
};
