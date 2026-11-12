import { useMemo, useState, type ComponentType } from "react";
import { ChartCard, ChartState, Legend, type LegendItem } from "../components/ChartCard";
import { ChartFacets, type ChartFacetsProps } from "../components/ChartFacets";
import type { FacetType } from "../core/facet";
import { resolveHighlight } from "../core/highlight";
import { langOf } from "../core/i18n";
import { categorical, categoricalDots, legendColors } from "../core/palette";
import { prepSeries, type Aggregate, type XType } from "../core/series";
import type { ChartEvent, Highlight } from "../core/types";
import { strGetter, uniq, numGetter } from "../data/accessor";
import { useChartData } from "../data/useChartData";
import { DownloadButtons } from "../components/download";
import { templateTooltip } from "./tooltipTemplate";
import { barLineFields, downloadFields, FACET_TYPES, hexBinned, legendToggles, nameIn, resolveMeta, specLocale, specTemplate, TOGGLES, type ChartMeta } from "../spec/meta";
import type { ChartSpec, SpecFacet } from "../spec/types";
import { inlineRows } from "../spec/validate";
import { ThemeProvider, useChartLocale, type Painter, type ThemeInput } from "../theme/context";
import { AreaChart, LineChart, lineSwatches } from "./line";
import { BarChart, lineToken } from "./bar";
import { BarRace } from "./barRace";
import { divergingLead } from "../layout/stack";
import { BeeswarmChart } from "./beeswarm";
import { BoxPlot } from "./box";
import { BubbleChart, ScatterChart } from "./bubble";
import { seriesHighlight } from "./scatter-kit";
import { BulletChart } from "./bullet";
import { BumpChart } from "./bump";
import { CalendarHeatmap } from "./calendar";
import { CANDLE_TEXT, CandlestickChart, MA_TOKENS, maPeriods } from "./candlestick";
import { ChordChart } from "./chord";
import { Choropleth } from "./choropleth";
import { FlowMap } from "./flowMap";
import { DumbbellChart } from "./dumbbell";
import { FunnelChart } from "./funnel";
import { Heatmap } from "./heatmap";
import { HistogramChart } from "./histogram";
import { LollipopChart } from "./lollipop";
import { MarimekkoChart } from "./marimekko";
import { ParallelCoordinates } from "./parallel";
import { ParetoChart } from "./pareto";
import { DonutChart, groupOther, otherLabel, PieChart, sliceSwatches, sliceValue } from "./pie";
import { GaugeChart, RadialBarChart } from "./radial";
import { RadarChart } from "./radar";
import { RidgelineChart } from "./ridgeline";
import { SankeyChart } from "./sankey";
import { SegmentedBar } from "./segmented";
import { SkylineChart } from "./skyline";
import { SlopeChart } from "./slope";
import { Sparkline } from "./sparkline";
import { StreamGraph, streamHighlight, streamOrder, streamSwatches } from "./stream";
import { SunburstChart } from "./sunburst";
import { SymbolMap } from "./symbolMap";
import { TileMap } from "./tileMap";
import { NetworkChart } from "./network";
import { groupNames, networkSwatches } from "../layout/network";
import { Timeline, timelineGroupHighlight } from "./timeline";
import { timelineGroups } from "../layout/timeline";
import { Tree } from "./tree";
import { Treemap } from "./treemap";
import { WaffleChart } from "./waffle";
import { WaterfallChart } from "./waterfall";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CHART_COMPONENTS: Record<string, ComponentType<any>> = {
  pie: PieChart,
  donut: DonutChart,
  funnel: FunnelChart,
  waffle: WaffleChart,
  treemap: Treemap,
  sunburst: SunburstChart,
  waterfall: WaterfallChart,
  pareto: ParetoChart,
  marimekko: MarimekkoChart,
  heatmap: Heatmap,
  radar: RadarChart,
  bubble: BubbleChart,
  line: LineChart,
  area: AreaChart,
  stream: StreamGraph,
  bar: BarChart,
  radialBar: RadialBarChart,
  gauge: GaugeChart,
  bullet: BulletChart,
  sparkline: Sparkline,
  slope: SlopeChart,
  dumbbell: DumbbellChart,
  lollipop: LollipopChart,
  beeswarm: BeeswarmChart,
  ridgeline: RidgelineChart,
  sankey: SankeyChart,
  chord: ChordChart,
  calendar: CalendarHeatmap,
  bump: BumpChart,
  box: BoxPlot,
  parallel: ParallelCoordinates,
  candlestick: CandlestickChart,
  segmented: SegmentedBar,
  skyline: SkylineChart,
  histogram: HistogramChart,
  scatter: ScatterChart,
  tileMap: TileMap,
  barRace: BarRace,
  network: NetworkChart,
  timeline: Timeline,
  tree: Tree,
  choropleth: Choropleth,
  symbolMap: SymbolMap,
  flowMap: FlowMap,
};

