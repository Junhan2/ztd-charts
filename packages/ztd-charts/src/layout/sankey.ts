/**
 * Sankey layout:
 * Sets columns by depth (the longest path), relaxes the positions within each column several times, then resolves overlaps.
 */
export interface SankeyNodeIn {
  id: string;
  label?: string;
}
export interface SankeyLinkIn {
  source: string;
  target: string;
  value: number;
}

export interface SankeyNode {
  id: string;
  label: string;
  index: number;
  depth: number;
  layer: number;
  value: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  inLinks: SankeyLink[];
  outLinks: SankeyLink[];
}

export interface SankeyLink {
  index: number;
  source: SankeyNode;
  target: SankeyNode;
  value: number;
  width: number;
  /** y at the source and target ends (center) */
  y0: number;
  y1: number;
}

export interface SankeyOptions {
  width: number;
  height: number;
  nodeWidth?: number;
  nodePadding?: number;
  iterations?: number;
  align?: "justify" | "left";
  x0?: number;
  y0?: number;
}

export function sankeyLayout(nodesIn: readonly SankeyNodeIn[], linksIn: readonly SankeyLinkIn[], opt: SankeyOptions): { nodes: SankeyNode[]; links: SankeyLink[] } {
  const { width, height, nodeWidth = 10, iterations = 24, align = "justify", x0 = 0, y0 = 0 } = opt;
  const byId = new Map<string, SankeyNode>();
  const nodes: SankeyNode[] = [];
  const ensure = (id: string, label?: string) => {
    let n = byId.get(id);
    if (!n) {
      n = { id, label: label ?? id, index: nodes.length, depth: 0, layer: 0, value: 0, x0: 0, x1: 0, y0: 0, y1: 0, inLinks: [], outLinks: [] };
      byId.set(id, n);
      nodes.push(n);
    } else if (label) n.label = label;
    return n;
  };
  nodesIn.forEach((n) => ensure(n.id, n.label));
  const links: SankeyLink[] = [];
  linksIn.forEach((l) => {
    if (!(l.value > 0) || l.source === l.target) return;
    const s = ensure(l.source);
    const t = ensure(l.target);
    const link: SankeyLink = { index: links.length, source: s, target: t, value: l.value, width: 0, y0: 0, y1: 0 };
    links.push(link);
    s.outLinks.push(link);
    t.inLinks.push(link);
  });
  for (const n of nodes) n.value = Math.max(n.inLinks.reduce((a, l) => a + l.value, 0), n.outLinks.reduce((a, l) => a + l.value, 0));

  // Depth: the longest path from a start node. Back links that form cycles are found with one depth-first search and removed
  // (left in, node depths inside a cycle inflate up to the node count and links are drawn backward)
  let frontier = nodes.filter((n) => !n.inLinks.length);
  if (!frontier.length) frontier = nodes.slice(0, 1);
  const state = new Map<SankeyNode, 1 | 2>();
  const back = new Set<SankeyLink>();
  const visit = (n: SankeyNode): void => {
    state.set(n, 1);
    for (const l of n.outLinks) {
      const s = state.get(l.target);
      if (s === 1) back.add(l);
      else if (!s) visit(l.target);
    }
    state.set(n, 2);
  };
  [...frontier, ...nodes].forEach((n) => state.has(n) || visit(n));
  const depthOf = new Map<SankeyNode, number>();
  frontier.forEach((n) => depthOf.set(n, 0));
  let changed = true;
  let guard = 0;
  while (changed && guard++ < nodes.length + 1) {
    changed = false;
    for (const l of links) {
      if (back.has(l)) continue;
      const d = (depthOf.get(l.source) ?? 0) + 1;
      if (d > (depthOf.get(l.target) ?? -1) && d <= nodes.length) {
        depthOf.set(l.target, d);
        changed = true;
      }
    }
  }
  for (const n of nodes) n.depth = depthOf.get(n) ?? 0;
  const maxDepth = Math.max(0, ...nodes.map((n) => n.depth));
  for (const n of nodes) n.layer = align === "justify" && !n.outLinks.length ? maxDepth : n.depth;
  const nLayers = maxDepth + 1;
  const kx = nLayers > 1 ? (width - nodeWidth) / (nLayers - 1) : 0;
  for (const n of nodes) {
    n.x0 = x0 + n.layer * kx;
    n.x1 = n.x0 + nodeWidth;
  }
  const columns: SankeyNode[][] = Array.from({ length: nLayers }, () => []);
  nodes.forEach((n) => columns[n.layer].push(n));
  const maxCount = Math.max(1, ...columns.map((c) => c.length));
  const py = Math.min(opt.nodePadding ?? 12, (height / maxCount) * 0.6);
  const ky = Math.min(...columns.filter((c) => c.length).map((c) => (height - (c.length - 1) * py) / Math.max(1e-9, c.reduce((a, n) => a + n.value, 0))));
  for (const col of columns) {
    let y = y0;
    for (const n of col) {
      n.y0 = y;
      n.y1 = y + n.value * ky;
      y = n.y1 + py;
    }
  }
  for (const l of links) l.width = l.value * ky;

  const center = (n: SankeyNode) => (n.y0 + n.y1) / 2;
  const resolve = (col: SankeyNode[]) => {
    col.sort((a, b) => a.y0 - b.y0);
    let y = y0;
    for (const n of col) {
      const dy = y - n.y0;
      if (dy > 0) {
        n.y0 += dy;
        n.y1 += dy;
      }
      y = n.y1 + py;
    }
    const over = y - py - (y0 + height);
    if (over > 0) {
      let yy = y0 + height;
      for (let i = col.length - 1; i >= 0; i--) {
        const n = col[i];
        const dy = n.y1 - yy;
        if (dy > 0) {
          n.y0 -= dy;
          n.y1 -= dy;
        }
        yy = n.y0 - py;
      }
    }
  };
  let alpha = 1;
  for (let it = 0; it < iterations; it++) {
    alpha *= 0.99;
    const a = Math.pow(0.99, it);
    // Right to left
    for (let c = columns.length - 2; c >= 0; c--) {
      for (const n of columns[c]) {
        if (!n.outLinks.length) continue;
        let w = 0;
        let s = 0;
        for (const l of n.outLinks) {
          s += center(l.target) * l.value;
          w += l.value;
        }
        const dy = (s / w - center(n)) * a;
        n.y0 += dy;
        n.y1 += dy;
      }
      resolve(columns[c]);
    }
    // Left to right
    for (let c = 1; c < columns.length; c++) {
      for (const n of columns[c]) {
        if (!n.inLinks.length) continue;
        let w = 0;
        let s = 0;
        for (const l of n.inLinks) {
          s += center(l.source) * l.value;
          w += l.value;
        }
        const dy = (s / w - center(n)) * a;
        n.y0 += dy;
        n.y1 += dy;
      }
      resolve(columns[c]);
    }
  }
  void alpha;
  // Link positions: stacked in the vertical order of the nodes at the other end
  for (const n of nodes) {
    n.outLinks.sort((a, b) => a.target.y0 - b.target.y0);
    n.inLinks.sort((a, b) => a.source.y0 - b.source.y0);
    const outTotal = n.outLinks.reduce((a, l) => a + l.width, 0);
    const inTotal = n.inLinks.reduce((a, l) => a + l.width, 0);
    let y = n.y0 + Math.max(0, (n.y1 - n.y0 - outTotal) / 2);
    for (const l of n.outLinks) {
      l.y0 = y + l.width / 2;
      y += l.width;
    }
    y = n.y0 + Math.max(0, (n.y1 - n.y0 - inTotal) / 2);
    for (const l of n.inLinks) {
      l.y1 = y + l.width / 2;
      y += l.width;
    }
  }
  return { nodes, links };
}

