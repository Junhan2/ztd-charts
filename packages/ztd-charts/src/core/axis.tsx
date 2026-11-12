import type { Painter } from "../theme/context";
import { Txt } from "./ChartFrame";
import { formatNumber, type ValueFormatter } from "./format";
import { textWidth, truncate } from "./text";

export const AXIS_FONT = 10.5;

/** Tick labels. When the shortened labels collide (Korean 10만, 10만, 10.1만), that axis alone uses full numbers. locale is the locale used then (the chart's c.locale) */
export function tickLabels(ticks: readonly number[], fmt: ValueFormatter, locale?: string): string[] {
  const out = ticks.map(fmt);
  if (new Set(out).size === out.length) return out;
  // On a collision, use as many decimals as the tick step needs (a step of 0.00001 gets 5, so very small values do not all become "0")
  let step = Infinity;
  for (let i = 1; i < ticks.length; i++) step = Math.min(step, Math.abs(ticks[i] - ticks[i - 1]));
  const digits = step > 0 && Number.isFinite(step) ? Math.min(20, Math.max(2, Math.ceil(-Math.log10(step) - 1e-9))) : 2;
  return ticks.map((t) => formatNumber(t, { locale, maximumFractionDigits: digits }));
}

export function yAxisWidth(ticks: number[], fmt: ValueFormatter, locale?: string): number {
  let w = 18;
  for (const l of tickLabels(ticks, fmt, locale)) w = Math.max(w, textWidth(l, AXIS_FONT));
  return Math.ceil(w + 8);
}

