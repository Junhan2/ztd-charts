import { useMemo, useState } from "react";
import { ChartFrame } from "../core/ChartFrame";
import { clamp, polar, TAU } from "../core/geometry";
import { HIGHLIGHT_KEYWORDS, resolveHighlight } from "../core/highlight";
import { plural, type ChartLang } from "../core/i18n";
import type { Mark } from "../core/motion";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Highlight, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { buildTree, sortTree, type TreeNode } from "../layout/hierarchy";
import { drawnRoot, dropBlankNames, findNodes, layoutSlots, preorder, stratify } from "../layout/tree";

const en = {
  kind: "Tree",
  all: "All",
  root: "root",
  under: (p: string) => `under ${p}`,
  below: (d: number) => `${plural(d, "level")} below the root`,
  kids: (n: number) => plural(n, "child", "children"),
  collapsed: "collapsed",
  tipUnder: "Under",
  tipLevel: "Level",
  tipKids: "Children",
  desc: (n: number, levels: number, root: string) => `${plural(n, "node")} in ${plural(levels, "level")} below ${root}`,
  hi: "Highlighted:",
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "트리",
    all: "전체",
    root: "뿌리",
    under: (p) => `${p} 아래`,
    below: (d) => `뿌리에서 ${d}단계`,
    kids: (n) => `자식 ${n}개`,
    collapsed: "접힘",
    tipUnder: "부모",
    tipLevel: "단계",
    tipKids: "자식",
    desc: (n, levels, root) => `${root} 아래 ${levels}단계, 노드 ${n}개`,
    hi: "강조:",
  },
};

export interface TreeProps<T = Row> extends BaseChartProps<T> {
  /** Node name field. Default "label" */
  label?: Accessor<T, string>;
  /** Value field. When given, dot size follows the value (summed upward from the leaves). Without it, dots are the same size at each level */
  value?: Accessor<T, number>;
  /** Parent group field (a flat table, as in the treemap and sunburst) */
  group?: Accessor<T, string>;
  /** List of multi-level path fields (same as the treemap and sunburst) */
  path?: string[];
  /** Children field of nested data. Default "children" */
  children?: string;
  /** id field of id/parent rows. Default "id", falling back to the name */
  id?: Accessor<T, string>;
  /** Parent id field. When given, the data is read as an id/parent table with one node per row */
  parent?: Accessor<T, string>;
  /** "horizontal" (root on the left) | "radial" (root in the center). Default "horizontal" */
  layout?: "horizontal" | "radial";
  /** Sort siblings largest value first. Default false (data order) */
  sort?: boolean;
  /** Name of the root added when there are several top-level nodes. Default "All" ("전체" in the Korean locale) */
  rootLabel?: string;
  /** Branches to start collapsed (names, or paths joined with "/"). The server render collapses them too */
  collapsed?: readonly string[];
}

/** Default radial height: minimum ring width per level and minimum arc length per leaf (px) */
const RING_MIN = 60;
/** In wide cards (chart width over 560px), widen each level's ring up to 100px so even a small tree uses the space. Narrow cards are unchanged */
const ringFor = (w: number) => (w > 560 ? Math.min(100, RING_MIN + (w - 560) / 2.5) : RING_MIN);
const ARC_MIN = 18;
/**
 * How far leaf names reach outside the circle in a radial tree (px): top, bottom, left, right. Measured per leaf from its angle and name width (+ 22px for the dot and spacing), each name capped at cap (px)
 * (longer names are shortened; fitRadial picks cap so the rings do not get too thin).
 * Sides with shorter names reserve less, so the circle fills the box and its center sits at the center of the content
 */
function radialExtents(leaves: readonly { a: number; w: number }[], cap: number): { top: number; bottom: number; left: number; right: number } {
  const e = { top: 12, bottom: 12, left: 12, right: 12 };
  for (const { a, w } of leaves) {
    const len = Math.min(w + 22, cap);
    const sx = Math.sin(a);
    const cy = -Math.cos(a);
    const ex = Math.abs(sx) * len + Math.abs(cy) * 7;
    const ey = Math.abs(cy) * len + Math.abs(sx) * 7;
    if (sx >= 0) e.right = Math.max(e.right, ex);
    if (sx <= 0) e.left = Math.max(e.left, ex);
    if (cy <= 0) e.top = Math.max(e.top, ey);
    if (cy >= 0) e.bottom = Math.max(e.bottom, ey);
  }
  return e;
}
/** Lower bound of the circle: ring width per level (px). Widening the name room stops before rings get thinner than this (any thinner and the root name in the center runs into the first ring's dots and gets shortened) */
const RING_FLOOR = 48;
/** Room one leaf name may take (as a share of the chart width). The first is the default; when names get cut, the next share is tried */
const SHARES = [0.2, 0.24, 0.28, 0.34, 0.4];
type Leaf = { a: number; w: number };
interface RadialFit {
  e: ReturnType<typeof radialExtents>;
  R: number;
  cx: number;
  cy: number;
  h: number;
}

