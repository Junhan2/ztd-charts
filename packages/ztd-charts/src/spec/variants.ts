import { VARIANT_NAMES_KO } from "./locales/variants-ko";
import * as S from "./samples";
import type { ChartDef, ChartSpec, Lang } from "./types";

/** 이름 붙은 꼴 하나. 차트 예시 스펙의 options 위에 덮어써요 */
export interface ChartVariant {
  /** 주소와 CLI에 쓰는 이름 (예: "horizontal") */
  id: string;
  /** 화면 이름. 한글은 locales/variants-ko.ts의 VARIANT_NAMES_KO */
  name: string;
  /** 예시 options 위에 덮어써요. null은 예시의 그 옵션을 빼요 */
  options: Record<string, unknown>;
  /** 예시 encoding 위에 덮어쓰는 채널. 범위 띠처럼 예시 데이터의 다른 필드를 쓰는 꼴, 육각 밀도처럼 채널을 빼는 꼴(null)만 있어요 */
  encoding?: Record<string, string | string[] | null>;
  /** 예시 데이터 대신 쓰는 데이터. 다른 지도를 보여 주는 지도 꼴(미국 주, 한국 시도)만 있어요 */
  data?: ChartSpec["data"];
}

/* @__NO_SIDE_EFFECTS__ */
const v = (id: string, name: string, options: Record<string, unknown>, encoding?: ChartVariant["encoding"], data?: ChartVariant["data"]): ChartVariant => ({ id, name, options, ...(encoding && { encoding }), ...(data && { data }) });

/**
 * 차트마다 이름 붙은 꼴. 예시 데이터를 그대로 쓰고 옵션만 바꿔요 (범위 띠는 예시 데이터의 p5, p95 필드를 encoding에 더해요. 다른 지도를 보여 주는 지도 꼴은 데이터도 바꿔요).
 * 문서 차트 페이지의 변형 모음, CLI `example <type> --variant <id>`, MCP get_chart_schema가 같이 써요.
 * 옵션이 없는 차트(marimekko, bump)와 꼴이라 할 만한 옵션이 없는 차트(slope)는 없어요
 */