/**
 * Look up channels and name by type or alias (without pulling in the whole registry).
 * Up to 0.4, scatter was an alias of bubble. A scatter spec with a size channel is still drawn as bubble, as it was then. Hexbin density (bin "hex") uses no size, so it stays a scatter plot
 */
export function resolveDef(type: string, encoding?: ChartSpec["encoding"], options?: ChartSpec["options"]): ChartMeta | undefined {
  const def = resolveMeta(type);
  return def?.type === "scatter" && encoding?.size !== undefined && !hexBinned(options) ? resolveMeta("bubble") : def;
}

/** Turn encoding (channel -> field) into component props */
export function encodingToProps(def: Pick<ChartMeta, "encoding">, encoding: ChartSpec["encoding"] = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of def.encoding) {
    const v = encoding[c.name];
    if (v !== undefined) out[c.prop ?? c.name] = v;
  }
  return out;
}

/**
 * Build a legend from the spec (card.legend: "auto"). locale is the locale the chart is drawn in; the candlestick legend text uses it.
 * Series in options.hidden are left out. With withHidden, every series is listed, hidden ones included (the toggle legend)
 */
export function autoLegend(spec: ChartSpec, rows: Record<string, unknown>[], locale: string, withHidden = false): LegendItem[] {
  const def = resolveDef(spec.type, spec.encoding, spec.options);
  if (!def || !rows.length) return [];
  const enc = spec.encoding ?? {};
  const opt = spec.options ?? {};
  const h = opt.highlight as Highlight | undefined;
  // Hidden series are left out of the legend only (colors are set from all series)
  const off = new Set(!withHidden && TOGGLES.includes(def.type) && Array.isArray(opt.hidden) ? opt.hidden.map(String) : []);
  const shown = (items: LegendItem[]) => items.filter((it) => !off.has(it.label));
  const perItem = ["pie", "donut", "waffle"];
  // A donut draws its own legend with shares (right or below). Adding the card legend would show the legend twice
  if (def.type === "donut" && opt.legend !== "none") return [];
  if (perItem.includes(def.type)) {
    const gl = strGetter(enc.label as string | undefined, "label");
    const gv = numGetter(enc.value as string | undefined, "value");
    const isWaffle = def.type === "waffle";
    const items = rows.map((r, i) => ({ r, label: gl(r, i), value: isWaffle ? gv(r, i) : sliceValue(gv(r, i)) }));
    // Pie and donut group "Other" by the same rule as the chart, and Other is never highlighted
    const { kept, other } = isWaffle ? { kept: items, other: null } : groupOther(items, opt.other as number | undefined, (n, value) => ({ r: {}, label: otherLabel(langOf(locale), n), value }));
    const hi = resolveHighlight(h, kept.map((x) => x.r), kept.map((x) => x.label), kept.map((x) => x.value), isWaffle ? "first" : "max");
    const all = other ? [...kept, other] : kept;
    // The same color function the chart paints with (categorical for waffle, by colorMode for pie and donut)
    const tokens = legendColors((p) => (isWaffle ? categorical(p, all.length, hi) : sliceSwatches(p, all.length, hi, opt.colorMode as "categorical" | "emphasis" | undefined)));
    // A half-circle waffle (parliament chart) is made of dots, so its legend uses circles too
    const dot = isWaffle && opt.shape === "arc";
    return all.map((x, i) => ({ label: x.label, color: tokens[i], ...(dot && { shape: "circle" as const }) }));
  }
  if (def.type === "candlestick") {
    // Only the moving averages the chart draws (periods longer than the row count are left out)
    const ma = maPeriods(Array.isArray(opt.ma) ? (opt.ma as number[]) : undefined, rows.length);
    const t = CANDLE_TEXT[langOf(locale)];
    return [{ label: t.up, color: (opt.upColor as string | undefined) ?? "accent" }, { label: t.down, color: (opt.downColor as string | undefined) ?? "neutralStrong" }, ...ma.map((d, i) => ({ label: t.maLegend(d), color: MA_TOKENS[i], shape: "line" as const }))];
  }
  if (def.type === "network") {
    // The same group color function the chart paints with (networkSwatches). Highlighted nodes use the accent color, so they stay out of the legend
    const groups = groupNames(opt.groups);
    if (groups.length < 2) return [];
    const tokens = legendColors((p) => networkSwatches(p, groups.length));
    return groups.map((g, i) => ({ label: g, color: tokens[i], shape: "circle" as const }));
  }
  if (def.type === "symbolMap") {
    // Group colors of the symbol map: in data order like the chart, categoricalDots without highlight
    if (typeof enc.group !== "string") return [];
    const g = strGetter(enc.group, "group");
    const groups = uniq(rows.map((r, i) => g(r, i)).filter(Boolean));
    if (groups.length < 2) return [];
    const tokens = legendColors((p) => categoricalDots(p, groups.length, new Set()));
    return groups.map((s, i) => ({ label: s, color: tokens[i], shape: "circle" as const }));
  }
  if (def.type === "scatter") {
    // Hexbin density uses no series. Its color legend is inside the chart
    if (typeof enc.series !== "string" || hexBinned(opt)) return [];
    const g = strGetter(enc.series, "series");
    const series = uniq(rows.map((r, i) => g(r, i)));
    if (series.length < 2) return [];
    // Same rule as the chart: colors are set from all series, hidden ones included, and hidden series are left out of the legend only
    const dotHi = seriesHighlight(h, rows, series, g);
    const tokens = legendColors((p) => categoricalDots(p, series.length, dotHi));
    return shown(series.map((s, i) => ({ label: s, color: tokens[i], shape: "circle" as const })));
  }
  if (def.type === "timeline") {
    // One item per group, or per status when there is no group (the bars or the status strip show those colors). Same values, color function (categorical) and highlight (by name) as the chart
    const byStatus = typeof enc.group !== "string";
    const field = byStatus ? enc.status : enc.group;
    if (typeof field !== "string") return [];
    const groups = timelineGroups(rows, field, byStatus);
    const tokens = legendColors((p) => categorical(p, groups.length, timelineGroupHighlight(h as Highlight<never>, groups)));
    return shown(groups.map((s, i) => ({ label: s, color: tokens[i], shape: "square" as const })));
  }
  if (["marimekko", "area", "bar", "line", "stream", "radar"].includes(def.type)) {
    let series: string[] = [];
    if (Array.isArray(enc.y)) series = enc.y as string[];
    else if (typeof enc.series === "string") {
      const g = strGetter(enc.series, "series");
      series = uniq(rows.map((r, i) => g(r, i)));
    }
    // Lines over bars: list the bars (not highlighted when there is no highlight) together with the lines (first line in the accent color, the rest gray)
    const lines = barLineFields(def.type, enc, opt);
    if (lines.length) {
      const barHi = resolveHighlight(h as never, series as never[], series, series.map(() => 0), "none");
      const tokens = legendColors((p) => categorical(p, series.length, barHi));
      const bars = series.length < 2 ? [{ label: String((Array.isArray(enc.y) ? enc.y[0] : enc.y) ?? "y"), color: "neutral" }] : series.map((s, i) => ({ label: s, color: tokens[i] }));
      return [...shown(bars), ...lines.map((label, i) => ({ label, color: lineToken(i), shape: "line" as const }))];
    }
    if (series.length < 2) return [];
    // Diverging bars use the same default highlight as the chart (the outermost positive series)
    const diverging = def.type === "bar" && opt.layout === "diverging";
    const lead = diverging && h === undefined ? divergingLead(series.length, Array.isArray(opt.negative) ? opt.negative.map((n) => series.indexOf(String(n))) : [], typeof opt.neutral === "string" ? series.indexOf(opt.neutral) : -1) : -1;
    const hi = lead >= 0 ? new Set([lead]) : resolveHighlight(h as never, series as never[], series, series.map(() => 0), "first");
    // Radar draws only the highlighted series as an accent fill, the rest as neutralStrong outlines
    if (def.type === "radar") return shown(series.map((s, i) => ({ label: s, color: hi.has(i) ? "accent" : "neutralStrong", shape: "square" as const })));
    // Legend colors come from the same color function the chart paints with (blended in-between steps included): lineSwatches for line and area, the same layer order and default highlight (the series with the largest total) for stream, categorical for bar and marimekko
    const cm = opt.colorMode as "highlight" | "categorical" | undefined;
    let draw = (p: Painter) => categorical(p, series.length, hi);
    if (def.type === "line" || def.type === "area") draw = (p) => lineSwatches(p, series.length, hi, def.type === "area", cm);
    if (def.type === "stream") {
      const m = prepSeries(rows, enc.x as string | undefined, enc.y as never, enc.series as string | undefined, { xType: opt.xType as XType | undefined, locale, aggregate: opt.aggregate as Aggregate | undefined, dayFirst: opt.dayFirst as boolean | undefined });
      const order = streamOrder(m.values, opt.reorder as boolean | undefined);
      const sh = streamHighlight(h, m.series, m.values);
      draw = (p) => streamSwatches(p, order, sh);
    }
    const tokens = legendColors(draw);
    return shown(series.map((s, i) => ({ label: s, color: tokens[i], ...(def.type === "line" && { shape: "line" as const }) })));
  }
  return [];
}

