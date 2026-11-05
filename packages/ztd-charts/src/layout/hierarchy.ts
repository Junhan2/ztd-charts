import { sum } from "../core/geometry";
import { numGetter, strGetter } from "../data/accessor";
import type { Accessor } from "../core/types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The worst aspect ratio of a row from its sum, smallest and largest area (the row is never rebuilt) */
function worst(s: number, mn: number, mx: number, side: number): number {
  if (s <= 0 || mn <= 0) return Infinity;
  return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
}

/** Squarified treemap (Bruls, Huizing, van Wijk). values는 큰 순서일수록 보기 좋아요 */
export function squarify(values: readonly number[], box: Rect): Rect[] {
  const tot = sum(values.map((v) => Math.max(0, v)));
  const out: Rect[] = values.map(() => ({ x: box.x, y: box.y, w: 0, h: 0 }));
  if (tot <= 0 || box.w <= 0 || box.h <= 0) return out;
  const scale = (box.w * box.h) / tot;
  const order = values.map((v, i) => ({ v: Math.max(0, v) * scale, i })).filter((d) => d.v > 0);
  let x = box.x;
  let y = box.y;
  let w = box.w;
  let h = box.h;
  let i = 0;
  while (i < order.length) {
    const side = Math.min(w, h);
    // The row grows while it does not get worse; its sum, min and max are kept as it grows, so a long list
    // stays linear instead of copying and re-summing the row at every step.
    let rs = order[i].v;
    let mn = rs;
    let mx = rs;
    let j = i + 1;
    while (j < order.length) {
      const v = order[j].v;
      if (worst(rs + v, Math.min(mn, v), Math.max(mx, v), side) > worst(rs, mn, mx, side)) break;
      rs += v;
      mn = Math.min(mn, v);
      mx = Math.max(mx, v);
      j++;
    }
    if (w >= h) {
      const cw = h > 0 ? rs / h : 0;
      let yy = y;
      for (let k = i; k < j; k++) {
        const hh = cw > 0 ? order[k].v / cw : 0;
        out[order[k].i] = { x, y: yy, w: cw, h: hh };
        yy += hh;
      }
      x += cw;
      w -= cw;
    } else {
      const rh = w > 0 ? rs / w : 0;
      let xx = x;
      for (let k = i; k < j; k++) {
        const ww = rh > 0 ? order[k].v / rh : 0;
        out[order[k].i] = { x: xx, y, w: ww, h: rh };
        xx += ww;
      }
      y += rh;
      h -= rh;
    }
    i = j;
  }
  return out;
}

export interface TreeNode<T = unknown> {
  id: string;
  label: string;
  value: number;
  depth: number;
  parent: TreeNode<T> | null;
  children: TreeNode<T>[];
  datum: T | null;
  /** 형제 사이 순서 */
  index: number;
}

export interface HierarchyAccessors<T> {
  label?: Accessor<T, string>;
  value?: Accessor<T, number>;
  /** 부모 이름 필드 (평평한 표) */
  group?: Accessor<T, string>;
  /** 여러 단계: ["대분류", "중분류"] 처럼 경로 필드 목록 */
  path?: string[];
  /** 중첩 객체의 자식 필드 */
  children?: string;
}

/**
 * 평평한 표(group + label + value), 경로 열(path), 중첩 객체(children) 어느 모양이든 트리로.
 * 값은 잎에서 위로 더해요.
 */
export function buildTree<T>(data: readonly T[], acc: HierarchyAccessors<T>, rootLabel = "All"): TreeNode<T> {
  const gl = strGetter(acc.label, "label");
  const gv = numGetter(acc.value, "value");
  const root: TreeNode<T> = { id: "", label: rootLabel, value: 0, depth: 0, parent: null, children: [], datum: null, index: 0 };
  const childKey = acc.children ?? "children";
  const hasNested = data.some((d) => d && typeof d === "object" && Array.isArray((d as Record<string, unknown>)[childKey]));
  const add = (parent: TreeNode<T>, label: string, datum: T | null): TreeNode<T> => {
    let n = parent.children.find((c) => c.label === label);
    if (!n) {
      n = { id: parent.id ? `${parent.id}/${label}` : label, label, value: 0, depth: parent.depth + 1, parent, children: [], datum, index: parent.children.length };
      parent.children.push(n);
    }
    return n;
  };
  if (hasNested) {
    const walk = (parent: TreeNode<T>, items: readonly unknown[]) => {
      items.forEach((it, i) => {
        const d = it as T;
        const node = add(parent, gl(d, i) || `#${i + 1}`, d);
        const kids = (it as Record<string, unknown>)[childKey];
        if (Array.isArray(kids) && kids.length) walk(node, kids);
        else node.value += Math.max(0, gv(d, i) || 0);
      });
    };
    walk(root, data);
  } else {
    const gg = acc.group ? strGetter(acc.group, "group") : null;
    data.forEach((d, i) => {
      let parent = root;
      if (acc.path?.length) {
        for (const k of acc.path) {
          const v = (d as Record<string, unknown>)[k];
          if (v === undefined || v === null || v === "") continue;
          parent = add(parent, String(v), null);
        }
      } else if (gg) {
        const g = gg(d, i);
        if (g) parent = add(parent, g, null);
      }
      const leaf = add(parent, gl(d, i) || `#${i + 1}`, d);
      leaf.datum = d;
      leaf.value += Math.max(0, gv(d, i) || 0);
    });
  }
  const total = (n: TreeNode<T>): number => {
    if (n.children.length) n.value = sum(n.children.map(total));
    return n.value;
  };
  total(root);
  return root;
}

export function leaves<T>(n: TreeNode<T>): TreeNode<T>[] {
  if (!n.children.length) return [n];
  return n.children.flatMap((c) => leaves(c));
}

export function descendants<T>(n: TreeNode<T>): TreeNode<T>[] {
  return [n, ...n.children.flatMap((c) => descendants(c))];
}

export function sortTree<T>(n: TreeNode<T>): void {
  n.children.sort((a, b) => b.value - a.value);
  n.children.forEach((c, i) => {
    c.index = i;
    sortTree(c);
  });
}

export function treeHeight<T>(n: TreeNode<T>): number {
  return n.children.length ? 1 + Math.max(...n.children.map(treeHeight)) : 0;
}

export interface Arc<T> {
  node: TreeNode<T>;
  a0: number;
  a1: number;
  depth: number;
}

/** 원형 분할 (선버스트): 깊이마다 고리 하나 */
export function partitionAngles<T>(root: TreeNode<T>, a0 = 0, a1 = Math.PI * 2): Arc<T>[] {
  const out: Arc<T>[] = [];
  const walk = (n: TreeNode<T>, s: number, e: number) => {
    let acc = s;
    for (const c of n.children) {
      const span = n.value > 0 ? ((e - s) * c.value) / n.value : 0;
      out.push({ node: c, a0: acc, a1: acc + span, depth: c.depth });
      walk(c, acc, acc + span);
      acc += span;
    }
  };
  walk(root, a0, a1);
  return out;
}
