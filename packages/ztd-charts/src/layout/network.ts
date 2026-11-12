import { categoricalDots, type Swatch } from "../core/palette";
import { uniq } from "../data/accessor";
import type { Painter } from "../theme/context";

/**
 * Network graph: gathers rows (source, target, value) into nodes and links, and sets the node order of the arc layout.
 * Two rows in opposite directions (A→B, B→A) and duplicate rows of the same pair merge into one link (summed, as in a chord diagram). Per-direction totals stay in ab and ba.
 * Rows that point to themselves, or whose value is 0 or less or not a number, create no link, but their nodes remain. A row with an empty name on either side is dropped entirely.
 */
export interface NetworkLinkIn {
  source: string;
  target: string;
  value: number;
}

export interface NetworkNode {
  name: string;
  /** Order of first appearance (data order) */
  index: number;
  /** Group set by options.groups. "" when there is none */
  group: string;
  /** Number of other nodes it connects to */
  degree: number;
  /** Sum of its link values (equal to the link count when there are no values) */
  strength: number;
  /** This node's link indexes, largest value first (on a tie, the one whose other end appeared first) */
  links: number[];
  /** Index of its connected component. The largest component is 0 */
  component: number;
}

export interface NetworkLink {
  index: number;
  /** Source node of the first row that appeared */
  a: number;
  /** Target node of the first row that appeared */
  b: number;
  /** ab + ba */
  value: number;
  ab: number;
  ba: number;
  /** Index of the first row merged into this link */
  row: number;
}

export interface NetworkGraph {
  nodes: NetworkNode[];
  links: NetworkLink[];
  /** Number of connected components (each node without links counts as one) */
  components: number;
}

export type NetworkSort = "auto" | "data" | "group" | "degree";

/** Turns rows into a graph. groups maps node name → group name */
export function networkGraph(rows: readonly NetworkLinkIn[], groups?: Readonly<Record<string, unknown>>): NetworkGraph {
  const idx = new Map<string, number>();
  const nodes: NetworkNode[] = [];
  const node = (name: string) => {
    let i = idx.get(name);
    if (i === undefined) {
      i = nodes.length;
      idx.set(name, i);
      const g = groups && Object.hasOwn(groups, name) ? groups[name] : undefined;
      nodes.push({ name, index: i, group: typeof g === "string" ? g : "", degree: 0, strength: 0, links: [], component: 0 });
    }
    return i;
  };
  const links: NetworkLink[] = [];
  const pair = new Map<string, NetworkLink>();
  rows.forEach((r, row) => {
    if (!r.source || !r.target) return;
    const s = node(r.source);
    const t = node(r.target);
    const v = r.value;
    if (s === t || !(v > 0) || !Number.isFinite(v)) return;
    const key = s < t ? `${s} ${t}` : `${t} ${s}`;
    let l = pair.get(key);
    if (!l) {
      l = { index: links.length, a: s, b: t, value: 0, ab: 0, ba: 0, row };
      pair.set(key, l);
      links.push(l);
      nodes[s].links.push(l.index);
      nodes[t].links.push(l.index);
    }
    if (s === l.a) l.ab += v;
    else l.ba += v;
    l.value += v;
  });
  for (const l of links) {
    nodes[l.a].strength += l.value;
    nodes[l.b].strength += l.value;
  }
  for (const n of nodes) {
    n.degree = n.links.length;
    n.links.sort((x, y) => links[y].value - links[x].value || otherEnd(links, x, n.index) - otherEnd(links, y, n.index));
  }

  // Connected components: found breadth-first and numbered from the largest (on a tie, the one that appeared first)
  const comp = new Array<number>(nodes.length).fill(-1);
  const sizes: { id: number; size: number }[] = [];
  for (const start of nodes) {
    if (comp[start.index] >= 0) continue;
    const id = sizes.length;
    const queue = [start.index];
    comp[start.index] = id;
    for (let q = 0; q < queue.length; q++)
      for (const k of nodes[queue[q]].links) {
        const o = otherEnd(links, k, queue[q]);
        if (comp[o] < 0) {
          comp[o] = id;
          queue.push(o);
        }
      }
    sizes.push({ id, size: queue.length });
  }
  const rank = new Array<number>(sizes.length);
  [...sizes].sort((x, y) => y.size - x.size || x.id - y.id).forEach((c, i) => (rank[c.id] = i));
  for (const n of nodes) n.component = rank[comp[n.index]];
  return { nodes, links, components: sizes.length };
}

/** The node at the other end of link k from node n */
export function otherEnd(links: readonly NetworkLink[], k: number, n: number): number {
  return links[k].a === n ? links[k].b : links[k].a;
}

/** Most connected nodes first, then the larger value sum, then data order (shared by degree sorting, the default highlight, the description and label priority) */
export function byDegree(nodes: readonly NetworkNode[]): (x: number, y: number) => number {
  return (x, y) => nodes[y].degree - nodes[x].degree || nodes[y].strength - nodes[x].strength || x - y;
}

/** Group names in order of first appearance in options.groups (the legend and color order) */
export function groupNames(groups: unknown): string[] {
  if (!groups || typeof groups !== "object" || Array.isArray(groups)) return [];
  return uniq(Object.values(groups).filter((g): g is string => typeof g === "string" && g !== ""));
}

/**
 * Point color per group: categoricalDots (gray steps visible even on small points) in group order (order of first appearance in options.groups).
 * The last step is reserved for nodes without a group, so the card legend (autoLegend) uses the chart's colors without looking at the data
 */
