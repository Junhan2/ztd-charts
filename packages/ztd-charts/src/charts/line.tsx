import { useId, useMemo, type ReactNode } from "react";
import { AXIS_FONT, fitTickLabels, GridY, thinLabels, yAxisWidth } from "../core/axis";
import { BrushBand, changeRatio, ExtremeTags, signedPercent, useChartBrush, useZoom, type BrushProps } from "../core/brush";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { makeTickFormatter } from "../core/format";
import { areaPath, linePath, nearestIndex, type Curve } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { categorical, ramp, swatch, type Swatch } from "../core/palette";
import { extent, fitDomain, scaleLinear, timeTicks } from "../core/scale";
import { bucketSeries, prepSeries, type SeriesModel, type XType } from "../core/series";
import { dodgeVertical, textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { lazyArray } from "../core/lazy";
import { useChart, type ChartCtx } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { lttb } from "../data/parse";
import { stack } from "../layout/stack";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  line: "Line chart",
  area: "Area chart",
  /** 고른 구간을 읽어 줄 때 앞부분 */
  span: (range: string, change: string) => `${range}: ${change}`,
  desc: (nS: number, names: string, from: string, to: string, n: number) => `${plural(nS, "series", "series")} (${names}), x from ${from} to ${to}, ${plural(n, "point")}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    line: "라인 차트",
    area: "영역 차트",
    span: (range, change) => `${range} 구간 ${change}`,
    desc: (nS, names, from, to, n) => `계열 ${nS}개(${names}), x ${from}부터 ${to}까지 ${n}개 지점`,
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
}

function xScaleFor(model: SeriesModel<unknown>, x0: number, x1: number) {
  const n = model.keys.length;
  if (model.type === "band") {
    const step = n > 1 ? (x1 - x0) / (n - 1) : 0;
    return (k: number) => (n > 1 ? x0 + k * step : (x0 + x1) / 2);
  }
  const [lo, hi] = extent(model.xnum);
  const s = scaleLinear([lo, hi === lo ? lo + 1 : hi], [x0, x1]);
  return (k: number) => s(model.xnum[k]);
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

  const model0 = useMemo(() => prepSeries(props.data, props.x, props.y as never, props.series, { xType: props.xType, locale: c.locale }), [props.data, props.x, props.y, props.series, props.xType, c.locale]);
  const nS = model0.series.length;
  const stackMode = isArea ? props.stack ?? (nS > 1 ? "stacked" : "none") : "none";
  // 확대한 구간 (model0의 x 인덱스)
  const zoom = useZoom(c.sig);
  const view = zoom.view;
  const viewed = useMemo(() => (view ? sliceModel(model0, view[0], view[1]) : model0), [model0, view]);
  // 쌓은 영역은 층이 같은 x를 써야 해서 LTTB 대신 구간 평균으로 줄여요 (2px에 한 점이면 곡선이 충분히 고와요)
  const areaBudget = Math.max(40, Math.round(props.maxPoints ?? W / 2));
  const model = useMemo(() => (stackMode !== "none" ? bucketSeries(viewed, areaBudget) : viewed), [viewed, stackMode, areaBudget]);

  const stacked = useMemo(() => (stackMode === "none" ? null : stack(model.values, stackMode === "percent" ? "expand" : "zero")), [model, stackMode]);

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
  // 기준선(목표 등)이 데이터 밖이어도 그림 안에 들어오게
  props.referenceLines?.forEach((r) => allY.push(r.y));
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

  const draws = useMemo<SeriesDraw[]>(() => {
    return model.series.map((name, s) => {
      let idx: number[] = [];
      for (let k = 0; k < model.keys.length; k++) {
        const v = stacked ? stacked.y1[s][k] : model.values[s][k];
        if (Number.isFinite(v)) idx.push(k);
      }
      if (idx.length > maxPts) {
        const pts = idx.map((k) => ({ x: xs(k), y: stacked ? stacked.y1[s][k] : model.values[s][k], k }));
        idx = lttb(pts, maxPts).map((q) => q.k);
      }
      const pts = idx.map((k) => y(stacked ? stacked.y1[s][k] : model.values[s][k]));
      const base = stacked ? idx.map((k) => y(stacked.y0[s][k])) : isArea ? idx.map(() => y(base0)) : undefined;
      return { s, name, pts, xs: idx.map((k) => xs(k)), base, sw: colors[s], hi: hi.has(s), idx };
    });
    // xs, y는 아래 값들로 정해져요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, stacked, colors, hi, x0, x1, H, dom[0], dom[1], maxPts, isArea]);

  const stg = c.motion.stagger ?? 120;
  const order = useMemo(() => [...draws].sort((a, b) => Number(a.hi) - Number(b.hi)), [draws]);
  const marks = useMemo<Mark<SeriesDraw>[]>(
    () =>
      order.map((d, k) => {
        const baseLine = y(base0);
        if (isArea) {
          const b = d.base ?? d.pts.map(() => baseLine);
          return { key: `s:${d.name}`, to: [1, ...d.pts, ...b], from: [0, ...d.pts.map(() => baseLine), ...b.map(() => baseLine)], delay: k * stg * 0.5, parts: [1, d.pts.length, b.length], data: d };
        }
        return { key: `s:${d.name}`, to: [1, ...d.pts], from: [0, ...d.pts], enter: [0, ...d.pts], delay: k * stg, parts: [1, d.pts.length], data: d };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, stg, isArea, H, base0],
  );
  const m = useMotion(marks, c.motion);

  const fv = c.fv;
  const events: ChartEvent<T>[] = useMemo(() => {
    const hs = [...hi][0] ?? 0;
    return lazyArray(model.keys.length, (k) => {
      const v = model.values[hs]?.[k];
      return {
        datum: model.rows[hs]?.[k] ?? null,
        index: k,
        key: model.keys[k],
        label: model.labels[k],
        value: Number.isFinite(v) ? v : null,
        formatted: model.series
          .map((s, si) => (Number.isFinite(model.values[si][k]) ? `${s ? `${s} ` : ""}${fv(model.values[si][k])}` : null))
          .filter(Boolean)
          .join(", "),
      };
    });
  }, [model, hi, fv]);

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
  let tip: TooltipData | null = null;
  if (activeK !== null && model.keys[activeK] !== undefined && !brush.dragging) {
    const rows = model.series
      .map((s, si) => ({ s, si, v: model.values[si][activeK] }))
      .filter((r) => Number.isFinite(r.v))
      .sort((a, b) => b.v - a.v)
      .slice(0, 8)
      .map((r) => ({ label: r.s || c.t.value, value: stackMode === "percent" && stacked ? `${Math.round(stacked.y1[r.si][activeK] - stacked.y0[r.si][activeK])}% · ${c.fv(r.v)}` : c.fv(r.v), color: colors[r.si].fill, strong: hi.has(r.si) }));
    const yy = Math.min(...model.series.map((_, si) => (stacked ? y(stacked.y1[si][activeK]) : Number.isFinite(model.values[si][activeK]) ? y(model.values[si][activeK]) : H)));
    tip = { x: xs(activeK), y: Math.max(top, yy), title: model.labels[activeK], rows };
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
  const desc = props.description ?? `${kindName}. ${msg.desc(nS, model.series.filter(Boolean).join(", ") || c.t.value, model.labels[0] ?? "", model.labels[model.labels.length - 1] ?? "", model.keys.length)}.`;

  const pieces: ReactNode[] = [];
  for (const it of m.items) {
    const d = it.data;
    const v = it.v;
    const n = d.xs.length;
    const draw = v[0];
    const ys = v.slice(1, 1 + n);
    const pts = d.xs.map((xx, i) => [xx, ys[i] ?? ys[ys.length - 1] ?? 0] as [number, number]);
    if (isArea) {
      const bs = v.slice(1 + n, 1 + 2 * n);
      const bottomPts = d.xs.map((xx, i) => [xx, bs[i] ?? y(base0)] as [number, number]);
      pieces.push(
        <g key={it.key} opacity={it.exiting ? 0.4 : 1}>
          <path d={areaPath(pts, bottomPts, curve)} fill={d.sw.fill} opacity={stackMode === "none" ? (d.hi ? 0.5 : 0.28) : 1} />
          <path d={linePath(pts, curve)} fill="none" stroke={stackMode === "none" ? d.sw.fill : p.paint("panel")} strokeWidth={stackMode === "none" ? (d.hi ? 2.2 : 1.4) : 1.2} strokeLinejoin="round" opacity={Math.min(1, draw * 1.4)} />
        </g>,
      );
    } else {
      const width = d.hi ? 2.6 : 1.7;
      const dash = draw < 0.999;
      pieces.push(
        <g key={it.key} opacity={it.exiting ? 0.4 : 1}>
          {props.area && d.hi ? <path d={areaPath(pts, pts.map(([xx]) => [xx, y(base0)] as [number, number]), curve)} fill={`url(#${gid}g)`} opacity={draw} /> : null}
          <path d={linePath(pts, curve)} fill="none" stroke={d.sw.fill} strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" pathLength={dash ? 1 : undefined} strokeDasharray={dash ? "1 1" : undefined} strokeDashoffset={dash ? 1 - draw : undefined} />
          {showDots
            ? pts.map(([xx, yy], i) => {
                const f = n > 1 ? i / (n - 1) : 1;
                const o = Math.max(0, Math.min(1, (draw - f) * 8 + (draw >= 0.999 ? 1 : 0)));
                return <circle key={i} cx={xx} cy={yy} r={d.hi ? 3 : 2.2} fill={d.hi ? d.sw.fill : p.paint("panel")} stroke={d.sw.fill} strokeWidth={d.hi ? 0 : 1.4} opacity={Math.min(1, o)} />;
              })
            : null}
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
        props.area ? (
          <linearGradient id={`${gid}g`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={p.paint("accent")} stopOpacity={0.28} />
            <stop offset="100%" stopColor={p.paint("accent")} stopOpacity={0} />
          </linearGradient>
        ) : null
      }
    >
      {props.yLabel ? (
        <Txt x={left} y={6} anchor="start" size={10.5} fill={p.paint("muted")}>
          {props.yLabel}
        </Txt>
      ) : null}
      <GridY p={p} ticks={yTicks} y={y} x0={left} x1={x1 + 4} fmt={tickFmt} locale={c.locale} />
      {props.referenceLines?.map((r, i) => (
        <line key={i} x1={x0} x2={x1} y1={y(r.y)} y2={y(r.y)} stroke={p.paint("dim")} strokeDasharray="3 3" />
      ))}
      <rect x={x0} y={top} width={Math.max(0, x1 - x0)} height={Math.max(0, H - bottom - top)} fill="transparent" />
      {pieces}
      {activeK !== null && model.keys[activeK] !== undefined ? (
        <g pointerEvents="none">
          <line x1={xs(activeK)} x2={xs(activeK)} y1={top} y2={H - bottom} stroke={p.paint("dim")} strokeWidth={1} />
          {model.series.map((_, si) => {
            const v = stacked ? stacked.y1[si][activeK] : model.values[si][activeK];
            if (!Number.isFinite(v)) return null;
            return <circle key={si} cx={xs(activeK)} cy={y(v)} r={hi.has(si) ? 4.2 : 3.2} fill={colors[si].fill} stroke={p.paint("panel")} strokeWidth={2} />;
          })}
        </g>
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
