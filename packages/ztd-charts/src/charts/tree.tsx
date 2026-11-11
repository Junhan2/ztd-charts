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
  /** 노드 이름 필드. 기본 "label" */
  label?: Accessor<T, string>;
  /** 값 필드. 주면 점 크기가 값을 따라요(잎에서 위로 더해요). 없으면 점은 단계마다 같은 크기예요 */
  value?: Accessor<T, number>;
  /** 부모 그룹 필드 (트리맵, 선버스트와 같은 평평한 표) */
  group?: Accessor<T, string>;
  /** 여러 단계 경로 필드 목록 (트리맵, 선버스트와 같아요) */
  path?: string[];
  /** 중첩 데이터의 자식 필드. 기본 "children" */
  children?: string;
  /** id/parent 행의 id 필드. 기본 "id", 없으면 이름 */
  id?: Accessor<T, string>;
  /** 부모 id 필드. 주면 행마다 노드 하나인 id/parent 표로 읽어요 */
  parent?: Accessor<T, string>;
  /** "horizontal"(뿌리가 왼쪽) | "radial"(뿌리가 가운데). 기본 "horizontal" */
  layout?: "horizontal" | "radial";
  /** 형제를 값이 큰 순서로. 기본 false (데이터 순서) */
  sort?: boolean;
  /** 맨 위 노드가 여럿일 때 더하는 뿌리의 이름. 기본 "All" (한국어 로캘은 "전체") */
  rootLabel?: string;
  /** 처음에 접어 둘 가지 (이름이나 "/"로 이은 경로). 서버도 같이 접어 그려요 */
  collapsed?: readonly string[];
}

/** 원형 기본 높이: 단계 하나의 최소 고리 폭과 잎 하나의 최소 둘레 (px) */
const RING_MIN = 60;
/** 넓은 카드(차트 폭 560px 넘게)에서는 작은 트리도 자리를 쓰게 단계 하나의 고리를 100px까지 넓혀요. 좁은 카드는 그대로예요 */
const ringFor = (w: number) => (w > 560 ? Math.min(100, RING_MIN + (w - 560) / 2.5) : RING_MIN);
const ARC_MIN = 18;
/**
 * 원형에서 잎 이름이 원 밖으로 뻗는 몫(px): 위, 아래, 왼쪽, 오른쪽. 잎마다 각도와 이름 폭(+ 점과 띄움 22px)으로 재고, 한 이름은 cap(px)까지예요
 * (더 긴 이름은 줄여요. cap은 fitRadial이 고리가 너무 얇아지지 않는 만큼 골라요).
 * 이름이 짧은 쪽은 덜 비워서, 원이 상자를 채우고 가운데가 내용의 가운데에 와요
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
/** 원의 하한: 단계 하나의 고리 폭(px). 이름 몫을 넓히다가 고리가 이보다 얇아지면 멈춰요 (더 얇으면 가운데 뿌리 이름이 첫 고리 점에 걸려 줄어요) */
const RING_FLOOR = 48;
/** 한 잎 이름이 가질 수 있는 몫(차트 폭에 대한 비율). 앞이 기본이고, 이름이 잘리면 다음 몫을 봐요 */
const SHARES = [0.2, 0.24, 0.28, 0.34, 0.4];
type Leaf = { a: number; w: number };
interface RadialFit {
  e: ReturnType<typeof radialExtents>;
  R: number;
  cx: number;
  cy: number;
  h: number;
}

/** 이름 몫이 share일 때의 원: 높이를 정하지 않았으면 기본 높이 규칙(단계마다 ringFor 고리)으로 정해요 */
function radialAt(leaves: readonly Leaf[], levels: number, span: number, w: number, share: number, fixedH?: number): RadialFit {
  const e = radialExtents(leaves, w * share);
  const h = fixedH ?? clamp(2 * clamp(Math.max(levels * ringFor(w), (span * ARC_MIN) / TAU), 24, (w - e.left - e.right) / 2 - 4) + e.top + e.bottom + 8, 160, 680);
  const R = Math.max(16, Math.min(w - e.left - e.right, h - e.top - e.bottom) / 2 - 4);
  return { e, R, cx: (e.left + w - e.right) / 2, cy: (e.top + h - e.bottom) / 2, h };
}