/** Most stage columns drawn from a wide table (encoding.dimensions). Later columns are left out */
export const SANKEY_MAX_DIMENSIONS = 6;
/** Most values in one stage column. Past it, the 11 with the largest totals stay and the rest become one "Other (n)" node */
export const SANKEY_MAX_VALUES = 12;

/** Rows with the same path through the stage columns, merged: node and link indexes (the order sankeyLayout lays them out in) and the summed value */
export interface SankeyPath {
  nodes: number[];
  links: number[];
  value: number;
}

/**
 * Stages from a wide table: each row is one path through the columns, left to right. A node id is the column number, \u0001 and the value,
 * so a name in two columns is two nodes. An empty cell is a names.blank node, so every row passes every column.
 * A column with more than 12 values keeps the 11 with the largest totals and merges the rest into one names.other(n) node, last in its column.
 * Rows with the same path are merged first, then each pair of neighboring columns adds up into links. Rows with a value that is not above 0 are left out, as sankeyLayout leaves out such links.
 * Nodes come column by column in order of first appearance, and every node has a link on both sides inside the stages, so sankeyLayout puts column k in layer k.
 * grouped is the count of values merged into Other per column (0 for none)
 */
export function dimensionLinks<T>(rows: readonly T[], columns: readonly ((d: T, i: number) => string)[], value: (d: T, i: number) => number, names: { blank: string; other: (n: number) => string }): { nodes: SankeyNodeIn[]; links: SankeyLinkIn[]; paths: SankeyPath[]; grouped: number[] } {
  const kept: { cells: string[]; v: number }[] = [];
  if (columns.length > 1)
    rows.forEach((d, i) => {
      const v = value(d, i);
      if (v > 0) kept.push({ cells: columns.map((read) => read(d, i)), v });
    });
  const nodes: SankeyNodeIn[] = [];
  const grouped: number[] = [];
  // Node index of each value, per column
  const index = columns.map((_, k) => {
    const totals = new Map<string, number>();
    for (const r of kept) totals.set(r.cells[k], (totals.get(r.cells[k]) ?? 0) + r.v);
    const over = totals.size > SANKEY_MAX_VALUES ? totals.size - SANKEY_MAX_VALUES + 1 : 0;
    grouped.push(over);
    const keep = over ? new Set([...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, SANKEY_MAX_VALUES - 1).map(([key]) => key)) : null;
    const at = new Map<string, number>();
    for (const key of totals.keys()) {
      if (keep && !keep.has(key)) continue;
      at.set(key, nodes.length);
      nodes.push({ id: `${k}\u0001${key}`, label: key === "" ? names.blank : key });
    }
    if (keep) {
      const other = nodes.length;
      nodes.push({ id: `${k}\u0002`, label: names.other(over) });
      for (const key of totals.keys()) if (!keep.has(key)) at.set(key, other);
    }
    return at;
  });
  const paths: SankeyPath[] = [];
  const pathAt = new Map<string, SankeyPath>();
  for (const r of kept) {
    const ns = r.cells.map((cell, k) => index[k].get(cell)!);
    const key = ns.join(",");
    const p = pathAt.get(key);
    if (p) p.value += r.v;
    else {
      const q: SankeyPath = { nodes: ns, links: [], value: r.v };
      pathAt.set(key, q);
      paths.push(q);
    }
  }
  // Links between neighboring columns, gap by gap in order of first appearance
  const links: SankeyLinkIn[] = [];
  const linkAt = new Map<string, number>();
  for (let k = 0; k + 1 < columns.length; k++)
    for (const p of paths) {
      const key = `${p.nodes[k]},${p.nodes[k + 1]}`;
      let li = linkAt.get(key);
      if (li === undefined) {
        li = links.length;
        linkAt.set(key, li);
        links.push({ source: nodes[p.nodes[k]].id, target: nodes[p.nodes[k + 1]].id, value: 0 });
      }
      links[li].value += p.value;
      p.links.push(li);
    }
  return { nodes, links, paths, grouped };
}

/** Link band path (horizontal Bezier) */
export function sankeyLinkPath(l: { source: { x1: number }; target: { x0: number }; y0: number; y1: number; width: number }, t = 1): string {
  const xs = l.source.x1;
  const xt = xs + (l.target.x0 - xs) * t;
  const yt = l.y0 + (l.y1 - l.y0) * t;
  const mx = (xs + xt) / 2;
  const h = l.width / 2;
  const r = (n: number) => Math.round(n * 100) / 100;
  return `M${r(xs)},${r(l.y0 - h)}C${r(mx)},${r(l.y0 - h)} ${r(mx)},${r(yt - h)} ${r(xt)},${r(yt - h)}L${r(xt)},${r(yt + h)}C${r(mx)},${r(yt + h)} ${r(mx)},${r(l.y0 + h)} ${r(xs)},${r(l.y0 + h)}Z`;
}
