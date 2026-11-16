import { describe, expect, it } from "vitest";
import { buildTree, leaves, partitionAngles, squarify } from "../src/layout/hierarchy";
import { sankeyLayout } from "../src/layout/sankey";
import { chordLayout } from "../src/layout/chord";
import { divergingStack, insideOut, stack } from "../src/layout/stack";
import { beeswarm, boxStats, kde, ranks } from "../src/layout/stats";
import { allocateCells } from "../src/charts/waffle";
import { TAU } from "../src/core/geometry";
import * as samples from "../src/spec/samples";

describe("squarify", () => {
  it("area is proportional to value and fills the box", () => {
    const vals = [22, 14, 10, 14, 10, 11, 7, 7, 5];
    const rects = squarify(vals, { x: 0, y: 0, w: 400, h: 300 });
    const total = vals.reduce((a, b) => a + b, 0);
    rects.forEach((r, i) => expect(r.w * r.h).toBeCloseTo((vals[i] / total) * 400 * 300, 3));
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(300 + 1e-6);
    }
    const worst = Math.max(...rects.map((r) => Math.max(r.w / r.h, r.h / r.w)));
    expect(worst).toBeLessThan(4);
  });
});

describe("hierarchy", () => {
  it("flat table (group), path (path), nesting (children)", () => {
    const flat = buildTree(samples.treemapSample, { group: "category", label: "product", value: "share" });
    expect(flat.value).toBe(100);
    expect(flat.children.map((c) => c.label)).toEqual(["Running shoes", "Outdoor", "Apparel", "Gear"]);
    const path = buildTree([{ a: "x", b: "y", c: "z", v: 2 }], { path: ["a", "b"], label: "c", value: "v" });
    expect(leaves(path)[0].id).toBe("x/y/z");
    const nested = buildTree([{ label: "a", children: [{ label: "b", value: 3 }, { label: "c", value: 1 }] }], {});
    expect(nested.children[0].value).toBe(4);
  });
  it("partitionAngles splits a full turn", () => {
    const root = buildTree(samples.sunburstSample, { group: "channel", label: "campaign", value: "spend" });
    const arcs = partitionAngles(root);
    const top = arcs.filter((a) => a.depth === 1);
    expect(top[top.length - 1].a1).toBeCloseTo(TAU, 9);
    const leaf = arcs.filter((a) => a.depth === 2);
    expect(leaf.reduce((s, a) => s + (a.a1 - a.a0), 0)).toBeCloseTo(TAU, 9);
  });
});

describe("sankey", () => {
  const lay = sankeyLayout([], samples.sankeySample, { width: 600, height: 300, nodeWidth: 10, nodePadding: 12 });
  it("nodes stay inside the area and do not overlap", () => {
    for (const n of lay.nodes) {
      expect(n.y0).toBeGreaterThanOrEqual(-0.5);
      expect(n.y1).toBeLessThanOrEqual(300.5);
      expect(n.x1).toBeLessThanOrEqual(600.01);
    }
    const byLayer = new Map<number, typeof lay.nodes>();
    lay.nodes.forEach((n) => byLayer.set(n.layer, [...(byLayer.get(n.layer) ?? []), n]));
    for (const col of byLayer.values()) {
      const s = [...col].sort((a, b) => a.y0 - b.y0);
      for (let i = 1; i < s.length; i++) expect(s[i].y0).toBeGreaterThanOrEqual(s[i - 1].y1 - 1e-6);
    }
  });
  it("inflow equals outflow", () => {
    const mid = lay.nodes.find((n) => n.id === "Product page")!;
    const inV = mid.inLinks.reduce((a, l) => a + l.value, 0);
    const outV = mid.outLinks.reduce((a, l) => a + l.value, 0);
    expect(inV).toBe(outV);
    expect(lay.nodes.find((n) => n.id === "Purchase")!.layer).toBe(Math.max(...lay.nodes.map((n) => n.layer)));
  });
});

describe("chord", () => {
  it("group angles + gaps = a full turn", () => {
    const m = [
      [0, 5, 3],
      [2, 0, 4],
      [1, 1, 0],
    ];
    const { groups, chords } = chordLayout(m, 0.05);
    const span = groups.reduce((a, g) => a + (g.a1 - g.a0), 0);
    expect(span + 0.05 * 3).toBeCloseTo(TAU, 9);
    expect(chords).toHaveLength(3);
  });
});

