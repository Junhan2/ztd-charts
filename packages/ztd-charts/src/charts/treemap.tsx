import { useMemo } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { roundRectPath } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { buildTree, leaves, sortTree, squarify, type Rect, type TreeNode } from "../layout/hierarchy";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Treemap",
  ofTotal: "% of total",
  desc: (n: number) => `${plural(n, "item")}. Largest`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "트리맵", ofTotal: "전체 대비", desc: (n) => `${n}개 항목. 큰 항목` },
};

export interface TreemapProps<T = Row> extends BaseChartProps<T> {
  label?: Accessor<T, string>;
  value?: Accessor<T, number>;
  /** Parent group field. When present, group headers are drawn */
  group?: Accessor<T, string>;
  /** List of multi-level path fields */
  path?: string[];
  /** Children field of nested data. Default "children" */
  children?: string;
  /** Cell labels: "both" (name + share) | "name" | "value" | "none". Default "both" */
  labelMode?: "both" | "name" | "value" | "none";
  /** Sort largest first. Default true */
  sort?: boolean;
}

interface Cell<T> {
  i: number;
  node: TreeNode<T>;
  rect: Rect;
  hi: boolean;
  pct: number;
}

interface GroupBox<T> {
  node: TreeNode<T>;
  rect: Rect;
  pct: number;
}

const GAP = 3;
const HEAD = 16;

