import { useId, useMemo, type ReactNode } from "react";
import { AXIS_FONT, AxisPill, fitTickLabels, GridY, HoverLine, thinLabels, yAxisWidth } from "../core/axis";
import { BrushBand, changeRatio, ExtremeTags, signedPercent, useChartBrush, useZoom, type BrushProps } from "../core/brush";
import { capTipRows, ChartFrame, Txt } from "../core/ChartFrame";
import { makeTickFormatter, type DayFirstProps } from "../core/format";
import { AnnotationsOver, AnnotationsUnder, annotationYs, describeAnnotations, forecastFrom, forecastX, type Annotation, type AnnotationGeom } from "../core/annotations";
import { bandBounds, bandPath, bandShape, boundField, isOutside, type BandShape, type BoundField } from "../core/band";
import { areaPath, linePath, nearestIndex, r2, type Curve } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { categorical, ramp, swatch, type Swatch } from "../core/palette";
import { extent, fitDomain, fitLogDomain, scaleLinear, scaleLog, timeTicks } from "../core/scale";
import { bucketSeries, prepSeries, visibleSeries, xNum, type Aggregate, type SeriesModel, type XType } from "../core/series";
import { dodgeVertical, textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { lazyArray } from "../core/lazy";
import { useChart, type ChartCtx } from "../core/useChart";
import { useSync } from "../core/sync";
import { useMotion } from "../core/useMotion";
import { uniq } from "../data/accessor";
import { lttb } from "../data/parse";
import { stack } from "../layout/stack";
import { plural, type ChartLang } from "../core/i18n";
import type { Painter } from "../theme/context";

const en = {
  line: "Line chart",
  area: "Area chart",
  /** Opening part when announcing the selected range */
  span: (range: string, change: string) => `${range}: ${change}`,
  desc: (nS: number, names: string, from: string, to: string, n: number) => `${plural(nS, "series", "series")} (${names}), x from ${from} to ${to}, ${plural(n, "point")}`,
  /** Name used in the tooltip when a bound field has no name (a function) */
  lower: "low",
  upper: "high",
  /** Description: the shaded range. ranges looks like "p5 to p95" */
  band: (ranges: string) => ` Range ${ranges}.`,
  range: (lo: string, hi: string) => `${lo} to ${hi}`,
  /** Description: points outside the range (outside option) */
  outside: (n: number, where: string) => (n ? ` ${plural(n, "point")} outside the range: ${where}.` : " No points outside the range."),
  /** One point outside the range: x label and series */
  where: (label: string, series: string) => `${label} (${series})`,
  /** Description: values at or below 0 left out because of the log scale */
  logDropped: (n: number) => ` ${plural(n, "value")} at or below 0 ${n === 1 ? "is" : "are"} not shown on the log scale.`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    line: "라인 차트",
    area: "영역 차트",
    span: (range, change) => `${range} 구간 ${change}`,
    desc: (nS, names, from, to, n) => `계열 ${nS}개(${names}), x ${from}부터 ${to}까지 ${n}개 지점`,
    lower: "하한",
    upper: "상한",
    band: (ranges) => ` 범위 ${ranges}.`,
    range: (lo, hi) => `${lo}~${hi}`,
    outside: (n, where) => (n ? ` 범위 밖 ${n}개 지점: ${where}.` : " 범위 밖 지점 없음."),
    where: (label, series) => `${label}(${series})`,
    logDropped: (n) => ` 로그 눈금이라 0 이하 값 ${n}개는 뺐어요.`,
  },
};

export interface XYProps<T = Row> extends BaseChartProps<T>, BrushProps, DayFirstProps {
  /** x field. Dates ("2025-03"), numbers and categories all work. Default "x" */
  x?: Accessor<T, unknown>;
  /** y field. An array turns several columns of a wide table into series. Default "y" */
  y?: Accessor<T, number> | string[];
  /** Series field (long table) */
  series?: Accessor<T, string>;
  curve?: Curve;
  /** Sets the x type explicitly */
  xType?: XType;
  /** How to combine several rows with the same x and series. Default "sum" */
  aggregate?: Aggregate;
  /** Fixed y range */
  yDomain?: [number, number];
  /** Include 0 in the y axis. Default false for line charts, true for area */
  zero?: boolean;
  /** "highlight" colors only the highlighted series and leaves the rest neutral. Default "highlight" */
  colorMode?: "highlight" | "categorical";
  /** Series labels at the right end. Default: true with 2 or more series */
  endLabels?: boolean;
  /** Above this many points, downsample with LTTB. Default: 2 times the width */
  maxPoints?: number;
  /** Horizontal reference lines */
  referenceLines?: { y: number; label?: string }[];
  /** y axis title (unit, etc.) */
  yLabel?: string;
  /** Highlighted series. A predicate function receives the series name, not the row: (name, index) => boolean. Default: the first series */
  highlight?: BaseChartProps<T>["highlight"];
  /** Annotations: target band, period, reference line, event, forecast, trend line, weekend shading. Also included in the screen reader description */
  annotations?: Annotation[];
  /** Splits the highlighted series into colors above and below baseline (profit and loss, increase and decrease). For area, only when overlapping (stack "none"). Default false */
  signColors?: boolean;
  /** Reference value for signColors. Default 0 */
  baseline?: number;
  /** Color below the reference value with signColors. A theme token or CSS color. Default "neutralStrong" */
  downColor?: string;
  /** Lower bound field of the range band. For a wide table, an array in the same order as y; for a long table, one field (series from series). Give it together with upper. Not drawn on stacked areas */
  lower?: Accessor<T, number> | string[];
  /** Upper bound field of the range band. Same shape as lower */
  upper?: Accessor<T, number> | string[];
  /** The x where the band starts. "forecast" starts at the from of the forecast annotation. Default "start" */
  bandFrom?: "start" | "forecast";
  /** Marks points outside the band and gives their count in the description. Default false */
  outside?: boolean;
  /** Connects neighboring points across missing values (null, NaN, or no row for that series at that x). Default false: lines and areas break there, and an isolated point is drawn as a dot. No effect on stacked areas */
  connectNulls?: boolean;
  /** Names of series to hide. Colors and highlight are set from all series, so the remaining series keep their colors. The y axis fits the visible series; x stays the same. Hiding every series gives an empty chart */
  hidden?: readonly string[];
  /** Fixed range [start, end] for date and numeric x (ms for dates). Not used for categorical x or a zoomed range. Small multiples (ChartFacets) use it to align the panels' x */
  xDomain?: [number, number];
  /** With xDomain: use these x values and texts as the x ticks as is (no thinning). Small multiples pass the same ticks to every panel when there are few x values */
  xTicks?: readonly { value: number; label: string }[];
  /** x axis labels. Default true. false removes only the labels and keeps their space (the label at the pointed position still shows) */
  showXAxis?: boolean;
  /** Value axis (y) labels and yLabel. Default true. false removes the labels and their space (gridlines stay) */
  showYAxis?: boolean;
}

