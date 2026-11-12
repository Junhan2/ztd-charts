import { useCallback, useMemo, type KeyboardEvent } from "react";
import { AXIS_FONT, GridY, yAxisWidth } from "../core/axis";
import { CanvasLayer } from "../core/CanvasLayer";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { makeTickFormatter } from "../core/format";
import { resolveHighlight } from "../core/highlight";
import { lazyArray } from "../core/lazy";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { extent, fitDomain, fitLogDomain, scaleLinear, scaleLog, scaleSqrt } from "../core/scale";
import { labelBox, overlaps, type Box } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Highlight, Row, TooltipData, TooltipRow } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter } from "../data/accessor";
import { plural, type ChartLang } from "../core/i18n";
import { SCATTER_KIT, type CanvasGroup, type PlacedTag, type PlotBox, type ScatterKit, type SeriesLabel } from "./scatter-kit";
import { DOT_PAD, HEX_TOP, PLOT_BOTTOM } from "../layout/hexbin";
import { hexFacetPlan } from "./scatter-hex";

const en = {
  bubble: "Bubble chart",
  scatter: "Scatter plot",
  size: "Size",
  sizeWord: "size",
  nth: (i: number) => `#${i}`,
  /** r: x min, x max, y min, y max */
  desc: (sized: boolean, n: number, r: string[]) => `${sized ? "Bubble chart" : "Scatter plot"}. ${plural(n, "point")}. x from ${r[0]} to ${r[1]}, y from ${r[2]} to ${r[3]}.`,
  /** Description: points left out because of the log scale (y at or below 0) */
  logDropped: (n: number) => ` ${plural(n, "point")} with y at or below 0 ${n === 1 ? "is" : "are"} not shown on the log scale.`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    bubble: "버블 차트",
    scatter: "산점도",
    size: "크기",
    sizeWord: "크기",
    nth: (i) => `${i}번`,
    desc: (sized, n, r) => `${sized ? "버블 차트" : "산점도"}. 점 ${n}개. x ${r[0]}~${r[1]}, y ${r[2]}~${r[3]}.`,
    logDropped: (n) => ` 로그 눈금이라 y가 0 이하인 점 ${n}개는 뺐어요.`,
  },
};

/** Props shared by the bubble chart and scatter plot */
interface PointChartProps<T> extends BaseChartProps<T> {
  x?: Accessor<T, number>;
  y?: Accessor<T, number>;
  /** Name field (tooltip, labels) */
  label?: Accessor<T, string>;
  xLabel?: string;
  yLabel?: string;
  /** Include 0 in the axes. Default false */
  zero?: boolean;
  /** Maximum number of labels (highlighted first, then the largest circles). Default 6 */
  maxLabels?: number;
  /** Above this many points, draw on canvas. Default 1500 */
  canvasThreshold?: number;
  xFormat?: BaseChartProps<T>["format"];
  /** "log" gives the y axis a log scale (10, 100, 1,000 equally spaced). Values at or below 0 are left out and their count goes in the description. Default "linear" */
  yScale?: "linear" | "log";
  /** Fixed x range [start, end]. Small multiples (ChartFacets) use it to align the panels' axes */
  xDomain?: [number, number];
  /** Fixed y range [min, max]. With a log scale, used only when both ends are above 0 */
  yDomain?: [number, number];
  /** x axis tick labels. Default true. false removes only the labels and keeps their space */
  showXAxis?: boolean;
  /** y axis tick labels and yLabel. Default true. false removes the labels and their space */
  showYAxis?: boolean;
}

export interface BubbleChartProps<T = Row> extends PointChartProps<T> {
  /** Circle size field. Without it, a scatter plot */
  size?: Accessor<T, number>;
  /** Circle radius range (px). Default [4, 26] */
  sizeRange?: [number, number];
}

