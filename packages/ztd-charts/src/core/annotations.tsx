import type { ReactNode } from "react";
import type { Painter } from "../theme/context";
import { Txt } from "./ChartFrame";
import type { ChartLang } from "./i18n";
import { linearFit } from "./geometry";
import { textWidth, truncate, type Box } from "./text";

/** One annotation on a chart (options.annotations) */
export interface Annotation {
  /** "band" shaded range | "line" horizontal reference line | "event" event marker | "forecast" forecast range | "trend" trend line | "weekends" weekend shading */
  type: "band" | "line" | "event" | "forecast" | "trend" | "weekends";
  /** event: the x value. band: the [start, end] x range */
  x?: unknown;
  /** line: the y value. band: the [bottom, top] y range */
  y?: number | readonly [number, number];
  /** forecast: the forecast starts at this x (the line turns dashed) */
  from?: unknown;
  label?: string;
}

const isPair = (v: unknown): v is readonly [unknown, unknown] => Array.isArray(v) && v.length === 2;

/** Values the y axis range must include (so ranges and reference lines outside the data still fit in the plot) */
export function annotationYs(list: readonly Annotation[] | undefined): number[] {
  const out: number[] = [];
  for (const a of list ?? []) {
    if (a.type === "line" && typeof a.y === "number") out.push(a.y);
    else if (a.type === "band" && isPair(a.y)) out.push(Number(a.y[0]), Number(a.y[1]));
  }
  return out.filter(Number.isFinite);
}

/** The x value where the forecast starts (undefined when there is none) */
export const forecastFrom = (list: readonly Annotation[] | undefined): unknown => list?.find((a) => a.type === "forecast")?.from;

export interface AnnotationGeom {
  p: Painter;
  lang: ChartLang;
  /** Maps an x value to pixels. null when it is not found */
  xAt: (v: unknown) => number | null;
  y: (v: number) => number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  /** For a date x: the time range, point count and time to pixel mapping (weekend shading). Absent when x is not a date */
  time?: { t0: number; t1: number; n: number; xt: (t: number) => number };
  /** Half a cell's width. Widens an x range to the outer edges of its end cells (categories, candles). 0 for a continuous x */
  half: number;
  /** Starts the forecast range at the cell's left edge (bars) */
  edge?: boolean;
  /** Points of the highlighted series to fit the trend line to (pixels) */
  points?: () => { x: number; y: number }[];
  /** Text boxes the labels avoid (bar value labels). Reference line, forecast and range labels move to a spot with less overlap */
  avoid?: readonly Box[];
}

type TagSpot = { x: number; y: number; anchor: "start" | "end" };

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** The candidate spot with the smallest overlap area with the boxes to avoid (stops at the first spot without overlap). The chosen box goes into taken so the next label avoids it */
function pickSpot(text: string, spots: TagSpot[], taken: Box[]): TagSpot {
  let best = spots[0];
  let least = Infinity;
  for (const s of spots) {
    const b = tagBox(text, s.x, s.y, s.anchor);
    const hit = taken.reduce((n, o) => n + overlap(b, o), 0);
    if (hit < least) {
      best = s;
      least = hit;
    }
    if (hit === 0) break;
  }
  taken.push(tagBox(text, best.x, best.y, best.anchor));
  return best;
}

const clampX = (g: AnnotationGeom, x: number) => Math.max(g.x0, Math.min(g.x1, x));
const inside = (g: AnnotationGeom, x: number | null): x is number => x !== null && x >= g.x0 - 1 && x <= g.x1 + 1;
/** Pixel range of the x range [start, end] (smaller end first). null when either end is not found */
function xRange(g: AnnotationGeom, v: readonly unknown[]): [number, number] | null {
  const a = g.xAt(v[0]);
  const b = g.xAt(v[1]);
  return a === null || b === null ? null : [Math.min(a, b) - g.half, Math.max(a, b) + g.half];
}

