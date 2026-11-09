import { useId, useMemo, type ReactNode } from "react";
import { AXIS_FONT, AxisPill, fitTickLabels, GridY, HoverLine, thinLabels, yAxisWidth } from "../core/axis";
import { BrushBand, changeRatio, ExtremeTags, signedPercent, useChartBrush, useZoom, type BrushProps } from "../core/brush";
import { capTipRows, ChartFrame, Txt } from "../core/ChartFrame";
import { makeTickFormatter } from "../core/format";
import { AnnotationsOver, AnnotationsUnder, annotationYs, describeAnnotations, forecastFrom, forecastX, type Annotation, type AnnotationGeom } from "../core/annotations";
import { bandBounds, bandPath, bandShape, boundField, isOutside, type BandShape, type BoundField } from "../core/band";
import { areaPath, linePath, nearestIndex, r2, type Curve } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { categorical, ramp, swatch, type Swatch } from "../core/palette";
import { extent, fitDomain, scaleLinear, timeTicks } from "../core/scale";
import { bucketSeries, prepSeries, xNum, type Aggregate, type SeriesModel, type XType } from "../core/series";
import { dodgeVertical, textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { lazyArray } from "../core/lazy";
import { useChart, type ChartCtx } from "../core/useChart";
import { useSync } from "../core/sync";
import { useMotion } from "../core/useMotion";
import { uniq } from "../data/accessor";
import { lttb } from "../data/parse";
import { stack } from "../layout/stack";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  line: "Line chart",
  area: "Area chart",
  /** 고른 구간을 읽어 줄 때 앞부분 */
  span: (range: string, change: string) => `${range}: ${change}`,
  desc: (nS: number, names: string, from: string, to: string, n: number) => `${plural(nS, "series", "series")} (${names}), x from ${from} to ${to}, ${plural(n, "point")}`,
  /** 경계 필드에 이름이 없을 때(함수) 툴팁에 쓰는 이름 */
  lower: "low",
  upper: "high",
  /** 설명: 칠한 범위. ranges는 "p5 to p95" 꼴 */
  band: (ranges: string) => ` Range ${ranges}.`,
  range: (lo: string, hi: string) => `${lo} to ${hi}`,
  /** 설명: 범위 밖 점 (outside 옵션) */
  outside: (n: number, where: string) => (n ? ` ${plural(n, "point")} outside the range: ${where}.` : " No points outside the range."),
  /** 범위 밖 점 하나: x 이름표와 계열 */
  where: (label: string, series: string) => `${label} (${series})`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    line: "라인 차트",
    area: "영역 차트",
    span: (range, change) => `${range} 구간 ${change}`,
    desc: (nS, names, from, to, n) => `계열 ${nS}개(${names}), x ${from}부터 ${to}까지 ${n}개 지점`,
    lower: "하한",
    upper: "상한",
    band: (ranges) => ` 범위 ${ranges}.`,
    range: (lo, hi) => `${lo}~${hi}`,
    outside: (n, where) => (n ? ` 범위 밖 ${n}개 지점: ${where}.` : " 범위 밖 지점 없음."),
    where: (label, series) => `${label}(${series})`,
  },
};

export interface XYProps<T = Row> extends BaseChartProps<T>, BrushProps {
  /** x 필드. 날짜("2025-03"), 숫자, 범주 모두 돼요. 기본 "x" */
  x?: Accessor<T, unknown>;
  /** y 필드. 배열이면 넓은 표의 여러 열을 계열로. 기본 "y" */
  y?: Accessor<T, number> | string[];
  /** 계열 필드 (긴 표) */
  series?: Accessor<T, string>;
  curve?: Curve;
  /** x 종류를 직접 정해요 */
  xType?: XType;
  /** 같은 x, 같은 계열이 여러 행일 때 합치는 방법. 기본 "sum" */
  aggregate?: Aggregate;
  /** y 범위 고정 */
  yDomain?: [number, number];
  /** y축에 0을 포함. 선 차트 기본 false, 영역 기본 true */
  zero?: boolean;
  /** "highlight"면 강조 계열만 색, 나머지는 무채색. 기본 "highlight" */
  colorMode?: "highlight" | "categorical";
  /** 오른쪽 끝 계열 이름표. 기본: 계열이 2개 이상이면 true */
  endLabels?: boolean;
  /** 이 개수보다 많으면 LTTB로 줄여요. 기본 폭의 2배 */
  maxPoints?: number;
  /** 가로 기준선 */
  referenceLines?: { y: number; label?: string }[];
  /** y축 제목 (단위 등) */
  yLabel?: string;
  /** 강조 계열. 판별 함수는 행이 아니라 계열 이름을 받아요: (name, index) => boolean. 기본 첫 계열 */
  highlight?: BaseChartProps<T>["highlight"];
  /** 주석: 목표 구간, 기간, 기준선, 사건, 예측, 추세선, 주말 음영. 화면 낭독 설명에도 들어가요 */
  annotations?: Annotation[];
  /** 강조 계열을 baseline 위아래 색으로 나눠요 (손익, 증감). 영역은 겹치기(stack "none")일 때만. 기본 false */
  signColors?: boolean;
  /** signColors의 기준값. 기본 0 */
  baseline?: number;
  /** signColors에서 기준값 아래 색. 테마 토큰이나 CSS 색. 기본 "neutralStrong" */
  downColor?: string;
  /** 범위 띠의 아래 경계 필드. 넓은 표면 y와 같은 순서의 배열, 긴 표면 필드 하나(계열은 series). upper와 함께 줘요. 쌓은 영역에서는 그리지 않아요 */
  lower?: Accessor<T, number> | string[];
  /** 범위 띠의 위 경계 필드. lower와 같은 꼴 */
  upper?: Accessor<T, number> | string[];
  /** 띠를 그리기 시작하는 x. "forecast"면 forecast 주석의 from부터예요. 기본 "start" */
  bandFrom?: "start" | "forecast";
  /** 띠 밖으로 나간 점을 표시하고 설명에 그 수를 적어요. 기본 false */
  outside?: boolean;
  /** 빠진 값(null, NaN, 그 x에 그 계열의 행이 없음)을 건너 이웃 점을 이어요. 기본 false: 선과 면이 그 자리에서 끊기고, 혼자 남은 점은 점으로 그려요. 쌓은 영역은 상관없어요 */
  connectNulls?: boolean;
}