export function GridY(props: { p: Painter; ticks: number[]; y: (v: number) => number; x0: number; x1: number; fmt: ValueFormatter; labels?: boolean; zero?: boolean; opacity?: number; side?: "left" | "right"; locale?: string }) {
  const { p, ticks, y, x0, x1, fmt } = props;
  const right = props.side === "right";
  const labels = props.labels === false ? null : tickLabels(ticks, fmt, props.locale);
  return (
    <g aria-hidden="true" opacity={props.opacity}>
      {ticks.map((t, i) => {
        const yy = Math.round(y(t)) + 0.5;
        const zero = t === 0 && props.zero !== false;
        return (
          <g key={t}>
            <line x1={x0} x2={x1} y1={yy} y2={yy} stroke={p.paint(zero ? "dim" : "line")} strokeWidth={1} shapeRendering="crispEdges" opacity={zero ? 0.7 : 1} />
            {labels ? (
              <Txt x={right ? x1 + 6 : x0 - 6} y={yy} anchor={right ? "start" : "end"} size={AXIS_FONT} fill={p.paint("muted")}>
                {labels[i]}
              </Txt>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

/** Drops centered x tick labels that come within 8px of the previous label or extend outside [lo, hi] */
export function fitTickLabels<T extends { x: number; label: string }>(ticks: readonly T[], lo: number, hi: number): T[] {
  const keep: T[] = [];
  let lastR = -Infinity;
  for (const t of ticks) {
    const w = textWidth(t.label, AXIS_FONT);
    const l = Math.max(t.x - w / 2, 0);
    if (l < lastR + 8 || t.x - w / 2 < lo || t.x + w / 2 > hi) continue;
    keep.push(t);
    lastR = l + w;
  }
  return keep;
}

/**
 * Thins cell labels so they do not overlap. Returns the indexes to show.
 * keep (a waterfall chart's totals, highlighted items) always stays, and the rest are thinned around it
 */
export function thinLabels(centers: number[], labels: string[], size = AXIS_FONT, gap = 8, weight = 400, keep?: ReadonlySet<number>): number[] {
  const n = labels.length;
  if (n <= 1) return labels.map((_, i) => i);
  const widths = labels.map((l) => textWidth(l, size, weight));
  const near = (a: number, b: number) => Math.abs(centers[b] - centers[a]) < (widths[a] + widths[b]) / 2 + gap;
  // When keep entries overlap each other, only the earlier one stays. Left overlapping, no spacing could resolve them, and even the keep entries were all dropped
  const must: number[] = [];
  for (const k of keep ?? []) if (!must.some((m) => near(m, k))) must.push(k);
  const free = (i: number) => !must.some((m) => near(m, i));
  for (let step = 1; step <= n; step++) {
    const idx = must.slice();
    for (let i = 0; i < n; i += step) if (free(i)) idx.push(i);
    if (step > 1 && (n - 1) % step > step / 2 && free(n - 1)) idx.push(n - 1);
    idx.sort((a, b) => a - b);
    if (idx.every((b, k) => !k || !near(idx[k - 1], b))) return idx;
  }
  return [0, n - 1];
}

export function AxisXBand(props: {
  p: Painter;
  labels: string[];
  centers: number[];
  y: number;
  strong?: ReadonlySet<number>;
  sub?: string[];
  size?: number;
  maxWidth?: number;
  /** Chart width. Labels are truncated to the room left before the edge (so a highlighted label is not clipped outside the card) */
  width: number;
}) {
  const { p, labels, centers, y, width } = props;
  const size = props.size ?? AXIS_FONT;
  // Width a centered label fits in: twice the distance to the nearer edge, at most maxWidth (default 160px). Overlap is counted with the shortened text
  const fitted = labels.map((l, i) => {
    const edge = 2 * Math.max(0, Math.min(centers[i], width - centers[i])) - 2;
    return truncate(l, Math.min(props.maxWidth ?? 160, edge), size, props.strong?.has(i) ? 700 : 500);
  });
  const show = thinLabels(centers, fitted, size, 6, 600, props.strong);
  return (
    <g aria-hidden="true">
      {show.map((i) => {
        const strong = props.strong?.has(i);
        return (
          <g key={i}>
            <Txt x={centers[i]} y={y} anchor="middle" size={size} weight={strong ? 700 : 500} fill={p.paint(strong ? "ink" : "muted")}>
              {fitted[i]}
            </Txt>
            {props.sub?.[i] ? (
              <Txt x={centers[i]} y={y + size + 3} anchor="middle" size={size - 1} fill={p.paint("muted")}>
                {props.sub[i]}
              </Txt>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Vertical line at the pointed x, with a halo dot for each series. Moved with a CSS transform, so it glides to the next spot (instantly with reduced motion) */
export function HoverLine(props: { p: Painter; x: number; top: number; bottom: number; dots?: { k: number | string; y: number; color: string; strong?: boolean }[] }) {
  const { p } = props;
  return (
    <g className="ztd-guide" aria-hidden="true" pointerEvents="none" style={{ transform: `translate(${r1(props.x)}px,0px)` }}>
      <line x1={0} x2={0} y1={props.top} y2={props.bottom} stroke={p.paint("dim")} strokeWidth={1} />
      {props.dots?.map((d) => (
        <g key={d.k} className="ztd-guide" style={{ transform: `translate(0px,${r1(d.y)}px)` }}>
          <circle r={d.strong ? 9 : 7} fill={d.color} opacity={0.2} />
          <circle r={d.strong ? 4.2 : 3.2} fill={d.color} stroke={p.paint("panel")} strokeWidth={2} />
        </g>
      ))}
    </g>
  );
}

/** The pointed value as a pill on the x axis. It covers the tick labels below with a card-background border and stays within the chart width */
export function AxisPill(props: { p: Painter; x: number; y: number; label: string; width: number }) {
  const { p } = props;
  const label = truncate(props.label, 160, AXIS_FONT, 700);
  const w = textWidth(label, AXIS_FONT, 700) + 14;
  const x = Math.max(w / 2 + 1, Math.min(props.width - w / 2 - 1, props.x));
  return (
    <g className="ztd-guide" aria-hidden="true" pointerEvents="none" style={{ transform: `translate(${r1(x)}px,${r1(props.y)}px)` }}>
      <rect x={-w / 2} y={-9} width={w} height={18} rx={9} fill={p.paint("ink")} stroke={p.paint("panel")} strokeWidth={3} paintOrder="stroke" />
      <Txt x={0} y={0} anchor="middle" size={AXIS_FONT} weight={700} fill={p.paint("onInk")}>
        {label}
      </Txt>
    </g>
  );
}