export const VARIANTS: Readonly<Record<string, readonly ChartVariant[]>> = {
  pie: [v("values", "Values on slices", { labelMode: "value" }), v("names", "Names on slices", { labelMode: "label" }), v("emphasis", "Only the highlight in color", { colorMode: "emphasis" })],
  donut: [v("thin", "Thin ring", { innerRadius: 0.8 }), v("legend-right", "Legend on the right", { legend: "right" }), v("sorted", "Largest first", { sort: true })],
  funnel: [v("from-first", "Rates from the first step", { rateBase: "first" }), v("no-rates", "Without rates", { showRates: false })],
  waffle: [v("grid-only", "Grid only", { summary: false }), v("fine", "Fine grid", { cells: 200, columns: 20 }), v("arc", "Half circle of seats", { shape: "arc", referenceLines: [{ value: 50 }] })],
  treemap: [v("names", "Names only", { labelMode: "name" }), v("values", "Values only", { labelMode: "value" })],
  sunburst: [v("solid", "No hole", { hole: 0 }), v("wide-hole", "Wide hole", { hole: 0.6 })],
  waterfall: [v("no-connectors", "Without connectors", { connectors: false })],
  pareto: [v("threshold-70", "70% line", { threshold: 70 }), v("names", "Names on the axis", { rankLabels: false })],
  heatmap: [v("values", "Every value", { showValues: true }), v("no-legend", "Without legend", { legend: false })],
  barRace: [v("top-five", "Top 5", { top: 5 }), v("first-frame", "First year", { startFrame: 2015 }), v("no-highlight", "Without highlight", { highlight: "none" })],
  radar: [v("circular", "Round grid", { circular: true }), v("three-rings", "Three rings", { levels: 3 })],
  bubble: [v("zero", "From zero", { zero: true }), v("few-labels", "Three labels", { maxLabels: 3 })],
  line: [
    v("step", "Step", { curve: "step", area: false }),
    v("every-series", "Every series in color", { colorMode: "categorical", area: false }),
    v("forecast", "Target band and forecast", { annotations: [{ type: "band", y: [70, 80] }, { type: "forecast", from: "2025-10" }] }),
    v("zoom", "Drag to zoom", { brush: "zoom" }),
    v("band", "Range band", { area: false }, { lower: "p5", upper: "p95" }),
    v("forecast-band", "Forecast range", { area: false, bandFrom: "forecast", annotations: [{ type: "forecast", from: "2025-10" }] }, { lower: "p5", upper: "p95" }),
  ],
  area: [v("percent", "100% stacked", { stack: "percent" }), v("overlap", "Overlapping", { stack: "none" })],
  stream: [v("silhouette", "Centered", { offset: "silhouette" }), v("data-order", "Data order", { reorder: false })],
  bar: [v("grouped", "Grouped", { layout: "grouped" }), v("percent", "100% stacked", { layout: "percent" }), v("horizontal", "Horizontal", { orientation: "horizontal" })],
  radialBar: [v("half", "Half circle", { sweep: 180 }), v("full", "Full circle", { sweep: 360 })],
  gauge: [v("semi", "Half circle", { variant: "semi" }), v("ring", "Progress ring", { variant: "ring" }), v("ticks", "Lit ticks", { variant: "ticks" })],
  bullet: [v("shared-axis", "Shared axis", { independent: false })],
  sparkline: [v("bars", "Bars", { variant: "bar" }), v("line", "Line only", { variant: "line", showExtremes: false }), v("high", "Mark the high", { mark: "max" })],
  dumbbell: [v("data-order", "Data order", { sort: false }), v("zero", "From zero", { zero: true })],
  lollipop: [v("vertical", "Vertical", { orientation: "vertical" }), v("data-order", "Data order", { sort: false })],
  beeswarm: [v("no-median", "Without median", { showMedian: false }), v("large-dots", "Large dots", { radius: 5 })],
  ridgeline: [v("by-median", "Sorted by median", { sort: "median" }), v("less-overlap", "Less overlap", { overlap: 0.5 }), v("more-overlap", "More overlap", { overlap: 3 })],
  sankey: [v("wide-nodes", "Wide nodes", { nodeWidth: 18 }), v("roomy", "More space", { nodePadding: 24 })],
  chord: [v("wide-gaps", "Wide gaps", { padAngle: 0.12 })],
  calendar: [v("monday", "Weeks from Monday", { weekStart: 1 }), v("no-gap", "No gaps", { gap: 0 })],
  box: [v("violin", "Violin", { variant: "violin" }), v("both", "Box and violin", { variant: "both" }), v("no-outliers", "Without outliers", { outliers: false })],
  parallel: [v("as-measured", "No flipped axes", { invert: [] })],
  candlestick: [v("plain", "Candles only", { ma: [] }), v("zoom", "Drag to zoom", { brush: "zoom" }), v("green-up", "Green up, red down", { upColor: "#16A34A", downColor: "#DC2626" })],
  segmented: [v("thin", "Thin bar", { variant: "thin" }), v("bar-only", "Bar only", { list: false })],
  skyline: [v("rate-strip", "Rate strip", { frontRate: "strip" }), v("shallow", "Shallow blocks", { depth: 0.16 }), v("no-wall", "Without wall", { wall: false }), v("textured", "Texture on every row", { texture: "all" })],
  histogram: [v("dots", "Dots", { variant: "dots" }), v("step", "Outline", { variant: "step" }), v("log", "Log bins", { log: true }), v("kde", "Density curve", { kde: true }), v("no-marks", "Without percentile lines", { marks: [] })],
  scatter: [v("fit", "Trend line", { fit: "linear" }), v("quadrants", "Quadrants", { refLines: { x: 5, y: 2000 } }), v("jitter", "Jitter", { jitter: { amount: 0.3 } }), v("hex", "Hexagon density", { bin: "hex", binSize: 28, highlight: null }, { series: null, label: null })],
  network: [v("by-degree", "Most connected first", { sort: "degree" }), v("as-given", "Data order", { sort: "data" }), v("dots-by-degree", "Dots by connections", { nodeSize: "degree" })],
  tileMap: [
    v("three-steps", "Three color steps", { colorSteps: 3 }),
    v("lowest-dark", "Lowest value darkest", { colorReverse: true }),
    v("no-legend", "Without legend", { legend: false }),
    v("kr-sido", "South Korea", { map: "kr-sido" }, { region: "sido", value: "rate" }, S.tileMapSample),
  ],
  timeline: [
    v("status-strip", "Status strip", {}, { label: "run", status: "state" }),
    v("clock-times", "Clock times", {}, { start: "startAt", end: "endAt" }),
    v("by-duration", "Longest first", { sort: "duration" }),
    v("now", "Now line", { now: 30 }),
    v("zoom", "Drag to zoom", { brush: "zoom" }),
  ],
  tree: [v("radial", "Radial", { layout: "radial" }), v("sized", "Sized by value, largest first", { sort: true }, { value: "users" })],
  choropleth: [
    v("europe", "Europe", { focus: "europe" }, { region: "country", value: "rate" }, S.choroplethEuropeSample),
    v("us-states", "US states", { map: "us-states" }, { region: "state", value: "rate" }, S.choroplethUsSample),
    v("kr-sido", "South Korea", { map: "kr-sido" }, { region: "sido", value: "rate" }, S.choroplethKrSample),
    v("custom-geojson", "Your own GeoJSON", { map: S.choroplethZones, featureId: "zone", featureName: "label" }, { region: "zone", value: "rate" }, S.choroplethZonesSample),
  ],
  symbolMap: [
    v("by-continent", "Colored by continent", { highlight: "none" }, { group: "continent" }, S.symbolMapSample),
    v("by-country", "Countries without coordinates", { map: "world" }, { region: "country", size: "users", label: "country" }, S.symbolMapCountrySample),
    v("us-states", "US stores", { map: "us-states" }, { size: "revenue", label: "store" }, S.symbolMapUsSample),
    v("europe", "Europe", { focus: "europe" }, {}, S.symbolMapEuropeSample),
    v("kr-sido", "South Korea", { map: "kr-sido" }, {}, S.symbolMapKrSample),
  ],
  flowMap: [
    v("us-states", "Between US states", { places: {} }, { value: "tons" }, S.flowMapUsSample),
    v("europe", "Europe", { focus: "europe", places: S.flowMapEuropePlaces }, { value: "tons" }, S.flowMapEuropeSample),
    v("kr-sido", "South Korea", { map: "kr-sido", places: S.flowMapKrPlaces }, { value: "boxes" }, S.flowMapKrSample),
    v("no-ranking", "Without the ranked list", { ranking: false }),
  ],
};

