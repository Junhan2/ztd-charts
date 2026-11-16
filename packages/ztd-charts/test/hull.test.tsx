import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScatterChart } from "../src/charts/bubble";
import { validateSpec } from "../src/spec";

type Row = Record<string, number | string>;
type Pt = [number, number];
const r = (el: ReactElement) => renderToStaticMarkup(el);
const draw = (data: Row[], extra: Record<string, unknown> = {}) => r(<ScatterChart data={data} x="x" y="y" width={480} height={300} animate={false} {...extra} />);
/** Attributes of one tag */
const attrs = (tag: string): Record<string, string> => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
/** Outline shapes (the only shapes at opacity 0.14), in markup order */
const outlines = (h: string) => [...h.matchAll(/<(path|circle) [^>]*opacity="0\.14"[^>]*>/g)].map((m): Record<string, string> => ({ ...attrs(m[0]), tag: m[1] }));
/** Dots, with their fill (the series color) */
const dots = (h: string) => [...h.matchAll(/<circle class="ztd-mark"[^>]*>/g)].map((m) => attrs(m[0])).map((a) => ({ x: +a.cx, y: +a.cy, r: +a.r, fill: a.fill }));
const vertices = (d: string): Pt[] => [...d.matchAll(/[ML]([-\d.]+),([-\d.]+)/g)].map((m) => [+m[1], +m[2]]);
const desc = (h: string) => /<desc[^>]*>([^<]*)<\/desc>/.exec(h)?.[1] ?? "";
/** Whether p lies inside the convex polygon, or on it within tol px (path numbers are rounded to 0.01) */
function inside(poly: Pt[], p: Pt, tol = 0.01): boolean {
  const area = poly.reduce((s, a, i) => s + a[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * a[1], 0);
  return poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    return cross * Math.sign(area) >= -tol * Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
}
/** Seeded random numbers (the same generator as hexbin.test.tsx) */
function rnd(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
/** Three series of 40 dots on whole-number x values, so jitter moves them */
const clusters = (() => {
  const u = rnd(7);
  return ["A", "B", "C"].flatMap((g, k) => Array.from({ length: 40 }, () => ({ g, x: Math.round(2 + k * 3 + u() * 4), y: 10 + k * 6 + (u() + u() + u()) * 4 })));
})();

describe("scatter hull", () => {
  it("every dot sits inside its series outline (the polygon before it is widened), drawn under the dots and hidden from pointers and screen readers", () => {
    const h = draw(clusters, { series: "g", hull: true, jitter: { amount: 0.4 } });
    const shapes = outlines(h);
    const pts = dots(h);
    expect(shapes).toHaveLength(3);
    for (const s of shapes) {
      const own = pts.filter((d) => d.fill === s.fill);
      expect(own).toHaveLength(40);
      const poly = vertices(s.d);
      expect(poly.length).toBeGreaterThanOrEqual(3);
      for (const d of own) expect(inside(poly, [d.x, d.y]), `${s.fill} ${d.x},${d.y}`).toBe(true);
      // Widened by the dot radius + 4px on each side, with round joins, in the series color
      expect(s).toMatchObject({ stroke: s.fill, "stroke-width": String(2 * (own[0].r + 4)), "stroke-linejoin": "round" });
      expect(s.d.endsWith("Z")).toBe(true);
    }
    // Grid, then outlines, then dots
    const group = /<g aria-hidden="true" pointer-events="none">(?=<path[^>]*opacity="0\.14")/.exec(h);
    expect(group).not.toBeNull();
    expect(h.indexOf('<line x1="')).toBeLessThan(group!.index);
    expect(group!.index).toBeLessThan(h.indexOf('<circle class="ztd-mark"'));
    // A dense cloud, where most dots are dropped before the sort, is still fully covered
    const u = rnd(11);
    const dense = draw(Array.from({ length: 3000 }, () => ({ x: (u() + u() + u()) * 10, y: (u() + u()) * 7 })), { hull: true });
    const [one] = outlines(dense);
    expect(dots(dense)).toHaveLength(3000);
    for (const d of dots(dense)) expect(inside(vertices(one.d), [d.x, d.y]), `${d.x},${d.y}`).toBe(true);
  });

  it("one dot (or dots on one spot) is a circle, two dots or dots on one line a round-capped segment, three dots a triangle", () => {
    const one = outlines(draw([{ x: 1, y: 1 }], { hull: true }));
    expect(one).toEqual([expect.objectContaining({ tag: "circle", r: "8" })]);
    expect(outlines(draw([0, 1, 2].map(() => ({ x: 3, y: 4 })), { hull: true }))).toEqual([expect.objectContaining({ tag: "circle", r: "8" })]);
    const two = outlines(draw([{ x: 1, y: 1 }, { x: 4, y: 3 }], { hull: true }));
    expect(two).toHaveLength(1);
    expect(two[0]).toMatchObject({ tag: "path", "stroke-width": "16", "stroke-linecap": "round" });
    expect(vertices(two[0].d)).toHaveLength(2);
    expect(two[0].d).not.toContain("Z");
    const line = draw([0, 1, 2, 3, 4].map((k) => ({ x: k, y: 2 * k })), { hull: true });
    const ends = dots(line).sort((a, b) => a.x - b.x);
    const seg = outlines(line);
    expect(seg).toHaveLength(1);
    expect(vertices(seg[0].d).sort((a, b) => a[0] - b[0])).toEqual([ends[0], ends[4]].map((d) => [Math.round(d.x * 100) / 100, Math.round(d.y * 100) / 100]));
    const tri = outlines(draw([{ x: 1, y: 1 }, { x: 4, y: 3 }, { x: 2, y: 5 }], { hull: true }));
    expect(tri).toHaveLength(1);
    expect(vertices(tri[0].d)).toHaveLength(3);
    expect(tri[0].d.endsWith("Z")).toBe(true);
  });

  it("a hidden series gets no outline and the others keep their colors", () => {
    const fills = (extra: Record<string, unknown>) => outlines(draw(clusters, { series: "g", hull: true, ...extra })).map((s) => s.fill);
    const all = fills({});
    expect(new Set(all).size).toBe(3);
    expect(fills({ hidden: ["B"] })).toEqual([all[0], all[2]]);
  });

  it('bin "hex" ignores hull, and the validator says so with hull_ignored', () => {
    const plain = draw(clusters, { bin: "hex" });
    expect(draw(clusters, { bin: "hex", hull: true })).toBe(plain);
    const spec = { type: "scatter", data: clusters, encoding: { x: "x", y: "y" }, options: { bin: "hex", hull: true } };
    for (const lang of ["en", "ko"] as const) {
      const w = validateSpec(spec, { lang }).warnings.filter((i) => i.code === "hull_ignored");
      expect(w, lang).toEqual([expect.objectContaining({ path: "options.hull" })]);
    }
    expect(validateSpec({ ...spec, options: { hull: true } }).warnings).toEqual([]);
  });

  it("the description says what the outlines mark, in English and Korean", () => {
    expect(desc(draw(clusters, { series: "g", hull: true }))).toContain(" Outlines mark the area each series covers.");
    expect(desc(draw(clusters, { series: "g", hull: true, locale: "ko-KR" }))).toContain(" 윤곽은 계열마다 점이 차지한 영역을 표시해요.");
    expect(desc(draw(clusters, { series: "g" }))).not.toContain("Outlines");
  });

  it("with outlines every series name is ink, which stays readable on any outline tint", () => {
    const fill = (h: string, name: string) => new RegExp(`<text [^>]*fill="([^"]+)"[^>]*>${name}</text>`).exec(h)?.[1] ?? "";
    const plain = draw(clusters, { series: "g" });
    const outlined = draw(clusters, { series: "g", hull: true });
    expect(fill(plain, "B")).toContain("--ztd-muted");
    for (const name of ["A", "B", "C"]) expect(fill(outlined, name), name).toContain("--ztd-ink");
  });

  it("a series name moves off another series' outline, and keeps its old spot when every spot is on one", () => {
    const at = (h: string, name: string) => Number(new RegExp(`<text x="([-\\d.]+)"[^>]*>${name}</text>`).exec(h)?.[1]);
    // Alpha's first spot (right of its middle dot) falls on Beta's outline, which starts just to the right
    const side = [
      { g: "Alpha", x: 5, y: 5 },
      { g: "Alpha", x: 4.6, y: 5.6 },
      { g: "Alpha", x: 4.6, y: 4.4 },
      { g: "Beta", x: 5.3, y: 3 },
      { g: "Beta", x: 8, y: 5 },
      { g: "Beta", x: 5.3, y: 7 },
      { g: "Beta", x: 6, y: 5 },
    ];
    // Alpha is the highlighted series; its middle dot is its rightmost one
    const dotX = Math.max(...dots(draw(side, { series: "g" })).filter((d) => d.fill.includes("--ztd-accent")).map((d) => d.x));
    expect(at(draw(side, { series: "g" }), "Alpha")).toBeGreaterThan(dotX);
    expect(at(draw(side, { series: "g", hull: true }), "Alpha")).toBeLessThan(dotX);
    // Beta's outline surrounds Alpha, so every spot is on it: the name stays where it was
    const ring = [
      { g: "Alpha", x: 5, y: 5 },
      { g: "Alpha", x: 5.3, y: 5 },
      { g: "Alpha", x: 5.15, y: 5.3 },
      ...[[2, 1], [8.5, 1], [8.5, 9], [2, 9]].map(([x, y]) => ({ g: "Beta", x, y })),
    ];
    const old = at(draw(ring, { series: "g" }), "Alpha");
    expect(old).toBeGreaterThan(0);
    expect(at(draw(ring, { series: "g", hull: true }), "Alpha")).toBe(old);
  });
});
