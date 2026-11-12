import type { ChannelDef, ChartSpec, Lang } from "./types";

/**
 * Encoding channels per chart. <Chart spec> uses only this small module instead of the registry (which includes the sample data).
 */
/* @__NO_SIDE_EFFECTS__ */
const ch = (name: string, type: ChannelDef["type"], required: boolean, description: string, extra: Partial<ChannelDef> = {}): ChannelDef => ({ name, type, required, description, ...extra });

const LABEL = ch("label", "string", true, "Item name field");
const VALUE = ch("value", "number", true, "Value field");

const CH_pie: ChannelDef[] = [LABEL, VALUE];
const CH_donut: ChannelDef[] = [LABEL, VALUE];
const CH_funnel: ChannelDef[] = [ch("label", "string", true, "Stage name"), ch("value", "number", true, "Users at the stage")];
const CH_waffle: ChannelDef[] = [LABEL, VALUE];
const CH_treemap: ChannelDef[] = [ch("label", "string", true, "Leaf (lowest level) name"), VALUE, ch("group", "string", false, "Parent group field")];
const CH_sunburst: ChannelDef[] = [ch("label", "string", true, "Leaf name"), VALUE, ch("group", "string", false, "Parent group field")];
const CH_waterfall: ChannelDef[] = [LABEL, ch("value", "number", true, "Change (total rows may omit it)"), ch("type", "string", false, '"total" makes a total bar')];
const CH_pareto: ChannelDef[] = [LABEL, VALUE];
const CH_marimekko: ChannelDef[] = [ch("x", "string", true, "Column field"), ch("series", "string", true, "Stacked series field"), VALUE];
const CH_heatmap: ChannelDef[] = [ch("x", "string", true, "Column field"), ch("y", "string", true, "Row field"), VALUE];
const CH_radar: ChannelDef[] = [ch("axis", "string", true, "Metric (axis) field"), ch("value", "number", true, "Value field", { multi: true }), ch("series", "string", false, "Series field")];
const CH_bubble: ChannelDef[] = [ch("x", "number", true, "x value"), ch("y", "number", true, "y value"), ch("size", "number", false, "Circle size"), ch("label", "string", false, "Name")];
/** Range band (line, area): an array in the same order as y for a wide table, one field for a long table */
const UPPER = ch("upper", "number", false, "Upper bound of the range band. Same shape as lower", { multi: true });
const CH_line: ChannelDef[] = [ch("x", "any", true, "x field (date, number or category)"), ch("y", "number", true, "y field. An array for wide tables", { multi: true }), ch("series", "string", false, "Series field (long tables)"), ch("lower", "number", false, "Lower bound of the range band. In wide tables an array in the order of y", { multi: true }), UPPER];
const CH_area: ChannelDef[] = [ch("x", "any", true, "x field"), ch("y", "number", true, "y field. An array for wide tables", { multi: true }), ch("series", "string", false, "Series field"), ch("lower", "number", false, 'Lower bound of the range band, with stack "none" only. In wide tables an array in the order of y', { multi: true }), UPPER];
const CH_stream: ChannelDef[] = [ch("x", "any", true, "x field"), ch("y", "number", true, "y field", { multi: true }), ch("series", "string", false, "Series field")];
const CH_bar: ChannelDef[] = [ch("x", "string", true, "Category field"), ch("y", "number", true, "Value field. An array for wide tables", { multi: true }), ch("series", "string", false, "Series field"), ch("line", "number", false, "Lines over vertical bars on the same axis, such as a target or last year. An array for several. Bars stay gray unless highlight is set, and with series the line averages rows of the same x", { multi: true })];
const CH_radialBar: ChannelDef[] = [LABEL, VALUE];
const CH_gauge: ChannelDef[] = [ch("value", "number", true, "Value field", { prop: "valueKey" }), ch("target", "number", false, "Target field", { prop: "targetKey" })];
const CH_bullet: ChannelDef[] = [LABEL, ch("value", "number", true, "Actual value field"), ch("target", "number", false, "Target field")];
const CH_sparkline: ChannelDef[] = [ch("x", "any", false, "x field"), ch("y", "number", true, "y field")];
const CH_slope: ChannelDef[] = [LABEL, ch("x", "string", false, "Period field (long tables)"), ch("value", "number", false, "Value field (long tables)")];
const CH_dumbbell: ChannelDef[] = [LABEL, ch("start", "number", true, "Before value"), ch("end", "number", true, "After value")];
const CH_lollipop: ChannelDef[] = [LABEL, VALUE];
const CH_beeswarm: ChannelDef[] = [ch("value", "number", true, "Value field"), ch("group", "string", false, "Group (row) field"), ch("label", "string", false, "Dot name")];
const CH_ridgeline: ChannelDef[] = [ch("group", "string", true, "Group field"), ch("value", "number", true, "Value field")];
const CH_sankey: ChannelDef[] = [ch("source", "string", true, "Source node"), ch("target", "string", true, "Target node"), VALUE];
const CH_chord: ChannelDef[] = [ch("source", "string", true, "Sending group"), ch("target", "string", true, "Receiving group"), VALUE];
const CH_calendar: ChannelDef[] = [ch("date", "date", true, "Date field"), VALUE];
const CH_bump: ChannelDef[] = [ch("x", "any", true, "Period field"), ch("series", "string", true, "Item field"), ch("rank", "number", false, "Rank field (1 is first)"), ch("value", "number", false, "Value field (instead of rank, largest is first)")];
const CH_box: ChannelDef[] = [ch("group", "string", true, "Group field"), ch("value", "number", true, "Value field")];
const CH_parallel: ChannelDef[] = [ch("label", "string", false, "Row name field")];
const CH_candlestick: ChannelDef[] = [ch("x", "date", true, "Date (period) field"), ch("open", "number", true, "Open price field"), ch("high", "number", true, "High price field"), ch("low", "number", true, "Low price field"), ch("close", "number", true, "Close price field"), ch("volume", "number", false, "Volume field")];
const CH_segmented: ChannelDef[] = [LABEL, VALUE];
const CH_skyline: ChannelDef[] = [
  ch("x", "any", true, "Period field (date or category)"),
  ch("y", "number", true, "Back row fields stacked into each block. An array for wide tables", { multi: true }),
  ch("series", "string", false, "Series field (long tables, back row only)"),
  ch("front", "number", false, "Front row fields: a smaller outcome in the same unit as y (wide tables only)", { multi: true }),
];
const CH_histogram: ChannelDef[] = [ch("value", "number", false, "Sample value field (raw rows)"), ch("group", "string", false, "Group field. Up to 2 groups overlap"), ch("x0", "number", false, "Bin start (pre-binned rows)"), ch("x1", "number", false, "Bin end (pre-binned rows)"), ch("count", "number", false, "Samples in the bin (pre-binned rows)")];
const CH_tileMap: ChannelDef[] = [ch("region", "string", true, "Region name or code, matched to a tile of options.map"), VALUE];
const CH_barRace: ChannelDef[] = [LABEL, VALUE, ch("frame", "any", true, "Time step field: a year, a date or any ordered key. Numbers and dates play in order, other text in the order it first appears. An item with no value in a step leaves the bars for that step")];
const CH_network: ChannelDef[] = [ch("source", "string", true, "Source node"), ch("target", "string", true, "Target node"), ch("value", "number", false, "Link weight. Without it every row counts 1")];
const CH_timeline: ChannelDef[] = [ch("label", "string", true, "Row name. Items with the same name share a row"), ch("start", "any", true, "Start: a number (minutes, seconds, any unit) or a date or date-time"), ch("end", "any", true, "End, same kind as start. Equal to start draws a point event; empty means still open"), ch("group", "string", false, "Group field (one color per group, and the legend)"), ch("status", "string", false, "State of the item, written inside the bar and in the tooltip. Without group it also colors the bars and makes the legend, so a row of consecutive states reads as a status strip")];
const CH_tree: ChannelDef[] = [
  ch("label", "string", true, "Node name field"),
  ch("value", "number", false, "Value field. Sizes the dots; values add up from the leaves"),
  ch("group", "string", false, "Parent group field (flat rows, as in the treemap)"),
  ch("id", "string", false, "Row id for id/parent rows. Defaults to the label"),
  ch("parent", "string", false, "Parent id field. Each row is one node, and rows with an empty parent hang under the root"),
];
const CH_choropleth: ChannelDef[] = [ch("region", "string", true, "Region name or code, matched to a region of options.map"), VALUE];
const CH_symbolMap: ChannelDef[] = [
  ch("lon", "number", false, "Longitude (degrees)"),
  ch("lat", "number", false, "Latitude (degrees)"),
  ch("size", "number", false, "Value (circle area). Without it all circles match"),
  ch("label", "string", false, "Place name"),
  ch("region", "string", false, "Region of options.map, for rows without lon and lat"),
  ch("group", "string", false, "Group field (one color per group)"),
];
const CH_flowMap: ChannelDef[] = [ch("source", "string", true, "Start: a name in options.places or a region"), ch("target", "string", true, "End"), ch("value", "number", false, "Amount. Without it each row counts 1")];
const CH_scatter: ChannelDef[] = [ch("x", "number", true, "x value"), ch("y", "number", true, "y value"), ch("series", "string", false, "Series field (one color per series)"), ch("label", "string", false, "Name")];

