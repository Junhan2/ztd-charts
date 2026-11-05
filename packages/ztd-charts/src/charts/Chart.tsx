import { useMemo, type ComponentType } from "react";
import { ChartCard, ChartState, type LegendItem } from "../components/ChartCard";
import { resolveHighlight } from "../core/highlight";
import { langOf } from "../core/i18n";
import { categoricalTokens } from "../core/palette";
import type { ChartEvent, Highlight } from "../core/types";
import { strGetter, uniq, numGetter } from "../data/accessor";
import { useChartData } from "../data/useChartData";
import { nameIn, resolveMeta, specLocale, type ChartMeta } from "../spec/meta";
import type { ChartSpec } from "../spec/types";
import { inlineRows } from "../spec/validate";
import { ThemeProvider, useChartLocale, type ThemeInput } from "../theme/context";
import { AreaChart, LineChart } from "./line";
import { BarChart } from "./bar";
import { BeeswarmChart } from "./beeswarm";
import { BoxPlot } from "./box";
import { BubbleChart } from "./bubble";
import { BulletChart } from "./bullet";
import { BumpChart } from "./bump";
import { CalendarHeatmap } from "./calendar";
import { CANDLE_TEXT, CandlestickChart, MA_TOKENS, maPeriods } from "./candlestick";
import { ChordChart } from "./chord";
import { DumbbellChart } from "./dumbbell";
import { FunnelChart } from "./funnel";
import { Heatmap } from "./heatmap";
import { LollipopChart } from "./lollipop";
import { MarimekkoChart } from "./marimekko";
import { ParallelCoordinates } from "./parallel";
import { ParetoChart } from "./pareto";
import { DonutChart, PieChart } from "./pie";
import { GaugeChart, RadialBarChart } from "./radial";
import { RadarChart } from "./radar";
import { RidgelineChart } from "./ridgeline";
import { SankeyChart } from "./sankey";
import { SegmentedBar } from "./segmented";
import { SlopeChart } from "./slope";
import { Sparkline } from "./sparkline";
import { StreamGraph } from "./stream";
import { SunburstChart } from "./sunburst";
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
};

/** 타입이나 별칭으로 채널, 이름 찾기 (레지스트리 전체를 끌어오지 않아요) */
export function resolveDef(type: string): ChartMeta | undefined {
  return resolveMeta(type);
}

/** encoding(채널 -> 필드)을 컴포넌트 프롭으로 */
export function encodingToProps(def: Pick<ChartMeta, "encoding">, encoding: ChartSpec["encoding"] = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of def.encoding) {
    const v = encoding[c.name];
    if (v !== undefined) out[c.prop ?? c.name] = v;
  }
  return out;
}

/** 스펙으로 범례 만들기 (card.legend: "auto"). locale은 차트를 그리는 로캘이고 캔들스틱 범례 글자에 써요 */
export function autoLegend(spec: ChartSpec, rows: Record<string, unknown>[], locale: string): LegendItem[] {
  const def = resolveDef(spec.type);
  if (!def || !rows.length) return [];
  const enc = spec.encoding ?? {};
  const opt = spec.options ?? {};
  const h = opt.highlight as Highlight | undefined;
  const perItem = ["pie", "donut", "waffle"];
  if (perItem.includes(def.type)) {
    const gl = strGetter(enc.label as string | undefined, "label");
    const gv = numGetter(enc.value as string | undefined, "value");
    const labels = rows.map((r, i) => gl(r, i));
    const hi = resolveHighlight(h, rows, labels, rows.map((r, i) => gv(r, i)), def.type === "waffle" ? "first" : "max");
    const tokens = categoricalTokens(labels.length, hi);
    return labels.map((l, i) => ({ label: l, color: tokens[i] }));
  }
  if (def.type === "candlestick") {
    // 차트가 그리는 이동평균만 (행 수보다 긴 기간은 빼요)
    const ma = maPeriods(Array.isArray(opt.ma) ? (opt.ma as number[]) : undefined, rows.length);
    const t = CANDLE_TEXT[langOf(locale)];
    return [{ label: t.up, color: (opt.upColor as string | undefined) ?? "accent" }, { label: t.down, color: (opt.downColor as string | undefined) ?? "neutralStrong" }, ...ma.map((d, i) => ({ label: t.maLegend(d), color: MA_TOKENS[i], shape: "line" as const }))];
  }
  if (["marimekko", "area", "bar", "line", "stream", "radar"].includes(def.type)) {
    let series: string[] = [];
    if (Array.isArray(enc.y)) series = enc.y as string[];
    else if (typeof enc.series === "string") {
      const g = strGetter(enc.series, "series");
      series = uniq(rows.map((r, i) => g(r, i)));
    }
    if (series.length < 2) return [];
    const hi = resolveHighlight(h as never, series as never[], series, series.map(() => 0), "first");
    if (def.type === "line" || def.type === "radar") return series.map((s, i) => ({ label: s, color: hi.has(i) ? "accent" : "neutralStrong", shape: def.type === "line" ? "line" : "square" }));
    const tokens = categoricalTokens(series.length, hi);
    return series.map((s, i) => ({ label: s, color: tokens[i] }));
  }
  return [];
}

