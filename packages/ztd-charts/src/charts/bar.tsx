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

/** 값 글자 한 줄의 높이(11px 글자). 양쪽 쌓기에서 줄 칸이 이보다 좁으면 값 글자를 빼요 */
const LABEL_LINE = 12;

export interface BarChartProps<T = Row> extends BaseChartProps<T> {
  /** 범주 필드. 기본 "x" (가로 막대도 범주는 x로 넘겨요) */
  x?: Accessor<T, string>;
  /** 값 필드. 배열이면 넓은 표의 여러 열 */
  y?: Accessor<T, number> | string[];
  /** 계열 필드 (긴 표) */
  series?: Accessor<T, string>;
  /** "grouped" | "stacked" | "percent" | "diverging". 기본 "grouped". "diverging"은 0선 양쪽으로 쌓아요(리커트, 인구 피라미드) */
  layout?: "grouped" | "stacked" | "percent" | "diverging";
  /** "vertical" | "horizontal". 기본 "vertical", layout "diverging"이면 "horizontal" */
  orientation?: "vertical" | "horizontal";
  /** 값 순 정렬 (계열 하나일 때). 기본 false. layout "diverging"에서 "positive" | "negative"면 그쪽 합계가 큰 줄부터 */
  sort?: boolean | "positive" | "negative";
  /** layout "diverging": 0선 왼쪽(세로면 아래)에 놓을 계열 이름, 0선에서 바깥 순서. 넓은 표는 y 필드 이름, 긴 표는 series 값. 나머지 계열은 데이터 순서로 오른쪽에 놓고, 이미 음수인 값은 부호대로 왼쪽에 놓아요 */
  negative?: readonly string[];
  /** layout "diverging": 0선 양쪽에 반씩 놓는 계열 이름 (보통 "보통") */
  neutral?: string;
  /** layout "diverging": 조각을 그 줄 절댓값 합의 몫(%)으로. 기본 false */
  percent?: boolean;
  /** 같은 범주, 같은 계열이 여러 행일 때 합치는 방법. 기본 "sum" */
  aggregate?: Aggregate;
  /** 강조 대상: 계열 하나면 범주, 여러 개면 계열. 기본 "max" / 첫 계열. 계열이 여러 개일 때 판별 함수는 행이 아니라 계열 이름을 받아요: (name, index) => boolean */
  highlight?: BaseChartProps<T>["highlight"];
  /** 주석: 목표 구간, 기간, 기준선, 사건, 예측, 추세선. 세로 막대에서만 그려요. 예측 뒤 막대는 옅게 점선 테두리로 */
  annotations?: Annotation[];
  /** 세로 막대 위에 같은 축으로 그리는 선(목표, 작년 등)의 값 필드. 여럿이면 배열. highlight가 없으면 막대는 회색이고, 계열 필드가 있으면 같은 x의 값을 평균해요. 가로 막대와 100% 막대에는 그리지 않아요 */
  line?: string | string[];
  /** 숨길 계열 이름. 색과 강조는 모든 계열로 정해서 숨겨도 남은 계열 색이 그대로예요. 값 축은 보이는 계열에 맞춰요. 계열이 하나면 상관없어요. 모든 계열을 숨기면 빈 차트예요 */
  hidden?: readonly string[];
  /** 값 축 범위 고정 [아래, 위] (가로 막대는 가로 축). 100% 막대에서는 쓰지 않아요. 작은 여러 개(ChartFacets)가 패널의 높이를 맞출 때 써요 */
  yDomain?: [number, number];
  /** 아래 축 글자(세로 막대는 범주, 가로 막대는 값). 기본 true. false면 글자만 빼고 자리는 둬요 */
  showXAxis?: boolean;
  /** 왼쪽 축 글자(세로 막대는 값, 가로 막대는 범주). 기본 true. false면 글자와 그 자리를 빼요 */
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
  /** diverging: 0선에서 몇 번째 조각인지 (가운데 계열 0). 나타나는 차례와 둥근 모서리에 써요 */
  ring?: number;
  /** diverging: 줄의 낮은 쪽, 높은 쪽 끝 조각인지 (둥근 모서리) */
  endLo?: boolean;
  endHi?: boolean;
}

