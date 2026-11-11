import { numGetter, strGetter } from "../data/accessor";
import type { Accessor } from "../core/types";
// 타입만 써요. buildTree를 여기서 부르면 검사(spec 번들)가 계층 코드를 끌어와 트리맵, 선버스트 번들이 공유 조각으로 갈라져 커져요
import type { HierarchyAccessors, TreeNode } from "./hierarchy";

export interface TreeAccessors<T> extends HierarchyAccessors<T> {
  /** Row id field for id/parent rows. Defaults to "id", then the label */
  id?: Accessor<T, string>;
  /** Parent id field. Setting it switches to id/parent rows; an empty parent makes a top-level node */
  parent?: Accessor<T, string>;
}

/** A row problem found while linking id/parent rows. index is the row number in data */
export interface TreeIssue {
  code: "duplicate_id" | "missing_parent" | "cycle";
  index: number;
  id: string;
}

/**
 * id/parent rows (an adjacency list, as an org chart or a folder table is usually stored) to the same TreeNode shape buildTree makes.
 * Every row becomes one node in data order. A missing parent, a node that is its own parent and a loop are put under the added root
 * (the loop is cut at the first row on it that a walk up from a later row reaches), so the chart still draws every row and onIssue says why.
 * A repeated id stays a node of its own; children of that id hang under its first row. Values add up from the leaves, as in buildTree.
 */
export function stratify<T>(data: readonly T[], acc: TreeAccessors<T>, rootLabel = "All", onIssue?: (issue: TreeIssue) => void): TreeNode<T> {
  // 빈칸만 있는 이름("  ")은 빈 이름과 같아요
  const text = (g: (d: T, i: number) => string) => (d: T, i: number) => (g(d, i).trim() ? g(d, i) : "");
  const gl = text(strGetter(acc.label, "label"));
  const gi = text(strGetter(acc.id, "id"));
  const gp = text(strGetter(acc.parent, "parent"));
  const gv = numGetter(acc.value, "value");
  const n = data.length;
  const ids = data.map((d, i) => gi(d, i) || gl(d, i) || `#${i + 1}`);
  const first = new Map<string, number>();
  ids.forEach((id, i) => {
    if (!first.has(id)) first.set(id, i);
    else onIssue?.({ code: "duplicate_id", index: i, id });
  });
  // 부모 줄 번호. -1이면 맨 위 (빈 부모, 없는 부모, 자기 자신)
  const up = data.map((d, i) => {
    const p = gp(d, i);
    if (!p) return -1;
    const k = first.get(p);
    if (k === undefined) onIssue?.({ code: "missing_parent", index: i, id: ids[i] });
    else if (k === i) onIssue?.({ code: "cycle", index: i, id: ids[i] });
    return k === undefined || k === i ? -1 : k;
  });
  const kids: number[][] = Array.from({ length: n }, () => []);
  up.forEach((p, i) => p >= 0 && kids[p].push(i));

  const root: TreeNode<T> = { id: "", label: rootLabel, value: 0, depth: 0, parent: null, children: [], datum: null, index: 0 };
  const made: (TreeNode<T> | null)[] = new Array(n).fill(null);
  // 깊이 우선으로 (재귀 없이, 사슬이 아주 길어도). 이미 만든 줄은 건너뛰어서 고리가 있어도 끝나요
  const grow = (top: number) => {
    const stack: [number, TreeNode<T>][] = [[top, root]];
    while (stack.length) {
      const [i, parent] = stack.pop()!;
      if (made[i]) continue;
      const label = gl(data[i], i) || ids[i];
      // 잎이 되면 이 값을 그대로 써요. 자식이 생기면 아래에서 자식 합으로 바꿔요
      const value = Math.max(0, gv(data[i], i) || 0);
      const node: TreeNode<T> = { id: parent.id ? `${parent.id}/${label}` : label, label, value, depth: parent.depth + 1, parent, children: [], datum: data[i], index: parent.children.length };
      parent.children.push(node);
      made[i] = node;
      for (let k = kids[i].length - 1; k >= 0; k--) stack.push([kids[i][k], node]);
    }
  };
  for (let i = 0; i < n; i++) if (up[i] < 0) grow(i);
  // 남은 줄은 고리 위에 있거나 고리 아래에 매달려 있어요. 위로 올라가다 다시 만난 줄에서 고리를 끊어요
  for (let i = 0; i < n; i++) {
    if (made[i]) continue;
    const seen = new Set<number>();
    let x = i;
    while (!seen.has(x) && !made[x]) {
      seen.add(x);
      x = up[x];
    }
    if (made[x]) continue;
    onIssue?.({ code: "cycle", index: x, id: ids[x] });
    grow(x);
  }
  // 값은 잎에서 위로. 부모가 먼저인 차례를 거꾸로 더하면 재귀가 없어요
  const order = preorder(root);
  for (let k = order.length - 1; k >= 0; k--) {
    const nd = order[k];
    if (nd.children.length) nd.value = nd.children.reduce((s, ch) => s + ch.value, 0);
  }
  return root;
}