export interface ChartProps {
  spec: ChartSpec;
  /** 스펙 options보다 우선해요 */
  width?: number;
  height?: number;
  animate?: boolean;
  replayKey?: string | number;
  theme?: ThemeInput;
  className?: string;
  onHover?: (e: ChartEvent<Record<string, unknown>> | null) => void;
  onClick?: (e: ChartEvent<Record<string, unknown>>) => void;
  /** URL 데이터를 가져올 때 fetch 옵션 (인증 헤더 등) */
  fetchInit?: RequestInit;
  /** 차트와 카드의 로캘. 스펙 options.locale보다 우선이고, 없으면 ThemeProvider, 그다음 "en-US" */
  locale?: string;
}

/** JSON 스펙 하나로 차트(와 카드)를 그려요 */
export function Chart(props: ChartProps) {
  const { spec } = props;
  const def = resolveDef(spec.type);
  // { csv }는 렌더마다 다시 읽지 않아요
  const inline = useMemo(() => inlineRows(spec.data), [spec.data]);
  const remote = !inline && spec.data && typeof spec.data === "object" && "url" in spec.data ? (spec.data as { url: string; format?: "json" | "csv" | "auto"; select?: string }) : null;
  // 프롭, 스펙 options.locale 순서. 둘 다 없으면 카드와 차트가 ThemeProvider를 따라요
  const explicit = specLocale(spec, props.locale);
  const locale = useChartLocale(explicit);
  const lang = langOf(locale);
  const st = useChartData(remote?.url ?? null, { parse: remote?.format ?? "auto", select: remote?.select, init: props.fetchInit, locale });
  if (!def) {
    return <ChartState error={lang === "ko" ? `알 수 없는 차트 종류: ${spec.type}` : `Unknown chart type: ${spec.type}`} height={props.height ?? 200} locale={explicit} />;
  }
  const rows = inline ?? st.data;
  const Comp = CHART_COMPONENTS[def.type];
  const options = { ...(spec.options ?? {}) };
  const chartProps: Record<string, unknown> = {
    ...encodingToProps(def, spec.encoding),
    ...options,
    data: rows,
    ...(props.width !== undefined ? { width: props.width } : {}),
    ...(props.height !== undefined ? { height: props.height } : {}),
    ...(props.animate !== undefined ? { animate: props.animate } : {}),
    ...(props.replayKey !== undefined ? { replayKey: props.replayKey } : {}),
    ...(props.onHover ? { onHover: props.onHover } : {}),
    ...(props.onClick ? { onClick: props.onClick } : {}),
    // 프롭, options.locale 순서로 고친 값("ko_KR" → "ko-KR"). 둘 다 없으면 ThemeProvider를 따라요
    locale: explicit,
  };
  const h = (chartProps.height as number | undefined) ?? 220;
  // 데이터를 가진 채 다시 불러올 때(refreshMs)는 차트를 그대로 둬요. 다시 불러오기가 한 번 실패해도 이전 데이터가 있으면 차트를 보여 줘요
  let body = remote && !rows.length && (st.loading || st.error || st.empty) ? <ChartState loading={st.loading} error={st.error} empty={st.empty} onRetry={st.reload} height={h} locale={explicit} /> : <Comp {...chartProps} />;
  if (spec.card) {
    const c = spec.card;
    const legend = c.legend === "auto" ? autoLegend(spec, rows, locale) : c.legend;
    body = (
      <ChartCard number={c.number} title={c.title ?? nameIn(def, lang)} subtitle={c.subtitle} legend={legend && legend.length ? legend : undefined} takeaway={c.takeaway} level={c.level} sample={c.sample} replay={c.replay !== false} className={props.className} locale={explicit}>
        {body}
      </ChartCard>
    );
  }
  const theme = props.theme ?? (spec.theme as ThemeInput | undefined);
  if (theme) body = <ThemeProvider theme={theme}>{body}</ThemeProvider>;
  return body;
}
