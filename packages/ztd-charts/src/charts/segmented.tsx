import { useMemo } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { roundRectPath } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { categorical, type Swatch } from "../core/palette";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter } from "../data/accessor";
import type { ChartLang } from "../core/i18n";

const en = { kind: "Segmented bar", share: "Share", total: "Total" };
const MSG: Record<ChartLang, typeof en> = { en, ko: { kind: "비율 막대", share: "비중", total: "합계" } };

export interface SegmentedBarProps<T = Row> extends BaseChartProps<T> {
  /** Item name field. Default "label" */
  label?: Accessor<T, string>;
  /** Value field. Default "value" */
  value?: Accessor<T, number>;
  /** "tall" (28px, shares inside) | "thin" (8px, no text). Default "tall" */
  variant?: "tall" | "thin";
  /** Place the largest values first. Default true */
  sort?: boolean;
  /** List of names, values and shares under the bar. Default true */
  list?: boolean;
}

interface Part<T> {
  i: number;
  label: string;
  value: number;
  share: number;
  /** Share text ("42%") */
  pct: string;
  sw: Swatch;
  hi: boolean;
  datum: T;
}

const GAP = 2;
const ROW_H = 26;

function listColumns(width: number, n: number): number {
  return width >= 420 && n >= 4 ? 2 : 1;
}

