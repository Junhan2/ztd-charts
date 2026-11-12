import type { KeyboardEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chart } from "../src/charts/Chart";
import { Tree } from "../src/charts/tree";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { textWidth } from "../src/core/text";
import { buildTree } from "../src/layout/hierarchy";
import { layoutSlots, preorder, stratify, type TreeIssue } from "../src/layout/tree";
import { renderSpecToSVG } from "../src/server";
import { CHARTS, parseCSV, suggestCharts, validateSpec } from "../src/spec";
import { treeSample } from "../src/spec/samples";

/** Same harness as tileMap.test.tsx: active sets the picked node, spy records setActive calls. frame is the last ChartFrame props */
const state = vi.hoisted(() => ({
  active: null as number | null,
  via: "pointer" as "pointer" | "keyboard",
  spy: false,
  calls: [] as [number | null, string | undefined][],
  frame: null as unknown,
}));

vi.mock("../src/core/useChart", async (orig) => {
  const actual = await orig<typeof import("../src/core/useChart")>();
  return {
    ...actual,
    useChart: (props: never, d: never) => {
      const c = actual.useChart(props, d);
      const out = state.spy ? { ...c, setActive: (i: number | null, via?: string) => void state.calls.push([i, via]) } : c;
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
const def = CHARTS.find((c) => c.type === "tree")!;
const draw = (data: Record<string, unknown>[], extra: Record<string, unknown> = {}) => r(<Tree data={data} width={720} animate={false} {...(extra as object)} />);
const sample = (extra: Record<string, unknown> = {}) => draw(treeSample, { group: "service", label: "screen", rootLabel: "Payments API", ...extra });
const key = (k: string) => ({ key: k, preventDefault() {} }) as unknown as KeyboardEvent<HTMLDivElement>;
const press = (k: string) => frame().onKey!(key(k));
const chain = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, parent: i ? `n${i - 1}` : "", label: `Step ${i + 1}` }));
const fan = (n: number) => [{ id: "root", label: "Root" }, ...Array.from({ length: n }, (_, i) => ({ id: `c${i}`, parent: "root", label: `Child ${i + 1}` }))];

interface Box {
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  hw: number;
  hh: number;
  text: string;
}
/** Drawn label boxes (rotated ones included). Text width is measured with textWidth, the same as the chart */
function boxes(svg: string): Box[] {
  return [...svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)" dy="0.35em"(?: transform="rotate\(([-\d.]+)[^"]*\)")? text-anchor="(\w+)" font-size="([\d.]+)" font-weight="(\d+)"[^>]*>([^<]*)<\/text>/g)]
    .filter((m) => !svg.slice(0, m.index).endsWith("<g pointer-events=\"none\">"))
    .map((m) => {
      const [x, y, rot, anchor, size, weight, raw] = [+m[1], +m[2], +(m[3] ?? 0), m[4], +m[5], +m[6], m[7]];
      const text = raw.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
      const w = textWidth(text, size, weight);
      const t = (rot * Math.PI) / 180;
      const k = anchor === "start" ? w / 2 : anchor === "end" ? -w / 2 : 0;
      return { cx: x + Math.cos(t) * k, cy: y + Math.sin(t) * k, ux: Math.cos(t), uy: Math.sin(t), hw: w / 2, hh: size * 0.5, text };
    });
}
function overlap(a: Box, b: Box): boolean {
  for (const [nx, ny] of [
    [a.ux, a.uy],
    [-a.uy, a.ux],
    [b.ux, b.uy],
    [-b.uy, b.ux],
  ]) {
    const ra = a.hw * Math.abs(a.ux * nx + a.uy * ny) + a.hh * Math.abs(-a.uy * nx + a.ux * ny);
    const rb = b.hw * Math.abs(b.ux * nx + b.uy * ny) + b.hh * Math.abs(-b.uy * nx + b.ux * ny);
    if (Math.abs((b.cx - a.cx) * nx + (b.cy - a.cy) * ny) >= ra + rb) return false;
  }
  return true;
}
/** Pairs of overlapping labels (labels on the highlighted path are always kept, so they are not checked against each other) */
const clashes = (svg: string) => {
  const list = boxes(svg);
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (overlap(list[i], list[j])) out.push(`${list[i].text} × ${list[j].text}`);
  return out;
};
/** Dots that overlap a label box (each dot taken as a square reaching out by its radius) */
const onDots = (svg: string) => {
  const dots = [...svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)" fill=/g)].map((m) => ({ cx: +m[1], cy: +m[2], ux: 1, uy: 0, hw: +m[3], hh: +m[3], text: "dot" }));
  return boxes(svg).filter((b) => dots.some((d) => overlap(b, d))).map((b) => b.text);
};
/** Only the drawn label text */
const names = (svg: string) => boxes(svg).map((b) => b.text);