/** The spec's facet when it can be drawn (line, area, bar, scatter; diverging bars excluded). Otherwise undefined, and a single chart is drawn as before */
export function specFacet(spec: Pick<ChartSpec, "facet" | "options">, type: string): SpecFacet | undefined {
  const f = spec.facet;
  return f && typeof f === "object" && typeof f.by === "string" && FACET_TYPES.includes(type) && !(type === "bar" && spec.options?.layout === "diverging") ? f : undefined;
}

/** <ChartFacets> props from the spec facet and the chart props (built by Chart). Size, highlight, group, title and description are left out so each panel sets its own. Shared by <Chart> and the server SVG */
export function facetPropsOf(type: string, facet: SpecFacet, chartProps: Record<string, unknown>): Omit<ChartFacetsProps, "chart"> {
  const { data, width, height, highlight, syncId, ariaLabel, description, ...rest } = chartProps;
  return {
    type: type as FacetType,
    data: (data ?? []) as Record<string, unknown>[],
    by: facet.by,
    columns: facet.columns,
    scale: facet.scale,
    chartProps: rest,
    width: width as number | undefined,
    height: height as number | undefined,
    highlight: highlight as Highlight,
    syncId: syncId as string | undefined,
    title: ariaLabel as string | undefined,
    description: description as string | undefined,
  };
}

