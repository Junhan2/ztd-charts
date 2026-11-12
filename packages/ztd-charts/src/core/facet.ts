import type { ReactNode } from "react";
import { FACET_MAX } from "../spec/meta";
import { numGetter, strGetter } from "../data/accessor";
import { dataSignature } from "../data/parse";
import { stack } from "../layout/stack";
import { annotationYs, type Annotation } from "./annotations";
import { AXIS_FONT, yAxisWidth } from "./axis";
import { makeFormatter, makeTickFormatter, withUnit, type FormatSpec } from "./format";
import { argMax } from "./geometry";
import { plural, type ChartLang } from "./i18n";
import { extent, fitDomain, fitLogDomain, scaleLinear, scaleLog, timeTicks } from "./scale";
import { textWidth } from "./text";
import { prepSeries, type SeriesModel, type XType } from "./series";
import type { Highlight, Row } from "./types";

/** Charts that can be drawn as small multiples */
export type FacetType = "line" | "area" | "bar" | "scatter";
/** "shared": every panel uses the same value axis. "free": each panel fits its own data */
export type FacetScale = "shared" | "free";

/** Minimum panel width (px). Two columns fit in a card on a 390px screen (about 300px) */
export const FACET_MIN_WIDTH = 140;
/** Gap between columns and between rows (px) */
export const FACET_GAP = 12;
export const FACET_ROW_GAP = 14;
/** Height of the panel title row (px) */
export const FACET_TITLE_H = 20;
/** Font size of panel titles */
export const FACET_TITLE_SIZE = 12.5;

/**
 * Groups rows by their by value. Up to max values in order of first appearance; the number of remaining values is dropped.
 * Missing values ("", null, no field) all form one "" group (kept, not removed; its title is FacetPanel.label's "(blank)")
 */
export function facetGroups<T>(data: readonly T[], by: string, max = FACET_MAX): { values: string[]; groups: T[][]; dropped: number } {
  const get = strGetter<T>(by, by);
  const at = new Map<string, T[]>();
  data.forEach((d, i) => {
    const v = get(d, i);
    const list = at.get(v);
    if (list) list.push(d);
    else at.set(v, [d]);
  });
  const values = [...at.keys()].slice(0, max);
  return { values, groups: values.map((v) => at.get(v)!), dropped: Math.max(0, at.size - max) };
}

/**
 * Columns per row: as many as fit with panels at least FACET_MIN_WIDTH wide, and at most columns when given.
 * Panels are spread evenly over the rows so the last row is not left with a lone panel (8 panels that fit in 7 columns become two rows of 4)
 */
export function facetColumns(width: number, n: number, columns?: number): number {
  if (n < 1) return 1;
  const fit = Math.max(1, Math.floor((width + FACET_GAP) / (FACET_MIN_WIDTH + FACET_GAP)));
  // A spec may arrive unvalidated (<Chart>). columns that is not a positive integer is treated as absent
  const cap = Math.max(1, Math.min(fit, Number.isInteger(columns) && columns! >= 1 ? columns! : fit, n));
  return Math.ceil(n / Math.ceil(n / cap));
}

/** Panel width and height. Without a height, 120 to 180px depending on the width */
export function facetPanelSize(width: number, cols: number, height?: number): { pw: number; ph: number } {
  const pw = Math.max(40, Math.floor((width - (cols - 1) * FACET_GAP) / cols));
  // The height goes into a server SVG attribute, so only a finite positive number is used (otherwise the width-based default)
  return { pw, ph: typeof height === "number" && Number.isFinite(height) && height > 0 ? height : Math.max(120, Math.min(180, Math.round(pw * 0.62))) };
}

export interface FacetDomains {
  /** Value axis range */
  y?: [number, number];
  /** Date or numeric x range (line, area, scatter) */
  x?: [number, number];
  /** Every panel has the same x categories (bar, categorical x) in the same order. Only then can x labels go on the bottom row of panels alone */
  sameKeys: boolean;
}

const finite = (xs: number[]) => xs.filter(Number.isFinite);
/** Every number in a single field, or in each field of an array of names */
function fieldValues(rows: readonly Row[], f: unknown): number[] {
  const out: number[] = [];
  for (const k of Array.isArray(f) ? f : f === undefined ? [] : [f]) {
    const get = numGetter<Row>(k as string, String(k));
    rows.forEach((r, i) => out.push(get(r, i)));
  }
  return finite(out);
}