/** 모델에서 x 인덱스 a~b(양끝 포함)만 남겨요 */
function sliceModel<T>(m: SeriesModel<T>, a: number, b: number): SeriesModel<T> {
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(m.keys.length - 1, Math.max(a, b));
  const keys = m.keys.slice(lo, hi + 1);
  return {
    type: m.type,
    keys,
    xnum: m.type === "band" ? keys.map((_, i) => i) : m.xnum.slice(lo, hi + 1),
    labels: m.labels.slice(lo, hi + 1),
    series: m.series,
    values: m.values.map((r) => r.slice(lo, hi + 1)),
    rows: m.rows.map((r) => r.slice(lo, hi + 1)),
  };
}

/** 띠를 그리기 시작하는 x 인덱스. "forecast"면 forecast 주석의 from 이상인 첫 x이고, 그런 x가 없으면 띠를 그리지 않아요 (데이터 값으로 재서 축 범위보다 먼저 정해요) */
function bandStartIndex(m: SeriesModel<unknown>, mode: XYProps["bandFrom"], from: unknown): number {
  if (mode !== "forecast") return 0;
  const n = m.keys.length;
  if (from === undefined) return n;
  if (m.type === "band") {
    const i = m.keys.indexOf(String(from));
    return i < 0 ? n : i;
  }
  const t = xNum(m.type, from);
  if (!Number.isFinite(t)) return n;
  const i = m.xnum.findIndex((v) => v >= t);
  return i < 0 ? n : i;
}

/** 설명에 붙이는 띠 문장: 칠한 범위, outside면 범위 밖 점 수와 앞 다섯 곳. 칠한 범위가 없으면 빈 글자 */
function describeBand<T>(m: SeriesModel<T>, bands: { lo: number[]; hi: number[] }[], names: readonly (readonly [string, string])[], outside: boolean, msg: (typeof MSG)[ChartLang]): string {
  // 계열이 여럿이면 어느 계열의 범위인지 같이 적어요: "p5 to p95 (Our app)"
  const named = (si: number, text: string) => (m.series.length > 1 && m.series[si] ? msg.where(text, m.series[si]) : text);
  const ranges = uniq(bands.flatMap((b, si) => (b.lo.some(Number.isFinite) ? [named(si, msg.range(...names[si]))] : [])));
  if (!ranges.length) return "";
  const text = msg.band(ranges.join(", "));
  if (!outside) return text;
  let n = 0;
  const where: string[] = [];
  bands.forEach((b, si) => {
    for (let k = 0; k < b.lo.length; k++) {
      if (!isOutside(m.values[si][k], b.lo[k], b.hi[k])) continue;
      n++;
      if (where.length < 5) where.push(named(si, m.labels[k]));
    }
  });
  return text + msg.outside(n, `${where.join(", ")}${n > where.length ? ", …" : ""}`);
}

/** 경계 필드의 이름 (툴팁, 설명). 계열마다 고르는 규칙은 boundField와 같고 함수면 fallback */
function boundName(f: unknown, s: number, wide: boolean, fallback: string): string {
  const v = boundField(f as BoundField<unknown>, s, wide);
  return typeof v === "string" && v ? v : fallback;
}

export interface LineChartProps<T = Row> extends XYProps<T> {
  /** 점 표시. "auto"는 점이 적을 때만. 기본 "auto" */
  dots?: boolean | "auto";
  /** 강조 계열 아래 그라데이션 면. 기본 false */
  area?: boolean;
}

export interface AreaChartProps<T = Row> extends XYProps<T> {
  /** "none" 겹치기 | "stacked" 쌓기 | "percent" 100% 쌓기. 기본: 계열 2개 이상이면 "stacked" */
  stack?: "none" | "stacked" | "percent";
}

interface SeriesDraw {
  s: number;
  name: string;
  pts: number[];
  xs: number[];
  base?: number[];
  sw: Swatch;
  hi: boolean;
  idx: number[];
  /** 이어 그리는 조각마다 pts 안 [시작, 끝). 빠진 값에서 끊겨요. [[0, 5], [5, 9]]면 0~4, 5~8 두 조각 */
  spans: (readonly [number, number])[];
  /** 범위 띠 모양. 위, 아래 y는 움직임 값 뒤쪽에 붙어요 */
  band?: BandShape;
  /** 띠 밖으로 나간 점 (pts 안 위치, outside 옵션) */
  out?: number[];
}

function xScaleFor(model: SeriesModel<unknown>, x0: number, x1: number): ((k: number) => number) & { v?: (t: number) => number } {
  const n = model.keys.length;
  if (model.type === "band") {
    const step = n > 1 ? (x1 - x0) / (n - 1) : 0;
    return (k: number) => (n > 1 ? x0 + k * step : (x0 + x1) / 2);
  }
  const [lo, hi] = extent(model.xnum);
  const s = scaleLinear([lo, hi === lo ? lo + 1 : hi], [x0, x1]);
  // v: x 값(날짜 ms, 숫자) → 픽셀. 주석이 데이터와 같은 자로 재요
  return Object.assign((k: number) => s(model.xnum[k]), { v: s });
}