export const CHANNELS: Record<string, ChannelDef[]> = {
  pie: CH_pie,
  donut: CH_donut,
  funnel: CH_funnel,
  waffle: CH_waffle,
  treemap: CH_treemap,
  sunburst: CH_sunburst,
  waterfall: CH_waterfall,
  pareto: CH_pareto,
  marimekko: CH_marimekko,
  heatmap: CH_heatmap,
  radar: CH_radar,
  bubble: CH_bubble,
  line: CH_line,
  area: CH_area,
  stream: CH_stream,
  bar: CH_bar,
  radialBar: CH_radialBar,
  gauge: CH_gauge,
  bullet: CH_bullet,
  sparkline: CH_sparkline,
  slope: CH_slope,
  dumbbell: CH_dumbbell,
  lollipop: CH_lollipop,
  beeswarm: CH_beeswarm,
  ridgeline: CH_ridgeline,
  sankey: CH_sankey,
  chord: CH_chord,
  calendar: CH_calendar,
  bump: CH_bump,
  box: CH_box,
  parallel: CH_parallel,
  candlestick: CH_candlestick,
  segmented: CH_segmented,
  skyline: CH_skyline,
  histogram: CH_histogram,
  scatter: CH_scatter,
  tileMap: CH_tileMap,
  barRace: CH_barRace,
  network: CH_network,
  timeline: CH_timeline,
  tree: CH_tree,
  choropleth: CH_choropleth,
  symbolMap: CH_symbolMap,
  flowMap: CH_flowMap,
};