/** The circle when the name room is share: without a set height, the height follows the default rule (a ringFor ring per level) */
function radialAt(leaves: readonly Leaf[], levels: number, span: number, w: number, share: number, fixedH?: number): RadialFit {
  const e = radialExtents(leaves, w * share);
  const h = fixedH ?? clamp(2 * clamp(Math.max(levels * ringFor(w), (span * ARC_MIN) / TAU), 24, (w - e.left - e.right) / 2 - 4) + e.top + e.bottom + 8, 160, 680);
  const R = Math.max(16, Math.min(w - e.left - e.right, h - e.top - e.bottom) / 2 - 4);
  return { e, R, cx: (e.left + w - e.right) / 2, cy: (e.top + h - e.bottom) / 2, h };
}

/** Number of outer-ring leaf names that do not fit along their spoke up to the card edge (same position math as label placement) */
function cutLeaves(leaves: readonly Leaf[], f: RadialFit, w: number): number {
  const inset = FS * 0.5 + 2;
  let n = 0;
  for (const { a, w: tw } of leaves) {
    const ux = Math.sin(a);
    const uy = -Math.cos(a);
    const px = f.cx + ux * (f.R + 8);
    const py = f.cy + uy * (f.R + 8);
    const room = Math.min(ux > 1e-6 ? (w - inset - px) / ux : ux < -1e-6 ? (inset - px) / ux : Infinity, uy > 1e-6 ? (f.h - inset - py) / uy : uy < -1e-6 ? (inset - py) / uy : Infinity);
    if (room < tw) n++;
  }
  return n;
}

/**
 * Radial layout. The leaf name room starts at 20% of the width; when names get cut, the room widens (and the circle shrinks), picking the smallest room that reduces the cut names.
 * It stops when the circle would fall below its lower bound (RING_FLOOR per level, ARC_MIN of arc per leaf). Wide cards where every name fits look as before
 */
function fitRadial(leaves: readonly Leaf[], levels: number, span: number, w: number, fixedH?: number): RadialFit {
  const floor = Math.max(levels * RING_FLOOR, (span * ARC_MIN) / TAU);
  let best = radialAt(leaves, levels, span, w, SHARES[0], fixedH);
  let cut = cutLeaves(leaves, best, w);
  for (let i = 1; i < SHARES.length && cut > 0; i++) {
    const f = radialAt(leaves, levels, span, w, SHARES[i], fixedH);
    if (f.R < floor) break;
    const k = cutLeaves(leaves, f, w);
    if (k < cut) [best, cut] = [f, k];
  }
  return best;
}
/** Angle and name width of each leaf that gets an outer name (a node with no children, or a collapsed one) */
function leafAngles<T>(lay: { nodes: TreeNode<T>[]; slots: Map<TreeNode<T>, { slot: number }>; span: number }, root: TreeNode<T>, isShut: (nd: TreeNode<T>) => boolean) {
  return lay.nodes.filter((nd) => nd !== root && (!nd.children.length || isShut(nd))).map((nd) => ({ a: ((lay.slots.get(nd)!.slot + 0.5) / lay.span) * TAU, w: textWidth(nd.label, FS, 600) }));
}

/** Above this many nodes, nodes do not move one by one but appear all at once (so thousands are not redrawn every frame) */
const MOVE_MAX = 1500;
const FS = 11;
/** One leaf row of the default horizontal height (px). 11px names read comfortably, and the gallery card ends up about as tall as its neighbors */
const ROW = 15;
const ROOT_FS = 12;

interface NodeInfo<T> {
  nd: TreeNode<T>;
  key: string;
  parentKey: string | null;
  depth: number;
  /** Target in screen coordinates */
  x: number;
  y: number;
  /** Angle and radius when radial */
  a: number;
  r: number;
  dot: number;
  open: boolean;
  path: boolean;
}

interface LabelPose {
  x: number;
  y: number;
  rot: number;
  anchor: "start" | "middle" | "end";
}

interface Placed {
  text: string;
  size: number;
  weight: number;
  /** Index among the positions returned by posesOf */
  k: number;
}

/** Whether two rotated rectangles overlap (separating axis test) */
interface OBB {
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  hw: number;
  hh: number;
}
function obbOverlap(a: OBB, b: OBB): boolean {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  for (const [nx, ny] of [
    [a.ux, a.uy],
    [-a.uy, a.ux],
    [b.ux, b.uy],
    [-b.uy, b.ux],
  ]) {
    const ra = a.hw * Math.abs(a.ux * nx + a.uy * ny) + a.hh * Math.abs(-a.uy * nx + a.ux * ny);
    const rb = b.hw * Math.abs(b.ux * nx + b.uy * ny) + b.hh * Math.abs(-b.uy * nx + b.ux * ny);
    if (Math.abs(dx * nx + dy * ny) > ra + rb) return false;
  }
  return true;
}
function boxOf(pose: LabelPose, w: number, size: number): OBB {
  const t = (pose.rot * Math.PI) / 180;
  const ux = Math.cos(t);
  const uy = Math.sin(t);
  const k = pose.anchor === "start" ? w / 2 : pose.anchor === "end" ? -w / 2 : 0;
  return { cx: pose.x + ux * k, cy: pose.y + uy * k, ux, uy, hw: w / 2 + 1.5, hh: size * 0.5 + 0.5 };
}
const f1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Tree: parent-child links drawn as dots and curves. Takes the same data as the treemap and sunburst (group, path, children), as well as id/parent rows.
 * Only the path from the highlighted node to the root gets the accent color. Click a node or press Enter to collapse or expand its branch
 */