function XAxis(props: { c: ChartCtx<unknown>; model: SeriesModel<unknown>; xs: (k: number) => number; x0: number; x1: number; y: number }) {
  const { c, model, xs, x0, x1, y } = props;
  const p = c.p;
  let ticks: { x: number; label: string }[];
  if (model.type === "date" && model.keys.length > 1) {
    const t0 = model.xnum[0];
    const t1 = model.xnum[model.xnum.length - 1];
    const maxT = Math.max(2, Math.floor((x1 - x0) / 64));
    const sx = scaleLinear([t0, t1], [x0, x1]);
    const tt = timeTicks(t0, t1, maxT, c.locale);
    if (tt.length >= 2 && model.keys.length > tt.length) ticks = tt.map((t) => ({ x: sx(t.t), label: t.label }));
    else {
      const centers = model.keys.map((_, k) => xs(k));
      ticks = thinLabels(centers, model.labels).map((k) => ({ x: centers[k], label: model.labels[k] }));
    }
  } else if (model.type === "number" && model.keys.length > 12) {
    // x 눈금은 값 포맷(format, 통화 등)이 아니라 x 숫자 그대로. 연도(1000~9999)는 쉼표 없이
    const [a, b] = extent(model.xnum);
    const sx = scaleLinear([a, b], [x0, x1]);
    const xf = a >= 1000 && b <= 9999 ? String : makeTickFormatter(undefined, c.locale, Math.max(-a, b));
    ticks = sx.ticks(Math.max(2, Math.floor((x1 - x0) / 70))).map((v) => ({ x: sx(v), label: xf(v) }));
  } else {
    const centers = model.keys.map((_, k) => xs(k));
    ticks = thinLabels(centers, model.labels).map((k) => ({ x: centers[k], label: model.labels[k] }));
  }
  const keep = fitTickLabels(ticks, -2, c.width + 2);
  return (
    <g aria-hidden="true">
      {keep.map((t, i) => (
        <Txt key={i} x={t.x} y={y} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
          {t.label}
        </Txt>
      ))}
    </g>
  );
}