/**
 * buildTree keeps a name made only of spaces as a name. The tree treats it as blank, as it treats "": a blank group or path step
 * is left out (its children move up to its parent) and a blank row name becomes "#n" (n is the row number). Changes the tree in place,
 * and only when such a name exists, so buildTree itself (shared with the treemap and sunburst) stays as it is.
 */
export function dropBlankNames<T>(root: TreeNode<T>, data: readonly T[]): void {
  const all = preorder(root);
  if (!all.some((nd) => nd !== root && !nd.label.trim())) return;
  for (const nd of all) {
    if (nd === root || nd.label.trim()) continue;
    if (nd.datum === null && nd.parent) {
      const at = nd.parent.children.indexOf(nd);
      nd.parent.children.splice(at, 1, ...nd.children);
      for (const ch of nd.children) ch.parent = nd.parent;
    } else {
      const row = data.indexOf(nd.datum as T);
      nd.label = `#${(row >= 0 ? row : nd.index) + 1}`;
    }
  }
  // 옮긴 노드의 id, 깊이, 형제 차례를 다시 매겨요
  for (const nd of preorder(root)) nd.children.forEach((ch, i) => Object.assign(ch, { id: nd.id ? `${nd.id}/${ch.label}` : ch.label, depth: nd.depth + 1, index: i }));
}

/** Every node in pre-order (parents before children), without recursion */
export function preorder<T>(root: TreeNode<T>): TreeNode<T>[] {
  const out: TreeNode<T>[] = [];
  const stack = [root];
  while (stack.length) {
    const nd = stack.pop()!;
    out.push(nd);
    for (let k = nd.children.length - 1; k >= 0; k--) stack.push(nd.children[k]);
  }
  return out;
}

/** The node drawn as the root: the added root's only child when there is one, otherwise the added root (several top-level nodes) */
export function drawnRoot<T>(root: TreeNode<T>): TreeNode<T> {
  return root.children.length === 1 ? root.children[0] : root;
}

/**
 * Nodes a name points at: every node with that label, or the node at that path of labels joined by "/".
 * A path may start at any level ("Orders/Checkout" finds "Payments API/Orders/Checkout").
 * ids are buildTree's label paths without the added root, so a path never starts with its label.
 */
export function findNodes(nodes: readonly { id: string; label: string }[], name: string): number[] {
  const out: number[] = [];
  if (!name) return out;
  const tail = `/${name}`;
  nodes.forEach((nd, i) => {
    if (nd.label === name || nd.id === name || nd.id.endsWith(tail)) out.push(i);
  });
  return out;
}

export interface TreeSlot {
  /** Position across the tree (leaf order). A leaf takes the next slot, a parent sits halfway between its first and last child */
  slot: number;
  /** Depth below the drawn root */
  depth: number;
}

/**
 * Leaf-ordered tidy layout: each visible leaf gets the next slot in data order (half a slot more when the parent changes,
 * so sibling groups read apart), and a parent sits halfway between its first and last child. Subtrees take disjoint ranges,
 * so links never cross. hidden(node) true hides that node's children (a collapsed branch). Linear time, no recursion.
 */
export function layoutSlots<T>(root: TreeNode<T>, hidden: (n: TreeNode<T>) => boolean): { nodes: TreeNode<T>[]; slots: Map<TreeNode<T>, TreeSlot>; span: number; levels: number } {
  const nodes: TreeNode<T>[] = [];
  const slots = new Map<TreeNode<T>, TreeSlot>();
  const stack: [TreeNode<T>, number][] = [[root, 0]];
  while (stack.length) {
    const [nd, depth] = stack.pop()!;
    nodes.push(nd);
    slots.set(nd, { slot: 0, depth });
    if (!hidden(nd)) for (let k = nd.children.length - 1; k >= 0; k--) stack.push([nd.children[k], depth + 1]);
  }
  let next = 0;
  let lastParent: TreeNode<T> | null | undefined;
  let levels = 0;
  // 잎 차례로 자리를 주고, 부모는 거꾸로 돌며 첫 자식과 끝 자식 가운데로
  for (const nd of nodes) {
    const s = slots.get(nd)!;
    levels = Math.max(levels, s.depth);
    if (hidden(nd) || !nd.children.length) {
      if (lastParent !== undefined && nd.parent !== lastParent) next += 0.5;
      s.slot = next++;
      lastParent = nd.parent;
    }
  }
  for (let k = nodes.length - 1; k >= 0; k--) {
    const nd = nodes[k];
    if (hidden(nd) || !nd.children.length) continue;
    slots.get(nd)!.slot = (slots.get(nd.children[0])!.slot + slots.get(nd.children[nd.children.length - 1])!.slot) / 2;
  }
  return { nodes, slots, span: Math.max(1, next), levels };
}