/** Top and bottom pixels of a horizontal band (y range). Clipped to the plot area; null when a value cannot be mapped to pixels. Shared by the band fill and its label */
function yRange(g: AnnotationGeom, v: readonly unknown[]): [number, number] | null {
  const a = g.y(Number(v[0]));
  const b = g.y(Number(v[1]));
  return Number.isFinite(a) && Number.isFinite(b) ? [Math.max(g.top, Math.min(a, b)), Math.min(g.bottom, Math.max(a, b))] : null;
}

/** Pixel where the forecast starts (pulled inside the plot's left edge). null when from is missing or right of the plot. The line's dashed split uses this too */
export function forecastX(g: AnnotationGeom, from: unknown): number | null {
  const x = from === undefined ? null : g.xAt(from);
  return x === null || x > g.x1 ? null : Math.max(g.x0, x - (g.edge ? g.half : 0));
}

const TEXT = {
  en: { forecast: "Forecast", trend: "Trend", period: "period", weekends: "weekends shaded", lead: "Annotations" },
  ko: { forecast: "예측", trend: "추세", period: "기간", weekends: "주말 음영", lead: "주석" },
};

/** Annotations laid under the series: shaded ranges, weekends, forecast ranges */
export function AnnotationsUnder({ list, g }: { list?: readonly Annotation[]; g: AnnotationGeom }) {
  if (!list?.length) return null;
  const { p } = g;
  const h = Math.max(0, g.bottom - g.top);
  const nodes: ReactNode[] = [];
  list.forEach((a, i) => {
    if (a.type === "band" && isPair(a.y)) {
      const ry = yRange(g, a.y);
      if (!ry) return;
      const [top, bot] = ry;
      nodes.push(
        <g key={i}>
          <rect x={g.x0} y={top} width={Math.max(0, g.x1 - g.x0)} height={Math.max(0, bot - top)} fill={p.paint("accent")} opacity={0.1} />
          <line x1={g.x0} x2={g.x1} y1={top} y2={top} stroke={p.paint("accent")} strokeOpacity={0.45} strokeDasharray="3 3" />
          <line x1={g.x0} x2={g.x1} y1={bot} y2={bot} stroke={p.paint("accent")} strokeOpacity={0.45} strokeDasharray="3 3" />
        </g>,
      );
    } else if ((a.type === "band" && isPair(a.x)) || a.type === "forecast") {
      let r: [number, number] | null;
      if (a.type === "forecast") {
        const xf = forecastX(g, a.from);
        r = xf === null ? null : [xf, g.x1];
      } else r = xRange(g, a.x as readonly unknown[]);
      if (!r) return;
      const xa = clampX(g, r[0]);
      const xb = clampX(g, r[1]);
      if (xb - xa < 0.5) return;
      nodes.push(<rect key={i} x={xa} y={g.top} width={xb - xa} height={h} fill={p.paint("ink")} opacity={0.05} />);
    } else if (a.type === "weekends" && g.time && g.time.t1 - g.time.t0 <= 86400000 * 400) {
      // From Saturday 00:00 to Monday 00:00. Beyond 400 days the cells are too thin, so nothing is drawn.
      // Shifted earlier by half the point spacing (at most 12 hours) so a day's point sits in the middle of the shading
      const pad = Math.min(43200000, (g.time.t1 - g.time.t0) / Math.max(1, g.time.n - 1) / 2);
      const d = new Date(g.time.t0);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - ((d.getDay() + 1) % 7));
      for (let n = 0; d.getTime() - pad <= g.time.t1 && n < 60; n++) {
        const sat = d.getTime();
        d.setDate(d.getDate() + 2);
        const xa = Math.max(g.x0, g.time.xt(sat - pad));
        const xb = Math.min(g.x1, g.time.xt(d.getTime() - pad));
        if (xb > xa) nodes.push(<rect key={`${i}w${n}`} x={xa} y={g.top} width={xb - xa} height={h} fill={p.paint("ink")} opacity={0.045} />);
        d.setDate(d.getDate() + 5);
      }
    }
  });
  return (
    <g aria-hidden="true" pointerEvents="none">
      {nodes}
    </g>
  );
}

