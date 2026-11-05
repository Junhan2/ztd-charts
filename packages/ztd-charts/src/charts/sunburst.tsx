import { useMemo } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { arcPath, polar, TAU } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { swatch, type Swatch } from "../core/palette";
import { dodgeVertical, textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { buildTree, leaves, partitionAngles, sortTree, treeHeight, type Arc } from "../layout/hierarchy";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Sunburst",
  ofTotal: "% of total",
  desc: (levels: number) => `${plural(levels, "level")}, innermost ring:`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "선버스트", ofTotal: "전체 대비", desc: (levels) => `${levels}단계, 안쪽부터` },
};

export interface SunburstChartProps<T = Row> extends BaseChartProps<T> {
  label?: Accessor<T, string>;
  value?: Accessor<T, number>;
  group?: Accessor<T, string>;
  path?: string[];
  children?: string;
  /** 큰 순서로 정렬. 기본 false (데이터 순서) */
  sort?: boolean;
  /** 가운데 구멍 비율. 기본 0.3 */
  hole?: number;
}

interface ArcInfo<T> extends Arc<T> {
  i: number;
  sw: Swatch;
  hi: boolean;
  leaf: boolean;
  pct: number;
}

/**
 * 고리 조각 가운데에 가로로 쓰는 이름의 최대 폭. 높이 h 인 글자 상자의 네 모서리가 조각 가장자리에서 pad 만큼 안쪽에 드는 가장 큰 폭이에요.
 * 고리 왼쪽·오른쪽에서는 가로 글자가 고리 두께 방향으로 놓여서 호 길이보다 훨씬 좁아요. 넘치면 글자가 카드 바탕 위로 나가 안 보여요.
 */
function labelRoom(r0: number, r1: number, a0: number, a1: number, h: number, pad: number): number {
  const rm = (r0 + r1) / 2;
  const mid = (a0 + a1) / 2;
  const [px, py] = polar(0, 0, rm, mid);
  const half = (a1 - a0) / 2 - pad / rm;
  const fits = (w: number) => {
    // 상자에서 고리 중심까지 가장 가까운 거리가 안쪽 반지름보다 커야 해요
    if (Math.hypot(Math.max(Math.abs(px) - w / 2, 0), Math.max(Math.abs(py) - h / 2, 0)) < r0 + pad) return false;
    for (const x of [px - w / 2, px + w / 2])
      for (const y of [py - h / 2, py + h / 2]) {
        if (Math.hypot(x, y) > r1 - pad) return false;
        const off = Math.atan2(x, -y) - mid;
        if (Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) > half) return false;
      }
    return true;
  };
  if (half <= 0 || !fits(0)) return 0;
  let lo = 0;
  let hi = 2 * r1;
  for (let k = 0; k < 12; k++) {
    const w = (lo + hi) / 2;
    if (fits(w)) lo = w;
    else hi = w;
  }
  return lo;
}