/** Turns a panel's rows into a series matrix by the chart's own rules (categorical x for bars, the aggregation method, date parsing). Shared by the common value axis and the last value in the title row */
function facetModel(type: FacetType, rows: readonly Row[], props: Record<string, unknown>, y: unknown, series: unknown, aggregate: unknown): SeriesModel<Row> {
  return prepSeries(rows, props.x as string | undefined, y as never, series as string | undefined, { xType: type === "bar" ? "band" : (props.xType as XType | undefined), aggregate: aggregate as never, dayFirst: props.dayFirst as boolean | undefined });
}

/**
 * Shared value axis: measured once over all panels (the split rows), with values aggregated and stacked by the chart's rules, plus annotations and reference lines.
 * Charts use the given range as is, so heights can be compared across panels. models holds each panel's facetModel (unused for scatter); pw and ph are the panel size (so the tick count matches the chart's)
 */
export function facetDomains(type: FacetType, groups: readonly (readonly Row[])[], models: readonly SeriesModel<Row>[], props: Record<string, unknown>, pw: number, ph: number): FacetDomains {
  const yCount = Math.max(2, Math.round(ph / 70));
  const isLog = props.yScale === "log" && (type === "line" || type === "scatter");
  // Same rule as the chart: a log scale uses yDomain only when both ends are above 0
  const fixed = props.yDomain as [number, number] | undefined;
  const fixedY = fixed && (!isLog || (fixed[0] > 0 && fixed[1] > 0)) ? fixed : undefined;
  if (type === "scatter") {
    const all = groups.flat();
    const ref = (props.refLines ?? {}) as { x?: number; y?: number };
    const [x0, x1] = extent([...fieldValues(all, props.x ?? "x"), ...finite([Number(ref.x)])]);
    // A log scale does not draw values or reference lines at or below 0, so they stay out of the range too
    const [y0, y1] = extent([...fieldValues(all, props.y ?? "y"), ...finite([Number(ref.y)])].filter((v) => !isLog || v > 0));
    const zero = (props.zero as boolean | undefined) ?? false;
    return {
      y: fixedY ?? (isLog ? fitLogDomain(y0, y1, yCount) : fitDomain(y0, y1, yCount, { zero, pad: 0.08 })),
      x: (props.xDomain as [number, number] | undefined) ?? fitDomain(x0, x1, Math.max(2, Math.round(pw / 110)), { zero, pad: 0.06 }),
      sameKeys: true,
    };
  }
  const isBar = type === "bar";
  const horizontal = isBar && props.orientation === "horizontal";
  const keys = models[0]?.keys.join("\u0001");
  const sameKeys = models.every((m) => m.keys.join("\u0001") === keys);
  const xTyped = models.length > 0 && models.every((m) => m.type !== "band" && m.type === models[0].type);
  const x = (props.xDomain as [number, number] | undefined) ?? (!isBar && xTyped ? extent(models.flatMap((m) => finite(m.xnum))) : undefined);
  // For 100% stacking the chart fixes the range to 0 to 100
  const mode = isBar ? (props.layout as string | undefined) ?? "grouped" : type === "area" ? (props.stack as string | undefined) ?? "auto" : "none";
  if (mode === "percent") return { x, sameKeys };
  if (fixedY) return { y: fixedY, x, sameKeys };
  const vals: number[] = [];
  groups.forEach((g, gi) => {
    const m = models[gi];
    const stacked = mode === "stacked" || (mode === "auto" && m.series.length > 1);
    if (stacked) {
      const st = stack(m.values, "zero");
      st.y0.forEach((r) => vals.push(...r));
      st.y1.forEach((r) => vals.push(...r));
    } else m.values.forEach((r) => vals.push(...r));
    // Lines over bars (same axis) and range band bounds
    if (isBar && !horizontal && props.line !== undefined) facetModel(type, g, props, ([] as unknown[]).concat(props.line), undefined, props.series === undefined ? props.aggregate : "mean").values.forEach((r) => vals.push(...r));
    if (!isBar) vals.push(...fieldValues(g, props.lower), ...fieldValues(g, props.upper));
  });
  // Bars grow from 0
  if (isBar) vals.push(0);
  if (!horizontal) vals.push(...annotationYs(props.annotations as Annotation[] | undefined));
  for (const r of (props.referenceLines as { y: number }[] | undefined) ?? []) vals.push(r.y);
  if (props.signColors) vals.push(Number(props.baseline ?? 0));
  const [mn, mx] = extent(finite(vals).filter((v) => !isLog || v > 0));
  const y: [number, number] = isLog
    ? fitLogDomain(mn, mx, yCount)
    : isBar
      ? fitDomain(mn, mx, horizontal ? Math.max(2, Math.round(pw / 120)) : yCount)
      : fitDomain(mn, mx, yCount, { zero: (props.zero as boolean | undefined) ?? type === "area" });
  return { y, x, sameKeys };
}