export function networkSwatches(p: Painter, groupCount: number): Swatch[] {
  return categoricalDots(p, groupCount + 1, new Set());
}

/** Order cost: the number of slots between the two ends of each link. Longer arcs cost more and overlap more easily */
export function arcCost(g: NetworkGraph, pos: readonly number[]): number {
  let s = 0;
  for (const l of g.links) s += Math.abs(pos[l.a] - pos[l.b]);
  return s;
}

/** Node index → position */
export function positions(order: readonly number[]): number[] {
  const pos = new Array<number>(order.length);
  order.forEach((n, i) => (pos[n] = i));
  return pos;
}

/** How many times to repeat the barycenter sort. In samples, the cost barely drops after the 6th pass */
const SWEEPS = 12;

/**
 * Node order of the arc layout (an array of node indexes).
 * - "data": order of first appearance in the data
 * - "group": group order (order of first appearance in options.groups, nodes without a group last), data order within a group
 * - "degree": most connected nodes first (on a tie, the value sum, then data order)
 * - "auto": keeps groups (connected components when there are none, largest first) together, re-sorts within them a few times by the mean of the neighbors' positions (barycenter),
 *   then refines by swapping neighboring nodes. It runs from three starting orders (data order, most connected first, most connected in the middle)
 *   and uses the one with the smallest total arc length (arcCost). Since one start is the data order, the result is never longer than the data order
 */
export function networkOrder(g: NetworkGraph, sort: NetworkSort = "auto", groupOrder: readonly string[] = []): number[] {
  const { nodes } = g;
  const data = nodes.map((n) => n.index);
  if (sort === "data" || nodes.length < 2) return data;
  const deg = byDegree(nodes);
  if (sort === "degree") return [...data].sort(deg);
  const gRank = new Map(groupOrder.map((name, i) => [name, i]));
  const groupOf = (n: number) => gRank.get(nodes[n].group) ?? groupOrder.length;
  if (sort === "group") return [...data].sort((x, y) => groupOf(x) - groupOf(y) || x - y);
  const block = groupOrder.length ? groupOf : (n: number) => nodes[n].component;
  // Per group, from the middle outward: the most connected node in the middle, then alternating left and right
  const centred = (list: number[]) => {
    const out: number[] = [];
    for (let i = 0; i < list.length; ) {
      let e = i;
      while (e < list.length && block(list[e]) === block(list[i])) e++;
      const part: number[] = [];
      for (let k = i; k < e; k++) {
        if ((k - i) % 2) part.unshift(list[k]);
        else part.push(list[k]);
      }
      out.push(...part);
      i = e;
    }
    return out;
  };
  const byBlockDegree = [...data].sort((x, y) => block(x) - block(y) || deg(x, y));
  const starts = [[...data].sort((x, y) => block(x) - block(y) || x - y), byBlockDegree, centred(byBlockDegree)];
  let best = starts[0];
  let bestCost = Infinity;
  for (const s of starts) {
    const o = refine(g, s, block);
    const cost = arcCost(g, positions(o));
    if (cost < bestCost) {
      best = o;
      bestCost = cost;
    }
  }
  return best;
}

/** Repeats the barycenter sort, keeps the shortest order found, and refines it by swapping neighbors */
function refine(g: NetworkGraph, start: number[], block: (n: number) => number): number[] {
  const { nodes, links } = g;
  let order = start;
  let pos = positions(order);
  let best = order;
  let bestCost = arcCost(g, pos);
  for (let s = 0; s < SWEEPS && bestCost > 0; s++) {
    // Mean position of the neighbors for each node index; the current position when it has no links
    const bc = nodes.map((n) => {
      if (!n.links.length) return pos[n.index];
      let sum = 0;
      for (const k of n.links) sum += pos[otherEnd(links, k, n.index)];
      return sum / n.links.length;
    });
    const next = [...order].sort((x, y) => block(x) - block(y) || bc[x] - bc[y] || pos[x] - pos[y]);
    if (next.every((n, i) => n === order[i])) break;
    order = next;
    pos = positions(order);
    const cost = arcCost(g, pos);
    if (cost < bestCost) {
      best = order;
      bestCost = cost;
    }
  }
  return swapPass(g, [...best], block);
}

/** Swaps two neighboring nodes when that reduces the total arc length (within the same group only). Stops when nothing improves or the set number of passes is reached */
function swapPass(g: NetworkGraph, order: number[], block: (n: number) => number): number[] {
  const { nodes, links } = g;
  const pos = positions(order);
  // Change in the length of u's links (except the one to v) when u moves one slot in direction dir (1 right, -1 left)
  const shift = (u: number, v: number, dir: 1 | -1) => {
    let d = 0;
    for (const k of nodes[u].links) {
      const o = otherEnd(links, k, u);
      if (o !== v) d += Math.abs(pos[u] + dir - pos[o]) - Math.abs(pos[u] - pos[o]);
    }
    return d;
  };
  for (let pass = 0; pass < SWEEPS * 2; pass++) {
    let moved = false;
    for (let i = 0; i + 1 < order.length; i++) {
      const u = order[i];
      const v = order[i + 1];
      if (block(u) !== block(v) || shift(u, v, 1) + shift(v, u, -1) >= 0) continue;
      order[i] = v;
      order[i + 1] = u;
      pos[u] = i + 1;
      pos[v] = i;
      moved = true;
    }
    if (!moved) break;
  }
  return order;
}
