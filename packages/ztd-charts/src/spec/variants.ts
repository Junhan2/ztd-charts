import { VARIANT_NAMES_KO } from "./locales/variants-ko";
import * as S from "./samples";
import type { ChartDef, ChartSpec, Lang } from "./types";

/** One named variant. Laid over the options of the chart's example spec */
export interface ChartVariant {
  /** Name used in URLs and the CLI (for example "horizontal") */
  id: string;
  /** Display name. Korean names are VARIANT_NAMES_KO in locales/variants-ko.ts */
  name: string;
  /** Laid over the example's options. null removes that option from the example */
  options: Record<string, unknown>;
  /** Channels laid over the example's encoding. Only variants that use other fields of the sample data, such as the range band, or that remove a channel (null), such as hexbin density, have it */
  encoding?: Record<string, string | string[] | null>;
  /** Data used instead of the sample data. Only map variants that show a different map (US states, Korean provinces) have it */
  data?: ChartSpec["data"];
}

/* @__NO_SIDE_EFFECTS__ */
const v = (id: string, name: string, options: Record<string, unknown>, encoding?: ChartVariant["encoding"], data?: ChartVariant["data"]): ChartVariant => ({ id, name, options, ...(encoding && { encoding }), ...(data && { data }) });

/**
 * Named variants per chart. They keep the sample data and change only options (the range band adds the sample data's p5 and p95 fields to encoding; map variants that show a different map change the data too).
 * Shared by the variant gallery on the docs chart pages, CLI `example <type> --variant <id>` and MCP get_chart_schema.
 * Charts with no options (marimekko, bump) and charts with no options worth a variant (slope) have none
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
  skyline: [v("rate-strip", "Rate strip", { frontRate: "strip" }), v("low-view", "Low view", { view: "low" }), v("shallow", "Shallow blocks", { depth: 0.16 }), v("no-wall", "Without wall", { wall: false }), v("textured", "Texture on every row", { texture: "all" })],
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
    v("status-bars", "Status colors on bars", { statusStrip: false }),
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

/** A chart's variants in one language. type is the canonical name (registry type); an empty array when there are none */
export function variantsIn(type: string, lang: Lang): ChartVariant[] {
  const names = lang === "ko" ? VARIANT_NAMES_KO[type] : undefined;
  return (VARIANTS[type] ?? []).map((x) => ({ ...x, name: names?.[x.id] ?? x.name }));
}

/** Applies a variant to the example spec. Pass the Korean example to apply it to the Korean example. null when there is no such variant */
export function variantSpec(def: Pick<ChartDef, "type" | "example">, id: string): ChartSpec | null {
  const found = VARIANTS[def.type]?.find((x) => x.id === id);
  if (!found) return null;
  // null removes that channel or option from the example
  const kept = <V,>(o: Record<string, V | null>) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== null)) as Record<string, V>;
  const encoding = found.encoding && { encoding: kept({ ...def.example.encoding, ...found.encoding }) };
  // A variant that changes the data (a different map) drops the subtitle and one-line summary that described the sample data
  const { subtitle: _s, takeaway: _t, ...card } = def.example.card ?? {};
  const data = found.data && { data: found.data, ...(def.example.card && { card }) };
  return { ...def.example, ...encoding, ...data, options: kept({ ...def.example.options, ...found.options }) };
}