/** Label width: text plus 4px on each side */
const tagW = (text: string, strong?: boolean) => textWidth(text, 10.5, strong ? 700 : 500) + 8;

/** Label (Tag) box: text plus 4px on each side, 16px tall. x is the end on the anchor side, y the middle of the line. Code that measures overlap in advance (scatter plot) uses this box too */
export function tagBox(text: string, x: number, y: number, anchor: "start" | "end" = "start", strong?: boolean): Box {
  const w = tagW(text, strong);
  return { x: anchor === "end" ? x - w : x, y: y - 8, w, h: 16 };
}

/** Small text on a card-background plate (readable even where a line passes). Scatter plot quadrant names and trend line labels use it too */
export function Tag({ p, x, y, text, anchor = "start", strong }: { p: Painter; x: number; y: number; text: string; anchor?: "start" | "end"; strong?: boolean }) {
  const b = tagBox(text, x, y, anchor, strong);
  return (
    <g>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={5} fill={p.paint("panel")} opacity={0.94} />
      <Txt x={b.x + 4} y={y} size={10.5} weight={strong ? 700 : 500} fill={p.paint(strong ? "ink" : "muted")}>
        {text}
      </Txt>
    </g>
  );
}

/** Annotations drawn over the series: reference lines, events, trend lines and range labels */
export function AnnotationsOver({ list, g }: { list?: readonly Annotation[]; g: AnnotationGeom }) {
  if (!list?.length) return null;
  const { p } = g;
  const tx = TEXT[g.lang];
  const nodes: ReactNode[] = [];
  // Event labels that overlap move down a row
  const rows: number[] = [];
  // Reference line, range and forecast labels avoid value labels and labels placed earlier. With no boxes to avoid, the first candidate (the old spot) is used
  const taken: Box[] = [...(g.avoid ?? [])];
  list.forEach((a, i) => {
    if (a.type === "line" && typeof a.y === "number") {
      const yy = g.y(a.y);
      if (!Number.isFinite(yy)) return;
      const text = a.label ? truncate(a.label, 160, 10.5) : "";
      const at = text
        ? pickSpot(text, [
            { x: g.x1 - 2, y: yy - 10, anchor: "end" },
            { x: g.x0 + 2, y: yy - 10, anchor: "start" },
            { x: g.x1 - 2, y: yy + 10, anchor: "end" },
            { x: g.x0 + 2, y: yy + 10, anchor: "start" },
          ], taken)
        : null;
      nodes.push(
        <g key={i}>
          <line x1={g.x0} x2={g.x1} y1={yy} y2={yy} stroke={p.paint("dim")} strokeDasharray="4 3" />
          {at ? <Tag p={p} x={at.x} y={at.y} text={text} anchor={at.anchor} /> : null}
        </g>,
      );
    } else if (a.type === "band" && a.label) {
      const ry = isPair(a.y) ? yRange(g, a.y) : [g.top, g.bottom];
      const r = isPair(a.x) ? xRange(g, a.x) : [g.x0, g.x1];
      if (!r || !ry) return;
      const [top, bot] = ry;
      const text = truncate(a.label, 160, 10.5);
      const x = Math.min(clampX(g, r[0]), g.x1 - 40) + 4;
      const at = pickSpot(text, [{ x, y: top + 11, anchor: "start" }, { x, y: bot - 11, anchor: "start" }], taken);
      nodes.push(<Tag key={i} p={p} x={at.x} y={at.y} text={text} />);
    } else if (a.type === "forecast") {
      const xf = forecastX(g, a.from);
      if (xf === null) return;
      const text = truncate(a.label ?? tx.forecast, 120, 10.5);
      const x = Math.min(xf + 4, g.x1 - 50);
      const at = pickSpot(text, [{ x, y: g.top + 9, anchor: "start" }, { x, y: g.bottom - 9, anchor: "start" }], taken);
      nodes.push(
        <g key={i}>
          <line x1={xf} x2={xf} y1={g.top} y2={g.bottom} stroke={p.paint("dim")} strokeDasharray="2 3" />
          <Tag p={p} x={at.x} y={at.y} text={text} />
        </g>,
      );
    } else if (a.type === "event" && a.label) {
      const xe = g.xAt(a.x);
      if (!inside(g, xe)) return;
      const text = truncate(a.label, 140, 10.5, 700);
      const w = tagW(text, true);
      const left = Math.max(g.x0, Math.min(xe - w / 2, g.x1 - w));
      let row = rows.findIndex((end) => end < left - 4);
      if (row < 0) row = rows.length;
      rows[row] = left + w;
      const yy = g.top + 9 + row * 18;
      nodes.push(
        <g key={i}>
          <line x1={xe} x2={xe} y1={yy + 8} y2={g.bottom} stroke={p.paint("ink")} strokeOpacity={0.45} strokeDasharray="2 3" />
          <circle cx={xe} cy={g.bottom} r={2.5} fill={p.paint("ink")} opacity={0.6} />
          <Tag p={p} x={left} y={yy} text={text} strong />
        </g>,
      );
    } else if (a.type === "trend" && g.points) {
      const pts = g.points().filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
      if (pts.length < 2) return;
      // Least-squares line. The axes are linear, so fitting in pixel coordinates gives the same line as fitting the data
      const { at } = linearFit(pts);
      const xa = pts[0].x;
      const xb = pts[pts.length - 1].x;
      nodes.push(
        <g key={i}>
          <line x1={xa} x2={xb} y1={at(xa)} y2={at(xb)} stroke={p.paint("muted")} strokeWidth={1.5} strokeDasharray="6 4" strokeLinecap="round" />
          <Tag p={p} x={xb - 2} y={at(xb) - 11} text={truncate(a.label ?? tx.trend, 120, 10.5)} anchor="end" />
        </g>,
      );
    }
  });
  return (
    <g aria-hidden="true" pointerEvents="none">
      {nodes}
    </g>
  );
}