/** Keeps only x indices a~b (inclusive) of the model */
function sliceModel<T>(m: SeriesModel<T>, a: number, b: number): SeriesModel<T> {
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(m.keys.length - 1, Math.max(a, b));
  const keys = m.keys.slice(lo, hi + 1);
  return {
    type: m.type,
    keys,
    xnum: m.type === "band" ? keys.map((_, i) => i) : m.xnum.slice(lo, hi + 1),
    labels: m.labels.slice(lo, hi + 1),
    series: m.series,
    values: m.values.map((r) => r.slice(lo, hi + 1)),
    rows: m.rows.map((r) => r.slice(lo, hi + 1)),
  };
}

/** The x index where the band starts. With "forecast", the first x at or after the forecast annotation's from; without such an x, no band is drawn (measured on data values, so it is set before the axis range) */
function bandStartIndex(m: SeriesModel<unknown>, mode: XYProps["bandFrom"], from: unknown): number {
  if (mode !== "forecast") return 0;
  const n = m.keys.length;
  if (from === undefined) return n;
  if (m.type === "band") {
    const i = m.keys.indexOf(String(from));
    return i < 0 ? n : i;
  }
  const t = xNum(m.type, from);
  if (!Number.isFinite(t)) return n;
  const i = m.xnum.findIndex((v) => v >= t);
  return i < 0 ? n : i;
}

/** Band sentence added to the description: the shaded range and, with outside, the number of points outside it and the first five of them. An empty string when nothing is shaded */
function describeBand<T>(m: SeriesModel<T>, bands: { lo: number[]; hi: number[] }[], names: readonly (readonly [string, string])[], outside: boolean, msg: (typeof MSG)[ChartLang]): string {
  // With several series, name the series the range belongs to: "p5 to p95 (Our app)"
  const named = (si: number, text: string) => (m.series.length > 1 && m.series[si] ? msg.where(text, m.series[si]) : text);
  const ranges = uniq(bands.flatMap((b, si) => (b.lo.some(Number.isFinite) ? [named(si, msg.range(...names[si]))] : [])));
  if (!ranges.length) return "";
  const text = msg.band(ranges.join(", "));
  if (!outside) return text;
  let n = 0;
  const where: string[] = [];
  bands.forEach((b, si) => {
    for (let k = 0; k < b.lo.length; k++) {
      if (!isOutside(m.values[si][k], b.lo[k], b.hi[k])) continue;
      n++;
      if (where.length < 5) where.push(named(si, m.labels[k]));
    }
  });
  return text + msg.outside(n, `${where.join(", ")}${n > where.length ? ", …" : ""}`);
}

/** Name of a bound field (tooltip, description). Picked per series by the same rule as boundField; fallback for a function */
function boundName(f: unknown, s: number, wide: boolean, fallback: string): string {
  const v = boundField(f as BoundField<unknown>, s, wide);
  return typeof v === "string" && v ? v : fallback;
}

export interface LineChartProps<T = Row> extends XYProps<T> {
  /** Show points. "auto" shows them only when there are few points. Default "auto" */
  dots?: boolean | "auto";
  /** Gradient area under the highlighted series. Default false */
  area?: boolean;
  /** "log" gives the y axis a log scale (10, 100, 1,000 equally spaced). Values at or below 0 are left out and their count goes in the description. Default "linear" */
  yScale?: "linear" | "log";
}

export interface AreaChartProps<T = Row> extends XYProps<T> {
  /** "none" overlapping | "stacked" stacked | "percent" 100% stacked. Default: "stacked" with 2 or more series */
  stack?: "none" | "stacked" | "percent";
}

interface SeriesDraw {
  s: number;
  name: string;
  pts: number[];
  xs: number[];
  base?: number[];
  sw: Swatch;
  hi: boolean;
  idx: number[];
  /** [start, end) within pts for each connected run. Runs break at missing values. [[0, 5], [5, 9]] means two runs, 0~4 and 5~8 */
  spans: (readonly [number, number])[];
  /** Range band shape. Its top and bottom y values are appended to the motion values */
  band?: BandShape;
  /** Points outside the band (positions in pts, outside option) */
  out?: number[];
}

function xScaleFor(model: SeriesModel<unknown>, x0: number, x1: number, domain?: readonly [number, number]): ((k: number) => number) & { v?: (t: number) => number } {
  const n = model.keys.length;
  if (model.type === "band") {
    const step = n > 1 ? (x1 - x0) / (n - 1) : 0;
    return (k: number) => (n > 1 ? x0 + k * step : (x0 + x1) / 2);
  }
  const [lo, hi] = domain ?? extent(model.xnum);
  const s = scaleLinear([lo, hi === lo ? lo + 1 : hi], [x0, x1]);
  // v: x value (date ms, number) → pixels. Annotations are measured on the same scale as the data
  return Object.assign((k: number) => s(model.xnum[k]), { v: s });
}