/** Type -> component name, English name, Korean name. Korean names live only here (shared by localizeDef and the Korean validation messages) */
export const META: Record<string, { component: string; name: string; nameKo: string }> = {
  pie: { component: "PieChart", name: "Pie chart", nameKo: "파이 차트" },
  donut: { component: "DonutChart", name: "Donut chart", nameKo: "도넛 차트" },
  funnel: { component: "FunnelChart", name: "Funnel chart", nameKo: "퍼널 차트" },
  waffle: { component: "WaffleChart", name: "Waffle chart", nameKo: "와플 차트" },
  treemap: { component: "Treemap", name: "Treemap", nameKo: "트리맵" },
  sunburst: { component: "SunburstChart", name: "Sunburst", nameKo: "선버스트" },
  waterfall: { component: "WaterfallChart", name: "Waterfall chart", nameKo: "폭포 차트" },
  pareto: { component: "ParetoChart", name: "Pareto chart", nameKo: "파레토 차트" },
  marimekko: { component: "MarimekkoChart", name: "Marimekko chart", nameKo: "마리메코 차트" },
  heatmap: { component: "Heatmap", name: "Heatmap", nameKo: "히트맵" },
  radar: { component: "RadarChart", name: "Radar chart", nameKo: "레이더 차트" },
  bubble: { component: "BubbleChart", name: "Bubble chart", nameKo: "버블 차트" },
  line: { component: "LineChart", name: "Line chart", nameKo: "라인 차트" },
  area: { component: "AreaChart", name: "Area chart", nameKo: "영역 차트" },
  stream: { component: "StreamGraph", name: "Streamgraph", nameKo: "스트림그래프" },
  bar: { component: "BarChart", name: "Bar chart", nameKo: "막대 차트" },
  radialBar: { component: "RadialBarChart", name: "Radial bar chart", nameKo: "방사형 막대" },
  gauge: { component: "GaugeChart", name: "Gauge", nameKo: "게이지" },
  bullet: { component: "BulletChart", name: "Bullet chart", nameKo: "불릿 차트" },
  sparkline: { component: "Sparkline", name: "Sparkline", nameKo: "스파크라인" },
  slope: { component: "SlopeChart", name: "Slope chart", nameKo: "슬로프 차트" },
  dumbbell: { component: "DumbbellChart", name: "Dumbbell chart", nameKo: "덤벨 차트" },
  lollipop: { component: "LollipopChart", name: "Lollipop chart", nameKo: "롤리팝 차트" },
  beeswarm: { component: "BeeswarmChart", name: "Beeswarm", nameKo: "비스웜" },
  ridgeline: { component: "RidgelineChart", name: "Ridgeline", nameKo: "릿지라인" },
  sankey: { component: "SankeyChart", name: "Sankey diagram", nameKo: "생키 다이어그램" },
  chord: { component: "ChordChart", name: "Chord diagram", nameKo: "코드 다이어그램" },
  calendar: { component: "CalendarHeatmap", name: "Calendar heatmap", nameKo: "캘린더 히트맵" },
  bump: { component: "BumpChart", name: "Bump chart", nameKo: "범프 차트" },
  box: { component: "BoxPlot", name: "Box / violin plot", nameKo: "박스 플롯" },
  parallel: { component: "ParallelCoordinates", name: "Parallel coordinates", nameKo: "평행 좌표" },
  candlestick: { component: "CandlestickChart", name: "Candlestick chart", nameKo: "캔들스틱" },
  segmented: { component: "SegmentedBar", name: "Segmented bar", nameKo: "비율 막대" },
  skyline: { component: "SkylineChart", name: "Skyline", nameKo: "스카이라인" },
  histogram: { component: "HistogramChart", name: "Histogram", nameKo: "히스토그램" },
  scatter: { component: "ScatterChart", name: "Scatter plot", nameKo: "산점도" },
  tileMap: { component: "TileMap", name: "Tile grid map", nameKo: "타일 격자 지도" },
  barRace: { component: "BarRace", name: "Bar race", nameKo: "막대 레이스" },
  network: { component: "NetworkChart", name: "Network", nameKo: "네트워크" },
  timeline: { component: "Timeline", name: "Timeline", nameKo: "타임라인" },
  tree: { component: "Tree", name: "Tree", nameKo: "트리" },
  choropleth: { component: "Choropleth", name: "Choropleth map", nameKo: "단계구분도" },
  symbolMap: { component: "SymbolMap", name: "Symbol map", nameKo: "기호 지도" },
  flowMap: { component: "FlowMap", name: "Flow map", nameKo: "흐름 지도" },
};