/** Annotation sentences appended to the screen reader description. xText turns an x value into the chart's x label (without it, the value as written). An empty string when there are no annotations */
export function describeAnnotations(list: readonly Annotation[] | undefined, lang: ChartLang, fv: (v: number) => string, xText?: (v: unknown) => string): string {
  if (!list?.length) return "";
  const tx = TEXT[lang];
  const ko = lang === "ko";
  const s = xText ?? ((v: unknown) => String(v ?? ""));
  const parts = list
    .map((a) => {
      const label = a.label ? (ko ? `(${a.label})` : ` (${a.label})`) : "";
      if (a.type === "band" && isPair(a.y)) return ko ? `구간 ${fv(Number(a.y[0]))}~${fv(Number(a.y[1]))}${label}` : `band ${fv(Number(a.y[0]))} to ${fv(Number(a.y[1]))}${label}`;
      if (a.type === "band" && isPair(a.x)) return ko ? `${a.label ?? tx.period} ${s(a.x[0])}~${s(a.x[1])}` : `${a.label ?? tx.period} from ${s(a.x[0])} to ${s(a.x[1])}`;
      if (a.type === "line" && typeof a.y === "number") return ko ? `기준선 ${fv(a.y)}${label}` : `reference line at ${fv(a.y)}${label}`;
      if (a.type === "event") return ko ? `${s(a.x)} ${a.label ?? ""}`.trim() : `${a.label ?? "event"} at ${s(a.x)}`;
      if (a.type === "forecast") return ko ? `${s(a.from)}부터 ${a.label ?? tx.forecast}` : `${a.label ?? tx.forecast.toLowerCase()} from ${s(a.from)}`;
      if (a.type === "trend") return ko ? (a.label ?? "추세선") : (a.label ?? "trend line");
      if (a.type === "weekends") return tx.weekends;
      return "";
    })
    .filter(Boolean);
  return parts.length ? ` ${tx.lead}: ${parts.join(ko ? ", " : "; ")}.` : "";
}
