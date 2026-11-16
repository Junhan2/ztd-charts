import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarChart, type BarChartProps } from "../src/charts/bar";
import { AXIS_FONT } from "../src/core/axis";
import { textWidth } from "../src/core/text";
import { renderSpecToSVG } from "../src/server";
import { CHARTS, validateSpec, variantSpec } from "../src/spec";
import { resolveMeta } from "../src/spec/meta";

/**
 * Bar option centerLabels: with layout "diverging", horizontal bars and no neutral series, the row names leave the left side for a column at the zero line (a population pyramid).
 * The column is the widest name + 16px, at most 34% of the width. One value scale runs from x0 to x1 minus the column and only the right side moves right by the column, so a unit is the same length on both sides
 */

type Row = Record<string, string | number>;
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
const texts = (h: string) =>
  [...h.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*font-size="([\d.]+)"[^>]*text-anchor="(\w+)"[^>]*font-weight="(\d+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: +m[1], y: +m[2], size: +m[3], anchor: m[4], weight: +m[5], text: decode(m[6]) }));
/** Left and right edge of a text, from its anchor and measured width */
const span = (t: ReturnType<typeof texts>[number]) => {
  const w = textWidth(t.text, t.size, t.weight);
  const x0 = t.anchor === "middle" ? t.x - w / 2 : t.anchor === "end" ? t.x - w : t.x;
  return [x0, x0 + w];
};
/** [left x, right x] of each segment, in drawing order (row by row, left to right) */
const segX = (h: string) =>
  h
    .split('<g class="ztd-mark"')
    .slice(1)
    .map((g) => {
      const d = /<path d="([^"]+)"/.exec(g)![1];
      const xs = [...d.matchAll(/(?:M|H)(-?[\d.]+)|A[\d.]+,[\d.]+ \d \d \d (-?[\d.]+),/g)].map((m) => +(m[1] ?? m[2]));
      return [Math.min(...xs), Math.max(...xs)];
    });