/** A chart name in one language. Example: nameIn(META.pie, "ko") === "파이 차트" */
export function nameIn(meta: { name: string; nameKo: string }, lang: Lang): string {
  return lang === "ko" ? meta.nameKo : meta.name;
}

/** The locale to render a spec in: override (an outside value such as a prop or --locale), then options.locale. undefined when neither is set */
export function specLocale(spec: Pick<ChartSpec, "options">, override?: string): string | undefined {
  const l = override ?? spec.options?.locale;
  // Also accepts locales written with an underscore, such as "ko_KR" (Intl reads only "ko-KR"). An empty string counts as unset
  return typeof l === "string" && l ? l.replace(/_/g, "-") : undefined;
}

/**
 * Maximum size of one side of a chart (px). A value real charts never reach (over 4 times the MCP render_chart width limit of 2400).
 * validateSpec checks the spec's options.width and height against it, and places that take sizes unvalidated (server render options, CLI flags) reduce them to it.
 * Keeps a huge height from growing the server drawing (and the PNG bitmap) without bound
 */
export const MAX_CHART_SIZE = 10_000;

/** Brings an unvalidated size within MAX_CHART_SIZE. Leaves non-numbers as they are (the caller's default handles them) */
export function capChartSize<T extends number | undefined>(v: T): T {
  return (typeof v === "number" && v > MAX_CHART_SIZE ? MAX_CHART_SIZE : v) as T;
}

/** Charts that can be split into small multiples (spec.facet). Shared by the validator, the JSON schema, <Chart> and the server render */
export const FACET_TYPES = ["line", "area", "bar", "scatter"];

/** Maximum number of facet panels. Beyond it, only this many are drawn from the start, and the validator reports how many were left out */
export const FACET_MAX = 24;

/** Charts that can hide series (hidden). These are also the charts whose series card.legend "toggle" turns on and off */
export const TOGGLES = ["line", "area", "bar", "scatter", "timeline"];

/** Fields of the lines drawn over bars. Drawn only on vertical bars, and not on 100% or diverging bars */
export function barLineFields(type: string, enc: Record<string, unknown>, opt: Record<string, unknown>): string[] {
  return type === "bar" && opt.orientation !== "horizontal" && opt.layout !== "percent" && opt.layout !== "diverging" ? ([] as unknown[]).concat(enc.line ?? []).map(String) : [];
}