function XAxis(props: { c: ChartCtx<unknown>; model: SeriesModel<unknown>; xs: (k: number) => number; x0: number; x1: number; y: number; domain?: readonly [number, number]; fixed?: XYProps["xTicks"] }) {
  const { c, model, xs, x0, x1, y, domain } = props;
  const p = c.p;
  let ticks: { x: number; label: string }[];
  if (domain && model.type !== "band" && props.fixed) {
    // The ticks as passed in (small multiples pass the same list to every panel)
    const real = scaleLinear(domain[1] === domain[0] ? [domain[0], domain[0] + 1] : [domain[0], domain[1]], [x0, x1]);
    ticks = props.fixed.map((t) => ({ x: real(t.value), label: t.label }));
  } else if (domain && model.type !== "band") {
    // Fixed x range (the shared axis of small multiples): tick values, label format and which ticks to keep are set from the range and the right edge only, so panels with the same range get the same ticks.
    // Even a panel whose plot is narrower because of left value-axis labels picks ticks as if it had none (x0 = 6). A panel with shorter data just has a shorter line
    const [a, b] = domain[1] === domain[0] ? [domain[0], domain[0] + 1] : domain;
    const isDate = model.type === "date";
    const count = Math.max(2, Math.floor((x1 - 6) / (isDate ? 64 : 70)));
    const xf = a >= 1000 && b <= 9999 ? String : makeTickFormatter(undefined, c.locale, Math.max(-a, b));
    const vals = isDate ? timeTicks(a, b, count, c.locale).map((t) => ({ v: t.t, label: t.label })) : scaleLinear([a, b], [0, 1]).ticks(count).map((v) => ({ v, label: xf(v) }));
    const canon = scaleLinear([a, b], [6, x1]);
    const real = scaleLinear([a, b], [x0, x1]);
    // The first tick label may extend up to 6px to the left (half the gap between panels), so the first day of the range ("Jan") stays
    ticks = fitTickLabels(vals.map((t) => ({ ...t, x: canon(t.v) })), -6, c.width + 2).map((t) => ({ x: real(t.v), label: t.label }));
  } else if (model.type === "date" && model.keys.length > 1) {
    const t0 = model.xnum[0];
    const t1 = model.xnum[model.xnum.length - 1];
    const maxT = Math.max(2, Math.floor((x1 - x0) / 64));
    const sx = scaleLinear([t0, t1], [x0, x1]);
    const tt = timeTicks(t0, t1, maxT, c.locale);
    if (tt.length >= 2 && model.keys.length > tt.length) ticks = tt.map((t) => ({ x: sx(t.t), label: t.label }));
    else {
      const centers = model.keys.map((_, k) => xs(k));
      ticks = thinLabels(centers, model.labels).map((k) => ({ x: centers[k], label: model.labels[k] }));
    }
  } else if (model.type === "number" && model.keys.length > 12) {
    // x ticks show the x numbers as is, not in the value format (format, currency, etc.). Years (1000~9999) without commas
    const [a, b] = extent(model.xnum);
    const sx = scaleLinear([a, b], [x0, x1]);
    const xf = a >= 1000 && b <= 9999 ? String : makeTickFormatter(undefined, c.locale, Math.max(-a, b));
    ticks = sx.ticks(Math.max(2, Math.floor((x1 - x0) / 70))).map((v) => ({ x: sx(v), label: xf(v) }));
  } else {
    const centers = model.keys.map((_, k) => xs(k));
    ticks = thinLabels(centers, model.labels).map((k) => ({ x: centers[k], label: model.labels[k] }));
  }
  // Ticks for a fixed range were already picked above (picking again from each panel's own space would make them differ between panels)
  const keep = domain && model.type !== "band" ? ticks : fitTickLabels(ticks, -2, c.width + 2);
  return (
    <g aria-hidden="true">
      {keep.map((t, i) => (
        <Txt key={i} x={t.x} y={y} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
          {t.label}
        </Txt>
      ))}
    </g>
  );
}

/**
 * Series colors for line and area. Areas are large fills, so they default to ramp; lines use accent for the highlight only and neutralStrong for the rest. categorical with colorMode "categorical".
 * Shared by the chart and the card legend (autoLegend)
 */
export function lineSwatches(p: Painter, n: number, hi: ReadonlySet<number>, area: boolean, colorMode?: "highlight" | "categorical"): Swatch[] {
  if (area) return colorMode === "categorical" ? categorical(p, n, hi) : ramp(p, n, hi);
  if (colorMode === "categorical") return categorical(p, n, hi);
  const rest = swatch(p, "strong");
  const acc = swatch(p, "accent");
  return Array.from({ length: n }, (_, s) => (hi.has(s) ? acc : rest));
}