/**
 * x ticks for a shared value axis with few x values (the rule by which a line chart labels each point instead of using ticks: 12 or fewer numbers, or no more dates than ticks).
 * Collects the x values of all panels and, from the first value, thins them at one spacing that keeps labels from overlapping in the narrowest panel (the first column, which has the value axis labels).
 * Every panel draws this list as is, so a panel without one of those x values shows the same labels. undefined when there are many values (the charts use even ticks over the same range)
 */
function sharedXTicks(type: FacetType, groups: readonly (readonly Row[])[], models: readonly SeriesModel<Row>[], cp: Record<string, unknown>, dom: FacetDomains, pw: number, ph: number, locale: string): { value: number; label: string }[] | undefined {
  if ((type !== "line" && type !== "area") || !dom.x || !dom.y) return undefined;
  const all = prepSeries(groups.flat(), cp.x as string | undefined, cp.y as never, undefined, { xType: cp.xType as XType | undefined, locale, dayFirst: cp.dayFirst as boolean | undefined });
  // Narrowest plot: the width minus the value axis label width (same ticks and format as the chart) and the room for series labels at the right end
  const yTicks = (cp.yScale === "log" && type === "line" ? scaleLog : scaleLinear)(dom.y, [ph - 22, 10]).ticks(Math.max(2, Math.round(ph / 70)));
  const left = yAxisWidth(yTicks, makeTickFormatter(cp.format as FormatSpec | undefined, locale, Math.max(Math.abs(dom.y[0]), Math.abs(dom.y[1]))), locale);
  const names = models.flatMap((m) => m.series);
  const ends = (cp.endLabels as boolean | undefined) ?? models.some((m) => m.series.length > 1);
  const x0 = left + 6;
  const x1 = pw - (ends ? Math.min(pw * 0.28, Math.max(...names.map((s) => textWidth(s, 11, 700)), 20) + 14) : 10);
  const n = all.keys.length;
  const [a, b] = dom.x[1] === dom.x[0] ? [dom.x[0], dom.x[0] + 1] : dom.x;
  const many = all.type === "number" ? n > 12 : n > timeTicks(a, b, Math.max(2, Math.floor((x1 - x0) / 64)), locale).length;
  if (all.type === "band" || !n || many) return undefined;
  const at = (k: number) => x0 + ((all.xnum[k] - a) / (b - a)) * (x1 - x0);
  const w = (k: number) => textWidth(all.labels[k], AXIS_FONT);
  for (let step = 1; ; step++) {
    const idx = Array.from({ length: Math.ceil(n / step) }, (_, i) => i * step);
    if (step >= n || idx.every((k, i) => !i || at(k) - at(idx[i - 1]) >= (w(k) + w(idx[i - 1])) / 2 + 8)) return idx.map((k) => ({ value: all.xnum[k], label: all.labels[k] }));
  }
}

/** 32-bit FNV-1a as hex. The same text always gives the same value */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** syncId that links the panels. Derived from the chart type, the split field, the channels and the data, so the same spec gives the same id on server and browser however often it is drawn (no random numbers or timestamps) */
export function facetSyncId(type: string, by: string, props: Record<string, unknown>, data: readonly unknown[]): string {
  const channels = [props.x, props.y, props.series].map((v) => JSON.stringify(v ?? null)).join("|");
  return `ztd-facet-${hash(`${type}|${by}|${channels}|${dataSignature(data)}`)}`;
}

/** Whether highlight picks panels (by values): a single by value, or an array whose items are all by values */
export function isPanelHighlight(h: unknown, values: readonly string[]): h is string | string[] {
  if (typeof h === "string") return values.includes(h);
  return Array.isArray(h) && h.length > 0 && h.every((v) => typeof v === "string" && values.includes(v));
}