/** Whether card.legend "toggle" can turn series on and off: only when every legend item is a hideable series (with lines over bars, a plain legend). Shared by <Chart> and the validator */
export function legendToggles(type: string, enc: Record<string, unknown>, opt: Record<string, unknown>): boolean {
  // The hexbin density scatter uses no series, so there is no legend to toggle
  return TOGGLES.includes(type) && !barLineFields(type, enc, opt).length && !(type === "scatter" && hexBinned(opt));
}

/**
 * Whether the spec options ask for hexbin density (bin "hex"). A hexbin density scatter does not become a bubble chart even with a size channel, and has no series legend or toggleable legend.
 * resolveDef, autoLegend, legendToggles and validateSpec use the same check
 */
export function hexBinned(opt: unknown): boolean {
  return !!opt && typeof opt === "object" && (opt as { bin?: unknown }).bin === "hex";
}

/** The spec's tooltip template (options.tooltip.template). undefined when it is not a string or is empty */
export function specTemplate(spec: Pick<ChartSpec, "options">): string | undefined {
  const t = (spec.options?.tooltip as { template?: unknown } | undefined)?.template;
  return typeof t === "string" && t ? t : undefined;
}

/** Chart name aliases (names AI often uses) */
export const TYPE_ALIASES: Record<string, string> = {
  doughnut: "donut",
  column: "bar",
  stackedBar: "bar",
  groupedBar: "bar",
  stacked: "area",
  streamgraph: "stream",
  radial: "radialBar",
  radialbar: "radialBar",
  progress: "gauge",
  progressRing: "gauge",
  kpi: "gauge",
  violin: "box",
  boxplot: "box",
  calendarHeatmap: "calendar",
  "parallel-coordinates": "parallel",
  parallelCoordinates: "parallel",
  mekko: "marimekko",
  spider: "radar",
  ohlc: "candlestick",
  candle: "candlestick",
  stock: "candlestick",
  segment: "segmented",
  segmentedBar: "segmented",
  proportionBar: "segmented",
  stackedBar100: "segmented",
  hist: "histogram",
  tilemap: "tileMap",
  tileGrid: "tileMap",
  cartogram: "tileMap",
  barChartRace: "barRace",
  racingBar: "barRace",
  racingBars: "barRace",
  raceBar: "barRace",
  arcDiagram: "network",
  graph: "network",
  nodeLink: "network",
  gantt: "timeline",
  ganttChart: "timeline",
  schedule: "timeline",
  dendrogram: "tree",
  orgChart: "tree",
  treeChart: "tree",
  choroplethMap: "choropleth",
  filledMap: "choropleth",
  map: "choropleth",
  bubbleMap: "symbolMap",
  proportionalSymbolMap: "symbolMap",
  pointMap: "symbolMap",
  originDestination: "flowMap",
  odMap: "flowMap",
};

export interface ChartMeta {
  type: string;
  component: string;
  /** English name */
  name: string;
  /** Korean name */
  nameKo: string;
  encoding: ChannelDef[];
}

/** Looks up channels and names by type or alias */
export function resolveMeta(type: string): ChartMeta | undefined {
  const t = CHANNELS[type] ? type : TYPE_ALIASES[type] ?? Object.keys(META).find((k) => k.toLowerCase() === type.toLowerCase() || META[k].component.toLowerCase() === type.toLowerCase());
  if (!t || !META[t]) return undefined;
  return { type: t, component: META[t].component, name: META[t].name, nameKo: META[t].nameKo, encoding: CHANNELS[t] };
}

/**
 * Columns the chart draws: encoding (in channel order, arrays spread) and options that take column names (dimensions, start, end, ranges), without duplicates.
 * Keeps the download CSV from exporting other columns the page passed in. An empty array when there are none (the download buttons then use every column)
 */
export function downloadFields(spec: Pick<ChartSpec, "type" | "encoding" | "options">): string[] {
  const out = new Set<string>();
  const add = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(add);
    else if (typeof v === "string" && v) out.add(v);
  };
  const enc = (spec.encoding ?? {}) as Record<string, unknown>;
  for (const k of resolveMeta(spec.type)?.encoding.map((c) => c.name) ?? Object.keys(enc)) add(enc[k]);
  const o = (spec.options ?? {}) as Record<string, unknown>;
  for (const k of ["dimensions", "start", "end", "ranges"]) add(o[k]);
  return [...out];
}