function XYChart<T>(props: (LineChartProps<T> & AreaChartProps<T>) & { kind: "line" | "area" }) {
  const isArea = props.kind === "area";
  // An area's value is its length from 0, so it has no log scale
  const isLog = !isArea && props.yScale === "log";
  const c = useChart(props, { height: (w) => Math.max(200, Math.min(300, w * 0.5)), duration: 1100, stagger: 120 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];
  const gid = useId().replace(/:/g, "");

  const prepped = useMemo(() => prepSeries(props.data, props.x, props.y as never, props.series, { xType: props.xType, locale: c.locale, aggregate: props.aggregate, dayFirst: props.dayFirst }), [props.data, props.x, props.y, props.series, props.xType, c.locale, props.aggregate, props.dayFirst]);
  // A log scale cannot draw values at or below 0, so they are dropped like missing values (the line breaks, and the tooltip, table and description skip them). The dropped count goes in the description
  const [model0, logDropped] = useMemo((): [typeof prepped, number] => {
    if (!isLog) return [prepped, 0];
    let n = 0;
    const values = prepped.values.map((row) => row.map((v) => (v <= 0 ? (n++, Number.NaN) : v)));
    return n ? [{ ...prepped, values }, n] : [prepped, 0];
  }, [prepped, isLog]);
  const nS = model0.series.length;
  const stackMode = isArea ? props.stack ?? (nS > 1 ? "stacked" : "none") : "none";
  // The zoomed range (x indices of model0)
  const zoom = useZoom(c.sig);
  const view = zoom.view;
  const viewed = useMemo(() => (view ? sliceModel(model0, view[0], view[1]) : model0), [model0, view]);
  // Stacked layers must share the same x, so stacked areas downsample by bucket averages instead of LTTB (one point per 2px keeps the curve smooth enough)
  const areaBudget = Math.max(40, Math.round(props.maxPoints ?? W / 2));
  const all = useMemo(() => (stackMode !== "none" ? bucketSeries(viewed, areaBudget) : viewed), [viewed, stackMode, areaBudget]);
  // The series to draw, minus hidden ones. Highlight, colors and range bands are set from all series (all) and then picked, and every x key is kept. Arrays may be new on every render, so compare as strings
  const hiddenKey = props.hidden?.join("\u0001") ?? "";
  const [model, keep] = useMemo(() => visibleSeries(all, hiddenKey), [all, hiddenKey]);
  // Values for the tooltip and events: when downsampled, the actual value of the representative row (the same row as the label and datum), not the bucket average
  const rowVals = model.rowValues ?? model.values;

  const stacked = useMemo(() => (stackMode === "none" ? null : stack(model.values, stackMode === "percent" ? "expand" : "zero")), [model, stackMode]);

  // The x where the forecast annotation starts (shared by the band start and the forecast dashes)
  const fFrom = forecastFrom(props.annotations);
  // Range band: [lower, upper] values per series (swapped bounds are put back in order; x before bandFrom and missing x are NaN). Not drawn on stacked areas
  const { lower, upper } = props;
  const bandStart = bandStartIndex(model as SeriesModel<unknown>, props.bandFrom, fFrom);
  // With no bounds to draw (e.g. bandFrom "forecast" without a forecast annotation), it draws exactly like a chart without a band
  const bands = useMemo(() => {
    if (lower === undefined || upper === undefined || stackMode !== "none") return null;
    // For a wide table, bound fields pair with y by position; computed for all series, then the visible series are picked
    const b0 = bandBounds(all.rows, lower, upper, Array.isArray(props.y), props.data, bandStart);
    const b = model === all ? b0 : keep.map((i) => b0[i]);
    // A log scale cannot draw bounds at or below 0, so the band breaks at that x
    if (isLog)
      for (const s of b)
        s.lo.forEach((v, k) => {
          if (!(v > 0 && s.hi[k] > 0)) s.lo[k] = s.hi[k] = Number.NaN;
        });
    return b.some((s) => s.lo.some(Number.isFinite)) ? b : null;
  }, [all, model, keep, lower, upper, props.y, props.data, stackMode, bandStart, isLog]);
  // The extremes of the band values are computed only when the band changes (so 10,000 cells are not pushed into allY every frame)
  const bandYs = useMemo(() => {
    const ys: number[] = [];
    bands?.forEach((b) => b.lo.forEach((v, k) => Number.isFinite(v) && ys.push(v, b.hi[k])));
    return ys.length ? extent(ys) : ys;
  }, [bands]);

  const hiAll = useMemo(() => {
    const totals = all.values.map((row) => row.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0));
    return resolveHighlight(props.highlight as never, all.series as never[], all.series, totals, "first");
  }, [all, props.highlight]);

  const colorsAll: Swatch[] = useMemo(() => lineSwatches(p, nS, hiAll, isArea, props.colorMode), [isArea, props.colorMode, p, nS, hiAll]);
  // Map to the visible series positions (unchanged when nothing is hidden)
  const hi = useMemo(() => (model === all ? hiAll : new Set(keep.flatMap((i, j) => (hiAll.has(i) ? [j] : [])))), [model, all, hiAll, keep]);
  const colors = useMemo(() => (model === all ? colorsAll : keep.map((i) => colorsAll[i])), [model, all, colorsAll, keep]);

  const allY: number[] = [];
  if (stacked) stacked.y1.forEach((r) => r.forEach((v) => allY.push(v)));
  else model.values.forEach((r) => r.forEach((v) => Number.isFinite(v) && allY.push(v)));
  // Keep the band inside the plot too (drawn x only)
  allY.push(...bandYs);
  // Keep reference lines (targets, etc.) inside the plot even when they are outside the data. On a log scale, reference lines and annotation values at or below 0 go into neither the range nor the plot (data values at or below 0 were already dropped)
  // Reference lines whose value (y) is not a number (a wrong key such as { value: 30 }) are not drawn, so no NaN coordinates are written
  const refLines = props.referenceLines?.filter((r) => typeof r?.y === "number" && Number.isFinite(r.y) && (!isLog || r.y > 0));
  refLines?.forEach((r) => allY.push(r.y));
  allY.push(...annotationYs(props.annotations).filter((v) => !isLog || v > 0));
  const baseline = props.baseline ?? 0;
  // On a log scale, colors split above and below only when baseline is above 0 (otherwise every value is above baseline)
  const signOn = !!props.signColors && stackMode === "none" && (!isLog || baseline > 0);
  if (signOn) allY.push(baseline);
  const [mn, mx] = extent(allY);
  // A log scale uses yDomain only when both ends are above 0 (zero is not used)
  const yd = props.yDomain && (!isLog || (props.yDomain[0] > 0 && props.yDomain[1] > 0)) ? props.yDomain : undefined;
  const top = props.yLabel ? 22 : 10;
  const bottom = 22;
  const yCount = Math.max(2, Math.round(H / 70));
  const dom: [number, number] = yd ?? (isLog ? fitLogDomain(mn, mx, yCount) : stackMode === "percent" ? [0, 100] : fitDomain(mn, mx, yCount, { zero: props.zero ?? isArea }));
  const tickFmt = stackMode === "percent" ? (v: number) => `${v}%` : makeTickFormatter(props.format, c.locale, Math.max(Math.abs(dom[0]), Math.abs(dom[1])));
  // A log scale picks ticks by its own length (linear scale ticks do not depend on length)
  const y = (isLog ? scaleLog : scaleLinear)(dom, [H - bottom, top]);
  const yTicks = y.ticks(yCount);
  const showY = props.showYAxis !== false;
  const left = showY ? yAxisWidth(yTicks, tickFmt, c.locale) : 0;
  const endLabels = props.endLabels ?? nS > 1;
  const lastIdx = (s: number) => {
    for (let k = model.keys.length - 1; k >= 0; k--) if (Number.isFinite(model.values[s][k])) return k;
    return -1;
  };
  // Label space is measured over all series, so the plot width does not jump when series are toggled
  const endW = endLabels ? Math.min(W * 0.28, Math.max(...all.series.map((s) => textWidth(s, 11, 700)), 20) + 14) : 10;
  const x0 = left + 6;
  const x1 = W - endW;
  // A fixed x range is not used in a zoomed range (the axis fits the zoomed range)
  const xd = view ? undefined : props.xDomain;
  const xs = xScaleFor(model as SeriesModel<unknown>, x0, x1, xd);
  // Not rebuilt on every pointer move (10,000 points means 10,000 entries each time)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const centers = useMemo(() => model.keys.map((_, k) => xs(k)), [model, x0, x1, xd?.[0], xd?.[1]]);
  const maxPts = props.maxPoints ?? Math.max(60, Math.round((x1 - x0) * 2));
  const curve = props.curve ?? "smooth";
  // Area baseline: 0 clamped into the axis range (the top end when all values are negative, the bottom end when all are positive)
  const base0 = Math.min(dom[1], Math.max(dom[0], 0));
  const down = p.color(props.downColor, "neutralStrong");
  const yb = y(baseline);

  // Annotation x values: band order for categories; for dates and numbers, the value read by the same rule as the data (xv turns it into pixels)
  const xv = xs.v;
  const xn = (v: unknown) => (xv ? xNum(model.type, v) : model.keys.indexOf(String(v)));
  const xAt = (v: unknown): number | null => {
    const n = xn(v);
    return xv ? (Number.isFinite(n) ? xv(n) : null) : n < 0 ? null : xs(n);
  };
  const last = model.xnum.length - 1;
  const geom: AnnotationGeom = {
    p,
    lang: c.lang,
    xAt,
    y,
    x0,
    x1,
    top,
    bottom: H - bottom,
    half: xv || last < 1 ? 0 : (xs(1) - xs(0)) / 2,
    time: model.type === "date" && xv && last > 0 ? { t0: model.xnum[0], t1: model.xnum[last], n: last + 1, xt: xv } : undefined,
    points: () => {
      const hs = [...hi][0] ?? 0;
      return centers.map((x, k) => ({ x, y: y(stacked ? stacked.y1[hs][k] : model.values[hs][k]) }));
    },
  };
  // Forecast range: the line turns dashed from this x (none when it is outside the data)
  const xf = forecastX(geom, fFrom);
  // x in annotation descriptions: the on-screen label ("Mar") when the x is in the data
  const xText = (v: unknown) => {
    const n = xn(v);
    const k = xv ? model.xnum.indexOf(n) : n;
    return k >= 0 ? model.labels[k] : String(v ?? "");
  };
  const toneOf = (si: number, v: number) => (signOn && hi.has(si) && v < baseline ? down : colors[si].fill);

  // Lines and areas break at missing values. With connectNulls, neighboring points are joined as before, and stacked areas always stay as before.
  // With a single x there is nowhere to break, so it stays as before (no dot is drawn for that single point)
  const breaks = !props.connectNulls && !stacked && model.keys.length > 1;

  const draws = useMemo<SeriesDraw[]>(() => {
    return model.series.map((name, s) => {
      const val = (k: number) => (stacked ? stacked.y1[s][k] : model.values[s][k]);
      // Group the x positions with values into connected runs. Without breaks, a single run
      let parts: number[][] = [];
      for (let k = 0; k < model.keys.length; k++) {
        if (!Number.isFinite(val(k))) continue;
        const last = parts[parts.length - 1];
        if (last && (!breaks || last[last.length - 1] === k - 1)) last.push(k);
        else parts.push([k]);
      }
      const count = parts.reduce((t, q) => t + q.length, 0);
      // With several runs, each is downsampled separately (so nothing joins across missing x). Each run's share is proportional to its point count, and each run keeps both ends and its most prominent point. With a single run, maxPts as before
      if (count > maxPts) parts = parts.map((q) => lttb(q.map((k) => ({ x: xs(k), y: val(k), k })), parts.length > 1 ? Math.max(3, Math.round((maxPts * q.length) / count)) : maxPts).map((o) => o.k));
      const idx = parts.flat();
      let at = 0;
      const spans = parts.map((q) => [at, (at += q.length)] as const);
      const pts = idx.map((k) => y(val(k)));
      const base = stacked ? idx.map((k) => y(stacked.y0[s][k])) : isArea ? idx.map(() => y(base0)) : undefined;
      const draw: SeriesDraw = { s, name, pts, xs: idx.map((k) => xs(k)), base, sw: colors[s], hi: hi.has(s), idx, spans };
      const b = bands?.[s];
      const band = b ? bandShape(xs, b.lo, b.hi, y, maxPts) : null;
      if (!b || !band) return draw;
      // Points outside the band are found among the drawn line's points (those left after downsampling)
      const out = props.outside ? idx.flatMap((k, i) => (isOutside(model.values[s][k], b.lo[k], b.hi[k]) ? [i] : [])) : undefined;
      return { ...draw, band, out };
    });
    // xs and y are determined by the values below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, stacked, colors, hi, x0, x1, xd?.[0], xd?.[1], H, dom[0], dom[1], maxPts, isArea, bands, props.outside, breaks, isLog]);

  const stg = c.motion.stagger ?? 120;
  const order = useMemo(() => [...draws].sort((a, b) => Number(a.hi) - Number(b.hi)), [draws]);
  const marks = useMemo<Mark<SeriesDraw>[]>(
    () =>
      order.map((d, k) => {
        const baseLine = y(base0);
        // The band's top and bottom y are appended after the line values and move with them (when the data changes, the band slides along with the line)
        const band = d.band ? [...d.band.top, ...d.band.bottom] : [];
        const bandParts = d.band ? [d.band.top.length, d.band.bottom.length] : [];
        if (isArea) {
          const b = d.base ?? d.pts.map(() => baseLine);
          // Areas fill up from the baseline, and the band rises with them
          return { key: `s:${d.name}`, to: [1, ...d.pts, ...b, ...band], from: [0, ...d.pts.map(() => baseLine), ...b.map(() => baseLine), ...band.map(() => baseLine)], delay: k * stg * 0.5, parts: [1, d.pts.length, b.length, ...bandParts], data: d };
        }
        return { key: `s:${d.name}`, to: [1, ...d.pts, ...band], from: [0, ...d.pts, ...band], enter: [0, ...d.pts, ...band], delay: k * stg, parts: [1, d.pts.length, ...bandParts], data: d };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, stg, isArea, H, base0],
  );
  const m = useMotion(marks, c.motion);

  const fv = c.fv;
  const fmt = c.fmt;
  // Band text: for each series, build the range text per x and the description sentence from the bound names. A series without a name (a single long-table series) is read by the y field name
  const bandText = useMemo(() => {
    if (!bands) return null;
    const wide = Array.isArray(props.y);
    const names = model.series.map((_, si) => [boundName(lower, keep[si], wide, msg.lower), boundName(upper, keep[si], wide, msg.upper)] as const);
    // Range text for the tooltip, live region and hidden table: " (p5 410 ~ p95 2,300)". The unit goes on the value only. An empty string for an x without a range
    const range = (si: number, k: number) => (Number.isFinite(bands[si].lo[k]) ? ` (${names[si][0]} ${fmt(bands[si].lo[k])} ~ ${names[si][1]} ${fmt(bands[si].hi[k])})` : "");
    return { range, unnamed: typeof props.y === "string" ? props.y : undefined, desc: describeBand(model, bands, names, props.outside === true, msg) };
  }, [bands, props.y, model, keep, lower, upper, msg, fmt, props.outside]);
  const events: ChartEvent<T>[] = useMemo(() => {
    // Hiding every series gives an empty chart (the empty-state text is read, as with bars and scatter)
    if (!model.series.length) return [];
    const hs = [...hi][0] ?? 0;
    // Same order as the tooltip: the value, then the range
    const line = (s: string, si: number, k: number) => {
      const name = s || bandText?.unnamed;
      return `${name ? `${name} ` : ""}${fv(rowVals[si][k])}${bandText?.range(si, k) ?? ""}`;
    };
    return lazyArray(model.keys.length, (k) => {
      const v = rowVals[hs]?.[k];
      return {
        datum: model.rows[hs]?.[k] ?? null,
        index: k,
        key: model.keys[k],
        label: model.labels[k],
        value: Number.isFinite(v) ? v : null,
        formatted: model.series
          .map((s, si) => (Number.isFinite(rowVals[si][k]) ? line(s, si, k) : null))
          .filter(Boolean)
          .join(", "),
      };
    });
  }, [model, rowVals, hi, fv, bandText]);

  // The full, unzoomed order is looked up only when setting a range
  const fullIndexOf = (key: string, fallback: number) => {
    const i = model0.keys.indexOf(key);
    return i < 0 ? fallback : i;
  };
  const { brush, frame: brushFrame, hint, text: brushText } = useChartBrush(props, zoom, {
    p,
    active: c.active,
    lang: c.lang,
    count: model.keys.length,
    indexAt: (px) => nearestIndex(centers, px),
    inPlot: (px, py) => px >= x0 - 4 && px <= x1 + 4 && py >= top && py <= H - bottom,
    toXRange: (r) => {
      const fk = model.keys[r.from];
      const tk = model.keys[r.to];
      return { from: fullIndexOf(fk, r.from), to: fullIndexOf(tk, r.to), fromKey: fk, toKey: tk, fromLabel: model.labels[r.from], toLabel: model.labels[r.to] };
    },
  });

  const activeK = c.active;
  useSync(c, props.syncId, model.keys, model.labels);
  let tip: TooltipData | null = null;
  if (activeK !== null && model.keys[activeK] !== undefined && !brush.dragging) {
    // The 100% stack share is also stacked from that row's values by the same rule (without downsampling it matches the plotted share)
    const share = stackMode === "percent" ? stack(rowVals.map((r) => [r[activeK]]), "expand") : null;
    const rows = model.series
      .map((s, si) => ({ s, si, v: rowVals[si][activeK] }))
      .filter((r) => Number.isFinite(r.v))
      .sort((a, b) => b.v - a.v)
      .map((r) => {
        // The range follows the value, muted: "820ms (p5 410 ~ p95 2,300)"
        const range = bandText?.range(r.si, activeK);
        const value = share ? `${Math.round(share.y1[r.si][0] - share.y0[r.si][0])}% · ${c.fv(r.v)}` : c.fv(r.v);
        return { label: r.s || bandText?.unnamed || c.t.value, value: range ? <>{value}<span style={{ fontWeight: 500, color: p.paint("muted") }}>{range}</span></> : value, color: toneOf(r.si, r.v), strong: hi.has(r.si) };
      });
    const yy = Math.min(...model.series.map((_, si) => (stacked ? y(stacked.y1[si][activeK]) : Number.isFinite(model.values[si][activeK]) ? y(model.values[si][activeK]) : H)));
    tip = { x: xs(activeK), y: Math.max(top, yy), title: model.labels[activeK], rows: capTipRows(rows, c.t.more) };
  }

  const onMove = (px: number) => {
    if (!model.keys.length) return;
    const k = nearestIndex(centers, px);
    if (k >= 0 && k !== c.active) c.setActive(k, "pointer");
  };

  // Selected range: the highlighted series' change, high and low
  let brushLayer: ReactNode = null;
  let announce: string | undefined;
  if (brush.range && brush.range.to < model.keys.length) {
    const { from, to } = brush.range;
    const hs = [...hi][0] ?? 0;
    const vals = model.values[hs] ?? [];
    let first = NaN;
    let last = NaN;
    let maxK = -1;
    let minK = -1;
    for (let k = from; k <= to; k++) {
      const v = vals[k];
      if (!Number.isFinite(v)) continue;
      if (!Number.isFinite(first)) first = v;
      last = v;
      if (maxK < 0 || v > vals[maxK]) maxK = k;
      if (minK < 0 || v < vals[minK]) minK = k;
    }
    const ratio = changeRatio(first, last);
    const main = ratio !== null ? signedPercent(ratio, c.locale) : Number.isFinite(last - first) ? `${last - first >= 0 ? "+" : ""}${c.fv(last - first)}` : "-";
    const sub = brushText.range(model.labels[from], model.labels[to]);
    const yAt = (k: number) => y(stacked ? stacked.y1[hs][k] : vals[k]);
    const plotBottom = H - bottom;
    brushLayer = (
      <>
        <BrushBand p={p} x0={centers[from]} x1={centers[to]} top={top} bottom={plotBottom} width={W} main={main} sub={sub} dragging={brush.dragging} />
        {maxK >= 0 && minK >= 0 && maxK !== minK ? (
          <ExtremeTags p={p} lang={c.lang} width={W} top={top} bottom={plotBottom} max={{ x: centers[maxK], y: yAt(maxK), text: c.fv(vals[maxK]) }} min={{ x: centers[minK], y: yAt(minK), text: c.fv(vals[minK]) }} />
        ) : null}
      </>
    );
    if (!brush.dragging) announce = `${msg.span(sub, main)}${maxK >= 0 ? brushText.extremes(c.fv(vals[maxK]), c.fv(vals[minK])) : ""}.${hint}`;
  }

  // End label positions
  const ends = endLabels
    ? (() => {
        const list = draws
          .map((d) => {
            const li = lastIdx(d.s);
            if (li < 0) return null;
            const vy = stacked ? y((stacked.y0[d.s][li] + stacked.y1[d.s][li]) / 2) : y(model.values[d.s][li]);
            return { d, y: vy };
          })
          .filter((v): v is { d: SeriesDraw; y: number } => v !== null);
        const ys = dodgeVertical(
          list.map((l) => l.y),
          14,
          top + 4,
          H - bottom - 2,
        );
        return list.map((l, i) => ({ ...l, ly: ys[i] }));
      })()
    : [];

  const D = c.motion.duration ?? 1100;
  const dots = props.dots ?? "auto";
  const showDots = dots === true || (dots === "auto" && !isArea && model.keys.length <= 16);
  const kindName = isArea ? msg.area : msg.line;
  const desc = props.description ?? `${kindName}. ${msg.desc(model.series.length, model.series.filter(Boolean).join(", ") || c.t.value, model.labels[0] ?? "", model.labels[model.labels.length - 1] ?? "", model.keys.length)}.${bandText?.desc ?? ""}${describeAnnotations(props.annotations, c.lang, c.fv, xText)}${logDropped ? msg.logDropped(logDropped) : ""}`;

  const pieces: ReactNode[] = [];
  // Bands go in one layer under all lines (so they do not cover other series' lines)
  const bandLayer: ReactNode[] = [];
  for (const it of m.items) {
    const d = it.data;
    const v = it.v;
    const n = d.xs.length;
    const draw = v[0];
    const ys = v.slice(1, 1 + n);
    const pts = d.xs.map((xx, i) => [xx, ys[i] ?? ys[ys.length - 1] ?? 0] as [number, number]);
    const sign = signOn && d.hi;
    // Lines and areas use one subpath per run, so with a single run the path is the same as before
    const spans = d.spans;
    const lines = spans.map(([a, b]) => linePath(pts.slice(a, b), curve));
    // Profit and loss colors: one area filled from the line to the reference value is painted through upper and lower clip regions (the base is flat, so each run closes with V and H)
    const signArea = sign ? spans.map(([a], r) => `${lines[r]}V${r2(yb)}H${r2(d.xs[a])}Z`).join("") : "";
    // Area: each run closes with the line as the top edge and bottom as the bottom edge
    const areaD = (bottom: [number, number][]) => spans.map(([a, b]) => areaPath(pts.slice(a, b), bottom.slice(a, b), curve)).join("");
    // An isolated point with no neighbors would not show as a line, so draw a dot (with connectNulls, no dot, as before)
    const lone = breaks ? spans.filter(([a, b]) => b - a === 1).map(([a]) => a) : [];
    const dot = (i: number, opacity: number) => {
      const [xx, yy] = pts[i];
      const col = sign && yy > yb ? down : d.sw.fill;
      return <circle key={i} cx={xx} cy={yy} r={d.hi ? 3 : 2.2} fill={d.hi ? col : p.paint("panel")} stroke={col} strokeWidth={d.hi ? 0 : 1.4} opacity={opacity} />;
    };
    if (d.band) {
      // Motion values: [progress, line y…, (area base y…), band top y…, band bottom y…]
      const o = 1 + (isArea ? 2 * n : n);
      const nb = d.band.top.length;
      bandLayer.push(<path key={it.key} d={bandPath(d.band, v.slice(o, o + nb), v.slice(o + nb, o + 2 * nb), curve)} fill={d.sw.fill} opacity={0.16 * draw * (it.exiting ? 0.4 : 1)} />);
    }
    // Points outside the band: a series-colored dot with a background-colored ring, so it shows even on top of the line
    const outsideDots = (opacity: (i: number) => number) =>
      d.out?.map((i) => {
        const [xx, yy] = pts[i];
        return <circle key={`o${i}`} cx={xx} cy={yy} r={3.6} fill={sign && yy > yb ? down : d.sw.fill} stroke={p.paint("panel")} strokeWidth={1.5} opacity={opacity(i)} />;
      });
    if (isArea) {
      const bs = v.slice(1 + n, 1 + 2 * n);
      const bottomPts = d.xs.map((xx, i) => [xx, bs[i] ?? y(base0)] as [number, number]);
      const lp = lines.join("");
      const fills = sign ? (["up", "dn"] as const).map((t) => <path key={t} d={signArea} fill={t === "up" ? d.sw.fill : down} opacity={0.5} clipPath={`url(#${gid}${t})`} />) : <path d={areaD(bottomPts)} fill={d.sw.fill} opacity={stackMode === "none" ? (d.hi ? 0.5 : 0.28) : 1} />;
      const stroke = (dashed: boolean) =>
        (sign ? (["up", "dn"] as const) : ([null] as const)).map((t) => (
          <path key={t ?? "s"} d={lp} fill="none" stroke={t === "dn" ? down : stackMode === "none" ? d.sw.fill : p.paint("panel")} strokeWidth={stackMode === "none" ? (d.hi ? 2.2 : 1.4) : 1.2} strokeLinejoin="round" strokeDasharray={dashed ? "5 4" : undefined} opacity={Math.min(1, draw * 1.4)} clipPath={t ? `url(#${gid}${t})` : undefined} />
        ));
      pieces.push(
        <g key={it.key} opacity={it.exiting ? 0.4 : 1}>
          {fills}
          {xf !== null ? (
            <>
              <g clipPath={`url(#${gid}pre)`}>{stroke(false)}</g>
              <g clipPath={`url(#${gid}post)`}>{stroke(true)}</g>
            </>
          ) : (
            stroke(false)
          )}
          {lone.map((i) => dot(i, Math.min(1, draw * 1.4)))}
          {outsideDots(() => Math.min(1, draw * 1.4))}
        </g>,
      );
    } else {
      const width = d.hi ? 2.6 : 1.7;
      const dash = draw < 0.999;
      // A point appears when the line has been drawn up to it
      const appear = (i: number) => Math.max(0, Math.min(1, (draw - (n > 1 ? i / (n - 1) : 1)) * 8 + (draw >= 0.999 ? 1 : 0)));
      // The drawing dash restarts at every subpath, so with several runs each run gets its own path, only while drawing.
      // Each run is drawn in its turn by point order, so it looks like a single stroke from the left (matching when the points appear)
      const segs: (readonly [string, number])[] = dash && spans.length > 1 ? spans.flatMap(([a, b], r) => (b - a > 1 ? [[lines[r], Math.max(0, Math.min(1, (draw * (n - 1) - a) / (b - 1 - a)))] as const] : [])) : [[lines.join(""), draw]];
      // While drawing, the drawing dash (1 1); once drawn, the forecast range uses a 5 4 dash. Profit and loss colors paint above and below the reference value through clip regions
      const stroke = (dashed: boolean) =>
        (sign ? (["up", "dn"] as const) : ([null] as const)).flatMap((t) =>
          segs.map(([sd, sp], j) => (
            <path key={`${t ?? "s"}${j}`} d={sd} fill="none" stroke={t === "dn" ? down : d.sw.fill} strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" pathLength={dash ? 1 : undefined} strokeDasharray={dash ? "1 1" : dashed ? "5 4" : undefined} strokeDashoffset={dash ? 1 - sp : undefined} clipPath={t ? `url(#${gid}${t})` : undefined} />
          )),
        );
      const under = props.area && d.hi ? (sign ? (["up", "dn"] as const).map((t) => <path key={t} d={signArea} fill={t === "up" ? d.sw.fill : down} opacity={0.16 * draw} clipPath={`url(#${gid}${t})`} />) : <path d={areaD(pts.map(([xx]) => [xx, y(base0)] as [number, number]))} fill={`url(#${gid}g)`} opacity={draw} />) : null;
      pieces.push(
        <g key={it.key} opacity={it.exiting ? 0.4 : 1}>
          {under}
          {xf !== null ? (
            <>
              <g clipPath={`url(#${gid}pre)`}>{stroke(false)}</g>
              <g clipPath={`url(#${gid}post)`}>{stroke(true)}</g>
            </>
          ) : (
            stroke(false)
          )}
          {(showDots ? pts.map((_, i) => i) : lone).map((i) => dot(i, appear(i)))}
          {outsideDots(appear)}
        </g>,
      );
    }
  }

  return (
    <ChartFrame
      c={c}
      kind={kindName}
      ariaLabel={props.ariaLabel}
      description={desc}
      events={events}
      tip={tip}
      renderTip={props.tooltip}
      className={props.className}
      style={props.style}
      theme={props.theme}
      onPointerMove={(px, _py, e) => {
        // The pointed point keeps following even while dragging (dragging is mouse and pen only)
        brush.move(px);
        if (e.pointerType === "touch") c.setActive(nearestIndex(centers, px), "touch");
        else onMove(px);
      }}
      {...brushFrame}
      announce={announce}
      defs={
        props.area || xf !== null || signOn ? (
          <>
            {props.area ? (
              <linearGradient id={`${gid}g`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={p.paint("accent")} stopOpacity={0.28} />
                <stop offset="100%" stopColor={p.paint("accent")} stopOpacity={0} />
              </linearGradient>
            ) : null}
            {xf !== null ? (
              <>
                <clipPath id={`${gid}pre`}>
                  <rect x={-W} y={-H} width={W + xf} height={H * 3} />
                </clipPath>
                <clipPath id={`${gid}post`}>
                  <rect x={xf} y={-H} width={W * 2} height={H * 3} />
                </clipPath>
              </>
            ) : null}
            {signOn ? (
              <>
                <clipPath id={`${gid}up`}>
                  <rect x={-W} y={-H} width={W * 3} height={H + yb} />
                </clipPath>
                <clipPath id={`${gid}dn`}>
                  <rect x={-W} y={yb} width={W * 3} height={H * 2} />
                </clipPath>
              </>
            ) : null}
          </>
        ) : null
      }
    >
      {props.yLabel && showY ? (
        <Txt x={left} y={6} anchor="start" size={10.5} fill={p.paint("muted")}>
          {props.yLabel}
        </Txt>
      ) : null}
      <GridY p={p} ticks={yTicks} y={y} x0={left} x1={x1 + 4} fmt={tickFmt} locale={c.locale} labels={showY} />
      <AnnotationsUnder list={props.annotations} g={geom} />
      {signOn ? <line x1={x0} x2={x1} y1={yb} y2={yb} stroke={p.paint("dim")} pointerEvents="none" /> : null}
      {refLines?.map((r, i) => (
        <line key={i} x1={x0} x2={x1} y1={y(r.y)} y2={y(r.y)} stroke={p.paint("dim")} strokeDasharray="3 3" />
      ))}
      <rect x={x0} y={top} width={Math.max(0, x1 - x0)} height={Math.max(0, H - bottom - top)} fill="transparent" />
      {bandLayer}
      {pieces}
      <AnnotationsOver list={props.annotations} g={geom} />
      {activeK !== null && model.keys[activeK] !== undefined ? (
        <HoverLine
          p={p}
          x={xs(activeK)}
          top={top}
          bottom={H - bottom}
          dots={model.series.flatMap((_, si) => {
            const v = stacked ? stacked.y1[si][activeK] : model.values[si][activeK];
            return Number.isFinite(v) ? [{ k: si, y: y(v), color: toneOf(si, v), strong: hi.has(si) }] : [];
          })}
        />
      ) : null}
      {refLines?.map((r, i) =>
        r.label ? (
          // A line may pass behind it, so the text is written on a card-background plate
          <g key={`rl${i}`} pointerEvents="none">
            <rect x={x1 - textWidth(r.label, 10.5) - 8} y={y(r.y) - 17} width={textWidth(r.label, 10.5) + 8} height={15} rx={5} fill={p.paint("panel")} opacity={0.94} />
            <Txt x={x1 - 4} y={y(r.y) - 9.5} anchor="end" size={10.5} fill={p.paint("muted")}>
              {r.label}
            </Txt>
          </g>
        ) : null,
      )}
      {ends.map((e) => (
        <Txt key={e.d.name} x={x1 + 8} y={e.ly} size={11} weight={e.d.hi ? 800 : 500} fill={p.paint(e.d.hi ? "ink" : "muted")} opacity={m.fade(D * 0.75, 300)}>
          {truncate(e.d.name, endW - 10, 11, e.d.hi ? 800 : 500)}
        </Txt>
      ))}
      {brushLayer}
      {props.showXAxis === false ? null : <XAxis c={c as ChartCtx<unknown>} model={model as SeriesModel<unknown>} xs={xs} x0={x0} x1={x1} y={H - bottom + 13} domain={xd} fixed={props.xTicks} />}
      {activeK !== null && model.keys[activeK] !== undefined && !brush.dragging ? <AxisPill p={p} x={xs(activeK)} y={H - bottom + 13} label={model.labels[activeK]} width={W} /> : null}
    </ChartFrame>
  );
}

/** Line chart: change over time. Only the highlighted series is in color */
export function LineChart<T = Row>(props: LineChartProps<T>) {
  return <XYChart {...props} kind="line" />;
}

/** Area chart: cumulative totals and changes in composition (stacked, 100% stacked) */
export function AreaChart<T = Row>(props: AreaChartProps<T>) {
  return <XYChart {...props} kind="area" />;
}

export { xScaleFor, XAxis };