describe("tree data", () => {
  it("group, path, nested children and id/parent rows give the same tree", () => {
    const shape = (root: ReturnType<typeof buildTree>) => preorder(root).map((n) => `${n.depth}:${n.label}:${n.value}`);
    const group = buildTree([{ g: "A", l: "a1", v: 1 }, { g: "A", l: "a2", v: 2 }, { g: "B", l: "b1", v: 3 }], { group: "g", label: "l", value: "v" });
    const path = buildTree([{ p: "A", l: "a1", v: 1 }, { p: "A", l: "a2", v: 2 }, { p: "B", l: "b1", v: 3 }], { path: ["p"], label: "l", value: "v" });
    const nested = buildTree([{ l: "A", children: [{ l: "a1", v: 1 }, { l: "a2", v: 2 }] }, { l: "B", children: [{ l: "b1", v: 3 }] }], { label: "l", value: "v" });
    const rows = stratify([{ id: "A" }, { id: "a1", parent: "A", v: 1 }, { id: "a2", parent: "A", v: 2 }, { id: "B" }, { id: "b1", parent: "B", v: 3 }], { value: "v" });
    expect(shape(group)).toEqual(["0:All:6", "1:A:3", "2:a1:1", "2:a2:2", "1:B:3", "2:b1:3"]);
    for (const t of [path, nested, rows]) expect(shape(t)).toEqual(shape(group));
  });

  it("id/parent rows: a repeated id, a missing parent, a self parent and a loop all still draw, each reported once", () => {
    const issues: TreeIssue[] = [];
    const rows = [
      { id: "a", parent: "" },
      { id: "b", parent: "a" },
      { id: "b", parent: "a", label: "b again" },
      { id: "c", parent: "c" },
      { id: "d", parent: "nowhere" },
      { id: "e", parent: "f" },
      { id: "f", parent: "e" },
      { id: "g", parent: "f" },
      { id: "h", parent: "b" },
    ];
    const root = stratify(rows, {}, "All", (x) => issues.push(x));
    expect(issues.map((x) => `${x.code}:${x.id}`)).toEqual(["duplicate_id:b", "cycle:c", "missing_parent:d", "cycle:e"]);
    const all = preorder(root);
    expect(all).toHaveLength(rows.length + 1);
    // The cycle is broken at e, so e goes under the root, f under e, g under f. The child of the duplicated id (h) goes under the first b
    expect(all.map((n) => n.id)).toEqual(["", "a", "a/b", "a/b/h", "a/b again", "c", "d", "e", "e/f", "e/f/g"]);
    // A chain 5000 deep too, without recursion
    expect(preorder(stratify(chain(5000), {})).at(-1)!.depth).toBe(5000);
  });

  it("leaf-ordered layout: subtrees take disjoint ranges in data order, parents sit halfway, folded branches take one slot", () => {
    const root = buildTree(treeSample, { group: "service", label: "screen" });
    const { nodes, slots, span, levels } = layoutSlots(root, () => false);
    expect(levels).toBe(2);
    // 23 leaves, plus half a slot each time the service changes (5 times)
    expect(span).toBe(25.5);
    for (const n of nodes) {
      if (!n.children.length) continue;
      const kids = n.children.map((ch) => slots.get(ch)!.slot);
      expect(kids).toEqual([...kids].sort((a, b) => a - b));
      expect(slots.get(n)!.slot).toBe((kids[0] + kids.at(-1)!) / 2);
    }
    const folded = layoutSlots(root, (n) => n.label === "Products");
    expect(folded.nodes).toHaveLength(nodes.length - 5);
    expect(folded.span).toBe(21.5);
  });
});

