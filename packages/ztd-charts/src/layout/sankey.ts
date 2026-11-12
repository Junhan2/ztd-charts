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