/** 바깥 고리 잎 이름이 바퀴살 방향으로 카드 끝까지 못 들어가는 수 (이름 놓기의 자리 계산과 같아요) */
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
 * 원형 배치. 잎 이름 몫은 폭의 20%부터 시작해서, 이름이 잘리면 몫을 넓혀(원은 작아져요) 잘리는 이름이 줄어드는 가장 작은 몫을 골라요.
 * 원이 하한(단계마다 RING_FLOOR, 잎마다 ARC_MIN의 둘레)보다 작아지면 멈춰요. 이름이 다 들어가는 넓은 카드는 예전과 같아요
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
/** 바깥 이름이 붙는 잎(자식이 없거나 접힌 노드)의 각도와 이름 폭 */
function leafAngles<T>(lay: { nodes: TreeNode<T>[]; slots: Map<TreeNode<T>, { slot: number }>; span: number }, root: TreeNode<T>, isShut: (nd: TreeNode<T>) => boolean) {
  return lay.nodes.filter((nd) => nd !== root && (!nd.children.length || isShut(nd))).map((nd) => ({ a: ((lay.slots.get(nd)!.slot + 0.5) / lay.span) * TAU, w: textWidth(nd.label, FS, 600) }));
}

/** 노드가 이보다 많으면 노드마다 움직이지 않고 한꺼번에 나타나요 (프레임마다 수천 개를 다시 그리지 않게) */
const MOVE_MAX = 1500;
const FS = 11;
/** 가로형 기본 높이의 잎 한 줄 (px). 11px 이름이 넉넉히 읽히고, 갤러리 카드가 이웃 카드와 비슷한 높이예요 */
const ROW = 15;
const ROOT_FS = 12;

interface NodeInfo<T> {
  nd: TreeNode<T>;
  key: string;
  parentKey: string | null;
  depth: number;
  /** 화면 좌표 목표 */
  x: number;
  y: number;
  /** 원형일 때 각도와 반지름 */
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
  /** posesOf가 돌려준 자리 중 몇 번째 */
  k: number;
}

/** 돌린 직사각형 둘이 겹치는지 (분리축 검사) */
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
 * 트리: 부모와 자식의 이어짐을 점과 곡선으로. 트리맵, 선버스트와 같은 데이터(group, path, children)를 받고, id/parent 행도 받아요.
 * 강조한 노드에서 뿌리까지의 경로만 강조색이에요. 노드를 누르거나 Enter로 가지를 접고 펴요
 */
