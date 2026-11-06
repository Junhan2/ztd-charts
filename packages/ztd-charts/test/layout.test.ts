import { describe, expect, it } from "vitest";
import { buildTree, leaves, partitionAngles, squarify } from "../src/layout/hierarchy";
import { sankeyLayout } from "../src/layout/sankey";
import { chordLayout } from "../src/layout/chord";
import { insideOut, stack } from "../src/layout/stack";
import { beeswarm, boxStats, kde, ranks } from "../src/layout/stats";
import { allocateCells } from "../src/charts/waffle";
import { TAU } from "../src/core/geometry";
import * as samples from "../src/spec/samples";

describe("squarify", () => {
  it("넓이가 값에 비례하고 상자를 꽉 채워요", () => {
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

describe("계층", () => {
  it("평평한 표(group), 경로(path), 중첩(children)", () => {
    const flat = buildTree(samples.treemapSample, { group: "category", label: "product", value: "share" });
    expect(flat.value).toBe(100);
    expect(flat.children.map((c) => c.label)).toEqual(["Running shoes", "Outdoor", "Apparel", "Gear"]);
    const path = buildTree([{ a: "x", b: "y", c: "z", v: 2 }], { path: ["a", "b"], label: "c", value: "v" });
    expect(leaves(path)[0].id).toBe("x/y/z");
    const nested = buildTree([{ label: "a", children: [{ label: "b", value: 3 }, { label: "c", value: 1 }] }], {});
    expect(nested.children[0].value).toBe(4);
  });
  it("partitionAngles는 한 바퀴를 나눠요", () => {
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
  it("노드가 영역 안에 있고 겹치지 않아요", () => {
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
  it("들어온 양과 나간 양이 같아요", () => {
    const mid = lay.nodes.find((n) => n.id === "Product page")!;
    const inV = mid.inLinks.reduce((a, l) => a + l.value, 0);
    const outV = mid.outLinks.reduce((a, l) => a + l.value, 0);
    expect(inV).toBe(outV);
    expect(lay.nodes.find((n) => n.id === "Purchase")!.layer).toBe(Math.max(...lay.nodes.map((n) => n.layer)));
  });
});

describe("chord", () => {
  it("그룹 각도 합 + 틈 = 한 바퀴", () => {
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
  it("zero와 expand", () => {
    const v = [
      [1, 2],
      [3, 2],
    ];
    expect(stack(v, "zero").y1[1]).toEqual([4, 4]);
    expect(stack(v, "expand").y1[1]).toEqual([100, 100]);
    expect(stack(v, "expand").y1[0]).toEqual([25, 50]);
  });
  it("wiggle은 두께를 지키고 insideOut은 순열이에요", () => {
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

describe("통계", () => {
  it("boxStats", () => {
    const st = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    expect(st.median).toBe(5.5);
    expect(st.outliers).toEqual([100]);
    expect(st.hi).toBe(9);
  });
  it("boxStats는 whiskers를 주면 그 백분위가 수염 끝이고, 밖의 값이 이상값이에요", () => {
    const st = boxStats(Array.from({ length: 100 }, (_, i) => i + 1), [5, 95]);
    expect(st.lo).toBeCloseTo(5.95, 10);
    expect(st.hi).toBeCloseTo(95.05, 10);
    expect(st.outliers).toEqual([1, 2, 3, 4, 5, 96, 97, 98, 99, 100]);
    expect(st.q1).toBe(boxStats(Array.from({ length: 100 }, (_, i) => i + 1)).q1);
  });
  it("kde는 넓이가 1에 가까워요", () => {
    const vals = Array.from({ length: 400 }, (_, i) => Math.sin(i) * 10 + 50);
    const xs = Array.from({ length: 400 }, (_, i) => i * 0.25);
    const d = kde(vals, xs);
    const area = d.reduce((a, v) => a + v * 0.25, 0);
    expect(area).toBeGreaterThan(0.95);
    expect(area).toBeLessThan(1.05);
  });
  it("beeswarm은 원이 겹치지 않아요", () => {
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
  it("beeswarm은 같은 x가 몰려도 겹치지 않아요 (두 원에 동시에 닿는 자리 포함)", () => {
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
  it("beeswarm 띠가 꽉 차면 넘친 점을 한계선에 쌓지 않고 띠 안에 흩어요", () => {
    const spread = 18;
    const ys = beeswarm(dense, 2, { maxSpread: spread });
    for (const y of ys) expect(Math.abs(y)).toBeLessThanOrEqual(spread + 1e-9);
    const onEdge = ys.filter((y) => Math.abs(Math.abs(y) - spread) < 1e-6).length;
    expect(onEdge).toBeLessThan(ys.length * 0.01);
    expect(ys.filter((y) => y > spread / 2).length).toBeGreaterThan(100);
    expect(ys.filter((y) => y < -spread / 2).length).toBeGreaterThan(100);
  });
  it("ranks는 같은 값을 같은 순위로", () => {
    expect(ranks([10, 30, 30, 5])).toEqual([3, 1, 1, 4]);
  });
  it("allocateCells는 합이 정확히 칸 수", () => {
    expect(allocateCells([33.3, 33.3, 33.4], 100).reduce((a, b) => a + b, 0)).toBe(100);
    expect(allocateCells([38, 62], 100)).toEqual([38, 62]);
  });
});