/** Segmented bar: one whole split into segments by each item's share. Only the one highlighted item is colored */
export function SegmentedBar<T = Row>(props: SegmentedBarProps<T>) {
  const tall = props.variant !== "thin";
  const barH = tall ? 28 : 8;
  const withList = props.list !== false;
  const n0 = props.data.length;
  const c = useChart(props, { height: (w) => barH + 4 + (withList ? 18 + Math.ceil(n0 / listColumns(w, n0)) * ROW_H : 0), duration: 800, stagger: 70, format: "number" });
  const { p, width: W, pct } = c;
  const msg = MSG[c.lang];

  const { parts, total } = useMemo(() => {
    const gl = strGetter(props.label, "label");
    const gv = numGetter(props.value, "value");
    const rows = props.data.map((d, i) => ({ d, i, label: gl(d, i), value: Math.max(0, gv(d, i) || 0) }));
    const ordered = props.sort === false ? rows : [...rows].sort((a, b) => b.value - a.value);
    const total = ordered.reduce((s, r) => s + r.value, 0);
    const hi = resolveHighlight(props.highlight, ordered.map((r) => r.d), ordered.map((r) => r.label), ordered.map((r) => r.value), "max");
    const colors = categorical(p, ordered.length, hi);
    const list: Part<T>[] = ordered.map((r, k) => {
      const share = total > 0 ? r.value / total : 0;
      return { i: r.i, label: r.label, value: r.value, share, pct: pct(share * 100), sw: colors[k], hi: hi.has(k), datum: r.d };
    });
    return { parts: list, total };
  }, [props.data, props.label, props.value, props.sort, props.highlight, p, pct]);

  // Items with 0 are not drawn in the bar (they stay in the list). Segments are separated by a 2px gap in the background color
  const layout = useMemo(() => {
    const drawn = parts.filter((q) => q.share > 0);
    const room = Math.max(0, W - GAP * Math.max(0, drawn.length - 1));
    let cursor = 0;
    return drawn.map((q) => {
      const w = room * q.share;
      const g = { q, key: `s:${q.label}`, x: cursor, w };
      cursor += w + GAP;
      return g;
    });
  }, [parts, W]);
  const geo = useMemo(() => new Map(layout.map((g) => [g.q.i, g])), [layout]);

  const stg = c.motion.stagger ?? 70;
  const marks = useMemo<Mark<number>[]>(() => layout.map((g, k) => ({ key: g.key, to: [g.x, g.w], from: [g.x, 0], enter: [g.x, 0], delay: k * stg, data: g.q.i })), [layout, stg]);
  const m = useMotion(marks, c.motion);

  const index = useMemo(() => new Map(parts.map((q, k) => [q.i, k])), [parts]);
  const fv = c.fv;
  const events = useMemo<ChartEvent<T>[]>(() => parts.map((q, k) => ({ datum: q.datum, index: k, key: q.label, label: q.label, value: q.value, formatted: `${fv(q.value)} (${q.pct})` })), [parts, fv]);
  const top = 2;
  let tip: TooltipData | null = null;
  if (c.active !== null && parts[c.active]) {
    const q = parts[c.active];
    const g = geo.get(q.i);
    if (g) tip = { x: g.x + g.w / 2, y: top, title: q.label, rows: [{ label: c.t.value, value: c.fv(q.value), color: q.sw.fill }, { label: msg.share, value: q.pct }] };
  }

  const cols = listColumns(W, parts.length);
  const colW = W / cols;
  const listTop = top + barH + 18;
  const desc = props.description ?? `${msg.kind}. ${msg.total} ${c.fv(total)}. ${parts.map((q) => `${q.label} ${q.pct}`).join(", ")}.`;
  const r = tall ? 4 : barH / 2;

  return (
    <ChartFrame c={c} kind={msg.kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      {layout.length ? null : <rect x={0} y={top} width={W} height={barH} rx={r} fill={p.paint("neutralSoft")} />}
      {m.items.map((it) => {
        const k = index.get(it.data) ?? 0;
        const q = parts[k];
        if (!q) return null;
        const [x, w] = it.v;
        if (w < 0.5) return null;
        const fits = tall && c.showLabels && w >= textWidth(q.pct, 11, 700) + 14;
        return (
          <g key={it.key} className="ztd-mark" opacity={it.exiting ? 0.4 : c.dim(k)} onPointerEnter={(e) => c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(k)} style={{ cursor: props.onClick ? "pointer" : undefined }}>
            <path d={roundRectPath(x, top, w, barH, Math.min(r, w / 2))} fill={q.sw.fill} />
            {c.active === k && c.via === "keyboard" ? <path d={roundRectPath(x - 2, top - 2, w + 4, barH + 4, Math.min(r + 2, w / 2 + 2))} fill="none" stroke={p.paint("ink")} strokeWidth={2} /> : null}
            {fits ? (
              <Txt x={x + 8} y={top + barH / 2} size={11} weight={700} fill={q.sw.text} opacity={m.fade(k * stg + 300, 240)}>
                {q.pct}
              </Txt>
            ) : null}
          </g>
        );
      })}
      {withList
        ? parts.map((q, k) => {
            const col = k % cols;
            const row = Math.floor(k / cols);
            const x = col * colW;
            const y = listTop + row * ROW_H;
            const right = x + colW - (cols > 1 && col === 0 ? 16 : 0);
            const shareText = q.pct;
            const valueText = c.fv(q.value);
            const shareW = textWidth(shareText, 11.5, 500);
            const valueW = textWidth(valueText, 12, q.hi ? 800 : 600);
            const labelMax = right - x - 18 - shareW - valueW - 18;
            return (
              <g key={`l${q.i}`} opacity={c.dim(k)} onPointerEnter={(e) => c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(k)}>
                <rect x={x} y={y - ROW_H / 2 + 2} width={Math.max(0, right - x)} height={ROW_H - 4} fill="transparent" />
                <rect x={x} y={y - 5} width={10} height={10} rx={3} fill={q.sw.fill} />
                <Txt x={x + 18} y={y} size={12} weight={q.hi ? 700 : 500} fill={p.paint(q.hi ? "ink" : "muted")}>
                  {truncate(q.label, Math.max(24, labelMax), 12, q.hi ? 700 : 500)}
                </Txt>
                <Txt x={right - shareW - 10} y={y} anchor="end" size={12} weight={q.hi ? 800 : 600} fill={p.paint("ink")}>
                  {valueText}
                </Txt>
                <Txt x={right} y={y} anchor="end" size={11.5} fill={p.paint("muted")}>
                  {shareText}
                </Txt>
              </g>
            );
          })
        : null}
    </ChartFrame>
  );
}