describe("stack", () => {
  it("zero and expand", () => {
    const v = [
      [1, 2],
      [3, 2],
    ];
    expect(stack(v, "zero").y1[1]).toEqual([4, 4]);
    expect(stack(v, "expand").y1[1]).toEqual([100, 100]);
    expect(stack(v, "expand").y1[0]).toEqual([25, 50]);
  });
  it("wiggle keeps thickness and insideOut is a permutation", () => {
    const vals = [
      [1, 4, 9, 4, 1],
      [5, 5, 5, 5, 5],
      [9, 4, 1, 4, 9],
    ];
    const s = stack(vals, "wiggle");
    for (let k = 0; k < 5; k++) expect(s.y1[2][k] - s.y0[0][k]).toBeCloseTo(vals[0][k] + vals[1][k] + vals[2][k], 9);
    expect([...insideOut(vals)].sort()).toEqual([0, 1, 2]);
  });
});

describe("divergingStack (diverging bars)", () => {
  /** [left length, right length] of row k */
  const sides = (s: ReturnType<typeof divergingStack>, k: number) => {
    const ends = s.y0.flatMap((row, i) => [row[k], s.y1[i][k]]);
    return [-Math.min(0, ...ends), Math.max(0, ...ends)];
  };
  // Series, one per line: Strongly disagree, Disagree, Neutral, Agree, Strongly agree
  const likert = [
    [4, 22, -3],
    [8, 28, 6],
    [14, 20, 0],
    [46, 22, 9],
    [28, 8, -12],
  ];
  it("1: left length + right length = the row's sum of absolute values (100 with percent)", () => {
    for (const percent of [false, true]) {
      const s = divergingStack(likert, { negative: [1, 0], neutral: 2, percent });
      for (let k = 0; k < 3; k++) {
        const [l, r] = sides(s, k);
        expect(l + r).toBeCloseTo(percent ? 100 : likert.reduce((a, row) => a + Math.abs(row[k]), 0), 9);
        expect(s.neg[k] + s.pos[k] + Math.abs(likert[2][k])).toBeCloseTo(l + r, 9);
      }
    }
  });
  it("2: [10, -4] is 10 right, 4 left (71.4%, 28.6% with percent). Fails if the negative piece has zero length", () => {
    for (const [percent, right, left] of [
      [false, 10, 4],
      [true, 71.43, 28.57],
    ] as const) {
      const s = divergingStack([[10], [-4]], { percent });
      expect([s.y0[0][0], s.y1[0][0]]).toEqual([0, expect.closeTo(right, 2)]);
      expect([s.y0[1][0], s.y1[1][0]]).toEqual([0, expect.closeTo(-left, 2)]);
      expect(s.y0[1][0] - s.y1[1][0]).toBeGreaterThan(0);
      expect([s.neg[0], s.pos[0]]).toEqual([expect.closeTo(left, 2), expect.closeTo(right, 2)]);
    }
  });
  it("3: the two halves of the middle series add up to its value", () => {
    const s = divergingStack(likert, { negative: [1, 0], neutral: 2 });
    for (let k = 0; k < 3; k++) {
      expect(-s.y0[2][k]).toBeCloseTo(s.y1[2][k], 9);
      expect(s.y1[2][k] - s.y0[2][k]).toBeCloseTo(Math.abs(likert[2][k]), 9);
    }
    // The two disagree segments go outward from Neutral's left end (Disagree on the zero line side), the two agree segments from its right end in data order
    expect([s.y0[1][1], s.y1[1][1], s.y1[0][1]]).toEqual([-10, -38, -60]);
    expect([s.y0[3][1], s.y1[3][1], s.y1[4][1]]).toEqual([10, 32, 40]);
  });
  it("4: in all-positive satisfaction rows the two series set as negative go left too. A hidden series only leaves its place empty", () => {
    const row = [[5], [15], [20], [40], [20]];
    const s = divergingStack(row, { negative: [1, 0], neutral: 2 });
    expect(s.y1[0][0]).toBeLessThan(s.y1[1][0]);
    expect(Math.max(s.y0[0][0], s.y1[0][0], s.y0[1][0], s.y1[1][0])).toBeLessThanOrEqual(-10);
    expect([s.neg[0], s.pos[0]]).toEqual([20, 60]);
    // Hiding Agree restacks only the right side; the left side and the percent denominator stay the same
    const full = divergingStack(row, { negative: [1, 0], neutral: 2, percent: true });
    const hid = divergingStack(row, { negative: [1, 0], neutral: 2, percent: true, skip: new Set([3]) });
    for (const i of [0, 1, 2]) expect([hid.y0[i][0], hid.y1[i][0]]).toEqual([full.y0[i][0], full.y1[i][0]]);
    expect(hid.y0[4][0]).toBe(10);
    // Values that are already negative go left by their sign, and the data order reads from the left
    const signed = divergingStack([[-3], [-7], [5]]);
    expect([signed.y1[0][0], signed.y1[1][0], signed.y1[2][0]]).toEqual([-10, -7, 5]);
  });
});