export interface ScatterChartProps<T = Row> extends PointChartProps<T> {
  /** Series field. The highlighted series is painted accent and the rest in gray steps; with 4 or fewer series, names are labeled right next to the points */
  series?: Accessor<T, string>;
  /** Names of series to hide. Colors are set from all series, so the remaining series keep their colors */
  hidden?: readonly string[];
  /** "linear" draws a least-squares trend line fitted to the visible points. Slope and R² in the tooltip */
  fit?: "linear";
  /** Reference lines { x, y }. With both, the plot is split into quadrants */
  refLines?: { x?: number; y?: number };
  /** Quadrant names in the order top left, top right, bottom left, bottom right. Drawn when refLines has both x and y */
  quadrants?: readonly string[];
  /** Spreads points with the same x value sideways. amount is the width as a multiple of the smallest x gap (default 0.4); seed is a fixed random seed (default 1) */
  jitter?: { amount?: number; seed?: number };
  /** With series, picks series by name, index, array or "first" (default). A predicate function highlights a series when any one of its rows matches. Without series, it picks points (none by default) */
  highlight?: Highlight<T>;
  /** "hex" counts points into hexagonal cells and colors each cell by its count (empty cells are not drawn). Series, jitter, point names, highlight and canvas are not used */
  bin?: "hex";
  /** Hexagon cell width (px, between two opposite sides). Default 16, 4~200 */
  binSize?: number;
  /** Number of color steps for bin "hex" (2~12). Default 5 */
  colorSteps?: number;
  /** Point counts at both ends of the bin "hex" color scale [low, high]. Small multiples (ChartFacets) use it to match colors across panels */
  binDomain?: [number, number];
  /** The color legend on top for bin "hex". Default true. Small multiples draw the legend once above the group, so it is false in the panels */
  binLegend?: boolean;
}

/** Props PointChart takes. kit is the bundle of scatter features that only ScatterChart passes; without it, a bubble chart */
type PointProps<T> = BubbleChartProps<T> & ScatterChartProps<T> & { kit: ScatterKit | undefined };

/** Options only the scatter plot takes. Empty for the bubble chart, so they draw nothing even when mixed into the spec options */
type ScatterOptions<T> = Pick<ScatterChartProps<T>, "series" | "hidden" | "fit" | "refLines" | "quadrants" | "jitter">;

/** Point list for hexbin density, which uses no points */
const NO_DOTS: never[] = [];

interface Dot<T> {
  i: number;
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  vs: number;
  label: string;
  hi: boolean;
  datum: T;
  /** Series index. -1 without series */
  si: number;
}

/** Empty list used when there are no scatter options. A new array on every render would redo the label layout every frame */
const NO_BOXES: Box[] = [];
const NO_SERIES_LABELS: SeriesLabel[] = [];
const NO_PLACED_TAGS: PlacedTag[] = [];
const NO_NAMES: string[] = [];

/** Position of the x axis title: inside the plot's bottom-right corner */
const xTitleAt = (b: PlotBox) => ({ x: b.x1 - 2, y: b.y1 - 8 });

/** Draw order: highlighted on top; otherwise the smaller circle on top. Above 0 means a is drawn over b */
function drawOrder<T>(a: Dot<T>, b: Dot<T>): number {
  return Number(a.hi) - Number(b.hi) || b.r - a.r;
}

/** Bubble chart: three values at once, x, y and size. Without size, a scatter plot */
export function BubbleChart<T = Row>(props: BubbleChartProps<T>) {
  // The bubble chart does not turn on scatter features even when scatter options are mixed into the spec options
  return <PointChart<T> {...props} kit={undefined} />;
}

/**
 * Scatter plot: the bubble chart's drawing with small points and no size. Adds series colors, a trend line, reference lines and quadrants, jitter, arrow-key navigation and hexbin density.
 * facetPlan is the panel-prop adjuster that small multiples (ChartFacets) call (one shared color scale for hexbin density). It is attached to the component, so it lands in the bundle only when the scatter plot is used
 */
export const ScatterChart = /* @__PURE__ */ Object.assign(
  function ScatterChart<T = Row>(props: ScatterChartProps<T>) {
    return <PointChart<T> {...props} kit={SCATTER_KIT} />;
  },
  { facetPlan: hexFacetPlan },
);