export function Tree<T = Row>(props: TreeProps<T>) {
  const radial = props.layout === "radial";
  const full = useMemo(() => {
    // 트리맵, 선버스트와 같은 모양(group, path, children)이거나, parent가 있으면 id/parent 행
    const acc = { label: props.label, value: props.value, group: props.group, path: props.path, children: props.children, id: props.id, parent: props.parent };
    const r = props.parent !== undefined ? stratify(props.data, acc, "") : buildTree(props.data, acc, "");
    if (props.parent === undefined) dropBlankNames(r, props.data);
    if (props.sort) sortTree(r);
    return r;
  }, [props.data, props.label, props.value, props.group, props.path, props.children, props.id, props.parent, props.sort]);
  const root = drawnRoot(full);
  const empty = !root.children.length && root === full;
  // 모든 노드(접힌 가지 안까지)의 차례와 key. 강조 번호, 접기 상태, 애니메이션 key가 같이 써요
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

  // 접기: 처음 접힌 가지(props.collapsed, 서버와 같아요)와 사용자가 뒤집은 가지(key)의 차
  const collapsedSig = (props.collapsed ?? []).join("\u0001");
  const initial = useMemo(
    () => new Set((Array.isArray(props.collapsed) ? props.collapsed : []).flatMap((name) => findNodes(all, String(name)).map((i) => all[i]))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, collapsedSig],
  );
  const [flips, setFlips] = useState<ReadonlySet<string>>(() => new Set());
  const shut = (nd: TreeNode<T>) => nd.children.length > 0 && initial.has(nd) !== flips.has(keyOf.get(nd) ?? "");
  // 높이는 처음 접힌 상태로 정해요. 접고 펼 때 카드 높이가 뛰지 않아요
  // 원형은 내용이 정하는 반지름(단계마다 RING_MIN, 잎마다 ARC_MIN의 둘레)에 잎 이름 몫을 더한 지름이에요. 작은 트리가 큰 카드를 비워 두지 않아요
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

  // 강조: 이름과 경로는 모든 노드에서 찾고, 번호와 "max" 같은 낱말은 resolveHighlight로 (값은 잎만 견줘요)
  const onPath = useMemo(() => {
    const h = props.highlight as Highlight<T> | undefined;
    const hit = new Set<TreeNode<T>>();
    if (h != null && all.length) {
      const list = typeof h === "function" ? null : Array.isArray(h) ? h : [h];
      const isName = (x: unknown): x is string => typeof x === "string" && !HIGHLIGHT_KEYWORDS.includes(x);
      // 더한 뿌리는 그 이름표로도 찾아요 (validateSpec과 같아요)
      if (list) for (const x of list) if (isName(x)) for (const i of [...(root === full && x === rootName ? [0] : []), ...findNodes(all, x)]) hit.add(all[i]);
      const rest = list?.filter((x) => !isName(x));
      if (!rest || rest.length)
        for (const i of resolveHighlight((rest ?? h) as Highlight<T>, all.map((nd) => nd.datum as T), all.map((nd) => nd.label), all.map((nd) => (nd.children.length ? NaN : nd.value)), "none")) hit.add(all[i]);
    }
    const path = new Set<TreeNode<T>>();
    for (const nd of hit) for (let q: TreeNode<T> | null = nd; q && !path.has(q); q = q === root ? null : q.parent) path.add(q);
    return { hit, path };
  }, [props.highlight, all, root, full, rootName]);

  // 자리 (목표). 가로형은 x가 깊이, y가 잎 차례. 원형은 각도가 잎 차례, 반지름이 깊이예요
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
      // 잎 이름 몫을 뺀 상자에 원을 꽉 채우고 그 가운데에 둬요
      // 이름 몫의 상한은 기본 높이를 정할 때처럼 폭으로 재요 (높이로 재면 낮은 카드에서 이름이 더 줄어요)
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
    // 값: 제곱근 척도로 2.5~9px (자리 간격 안으로). 뿌리는 합계라 가장 커요
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
   * 노드 이름을 놓을 수 있는 자리들 (앞이 먼저). room은 목표 자리에서 쓸 수 있는 폭이에요.
   * 가로형: 잎은 오른쪽, 가지는 왼쪽 그다음 위. 원형: 잎은 바깥, 가지는 안쪽 그다음 아래와 위(가로 글자), 왼쪽 반은 뒤집어 바로 읽혀요
   */
  const posesOf = (n: NodeInfo<T>, x: number, y: number, a: number, rr: number): { pose: LabelPose; room: number }[] => {
    const isRoot = n.nd === root;
    const flat = (dy: number, anchor: LabelPose["anchor"], dx = 0, room = Infinity) => ({ pose: { x: x + dx, y: y + dy, rot: 0, anchor }, room: Math.min(room, anchor === "middle" ? 2 * Math.min(x, W - x) - 4 : anchor === "start" ? W - x - dx - 2 : x + dx - 2) });
    const up = -n.dot - 9;
    if (!radial) {
      // 접힌 가지는 점 둘레 고리(3px) 밖에서
      if (!n.open) return [flat(0, "start", n.dot + (n.nd.children.length ? 8 : 5))];
      // 위 자리는 선 위에 겹쳐도 바탕색 테두리로 읽혀요. 다른 이름과는 겹침 검사가 갈라요
      return isRoot ? [flat(0, "end", -n.dot - 5), flat(up, "start", -n.dot)] : [flat(0, "end", -n.dot - 5, geo.colW - n.dot - 13), flat(up, "middle", 0, geo.colW * 2)];
    }
    // 뿌리와 가지는 가로 글자로 점 아래, 위, 바깥쪽 옆, 안쪽 옆 차례 (가지는 마지막에 바퀴살을 따라 안쪽으로)
    const side = Math.sin(a) >= 0 ? 1 : -1;
    const level = (room: number) => [flat(n.dot + 10, "middle", 0, room), flat(up, "middle", 0, room), flat(0, side > 0 ? "start" : "end", side * (n.dot + 6), room), flat(0, side > 0 ? "end" : "start", -side * (n.dot + 6), room)];
    if (isRoot) return level(180);
    const right = a < Math.PI;
    const deg = (a * 180) / Math.PI;
    const rot = right ? deg - 90 : deg + 90;
    if (!n.open) {
      // 바깥으로 뻗는 이름: 카드 가장자리까지 (모서리 쪽이 더 길어요)
      const [px, py] = polar(geo.cx, geo.cy, rr + n.dot + (n.nd.children.length ? 8 : 5), a);
      const ux = Math.sin(a);
      const uy = -Math.cos(a);
      const inset = FS * 0.5 + 2;
      const room = Math.min(ux > 1e-6 ? (W - inset - px) / ux : ux < -1e-6 ? (inset - px) / ux : Infinity, uy > 1e-6 ? (H - inset - py) / uy : uy < -1e-6 ? (inset - py) / uy : Infinity);
      return [{ pose: { x: px, y: py, rot, anchor: right ? "start" : "end" }, room }];
    }
    // 바퀴살을 따라 안쪽으로: 부모 고리까지 (첫 단계는 뿌리 점 앞까지)
    const [px, py] = polar(geo.cx, geo.cy, rr - n.dot - 5, a);
    const inner = n.depth === 1 ? (geo.info.get(root)?.dot ?? 5) + 8 : 8;
    return [...level(Math.min(geo.ring * 1.6, 160)), { pose: { x: px, y: py, rot, anchor: right ? "end" : "start" }, room: geo.ring - n.dot - 5 - inner }];
  };

  // 이름 고르기: 강조 경로를 먼저 (늘 남겨요), 그다음 뿌리, 얕은 단계부터. 자리마다 온전한 이름이 겹치지 않고 들어가는지 먼저 보고,
  // 없으면 줄인 이름으로 다시 봐요. 이미 놓은 이름과 겹치거나 카드 밖으로 나가면 빼요 (강조 경로는 첫 자리에 줄여서라도 둬요)
  const labels = useMemo(() => {
    const out = new Map<TreeNode<T>, Placed>();
    if (!c.showLabels) return out;
    const list = [...geo.info.values()];
    const rank = (n: NodeInfo<T>) => (n.path ? 0 : n.nd === root ? 1 : 2);
    list.sort((A, B) => rank(A) - rank(B) || A.depth - B.depth);
    // 놓은 상자를 40px 칸에 넣어 두고 가까운 칸만 봐요 (노드 수천 개에서도 선형)
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
    // 점(접힌 가지는 고리까지)도 이름이 덮지 않게 먼저 넣어요
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
          // 세 글자 남짓으로 줄인 이름("Nod…")은 읽히지 않아서 빼요 (강조 경로는 아래에서 따로 둬요)
          if (!text || (text !== name.trim() && text.length < 5)) continue;
          const box = boxOf(cands[k].pose, textWidth(text, size, weight), size);
          if (!outside(box) && !hits(box)) pick = { k, text, box };
        }
      // 강조 경로는 늘 남겨요: 자리마다 온전한 이름과 점점 줄인 이름을 놓아 보고, 겹치는 상자(이름, 점)가 가장 적고 그다음 가장 긴 것을 둬요
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

  // 움직임: 뿌리는 제자리, 나머지는 부모에서 떨어진 거리(가로형 dx, dy, 원형 각도와 반지름 차)를 움직여요.
  // 그래서 선이 늘 부모에 붙어 있고, 등장 때 뿌리에서 자라 나오며, 접고 펼 때도 지금 자리에서 이어 가요
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
      // 원형의 첫 단계는 각도를 그대로(뿌리의 각도는 0), 반지름만 0에서 자라요
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
  // 큰 트리의 등장은 노드가 움직이지 않고 한꺼번에 나타나요(__fade만 움직여요). 그동안 자리와 바탕 층을 프레임마다 다시 만들지 않아요.
  // 접고 펼 때처럼 노드가 움직이는 동안은 다시 만들어요
  const nodesMoving = moving && (!big || m.items.some((it) => it.data && it.progress < 1));

  // 지금 자리 (화면 좌표). 움직이는 동안만 프레임마다 다시 세요
  const pos = useMemo(() => {
    const cur = new Map<string, { v: number[]; n: NodeInfo<T>; exiting: boolean; grow: number }>();
    // 다른 배치(가로형, 원형)의 key는 빼요. 배치를 바꾸는 순간 두 벌이 함께 있을 수 있어요
    for (const it of m.items) if (it.data && it.key.startsWith(pre)) cur.set(it.key.slice(pre.length), { v: it.v, n: it.data, exiting: it.exiting, grow: it.progress });
    // 가로형은 (x, y), 원형은 (각도, 반지름). 뿌리는 제자리 값, 나머지는 부모 자리 + 떨어진 거리예요.
    // 부모가 이미 사라진 노드(데이터가 바뀌며 빠지는 중)는 뿌리 자리에 붙여요
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
    // 원형: 반지름은 고르게 늘고 각도는 부드럽게(양끝에서 0인 속도로) 바뀌는 곡선. 부모에서 바깥으로 나가 자식에 바깥으로 닿고,
    // 반지름이 줄지 않아 안쪽으로 휘지 않아요. 뿌리에서 나가는 선은 곧은 선이에요. 각도 차가 크면 3차 곡선 조각을 늘려요
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

  // 화면에 그리는 노드 차례 = 키보드, 표, 이벤트 차례 (뿌리부터 앞 순서)
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
    // say는 이 값들로만 정해져요
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
  /** 누르기와 Enter: 가지를 접거나 펴고 onClick을 불러요. 고른 노드가 없으면 false */
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

  // 바탕 층(선, 점, 이름)은 자리가 바뀔 때만 다시 만들어요. 호버는 위에 경로만 덧그리고 바탕을 한꺼번에 흐려요
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
            // 접힌 가지는 점 둘레에 고리
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
    // 등장 중에는 이름이 시간에 따라 나타나서 elapsed가 바뀔 때마다, 끝나면 자리와 이름이 바뀔 때만 다시 만들어요
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pos, labels, p, nodesMoving ? m.elapsed : Infinity],
  );

  // 호버, 포커스: 그 노드에서 뿌리까지
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
        // 가장 가까운 점 (작은 점도 잡히게 반경 안에서)
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
        // 가로형: 왼쪽 부모, 오른쪽 첫 자식, 위아래 같은 단계. 원형: 위 부모, 아래 첫 자식, 왼쪽 오른쪽 같은 단계(시계 방향이 오른쪽)
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
