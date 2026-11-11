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
 * 타입이나 별칭으로 채널, 이름 찾기 (레지스트리 전체를 끌어오지 않아요).
 * 0.4까지 scatter는 bubble의 별칭이었어요. size 채널이 있는 scatter 스펙은 그때처럼 bubble로 그려요. 육각 밀도(bin "hex")는 크기를 쓰지 않아 산점도 그대로예요
 */
export function resolveDef(type: string, encoding?: ChartSpec["encoding"], options?: ChartSpec["options"]): ChartMeta | undefined {
  const def = resolveMeta(type);
  return def?.type === "scatter" && encoding?.size !== undefined && !hexBinned(options) ? resolveMeta("bubble") : def;
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

/**
 * 스펙으로 범례 만들기 (card.legend: "auto"). locale은 차트를 그리는 로캘이고 캔들스틱 범례 글자에 써요.
 * options.hidden 계열은 빼요. withHidden이면 숨긴 계열까지 모두 적어요 (켜고 끄는 범례)
 */
export function autoLegend(spec: ChartSpec, rows: Record<string, unknown>[], locale: string, withHidden = false): LegendItem[] {
  const def = resolveDef(spec.type, spec.encoding, spec.options);
  if (!def || !rows.length) return [];
  const enc = spec.encoding ?? {};
  const opt = spec.options ?? {};
  const h = opt.highlight as Highlight | undefined;
  // 숨긴 계열은 범례에서만 빼요(색은 모든 계열로 정해요)
  const off = new Set(!withHidden && TOGGLES.includes(def.type) && Array.isArray(opt.hidden) ? opt.hidden.map(String) : []);
  const shown = (items: LegendItem[]) => items.filter((it) => !off.has(it.label));
  const perItem = ["pie", "donut", "waffle"];
  // 도넛은 비중이 든 자기 범례(오른쪽이나 아래)를 그려요. 카드 범례까지 그리면 범례가 두 번 나와요
  if (def.type === "donut" && opt.legend !== "none") return [];
  if (perItem.includes(def.type)) {
    const gl = strGetter(enc.label as string | undefined, "label");
    const gv = numGetter(enc.value as string | undefined, "value");
    const isWaffle = def.type === "waffle";
    const items = rows.map((r, i) => ({ r, label: gl(r, i), value: isWaffle ? gv(r, i) : sliceValue(gv(r, i)) }));
    // 파이, 도넛은 차트와 같은 규칙으로 "기타"를 묶고 기타는 강조하지 않아요
    const { kept, other } = isWaffle ? { kept: items, other: null } : groupOther(items, opt.other as number | undefined, (n, value) => ({ r: {}, label: otherLabel(langOf(locale), n), value }));
    const hi = resolveHighlight(h, kept.map((x) => x.r), kept.map((x) => x.label), kept.map((x) => x.value), isWaffle ? "first" : "max");
    const all = other ? [...kept, other] : kept;
    // 차트가 칠하는 색 함수 그대로 (와플은 categorical, 파이와 도넛은 colorMode에 따라)
    const tokens = legendColors((p) => (isWaffle ? categorical(p, all.length, hi) : sliceSwatches(p, all.length, hi, opt.colorMode as "categorical" | "emphasis" | undefined)));
    // 반원 와플(의석 차트)은 점이라 범례도 원이에요
    const dot = isWaffle && opt.shape === "arc";
    return all.map((x, i) => ({ label: x.label, color: tokens[i], ...(dot && { shape: "circle" as const }) }));
  }
  if (def.type === "candlestick") {
    // 차트가 그리는 이동평균만 (행 수보다 긴 기간은 빼요)
    const ma = maPeriods(Array.isArray(opt.ma) ? (opt.ma as number[]) : undefined, rows.length);
    const t = CANDLE_TEXT[langOf(locale)];
    return [{ label: t.up, color: (opt.upColor as string | undefined) ?? "accent" }, { label: t.down, color: (opt.downColor as string | undefined) ?? "neutralStrong" }, ...ma.map((d, i) => ({ label: t.maLegend(d), color: MA_TOKENS[i], shape: "line" as const }))];
  }
  if (def.type === "network") {
    // 차트가 칠하는 묶음 색 함수 그대로 (networkSwatches). 강조 노드는 강조색이라 범례에 넣지 않아요
    const groups = groupNames(opt.groups);
    if (groups.length < 2) return [];
    const tokens = legendColors((p) => networkSwatches(p, groups.length));
    return groups.map((g, i) => ({ label: g, color: tokens[i], shape: "circle" as const }));
  }
  if (def.type === "symbolMap") {
    // 기호 지도의 묶음 색: 차트와 같이 데이터에 나온 순서, 강조 없는 categoricalDots
    if (typeof enc.group !== "string") return [];
    const g = strGetter(enc.group, "group");
    const groups = uniq(rows.map((r, i) => g(r, i)).filter(Boolean));
    if (groups.length < 2) return [];
    const tokens = legendColors((p) => categoricalDots(p, groups.length, new Set()));
    return groups.map((s, i) => ({ label: s, color: tokens[i], shape: "circle" as const }));
  }
  if (def.type === "scatter") {
    // 육각 밀도는 계열을 쓰지 않아요. 색 범례는 차트 안에 있어요
    if (typeof enc.series !== "string" || hexBinned(opt)) return [];
    const g = strGetter(enc.series, "series");
    const series = uniq(rows.map((r, i) => g(r, i)));
    if (series.length < 2) return [];
    // 차트와 같은 규칙: 색은 숨긴 계열까지 모든 계열로 정하고, 숨긴 계열은 범례에서만 빼요
    const dotHi = seriesHighlight(h, rows, series, g);
    const tokens = legendColors((p) => categoricalDots(p, series.length, dotHi));
    return shown(series.map((s, i) => ({ label: s, color: tokens[i], shape: "circle" as const })));
  }
  if (def.type === "timeline") {
    // 묶음(group)마다 한 칸. 차트와 같은 색 함수(categorical)와 강조(묶음 이름)예요
    // 색을 나누는 값은 group, 없으면 status(상태 띠). 차트와 같은 규칙이에요
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
    // 막대 위 선(차례 3 ⑪): 막대(highlight가 없으면 강조하지 않아요)와 선(첫 선 강조색, 나머지 회색)을 함께 적어요
    const lines = barLineFields(def.type, enc, opt);
    if (lines.length) {
      const barHi = resolveHighlight(h as never, series as never[], series, series.map(() => 0), "none");
      const tokens = legendColors((p) => categorical(p, series.length, barHi));
      const bars = series.length < 2 ? [{ label: String((Array.isArray(enc.y) ? enc.y[0] : enc.y) ?? "y"), color: "neutral" }] : series.map((s, i) => ({ label: s, color: tokens[i] }));
      return [...shown(bars), ...lines.map((label, i) => ({ label, color: lineToken(i), shape: "line" as const }))];
    }
    if (series.length < 2) return [];
    // 양쪽 막대는 차트와 같은 기본 강조(가장 바깥 긍정 계열)
    const diverging = def.type === "bar" && opt.layout === "diverging";
    const lead = diverging && h === undefined ? divergingLead(series.length, Array.isArray(opt.negative) ? opt.negative.map((n) => series.indexOf(String(n))) : [], typeof opt.neutral === "string" ? series.indexOf(opt.neutral) : -1) : -1;
    const hi = lead >= 0 ? new Set([lead]) : resolveHighlight(h as never, series as never[], series, series.map(() => 0), "first");
    // 레이더는 강조만 accent 면, 나머지는 neutralStrong 테두리로 그려요
    if (def.type === "radar") return shown(series.map((s, i) => ({ label: s, color: hi.has(i) ? "accent" : "neutralStrong", shape: "square" as const })));
    // 범례 색은 차트가 칠하는 색 함수 그대로예요 (섞은 중간 단계까지): 라인, 영역은 lineSwatches, 스트림은 층 순서와 기본 강조(합이 가장 큰 계열)까지 같이, 막대와 마리메코는 categorical
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

/** 스펙의 facet이 그릴 수 있는 것이면 그 facet (line, area, bar, scatter. 양쪽 막대는 빼요). 아니면 undefined라 예전처럼 차트 하나를 그려요 */
export function specFacet(spec: Pick<ChartSpec, "facet" | "options">, type: string): SpecFacet | undefined {
  const f = spec.facet;
  return f && typeof f === "object" && typeof f.by === "string" && FACET_TYPES.includes(type) && !(type === "bar" && spec.options?.layout === "diverging") ? f : undefined;
}

/** 스펙 facet과 차트 프롭(Chart가 만든 것)으로 <ChartFacets> 프롭. 크기, 강조, 묶음, 이름, 설명은 패널마다 정하려고 빼요. <Chart>와 서버 SVG가 같이 써요 */
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
  return useSpecChart(props, CHART_COMPONENTS);
}

/**
 * Chart의 몸통. 그릴 컴포넌트 표를 받아서, 대화형 HTML은 차트 하나만 실은 표로 같은 스펙을 그려요(서버 그림을 이어받아요).
 * 컴포넌트로 감싸지 말고 함수로 불러요: 감싸는 층이 생기면 안쪽 차트의 useId 값이 바뀌어 서버 그림과 어긋나요
 */
export function useSpecChart(props: ChartProps, components: typeof CHART_COMPONENTS) {
  const { spec } = props;
  const def = resolveDef(spec.type, spec.encoding, spec.options);
  // { csv }는 렌더마다 다시 읽지 않아요
  const inline = useMemo(() => inlineRows(spec.data), [spec.data]);
  const remote = !inline && spec.data && typeof spec.data === "object" && "url" in spec.data ? (spec.data as { url: string; format?: "json" | "csv" | "auto"; select?: string }) : null;
  // 프롭, 스펙 options.locale 순서. 둘 다 없으면 카드와 차트가 ThemeProvider를 따라요
  const explicit = specLocale(spec, props.locale);
  const locale = useChartLocale(explicit);
  const lang = langOf(locale);
  const st = useChartData(remote?.url ?? null, { parse: remote?.format ?? "auto", select: remote?.select, init: props.fetchInit, locale });
  // 스펙 툴팁 틀(options.tooltip.template): 그 행의 다른 열까지 툴팁에 써요. 훅이라 일찍 돌아가기 전에 둬요
  const template = specTemplate(spec);
  const tooltip = useMemo(() => (template ? templateTooltip(template, locale) : undefined), [template, locale]);
  // 켜고 끄는 범례(card.legend "toggle")에서 보는 사람이 고른 숨긴 계열. 처음 값은 options.hidden이고, 스펙의 hidden이 바뀔 때만 처음 값으로 돌아가요
  // (렌더마다 새 스펙 객체가 와도 그대로예요). 훅이라 일찍 돌아가기 전에 둬요
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
    // 프롭, options.locale 순서로 고친 값("ko_KR" → "ko-KR"). 둘 다 없으면 ThemeProvider를 따라요
    locale: explicit,
  };
  // 범례 항목이 모두 숨길 수 있는 계열일 때만 켜고 꺼요 (막대 위 선이 있으면 보통 범례)
  const toggle = spec.card?.legend === "toggle" && legendToggles(def.type, spec.encoding ?? {}, options);
  const hidden = viewer && viewer.base === hiddenKey ? viewer.hidden : specHidden;
  if (toggle) chartProps.hidden = hidden;
  const onToggle = (label: string) =>
    setViewer((v) => {
      const cur = v && v.base === hiddenKey ? v.hidden : specHidden;
      return { base: hiddenKey, hidden: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] };
    });
  const h = (chartProps.height as number | undefined) ?? 220;
  // 데이터를 가진 채 다시 불러올 때(refreshMs)는 차트를 그대로 둬요. 다시 불러오기가 한 번 실패해도 이전 데이터가 있으면 차트를 보여 줘요
  // 작은 여러 개(spec.facet): by 값마다 같은 차트를 한 칸씩. facet이 없으면 예전 그대로 차트 하나예요
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
    // 내려받기 CSV는 차트가 그리는 열만 (페이지가 넘긴 다른 열은 빼요)
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
