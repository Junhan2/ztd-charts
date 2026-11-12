import { useMemo, type ReactNode } from "react";
import { AnnotationsOver, AnnotationsUnder, annotationYs, describeAnnotations, forecastFrom, type Annotation, type AnnotationGeom } from "../core/annotations";
import { AXIS_FONT, AxisPill, AxisXBand, GridY, thinLabels, yAxisWidth } from "../core/axis";
import { bandRuns } from "../core/band";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { makeTickFormatter } from "../core/format";
import { polyline, roundRectPath } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { categorical, emphasis, type Swatch } from "../core/palette";
import { extent, fitDomain, scaleBand, scaleLinear } from "../core/scale";
import { prepSeries, syncKeyOf, visibleSeries, type Aggregate } from "../core/series";
import { textWidth, truncate, type Box } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useSync } from "../core/sync";
import { useMotion } from "../core/useMotion";
import { divergingLead, divergingStack, stack } from "../layout/stack";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Bar chart",
  desc: (cats: number, nS: number, names: string) => `${plural(cats, "category", "categories")}${nS > 1 ? `, ${nS} series (${names})` : ""}`,
  lines: (names: string[]) => `, ${names.length > 1 ? "lines" : "line"}: ${names.join(", ")}`,
  sides: (neg: string, pos: string) => `negative ${neg}, positive ${pos}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "막대 차트", desc: (cats, nS, names) => `${cats}개 범주${nS > 1 ? `, 계열 ${nS}개(${names})` : ""}`, lines: (names) => `, 선: ${names.join(", ")}`, sides: (neg, pos) => `음수 쪽 ${neg}, 양수 쪽 ${pos}` },
};

/** Height of one line of value text (11px text). In a diverging stack, value labels are dropped when a row's band is narrower than this */
const LABEL_LINE = 12;

export interface BarChartProps<T = Row> extends BaseChartProps<T> {
  /** Category field. Default "x" (horizontal bars also pass the category as x) */
  x?: Accessor<T, string>;
  /** Value field. An array means several columns of a wide table */
  y?: Accessor<T, number> | string[];
  /** Series field (long table) */
  series?: Accessor<T, string>;
  /** "grouped" | "stacked" | "percent" | "diverging". Default "grouped". "diverging" stacks to both sides of the zero line (Likert, population pyramid) */
  layout?: "grouped" | "stacked" | "percent" | "diverging";
  /** "vertical" | "horizontal". Default "vertical", or "horizontal" with layout "diverging" */
  orientation?: "vertical" | "horizontal";
  /** Sort by value (with one series). Default false. With layout "diverging", "positive" | "negative" puts the rows with the largest total on that side first */
  sort?: boolean | "positive" | "negative";
  /** layout "diverging": names of the series placed left of the zero line (below it when vertical), in order outward from the zero line. y field names for a wide table, series values for a long table. The other series go on the right in data order, and values that are already negative go left by their sign */
  negative?: readonly string[];
  /** layout "diverging": name of the series split in half across the zero line (usually "Neutral") */
  neutral?: string;
  /** layout "diverging": show each segment as its share (%) of the row's absolute total. Default false */
  percent?: boolean;
  /** How to combine several rows with the same category and series. Default "sum" */
  aggregate?: Aggregate;
  /** What to highlight: a category with one series, a series with several. Default "max" / the first series. With several series, a predicate function receives the series name, not the row: (name, index) => boolean */
  highlight?: BaseChartProps<T>["highlight"];
  /** Annotations: target band, period, reference line, event, forecast, trend line. Drawn on vertical bars only. Bars after the forecast start are faint with a dashed outline */
  annotations?: Annotation[];
  /** Value field of a line drawn over vertical bars on the same axis (target, last year, etc.). An array for several. Without highlight the bars are gray, and with a series field the values at the same x are averaged. Not drawn on horizontal or 100% bars */
  line?: string | string[];
  /** Names of series to hide. Colors and highlight are set from all series, so the remaining series keep their colors. The value axis fits the visible series. No effect with a single series. Hiding every series gives an empty chart */
  hidden?: readonly string[];
  /** Fixed value axis range [min, max] (the horizontal axis for horizontal bars). Not used for 100% bars. Small multiples (ChartFacets) use it to match heights across panels */
  yDomain?: [number, number];
  /** Bottom axis labels (categories for vertical bars, values for horizontal bars). Default true. false removes only the labels and keeps their space */
  showXAxis?: boolean;
  /** Left axis labels (values for vertical bars, categories for horizontal bars). Default true. false removes the labels and their space */
  showYAxis?: boolean;
}

interface BarSeg {
  key: string;
  k: number;
  s: number;
  cat: string;
  series: string;
  value: number;
  v0: number;
  v1: number;
  sw: Swatch;
  hi: boolean;
  /** diverging: the segment's position counted from the zero line (0 for the middle series). Used for the entrance order and rounded corners */
  ring?: number;
  /** diverging: whether this is the segment at the low or high end of the row (rounded corners) */
  endLo?: boolean;
  endHi?: boolean;
}

/** Bar chart: grouped, stacked, 100% and diverging bars, plus horizontal bars */
export function BarChart<T = Row>(props: BarChartProps<T>) {
  const layout = props.layout ?? "grouped";
  const diverging = layout === "diverging";
  const horizontal = props.orientation === "horizontal" || (diverging && props.orientation === undefined);
  const c = useChart(props, { height: (w) => (horizontal ? Math.max(180, Math.min(320, w * 0.5)) : Math.max(200, Math.min(290, w * 0.52))), duration: 750, stagger: 60 });
  const { p, width: W, height: H } = c;

  const model0 = useMemo(() => prepSeries(props.data, props.x, props.y as never, props.series, { xType: "band", locale: c.locale, aggregate: props.aggregate }), [props.data, props.x, props.y, props.series, c.locale, props.aggregate]);
  // Series positions in the diverging stack (based on all series; names that match no series are dropped)
  const negKey = props.negative?.join("\u0001") ?? "";
  const divOpts = useMemo(() => {
    if (!diverging) return null;
    const at = (name: string) => model0.series.indexOf(name);
    return { negative: (negKey ? negKey.split("\u0001") : []).map(at).filter((i) => i >= 0), neutral: props.neutral === undefined ? undefined : at(props.neutral), percent: props.percent === true };
  }, [diverging, model0.series, negKey, props.neutral, props.percent]);
  const sorted = useMemo(() => {
    const by = (score: number[]) => {
      const idx = model0.keys.map((_, k) => k).sort((a, b) => (score[b] || 0) - (score[a] || 0));
      return { ...model0, keys: idx.map((k) => model0.keys[k]), labels: idx.map((k) => model0.labels[k]), xnum: idx.map((_, i) => i), values: model0.values.map((row) => idx.map((k) => row[k])), rows: model0.rows.map((row) => idx.map((k) => row[k])) };
    };
    // The diverging stack sorts by that side's total (set from all series regardless of hidden ones, so rows do not move when series are hidden)
    if (divOpts && (props.sort === "positive" || props.sort === "negative")) {
      const st = divergingStack(model0.values, divOpts);
      return by(props.sort === "positive" ? st.pos : st.neg);
    }
    if (!props.sort || model0.series.length !== 1) return model0;
    return by(model0.values[0]);
  }, [model0, props.sort, divOpts]);
  // With one series, highlight per bar. With several, draw without the hidden series. Highlight and colors are set from all series first, then picked (the remaining series keep their colors)
  const single = sorted.series.length === 1;
  const hiddenKey = single ? "" : (props.hidden?.join("\u0001") ?? "");
  const [model, keep] = useMemo(() => visibleSeries(sorted, hiddenKey), [sorted, hiddenKey]);
  const nS = model.series.length;
  // Lines on the same axis (target, last year): vertical bars only. Matched by key to the bar categories (after sorting); in a long table the values at the same x are averaged (so a target repeated per series does not double). An empty list is the same as no line
  const drawLines = !!props.line?.length && !horizontal && layout !== "percent" && !diverging;
  const lineModel = useMemo(
    () => (drawLines ? prepSeries(props.data, props.x, (Array.isArray(props.line) ? props.line : [props.line]) as never, undefined, { xType: "band", locale: c.locale, aggregate: props.series === undefined ? props.aggregate : "mean" }) : null),
    [drawLines, props.data, props.x, props.line, props.series, props.aggregate, c.locale],
  );
  const lineAt = useMemo(() => new Map((lineModel?.keys ?? []).map((k, i) => [k, i])), [lineModel]);
  /** Value of line li at category k (NaN when missing) */
  const lineVal = (li: number, k: number) => {
    const j = lineAt.get(model.keys[k]);
    return lineModel && j !== undefined ? lineModel.values[li][j] : Number.NaN;
  };

  const hiAll = useMemo(() => {
    // With lines, the line takes the accent color, so bars are highlighted only when highlight is set
    if (single) return resolveHighlight(props.highlight, sorted.rows[0] as T[], sorted.labels, sorted.values[0], drawLines ? "none" : "max");
    // In a diverging stack with no highlight and with negative set, highlight the outermost positive series (from ink at the left end to the accent color at the right end)
    const lead = divOpts && props.highlight === undefined ? divergingLead(sorted.series.length, divOpts.negative, divOpts.neutral) : -1;
    if (lead >= 0) return new Set([lead]);
    const totals = sorted.values.map((r) => r.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0));
    return resolveHighlight(props.highlight as never, sorted.series as never[], sorted.series, totals, drawLines ? "none" : "first");
  }, [sorted, single, props.highlight, drawLines, divOpts]);
  const colorsAll = useMemo(() => (single ? emphasis(p, sorted.keys.length, hiAll) : categorical(p, sorted.series.length, hiAll)), [single, p, sorted.keys.length, hiAll, sorted.series.length]);
  // Map to the visible series positions (unchanged when nothing is hidden)
  const hi = useMemo(() => (model === sorted ? hiAll : new Set(keep.flatMap((i, j) => (hiAll.has(i) ? [j] : [])))), [model, sorted, hiAll, keep]);
  const colors = useMemo(() => (model === sorted ? colorsAll : keep.map((i) => colorsAll[i])), [model, sorted, colorsAll, keep]);

  // Diverging stack: a hidden series only leaves its slot empty and stays in the percent denominator. The value axis and end-label space are set from all series (divAll), so only the side with the hidden series restacks
  const [div, divAll] = useMemo(() => {
    if (!divOpts) return [null, null];
    const all = divergingStack(sorted.values, divOpts);
    return [keep.length === sorted.series.length ? all : divergingStack(sorted.values, { ...divOpts, skip: new Set(sorted.series.flatMap((_, i) => (keep.includes(i) ? [] : [i]))) }), all];
  }, [divOpts, sorted, keep]);

  const segs = useMemo(() => {
    const out: BarSeg[] = [];
    const st = div ? { y0: keep.map((i) => div.y0[i]), y1: keep.map((i) => div.y1[i]) } : layout === "grouped" ? null : stack(model.values, layout === "percent" ? "expand" : "zero");
    model.keys.forEach((cat, k) => {
      const row: BarSeg[] = [];
      model.series.forEach((s, si) => {
        const v = model.values[si][k];
        if (!Number.isFinite(v)) return;
        const v0 = st ? st.y0[si][k] : 0;
        const v1 = st ? st.y1[si][k] : v;
        row.push({ key: `${cat}|${s}`, k, s: si, cat: model.labels[k], series: s, value: v, v0, v1, sw: single ? colors[k] : colors[si], hi: single ? hi.has(k) : hi.has(si) });
      });
      if (div) {
        // Left-to-right order (the keyboard follows it too), position from the zero line, and the segments at both ends of the row
        row.sort((a, b) => Math.min(a.v0, a.v1) - Math.min(b.v0, b.v1));
        const lo = Math.min(...row.map((g) => Math.min(g.v0, g.v1)));
        const hiEnd = Math.max(...row.map((g) => Math.max(g.v0, g.v1)));
        const isMid = (g: BarSeg) => g.v0 < 0 && g.v1 > 0;
        const down = row.filter((g) => !isMid(g) && g.v1 < g.v0).length;
        let left = 0;
        let up = 0;
        row.forEach((g) => {
          g.ring = isMid(g) ? 0 : g.v1 < g.v0 ? down - left++ : ++up;
          g.endLo = Math.min(g.v0, g.v1) === lo;
          g.endHi = Math.max(g.v0, g.v1) === hiEnd;
        });
      }
      out.push(...row);
    });
    return out;
  }, [model, layout, colors, single, hi, div, keep]);

  const vals = divAll ? [...divAll.y0.flat(), ...divAll.y1.flat()] : segs.flatMap((s) => [s.v0, s.v1]);
  // Annotations are drawn on vertical bars only. 100% bars, fixed at 0~100%, do not widen their range for annotation values. Not drawn on diverging stacks
  const notes = horizontal || diverging ? undefined : props.annotations;
  if (layout !== "percent") vals.push(...annotationYs(notes));
  if (lineModel) for (const row of lineModel.values) for (const x of row) if (Number.isFinite(x)) vals.push(x);
  const [mn, mx] = extent(vals.length ? vals : [0, 1]);
  const ticksWanted = horizontal ? Math.max(2, Math.round(W / 120)) : Math.max(2, Math.round(H / 70));
  // A diverging stack fits each side to its own data end (the longest row on that side, half of the middle series included). It does not widen to the next tick; ticks are picked inside that range (the zero line need not be centered).
  // With yDomain (the shared value axis of small multiples), use that range
  const dom: [number, number] = layout === "percent" ? [0, 100] : props.yDomain ?? (diverging && mn < mx ? [mn, mx] : fitDomain(mn, mx, ticksWanted));
  const baseTick = layout === "percent" || (diverging && props.percent) ? (v: number) => `${v}%` : makeTickFormatter(props.format, c.locale, Math.max(Math.abs(dom[0]), Math.abs(dom[1])));
  // Diverging stack ticks show magnitude only (the left side is positive too)
  const tickFmt = diverging ? (v: number) => baseTick(Math.abs(v)) : baseTick;
  const showValues = c.showLabels && (single || layout !== "grouped" || nS <= 3);
  const valueText = (sg: BarSeg) => (layout === "percent" ? c.pct(sg.v1 - sg.v0) : diverging ? (props.percent ? c.pct(Math.abs(sg.v1 - sg.v0)) : c.fmt(Math.abs(sg.value))) : c.fmt(sg.value));
  /** Text for one side's total in a diverging stack */
  const sideText = (x: number) => (props.percent ? c.pct(x) : c.fmt(x));

  // Axis layout. Removing the left labels removes their space too
  const showY = props.showYAxis !== false;
  const showX = props.showXAxis !== false;
  const catW = horizontal && showY ? Math.min(W * 0.32, Math.max(...model.labels.map((l) => textWidth(l, 11.5, 600)), 24) + 10) : 0;
  const ticks = scaleLinear(dom, [0, 1]).ticks(horizontal ? Math.max(2, Math.round(W / 130)) : Math.max(2, Math.round(H / 70)));
  const left = horizontal ? catW + 6 : showY ? yAxisWidth(ticks, tickFmt, c.locale) : 0;
  const top = horizontal ? 4 : showValues ? 16 : 8;
  const bottom = horizontal ? 18 : 22;
  // Diverging stack value labels: when a row's band is narrower than one line of text (horizontal) or than the total label (vertical), drop both the end totals and the in-segment labels (so dense rows do not overlap). Values remain in the tooltip and table
  const rowStep = divAll ? (horizontal ? scaleBand(model.keys, [top, H - bottom], 0.3, 0.12) : scaleBand(model.keys, [left + 4, W - 2], 0.32, 0.12)).step : 0;
  const totalW = divAll ? Math.max(0, ...[...divAll.neg, ...divAll.pos].map((x) => textWidth(sideText(x), 11, 600))) : 0;
  const divLabels = showValues && rowStep >= (horizontal ? LABEL_LINE : totalW + 4);
  // End total labels: per row, [left (bottom), right (top)]. null when that side has no segment
  const totals = div && divLabels ? model.keys.map((_, k) => [div.neg[k] > 0 ? sideText(div.neg[k]) : null, div.pos[k] > 0 ? sideText(div.pos[k]) : null]) : [];
  const sidePad = (j: number) => (divAll && divLabels ? Math.max(0, ...[divAll, div ?? divAll].flatMap((d) => (j ? d.pos : d.neg).map((x) => (x > 0 ? textWidth(sideText(x), 11, 600) + 10 : 0)))) : 0);
  const valPad = horizontal && showValues && layout !== "percent" ? (diverging ? sidePad(1) : Math.max(...segs.map((s) => textWidth(valueText(s), 11, 700)), 0) + 10) : 0;
  // Negative value labels on vertical bars go below the bar end. Leave room for the label under the lowest bar
  const negPad = !horizontal && (diverging ? divLabels : showValues) && mn < 0 && (single || layout === "grouped" || diverging) ? 16 : 0;
  const x0 = horizontal ? left + (diverging ? sidePad(0) : 0) : left + 4;
  const x1 = horizontal ? W - Math.max(8, valPad) : W - 2;
  const band = horizontal ? scaleBand(model.keys, [top, H - bottom], 0.3, 0.12) : scaleBand(model.keys, [x0, x1], nS > 1 && layout === "grouped" ? 0.24 : 0.32, 0.12);
  const v = horizontal ? scaleLinear(dom, [x0, x1]) : scaleLinear(dom, [H - bottom - negPad, top]);
  const inner = layout === "grouped" && nS > 1 ? scaleBand(model.series, [0, band.bandwidth], 0.12, 0) : null;
  const r = Math.min(p.theme.radiusMark, (inner ? inner.bandwidth : band.bandwidth) / 4);
  /** Center of category k's band (where the line's point sits) */
  const mid = (k: number) => band(model.keys[k]) + band.bandwidth / 2;
  const lineInk = (li: number) => p.paint(lineToken(li));

  // Annotation x values: find the band center by category key. Ranges and forecasts extend to the band edge (half the band width)
  const fFrom = forecastFrom(notes);
  const fk = fFrom === undefined ? -1 : band.index(String(fFrom));
  const ag: AnnotationGeom = {
    p,
    lang: c.lang,
    xAt: (val) => {
      const k = band.index(String(val));
      return k < 0 ? null : band(model.keys[k]) + band.bandwidth / 2;
    },
    half: band.step / 2,
    edge: true,
    y: v,
    x0,
    x1,
    top,
    bottom: H - bottom,
    // Trend line: the values with one series, the highlighted series for grouped bars, the category totals for stacked bars. None for 100% bars
    points: () => {
      if (layout === "percent") return [];
      const hs = [...hi][0] ?? 0;
      return model.keys.map((key, k) => {
        const val = single ? model.values[0][k] : layout === "grouped" ? model.values[hs][k] : model.values.reduce((s, row) => s + (Number.isFinite(row[k]) ? row[k] : 0), 0);
        return { x: band(key) + (inner ? inner(model.series[hs]) + inner.bandwidth / 2 : band.bandwidth / 2), y: v(val) };
      });
    },
  };

  const geom = (sg: BarSeg) => {
    const pos = band(model.keys[sg.k]) + (inner ? inner(sg.series) : 0);
    const th = inner ? inner.bandwidth : band.bandwidth;
    const a = v(sg.v0);
    const b = v(sg.v1);
    return { pos, th, a, b };
  };

  // Value labels of single-series vertical bars: thinned out so they do not overlap when wider than the band (the highlighted bar's label stays)
  const shownValues = useMemo(
    () => (single && !horizontal && showValues ? new Set(thinLabels(segs.map((sg) => band(model.keys[sg.k]) + band.bandwidth / 2), segs.map(valueText), band.bandwidth < 26 ? 10 : 11, 4, 500, new Set(segs.flatMap((sg, j) => (sg.hi ? [j] : []))))) : null),
    // band and valueText are determined by the values below
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segs, single, horizontal, showValues, layout, W, H, c.fmt],
  );

  // Layouts where bars do not stack (grouped, one series)
  const solo = layout === "grouped" || nS === 1;
  // Position of the value label above a vertical bar (below when negative). null when thinned out (one series) or wider than the band (grouped). Shared by drawing and the boxes below
  const valueSpot = (sg: BarSeg, i: number, pos: number, th: number, a: number, b: number, tw: number) => {
    if (nS === 1 ? shownValues !== null && !shownValues.has(i) : th < tw * 0.8) return null;
    const spot = { x: pos + th / 2, y: sg.v1 < sg.v0 || sg.value < 0 ? Math.max(a, b) + 8 : Math.min(a, b) - 8, size: th < 26 ? 10 : 11 };
    // Drop the label when a line point overlaps it (the value remains in the tooltip)
    const px = mid(sg.k);
    if (lineModel && Math.abs(px - spot.x) < tw / 2 + 5 && lineModel.series.some((_, li) => Math.abs(v(lineVal(li, sg.k)) - spot.y) < spot.size / 2 + 6)) return null;
    return spot;
  };

  // Boxes of the value labels above and below bars. Annotation labels (reference line, forecast) avoid them (fixes "Goal 100" covering a value at 390px)
  const labelBoxes: Box[] = [];
  if (showValues && !horizontal && notes?.length && solo) {
    segs.forEach((sg, i) => {
      const { pos, th, a, b } = geom(sg);
      const tw = textWidth(valueText(sg), 11, 700);
      const at = valueSpot(sg, i, pos, th, a, b, tw);
      if (at) labelBoxes.push({ x: at.x - tw / 2 - 1, y: at.y - at.size / 2 - 1, w: tw + 2, h: at.size + 2 });
    });
  }

  const stg = c.motion.stagger ?? 60;
  const marks = useMemo<Mark<BarSeg>[]>(
    () =>
      segs.map((sg) => {
        const g = geom(sg);
        const base = v(Math.max(dom[0], Math.min(0, dom[1])));
        // In a diverging stack the middle series grows both ways from the zero line. Segments appear in order outward from the zero line
        const a0 = sg.ring === 0 ? v(0) : g.a;
        return { key: sg.key, to: [g.pos, g.th, g.a, g.b], from: [g.pos, g.th, layout === "grouped" ? base : a0, layout === "grouped" ? base : a0], enter: [g.pos, g.th, a0, a0], delay: sg.k * stg + (sg.ring ?? sg.s) * (layout === "grouped" ? 30 : 70), data: sg };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segs, W, H, dom[0], dom[1], stg, layout, horizontal],
  );
  const m = useMotion(marks, c.motion);

  // Line points: ordered after the bars, so the keyboard visits all bars before the lines
  const linePts = useMemo(() => {
    const out: { li: number; k: number; name: string; value: number; datum: T | null }[] = [];
    lineModel?.series.forEach((name, li) =>
      model.keys.forEach((key, k) => {
        const j = lineAt.get(key);
        if (j === undefined || !Number.isFinite(lineModel.values[li][j])) return;
        out.push({ li, k, name, value: lineModel.values[li][j], datum: lineModel.rows[li][j] as T | null });
      }),
    );
    return out;
  }, [lineModel, lineAt, model]);
  const events: ChartEvent<T>[] = segs.map((sg, i) => ({ datum: (model.rows[sg.s]?.[sg.k] as T) ?? null, index: i, key: sg.key, label: sg.cat, series: sg.series || undefined, value: sg.value, formatted: `${c.fv(sg.value)}${layout === "percent" || (diverging && props.percent) ? ` (${c.pct(Math.abs(sg.v1 - sg.v0))})` : ""}` }));
  linePts.forEach((pt, j) => events.push({ datum: pt.datum, index: segs.length + j, key: `${model.keys[pt.k]}|${pt.name}`, label: model.labels[pt.k], series: pt.name, value: pt.value, formatted: c.fv(pt.value) }));
  const segIndex = new Map(segs.map((sg, i) => [sg.key, i]));
  const syncKeys = useMemo(() => {
    const ks = [...segs, ...linePts].map((x) => x.k);
    return { keys: ks.map((k) => syncKeyOf(model.keys[k])), labels: ks.map((k) => model.labels[k]) };
  }, [segs, linePts, model]);
  useSync(c, props.syncId, syncKeys.keys, syncKeys.labels);
  // The active category. With several series, all bars in that category stay bright and other categories dim (the tooltip shows every series in the category too). Pointing at a line point also selects its category
  const activePt = c.active !== null && c.active >= segs.length ? linePts[c.active - segs.length] ?? null : null;
  const activeCat = c.active !== null ? activePt?.k ?? segs[c.active]?.k ?? null : null;

  let tip: TooltipData | null = null;
  if (lineModel && activeCat !== null) {
    // With lines, pointing at any layer shows that category's bar values and all line values (the pointed row in bold)
    const k = activeCat;
    const sg: BarSeg | undefined = segs[c.active ?? -1];
    const yName = typeof props.y === "string" ? props.y : c.t.value;
    const rows = [
      ...model.series.map((s, si) => ({ label: s || yName, value: Number.isFinite(model.values[si][k]) ? c.fv(model.values[si][k]) : "-", color: (single ? colors[k] : colors[si]).fill, strong: sg?.s === si })),
      ...lineModel.series.map((name, li) => ({ label: name, value: Number.isFinite(lineVal(li, k)) ? c.fv(lineVal(li, k)) : "-", color: lineInk(li), strong: activePt?.li === li })),
    ];
    const ys = [...segs.filter((x) => x.k === k).map((x) => Math.min(v(x.v0), v(x.v1))), ...lineModel.series.map((_, li) => v(lineVal(li, k))).filter(Number.isFinite)];
    tip = { x: mid(k), y: Math.min(...ys), title: model.labels[k], rows };
  } else if (c.active !== null && segs[c.active]) {
    const sg = segs[c.active];
    const g = geom(sg);
    const rows = nS > 1 ? model.series.map((s, si) => ({ label: s, value: Number.isFinite(model.values[si][sg.k]) ? c.fv(model.values[si][sg.k]) : "-", color: colors[si].fill, strong: si === sg.s })) : [{ label: c.t.value, value: c.fv(sg.value), color: sg.sw.fill }];
    tip = horizontal ? { x: Math.max(g.a, g.b), y: g.pos, title: sg.cat, rows } : { x: g.pos + g.th / 2, y: Math.min(g.a, g.b), title: sg.cat, rows };
  }

  const msg = MSG[c.lang];
  /** Start of a diverging stack row sentence: "Support: negative 46%, positive 32%" */
  const rowSides = (k: number) => (div ? `${model.labels[k]}: ${msg.sides(sideText(div.neg[k]), sideText(div.pos[k]))}` : "");
  const auto = `${msg.kind}. ${msg.desc(model.keys.length, nS, model.series.join(", "))}${lineModel ? msg.lines(lineModel.series) : ""}. ${div ? model.keys.map((_, k) => rowSides(k)).slice(0, 8).join("; ") : single ? model.labels.map((l, k) => `${l} ${c.fv(model.values[0][k])}`).slice(0, 8).join(", ") : ""}`;
  // A segment chosen by keyboard: read the row's two side totals first
  const activeSeg = div && c.via === "keyboard" && c.active !== null ? segs[c.active] : undefined;
  const announce = activeSeg ? `${rowSides(activeSeg.k)}. ${activeSeg.series ? `${activeSeg.series}: ` : ""}${events[c.active ?? 0].formatted} (${(c.active ?? 0) + 1}/${events.length})` : undefined;
  /** [low end, high end] values of diverging stack row k */
  const rowEnds = (k: number) => {
    const row = segs.filter((g) => g.k === k);
    return [Math.min(0, ...row.map((g) => Math.min(g.v0, g.v1))), Math.max(0, ...row.map((g) => Math.max(g.v0, g.v1)))];
  };
  const desc = props.description ?? (notes?.length ? `${auto.trimEnd().replace(/\.?$/, ".")}${describeAnnotations(notes, c.lang, c.fv)}` : auto);

  return (
    <ChartFrame c={c} kind={msg.kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} announce={announce} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      {horizontal ? (
        <g aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={Math.round(v(t)) + 0.5} x2={Math.round(v(t)) + 0.5} y1={top} y2={H - bottom} stroke={p.paint(t === 0 ? "dim" : "line")} />
              {showX ? (
                <Txt x={v(t)} y={H - bottom + 11} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
                  {tickFmt(t)}
                </Txt>
              ) : null}
            </g>
          ))}
        </g>
      ) : (
        <>
          {/* Diverging stack tick labels show magnitude only, so both sides read the same. GridY turns identical labels into signed numbers, so these labels are drawn separately */}
          <GridY p={p} ticks={ticks} y={v} x0={left} x1={W} fmt={tickFmt} locale={c.locale} labels={showY && !diverging} />
          {diverging && showY ? (
            <g aria-hidden="true">
              {ticks.map((t) => (
                <Txt key={t} x={left - 6} y={Math.round(v(t)) + 0.5} anchor="end" size={AXIS_FONT} fill={p.paint("muted")}>
                  {tickFmt(t)}
                </Txt>
              ))}
            </g>
          ) : null}
        </>
      )}
      <AnnotationsUnder list={notes} g={ag} />
      {m.items.map((it) => {
        const sg = it.data;
        const [pos, th, a, b] = it.v;
        const i = segIndex.get(sg.key) ?? 0;
        const neg = sg.v1 < sg.v0 || sg.value < 0;
        const stackedTop = layout === "grouped" || sg.s === nS - 1;
        // In a diverging stack only the segments at both ends of a row get rounded outer corners
        const corners = diverging ? { ...(sg.endLo && (horizontal ? { tl: r, bl: r } : { bl: r, br: r })), ...(sg.endHi && (horizontal ? { tr: r, br: r } : { tl: r, tr: r })) } : horizontal ? (stackedTop ? (neg ? { tl: r, bl: r } : { tr: r, br: r }) : {}) : stackedTop ? (neg ? { bl: r, br: r } : { tl: r, tr: r }) : {};
        const d = horizontal ? roundRectPath(Math.min(a, b), pos, Math.abs(b - a), th, corners) : roundRectPath(pos, Math.min(a, b), th, Math.abs(b - a), corners);
        const lo = m.fade(sg.k * stg + 320, 260);
        // Bars in the forecast range: faint fill and a dashed outline (stacked bars keep their dividers)
        const projected = fk >= 0 && sg.k >= fk;
        const outline = projected && solo;
        let label: ReactNode = null;
        // In a diverging stack the row-end totals are the value labels. In-segment labels appear only with several series, skipping the middle series (crossed by the zero line) and a segment alone on its side (same number as the total)
        const aloneOnSide = sg.ring === 1 && (sg.v1 < sg.v0 ? sg.endLo : sg.endHi);
        if (showValues && !(diverging && (!divLabels || solo || sg.ring === 0 || aloneOnSide))) {
          const text = valueText(sg);
          const tw = textWidth(text, 11, 700);
          const len = Math.abs(b - a);
          if (solo) {
            const at = horizontal ? null : valueSpot(sg, i, pos, th, a, b, tw);
            label = horizontal ? (
              <Txt x={Math.max(a, b) + 6} y={pos + th / 2} size={11} weight={sg.hi ? 800 : 500} fill={p.paint(sg.hi ? "ink" : "muted")} opacity={lo}>
                {text}
              </Txt>
            ) : at ? (
              <Txt x={at.x} y={at.y} anchor="middle" size={at.size} weight={sg.hi ? 800 : 500} fill={p.paint(sg.hi ? "ink" : "muted")} opacity={lo}>
                {text}
              </Txt>
            ) : null;
          } else if (len >= (horizontal ? tw + 10 : 16) && (horizontal ? th >= 14 : th >= tw + 6)) {
            label = (
              <Txt x={horizontal ? (a + b) / 2 : pos + th / 2} y={horizontal ? pos + th / 2 : (a + b) / 2} anchor="middle" size={11} weight={700} fill={sg.sw.text} opacity={lo}>
                {text}
              </Txt>
            );
          }
        }
        return (
          <g key={it.key} className="ztd-mark" opacity={it.exiting ? 0.4 : activeCat === null || activeCat === sg.k ? 1 : 0.38} onPointerEnter={(e) => c.setActive(i, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(i)} style={{ cursor: props.onClick ? "pointer" : undefined }}>
            {solo ? (
              // The whole band is the hover area even when the bar is 0 or very short (a 0 bar could not be hit if only the painted part counted)
              horizontal ? <rect x={x0} y={pos} width={Math.max(0, x1 - x0)} height={th} fill="transparent" /> : <rect x={pos} y={top} width={th} height={Math.max(0, H - bottom - top)} fill="transparent" />
            ) : null}
            <path d={d} fill={sg.sw.fill} fillOpacity={projected ? 0.42 : undefined} stroke={outline ? sg.sw.fill : solo ? "none" : p.paint("panel")} strokeWidth={outline ? 1.2 : 1} strokeDasharray={outline ? "3 2" : undefined} />
            {c.active === i && c.via === "keyboard" ? <path d={horizontal ? roundRectPath(Math.min(a, b) - 2, pos - 2, Math.abs(b - a) + 4, th + 4, 4) : roundRectPath(pos - 2, Math.min(a, b) - 2, th + 4, Math.abs(b - a) + 4, 4)} fill="none" stroke={p.paint("ink")} strokeWidth={2} /> : null}
            {label}
          </g>
        );
      })}
      {diverging ? (
        <g aria-hidden="true">
          {totals.map(([lo, hi], k) => {
            const [a, b] = rowEnds(k).map(v);
            const c0 = band(model.keys[k]) + band.bandwidth / 2;
            const op = m.fade(k * stg + 320, 260) * (activeCat === null || activeCat === k ? 1 : 0.38);
            const txt = (text: string | null, end: number, side: -1 | 1) =>
              text === null ? null : (
                <Txt key={side} x={horizontal ? end + side * 6 : c0} y={horizontal ? c0 : end - side * 8} anchor={horizontal ? (side < 0 ? "end" : "start") : "middle"} size={11} weight={600} fill={p.paint("ink")} opacity={op}>
                  {text}
                </Txt>
              );
            return (
              <g key={model.keys[k]}>
                {txt(lo, a, -1)}
                {txt(hi, b, 1)}
              </g>
            );
          })}
          {horizontal ? <line x1={Math.round(v(0)) + 0.5} x2={Math.round(v(0)) + 0.5} y1={top} y2={H - bottom} stroke={p.paint("ink")} strokeWidth={1.5} /> : <line x1={x0} x2={W} y1={Math.round(v(0)) + 0.5} y2={Math.round(v(0)) + 0.5} stroke={p.paint("ink")} strokeWidth={1.5} />}
        </g>
      ) : null}
      {lineModel ? (
        // Lines appear after the bars finish growing. The first line is in the accent color, the rest gray. They break at missing values, and an isolated point is drawn as a point only
        <g opacity={m.fade((model.keys.length - 1) * stg + 320, 320)}>
          {lineModel.series.map((name, li) => (
            <path key={name} d={lineRuns(model.keys.map((_, k) => [mid(k), v(lineVal(li, k))]))} fill="none" stroke={lineInk(li)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {linePts.map((pt, j) => {
            const i = segs.length + j;
            const x = mid(pt.k);
            const y = v(pt.value);
            return (
              <g key={`${model.keys[pt.k]}|${pt.name}`} className="ztd-mark" onPointerEnter={(e) => c.setActive(i, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(i)} style={{ cursor: props.onClick ? "pointer" : undefined }}>
                <circle cx={x} cy={y} r={9} fill="transparent" />
                <circle cx={x} cy={y} r={c.active === i ? 4.5 : 3} fill={lineInk(pt.li)} stroke={p.paint("panel")} strokeWidth={1.5} />
                {c.active === i && c.via === "keyboard" ? <circle cx={x} cy={y} r={8} fill="none" stroke={p.paint("ink")} strokeWidth={2} /> : null}
              </g>
            );
          })}
        </g>
      ) : null}
      <AnnotationsOver list={notes} g={{ ...ag, avoid: labelBoxes }} />
      {horizontal && showY ? (
        <g aria-hidden="true">
          {model.keys.map((key, k) => {
            const strong = single && hi.has(k);
            return (
              <Txt key={key} x={catW} y={band(key) + band.bandwidth / 2} anchor="end" size={11.5} weight={strong ? 800 : 500} fill={p.paint(strong ? "ink" : "muted")}>
                {truncate(model.labels[k], catW - 4, 11.5, strong ? 800 : 500)}
              </Txt>
            );
          })}
        </g>
      ) : null}
      {!horizontal && showX ? <AxisXBand p={p} width={W} labels={model.labels} centers={model.keys.map((key) => band(key) + band.bandwidth / 2)} y={H - bottom + 13} strong={single ? hi : undefined} /> : null}
      {!horizontal && activeCat !== null ? <AxisPill p={p} x={band(model.keys[activeCat]) + band.bandwidth / 2} y={H - bottom + 13} label={model.labels[activeCat]} width={W} /> : null}
    </ChartFrame>
  );
}

/** A polyline that breaks at missing values (NaN). An isolated point is drawn as a point without a line */
function lineRuns(pts: [number, number][]): string {
  const ys = pts.map((pt) => pt[1]);
  return bandRuns(ys, ys)
    .map(([a, b]) => polyline(pts.slice(a, b + 1)))
    .join("");
}

/** Color of the lines over bars: the first line in the accent color, the rest gray (the card legend follows the same rule) */
export const lineToken = (i: number) => (i ? "neutralStrong" : "accent");