/** 선버스트: 원형으로 그린 계층. 안쪽 고리가 상위 단계예요 */
export function SunburstChart<T = Row>(props: SunburstChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(200, Math.min(270, w * 0.62)), duration: 900 });
  const { p, width: W, height: H } = c;

  const tree = useMemo(() => {
    const root = buildTree(props.data, { label: props.label, value: props.value, group: props.group, path: props.path, children: props.children });
    if (props.sort) sortTree(root);
    return root;
  }, [props.data, props.label, props.value, props.group, props.path, props.children, props.sort]);

  const levels = Math.max(1, treeHeight(tree));
  const arcsBase = useMemo(() => partitionAngles(tree), [tree]);

  const info = useMemo(() => {
    const lv = leaves(tree);
    const hiSet = resolveHighlight(props.highlight, lv.map((l) => l.datum as T), lv.map((l) => l.label), lv.map((l) => l.value), "max");
    const hiLeaves = new Set([...hiSet].map((k) => lv[k]));
    const hiAnc = new Set<unknown>();
    hiLeaves.forEach((l) => {
      let q = l.parent;
      while (q && q.depth > 0) {
        hiAnc.add(q);
        q = q.parent;
      }
    });
    const total = tree.value || 1;
    return arcsBase.map((a, i): ArcInfo<T> => {
      const leaf = !a.node.children.length;
      const hi = hiLeaves.has(a.node);
      const sw = hi ? swatch(p, "accent") : hiAnc.has(a.node) ? swatch(p, "ink") : leaf ? swatch(p, "neutral") : swatch(p, "strong");
      return { ...a, i, sw, hi, leaf, pct: (a.node.value / total) * 100 };
    });
  }, [arcsBase, tree, props.highlight, p]);

  // Zero leaves draw nothing, so they get no outside label (and take no dodge slot), as pie does.
  const outer = info.filter((a) => a.depth === levels && a.node.value > 0);
  const labelW = Math.max(40, ...outer.map((a) => textWidth(`${a.node.label} ${c.pct(a.pct)}`, 11, 600))) + 14;
  const R = Math.max(30, Math.min(H / 2 - 10, (W - 2 * labelW) / 2));
  const cx = W / 2;
  const cy = H / 2;
  const hole = R * (props.hole ?? 0.3);
  const ring = (R - hole) / levels;
  const radii = (d: number): [number, number] => [hole + ring * (d - 1) + (d > 1 ? 2 : 0), hole + ring * d];

  const D = c.motion.duration ?? 900;
  const marks = useMemo<Mark<ArcInfo<T> | null>[]>(() => {
    const ms: Mark<ArcInfo<T> | null>[] = info.map((a) => ({ key: `a:${a.node.id}`, to: [a.a0, a.a1], enter: [a.a0, a.a0], exit: [(a.a0 + a.a1) / 2, (a.a0 + a.a1) / 2], data: a }));
    for (let d = 1; d <= levels; d++) ms.push({ key: `__sweep${d}`, to: [TAU], from: [0], delay: (d - 1) * D * 0.28, data: null });
    return ms;
  }, [info, levels, D]);
  const m = useMotion(marks, c.motion);

  const events: ChartEvent<T>[] = info.map((a) => ({
    datum: a.node.datum,
    index: a.i,
    key: a.node.id,
    label: a.node.label,
    series: a.node.parent && a.node.parent.depth > 0 ? a.node.parent.label : undefined,
    value: a.node.value,
    formatted: `${c.fv(a.node.value)} · ${c.pct(a.pct)}`,
  }));

  const outsideLabels = useMemo(() => {
    const list = outer.map((a) => {
      const mid = (a.a0 + a.a1) / 2;
      const [x, y] = polar(cx, cy, R + 10, mid);
      return { a, x, y, side: Math.sin(mid) >= 0 ? 1 : -1, mid };
    });
    const out = new Map<string, { x: number; y: number; anchor: "start" | "end" | "middle" }>();
    for (const side of [1, -1]) {
      const g = list.filter((l) => l.side === side);
      const ys = dodgeVertical(
        g.map((l) => l.y),
        14,
        7,
        H - 7,
      );
      g.forEach((l, k) => {
        const nearV = Math.abs(Math.sin(l.mid)) < 0.18;
        out.set(l.a.node.id, { x: l.x + (nearV ? 0 : side * 2), y: ys[k], anchor: nearV ? "middle" : side > 0 ? "start" : "end" });
      });
    }
    return out;
  }, [outer, cx, cy, R, H]);

  const msg = MSG[c.lang];
  let tip: TooltipData | null = null;
  if (c.active !== null && info[c.active]) {
    const a = info[c.active];
    const [, r1] = radii(a.depth);
    const [tx, ty] = polar(cx, cy, r1, (a.a0 + a.a1) / 2);
    tip = {
      x: tx,
      y: ty,
      title: a.node.parent && a.node.parent.depth > 0 ? `${a.node.parent.label} › ${a.node.label}` : a.node.label,
      rows: [
        { label: c.t.value, value: c.fv(a.node.value), color: a.sw.fill },
        { label: msg.ofTotal, value: c.pct(a.pct) },
      ],
    };
  }

  const desc = props.description ?? `${msg.kind}. ${msg.desc(levels)} ${tree.children.map((ch) => `${ch.label} ${c.pct((ch.value / (tree.value || 1)) * 100)}`).join(", ")}.`;

  return (
    <ChartFrame c={c} kind={msg.kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      {m.items.map((it) => {
        const a = it.data;
        if (!a) return null;
        const sweep = m.get(`__sweep${a.depth}`)?.[0] ?? TAU;
        const [r0, r1] = radii(a.depth);
        const a0 = Math.min(it.v[0], sweep);
        const a1 = Math.min(it.v[1], sweep);
        const d = arcPath(cx, cy, r0, r1, a0, a1);
        if (!d) return null;
        return (
          <path
            key={it.key}
            className="ztd-mark"
            d={d}
            fill={a.sw.fill}
            stroke={p.paint("panel")}
            strokeWidth={1.5}
            strokeLinejoin="round"
            opacity={it.exiting ? 0.5 : c.dim(a.i)}
            onPointerEnter={(e) => c.setActive(a.i, e.pointerType === "touch" ? "touch" : "pointer")}
            onClick={() => c.click(a.i)}
            style={{ cursor: props.onClick ? "pointer" : undefined }}
          />
        );
      })}
      {c.active !== null && c.via === "keyboard" && info[c.active] ? (
        <path d={arcPath(cx, cy, radii(info[c.active].depth)[0] - 1, radii(info[c.active].depth)[1] + 2, info[c.active].a0, info[c.active].a1)} fill="none" stroke={p.paint("ink")} strokeWidth={2} pointerEvents="none" />
      ) : null}
      {c.showLabels ? (
        <g>
          {info.map((a) => {
            const [r0, r1] = radii(a.depth);
            const mid = (a.a0 + a.a1) / 2;
            const o = m.fade((a.depth - 1) * D * 0.28 + D * 0.45 + (a.a0 / TAU) * 200, 260) * c.dim(a.i);
            if (a.depth === levels && levels > 0 && a.leaf) {
              const pos = outsideLabels.get(a.node.id);
              if (!pos) return null;
              const text = `${a.node.label} ${c.pct(a.pct)}`;
              return (
                <Txt key={a.node.id} x={pos.x} y={pos.y} anchor={pos.anchor} size={11} weight={a.hi ? 800 : 500} fill={p.paint(a.hi ? "ink" : "muted")} opacity={o}>
                  {text}
                </Txt>
              );
            }
            const rm = (r0 + r1) / 2;
            const arcLen = (a.a1 - a.a0) * rm;
            const fs = 10.5;
            if (arcLen < 26 || r1 - r0 < 14) return null;
            const name = truncate(a.node.label, labelRoom(r0, r1, a.a0, a.a1, fs, 3), fs, 700);
            if (!name) return null;
            const [x, y] = polar(cx, cy, rm, mid);
            return (
              <Txt key={a.node.id} x={x} y={y} anchor="middle" size={fs} weight={700} fill={a.sw.text} opacity={o}>
                {name}
              </Txt>
            );
          })}
        </g>
      ) : null}
    </ChartFrame>
  );
}
