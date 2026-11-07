import { VARIANT_NAMES_KO } from "./locales/variants-ko";
import type { ChartDef, ChartSpec, Lang } from "./types";

/** 이름 붙은 꼴 하나. 차트 예시 스펙의 options 위에 덮어써요 */
export interface ChartVariant {
  /** 주소와 CLI에 쓰는 이름 (예: "horizontal") */
  id: string;
  /** 화면 이름. 한글은 locales/variants-ko.ts의 VARIANT_NAMES_KO */
  name: string;
  options: Record<string, unknown>;
}

/* @__NO_SIDE_EFFECTS__ */
const v = (id: string, name: string, options: Record<string, unknown>): ChartVariant => ({ id, name, options });

/**
 * 차트마다 이름 붙은 꼴. 예시 데이터를 그대로 쓰고 옵션만 바꿔요.
 * 문서 차트 페이지의 변형 모음, CLI `example <type> --variant <id>`, MCP get_chart_schema가 같이 써요.
 * 옵션이 없는 차트(marimekko, bump)와 꼴이라 할 만한 옵션이 없는 차트(slope)는 없어요
 */
export const VARIANTS: Readonly<Record<string, readonly ChartVariant[]>> = {
  pie: [v("values", "Values on slices", { labelMode: "value" }), v("names", "Names on slices", { labelMode: "label" }), v("emphasis", "Only the highlight in color", { colorMode: "emphasis" })],
  donut: [v("thin", "Thin ring", { innerRadius: 0.8 }), v("legend-right", "Legend on the right", { legend: "right" }), v("sorted", "Largest first", { sort: true })],
  funnel: [v("from-first", "Rates from the first step", { rateBase: "first" }), v("no-rates", "Without rates", { showRates: false })],
  waffle: [v("grid-only", "Grid only", { summary: false }), v("fine", "Fine grid", { cells: 200, columns: 20 })],
  treemap: [v("names", "Names only", { labelMode: "name" }), v("values", "Values only", { labelMode: "value" })],
  sunburst: [v("solid", "No hole", { hole: 0 }), v("wide-hole", "Wide hole", { hole: 0.6 })],
  waterfall: [v("no-connectors", "Without connectors", { connectors: false })],
  pareto: [v("threshold-70", "70% line", { threshold: 70 }), v("names", "Names on the axis", { rankLabels: false })],
  heatmap: [v("values", "Every value", { showValues: true }), v("no-legend", "Without legend", { legend: false })],
  radar: [v("circular", "Round grid", { circular: true }), v("three-rings", "Three rings", { levels: 3 })],
  bubble: [v("zero", "From zero", { zero: true }), v("few-labels", "Three labels", { maxLabels: 3 })],
  line: [
    v("step", "Step", { curve: "step", area: false }),
    v("every-series", "Every series in color", { colorMode: "categorical", area: false }),
    v("forecast", "Target band and forecast", { annotations: [{ type: "band", y: [70, 80] }, { type: "forecast", from: "2025-10" }] }),
    v("zoom", "Drag to zoom", { brush: "zoom" }),
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
};

/** 차트의 변형을 한 언어로. type은 정식 이름(레지스트리 type)이고, 없으면 빈 배열 */
export function variantsIn(type: string, lang: Lang): ChartVariant[] {
  const names = lang === "ko" ? VARIANT_NAMES_KO[type] : undefined;
  return (VARIANTS[type] ?? []).map((x) => ({ ...x, name: names?.[x.id] ?? x.name }));
}

/** 예시 스펙에 변형을 입혀요. 한국어 예시를 넘기면 한국어 예시에 입혀요. 그 꼴이 없으면 null */
export function variantSpec(def: Pick<ChartDef, "type" | "example">, id: string): ChartSpec | null {
  const found = VARIANTS[def.type]?.find((x) => x.id === id);
  return found ? { ...def.example, options: { ...def.example.options, ...found.options } } : null;
}