const finiteOrUndefined = (v: number | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** A [low, high] usable as a fixed range: only when both ends are finite and the smaller comes first; otherwise the data range is used (validateSpec reports it) */
const fixedRange = (d: unknown): [number, number] | undefined => (Array.isArray(d) && d.length === 2 && Number.isFinite(d[0]) && Number.isFinite(d[1]) && d[0] < d[1] ? (d as [number, number]) : undefined);

function PointChart<T>(props: PointProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(220, Math.min(320, w * 0.6)), duration: 800, stagger: 0 });
  const { p, width: W, height: H } = c;
  const kit = props.kit;
  // Hexbin density (scatter bin "hex"): draws only the point count per cell, so series, hiding and jitter are not used (validateSpec reports it)
  const hex = kit && props.bin === "hex" ? kit.hex : null;
  const so: ScatterOptions<T> = !kit ? {} : hex ? { fit: props.fit, refLines: props.refLines, quadrants: props.quadrants } : props;
  const hasSize = !kit && props.size !== undefined;
  const isLog = props.yScale === "log";
  // Series name per row (the series field is read only once)
  const rowSeries = useMemo(() => {
    if (so.series === undefined) return null;
    const g = strGetter(so.series, "series");
    return props.data.map((d, i) => g(d, i));
  }, [props.data, so.series]);
  // Colors are set once from all series, hidden ones included, so hiding one series leaves the other colors unchanged. That is why the series list is built from all rows too
  const seriesNames = useMemo(() => (kit && rowSeries ? kit.uniq(rowSeries) : NO_NAMES), [kit, rowSeries]);
  // Array options may arrive as new arrays on every render, so compare them as strings
  const hiddenKey = so.hidden?.join("\u0001") ?? "";
  const quadrantKey = so.quadrants?.join("\u0001") ?? "";
  const jitterAmount = so.jitter ? Math.max(0, so.jitter.amount ?? 0.4) : 0;
  const jitterSeed = so.jitter?.seed ?? 1;
  const refX = finiteOrUndefined(so.refLines?.x);
  // On a log scale, a y reference line at or below 0 is not used for the range, line or quadrants, and the trend line (least squares in value units, so it would curve on a log axis) is not drawn
  const refYIn = finiteOrUndefined(so.refLines?.y);
  const refY = isLog && refYIn !== undefined && refYIn <= 0 ? undefined : refYIn;
  const fitOn = so.fit === "linear" && !isLog;
  // Series, trend and reference-line descriptions are added only when scatter options change the picture. Without options, or with options that have no effect (empty hidden, zero-width jitter), the picture and description match the bubble chart's scatter plot
  const hasScatterOptions = rowSeries !== null || fitOn || refX !== undefined || refY !== undefined || jitterAmount > 0;

  const raw = useMemo(() => {
    const gx = numGetter(props.x, "x");
    const gy = numGetter(props.y, "y");
    const gs = hasSize ? numGetter(props.size, "size") : null;
    const gl = strGetter(props.label, "label");
    // px is the drawn x. Without jitter it equals x, so it starts with the same value
    const rows = props.data
      .map((d, i) => {
        const vx = gx(d, i);
        return { d, i, x: vx, y: gy(d, i), s: gs ? Math.max(0, gs(d, i) || 0) : 1, label: gl(d, i), si: -1, px: vx };
      })
      .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && (!isLog || r.y > 0));
    // The bubble chart, and a scatter plot without jitter or series, stop here, so many points do not cost another pass over the rows
    if (!kit || (jitterAmount <= 0 && !rowSeries)) return rows;
    // Jitter width is measured from the x gaps of all series, hidden ones included, so the remaining points stay in place when a series is hidden
    const gap = jitterAmount > 0 ? kit.smallestGap(rows.map((r) => r.x)) : 0;
    const index = new Map(seriesNames.map((s, k) => [s, k]));
    const hidden = new Set(hiddenKey ? hiddenKey.split("\u0001") : []);
    const out: typeof rows = [];
    for (const r of rows) {
      if (gap) r.px = r.x + (kit.seededUnit(jitterSeed, r.i) * 2 - 1) * jitterAmount * gap;
      if (rowSeries) {
        const name = rowSeries[r.i];
        if (hidden.has(name)) continue;
        r.si = index.get(name) ?? -1;
      }
      out.push(r);
    }
    return out;
  }, [props.data, props.x, props.y, props.size, props.label, hasSize, kit, rowSeries, seriesNames, hiddenKey, jitterAmount, jitterSeed, isLog]);
  // Number of points left out because of the log scale (y at or below 0). Written into the description
  const logDropped = useMemo(() => {
    if (!isLog) return 0;
    const gx = numGetter(props.x, "x");
    const gy = numGetter(props.y, "y");
    return props.data.filter((d, i) => Number.isFinite(gx(d, i)) && gy(d, i) <= 0).length;
  }, [isLog, props.data, props.x, props.y]);

  const n = raw.length;
  const useCanvas = !hex && c.hydrated && n > (props.canvasThreshold ?? 1500);
  const ext = useMemo(() => ({ x: extent(raw.map((r) => r.x)), y: extent(raw.map((r) => r.y)), s: extent(raw.map((r) => r.s)) }), [raw]);
  // Axis ranges include jittered positions and reference lines. Without either, the data range as is
  const plotExt = useMemo(() => {
    if (!jitterAmount && refX === undefined && refY === undefined) return ext;
    return { ...ext, x: extent(refX === undefined ? raw.map((r) => r.px) : [...raw.map((r) => r.px), refX]), y: refY === undefined ? ext.y : extent([ext.y[0], ext.y[1], refY]) };
  }, [ext, raw, jitterAmount, refX, refY]);
  const [xmn, xmx] = ext.x;
  const [ymn, ymx] = ext.y;
  const yCount = Math.max(2, Math.round(H / 70));
  const fixedX = fixedRange(props.xDomain);
  const fixedYIn = fixedRange(props.yDomain);
  const fixedY = fixedYIn && (!isLog || fixedYIn[0] > 0) ? fixedYIn : undefined;
  const yDom = fixedY ?? (isLog ? fitLogDomain(plotExt.y[0], plotExt.y[1], yCount) : fitDomain(plotExt.y[0], plotExt.y[1], yCount, { zero: props.zero ?? false, pad: 0.08 }));
  const xDom = fixedX ?? fitDomain(plotExt.x[0], plotExt.x[1], Math.max(2, Math.round(W / 110)), { zero: props.zero ?? false, pad: 0.06 });
  const yMaxAbs = Math.max(Math.abs(yDom[0]), Math.abs(yDom[1]));
  const xMaxAbs = Math.max(Math.abs(xDom[0]), Math.abs(xDom[1]));
  const yFmt = useMemo(() => makeTickFormatter(props.format, c.locale, yMaxAbs), [props.format, c.locale, yMaxAbs]);
  const xFmt = useMemo(() => makeTickFormatter(props.xFormat, c.locale, xMaxAbs), [props.xFormat, c.locale, xMaxAbs]);
  // Hexbin density puts its color legend in the top row (the same row as the y axis title)
  const top = hex && props.binLegend !== false ? HEX_TOP : props.yLabel ? 20 : 10;
  const bottom = PLOT_BOTTOM;
  const [rMin, rMax] = props.sizeRange ?? (hasSize ? [4, Math.max(10, Math.min(28, W / 22))] : [n > 2000 ? 1.6 : n > 300 ? 2.6 : 4, 0]);
  const pad = hasSize ? rMax * 0.6 : DOT_PAD;
  // A log scale picks ticks by its own length (linear scale ticks do not depend on length)
  const y = (isLog ? scaleLog : scaleLinear)(yDom, [H - bottom - pad, top + pad]);
  const yTicks = y.ticks(yCount);
  const showY = props.showYAxis !== false;
  const left = showY ? yAxisWidth(yTicks, yFmt, c.locale) : 0;
  const x = scaleLinear(xDom, [left + 6 + pad, W - 8 - pad]);
  const [smn, smx] = ext.s;
  const rs = hasSize ? scaleSqrt([Math.min(0, smn), smx || 1], [rMin, rMax]) : () => rMin;
  const box = useMemo<PlotBox>(() => ({ x0: left, x1: W, y0: top, y1: H - bottom }), [left, W, top, H, bottom]);

  const hiSeries = useMemo(
    () => (kit && rowSeries ? kit.seriesHighlight(props.highlight, props.data, seriesNames, (_, i) => rowSeries[i]) : null),
    [kit, rowSeries, props.highlight, props.data, seriesNames],
  );
  const colors = useMemo(() => (kit && hiSeries ? kit.colors(p, seriesNames.length, hiSeries) : null), [kit, p, seriesNames.length, hiSeries]);
  const hi = useMemo(() => {
    if (hex) return new Set<number>();
    if (hiSeries) {
      const out = new Set<number>();
      raw.forEach((r, k) => {
        if (hiSeries.has(r.si)) out.add(k);
      });
      return out;
    }
    return resolveHighlight(props.highlight, raw.map((r) => r.d), raw.map((r) => r.label), raw.map((r) => (hasSize ? r.s : r.y)), hasSize ? "max" : "none");
  }, [raw, props.highlight, hasSize, hiSeries, hex]);

  const dots = useMemo<Dot<T>[]>(() => (hex ? NO_DOTS : raw.map((r, k) => ({ i: k, x: x(r.px), y: y(r.y), r: rs(r.s), vx: r.x, vy: r.y, vs: r.s, label: r.label, hi: hi.has(k), datum: r.d, si: r.si }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, hi, W, H, xDom[0], xDom[1], yDom[0], yDom[1], rMin, rMax, hex]);
  // Hexbin density: count the points inside the axis ranges (excluding those outside a zoom or fixed range) in screen coordinates, in one pass. kit.hex builds the cells, items, tooltip and screen reader text
  const hv = useMemo(
    () => hex && hex.view<T>(props, { raw, x, y, box, left, c, xFmt }),
    // Scale functions are rebuilt on every render, so compare their range numbers, and watch only the props hexbin density reads (so a parent re-render does not recount the points)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hex, raw, box, left, xDom[0], xDom[1], yDom[0], yDom[1], c.lang, c.locale, xFmt, c.fmt, props.binSize, props.colorSteps, props.binDomain?.[0], props.binDomain?.[1], props.binLegend, props.xFormat, props.format, props.unit, props.xLabel, props.yLabel],
  );

  const order = useMemo(() => [...dots].sort(drawOrder), [dots]);
  const D = c.motion.duration ?? 800;
  const marks = useMemo<Mark<Dot<T> | null>[]>(() => {
    if (useCanvas) return [{ key: "__p", to: [1], from: [0], data: null }];
    const xr = W || 1;
    return order.map((d) => ({ key: `b${d.i}:${d.label}`, to: [d.x, d.y, d.r], from: [d.x, d.y, 0], enter: [d.x, d.y, 0], delay: (d.x / xr) * D * 0.55, data: d }));
  }, [order, useCanvas, W, D]);
  const m = useMotion(marks, c.motion);

  // Grid for fast nearest-point lookup
  const grid = useMemo(() => {
    const cell = 24;
    const g = new Map<string, number[]>();
    dots.forEach((d, k) => {
      const key = `${Math.floor(d.x / cell)},${Math.floor(d.y / cell)}`;
      const arr = g.get(key);
      if (arr) arr.push(k);
      else g.set(key, [k]);
    });
    return { g, cell };
  }, [dots]);
  const nearest = (px: number, py: number) => {
    const { g, cell } = grid;
    const cx0 = Math.floor(px / cell);
    const cy0 = Math.floor(py / cell);
    let best = -1;
    let bd = Infinity;
    // When the pointer is inside several circles, pick the one drawn on top, so a small circle inside a big one can still be hit
    let hit = -1;
    const reach = hasSize ? Math.ceil(rMax / cell) + 1 : 1;
    for (let dx = -reach; dx <= reach; dx++)
      for (let dy = -reach; dy <= reach; dy++) {
        const arr = g.get(`${cx0 + dx},${cy0 + dy}`);
        if (!arr) continue;
        for (const k of arr) {
          const d = dots[k];
          const dist = Math.hypot(d.x - px, d.y - py) - d.r;
          if (dist <= 0 && (hit < 0 || drawOrder(d, dots[hit]) > 0)) hit = k;
          if (dist < bd) {
            bd = dist;
            best = k;
          }
        }
      }
    if (hit >= 0) return hit;
    return bd <= 10 ? best : null;
  };

  const msg = MSG[c.lang];
  const st = kit?.text[c.lang];
  const fit = useMemo(() => (kit && hasScatterOptions && raw.length >= 2 ? kit.linearFit(raw) : null), [kit, hasScatterOptions, raw]);
  const fitEnds = kit && fit && fitOn ? kit.fitSegment(fit, xmn, xmx, yDom) : null;
  const fitLine = fitEnds ? { x1: x(fitEnds[0]), y1: y(fitEnds[1]), x2: x(fitEnds[2]), y2: y(fitEnds[3]) } : null;
  const quadrantNames = useMemo(() => (quadrantKey ? quadrantKey.split("\u0001").map((q) => q.trim()) : NO_NAMES), [quadrantKey]);
  const refPx = refX === undefined ? null : x(refX);
  const refPy = refY === undefined ? null : y(refY);
  const quads = useMemo(
    () => (kit && quadrantNames.length && refPx !== null && refPy !== null ? kit.quadrantTags(quadrantNames, refPx, refPy, box) : NO_PLACED_TAGS),
    [kit, quadrantNames, refPx, refPy, box],
  );
  const fitTag = kit && st && fitLine ? kit.fitTagSpot(fitLine, st.trendTag, quads.map((q) => q.box), box) : null;
  const fitTagX = fitTag?.x;
  const fitTagY = fitTag?.y;
  const fitTagAnchor = fitTag?.anchor;

  // Reserve positions up front so the scatter option labels do not overlap each other or the x axis title. Empty without options
  const trendTag = st?.trendTag;
  const reserved = useMemo(() => {
    if (!kit || !hasScatterOptions) return NO_BOXES;
    const out = quads.map((q) => q.box);
    if (props.xLabel) {
      const t = xTitleAt(box);
      out.push(labelBox(props.xLabel, t.x, t.y, 10.5, "end"));
    }
    if (trendTag && fitTagX !== undefined && fitTagY !== undefined && fitTagAnchor) out.push(kit.tagBox(trendTag, fitTagX, fitTagY, fitTagAnchor));
    return out;
  }, [kit, hasScatterOptions, quads, props.xLabel, box, fitTagX, fitTagY, fitTagAnchor, trendTag]);

  const seriesLabels = useMemo(
    () => (kit && c.showLabels && hiSeries ? kit.placeSeriesLabels(dots, seriesNames, hiSeries, { box, reserved, grid }) : NO_SERIES_LABELS),
    [kit, c.showLabels, hiSeries, dots, seriesNames, grid, reserved, box],
  );

  // Labels: highlighted first, then the largest circles. Skip any that overlap
  const labels = useMemo(() => {
    // With series, series names are labeled instead of points, so the default point label count is 0
    const max = props.maxLabels ?? (rowSeries ? 0 : 6);
    if (!c.showLabels || n > 400 || max <= 0) return [];
    const cands = [...dots].sort((a, b) => Number(b.hi) - Number(a.hi) || b.r - a.r).filter((d) => d.label);
    const placed: Box[] = [...dots.map((d) => ({ x: d.x - d.r * 0.7, y: d.y - d.r * 0.7, w: d.r * 1.4, h: d.r * 1.4 })), ...reserved, ...seriesLabels.map((l) => l.box)];
    const out: { d: Dot<T>; x: number; y: number; anchor: "start" | "end" | "middle" }[] = [];
    for (const d of cands) {
      if (out.length >= max) break;
      const tries: { x: number; y: number; anchor: "start" | "end" | "middle" }[] = [
        { x: d.x + d.r + 5, y: d.y, anchor: "start" },
        { x: d.x - d.r - 5, y: d.y, anchor: "end" },
        { x: d.x, y: d.y - d.r - 9, anchor: "middle" },
        { x: d.x, y: d.y + d.r + 10, anchor: "middle" },
      ];
      for (const t of tries) {
        const b = labelBox(d.label, t.x, t.y, 11, t.anchor, d.hi ? 800 : 500);
        if (b.x < left || b.x + b.w > W - 2 || b.y < 0 || b.y + b.h > H - bottom) continue;
        if (placed.some((q) => overlaps(q, b, 1))) continue;
        placed.push(b);
        out.push({ d, ...t });
        break;
      }
    }
    return out;
  }, [dots, c.showLabels, n, props.maxLabels, rowSeries, reserved, seriesLabels, left, W, H, bottom]);

  const accent = swatch(p, "accent");
  const fmt = c.fmt;
  const fv = c.fv;
  const events: ChartEvent<T>[] = useMemo(
    () =>
      hv
        ? hv.events
        : lazyArray(dots.length, (k) => {
        const d = dots[k];
        const e: ChartEvent<T> = { datum: d.datum, index: d.i, key: `${d.i}`, label: d.label || msg.nth(d.i + 1), value: hasSize ? d.vs : d.vy, formatted: `x ${xFmt(d.vx)}, y ${fv(d.vy)}${hasSize ? `, ${msg.sizeWord} ${fmt(d.vs)}` : ""}` };
        if (d.si >= 0) e.series = seriesNames[d.si];
        return e;
      }),
    // The table uses the tooltip's format: y with its unit (not shortened like axis ticks)
    [dots, hasSize, xFmt, fv, fmt, msg, seriesNames, hv],
  );

  let tip: TooltipData | null = hv ? hv.tip(c.active) : null;
  if (c.active !== null && dots[c.active]) {
    const d = dots[c.active];
    const rows: TooltipRow[] = [{ label: props.xLabel ?? "x", value: xFmt(d.vx) }, { label: props.yLabel ?? "y", value: c.fv(d.vy) }, ...(hasSize ? [{ label: msg.size, value: c.fmt(d.vs), color: d.hi ? accent.fill : p.paint("neutral") }] : [])];
    if (colors && d.si >= 0) rows.unshift({ label: seriesNames[d.si], value: "", color: colors[d.si].fill, strong: true });
    if (st && fit && fitLine) rows.push({ label: st.slope, value: `${fit.slope > 0 ? "+" : ""}${c.fv(fit.slope)}`, strong: false }, { label: "R²", value: fit.r2.toFixed(2), strong: false });
    tip = { x: d.x, y: d.y - d.r, title: d.label || msg.nth(d.i + 1), rows };
  }

  const prog = useCanvas ? m.get("__p")?.[0] ?? 1 : 1;
  const neutralRaw = p.theme.neutralStrong;
  const accentRaw = p.theme.accent;
  // Canvas paint groups: non-highlighted points first and faint, highlighted ones last. One per series with series; otherwise two, gray and highlight.
  // Without series, colors depend only on the theme color strings, so the points are not repainted even when the theme prop object is new on every render
  const canvasGroups = useMemo<CanvasGroup[]>(() => {
    if (kit && colors && hiSeries) return kit.canvasGroups(dots, colors, hiSeries);
    const rest: number[] = [];
    const his: number[] = [];
    dots.forEach((d, k) => (d.hi ? his : rest).push(k));
    return [
      { ks: rest, isHi: false, fill: (read) => read("--ztd-neutral-strong", neutralRaw) },
      { ks: his, isHi: true, fill: (read) => read("--ztd-accent", accentRaw) },
    ];
  }, [kit, dots, colors, hiSeries, neutralRaw, accentRaw]);
  const drawCanvas = useCallback(
    (ctx: CanvasRenderingContext2D, t: number, color: (v: string, fb: string) => string) => {
      const xr = W || 1;
      for (const g of canvasGroups) {
        ctx.globalAlpha = g.isHi ? 1 : 0.55;
        ctx.fillStyle = g.fill(color);
        for (const k of g.ks) {
          const d = dots[k];
          // Highlighted points grow together; the rest grow in turn from the left
          const grow = g.isHi ? Math.min(1, t * 1.2) : Math.max(0, Math.min(1, (t * 1.4 - (d.x / xr) * 0.4) * 2.5));
          if (grow <= 0) continue;
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.r * grow, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    },
    [canvasGroups, dots, W],
  );

  // Arrow keys (scatter): move to the nearest point in the arrow's direction. The first key goes to the highlighted point. ChartFrame handles the other keys (Home, End, Escape, Enter)
  const onKey = hv
    ? (e: KeyboardEvent<HTMLDivElement>) => {
        // Hex cells: arrows move to the neighboring cell in that direction. ChartFrame handles Home and End (the densest cell, the sparsest cell)
        const next = hv.step(kit ? kit.arrowStep(e.key) : null, c.active);
        if (next !== null && next >= 0) c.setActive(next, "keyboard");
        return next !== null;
      }
    : kit
    ? (e: KeyboardEvent<HTMLDivElement>) => {
        const step = kit.arrowStep(e.key);
        if (!step || !dots.length) return false;
        const cur = c.active !== null && dots[c.active] ? c.active : null;
        const next = cur === null ? kit.entryPoint(dots, step) : kit.nearestInDirection(dots, cur, step);
        if (next !== null) c.setActive(next, "keyboard");
        return true;
      }
    : undefined;

  const xTicks = x.ticks(Math.max(2, Math.round(W / 110)));
  const xTitle = xTitleAt(box);
  const baseDesc = msg.desc(hasSize, n, [xFmt(xmn), xFmt(xmx), yFmt(ymn), yFmt(ymx)]);
  // The scatter sentence is built by counting every point. Memoized so it is not recounted on every render (animation frame)
  const scatterDesc = useMemo(() => {
    if (!kit || !st || !hasScatterOptions) return "";
    const refs = [...(refX === undefined ? [] : [`x ${xFmt(refX)}`]), ...(refY === undefined ? [] : [`y ${fv(refY)}`])];
    return kit.describe(st, { points: raw, seriesNames, fit, xName: props.xLabel ?? "x", yName: props.yLabel ?? "y", refs, refX, refY, quadrants: quadrantNames });
  }, [kit, st, hasScatterOptions, refX, refY, xFmt, fv, raw, seriesNames, fit, props.xLabel, props.yLabel, quadrantNames]);
  // Scatter: when no point falls inside the fixed range (zoom), state the reason in the picture and description instead of showing empty axes
  const outOfRange = useMemo(
    () => (kit && st && (fixedX || fixedY) && kit.noneInside(raw, xDom, yDom) ? st.outOfRange : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kit, st, raw, xDom[0], xDom[1], yDom[0], yDom[1], fixedX, fixedY],
  );
  const desc = props.description ?? (outOfRange || baseDesc + (hv ? hv.desc : "") + scatterDesc + (logDropped ? msg.logDropped(logDropped) : ""));
  const yTitle = hv ? hv.yTitle : props.yLabel;

  const refLines = kit && (refPx !== null || refPy !== null) ? <kit.RefLines p={p} x={refPx} y={refPy} box={box} /> : null;
  return (
    <ChartFrame
      c={c}
      kind={hasSize ? msg.bubble : msg.scatter}
      ariaLabel={props.ariaLabel}
      description={desc}
      emptyText={outOfRange || undefined}
      events={events}
      tip={tip}
      renderTip={props.tooltip}
      className={props.className}
      style={props.style}
      theme={props.theme}
      onPointerMove={(px, py, e) => {
        const k = hv ? hv.at(px, py) : nearest(px, py);
        if (k !== c.active) c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer");
      }}
      onKey={onKey}
      announce={hv && c.via === "keyboard" ? hv.say(c.active) : undefined}
      underlay={useCanvas ? <CanvasLayer width={W} height={H} draw={drawCanvas} progress={prog} version={c.sig} /> : undefined}
    >
      {yTitle && showY ? (
        <Txt x={left} y={6} size={10.5} fill={p.paint("muted")}>
          {yTitle}
        </Txt>
      ) : null}
      <GridY p={p} ticks={yTicks} y={y} x0={left} x1={W} fmt={yFmt} locale={c.locale} zero={false} labels={showY} />
      <g aria-hidden="true">
        {(props.showXAxis === false ? [] : xTicks).map((t) => (
          <Txt key={t} x={x(t)} y={H - bottom + 13} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
            {xFmt(t)}
          </Txt>
        ))}
        {props.xLabel ? (
          <Txt x={xTitle.x} y={xTitle.y} anchor="end" size={10.5} fill={p.paint("muted")}>
            {props.xLabel}
          </Txt>
        ) : null}
      </g>
      {hv ? null : refLines}
      {hex && hv ? <hex.Layer p={p} v={hv} box={box} active={c.active} c={c} m={m} onPick={c.click} /> : null}
      {/* Hex cells are filled areas, so reference lines are drawn over them */}
      {hv ? refLines : null}
      {!useCanvas
        ? m.items.map((it) => {
            const d = it.data;
            if (!d) return null;
            const [cx, cy, r] = it.v;
            const isA = c.active === d.i;
            // A leaving point carries the series index of the old data, which may be missing from the new series colors
            const sw = colors && d.si >= 0 ? colors[d.si] : undefined;
            const fill = sw ? sw.fill : d.hi ? accent.fill : p.paint(hasSize ? "neutral" : "neutralStrong");
            return (
              <circle
                key={it.key}
                className="ztd-mark"
                cx={cx}
                cy={cy}
                r={Math.max(0, r)}
                fill={fill}
                fillOpacity={d.hi ? 0.92 : hasSize ? 0.85 : 0.7}
                stroke={isA ? p.paint("ink") : p.paint("panel")}
                strokeWidth={isA ? 2 : hasSize ? 1.2 : 0.6}
                opacity={it.exiting ? 0.3 : c.active === null || isA ? 1 : 0.55}
                onPointerEnter={(e) => c.setActive(d.i, e.pointerType === "touch" ? "touch" : "pointer")}
                onClick={() => c.click(d.i)}
              />
            );
          })
        : c.active !== null && dots[c.active]
          ? <circle cx={dots[c.active].x} cy={dots[c.active].y} r={dots[c.active].r + 2} fill="none" stroke={p.paint("ink")} strokeWidth={1.6} pointerEvents="none" />
          : null}
      {kit && st ? (
        <kit.Overlay
          p={p}
          fade={m.fade(D * 0.6, 300)}
          trendTag={st.trendTag}
          fitLine={fitLine}
          fitTag={fitTag}
          quads={quads}
          seriesLabels={seriesLabels}
          seriesNames={seriesNames}
          colors={colors}
          hiSeries={hiSeries}
        />
      ) : null}
      {labels.map((l) => (
        <Txt key={l.d.i} x={l.x} y={l.y} anchor={l.anchor} size={11} weight={l.d.hi ? 800 : 500} fill={p.paint(l.d.hi ? "ink" : "muted")} opacity={m.fade(D * 0.6, 300)}>
          {l.d.label}
        </Txt>
      ))}
      {outOfRange ? (
        <Txt x={(box.x0 + box.x1) / 2} y={(box.y0 + box.y1) / 2} anchor="middle" size={12} fill={p.paint("muted")}>
          {outOfRange}
        </Txt>
      ) : null}
    </ChartFrame>
  );
}