describe("Tree", () => {
  it("draws the path from each highlighted node to the root in the accent color, the rest quiet", () => {
    const h = sample({ highlight: ["Payment methods", "Renewal"] });
    const accentLinks = h.match(/<path d="[^"]+" stroke="var\(--ztd-accent[^"]*\)"/g) ?? [];
    // Payment methods: root → Account → Payment methods (2 links), Renewal: root → Subscriptions → Renewal (2 links)
    expect(accentLinks).toHaveLength(4);
    expect(h.match(/<circle [^>]*fill="var\(--ztd-accent[^"]*\)"/g)).toHaveLength(5);
    expect(sample()).not.toContain("--ztd-accent");
    // By path ("parent/child"), every match when names repeat, nothing for a missing name
    expect(sample({ highlight: "Account/Receipts" }).match(/<path d="[^"]+" stroke="var\(--ztd-accent/g)).toHaveLength(2);
    const twins = draw([{ g: "A", l: "Same" }, { g: "B", l: "Same" }, { g: "B", l: "Other" }], { group: "g", label: "l", highlight: "Same" });
    expect(twins.match(/<path d="[^"]+" stroke="var\(--ztd-accent/g)).toHaveLength(4);
    expect(sample({ highlight: "Nothing like it" })).not.toContain("--ztd-accent");
  });

  it("labels never overlap, at 280 and 390 px in both layouts, and the highlighted path keeps its labels", () => {
    const hi = ["Payment methods", "Receipts"];
    for (const layout of ["horizontal", "radial"])
      for (const width of [280, 390, 720]) {
        const h = sample({ layout, width, highlight: hi });
        expect(clashes(h), `${layout} ${width}`).toEqual([]);
        expect(onDots(h), `${layout} ${width} labels on dots`).toEqual([]);
        const shown = names(h);
        for (const name of ["Account", ...hi]) expect(shown.some((s) => name.startsWith(s.replace(/…$/, ""))), `${layout} ${width} ${name}`).toBe(true);
      }
    // 500 leaves under one parent: when room runs out labels are dropped, but the highlighted leaf keeps its label
    for (const layout of ["horizontal", "radial"]) {
      const h = draw(fan(500), { id: "id", parent: "parent", layout, highlight: "Child 250" });
      expect(clashes(h), layout).toEqual([]);
      expect(names(h)).toContain("Child 250");
      expect(names(h).length).toBeLessThan(200);
    }
    // A group of only spaces counts as no group; a label of only spaces is treated like an empty one, "#" plus the row number (the chart and the validator agree)
    const blank = draw([{ g: "Orders", l: "Checkout" }, { g: "  ", l: "Loose" }, { g: "Orders", l: "   " }], { group: "g", label: "l" });
    expect(names(blank)).toEqual(["All", "Orders", "Checkout", "#3", "Loose"]);
    expect(validateSpec({ type: "tree", data: [{ g: "  ", l: "Loose" }, { g: "A", l: "   " }], encoding: { group: "g", label: "l" }, options: { highlight: ["Loose", "A/#2"] } }).warnings).toEqual([]);
    // A very long label is shortened, and an empty label falls back to the id
    const long = draw([{ id: "r", label: "Root" }, { id: "x", parent: "r", label: "A very long label ".repeat(10) }, { id: "y", parent: "r", label: "" }], { id: "id", parent: "parent", width: 280 });
    expect(names(long).find((s) => s.startsWith("A very"))).toMatch(/…$/);
    expect(names(long)).toContain("y");
  });

  it("radial: height follows the content, inner labels stay level, links never bend back toward the centre", () => {
    const height = (h: string) => +h.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)![1];
    const small = sample({ layout: "radial" });
    const big = draw(fan(200), { id: "id", parent: "parent", layout: "radial" });
    expect(height(small)).toBeLessThan(height(big));
    // Service names (the first ring) are horizontal, unrotated text
    for (const name of ["Orders", "Account", "Search"]) expect(small, name).toMatch(new RegExp(`<text x="[-\\d.]+" y="[-\\d.]+" dy="0.35em" text-anchor="\\w+"[^>]*>${name}</text>`));
    // Points along a link only move away from the root (each cubic segment sampled at 0.1 steps)
    const root = small.match(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"/)!;
    const [rx, ry] = [+root[1], +root[2]];
    const paths = [...small.matchAll(/<path d="(M[^"]+)" stroke=/g)].map((m) => m[1]);
    expect(paths.length).toBe(29);
    for (const d of paths) {
      const nums = d.match(/-?[\d.]+/g)!.map(Number);
      let [x0, y0] = nums;
      let last = Math.hypot(x0 - rx, y0 - ry);
      for (let k = 2; k + 5 < nums.length + 1; k += 6) {
        const [x1, y1, x2, y2, x3, y3] = nums.slice(k, k + 6);
        for (let t = 0.1; t <= 1.001; t += 0.1) {
          const u = 1 - t;
          const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
          const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
          const dist = Math.hypot(x - rx, y - ry);
          expect(dist, d).toBeGreaterThanOrEqual(last - 0.6);
          last = dist;
        }
        [x0, y0] = [x3, y3];
      }
    }
  });

  it("radial labels read the right way up: rotation stays within ±90 degrees", () => {
    const h = sample({ layout: "radial" });
    const rot = [...h.matchAll(/rotate\(([-\d.]+) /g)].map((m) => +m[1]);
    expect(rot.length).toBeGreaterThan(10);
    for (const a of rot) expect(Math.abs(((a + 540) % 360) - 180)).toBeLessThanOrEqual(90.01);
  });

  it("radial: outer names use the card's room before they are shortened, and the root name stays whole", () => {
    const names = (width: number) => [...sample({ layout: "radial", width }).matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).filter(Boolean);
    // On the docs variant cards (403px on a 1280 screen, 483px on a 1440 screen) names used to be cut like "Start subscri…", "Notification sett…"
    for (const width of [403, 483]) expect(names(width).filter((t) => t.endsWith("…")), `${width}`).toEqual([]);
    // On a narrow card where the circle is at its minimum size, names are shortened, but the root name in the middle stays whole
    const narrow = names(357);
    expect(narrow.some((t) => t.endsWith("…"))).toBe(true);
    expect(narrow).toContain("Payments API");
  });

  it("a single node, a 50-deep chain, empty data and bad values draw without NaN, Infinity or undefined", () => {
    const outs = [
      draw([{ label: "Only" }]),
      draw(chain(50), { id: "id", parent: "parent", highlight: "Step 50" }),
      draw(chain(50), { id: "id", parent: "parent", layout: "radial" }),
      draw([]),
      draw([{ g: "A", l: "neg", v: -5 }, { g: "A", l: "zero", v: 0 }, { g: "A", l: "text", v: "n/a" }, { g: "B", l: "inf", v: Infinity }, { g: "B", l: "big", v: 1e12 }], { group: "g", label: "l", value: "v" }),
      draw([{ label: "x", children: [{ label: "y" }] }], { width: 0, height: -5 }),
    ];
    for (const h of outs) expect(h).not.toMatch(/NaN|Infinity|undefined/);
    expect(names(outs[0])).toEqual(["Only"]);
    expect(outs[3]).toContain("No data.");
    // The highlighted path runs to the end of the chain (49 links)
    expect(outs[1].match(/<path d="[^"]+" stroke="var\(--ztd-accent/g)).toHaveLength(49);
    // With values, dot size follows the value (clamped to 2.5~9px). Negatives, 0 and text get the smallest size
    const radii = [...outs[4].matchAll(/<circle [^>]*r="([\d.]+)"/g)].map((m) => +m[1]);
    expect(Math.min(...radii)).toBeGreaterThanOrEqual(1.2);
    expect(Math.max(...radii)).toBeLessThanOrEqual(9);
  });

  it("collapsed branches start folded on the server; a click or Enter unfolds them", () => {
    const h = sample({ collapsed: ["Products", "Search/Filters"] });
    expect(names(h)).toContain("Products");
    expect(names(h)).not.toContain("Catalog");
    // A collapsed branch has a ring around its dot (the leaf Filters has nothing to collapse, so it stays as is)
    expect(h.match(/r="[\d.]+" fill="none" stroke=/g)).toHaveLength(1);
    // Even when a collapsed branch lands in the rightmost leaf slot, its name fits (the right margin leaves room for the dot and the ring)
    expect(names(draw([{ label: "CEO", children: [{ label: "CTO", children: [{ label: "Platform" }] }, { label: "CFO" }] }], { collapsed: ["CTO"] }))).toEqual(["CEO", "CTO", "CFO"]);
    expect(renderSpecToSVG({ ...def.example, options: { ...def.example.options, collapsed: ["Products"] } })).toBe(renderSpecToSVG({ ...def.example, options: { ...def.example.options, collapsed: ["Products"] } }));
    // Keyboard: Enter on a collapsed node (it is useState, so the server render only shows the state; the folding is checked through the onClick event)
    const clicks: string[] = [];
    state.active = frame().events.findIndex((e) => e.label === "Products");
    state.via = "keyboard";
    sample({ collapsed: ["Products"], onClick: (e: { label: string }) => clicks.push(e.label) });
    expect(frame().announce).toBe("Products, under Payments API, 1 level below the root, 5 children, collapsed");
    expect(press("Enter")).toBe(true);
    expect(clicks).toEqual(["Products"]);
  });

  it("keyboard: left parent, right first child, up and down along the level; radial uses up and down for parent and child", () => {
    state.spy = true;
    state.via = "keyboard";
    const at = (label: string) => frame().events.findIndex((e) => e.label === label);
    const go = (layout: string, from: string, k: string) => {
      state.active = null;
      sample({ layout });
      state.active = at(from);
      state.calls = [];
      sample({ layout });
      press(k);
      const i = state.calls.at(-1)?.[0];
      return i === undefined || i === null ? undefined : frame().events[i].label;
    };
    expect([go("horizontal", "Checkout", "ArrowLeft"), go("horizontal", "Orders", "ArrowRight"), go("horizontal", "Orders", "ArrowDown"), go("horizontal", "Order history", "ArrowDown"), go("horizontal", "Payments API", "ArrowLeft")]).toEqual(["Orders", "Checkout", "Subscriptions", "Start subscription", undefined]);
    expect([go("radial", "Checkout", "ArrowUp"), go("radial", "Orders", "ArrowDown"), go("radial", "Orders", "ArrowRight"), go("radial", "Subscriptions", "ArrowLeft")]).toEqual(["Orders", "Checkout", "Subscriptions", "Orders"]);
    // With nothing picked, an arrow key goes to the root
    state.active = null;
    sample();
    state.calls = [];
    press("ArrowDown");
    expect(state.calls).toEqual([[0, "keyboard"]]);
  });

  it("narration, tooltip, table and description name the parent, the depth and the children", () => {
    state.active = 0;
    state.via = "keyboard";
    sample({ value: "users", highlight: "Receipts" });
    const ev = frame().events;
    const pm = ev.find((e) => e.label === "Payment methods")!;
    expect(pm.formatted).toBe("under Account, 2 levels below the root, 0 children, Value 11");
    expect(frame().announce).toBe("Payments API, root, 6 children, Value 461");
    expect(frame().tip!.rows.map((x) => `${x.label}=${x.value}`)).toEqual(["Level=root", "Children=6", "Value=461"]);
    expect(frame().description).toBe("Tree. 30 nodes in 2 levels below Payments API: Orders (4), Subscriptions (3), Account (4), Support (4), Search (3), Products (5). Highlighted: Receipts.");
    r(<Tree data={treeSample} group="service" label="screen" width={480} animate={false} locale="ko" />);
    expect(frame().events[2].formatted).toBe("Orders 아래, 뿌리에서 2단계, 자식 0개");
    expect(frame().description).toMatch(/^트리\. 전체 아래 2단계, 노드 30개/);
  });

  it("one dataset switches between treemap, sunburst and tree", () => {
    const spec = { data: treeSample, encoding: { group: "service", label: "screen", value: "users" } };
    for (const type of ["treemap", "sunburst", "tree"]) {
      expect(validateSpec({ type, ...spec }).errors, type).toEqual([]);
      expect(r(<Chart spec={{ type, ...spec, options: { width: 480, animate: false } }} />)).toContain("Checkout");
    }
  });

  it("server output is deterministic and has no per-node motion attributes for 5,000 nodes", () => {
    let seed = 3;
    const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const rows = [{ id: "0", parent: "", label: "Root" }];
    for (let i = 1; i < 5000; i++) rows.push({ id: String(i), parent: String(Math.floor(rand() * Math.min(i, 800))), label: `Node ${i}` });
    const t0 = performance.now();
    const a = draw(rows, { id: "id", parent: "parent" });
    const ms = performance.now() - t0;
    expect(draw(rows, { id: "id", parent: "parent" })).toBe(a);
    expect(a.match(/<circle /g)!.length).toBe(5000);
    expect(clashes(a)).toEqual([]);
    // A generous limit (this Mac's speed swings 2 to 5 times under load). The comparison with a sunburst of the same data goes in the PR
    expect(ms).toBeLessThan(3000);
  });
});

describe("validateSpec for tree", () => {
  const spec = (data: unknown[], encoding: Record<string, string>, options: Record<string, unknown> = {}) => validateSpec({ type: "tree", data, encoding, options });
  const codes = (v: ReturnType<typeof validateSpec>) => v.warnings.map((w) => w.code);
  it("reports id/parent problems, negative values and names that match no node, and still draws", () => {
    const rows = [
      { id: "a", parent: "", label: "A", v: 1 },
      { id: "a", parent: "", label: "A2", v: -1 },
      { id: "b", parent: "zz", label: "B", v: 1 },
      { id: "c", parent: "c", label: "C", v: 1 },
    ];
    const v = spec(rows, { label: "label", id: "id", parent: "parent", value: "v" }, { highlight: ["A", "Nope"], collapsed: ["Zzz"] });
    expect(v.valid).toBe(true);
    expect(codes(v)).toEqual(["tree_duplicate_id", "tree_missing_parent", "tree_cycle", "tree_negative_value", "highlight_not_found", "collapsed_not_found"]);
    expect(v.warnings.find((w) => w.code === "highlight_not_found")!.message).toContain('"Nope"');
    // Paths, names, highlight keywords and the root name all count as matches
    expect(codes(spec(treeSample, { group: "service", label: "screen" }, { rootLabel: "API", highlight: ["Account/Receipts", "Orders", "max", "API"] }))).toEqual([]);
    expect(codes(spec(treeSample, { group: "service", label: "screen", parent: "service" }))).toContain("tree_parent_wins");
    // A path column whose names contain "/" ("src/layout") is matched as a path too
    expect(codes(spec([{ path: "src/layout", name: "tree.ts" }], { label: "name" }, { path: ["path"], highlight: "src/layout/tree.ts" }))).toEqual([]);
    // A path matches only under its real parent (Checkout is under Orders, so there is no Search/Checkout)
    expect(codes(spec(treeSample, { group: "service", label: "screen" }, { highlight: "Search/Checkout" }))).toEqual(["highlight_not_found"]);
    expect(validateSpec(def.example).warnings).toEqual([]);
  });
});

describe("suggestCharts for tree", () => {
  it("id and parent columns suggest a tree first; a two-level table lists a tree after the treemap", () => {
    const org = suggestCharts(parseCSV("id,parent,name\n1,,CEO\n2,1,CTO\n3,1,CFO\n4,2,Platform\n5,2,Apps"));
    expect(org.suggestions[0]).toMatchObject({ type: "tree", spec: { encoding: { label: "name", id: "id", parent: "parent" } } });
    expect(validateSpec(org.suggestions[0].spec).warnings).toEqual([]);
    const types = suggestCharts(treeSample).suggestions.map((x) => x.type);
    expect(types.indexOf("tree")).toBeGreaterThan(types.indexOf("treemap"));
  });
});