function XYChart<T>(props: (LineChartProps<T> & AreaChartProps<T>) & { kind: "line" | "area" }) {
  const isArea = props.kind === "area";
  const c = useChart(props, { height: (w) => Math.max(200, Math.min(300, w * 0.5)), duration: 1100, stagger: 120 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];
  const gid = useId().replace(/:/g, "");

  const model0 = useMemo(() => prepSeries(props.data, props.x, props.y as never, props.series, { xType: props.xType, locale: c.locale, aggregate: props.aggregate }), [props.data, props.x, props.y, props.series, props.xType, c.locale, props.aggregate]);
  const nS = model0.series.length;
  const stackMode = isArea ? props.stack ?? (nS > 1 ? "stacked" : "none") : "none";
  // 확대한 구간 (model0의 x 인덱스)
  const zoom = useZoom(c.sig);
  const view = zoom.view;
  const viewed = useMemo(() => (view ? sliceModel(model0, view[0], view[1]) : model0), [model0, view]);
  // 쌓은 영역은 층이 같은 x를 써야 해서 LTTB 대신 구간 평균으로 줄여요 (2px에 한 점이면 곡선이 충분히 고와요)
  const areaBudget = Math.max(40, Math.round(props.maxPoints ?? W / 2));
  const model = useMemo(() => (stackMode !== "none" ? bucketSeries(viewed, areaBudget) : viewed), [viewed, stackMode, areaBudget]);
  // 툴팁, 이벤트의 값: 줄였으면 구간 평균이 아니라 대표 행(이름표, datum과 같은 행)의 실제 값
  const rowVals = model.rowValues ?? model.values;

  const stacked = useMemo(() => (stackMode === "none" ? null : stack(model.values, stackMode === "percent" ? "expand" : "zero")), [model, stackMode]);

  // 예측 주석이 시작하는 x (띠 시작과 예측 점선이 같이 써요)
  const fFrom = forecastFrom(props.annotations);
  // 범위 띠: 계열마다 [아래, 위] 값 (바뀐 경계는 바꿔 놓고, bandFrom 앞과 빠진 x는 NaN). 쌓은 영역에서는 그리지 않아요
  const { lower, upper } = props;
  const bandStart = bandStartIndex(model as SeriesModel<unknown>, props.bandFrom, fFrom);
  // 그릴 경계가 하나도 없으면(예: 예측 주석 없는 bandFrom "forecast") 띠가 없는 차트와 똑같이 그려요
  const bands = useMemo(() => {
    if (lower === undefined || upper === undefined || stackMode !== "none") return null;
    const b = bandBounds(model.rows, lower, upper, Array.isArray(props.y), props.data, bandStart);
    return b.some((s) => s.lo.some(Number.isFinite)) ? b : null;
  }, [model, lower, upper, props.y, props.data, stackMode, bandStart]);
  // 띠 값의 양끝은 띠가 바뀔 때만 구해요 (매 프레임 1만 칸을 allY에 넣지 않게)
  const bandYs = useMemo(() => {
    const ys: number[] = [];
    bands?.forEach((b) => b.lo.forEach((v, k) => Number.isFinite(v) && ys.push(v, b.hi[k])));
    return ys.length ? extent(ys) : ys;
  }, [bands]);

  const hi = useMemo(() => {
    const totals = model.values.map((row) => row.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0));
    return resolveHighlight(props.highlight as never, model.series as never[], model.series, totals, "first");
  }, [model, props.highlight]);

  const colors: Swatch[] = useMemo(() => {
    if (isArea) return props.colorMode === "categorical" ? categorical(p, nS, hi) : ramp(p, nS, hi);
    if (props.colorMode === "categorical") return categorical(p, nS, hi);
    const rest = swatch(p, "strong");
    const acc = swatch(p, "accent");
    return model.series.map((_, s) => (hi.has(s) ? acc : rest));
  }, [isArea, props.colorMode, p, nS, hi, model.series]);

  const allY: number[] = [];
  if (stacked) stacked.y1.forEach((r) => r.forEach((v) => allY.push(v)));
  else model.values.forEach((r) => r.forEach((v) => Number.isFinite(v) && allY.push(v)));
  // 띠도 그림 안에 (그리는 x만)
  allY.push(...bandYs);
  // 기준선(목표 등)이 데이터 밖이어도 그림 안에 들어오게
  props.referenceLines?.forEach((r) => allY.push(r.y));
  allY.push(...annotationYs(props.annotations));
  const signOn = !!props.signColors && stackMode === "none";
  const baseline = props.baseline ?? 0;
  if (signOn) allY.push(baseline);
  const [mn, mx] = extent(allY);
  const dom: [number, number] = props.yDomain ?? (stackMode === "percent" ? [0, 100] : fitDomain(mn, mx, Math.max(2, Math.round(H / 70)), { zero: props.zero ?? isArea }));
  const tickFmt = stackMode === "percent" ? (v: number) => `${v}%` : makeTickFormatter(props.format, c.locale, Math.max(Math.abs(dom[0]), Math.abs(dom[1])));
  const yTicks = scaleLinear(dom, [0, 1]).ticks(Math.max(2, Math.round(H / 70)));
  const left = yAxisWidth(yTicks, tickFmt, c.locale);
  const endLabels = props.endLabels ?? nS > 1;
  const lastIdx = (s: number) => {
    for (let k = model.keys.length - 1; k >= 0; k--) if (Number.isFinite(model.values[s][k])) return k;
    return -1;
  };
  const endW = endLabels ? Math.min(W * 0.28, Math.max(...model.series.map((s) => textWidth(s, 11, 700)), 20) + 14) : 10;
  const top = props.yLabel ? 22 : 10;
  const bottom = 22;
  const x0 = left + 6;
  const x1 = W - endW;
  const y = scaleLinear(dom, [H - bottom, top]);
  const xs = xScaleFor(model as SeriesModel<unknown>, x0, x1);
  // 포인터가 움직일 때마다 만들지 않아요 (1만 점이면 한 번에 1만 칸)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const centers = useMemo(() => model.keys.map((_, k) => xs(k)), [model, x0, x1]);
  const maxPts = props.maxPoints ?? Math.max(60, Math.round((x1 - x0) * 2));
  const curve = props.curve ?? "smooth";
  // 영역의 바닥: 0을 축 범위 안으로 (값이 모두 음수면 위 끝, 모두 양수면 아래 끝)
  const base0 = Math.min(dom[1], Math.max(dom[0], 0));
  const down = p.color(props.downColor, "neutralStrong");
  const yb = y(baseline);

  // 주석의 x 값: 범주는 칸 순서, 날짜와 숫자는 데이터와 같은 규칙으로 읽은 값 (xv가 픽셀로)
  const xv = xs.v;
  const xn = (v: unknown) => (xv ? xNum(model.type, v) : model.keys.indexOf(String(v)));
  const xAt = (v: unknown): number | null => {
    const n = xn(v);
    return xv ? (Number.isFinite(n) ? xv(n) : null) : n < 0 ? null : xs(n);
  };
  const last = model.xnum.length - 1;
  const geom: AnnotationGeom = {
    p,
    lang: c.lang,
    xAt,
    y,
    x0,
    x1,
    top,
    bottom: H - bottom,
    half: xv || last < 1 ? 0 : (xs(1) - xs(0)) / 2,
    time: model.type === "date" && xv && last > 0 ? { t0: model.xnum[0], t1: model.xnum[last], n: last + 1, xt: xv } : undefined,
    points: () => {
      const hs = [...hi][0] ?? 0;
      return centers.map((x, k) => ({ x, y: y(stacked ? stacked.y1[hs][k] : model.values[hs][k]) }));
    },
  };
  // 예측 구간: 이 x부터 선을 점선으로 (데이터 밖이면 없어요)
  const xf = forecastX(geom, fFrom);
  // 주석 설명의 x: 데이터에 있는 x면 화면 이름표("Mar")로
  const xText = (v: unknown) => {
    const n = xn(v);
    const k = xv ? model.xnum.indexOf(n) : n;
    return k >= 0 ? model.labels[k] : String(v ?? "");
  };
  const toneOf = (si: number, v: number) => (signOn && hi.has(si) && v < baseline ? down : colors[si].fill);

  // 빠진 값에서 선과 면을 끊어요. connectNulls면 예전처럼 이웃 점을 잇고, 쌓은 영역은 늘 예전 그대로예요.
  // x가 하나뿐이면 빠진 값으로 끊길 곳이 없어서 예전과 같아요 (그 점 하나에 점을 찍지 않아요)
  const breaks = !props.connectNulls && !stacked && model.keys.length > 1;

  const draws = useMemo<SeriesDraw[]>(() => {
    return model.series.map((name, s) => {
      const val = (k: number) => (stacked ? stacked.y1[s][k] : model.values[s][k]);
      // 값이 있는 x를 이어진 조각으로 모아요. 끊지 않으면 조각 하나예요
      let parts: number[][] = [];
      for (let k = 0; k < model.keys.length; k++) {
        if (!Number.isFinite(val(k))) continue;
        const last = parts[parts.length - 1];
        if (last && (!breaks || last[last.length - 1] === k - 1)) last.push(k);
        else parts.push([k]);
      }
      const count = parts.reduce((t, q) => t + q.length, 0);
      // 조각이 여럿이면 조각마다 따로 줄여요 (빠진 x를 건너 잇지 않게). 몫은 점 수에 비례하고, 조각마다 양끝과 가장 두드러진 점 하나는 남아요. 조각이 하나면 예전처럼 maxPts예요
      if (count > maxPts) parts = parts.map((q) => lttb(q.map((k) => ({ x: xs(k), y: val(k), k })), parts.length > 1 ? Math.max(3, Math.round((maxPts * q.length) / count)) : maxPts).map((o) => o.k));
      const idx = parts.flat();
      let at = 0;
      const spans = parts.map((q) => [at, (at += q.length)] as const);
      const pts = idx.map((k) => y(val(k)));
      const base = stacked ? idx.map((k) => y(stacked.y0[s][k])) : isArea ? idx.map(() => y(base0)) : undefined;
      const draw: SeriesDraw = { s, name, pts, xs: idx.map((k) => xs(k)), base, sw: colors[s], hi: hi.has(s), idx, spans };
      const b = bands?.[s];
      const band = b ? bandShape(xs, b.lo, b.hi, y, maxPts) : null;
      if (!b || !band) return draw;
      // 띠 밖 점은 그린 선의 점(줄인 뒤 남은 점)에서 찾아요
      const out = props.outside ? idx.flatMap((k, i) => (isOutside(model.values[s][k], b.lo[k], b.hi[k]) ? [i] : [])) : undefined;
      return { ...draw, band, out };
    });
    // xs, y는 아래 값들로 정해져요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, stacked, colors, hi, x0, x1, H, dom[0], dom[1], maxPts, isArea, bands, props.outside, breaks]);

  const stg = c.motion.stagger ?? 120;
  const order = useMemo(() => [...draws].sort((a, b) => Number(a.hi) - Number(b.hi)), [draws]);
  const marks = useMemo<Mark<SeriesDraw>[]>(
    () =>
      order.map((d, k) => {
        const baseLine = y(base0);
        // 띠의 위, 아래 y는 선 값 뒤에 붙여 같이 움직여요 (데이터가 바뀌면 띠도 선과 함께 미끄러져요)
        const band = d.band ? [...d.band.top, ...d.band.bottom] : [];
        const bandParts = d.band ? [d.band.top.length, d.band.bottom.length] : [];
        if (isArea) {
          const b = d.base ?? d.pts.map(() => baseLine);
          // 영역은 바닥에서 차오르고 띠도 함께 올라와요
          return { key: `s:${d.name}`, to: [1, ...d.pts, ...b, ...band], from: [0, ...d.pts.map(() => baseLine), ...b.map(() => baseLine), ...band.map(() => baseLine)], delay: k * stg * 0.5, parts: [1, d.pts.length, b.length, ...bandParts], data: d };
        }
        return { key: `s:${d.name}`, to: [1, ...d.pts, ...band], from: [0, ...d.pts, ...band], enter: [0, ...d.pts, ...band], delay: k * stg, parts: [1, d.pts.length, ...bandParts], data: d };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, stg, isArea, H, base0],
  );
  const m = useMotion(marks, c.motion);

  const fv = c.fv;
  const fmt = c.fmt;
  // 띠 글: 계열마다 경계 이름으로 x마다 범위 글과 설명 문장을 만들어요. 이름 없는 계열(긴 표 하나)은 y 필드 이름으로 읽어요
  const bandText = useMemo(() => {
    if (!bands) return null;
    const wide = Array.isArray(props.y);
    const names = model.series.map((_, si) => [boundName(lower, si, wide, msg.lower), boundName(upper, si, wide, msg.upper)] as const);
    // 툴팁, 라이브 영역, 숨긴 표의 범위 글: " (p5 410 ~ p95 2,300)". 단위는 값에만 붙여요. 범위가 없는 x는 빈 글자
    const range = (si: number, k: number) => (Number.isFinite(bands[si].lo[k]) ? ` (${names[si][0]} ${fmt(bands[si].lo[k])} ~ ${names[si][1]} ${fmt(bands[si].hi[k])})` : "");
    return { range, unnamed: typeof props.y === "string" ? props.y : undefined, desc: describeBand(model, bands, names, props.outside === true, msg) };
  }, [bands, props.y, model, lower, upper, msg, fmt, props.outside]);
  const events: ChartEvent<T>[] = useMemo(() => {
    const hs = [...hi][0] ?? 0;
    // 툴팁과 같은 순서: 값 다음에 범위
    const line = (s: string, si: number, k: number) => {
      const name = s || bandText?.unnamed;
      return `${name ? `${name} ` : ""}${fv(rowVals[si][k])}${bandText?.range(si, k) ?? ""}`;
    };
    return lazyArray(model.keys.length, (k) => {
      const v = rowVals[hs]?.[k];
      return {
        datum: model.rows[hs]?.[k] ?? null,
        index: k,
        key: model.keys[k],
        label: model.labels[k],
        value: Number.isFinite(v) ? v : null,
        formatted: model.series
          .map((s, si) => (Number.isFinite(rowVals[si][k]) ? line(s, si, k) : null))
          .filter(Boolean)
          .join(", "),
      };
    });
  }, [model, rowVals, hi, fv, bandText]);

  // 확대 전 전체 순서는 구간을 정할 때만 찾아요
  const fullIndexOf = (key: string, fallback: number) => {
    const i = model0.keys.indexOf(key);
    return i < 0 ? fallback : i;
  };
  const { brush, frame: brushFrame, hint, text: brushText } = useChartBrush(props, zoom, {
    p,
    active: c.active,
    lang: c.lang,
    count: model.keys.length,
    indexAt: (px) => nearestIndex(centers, px),
    inPlot: (px, py) => px >= x0 - 4 && px <= x1 + 4 && py >= top && py <= H - bottom,
    toXRange: (r) => {
      const fk = model.keys[r.from];
      const tk = model.keys[r.to];
      return { from: fullIndexOf(fk, r.from), to: fullIndexOf(tk, r.to), fromKey: fk, toKey: tk, fromLabel: model.labels[r.from], toLabel: model.labels[r.to] };
    },
  });

  const activeK = c.active;
  useSync(c, props.syncId, model.keys, model.labels);
  let tip: TooltipData | null = null;
  if (activeK !== null && model.keys[activeK] !== undefined && !brush.dragging) {
    // 100% 쌓기의 몫도 그 행의 값을 같은 규칙으로 쌓아요 (줄이지 않았으면 그림의 몫과 같아요)
    const share = stackMode === "percent" ? stack(rowVals.map((r) => [r[activeK]]), "expand") : null;
    const rows = model.series
      .map((s, si) => ({ s, si, v: rowVals[si][activeK] }))
      .filter((r) => Number.isFinite(r.v))
      .sort((a, b) => b.v - a.v)
      .map((r) => {
        // 범위는 값 뒤에 흐리게: "820ms (p5 410 ~ p95 2,300)"
        const range = bandText?.range(r.si, activeK);
        const value = share ? `${Math.round(share.y1[r.si][0] - share.y0[r.si][0])}% · ${c.fv(r.v)}` : c.fv(r.v);
        return { label: r.s || bandText?.unnamed || c.t.value, value: range ? <>{value}<span style={{ fontWeight: 500, color: p.paint("muted") }}>{range}</span></> : value, color: toneOf(r.si, r.v), strong: hi.has(r.si) };
      });
    const yy = Math.min(...model.series.map((_, si) => (stacked ? y(stacked.y1[si][activeK]) : Number.isFinite(model.values[si][activeK]) ? y(model.values[si][activeK]) : H)));
    tip = { x: xs(activeK), y: Math.max(top, yy), title: model.labels[activeK], rows: capTipRows(rows, c.t.more) };
  }

  const onMove = (px: number) => {
    if (!model.keys.length) return;
    const k = nearestIndex(centers, px);
    if (k >= 0 && k !== c.active) c.setActive(k, "pointer");
  };

  // 고른 구간: 강조 계열의 등락과 최고, 최저
  let brushLayer: ReactNode = null;
  let announce: string | undefined;
  if (brush.range && brush.range.to < model.keys.length) {
    const { from, to } = brush.range;
    const hs = [...hi][0] ?? 0;
    const vals = model.values[hs] ?? [];
    let first = NaN;
    let last = NaN;
    let maxK = -1;
    let minK = -1;
    for (let k = from; k <= to; k++) {
      const v = vals[k];
      if (!Number.isFinite(v)) continue;
      if (!Number.isFinite(first)) first = v;
      last = v;
      if (maxK < 0 || v > vals[maxK]) maxK = k;
      if (minK < 0 || v < vals[minK]) minK = k;
    }
    const ratio = changeRatio(first, last);
    const main = ratio !== null ? signedPercent(ratio, c.locale) : Number.isFinite(last - first) ? `${last - first >= 0 ? "+" : ""}${c.fv(last - first)}` : "-";
    const sub = brushText.range(model.labels[from], model.labels[to]);
    const yAt = (k: number) => y(stacked ? stacked.y1[hs][k] : vals[k]);
    const plotBottom = H - bottom;
    brushLayer = (
      <>
        <BrushBand p={p} x0={centers[from]} x1={centers[to]} top={top} bottom={plotBottom} width={W} main={main} sub={sub} dragging={brush.dragging} />
        {maxK >= 0 && minK >= 0 && maxK !== minK ? (
          <ExtremeTags p={p} lang={c.lang} width={W} top={top} bottom={plotBottom} max={{ x: centers[maxK], y: yAt(maxK), text: c.fv(vals[maxK]) }} min={{ x: centers[minK], y: yAt(minK), text: c.fv(vals[minK]) }} />
        ) : null}
      </>
    );
    if (!brush.dragging) announce = `${msg.span(sub, main)}${maxK >= 0 ? brushText.extremes(c.fv(vals[maxK]), c.fv(vals[minK])) : ""}.${hint}`;
  }

  // 끝 라벨 위치
  const ends = endLabels
    ? (() => {
        const list = draws
          .map((d) => {
            const li = lastIdx(d.s);
            if (li < 0) return null;
            const vy = stacked ? y((stacked.y0[d.s][li] + stacked.y1[d.s][li]) / 2) : y(model.values[d.s][li]);
            return { d, y: vy };
          })
          .filter((v): v is { d: SeriesDraw; y: number } => v !== null);
        const ys = dodgeVertical(
          list.map((l) => l.y),
          14,
          top + 4,
          H - bottom - 2,
        );
        return list.map((l, i) => ({ ...l, ly: ys[i] }));
      })()
    : [];

  const D = c.motion.duration ?? 1100;
  const dots = props.dots ?? "auto";
  const showDots = dots === true || (dots === "auto" && !isArea && model.keys.length <= 16);
  const kindName = isArea ? msg.area : msg.line;
  const desc = props.description ?? `${kindName}. ${msg.desc(nS, model.series.filter(Boolean).join(", ") || c.t.value, model.labels[0] ?? "", model.labels[model.labels.length - 1] ?? "", model.keys.length)}.${bandText?.desc ?? ""}${describeAnnotations(props.annotations, c.lang, c.fv, xText)}`;

  const pieces: ReactNode[] = [];
  // 띠는 모든 선 아래 한 층에 깔아요 (다른 계열의 선을 덮지 않게)
  const bandLayer: ReactNode[] = [];
  for (const it of m.items) {
    const d = it.data;
    const v = it.v;
    const n = d.xs.length;
    const draw = v[0];
    const ys = v.slice(1, 1 + n);
    const pts = d.xs.map((xx, i) => [xx, ys[i] ?? ys[ys.length - 1] ?? 0] as [number, number]);
    const sign = signOn && d.hi;
    // 선과 면은 조각마다 하위 경로 하나라서, 조각이 하나면 예전과 같은 path예요
    const spans = d.spans;
    const lines = spans.map(([a, b]) => linePath(pts.slice(a, b), curve));
    // 손익 색: 선에서 기준값까지 칠한 영역 하나를 위아래 자르기 영역으로 나눠 칠해요 (바닥이 평평해서 조각마다 V, H로 닫아요)
    const signArea = sign ? spans.map(([a], r) => `${lines[r]}V${r2(yb)}H${r2(d.xs[a])}Z`).join("") : "";
    // 면: 조각마다 선을 위 경계로, bottom을 아래 경계로 닫아요
    const areaD = (bottom: [number, number][]) => spans.map(([a, b]) => areaPath(pts.slice(a, b), bottom.slice(a, b), curve)).join("");
    // 이웃 없이 혼자 남은 점은 선으로 보이지 않아서 점을 찍어요 (connectNulls면 예전처럼 찍지 않아요)
    const lone = breaks ? spans.filter(([a, b]) => b - a === 1).map(([a]) => a) : [];
    const dot = (i: number, opacity: number) => {
      const [xx, yy] = pts[i];
      const col = sign && yy > yb ? down : d.sw.fill;
      return <circle key={i} cx={xx} cy={yy} r={d.hi ? 3 : 2.2} fill={d.hi ? col : p.paint("panel")} stroke={col} strokeWidth={d.hi ? 0 : 1.4} opacity={opacity} />;
    };
    if (d.band) {
      // 움직임 값: [진행, 선 y…, (영역 바닥 y…), 띠 위 y…, 띠 아래 y…]
      const o = 1 + (isArea ? 2 * n : n);
      const nb = d.band.top.length;
      bandLayer.push(<path key={it.key} d={bandPath(d.band, v.slice(o, o + nb), v.slice(o + nb, o + 2 * nb), curve)} fill={d.sw.fill} opacity={0.16 * draw * (it.exiting ? 0.4 : 1)} />);
    }
    // 띠 밖으로 나간 점: 계열 색 점에 바탕색 테두리를 둘러 선 위에서도 보여요
    const outsideDots = (opacity: (i: number) => number) =>
      d.out?.map((i) => {
        const [xx, yy] = pts[i];
        return <circle key={`o${i}`} cx={xx} cy={yy} r={3.6} fill={sign && yy > yb ? down : d.sw.fill} stroke={p.paint("panel")} strokeWidth={1.5} opacity={opacity(i)} />;
      });
    if (isArea) {
      const bs = v.slice(1 + n, 1 + 2 * n);
      const bottomPts = d.xs.map((xx, i) => [xx, bs[i] ?? y(base0)] as [number, number]);
      const lp = lines.join("");
      const fills = sign ? (["up", "dn"] as const).map((t) => <path key={t} d={signArea} fill={t === "up" ? d.sw.fill : down} opacity={0.5} clipPath={`url(#${gid}${t})`} />) : <path d={areaD(bottomPts)} fill={d.sw.fill} opacity={stackMode === "none" ? (d.hi ? 0.5 : 0.28) : 1} />;
      const stroke = (dashed: boolean) =>
        (sign ? (["up", "dn"] as const) : ([null] as const)).map((t) => (
          <path key={t ?? "s"} d={lp} fill="none" stroke={t === "dn" ? down : stackMode === "none" ? d.sw.fill : p.paint("panel")} strokeWidth={stackMode === "none" ? (d.hi ? 2.2 : 1.4) : 1.2} strokeLinejoin="round" strokeDasharray={dashed ? "5 4" : undefined} opacity={Math.min(1, draw * 1.4)} clipPath={t ? `url(#${gid}${t})` : undefined} />
        ));
      pieces.push(
        <g key={it.key} opacity={it.exiting ? 0.4 : 1}>
          {fills}
          {xf !== null ? (
            <>
              <g clipPath={`url(#${gid}pre)`}>{stroke(false)}</g>
              <g clipPath={`url(#${gid}post)`}>{stroke(true)}</g>
            </>
          ) : (
            stroke(false)
          )}
          {lone.map((i) => dot(i, Math.min(1, draw * 1.4)))}
          {outsideDots(() => Math.min(1, draw * 1.4))}
        </g>,
      );
    } else {
      const width = d.hi ? 2.6 : 1.7;
      const dash = draw < 0.999;
      // 점은 선이 그 자리까지 그려질 때 나타나요
      const appear = (i: number) => Math.max(0, Math.min(1, (draw - (n > 1 ? i / (n - 1) : 1)) * 8 + (draw >= 0.999 ? 1 : 0)));
      // 그리기 점선은 하위 경로마다 처음부터 다시 시작해서, 조각이 여럿이면 그리는 동안만 조각마다 path를 따로 둬요.
      // 조각은 점 순서로 제 차례에 그려져서 왼쪽부터 한 번에 긋는 것처럼 보여요 (점이 나타나는 때와 같아요)
      const segs: (readonly [string, number])[] = dash && spans.length > 1 ? spans.flatMap(([a, b], r) => (b - a > 1 ? [[lines[r], Math.max(0, Math.min(1, (draw * (n - 1) - a) / (b - 1 - a)))] as const] : [])) : [[lines.join(""), draw]];
      // 그려지는 중에는 그리기 점선(1 1), 다 그린 뒤 예측 구간은 5 4 점선. 손익 색은 기준값 위아래를 자르기 영역으로 나눠 칠해요
      const stroke = (dashed: boolean) =>
        (sign ? (["up", "dn"] as const) : ([null] as const)).flatMap((t) =>
          segs.map(([sd, sp], j) => (
            <path key={`${t ?? "s"}${j}`} d={sd} fill="none" stroke={t === "dn" ? down : d.sw.fill} strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" pathLength={dash ? 1 : undefined} strokeDasharray={dash ? "1 1" : dashed ? "5 4" : undefined} strokeDashoffset={dash ? 1 - sp : undefined} clipPath={t ? `url(#${gid}${t})` : undefined} />
          )),
        );
      const under = props.area && d.hi ? (sign ? (["up", "dn"] as const).map((t) => <path key={t} d={signArea} fill={t === "up" ? d.sw.fill : down} opacity={0.16 * draw} clipPath={`url(#${gid}${t})`} />) : <path d={areaD(pts.map(([xx]) => [xx, y(base0)] as [number, number]))} fill={`url(#${gid}g)`} opacity={draw} />) : null;
      pieces.push(
        <g key={it.key} opacity={it.exiting ? 0.4 : 1}>
          {under}
          {xf !== null ? (
            <>
              <g clipPath={`url(#${gid}pre)`}>{stroke(false)}</g>
              <g clipPath={`url(#${gid}post)`}>{stroke(true)}</g>
            </>
          ) : (
            stroke(false)
          )}
          {(showDots ? pts.map((_, i) => i) : lone).map((i) => dot(i, appear(i)))}
          {outsideDots(appear)}
        </g>,
      );
    }
  }

  return (
    <ChartFrame
      c={c}
      kind={kindName}
      ariaLabel={props.ariaLabel}
      description={desc}
      events={events}
      tip={tip}
      renderTip={props.tooltip}
      className={props.className}
      style={props.style}
      theme={props.theme}
      onPointerMove={(px, _py, e) => {
        // 끄는 중에도 가리킨 점은 따라가요 (끌기는 마우스, 펜만)
        brush.move(px);
        if (e.pointerType === "touch") c.setActive(nearestIndex(centers, px), "touch");
        else onMove(px);
      }}
      {...brushFrame}
      announce={announce}
      defs={
        props.area || xf !== null || signOn ? (
          <>
            {props.area ? (
              <linearGradient id={`${gid}g`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={p.paint("accent")} stopOpacity={0.28} />
                <stop offset="100%" stopColor={p.paint("accent")} stopOpacity={0} />
              </linearGradient>
            ) : null}
            {xf !== null ? (
              <>
                <clipPath id={`${gid}pre`}>
                  <rect x={-W} y={-H} width={W + xf} height={H * 3} />
                </clipPath>
                <clipPath id={`${gid}post`}>
                  <rect x={xf} y={-H} width={W * 2} height={H * 3} />
                </clipPath>
              </>
            ) : null}
            {signOn ? (
              <>
                <clipPath id={`${gid}up`}>
                  <rect x={-W} y={-H} width={W * 3} height={H + yb} />
                </clipPath>
                <clipPath id={`${gid}dn`}>
                  <rect x={-W} y={yb} width={W * 3} height={H * 2} />
                </clipPath>
              </>
            ) : null}
          </>
        ) : null
      }
    >
      {props.yLabel ? (
        <Txt x={left} y={6} anchor="start" size={10.5} fill={p.paint("muted")}>
          {props.yLabel}
        </Txt>
      ) : null}
      <GridY p={p} ticks={yTicks} y={y} x0={left} x1={x1 + 4} fmt={tickFmt} locale={c.locale} />
      <AnnotationsUnder list={props.annotations} g={geom} />
      {signOn ? <line x1={x0} x2={x1} y1={yb} y2={yb} stroke={p.paint("dim")} pointerEvents="none" /> : null}
      {props.referenceLines?.map((r, i) => (
        <line key={i} x1={x0} x2={x1} y1={y(r.y)} y2={y(r.y)} stroke={p.paint("dim")} strokeDasharray="3 3" />
      ))}
      <rect x={x0} y={top} width={Math.max(0, x1 - x0)} height={Math.max(0, H - bottom - top)} fill="transparent" />
      {bandLayer}
      {pieces}
      <AnnotationsOver list={props.annotations} g={geom} />
      {activeK !== null && model.keys[activeK] !== undefined ? (
        <HoverLine
          p={p}
          x={xs(activeK)}
          top={top}
          bottom={H - bottom}
          dots={model.series.flatMap((_, si) => {
            const v = stacked ? stacked.y1[si][activeK] : model.values[si][activeK];
            return Number.isFinite(v) ? [{ k: si, y: y(v), color: toneOf(si, v), strong: hi.has(si) }] : [];
          })}
        />
      ) : null}
      {props.referenceLines?.map((r, i) =>
        r.label ? (
          // 선이 지나갈 수 있어서 카드 바탕색 받침 위에 써요
          <g key={`rl${i}`} pointerEvents="none">
            <rect x={x1 - textWidth(r.label, 10.5) - 8} y={y(r.y) - 17} width={textWidth(r.label, 10.5) + 8} height={15} rx={5} fill={p.paint("panel")} opacity={0.94} />
            <Txt x={x1 - 4} y={y(r.y) - 9.5} anchor="end" size={10.5} fill={p.paint("muted")}>
              {r.label}
            </Txt>
          </g>
        ) : null,
      )}
      {ends.map((e) => (
        <Txt key={e.d.name} x={x1 + 8} y={e.ly} size={11} weight={e.d.hi ? 800 : 500} fill={p.paint(e.d.hi ? "ink" : "muted")} opacity={m.fade(D * 0.75, 300)}>
          {truncate(e.d.name, endW - 10, 11, e.d.hi ? 800 : 500)}
        </Txt>
      ))}
      {brushLayer}
      <XAxis c={c as ChartCtx<unknown>} model={model as SeriesModel<unknown>} xs={xs} x0={x0} x1={x1} y={H - bottom + 13} />
      {activeK !== null && model.keys[activeK] !== undefined && !brush.dragging ? <AxisPill p={p} x={xs(activeK)} y={H - bottom + 13} label={model.labels[activeK]} width={W} /> : null}
    </ChartFrame>
  );
}

/** 라인 차트: 시간에 따른 변화. 강조 계열 하나만 색으로 */
export function LineChart<T = Row>(props: LineChartProps<T>) {
  return <XYChart {...props} kind="line" />;
}

/** 영역 차트: 누적 합과 구성 변화 (쌓기, 100% 쌓기) */
export function AreaChart<T = Row>(props: AreaChartProps<T>) {
  return <XYChart {...props} kind="area" />;
}

export { xScaleFor, XAxis };