/** x of the vertical grid lines in dim, the color of the zero line's thin lines */
const dimLines = (h: string) => [...h.matchAll(/<line x1="([\d.]+)" x2="\1"[^>]*stroke="var\(--ztd-dim[,)]/g)].map((m) => +m[1]);
/** Row headers of the accessible table ("name · series") */
const ths = (h: string) => [...h.matchAll(/<th scope="row">([^<]*)<\/th>/g)].map((m) => decode(m[1]));

const draw = (data: Row[], extra: Partial<BarChartProps<Row>> = {}, width = 560) =>
  renderToStaticMarkup(<BarChart data={data} x="age" y={["Male", "Female"]} layout="diverging" negative={["Male"]} width={width} animate={false} {...extra} />);

/** Rows A to C have the same value on both sides; D is lopsided, so the zero line is off center */
const twins: Row[] = [
  { age: "A", Male: 10, Female: 10 },
  { age: "B", Male: 25, Female: 25 },
  { age: "C", Male: 40, Female: 40 },
  { age: "D", Male: 5, Female: 60 },
];

/** Same summary as the structure snapshot in render.test.tsx */
function summarize(svg: string) {
  const count = (re: RegExp) => (svg.match(re) ?? []).length;
  return { paths: count(/<path /g), rects: count(/<rect /g), circles: count(/<circle /g), lines: count(/<line /g), sha1: createHash("sha1").update(svg).digest("hex").slice(0, 12) };
}

describe("bar centerLabels", () => {
  it("a unit is the same length on both sides: equal values draw equal bars (within 0.5px) at any width and with percent", () => {
    for (const percent of [false, true])
      for (const width of [280, 390, 560, 720]) {
        const at = `${width}${percent ? " percent" : ""}`;
        const h = draw(twins, { centerLabels: true, percent }, width);
        const xs = segX(h);
        expect(xs, at).toHaveLength(8);
        for (let k = 0; k < 3; k++) expect(Math.abs(xs[2 * k][1] - xs[2 * k][0] - (xs[2 * k + 1][1] - xs[2 * k + 1][0])), `${at} row ${k}`).toBeLessThanOrEqual(0.5);
        // Left bars end at the column's left edge and right bars start at its right edge, on every row
        const L = xs.filter((_, i) => i % 2 === 0).map((b) => b[1]);
        const R = xs.filter((_, i) => i % 2 === 1).map((b) => b[0]);
        for (const x of L) expect(x, at).toBeCloseTo(L[0], 1);
        for (const x of R) expect(x, at).toBeCloseTo(R[0], 1);
        // Column = widest name + 16px (one-letter names, so the 34% cap does not apply)
        expect(R[0] - L[0], at).toBeCloseTo(Math.max(...["A", "B", "C", "D"].map((n) => textWidth(n, 11.5, 600))) + 16, 1);
        // Each name sits in the middle of the column, and none is left on the left side
        for (const n of ["A", "B", "C", "D"]) {
          const found = texts(h).filter((t) => t.text === n);
          expect(found.map((t) => t.anchor), `${at} ${n}`).toEqual(["middle"]);
          expect(Math.abs(found[0].x - (L[0] + R[0]) / 2), `${at} ${n}`).toBeLessThanOrEqual(0.06);
        }
        // Thin dim lines on both edges replace the bold zero line, and 0 is written once under each edge (positions are rounded to the pixel or 0.1px)
        expect(h).not.toContain('stroke-width="1.5"');
        const edges = dimLines(h).sort((a, b) => a - b);
        expect(edges, at).toHaveLength(2);
        edges.forEach((x, j) => expect(Math.abs(x - [L[0], R[0]][j]), at).toBeLessThanOrEqual(1));
        const zeros = texts(h).filter((t) => t.text === (percent ? "0%" : "0"));
        expect(zeros, at).toHaveLength(2);
        zeros.sort((a, b) => a.x - b.x).forEach((t, j) => expect(Math.abs(t.x - [L[0], R[0]][j]), at).toBeLessThanOrEqual(0.06));
        // Tick numbers never fall inside the column, and both sides get their own where the step lands on both
        // (the ticks are the same as without centerLabels: below 560px the step of 50 leaves only 0 on the shorter left side)
        const ticks = texts(h).filter((t) => t.size === AXIS_FONT && t.text !== zeros[0].text);
        for (const t of ticks) expect(t.x < L[0] || t.x > R[0], `${at} ${t.text}`).toBe(true);
        if (width >= 560) expect(ticks.some((t) => t.x < L[0]) && ticks.some((t) => t.x > R[0]), at).toBe(true);
      }
  });

  it("is ignored with a neutral series: the picture is the one without centerLabels", () => {
    const likert = [
      { q: "Support", Disagree: 30, Neutral: 22, Agree: 20 },
      { q: "Price", Disagree: 10, Neutral: 15, Agree: 40 },
    ];
    const props: BarChartProps<(typeof likert)[number]> = { data: likert, x: "q", y: ["Disagree", "Neutral", "Agree"], layout: "diverging", negative: ["Disagree"], neutral: "Neutral", width: 560, animate: false };
    const plain = renderToStaticMarkup(<BarChart {...props} />);
    expect(renderToStaticMarkup(<BarChart {...props} centerLabels />)).toBe(plain);
    expect(plain).toContain('stroke-width="1.5"');
  });

  it("is ignored on vertical bars and outside layout diverging", () => {
    for (const extra of [{ orientation: "vertical" }, { layout: "stacked", orientation: "horizontal" }, { layout: "grouped", orientation: "horizontal" }] as const) expect(draw(twins, { ...extra, centerLabels: true }), JSON.stringify(extra)).toBe(draw(twins, extra));
  });

  it("long Korean names are shortened to fit the column, and nothing overlaps", () => {
    const data: Row[] = [
      { age: "서울특별시", Male: 46, Female: 49 },
      { age: "경기도 성남시 분당구", Male: 23, Female: 25 },
      { age: "제주특별자치도 서귀포시", Male: 9, Female: 9 },
      { age: "세종특별자치시", Male: 19, Female: 18 },
      { age: "부산광역시 해운대구", Male: 20, Female: 22 },
    ];
    for (const width of [280, 390, 720]) {
      const h = draw(data, { centerLabels: true, locale: "ko-KR" }, width);
      const xs = segX(h);
      const L = Math.max(...xs.filter((_, i) => i % 2 === 0).map((b) => b[1]));
      const R = Math.min(...xs.filter((_, i) => i % 2 === 1).map((b) => b[0]));
      // The column stops at 34% of the width
      expect(R - L, `${width}`).toBeLessThanOrEqual(width * 0.34 + 0.01);
      const all = texts(h);
      const names = all.filter((t) => t.size === 11.5);
      expect(names, `${width}`).toHaveLength(5);
      // Every name fits inside the column; a name wider than the column minus 8px on each side is shortened with "…" (the table keeps the full names)
      for (const t of names) {
        const [a, b] = span(t);
        expect(a, `${width} ${t.text}`).toBeGreaterThanOrEqual(L);
        expect(b, `${width} ${t.text}`).toBeLessThanOrEqual(R);
      }
      const shown = [...names].sort((a, b) => a.y - b.y).map((t) => t.text);
      data.forEach((d, i) => expect(shown[i], `${width} ${d.age}`).toEqual(textWidth(String(d.age), 11.5, 500) <= R - L - 16 ? d.age : expect.stringMatching(/…$/)));
      if (width === 280) expect(shown.filter((s) => s.endsWith("…")).length).toBeGreaterThanOrEqual(3);
      expect(ths(h)).toContain("제주특별자치도 서귀포시 · Female");
      // Row totals sit outside the bars and inside the chart
      for (const t of all.filter((q) => q.size === 11 && q.weight === 600)) {
        const [a, b] = span(t);
        expect(a, `${width} ${t.text}`).toBeGreaterThanOrEqual(0);
        expect(b, `${width} ${t.text}`).toBeLessThanOrEqual(width);
        expect(b <= L || a >= R, `${width} ${t.text}`).toBe(true);
      }
      // No two texts overlap (names, totals, tick numbers)
      const boxes = all.map((t) => ({ t: t.text, x: span(t), y: [t.y - t.size / 2, t.y + t.size / 2] }));
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const [p, q] = [boxes[i], boxes[j]];
          const hit = p.x[0] < q.x[1] && q.x[0] < p.x[1] && p.y[0] < q.y[1] && q.y[0] < p.y[1];
          expect(hit, `${width}: "${p.t}" and "${q.t}"`).toBe(false);
        }
    }
  });

  it("the default example, the existing variants and diverging bars without centerLabels keep their structure fingerprints", () => {
    const def = CHARTS.find((c) => c.type === "bar")!;
    const shot = (spec: typeof def.example) => summarize(renderSpecToSVG(spec, { width: 720, theme: "dark", frame: false }));
    // The bar entry of render.test.tsx.snap
    expect(shot(def.example)).toEqual({ paths: 8, rects: 1, circles: 0, lines: 6, sha1: "c59d12c6a69a" });
    expect(Object.fromEntries(["grouped", "percent", "horizontal"].map((id) => [id, shot(variantSpec(def, id)!)]))).toEqual(FINGERPRINTS.variants);
    const sum = (h: string) => summarize(h);
    expect({ twins: sum(draw(twins)), percent: sum(draw(twins, { percent: true })), vertical: sum(draw(twins, { orientation: "vertical" })) }).toEqual(FINGERPRINTS.diverging);
  });

  it("spec: the pyramid variant, and butterfly, pyramid and populationPyramid as aliases of bar", () => {
    const def = CHARTS.find((c) => c.type === "bar")!;
    const spec = variantSpec(def, "pyramid")!;
    expect(spec.options).toMatchObject({ layout: "diverging", centerLabels: true });
    expect(spec.options).not.toHaveProperty("highlight");
    for (const lang of ["en", "ko"] as const) expect(validateSpec(spec, { lang })).toMatchObject({ errors: [], warnings: [] });
    for (const alias of ["butterfly", "pyramid", "populationPyramid"]) expect(resolveMeta(alias)?.type, alias).toBe("bar");
    const svg = renderSpecToSVG({ ...spec, type: "pyramid" }, { width: 560, theme: "light" });
    expect(svg).not.toContain('stroke-width="1.5"');
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
});

/** Drawn before centerLabels was added (base d7eff8d): bar variants at 720px dark without frame, and diverging bars at 560px */
const FINGERPRINTS = {
  variants: {
    grouped: { paths: 8, rects: 9, circles: 0, lines: 4, sha1: "85f5a174f60f" },
    percent: { paths: 8, rects: 1, circles: 0, lines: 6, sha1: "4019716bc0c0" },
    horizontal: { paths: 8, rects: 1, circles: 0, lines: 6, sha1: "364fed5602d7" },
  },
  diverging: {
    twins: { paths: 8, rects: 0, circles: 0, lines: 7, sha1: "dfd27a7c8209" },
    percent: { paths: 8, rects: 0, circles: 0, lines: 4, sha1: "41e06cc13fad" },
    vertical: { paths: 8, rects: 0, circles: 0, lines: 7, sha1: "3f2730aba055" },
  },
};
