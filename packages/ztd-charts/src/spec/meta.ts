import type { ChannelDef, ChartSpec, Lang } from "./types";

/**
 * 차트마다 encoding 채널. <Chart spec>은 레지스트리(예시 데이터 포함) 대신 이 작은 모듈만 써요.
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
/** 범위 띠 (라인, 영역): 넓은 표면 y와 같은 순서의 배열, 긴 표면 필드 하나 */
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
};

/** 타입 -> 컴포넌트 이름, 영어 이름, 한글 이름. 한글 이름은 여기 한 곳에만 둬요 (localizeDef, 한글 검증 메시지가 같이 써요) */
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
};

/** 차트 이름을 한 언어로. 예: nameIn(META.pie, "ko") === "파이 차트" */
export function nameIn(meta: { name: string; nameKo: string }, lang: Lang): string {
  return lang === "ko" ? meta.nameKo : meta.name;
}

/** 스펙을 그릴 로캘: override(프롭, --locale 같은 바깥 값), 그다음 options.locale. 둘 다 없으면 undefined */
export function specLocale(spec: Pick<ChartSpec, "options">, override?: string): string | undefined {
  const l = override ?? spec.options?.locale;
  // "ko_KR"처럼 밑줄로 쓴 로캘도 받아요 (Intl은 "ko-KR"만 읽어요). 빈 문자열은 없는 것으로
  return typeof l === "string" && l ? l.replace(/_/g, "-") : undefined;
}

/** 계열을 숨길 수 있는(hidden) 차트. card.legend "toggle"이 켜고 끄는 차트이기도 해요 */
export const TOGGLES = ["line", "area", "bar", "scatter"];

/** 막대 위에 그리는 선의 필드(차례 3 ⑪). 세로 막대에만, 100% 막대가 아닐 때만 그려요 */
export function barLineFields(type: string, enc: Record<string, unknown>, opt: Record<string, unknown>): string[] {
  return type === "bar" && opt.orientation !== "horizontal" && opt.layout !== "percent" ? ([] as unknown[]).concat(enc.line ?? []).map(String) : [];
}

/** card.legend "toggle"로 켜고 끌 수 있는지: 범례 항목이 모두 숨길 수 있는 계열일 때만 (막대 위 선이 있으면 보통 범례). <Chart>와 검사기가 같이 써요 */
export function legendToggles(type: string, enc: Record<string, unknown>, opt: Record<string, unknown>): boolean {
  return TOGGLES.includes(type) && !barLineFields(type, enc, opt).length;
}

/** 스펙의 툴팁 틀(options.tooltip.template). 글자가 아니거나 비었으면 undefined */
export function specTemplate(spec: Pick<ChartSpec, "options">): string | undefined {
  const t = (spec.options?.tooltip as { template?: unknown } | undefined)?.template;
  return typeof t === "string" && t ? t : undefined;
}

/** 차트 이름 별칭 (AI가 자주 쓰는 이름) */
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
};

export interface ChartMeta {
  type: string;
  component: string;
  /** 영어 이름 */
  name: string;
  /** 한글 이름 */
  nameKo: string;
  encoding: ChannelDef[];
}

/** 타입이나 별칭으로 채널과 이름 찾기 */
export function resolveMeta(type: string): ChartMeta | undefined {
  const t = CHANNELS[type] ? type : TYPE_ALIASES[type] ?? Object.keys(META).find((k) => k.toLowerCase() === type.toLowerCase() || META[k].component.toLowerCase() === type.toLowerCase());
  if (!t || !META[t]) return undefined;
  return { type: t, component: META[t].component, name: META[t].name, nameKo: META[t].nameKo, encoding: CHANNELS[t] };
}

/**
 * 차트가 그리는 열: encoding(채널 순서, 배열은 펼쳐서)과 열 이름을 받는 옵션(dimensions, start, end, ranges), 겹치지 않게.
 * 내려받기 CSV가 페이지가 넘긴 다른 열까지 내보내지 않게 써요. 하나도 없으면 빈 배열(내려받기 단추는 모든 열을 써요)
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