export interface ChartProps {
  spec: ChartSpec;
  /** Takes precedence over the spec options */
  width?: number;
  height?: number;
  animate?: boolean;
  replayKey?: string | number;
  theme?: ThemeInput;
  className?: string;
  onHover?: (e: ChartEvent<Record<string, unknown>> | null) => void;
  onClick?: (e: ChartEvent<Record<string, unknown>>) => void;
  /** fetch options used when loading data from a URL (auth headers, etc.) */
  fetchInit?: RequestInit;
  /** Locale of the chart and card. Takes precedence over the spec's options.locale; without it, ThemeProvider, then "en-US" */
  locale?: string;
}

/** Draws a chart (and its card) from a single JSON spec */
export function Chart(props: ChartProps) {
  return useSpecChart(props, CHART_COMPONENTS);
}

/**
 * The body of Chart. It takes a table of components to draw with; interactive HTML draws the same spec with a table that holds only one chart (hydrating the server render).
 * Call it as a function, not wrapped in a component: an extra wrapping layer changes the inner chart's useId values, so they no longer match the server render
 */
export function useSpecChart(props: ChartProps, components: typeof CHART_COMPONENTS) {
  const { spec } = props;
  const def = resolveDef(spec.type, spec.encoding, spec.options);
  // { csv } is not parsed again on every render
  const inline = useMemo(() => inlineRows(spec.data), [spec.data]);
  const remote = !inline && spec.data && typeof spec.data === "object" && "url" in spec.data ? (spec.data as { url: string; format?: "json" | "csv" | "auto"; select?: string }) : null;
  // Prop first, then the spec's options.locale. Without both, the card and chart follow ThemeProvider
  const explicit = specLocale(spec, props.locale);
  const locale = useChartLocale(explicit);
  const lang = langOf(locale);
  const st = useChartData(remote?.url ?? null, { parse: remote?.format ?? "auto", select: remote?.select, init: props.fetchInit, locale });
  // Spec tooltip template (options.tooltip.template): the tooltip can use the row's other columns too. It is a hook, so it sits before any early return
  const template = specTemplate(spec);
  const tooltip = useMemo(() => (template ? templateTooltip(template, locale) : undefined), [template, locale]);
  // Series the viewer hid in the toggle legend (card.legend "toggle"). It starts as options.hidden and resets to it only when the spec's hidden changes
  // (it stays put even when each render brings a new spec object). It is a hook, so it sits before any early return
  const optHidden = spec.options?.hidden;
  const specHidden = Array.isArray(optHidden) ? optHidden.map(String) : [];
  const hiddenKey = specHidden.join("\u0001");
  const [viewer, setViewer] = useState<{ base: string; hidden: string[] } | null>(null);
  if (!def) {
    return <ChartState error={lang === "ko" ? `알 수 없는 차트 종류: ${spec.type}` : `Unknown chart type: ${spec.type}`} height={props.height ?? 200} locale={explicit} />;
  }
  const rows = inline ?? st.data;
  const Comp = components[def.type];
  const options = { ...(spec.options ?? {}) };
  const chartProps: Record<string, unknown> = {
    ...encodingToProps(def, spec.encoding),
    ...options,
    ...(tooltip ? { tooltip } : {}),
    data: rows,
    ...(props.width !== undefined ? { width: props.width } : {}),
    ...(props.height !== undefined ? { height: props.height } : {}),
    ...(props.animate !== undefined ? { animate: props.animate } : {}),
    ...(props.replayKey !== undefined ? { replayKey: props.replayKey } : {}),
    ...(props.onHover ? { onHover: props.onHover } : {}),
    ...(props.onClick ? { onClick: props.onClick } : {}),
    // The normalized value ("ko_KR" → "ko-KR"), prop first, then options.locale. Without both, it follows ThemeProvider
    locale: explicit,
  };
  // Toggle only when every legend item is a series that can be hidden (with lines over bars, it is a plain legend)
  const toggle = spec.card?.legend === "toggle" && legendToggles(def.type, spec.encoding ?? {}, options);
  const hidden = viewer && viewer.base === hiddenKey ? viewer.hidden : specHidden;
  if (toggle) chartProps.hidden = hidden;
  const onToggle = (label: string) =>
    setViewer((v) => {
      const cur = v && v.base === hiddenKey ? v.hidden : specHidden;
      return { base: hiddenKey, hidden: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] };
    });
  const h = (chartProps.height as number | undefined) ?? 220;
  // While reloading with data already in hand (refreshMs), keep the chart as is. If a reload fails once, the chart still shows as long as there is earlier data
  // Small multiples (spec.facet): the same chart once per by value, one cell each. Without facet, a single chart as before
  const facet = specFacet(spec, def.type);
  let body =
    remote && !rows.length && (st.loading || st.error || st.empty) ? (
      <ChartState loading={st.loading} error={st.error} empty={st.empty} onRetry={st.reload} height={h} locale={explicit} />
    ) : facet ? (
      <ChartFacets chart={Comp} {...facetPropsOf(def.type, facet, chartProps)} />
    ) : (
      <Comp {...chartProps} />
    );
  if (spec.card) {
    const c = spec.card;
    const items = c.legend === "auto" || c.legend === "toggle" ? autoLegend(spec, rows, locale, toggle) : c.legend;
    const legend = !items?.length ? undefined : toggle ? <Legend items={items} hidden={hidden} onToggle={onToggle} locale={explicit} /> : items;
    // The download CSV has only the columns the chart draws (other columns the page passed are left out)
    const download = c.download ? <DownloadButtons data={rows} columns={downloadFields(spec)} filename={c.title ?? def.type} formats={Array.isArray(c.download) ? c.download : undefined} locale={explicit} /> : undefined;
    body = (
      <ChartCard number={c.number} title={c.title ?? nameIn(def, lang)} subtitle={c.subtitle} legend={legend} actions={download} source={c.source || undefined} note={c.note || undefined} accent={c.accent} takeaway={c.takeaway} level={c.level} sample={c.sample} replay={c.replay !== false} className={props.className} locale={explicit}>
        {body}
      </ChartCard>
    );
  }
  const theme = props.theme ?? (spec.theme as ThemeInput | undefined);
  if (theme) body = <ThemeProvider theme={theme}>{body}</ThemeProvider>;
  return body;
}