/** Treemap: shares of a hierarchy shown as areas */
export function Treemap<T = Row>(props: TreemapProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(180, Math.min(280, w * 0.58)), duration: 700, stagger: 45 });
  const { p, width: W, height: H } = c;

  const tree = useMemo(() => {
    const root = buildTree(props.data, { label: props.label, value: props.value, group: props.group, path: props.path, children: props.children });
    if (props.sort !== false) sortTree(root);
    return root;
  }, [props.data, props.label, props.value, props.group, props.path, props.children, props.sort]);

  const layout = useMemo(() => {
    const total = tree.value || 1;
    const grouped = tree.children.some((ch) => ch.children.length > 0);
    const cells: Cell<T>[] = [];
    const groups: GroupBox<T>[] = [];
    const lv = leaves(tree);
    const hiSet = resolveHighlight(props.highlight, lv.map((l) => l.datum as T), lv.map((l) => l.label), lv.map((l) => l.value), "max");
    const hiNodes = new Set([...hiSet].map((k) => lv[k]));
    const place = (node: TreeNode<T>, box: Rect, depth: number) => {
      const kids = node.children;
      const rects = squarify(
        kids.map((k) => k.value),
        box,
      );
      kids.forEach((k, j) => {
        const r = rects[j];
        if (k.children.length) {
          const head = grouped && r.h > HEAD + 18 && r.w > 40 ? HEAD : 0;
          groups.push({ node: k, rect: r, pct: (k.value / total) * 100 });
          const inner = { x: r.x, y: r.y + head, w: r.w, h: r.h - head };
          place(k, inner, depth + 1);
        } else {
          cells.push({ i: lv.indexOf(k), node: k, rect: r, hi: hiNodes.has(k), pct: (k.value / total) * 100 });
        }
      });
    };
    place(tree, { x: 0, y: 0, w: W + GAP, h: H + GAP }, 0);
    cells.sort((a, b) => a.i - b.i);
    return { cells, groups, total, lv };
  }, [tree, W, H, props.highlight]);

  const stg = c.motion.stagger ?? 45;
  const marks = useMemo<Mark<Cell<T>>[]>(
    () =>
      layout.cells.map((cl, k) => {
        const r = cl.rect;
        const w = Math.max(0, r.w - GAP);
        const h = Math.max(0, r.h - GAP);
        return {
          key: `t:${cl.node.id}`,
          to: [r.x, r.y, w, h, 1],
          from: [r.x + w * 0.04, r.y + h * 0.04, w * 0.92, h * 0.92, 0],
          enter: [r.x + w / 2, r.y + h / 2, 0, 0, 0],
          delay: k * stg,
          data: cl,
        };
      }),
    [layout, stg],
  );
  const m = useMotion(marks, c.motion);
  const neutral = swatch(p, "neutral");
  const accent = swatch(p, "accent");
  const mode = props.labelMode ?? "both";

  const events: ChartEvent<T>[] = layout.cells.map((cl) => ({
    datum: cl.node.datum,
    index: cl.i,
    key: cl.node.id,
    label: cl.node.label,
    series: cl.node.parent && cl.node.parent.depth > 0 ? cl.node.parent.label : undefined,
    value: cl.node.value,
    formatted: `${c.fv(cl.node.value)} · ${c.pct(cl.pct)}`,
  }));
  const byIndex = new Map(layout.cells.map((cl) => [cl.i, cl]));

  const msg = MSG[c.lang];
  let tip: TooltipData | null = null;
  if (c.active !== null) {
    const cl = byIndex.get(c.active);
    if (cl) {
      tip = {
        x: cl.rect.x + (cl.rect.w - GAP) / 2,
        y: cl.rect.y + 4,
        title: cl.node.parent && cl.node.parent.depth > 0 ? `${cl.node.parent.label} › ${cl.node.label}` : cl.node.label,
        rows: [
          { label: c.t.value, value: c.fv(cl.node.value), color: cl.hi ? accent.fill : neutral.fill },
          { label: msg.ofTotal, value: c.pct(cl.pct) },
        ],
      };
    }
  }

  const desc = props.description ?? `${msg.kind}. ${msg.desc(layout.cells.length)}: ${[...layout.cells].sort((a, b) => b.node.value - a.node.value).slice(0, 3).map((cl) => `${cl.node.label} ${c.pct(cl.pct)}`).join(", ")}.`;

  return (
    <ChartFrame c={c} kind={msg.kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      {layout.groups.map((g, k) => {
        const head = g.rect.h > HEAD + 18 && g.rect.w > 40;
        if (!head) return null;
        const text = `${g.node.label} ${c.pct(g.pct)}`;
        return (
          <Txt key={g.node.id} x={g.rect.x + 1} y={g.rect.y + HEAD / 2 - 1} size={10.5} weight={500} fill={p.paint("muted")} opacity={m.fade(k * stg * 2, 300)}>
            {truncate(text, g.rect.w - GAP - 2, 10.5)}
          </Txt>
        );
      })}
      {m.items.map((it) => {
        const cl = it.data;
        const [x, y, w, h, o] = it.v;
        const sw = cl.hi ? accent : neutral;
        const name = cl.node.label;
        const val = c.pct(cl.pct);
        const pad = 7;
        const fs = w > 120 && h > 60 ? 12 : 11;
        const canTwo = mode === "both" && h >= fs * 2 + 16 && w >= Math.min(textWidth(name, fs, 700), 40) + pad * 2;
        const canOne = h >= fs + 12 && w >= 30;
        const active = c.active === cl.i;
        return (
          <g key={it.key} opacity={it.exiting ? o * 0.6 : c.dim(cl.i)} className="ztd-mark" onPointerEnter={(e) => c.setActive(cl.i, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(cl.i)} style={{ cursor: props.onClick ? "pointer" : undefined }}>
            <path d={roundRectPath(x, y, w, h, Math.min(p.theme.radiusMark + 1, w / 4, h / 4))} fill={sw.fill} opacity={o} />
            {active && c.via === "keyboard" ? <path d={roundRectPath(x + 1, y + 1, w - 2, h - 2, 4)} fill="none" stroke={p.paint("ink")} strokeWidth={2} /> : null}
            {mode !== "none" && c.showLabels && canOne ? (
              <g opacity={o * m.fade(cl.i * stg + 200, 260)}>
                {mode === "value" ? (
                  <Txt x={x + pad} y={y + pad + fs / 2 + 1} size={fs} weight={700} fill={sw.text}>
                    {val}
                  </Txt>
                ) : (
                  <Txt x={x + pad} y={y + pad + fs / 2 + 1} size={fs} weight={700} fill={sw.text}>
                    {truncate(name, w - pad * 2, fs, 700)}
                  </Txt>
                )}
                {canTwo ? (
                  <Txt x={x + pad} y={y + pad + fs * 1.7 + 2} size={fs - 0.5} weight={500} fill={sw.text}>
                    {truncate(val, w - pad * 2, fs - 0.5)}
                  </Txt>
                ) : null}
              </g>
            ) : null}
          </g>
        );
      })}
    </ChartFrame>
  );
}