/** 막대 차트: 묶은, 쌓은, 100%, 양쪽(diverging) 막대와 가로 막대 */
export function BarChart<T = Row>(props: BarChartProps<T>) {
  const layout = props.layout ?? "grouped";
  const diverging = layout === "diverging";
  const horizontal = props.orientation === "horizontal" || (diverging && props.orientation === undefined);
  const c = useChart(props, { height: (w) => (horizontal ? Math.max(180, Math.min(320, w * 0.5)) : Math.max(200, Math.min(290, w * 0.52))), duration: 750, stagger: 60 });
  const { p, width: W, height: H } = c;

  const model0 = useMemo(() => prepSeries(props.data, props.x, props.y as never, props.series, { xType: "band", locale: c.locale, aggregate: props.aggregate }), [props.data, props.x, props.y, props.series, c.locale, props.aggregate]);
  // 양쪽 쌓기의 계열 자리 (모든 계열 기준. 이름이 없는 계열은 빼요)
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
    // 양쪽 쌓기는 그쪽 합계 순 (숨긴 계열과 상관없이 모든 계열로 정해서, 숨겨도 줄이 움직이지 않아요)
    if (divOpts && (props.sort === "positive" || props.sort === "negative")) {
      const st = divergingStack(model0.values, divOpts);
      return by(props.sort === "positive" ? st.pos : st.neg);
    }
    if (!props.sort || model0.series.length !== 1) return model0;
    return by(model0.values[0]);
  }, [model0, props.sort, divOpts]);
  // 계열이 하나면 막대마다 강조해요. 여러 개면 숨긴 계열(hidden)을 빼고 그려요. 강조와 색은 모든 계열로 정한 뒤 골라요(남은 계열 색이 그대로)
  const single = sorted.series.length === 1;
  const hiddenKey = single ? "" : (props.hidden?.join("\u0001") ?? "");
  const [model, keep] = useMemo(() => visibleSeries(sorted, hiddenKey), [sorted, hiddenKey]);
  const nS = model.series.length;
  // 같은 축의 선(목표, 작년): 세로 막대에만. 막대 범주(정렬 뒤)에 키로 맞추고, 긴 표에서는 같은 x의 값을 평균해요(계열마다 되풀이한 목표가 두 배가 되지 않게). 빈 목록은 선이 없는 것과 같아요
  const drawLines = !!props.line?.length && !horizontal && layout !== "percent" && !diverging;
  const lineModel = useMemo(
    () => (drawLines ? prepSeries(props.data, props.x, (Array.isArray(props.line) ? props.line : [props.line]) as never, undefined, { xType: "band", locale: c.locale, aggregate: props.series === undefined ? props.aggregate : "mean" }) : null),
    [drawLines, props.data, props.x, props.line, props.series, props.aggregate, c.locale],
  );
  const lineAt = useMemo(() => new Map((lineModel?.keys ?? []).map((k, i) => [k, i])), [lineModel]);
  /** 선 li의 범주 k 값 (없으면 NaN) */
  const lineVal = (li: number, k: number) => {
    const j = lineAt.get(model.keys[k]);
    return lineModel && j !== undefined ? lineModel.values[li][j] : Number.NaN;
  };

  const hiAll = useMemo(() => {
    // 선이 있으면 선이 강조색이라 막대는 highlight를 정할 때만 강조해요
    if (single) return resolveHighlight(props.highlight, sorted.rows[0] as T[], sorted.labels, sorted.values[0], drawLines ? "none" : "max");
    // 양쪽 쌓기에 highlight가 없고 negative가 있으면 가장 바깥 긍정 계열을 강조해요 (왼쪽 끝 ink에서 오른쪽 끝 강조색으로)
    const lead = divOpts && props.highlight === undefined ? divergingLead(sorted.series.length, divOpts.negative, divOpts.neutral) : -1;
    if (lead >= 0) return new Set([lead]);
    const totals = sorted.values.map((r) => r.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0));
    return resolveHighlight(props.highlight as never, sorted.series as never[], sorted.series, totals, drawLines ? "none" : "first");
  }, [sorted, single, props.highlight, drawLines, divOpts]);
  const colorsAll = useMemo(() => (single ? emphasis(p, sorted.keys.length, hiAll) : categorical(p, sorted.series.length, hiAll)), [single, p, sorted.keys.length, hiAll, sorted.series.length]);
  // 보이는 계열 자리로 옮겨요 (숨긴 게 없으면 그대로)
  const hi = useMemo(() => (model === sorted ? hiAll : new Set(keep.flatMap((i, j) => (hiAll.has(i) ? [j] : [])))), [model, sorted, hiAll, keep]);
  const colors = useMemo(() => (model === sorted ? colorsAll : keep.map((i) => colorsAll[i])), [model, sorted, colorsAll, keep]);

  // 양쪽 쌓기: 숨긴 계열은 자리만 비우고 percent의 분모에는 남겨요. 값 축과 끝 글자 자리는 모든 계열(divAll)로 정해서 숨긴 쪽만 다시 쌓여요
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
        // 왼쪽부터 오른쪽 순서(키보드도 이 순서), 0선에서 몇 번째인지, 줄 양 끝 조각
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
  // 주석은 세로 막대에만 그려요. 0~100%로 고정된 100% 막대는 주석 값으로 범위를 넓히지 않아요. 양쪽 쌓기에는 그리지 않아요
  const notes = horizontal || diverging ? undefined : props.annotations;
  if (layout !== "percent") vals.push(...annotationYs(notes));
  if (lineModel) for (const row of lineModel.values) for (const x of row) if (Number.isFinite(x)) vals.push(x);
  const [mn, mx] = extent(vals.length ? vals : [0, 1]);
  const ticksWanted = horizontal ? Math.max(2, Math.round(W / 120)) : Math.max(2, Math.round(H / 70));
  // 양쪽 쌓기는 양쪽을 각자 데이터 끝(그쪽 가장 긴 줄, 가운데 계열 반쪽 포함)에 맞춰요. 다음 눈금까지 넓히지 않고 눈금은 그 안에서 골라요 (0선은 가운데가 아니어도 돼요).
  // yDomain(작은 여러 개의 같은 값 축)이 있으면 그 범위를 써요
  const dom: [number, number] = layout === "percent" ? [0, 100] : props.yDomain ?? (diverging && mn < mx ? [mn, mx] : fitDomain(mn, mx, ticksWanted));
  const baseTick = layout === "percent" || (diverging && props.percent) ? (v: number) => `${v}%` : makeTickFormatter(props.format, c.locale, Math.max(Math.abs(dom[0]), Math.abs(dom[1])));
  // 양쪽 쌓기의 눈금은 크기만 (왼쪽도 양수로)
  const tickFmt = diverging ? (v: number) => baseTick(Math.abs(v)) : baseTick;
  const showValues = c.showLabels && (single || layout !== "grouped" || nS <= 3);
  const valueText = (sg: BarSeg) => (layout === "percent" ? c.pct(sg.v1 - sg.v0) : diverging ? (props.percent ? c.pct(Math.abs(sg.v1 - sg.v0)) : c.fmt(Math.abs(sg.value))) : c.fmt(sg.value));
  /** 양쪽 쌓기 한쪽 합계의 글자 */
  const sideText = (x: number) => (props.percent ? c.pct(x) : c.fmt(x));

  // 축 배치. 왼쪽 글자를 빼면 그 자리도 빼요
  const showY = props.showYAxis !== false;
  const showX = props.showXAxis !== false;
  const catW = horizontal && showY ? Math.min(W * 0.32, Math.max(...model.labels.map((l) => textWidth(l, 11.5, 600)), 24) + 10) : 0;
  const ticks = scaleLinear(dom, [0, 1]).ticks(horizontal ? Math.max(2, Math.round(W / 130)) : Math.max(2, Math.round(H / 70)));
  const left = horizontal ? catW + 6 : showY ? yAxisWidth(ticks, tickFmt, c.locale) : 0;
  const top = horizontal ? 4 : showValues ? 16 : 8;
  const bottom = horizontal ? 18 : 22;
  // 양쪽 쌓기의 값 글자: 줄 칸이 글자 한 줄보다 좁거나(가로) 합계 글자보다 좁으면(세로) 끝 합계와 조각 안 글자를 모두 빼요(촘촘한 줄에서 겹치지 않게). 값은 툴팁과 표에 남아요
  const rowStep = divAll ? (horizontal ? scaleBand(model.keys, [top, H - bottom], 0.3, 0.12) : scaleBand(model.keys, [left + 4, W - 2], 0.32, 0.12)).step : 0;
  const totalW = divAll ? Math.max(0, ...[...divAll.neg, ...divAll.pos].map((x) => textWidth(sideText(x), 11, 600))) : 0;
  const divLabels = showValues && rowStep >= (horizontal ? LABEL_LINE : totalW + 4);
  // 양쪽 끝 합계 글자: 줄마다 [왼쪽(아래), 오른쪽(위)]. 그쪽 조각이 없으면 null
  const totals = div && divLabels ? model.keys.map((_, k) => [div.neg[k] > 0 ? sideText(div.neg[k]) : null, div.pos[k] > 0 ? sideText(div.pos[k]) : null]) : [];
  const sidePad = (j: number) => (divAll && divLabels ? Math.max(0, ...[divAll, div ?? divAll].flatMap((d) => (j ? d.pos : d.neg).map((x) => (x > 0 ? textWidth(sideText(x), 11, 600) + 10 : 0)))) : 0);
  const valPad = horizontal && showValues && layout !== "percent" ? (diverging ? sidePad(1) : Math.max(...segs.map((s) => textWidth(valueText(s), 11, 700)), 0) + 10) : 0;
  // 세로 막대의 음수 값 글자는 막대 끝 아래에 써요. 가장 낮은 막대 아래 글자 자리를 남겨요
  const negPad = !horizontal && (diverging ? divLabels : showValues) && mn < 0 && (single || layout === "grouped" || diverging) ? 16 : 0;
  const x0 = horizontal ? left + (diverging ? sidePad(0) : 0) : left + 4;
  const x1 = horizontal ? W - Math.max(8, valPad) : W - 2;
  const band = horizontal ? scaleBand(model.keys, [top, H - bottom], 0.3, 0.12) : scaleBand(model.keys, [x0, x1], nS > 1 && layout === "grouped" ? 0.24 : 0.32, 0.12);
  const v = horizontal ? scaleLinear(dom, [x0, x1]) : scaleLinear(dom, [H - bottom - negPad, top]);
  const inner = layout === "grouped" && nS > 1 ? scaleBand(model.series, [0, band.bandwidth], 0.12, 0) : null;
  const r = Math.min(p.theme.radiusMark, (inner ? inner.bandwidth : band.bandwidth) / 4);
  /** 범주 k 칸의 가운데 (선의 점 자리) */
  const mid = (k: number) => band(model.keys[k]) + band.bandwidth / 2;
  const lineInk = (li: number) => p.paint(lineToken(li));

  // 주석의 x 값: 범주 키로 칸 가운데를 찾아요. 구간과 예측은 칸 가장자리(칸 폭의 절반)까지 덮어요
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
    // 추세선: 계열 하나면 그 값, 묶은 막대는 강조 계열, 쌓은 막대는 범주 합계. 100% 막대는 없어요
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

  // 계열 하나인 세로 막대의 값 글자: 칸 폭보다 넓으면 겹치지 않게 솎아요 (강조 막대 글자는 남겨요)
  const shownValues = useMemo(
    () => (single && !horizontal && showValues ? new Set(thinLabels(segs.map((sg) => band(model.keys[sg.k]) + band.bandwidth / 2), segs.map(valueText), band.bandwidth < 26 ? 10 : 11, 4, 500, new Set(segs.flatMap((sg, j) => (sg.hi ? [j] : []))))) : null),
    // band, valueText는 아래 값들로 정해져요
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segs, single, horizontal, showValues, layout, W, H, c.fmt],
  );

  // 막대가 쌓이지 않는 배치 (묶음, 계열 하나)
  const solo = layout === "grouped" || nS === 1;
  // 세로 막대 위(음수면 아래)의 값 글자 자리. 솎였거나(계열 하나) 칸보다 넓으면(묶음) null. 그리기와 아래 상자가 같이 써요
  const valueSpot = (sg: BarSeg, i: number, pos: number, th: number, a: number, b: number, tw: number) => {
    if (nS === 1 ? shownValues !== null && !shownValues.has(i) : th < tw * 0.8) return null;
    const spot = { x: pos + th / 2, y: sg.v1 < sg.v0 || sg.value < 0 ? Math.max(a, b) + 8 : Math.min(a, b) - 8, size: th < 26 ? 10 : 11 };
    // 선의 점이 글자에 겹치면 글자를 빼요 (값은 툴팁에 남아요)
    const px = mid(sg.k);
    if (lineModel && Math.abs(px - spot.x) < tw / 2 + 5 && lineModel.series.some((_, li) => Math.abs(v(lineVal(li, sg.k)) - spot.y) < spot.size / 2 + 6)) return null;
    return spot;
  };

  // 막대 위아래 값 글자의 상자. 주석 이름표(기준선, 예측)가 이걸 피해요 (390px에서 "Goal 100"이 값을 가리던 문제)
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
        // 양쪽 쌓기의 가운데 계열은 0선에서 양쪽으로 자라요. 조각은 0선에서 바깥 차례로 나타나요
        const a0 = sg.ring === 0 ? v(0) : g.a;
        return { key: sg.key, to: [g.pos, g.th, g.a, g.b], from: [g.pos, g.th, layout === "grouped" ? base : a0, layout === "grouped" ? base : a0], enter: [g.pos, g.th, a0, a0], delay: sg.k * stg + (sg.ring ?? sg.s) * (layout === "grouped" ? 30 : 70), data: sg };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segs, W, H, dom[0], dom[1], stg, layout, horizontal],
  );
  const m = useMotion(marks, c.motion);

  // 선의 점: 막대 다음 차례라 키보드는 막대를 모두 지난 뒤 선을 지나요
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
  // 짚은 범주. 계열이 여러 개면 그 범주의 막대를 모두 밝게 두고 다른 범주를 흐려요 (툴팁도 범주의 모든 계열을 보여 줘요). 선의 점을 짚어도 그 범주예요
  const activePt = c.active !== null && c.active >= segs.length ? linePts[c.active - segs.length] ?? null : null;
  const activeCat = c.active !== null ? activePt?.k ?? segs[c.active]?.k ?? null : null;

  let tip: TooltipData | null = null;
  if (lineModel && activeCat !== null) {
    // 선이 있으면 어느 층을 짚어도 그 범주의 막대 값과 모든 선 값을 보여 줘요 (짚은 줄을 굵게)
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
  /** 양쪽 쌓기 줄 문장의 앞부분: "Support: negative 46%, positive 32%" */
  const rowSides = (k: number) => (div ? `${model.labels[k]}: ${msg.sides(sideText(div.neg[k]), sideText(div.pos[k]))}` : "");
  const auto = `${msg.kind}. ${msg.desc(model.keys.length, nS, model.series.join(", "))}${lineModel ? msg.lines(lineModel.series) : ""}. ${div ? model.keys.map((_, k) => rowSides(k)).slice(0, 8).join("; ") : single ? model.labels.map((l, k) => `${l} ${c.fv(model.values[0][k])}`).slice(0, 8).join(", ") : ""}`;
  // 키보드로 고른 조각: 그 줄의 양쪽 합계를 먼저 읽어요
  const activeSeg = div && c.via === "keyboard" && c.active !== null ? segs[c.active] : undefined;
  const announce = activeSeg ? `${rowSides(activeSeg.k)}. ${activeSeg.series ? `${activeSeg.series}: ` : ""}${events[c.active ?? 0].formatted} (${(c.active ?? 0) + 1}/${events.length})` : undefined;
  /** 양쪽 쌓기 줄 k의 [낮은 끝, 높은 끝] 값 */
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
          {/* 양쪽 쌓기의 눈금 글자는 크기만이라 위아래가 같은 글자예요. GridY는 같은 글자를 부호 있는 숫자로 바꿔서 글자를 따로 써요 */}
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
        // 양쪽 쌓기는 줄 양 끝 조각만 바깥 모서리를 둥글게
        const corners = diverging ? { ...(sg.endLo && (horizontal ? { tl: r, bl: r } : { bl: r, br: r })), ...(sg.endHi && (horizontal ? { tr: r, br: r } : { tl: r, tr: r })) } : horizontal ? (stackedTop ? (neg ? { tl: r, bl: r } : { tr: r, br: r }) : {}) : stackedTop ? (neg ? { bl: r, br: r } : { tl: r, tr: r }) : {};
        const d = horizontal ? roundRectPath(Math.min(a, b), pos, Math.abs(b - a), th, corners) : roundRectPath(pos, Math.min(a, b), th, Math.abs(b - a), corners);
        const lo = m.fade(sg.k * stg + 320, 260);
        // 예측 구간의 막대: 옅게 칠하고 점선 테두리 (쌓은 막대는 구분선을 그대로 둬요)
        const projected = fk >= 0 && sg.k >= fk;
        const outline = projected && solo;
        let label: ReactNode = null;
        // 양쪽 쌓기는 줄 끝 합계가 값 글자예요. 조각 안 글자는 계열이 여럿일 때만, 0선이 지나는 가운데 계열과 그쪽에 혼자인 조각(합계와 같은 수)은 빼요
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
              // 막대가 0이거나 아주 짧아도 칸 전체를 호버 영역으로 (칠한 부분만 받으면 0 막대는 잡을 수 없어요)
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
        // 선은 막대가 다 자란 뒤 나타나요. 첫 선은 강조색, 나머지는 회색. 빈 값에서 끊기고 혼자 남은 점은 점만
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

/** 빈 값(NaN)에서 끊기는 꺾은선. 혼자 남은 점은 선 없이 점만 그려요 */
function lineRuns(pts: [number, number][]): string {
  const ys = pts.map((pt) => pt[1]);
  return bandRuns(ys, ys)
    .map(([a, b]) => polyline(pts.slice(a, b + 1)))
    .join("");
}

/** 막대 위 선의 색: 첫 선은 강조색, 나머지는 회색 (카드 범례도 같은 규칙) */
export const lineToken = (i: number) => (i ? "neutralStrong" : "accent");