export function Tree<T = Row>(props: TreeProps<T>) {
  const radial = props.layout === "radial";
  const full = useMemo(() => {
    // The same shapes as the treemap and sunburst (group, path, children), or id/parent rows when parent is set
    const acc = { label: props.label, value: props.value, group: props.group, path: props.path, children: props.children, id: props.id, parent: props.parent };
    const r = props.parent !== undefined ? stratify(props.data, acc, "") : buildTree(props.data, acc, "");
    if (props.parent === undefined) dropBlankNames(r, props.data);
    if (props.sort) sortTree(r);
    return r;
  }, [props.data, props.label, props.value, props.group, props.path, props.children, props.id, props.parent, props.sort]);
  const root = drawnRoot(full);
  const empty = !root.children.length && root === full;
  // Order and key of every node (including inside collapsed branches). Shared by highlight indexes, collapse state and animation keys
  const all = useMemo(() => (empty ? [] : preorder(root)), [root, empty]);
  const keyOf = useMemo(() => {
    const seen = new Map<string, number>();
    const out = new Map<TreeNode<T>, string>();
    for (const nd of all) {
      const n = (seen.get(nd.id) ?? 0) + 1;
      seen.set(nd.id, n);
      out.set(nd, n > 1 ? `${nd.id}#${n}` : nd.id);
    }
    return out;
  }, [all]);

  // Collapse: the symmetric difference between the initially collapsed branches (props.collapsed, same as the server) and the branches the user toggled (key)
  const collapsedSig = (props.collapsed ?? []).join("\u0001");
  const initial = useMemo(
    () => new Set((Array.isArray(props.collapsed) ? props.collapsed : []).flatMap((name) => findNodes(all, String(name)).map((i) => all[i]))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, collapsedSig],
  );
  const [flips, setFlips] = useState<ReadonlySet<string>>(() => new Set());
  const shut = (nd: TreeNode<T>) => nd.children.length > 0 && initial.has(nd) !== flips.has(keyOf.get(nd) ?? "");
  // The height is set from the initial collapse state, so the card height does not jump when collapsing or expanding
  // The radial diameter is the content-driven radius (RING_MIN per level, ARC_MIN of arc per leaf) plus the leaf name room. A small tree does not leave a large card empty
  const first = useMemo(() => {
    const l = layoutSlots(root, (nd) => initial.has(nd));
    return { span: l.span, levels: l.levels, leaves: radial ? leafAngles(l, root, (nd) => initial.has(nd)) : [] };
  }, [root, initial, radial]);
  const c = useChart(props, {
    height: (w) => {
      if (!radial) return clamp(first.span * ROW + 24, 120, Math.max(320, Math.min(900, w * 1.25)));
      return fitRadial(first.leaves, first.levels, first.span, w).h;
    },
    duration: 900,
  });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];
  const rootName = root === full ? props.rootLabel || msg.all : root.label;
  const nameOf = (nd: TreeNode<T>) => (nd === full ? rootName : nd.label);
  const hasValue = props.value !== undefined;

  const lay = useMemo(
    () => (empty ? { nodes: [] as TreeNode<T>[], slots: new Map(), span: 1, levels: 0 } : layoutSlots(root, shut)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [root, empty, initial, flips, keyOf],
  );
  const rootDepth = root.depth;
  const levelsAll = useMemo(() => all.reduce((m, nd) => Math.max(m, nd.depth - rootDepth), 0), [all, rootDepth]);

  // Highlight: names and paths are searched among all nodes; indexes and keywords like "max" go through resolveHighlight (values compare leaves only)
  const onPath = useMemo(() => {
    const h = props.highlight as Highlight<T> | undefined;
    const hit = new Set<TreeNode<T>>();
    if (h != null && all.length) {
      const list = typeof h === "function" ? null : Array.isArray(h) ? h : [h];
      const isName = (x: unknown): x is string => typeof x === "string" && !HIGHLIGHT_KEYWORDS.includes(x);
      // The added root can be found by its label too (same as validateSpec)
      if (list) for (const x of list) if (isName(x)) for (const i of [...(root === full && x === rootName ? [0] : []), ...findNodes(all, x)]) hit.add(all[i]);
      const rest = list?.filter((x) => !isName(x));
      if (!rest || rest.length)
        for (const i of resolveHighlight((rest ?? h) as Highlight<T>, all.map((nd) => nd.datum as T), all.map((nd) => nd.label), all.map((nd) => (nd.children.length ? NaN : nd.value)), "none")) hit.add(all[i]);
    }
    const path = new Set<TreeNode<T>>();
    for (const nd of hit) for (let q: TreeNode<T> | null = nd; q && !path.has(q); q = q === root ? null : q.parent) path.add(q);
    return { hit, path };
  }, [props.highlight, all, root, full, rootName]);

  // Positions (targets). Horizontal: x is depth, y is leaf order. Radial: angle is leaf order, radius is depth
  const geo = useMemo(() => {
    const { nodes, slots, span, levels } = lay;
    const visibleLeaf = (nd: TreeNode<T>) => !nd.children.length || shut(nd);
    let maxLeaf = 0;
    for (const nd of nodes) if (visibleLeaf(nd) && nd !== root) maxLeaf = Math.max(maxLeaf, textWidth(nd.label, FS, 600));
    const rootW = textWidth(rootName, ROOT_FS, 700);
    let cx = W / 2;
    let cy = H / 2;
    let x0 = 0;
    let colW = 0;
    let rowH = 0;
    let ring = 0;
    let spacing: number;
    if (radial) {
      // Fill the box left after the leaf name room with the circle, centered
      // The cap on the name room is measured from the width, as when setting the default height (measured from the height, names would shrink more in short cards)
      const fit = fitRadial(leafAngles(lay, root, shut), levels, span, W, H);
      const R = fit.R;
      cx = fit.cx;
      cy = fit.cy;
      ring = R / Math.max(1, levels);
      spacing = Math.min(ring, (R * TAU) / span);
    } else {
      x0 = levels ? clamp(rootW + 16, 24, W * 0.28) : 10;
      const right = clamp(maxLeaf + 22, 24, W * 0.4);
      colW = Math.max(8, (W - x0 - right) / Math.max(1, levels));
      rowH = (H - 8) / span;
      spacing = Math.min(rowH, colW);
    }
    const cap = clamp(spacing * 0.42, 1.2, 9);
    // Values: a square-root scale from 2.5 to 9px (within the spacing). The root holds the total, so it is the largest
    const lo = Math.min(2.5, cap);
    const hi = Math.max(lo, Math.min(9, spacing * 0.48));
    let maxV = 0;
    if (hasValue) for (const nd of nodes) if (nd !== root) maxV = Math.max(maxV, nd.value);
    const info = new Map<TreeNode<T>, NodeInfo<T>>();
    for (const nd of nodes) {
      const s = slots.get(nd)!;
      const a = ((s.slot + 0.5) / span) * TAU;
      const r = s.depth * ring;
      const [x, y] = radial ? polar(cx, cy, r, a) : [x0 + s.depth * colW, 4 + (s.slot + 0.5) * rowH];
      const isRoot = nd === root;
      const dot = hasValue ? (isRoot ? hi : maxV <= 0 ? lo : lo + (hi - lo) * Math.sqrt(clamp(nd.value / maxV, 0, 1))) : Math.min(isRoot ? 5.5 : nd.children.length ? 4 : 3, cap);
      info.set(nd, { nd, key: keyOf.get(nd) ?? nd.id, parentKey: isRoot || !nd.parent ? null : (keyOf.get(nd.parent) ?? null), depth: s.depth, x, y, a, r, dot, open: !shut(nd) && nd.children.length > 0, path: onPath.path.has(nd) });
    }
    return { info, cx, cy, ring, colW, levels };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lay, W, H, radial, rootName, hasValue, keyOf, onPath, root]);

  /**
   * Candidate positions for a node name (earlier first). room is the width available at the target position.
   * Horizontal: leaves to the right, branches to the left, then above. Radial: leaves outside, branches inside, then below and above (horizontal text); the left half is flipped so it reads upright
   */
  const posesOf = (n: NodeInfo<T>, x: number, y: number, a: number, rr: number): { pose: LabelPose; room: number }[] => {
    const isRoot = n.nd === root;
    const flat = (dy: number, anchor: LabelPose["anchor"], dx = 0, room = Infinity) => ({ pose: { x: x + dx, y: y + dy, rot: 0, anchor }, room: Math.min(room, anchor === "middle" ? 2 * Math.min(x, W - x) - 4 : anchor === "start" ? W - x - dx - 2 : x + dx - 2) });
    const up = -n.dot - 9;
    if (!radial) {
      // Collapsed branches: outside the ring around the dot (3px)
      if (!n.open) return [flat(0, "start", n.dot + (n.nd.children.length ? 8 : 5))];
      // The upper position stays readable over lines thanks to its background-color outline. Overlaps with other names are settled by the overlap check
      return isRoot ? [flat(0, "end", -n.dot - 5), flat(up, "start", -n.dot)] : [flat(0, "end", -n.dot - 5, geo.colW - n.dot - 13), flat(up, "middle", 0, geo.colW * 2)];
    }
    // Root and branches: horizontal text below the dot, above, beside it on the outside, then on the inside (branches finally inward along the spoke)
    const side = Math.sin(a) >= 0 ? 1 : -1;
    const level = (room: number) => [flat(n.dot + 10, "middle", 0, room), flat(up, "middle", 0, room), flat(0, side > 0 ? "start" : "end", side * (n.dot + 6), room), flat(0, side > 0 ? "end" : "start", -side * (n.dot + 6), room)];
    if (isRoot) return level(180);
    const right = a < Math.PI;
    const deg = (a * 180) / Math.PI;
    const rot = right ? deg - 90 : deg + 90;
    if (!n.open) {
      // Names reaching outward: up to the card edge (longer toward the corners)
      const [px, py] = polar(geo.cx, geo.cy, rr + n.dot + (n.nd.children.length ? 8 : 5), a);
      const ux = Math.sin(a);
      const uy = -Math.cos(a);
      const inset = FS * 0.5 + 2;
      const room = Math.min(ux > 1e-6 ? (W - inset - px) / ux : ux < -1e-6 ? (inset - px) / ux : Infinity, uy > 1e-6 ? (H - inset - py) / uy : uy < -1e-6 ? (inset - py) / uy : Infinity);
      return [{ pose: { x: px, y: py, rot, anchor: right ? "start" : "end" }, room }];
    }
    // Inward along the spoke: up to the parent's ring (for the first level, up to the root dot)
    const [px, py] = polar(geo.cx, geo.cy, rr - n.dot - 5, a);
    const inner = n.depth === 1 ? (geo.info.get(root)?.dot ?? 5) + 8 : 8;
    return [...level(Math.min(geo.ring * 1.6, 160)), { pose: { x: px, y: py, rot, anchor: right ? "end" : "start" }, room: geo.ring - n.dot - 5 - inner }];
  };

  // Picking names: the highlighted path first (always kept), then the root, then shallow levels first. For each position, first check whether the full name fits without overlap,
  // and if not, try again with a shortened name. Names that overlap placed names or leave the card are dropped (the highlighted path is kept at its first position, shortened if needed)
  const labels = useMemo(() => {
    const out = new Map<TreeNode<T>, Placed>();
    if (!c.showLabels) return out;
    const list = [...geo.info.values()];
    const rank = (n: NodeInfo<T>) => (n.path ? 0 : n.nd === root ? 1 : 2);
    list.sort((A, B) => rank(A) - rank(B) || A.depth - B.depth);
    // Bucket placed boxes into 40px cells and check only nearby cells (linear even with thousands of nodes)
    const CELL = 40;
    const grid = new Map<number, OBB[]>();
    const cells = (b: OBB, fn: (k: number) => boolean | void) => {
      const ex = Math.abs(b.ux) * b.hw + Math.abs(b.uy) * b.hh;
      const ey = Math.abs(b.uy) * b.hw + Math.abs(b.ux) * b.hh;
      for (let gx = Math.floor((b.cx - ex) / CELL); gx <= Math.floor((b.cx + ex) / CELL); gx++)
        for (let gy = Math.floor((b.cy - ey) / CELL); gy <= Math.floor((b.cy + ey) / CELL); gy++) if (fn(gx * 100003 + gy)) return true;
      return false;
    };
    const hits = (b: OBB) => cells(b, (k) => grid.get(k)?.some((o) => obbOverlap(o, b)));
    const outside = (b: OBB) => {
      const ex = Math.abs(b.ux) * b.hw + Math.abs(b.uy) * b.hh;
      const ey = Math.abs(b.uy) * b.hw + Math.abs(b.ux) * b.hh;
      return b.cx - ex < -1 || b.cx + ex > W + 1 || b.cy - ey < -1 || b.cy + ey > H + 1;
    };
    // Add the dots (with the ring for collapsed branches) first too, so names do not cover them
    for (const n of list) {
      const r = n.dot + (n.nd.children.length && !n.open ? 3 : 0) + 1;
      const box: OBB = { cx: n.x, cy: n.y, ux: 1, uy: 0, hw: r, hh: r };
      cells(box, (k) => void (grid.get(k) ?? grid.set(k, []).get(k)!).push(box));
    }
    for (const n of list) {
      const isRoot = n.nd === root;
      const size = isRoot ? ROOT_FS : FS;
      const weight = n.path || isRoot ? 700 : n.nd.children.length ? 600 : 500;
      const cands = posesOf(n, n.x, n.y, n.a, n.r);
      const name = nameOf(n.nd);
      const fullW = textWidth(name, size, weight);
      let pick: { k: number; text: string; box: OBB } | null = null;
      for (let pass = 0; pass < 2 && !pick; pass++)
        for (let k = 0; k < cands.length && !pick; k++) {
          const text = pass === 0 ? (fullW <= cands[k].room ? name.trim() : "") : truncate(name, cands[k].room, size, weight);
          // Names shortened to about three letters ("Nod…") are unreadable, so drop them (the highlighted path is handled separately below)
          if (!text || (text !== name.trim() && text.length < 5)) continue;
          const box = boxOf(cands[k].pose, textWidth(text, size, weight), size);
          if (!outside(box) && !hits(box)) pick = { k, text, box };
        }
      // The highlighted path is always kept: try the full name and progressively shorter names at each position, and keep the one with the fewest overlapping boxes (names, dots), then the longest
      if (!pick && n.path) {
        let best = Infinity;
        cands.forEach((cand, k) => {
          for (const f of [1, 0.75, 0.55, 0.4]) {
            const text = f === 1 ? name.trim() : truncate(name, Math.max(fullW * f, 30), size, weight) || name.trim();
            const box = boxOf(cand.pose, textWidth(text, size, weight), size);
            const seen = new Set<OBB>();
            cells(box, (key) => void grid.get(key)?.forEach((o) => obbOverlap(o, box) && seen.add(o)));
            const cost = seen.size * 1000 + (outside(box) ? 2000 : 0) - text.length;
            if (cost < best) [best, pick] = [cost, { k, text, box }];
          }
        });
      }
      if (!pick) continue;
      const box = pick.box;
      cells(box, (k) => void (grid.get(k) ?? grid.set(k, []).get(k)!).push(box));
      out.set(n.nd, { text: pick.text, size, weight, k: pick.k });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, c.showLabels, W, H, radial]);

  // Motion: the root stays in place; every other node animates its offset from its parent (dx, dy when horizontal; angle and radius differences when radial).
  // So links always stay attached to their parent, grow out of the root on entrance, and continue from where they are when collapsing or expanding
  const D = c.motion.duration ?? 900;
  const big = lay.nodes.length > MOVE_MAX;
  const step = Math.min(220, 1200 / Math.max(1, geo.levels));
  const pre = radial ? "r:" : "h:";
  const marks = useMemo<Mark<NodeInfo<T> | null>[]>(() => {
    const ms: Mark<NodeInfo<T> | null>[] = [];
    for (const n of geo.info.values()) {
      const par = n.nd === root || !n.nd.parent ? null : geo.info.get(n.nd.parent);
      if (!par) {
        ms.push({ key: pre + n.key, to: radial ? [0, 0] : [n.x, n.y], data: n });
        continue;
      }
      // In a radial tree the first level keeps its angle (the root's angle is 0) and only its radius grows from 0
      const fromRoot = radial && par.nd === root;
      const to = radial ? [n.a - (fromRoot ? 0 : par.a), n.r - par.r] : [n.x - par.x, n.y - par.y];
      const zero = fromRoot ? [n.a, 0] : [0, 0];
      ms.push({ key: pre + n.key, to, from: big ? undefined : zero, enter: zero, exit: zero, delay: big ? 0 : (n.depth - 1) * step, data: n });
    }
    if (big) ms.push({ key: "__fade", to: [1], from: [0], data: null });
    return ms;
  }, [geo, root, radial, pre, big, step]);
  const m = useMotion(marks, { ...c.motion, dataKey: `${c.sig}|${collapsedSig}|${[...flips].join("\u0001")}` });
  const moving = m.animating || m.waiting;
  // In a large tree's entrance, nodes do not move but appear all at once (only __fade animates). Meanwhile the positions and base layer are not rebuilt every frame.
  // They are rebuilt while nodes move, as when collapsing or expanding
  const nodesMoving = moving && (!big || m.items.some((it) => it.data && it.progress < 1));

  // Current positions (screen coordinates). Recomputed every frame only while moving
  const pos = useMemo(() => {
    const cur = new Map<string, { v: number[]; n: NodeInfo<T>; exiting: boolean; grow: number }>();
    // Skip keys from the other layout (horizontal, radial). Right after switching layouts, both sets can be present
    for (const it of m.items) if (it.data && it.key.startsWith(pre)) cur.set(it.key.slice(pre.length), { v: it.v, n: it.data, exiting: it.exiting, grow: it.progress });
    // (x, y) when horizontal, (angle, radius) when radial. The root uses its own position; every other node is its parent's position + its offset.
    // Nodes whose parent is already gone (exiting after a data change) attach to the root position
    const anchor: [number, number] = radial ? [0, 0] : [geo.info.get(root)?.x ?? 0, geo.info.get(root)?.y ?? 0];
    const at = new Map<string, [number, number]>();
    const resolve = (key: string): [number, number] => {
      const got = at.get(key);
      if (got) return got;
      const e = cur.get(key);
      if (!e) return anchor;
      const pk = e.n.parentKey;
      const base = pk === null ? null : resolve(pk);
      const out: [number, number] = base ? [base[0] + e.v[0], base[1] + e.v[1]] : [e.v[0], e.v[1]];
      at.set(key, out);
      return out;
    };
    const list: { key: string; n: NodeInfo<T>; x: number; y: number; a: number; r: number; px: number; py: number; pa: number; pr: number; hasParent: boolean; exiting: boolean; grow: number }[] = [];
    const toXY = (q: [number, number]): [number, number] => (radial ? polar(geo.cx, geo.cy, q[1], q[0]) : q);
    for (const [key, e] of cur) {
      const q = resolve(key);
      const hasParent = e.n.parentKey !== null && cur.has(e.n.parentKey);
      const pq = hasParent ? resolve(e.n.parentKey!) : q;
      const [x, y] = toXY(q);
      const [px, py] = toXY(pq);
      list.push({ key, n: e.n, x, y, a: q[0], r: q[1], px, py, pa: pq[0], pr: pq[1], hasParent, exiting: e.exiting, grow: e.grow });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesMoving ? m.items : marks, geo, radial, root, pre]);

  const posByKey = useMemo(() => new Map(pos.map((q) => [q.key, q])), [pos]);
  const linkPath = (q: (typeof pos)[number]) => {
    if (!radial) {
      const mx = (q.px + q.x) / 2;
      return `M${f1(q.px)},${f1(q.py)}C${f1(mx)},${f1(q.py)} ${f1(mx)},${f1(q.y)} ${f1(q.x)},${f1(q.y)}`;
    }
    // Radial: a curve whose radius grows evenly while its angle changes smoothly (with zero speed at both ends). It leaves the parent heading outward and reaches the child heading outward,
    // and since the radius never shrinks, it never bends inward. Links leaving the root are straight. Large angle differences get more cubic curve segments
    const a0 = q.pr < 0.5 ? q.a : q.pa;
    const da = q.a - a0;
    const dr = q.r - q.pr;
    const at = (t: number) => {
      const th = a0 + da * (3 * t * t - 2 * t * t * t);
      const r = q.pr + dr * t;
      const w = da * (6 * t - 6 * t * t);
      const [x, y] = polar(geo.cx, geo.cy, r, th);
      return [x, y, dr * Math.sin(th) + r * Math.cos(th) * w, -dr * Math.cos(th) + r * Math.sin(th) * w];
    };
    const n = clamp(Math.ceil((Math.abs(da) * (q.pr + q.r)) / 60), 1, 4);
    let d = `M${f1(q.px)},${f1(q.py)}`;
    let prev = at(0);
    for (let k = 1; k <= n; k++) {
      const next = at(k / n);
      const h = 1 / n / 3;
      d += `C${f1(prev[0] + prev[2] * h)},${f1(prev[1] + prev[3] * h)} ${f1(next[0] - next[2] * h)},${f1(next[1] - next[3] * h)} ${f1(next[0])},${f1(next[1])}`;
      prev = next;
    }
    return d;
  };

  // The order nodes are drawn in = the keyboard, table and event order (preorder from the root)
  const nodes = lay.nodes;
  const indexOf = useMemo(() => new Map(nodes.map((nd, i) => [nd, i])), [nodes]);
  const byDepth = useMemo(() => {
    const rows = new Map<number, TreeNode<T>[]>();
    for (const nd of nodes) {
      const row = rows.get(nd.depth);
      if (row) row.push(nd);
      else rows.set(nd.depth, [nd]);
    }
    return rows;
  }, [nodes]);

  const say = (nd: TreeNode<T>) => {
    const d = nd.depth - rootDepth;
    const parts = d === 0 ? [msg.root] : [msg.under(nameOf(nd.parent!)), msg.below(d)];
    parts.push(msg.kids(nd.children.length));
    if (hasValue) parts.push(`${c.t.value} ${c.fv(nd.value)}`);
    if (shut(nd)) parts.push(msg.collapsed);
    return parts.join(", ");
  };
  const events: ChartEvent<T>[] = useMemo(
    () => nodes.map((nd, i) => ({ datum: nd.datum, index: i, key: keyOf.get(nd) ?? nd.id, label: nameOf(nd), value: hasValue ? nd.value : null, formatted: say(nd) })),
    // say depends only on these values
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, keyOf, hasValue, msg, c.fv, c.t, rootName, initial, flips],
  );

  const toggle = (nd: TreeNode<T>) => {
    if (!nd.children.length) return;
    const k = keyOf.get(nd) ?? nd.id;
    setFlips((s) => {
      const next = new Set(s);
      if (!next.delete(k)) next.add(k);
      return next;
    });
  };

  const accent = p.paint("accent");
  const ink = p.paint("ink");
  const panel = p.paint("panel");
  const muted = p.paint("muted");
  const neutral = p.paint("neutral");
  const strong = p.paint("neutralStrong");
  const dotFill = (n: NodeInfo<T>) => (n.path ? accent : n.nd === root || n.nd.children.length ? ink : strong);
  const active = c.active !== null ? nodes[c.active] : undefined;
  /** Click and Enter: collapses or expands the branch and calls onClick. false when no node is selected */
  const press = () => {
    if (c.active === null || !active) return false;
    toggle(active);
    c.click(c.active);
    return true;
  };
  const activeInfo = active ? geo.info.get(active) : undefined;
  let tip: TooltipData | null = null;
  if (active && activeInfo) {
    const d = active.depth - rootDepth;
    tip = {
      x: activeInfo.x,
      y: activeInfo.y - activeInfo.dot,
      title: nameOf(active),
      rows: [
        ...(d > 0 ? [{ label: msg.tipUnder, value: nameOf(active.parent!), strong: false }] : []),
        { label: msg.tipLevel, value: d === 0 ? msg.root : String(d), strong: false },
        { label: msg.tipKids, value: String(active.children.length), strong: false },
        ...(hasValue ? [{ label: c.t.value, value: c.fv(active.value), color: dotFill(activeInfo) }] : []),
      ],
    };
  }

  const tops = root.children.slice(0, 6).map((ch) => `${ch.label} (${ch.children.length})`);
  const hiNames = [...onPath.hit].slice(0, 5).map(nameOf);
  const desc =
    props.description ??
    (all.length ? `${msg.kind}. ${msg.desc(all.length, levelsAll, rootName)}${tops.length ? `: ${tops.join(", ")}${root.children.length > 6 ? ", …" : ""}` : ""}.${hiNames.length ? ` ${msg.hi} ${hiNames.join(", ")}${onPath.hit.size > 5 ? ", …" : ""}.` : ""}` : "");
  const announce = c.via === "keyboard" && active ? `${nameOf(active)}, ${say(active)}` : "";

  const fade = big ? (m.get("__fade")?.[0] ?? 1) : 1;
  const labelIn = (n: NodeInfo<T>) => (big ? 1 : m.fade(Math.max(0, n.depth - 1) * step + D * 0.5, 280));

  // The base layer (links, dots, names) is rebuilt only when positions change. Hover draws just the path on top and dims the whole base at once
  const textNode = (n: NodeInfo<T>, q: { x: number; y: number; a: number; r: number }, opacity: number, key: string) => {
    const lb = labels.get(n.nd);
    if (!lb) return null;
    const pose = posesOf(n, q.x, q.y, q.a, q.r)[lb.k].pose;
    return (
      <text
        key={key}
        x={f1(pose.x)}
        y={f1(pose.y)}
        dy="0.35em"
        transform={pose.rot ? `rotate(${f1(pose.rot)} ${f1(pose.x)} ${f1(pose.y)})` : undefined}
        textAnchor={pose.anchor}
        fontSize={lb.size}
        fontWeight={lb.weight}
        fill={n.path || n.nd.children.length ? ink : muted}
        opacity={opacity < 1 ? f1(opacity * 100) / 100 : undefined}
      >
        {lb.text}
      </text>
    );
  };
  const layer = useMemo(
    () => (
      <>
        <g fill="none" strokeLinecap="round">
          {pos.map((q) =>
            q.hasParent ? <path key={q.key} d={linkPath(q)} stroke={q.n.path ? accent : neutral} strokeWidth={q.n.path ? 2 : 1.3} opacity={q.exiting ? 0.5 : undefined} /> : null,
          )}
        </g>
        <g>
          {pos.map((q) => {
            const r = q.n.dot * (q.hasParent ? Math.min(1, q.grow * 1.6) : 1);
            if (!(r > 0.05)) return null;
            const fill = dotFill(q.n);
            const o = q.exiting ? 0.5 : undefined;
            // Collapsed branches get a ring around the dot
            return q.n.nd.children.length && !q.n.open ? (
              <g key={q.key} opacity={o}>
                <circle cx={f1(q.x)} cy={f1(q.y)} r={f1(r)} fill={fill} />
                <circle cx={f1(q.x)} cy={f1(q.y)} r={f1(r + 3)} fill="none" stroke={fill} strokeWidth={1.4} />
              </g>
            ) : (
              <circle key={q.key} cx={f1(q.x)} cy={f1(q.y)} r={f1(r)} fill={fill} opacity={o} />
            );
          })}
        </g>
        <g stroke={panel} strokeWidth={3} strokeLinejoin="round" paintOrder="stroke" style={{ pointerEvents: "none" }}>
          {pos.map((q) => (q.exiting ? null : textNode(q.n, q, labelIn(q.n), q.key)))}
        </g>
      </>
    ),
    // During the entrance names appear over time, so rebuild whenever elapsed changes; afterwards, only when positions or names change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pos, labels, p, nodesMoving ? m.elapsed : Infinity],
  );

  // Hover and focus: from that node up to the root
  let overlay = null;
  if (activeInfo) {
    const chain: (typeof pos)[number][] = [];
    const byKey = posByKey;
    for (let q = byKey.get(activeInfo.key); q; q = q.hasParent ? byKey.get(q.n.parentKey!) : undefined) chain.push(q);
    overlay = (
      <g pointerEvents="none">
        {chain.map((q) => (q.hasParent ? <path key={`l${q.key}`} d={linkPath(q)} fill="none" stroke={q.n.path ? accent : ink} strokeWidth={2.2} strokeLinecap="round" /> : null))}
        {chain.map((q) => (
          <circle key={`d${q.key}`} cx={f1(q.x)} cy={f1(q.y)} r={f1(q.n.dot)} fill={dotFill(q.n)} />
        ))}
        {c.via === "keyboard" && chain[0] ? <circle cx={f1(chain[0].x)} cy={f1(chain[0].y)} r={f1(chain[0].n.dot + 4)} fill="none" stroke={ink} strokeWidth={2} /> : null}
        <g stroke={panel} strokeWidth={3} strokeLinejoin="round" paintOrder="stroke">
          {chain.map((q) => textNode(q.n, q, 1, `t${q.key}`))}
        </g>
      </g>
    );
  }

  const hitR = Math.max(10, Math.min(24, geo.colW || geo.ring || 24));
  return (
    <ChartFrame
      c={c}
      kind={msg.kind}
      ariaLabel={props.ariaLabel}
      description={desc}
      events={events}
      tip={tip}
      renderTip={props.tooltip}
      announce={announce}
      className={props.className}
      style={props.style}
      theme={props.theme}
      onPointerMove={(px, py, e) => {
        // The nearest dot (within a radius, so small dots can be caught too)
        let best = -1;
        let bd = hitR * hitR;
        for (let i = 0; i < nodes.length; i++) {
          const n = geo.info.get(nodes[i])!;
          const d = (n.x - px) ** 2 + (n.y - py) ** 2;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        const k = best < 0 ? null : best;
        if (k !== c.active) c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer");
      }}
      onKey={(e) => {
        const cur = active;
        if (e.key === "Enter" || e.key === " ") return press();
        if (!e.key.startsWith("Arrow")) return false;
        if (!cur) {
          c.setActive(0, "keyboard");
          return true;
        }
        // Horizontal: left goes to the parent, right to the first child, up and down within the level. Radial: up goes to the parent, down to the first child, left and right within the level (clockwise is right)
        const toParent = radial ? "ArrowUp" : "ArrowLeft";
        const toChild = radial ? "ArrowDown" : "ArrowRight";
        const fwd = radial ? "ArrowRight" : "ArrowDown";
        let next: TreeNode<T> | undefined;
        if (e.key === toParent) next = cur === root ? undefined : (cur.parent ?? undefined);
        else if (e.key === toChild) next = shut(cur) ? undefined : cur.children[0];
        else {
          const row = byDepth.get(cur.depth) ?? [];
          next = row[row.indexOf(cur) + (e.key === fwd ? 1 : -1)];
        }
        if (next && indexOf.has(next)) c.setActive(indexOf.get(next)!, "keyboard");
        return true;
      }}
    >
      <g
        onClick={press}
        style={{ cursor: active && (active.children.length || props.onClick) ? "pointer" : undefined }}
      >
        <rect width={W} height={H} fill="transparent" />
        <g opacity={c.active !== null ? 0.4 : fade < 1 ? f1(fade * 100) / 100 : undefined} className="ztd-mark">
          {layer}
        </g>
      </g>
      {overlay}
    </ChartFrame>
  );
}