describe("statistics", () => {
  it("boxStats", () => {
    const st = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    expect(st.median).toBe(5.5);
    expect(st.outliers).toEqual([100]);
    expect(st.hi).toBe(9);
  });
  it("boxStats with whiskers uses those percentiles as whisker ends, and values beyond them are outliers", () => {
    const st = boxStats(Array.from({ length: 100 }, (_, i) => i + 1), [5, 95]);
    expect(st.lo).toBeCloseTo(5.95, 10);
    expect(st.hi).toBeCloseTo(95.05, 10);
    expect(st.outliers).toEqual([1, 2, 3, 4, 5, 96, 97, 98, 99, 100]);
    expect(st.q1).toBe(boxStats(Array.from({ length: 100 }, (_, i) => i + 1)).q1);
  });
  it("kde area is close to 1", () => {
    const vals = Array.from({ length: 400 }, (_, i) => Math.sin(i) * 10 + 50);
    const xs = Array.from({ length: 400 }, (_, i) => i * 0.25);
    const d = kde(vals, xs);
    const area = d.reduce((a, v) => a + v * 0.25, 0);
    expect(area).toBeGreaterThan(0.95);
    expect(area).toBeLessThan(1.05);
  });
  it("beeswarm circles do not overlap", () => {
    const xs = Array.from({ length: 200 }, (_, i) => (i * 37) % 120);
    const r = 3;
    const ys = beeswarm(xs, r);
    for (let i = 0; i < xs.length; i++)
      for (let j = i + 1; j < xs.length; j++) {
        const d = Math.hypot(xs[i] - xs[j], ys[i] - ys[j]);
        expect(d).toBeGreaterThan(2 * r - 1e-6);
      }
  });
  const dense = Array.from({ length: 1500 }, (_, i) => Math.round((((Math.sin(i * 12.9898) * 43758.5453) % 1) * 50 + 50)) * 2);
  it("beeswarm does not overlap even when many share an x (including spots touching two circles at once)", () => {
    const r = 2;
    const ys = beeswarm(dense, r);
    const d = 2 * (r + 0.6);
    const idx = dense.map((_, i) => i).sort((a, b) => dense[a] - dense[b]);
    for (let a = 0; a < idx.length; a++)
      for (let b = a + 1; b < idx.length && dense[idx[b]] - dense[idx[a]] < d; b++) {
        const p = idx[a];
        const q = idx[b];
        expect(Math.hypot(dense[p] - dense[q], ys[p] - ys[q])).toBeGreaterThan(d - 1e-3);
      }
  });
  it("when the beeswarm band is full, overflow points scatter inside the band instead of piling on the limit", () => {
    const spread = 18;
    const ys = beeswarm(dense, 2, { maxSpread: spread });
    for (const y of ys) expect(Math.abs(y)).toBeLessThanOrEqual(spread + 1e-9);
    const onEdge = ys.filter((y) => Math.abs(Math.abs(y) - spread) < 1e-6).length;
    expect(onEdge).toBeLessThan(ys.length * 0.01);
    expect(ys.filter((y) => y > spread / 2).length).toBeGreaterThan(100);
    expect(ys.filter((y) => y < -spread / 2).length).toBeGreaterThan(100);
  });
  it("ranks gives equal values the same rank", () => {
    expect(ranks([10, 30, 30, 5])).toEqual([3, 1, 1, 4]);
  });
  it("allocateCells sums to exactly the cell count", () => {
    expect(allocateCells([33.3, 33.3, 33.4], 100).reduce((a, b) => a + b, 0)).toBe(100);
    expect(allocateCells([38, 62], 100)).toEqual([38, 62]);
  });
});