const TEXT = {
  en: {
    intro: (n: number, by: string) => `${plural(n, "panel")} by ${by}.`,
    endHigh: (name: string, v: string) => ` ${name} ends highest at ${v}.`,
    falling: (names: string) => ` Lower at the end than at the start: ${names}.`,
    noneFalling: " None is lower at the end than at the start.",
    total: (name: string, v: string) => ` ${name} has the largest total at ${v}.`,
    points: (name: string, n: number) => ` ${name} has the most points (${n}).`,
    dropped: (shown: number, total: number) => ` Only the first ${shown} of ${total} values are shown.`,
    more: ", …",
    blank: "(blank)",
  },
  ko: {
    intro: (n: number, by: string) => `${by}별 패널 ${n}개.`,
    endHigh: (name: string, v: string) => ` 마지막 값이 가장 큰 곳: ${name}(${v}).`,
    falling: (names: string) => ` 처음보다 끝이 낮은 곳: ${names}.`,
    noneFalling: " 처음보다 끝이 낮은 곳은 없어요.",
    total: (name: string, v: string) => ` 합계가 가장 큰 곳: ${name}(${v}).`,
    points: (name: string, n: number) => ` 점이 가장 많은 곳: ${name}(${n}개).`,
    dropped: (shown: number, total: number) => ` ${total}개 중 앞의 ${shown}개만 보여요.`,
    more: " 등",
    blank: "(빈 값)",
  },
};

export interface FacetPanel {
  /** The by value. "" for a missing value ("", null, no field) */
  value: string;
  /** Text for the panel's title, name and description. "(blank)" for a missing value, "(빈 값)" in Korean */
  label: string;
  /** Chart props that differ per panel (data, size, name, group, highlight, axis ranges and labels). Passed after chartProps, overriding them */
  props: Record<string, unknown>;
  /** Last value at the right of the title (single-series line and area only) */
  last?: string;
  /** highlight picked this panel (accent color title) */
  isPicked: boolean;
}

export interface FacetPlan {
  panels: FacetPanel[];
  cols: number;
  pw: number;
  ph: number;
  /** Whether highlight picks panels (titles of panels not picked are dimmed) */
  isPanelPick: boolean;
  /** One sentence announcing the whole group */
  description: string;
  /**
   * Legend shared by all panels (the common color scale of a hexbin density scatter). Drawn once at the top right of the grid, FACET_LEGEND_H tall, and not in the panels.
   * It is an svg with class="ztd-facet-legend", so the server SVG moves it to the same spot too
   */
  legend?: ReactNode;
}

/** Height of the group legend row (px) */
export const FACET_LEGEND_H = 18;

export interface FacetInput {
  type: FacetType;
  data: readonly Row[];
  by: string;
  columns?: number;
  scale?: FacetScale;
  /** Chart props passed to every panel (x, y, series, format …) */
  chartProps: Record<string, unknown>;
  highlight?: Highlight<Row>;
  syncId?: string;
  /** Total width */
  width: number;
  /** Panel height */
  height?: number;
  /** First part of the panel name: "<title>, <value>" */
  title?: string;
  locale: string;
  lang: ChartLang;
}

/**
 * Small multiples layout and panel props. Shared by <ChartFacets> and the server SVG, so both drawings match.
 * With a shared value axis, value axis labels go only on the left column and x labels only on panels with nothing below them (x labels on all panels when categories differ per panel)
 */