/** 차트의 변형을 한 언어로. type은 정식 이름(레지스트리 type)이고, 없으면 빈 배열 */
export function variantsIn(type: string, lang: Lang): ChartVariant[] {
  const names = lang === "ko" ? VARIANT_NAMES_KO[type] : undefined;
  return (VARIANTS[type] ?? []).map((x) => ({ ...x, name: names?.[x.id] ?? x.name }));
}

/** 예시 스펙에 변형을 입혀요. 한국어 예시를 넘기면 한국어 예시에 입혀요. 그 꼴이 없으면 null */
export function variantSpec(def: Pick<ChartDef, "type" | "example">, id: string): ChartSpec | null {
  const found = VARIANTS[def.type]?.find((x) => x.id === id);
  if (!found) return null;
  // null은 예시의 그 채널, 옵션을 빼요
  const kept = <V,>(o: Record<string, V | null>) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== null)) as Record<string, V>;
  const encoding = found.encoding && { encoding: kept({ ...def.example.encoding, ...found.encoding }) };
  // 데이터를 바꾸는 꼴(다른 지도)은 예시 데이터를 말하던 부제와 한 줄 요약을 빼요
  const { subtitle: _s, takeaway: _t, ...card } = def.example.card ?? {};
  const data = found.data && { data: found.data, ...(def.example.card && { card }) };
  return { ...def.example, ...encoding, ...data, options: kept({ ...def.example.options, ...found.options }) };
}
