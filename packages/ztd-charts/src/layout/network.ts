import { categoricalDots, type Swatch } from "../core/palette";
import { uniq } from "../data/accessor";
import type { Painter } from "../theme/context";

/**
 * 네트워크 그래프: 행(출발, 도착, 값)을 노드와 링크로 묶고, 호 배치의 노드 순서를 정해요.
 * 방향이 다른 두 행(A→B, B→A)과 같은 쌍의 중복 행은 링크 하나로 합쳐요(코드 다이어그램처럼 더해요). 방향별 합은 ab, ba에 남아요.
 * 자기 자신으로 가는 행, 값이 0 이하이거나 숫자가 아닌 행은 링크를 만들지 않지만 노드는 남아요. 이름이 빈 쪽이 있으면 그 행은 통째로 빼요.
 */
export interface NetworkLinkIn {
  source: string;
  target: string;
  value: number;
}

export interface NetworkNode {
  name: string;
  /** 처음 나온 순서 (데이터 순서) */
  index: number;
  /** options.groups로 정한 묶음. 없으면 "" */
  group: string;
  /** 이어진 다른 노드 수 */
  degree: number;
  /** 이어진 링크 값의 합 (값이 없으면 링크 수와 같아요) */
  strength: number;
  /** 이 노드의 링크 번호, 값이 큰 것부터 (같으면 상대가 먼저 나온 것부터) */
  links: number[];
  /** 연결된 덩어리 번호. 큰 덩어리가 0이에요 */
  component: number;
}

export interface NetworkLink {
  index: number;
  /** 처음 나온 행의 출발 노드 */
  a: number;
  /** 처음 나온 행의 도착 노드 */
  b: number;
  /** ab + ba */
  value: number;
  ab: number;
  ba: number;
  /** 이 링크로 합쳐진 첫 행 번호 */
  row: number;
}

export interface NetworkGraph {
  nodes: NetworkNode[];
  links: NetworkLink[];
  /** 연결된 덩어리 수 (링크 없는 노드도 하나씩) */
  components: number;
}

export type NetworkSort = "auto" | "data" | "group" | "degree";

/** 행을 그래프로. groups는 노드 이름 → 묶음 이름 */
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

  // 연결된 덩어리: 너비 우선으로 찾고, 큰 덩어리부터 번호를 매겨요 (같으면 먼저 나온 덩어리)
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

/** 링크 k에서 노드 n의 상대 노드 */
export function otherEnd(links: readonly NetworkLink[], k: number, n: number): number {
  return links[k].a === n ? links[k].b : links[k].a;
}

/** 이어진 노드가 많은 것부터, 같으면 값 합이 큰 것, 그다음 데이터 순서 (degree 정렬, 기본 강조, 설명, 이름표 우선순위가 같이 써요) */
export function byDegree(nodes: readonly NetworkNode[]): (x: number, y: number) => number {
  return (x, y) => nodes[y].degree - nodes[x].degree || nodes[y].strength - nodes[x].strength || x - y;
}

/** 묶음 이름을 options.groups에 처음 나온 순서로 (범례와 색 순서) */
export function groupNames(groups: unknown): string[] {
  if (!groups || typeof groups !== "object" || Array.isArray(groups)) return [];
  return uniq(Object.values(groups).filter((g): g is string => typeof g === "string" && g !== ""));
}

/**
 * 묶음별 점 색: 묶음 순서(options.groups에 처음 나온 순서)대로 categoricalDots(작은 점에서도 보이는 회색 단계).
 * 마지막 한 단계는 묶음 없는 노드 몫이라, 카드 범례(autoLegend)가 데이터를 보지 않고도 차트와 같은 색을 써요
 */
export function networkSwatches(p: Painter, groupCount: number): Swatch[] {
  return categoricalDots(p, groupCount + 1, new Set());
}

/** 순서 비용: 링크마다 두 끝 사이의 칸 수. 호가 길수록 높고 겹치기 쉬워요 */
export function arcCost(g: NetworkGraph, pos: readonly number[]): number {
  let s = 0;
  for (const l of g.links) s += Math.abs(pos[l.a] - pos[l.b]);
  return s;
}

/** 노드 번호 → 자리 */
export function positions(order: readonly number[]): number[] {
  const pos = new Array<number>(order.length);
  order.forEach((n, i) => (pos[n] = i));
  return pos;
}

/** 무게 중심 정렬을 몇 번 되풀이할지. 표본에서 6번째 뒤로는 비용이 거의 줄지 않아요 */
const SWEEPS = 12;

/**
 * 호 배치의 노드 순서 (노드 번호 배열).
 * - "data": 데이터에 처음 나온 순서
 * - "group": 묶음 순서(options.groups에 처음 나온 순서, 묶음 없는 노드는 끝), 묶음 안은 데이터 순서
 * - "degree": 이어진 노드가 많은 것부터 (같으면 값 합, 그다음 데이터 순서)
 * - "auto": 묶음(없으면 연결된 덩어리, 큰 것부터)을 붙여 두고, 그 안에서 이웃 자리의 평균(무게 중심)으로 몇 번 다시 정렬한 뒤
 *   이웃한 두 노드를 바꿔 다듬어요. 시작 순서 셋(데이터 순서, 많이 이어진 순서, 많이 이어진 노드를 가운데에)에서 각각 하고
 *   긴 호의 합(arcCost)이 가장 작은 것을 써요. 데이터 순서에서도 시작하니 데이터 순서보다 길어지지 않아요
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
  // 묶음마다 가운데부터 바깥으로: 많이 이어진 노드가 가운데, 그다음 왼쪽, 오른쪽 번갈아
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

/** 무게 중심 정렬을 되풀이해 가장 짧았던 순서를 고르고, 이웃 바꾸기로 다듬어요 */
function refine(g: NetworkGraph, start: number[], block: (n: number) => number): number[] {
  const { nodes, links } = g;
  let order = start;
  let pos = positions(order);
  let best = order;
  let bestCost = arcCost(g, pos);
  for (let s = 0; s < SWEEPS && bestCost > 0; s++) {
    // 노드 번호마다 이웃 자리의 평균. 링크가 없으면 지금 자리
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

/** 이웃한 두 노드를 바꿔 긴 호의 합이 줄면 바꿔요 (같은 묶음 안에서만). 더 줄지 않거나 정한 횟수가 차면 멈춰요 */
function swapPass(g: NetworkGraph, order: number[], block: (n: number) => number): number[] {
  const { nodes, links } = g;
  const pos = positions(order);
  // u를 한 칸 오른쪽으로 옮길 때 u의 링크(v 쪽 빼고) 길이 변화
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