export function planFacets(o: FacetInput): FacetPlan {
  const { type, chartProps: cp } = o;
  const { values, groups, dropped } = facetGroups(o.data, o.by);
  const n = values.length;
  // The width may also arrive unvalidated from a spec (options.width), so only a finite positive number is used
  const width = typeof o.width === "number" && Number.isFinite(o.width) && o.width > 0 ? o.width : 480;
  const cols = facetColumns(width, n, o.columns);
  const { pw, ph } = facetPanelSize(width, cols, o.height);
  const shared = o.scale !== "free";
  // Each panel's series matrix is built only once (shared by the common value axis, the last value in the title row and the description)
  const models = type === "scatter" ? [] : groups.map((g) => facetModel(type, g, cp, cp.y, cp.series, cp.aggregate));
  const dom = shared ? facetDomains(type, groups, models, cp, pw, ph) : { sameKeys: false };
  const xTicks = shared ? sharedXTicks(type, groups, models, cp, dom, pw, ph, o.locale) : undefined;
  const horizontal = type === "bar" && cp.orientation === "horizontal";
  // Left and bottom labels are gathered on the edge panels only when they are the same in every panel (a scatter with a shared value axis always has an x range)
  const leftShared = shared && (!horizontal || dom.sameKeys);
  const bottomShared = shared && (horizontal || dom.x !== undefined || dom.sameKeys);
  const picked = new Set(isPanelHighlight(o.highlight, values) ? [o.highlight].flat() : []);
  const isPick = picked.size > 0;
  // A picked panel turns wholly to the accent color: single-series bars (by default only the largest bar) and scatter without series (no highlight by default). Line and area show the default (first series) in the accent color
  const whole = (type === "bar" && !Array.isArray(cp.y) && cp.series === undefined) || (type === "scatter" && cp.series === undefined);
  const syncId = o.syncId ?? facetSyncId(type, o.by, cp, o.data);
  const fmt = withUnit(makeFormatter(cp.format as FormatSpec | undefined, o.locale), cp.unit as string | undefined);
  const t = TEXT[o.lang];
  // Panel summary for the description: first and last values (line, area, summed over series), total (bar), point count (scatter)
  const sums: { first: number; last: number; total: number }[] = [];
  // The missing-value group gets its visible name (the same text for title, chart name and description)
  const labels = values.map((v) => (v === "" ? t.blank : v));
  const panels = values.map((value, i): FacetPanel => {
    const rows = groups[i];
    const label = labels[i];
    const col = i % cols;
    let last: string | undefined;
    if (type !== "scatter") {
      const m = models[i];
      const at = (k: number) => m.values.reduce((s, r) => s + (Number.isFinite(r[k]) ? r[k] : 0), 0);
      const ks = m.keys.map((_, k) => k).filter((k) => m.values.some((r) => Number.isFinite(r[k])));
      const lastK = ks[ks.length - 1];
      sums.push({ first: ks.length ? at(ks[0]) : NaN, last: ks.length ? at(lastK) : NaN, total: ks.reduce((s, k) => s + at(k), 0) });
      if (type !== "bar" && m.series.length === 1 && lastK !== undefined) last = fmt(m.values[0][lastK]);
    } else sums.push({ first: NaN, last: NaN, total: rows.length });
    const props: Record<string, unknown> = {
      data: rows,
      width: pw,
      height: ph,
      ariaLabel: o.title ? `${o.title}, ${label}` : label,
      syncId,
      highlight: isPick ? (picked.has(value) ? (whole ? () => true : undefined) : "none") : o.highlight,
      showYAxis: !leftShared || col === 0,
      showXAxis: !bottomShared || i + cols >= n,
    };
    if (dom.y) props.yDomain = dom.y;
    if (dom.x) props.xDomain = dom.x;
    if (xTicks) props.xTicks = xTicks;
    return { value, label, props, last, isPicked: picked.has(value) };
  });
  return { panels, cols, pw, ph, isPanelPick: isPick, description: describeFacets(type, o.by, labels, sums, dropped, fmt, t) };
}

/** Group description: panel count, the largest panel (last value, total, point count), panels that end lower than they start (line, area), dropped values */
function describeFacets(type: FacetType, by: string, values: string[], sums: { first: number; last: number; total: number }[], dropped: number, fmt: (v: number) => string, t: (typeof TEXT)["en"]): string {
  let out = t.intro(values.length, by);
  const top = (key: "last" | "total") => argMax(sums.map((s) => s[key]));
  if (type === "line" || type === "area") {
    const k = top("last");
    if (k >= 0) out += t.endHigh(values[k], fmt(sums[k].last));
    const falling = values.filter((_, i) => sums[i].last < sums[i].first);
    out += falling.length ? t.falling(`${falling.slice(0, 5).join(", ")}${falling.length > 5 ? t.more : ""}`) : t.noneFalling;
  } else {
    const k = top("total");
    if (k >= 0) out += type === "bar" ? t.total(values[k], fmt(sums[k].total)) : t.points(values[k], sums[k].total);
  }
  if (dropped) out += t.dropped(values.length, values.length + dropped);
  return out;
}
