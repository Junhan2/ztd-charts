import { useMemo } from "react";
import type { DayFirstProps } from "../core/format";
import { capTipRows, ChartFrame, Txt } from "../core/ChartFrame";
import { areaPath, nearestIndex, type Curve } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { midSwatch, swatch, type Swatch } from "../core/palette";
import { extent, scaleLinear } from "../core/scale";
import { bucketSeries, prepSeries, type Aggregate, type SeriesModel, type XType } from "../core/series";
import { textWidth } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { lazyArray } from "../core/lazy";
import { useChart, type ChartCtx } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { insideOut, stack } from "../layout/stack";
import { XAxis, xScaleFor } from "./line";
import { plural, type ChartLang } from "../core/i18n";
import type { Painter } from "../theme/context";

const en = {
  kind: "Streamgraph",
  desc: (nS: number, names: string, n: number) => `${plural(nS, "series", "series")} (${names}), ${plural(n, "point")}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "스트림그래프", desc: (nS, names, n) => `계열 ${nS}개(${names}), ${n}개 지점` },
};

export interface StreamGraphProps<T = Row> extends BaseChartProps<T>, DayFirstProps {
  x?: Accessor<T, unknown>;
  y?: Accessor<T, number> | string[];
  series?: Accessor<T, string>;
  xType?: XType;
  /** 같은 x, 같은 계열이 여러 행일 때 합치는 방법. 기본 "sum" */
  aggregate?: Aggregate;
  curve?: Curve;
  /** "wiggle"(기본, 흐름을 부드럽게) | "silhouette"(가운데 대칭) */
  offset?: "wiggle" | "silhouette";
  /** 계열 순서를 보기 좋게 다시 정렬. 기본 true */
  reorder?: boolean;
  /** 강조 계열. 판별 함수는 행이 아니라 계열 이름을 받아요: (name, index) => boolean. 기본 합이 가장 큰 계열 */
  highlight?: BaseChartProps<T>["highlight"];
}

interface Layer {
  s: number;
  name: string;
  top: number[];
  bot: number[];
  sw: Swatch;
  hi: boolean;
  label: { x: number; y: number; thick: number } | null;
}

/** 스트림의 층 순서(계열 자리, 아래 층부터): 기본 inside-out, reorder가 false면 데이터 순서. 차트와 카드 범례(autoLegend)가 같이 써요 */
export function streamOrder(values: readonly (readonly number[])[], reorder?: boolean): number[] {
  return reorder === false ? values.map((_, i) => i) : insideOut(values);
}

/** 스트림의 강조 계열: 기본은 합이 가장 큰 계열 */
export function streamHighlight(highlight: unknown, series: string[], values: readonly (readonly number[])[]): ReadonlySet<number> {
  const totals = values.map((r) => r.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0));
  return resolveHighlight(highlight as never, series as never[], series, totals, "max");
}

/** 계열 자리마다 층 색: 강조는 accent, 나머지는 층 순서대로 neutralStrong에서 neutral까지 섞은 단계 */
export function streamSwatches(p: Painter, order: readonly number[], hi: ReadonlySet<number>): Swatch[] {
  const out: Swatch[] = new Array(order.length);
  const rest = order.filter((s) => !hi.has(s));
  for (const s of order) if (hi.has(s)) out[s] = swatch(p, "accent");
  rest.forEach((s, j) => (out[s] = rest.length === 1 ? swatch(p, "neutral") : midSwatch(p, 1 - j / Math.max(1, rest.length - 1))));
  return out;
}

/** 스트림그래프: 여러 계열의 흐름과 크기 변화 */
export function StreamGraph<T = Row>(props: StreamGraphProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(200, Math.min(290, w * 0.48)), duration: 1100, stagger: 60 });
  const { p, width: W, height: H } = c;
  const model0 = useMemo(() => prepSeries(props.data, props.x, props.y as never, props.series, { xType: props.xType, locale: c.locale, aggregate: props.aggregate, dayFirst: props.dayFirst }), [props.data, props.x, props.y, props.series, props.xType, c.locale, props.aggregate, props.dayFirst]);
  // 폭의 절반보다 점이 많으면 구간 평균으로 줄여요 (층마다 같은 x, 2px에 한 점)
  const budget = Math.max(40, Math.round(W / 2));
  const model = useMemo(() => bucketSeries(model0, budget), [model0, budget]);
  // 툴팁, 이벤트의 값: 줄였으면 구간 평균이 아니라 대표 행(이름표와 같은 행)의 실제 값
  const rowVals = model.rowValues ?? model.values;
  const nS = model.series.length;

  const order = useMemo(() => streamOrder(model.values, props.reorder), [model, props.reorder]);
  const st = useMemo(() => stack(order.map((s) => model.values[s]), props.offset ?? "wiggle"), [model, order, props.offset]);
  const hi = useMemo(() => streamHighlight(props.highlight, model.series, model.values), [model, props.highlight]);

  const top = 8;
  const bottom = 22;
  const x0 = 4;
  const x1 = W - 4;
  const all: number[] = [];
  st.y0.forEach((r) => r.forEach((v) => all.push(v)));
  st.y1.forEach((r) => r.forEach((v) => all.push(v)));
  const [lo, hiV] = extent(all);
  const y = scaleLinear([lo, hiV], [H - bottom, top]);
  const xs = xScaleFor(model as SeriesModel<unknown>, x0, x1);
  const mid = y((lo + hiV) / 2);
  // 포인터가 움직일 때마다 만들지 않아요
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const centers = useMemo(() => model.keys.map((_, k) => xs(k)), [model, x0, x1]);

  const layers = useMemo<Layer[]>(() => {
    const palette = streamSwatches(p, order, hi);
    return order.map((s, li) => {
      const topPx = st.y1[li].map((v) => y(v));
      const botPx = st.y0[li].map((v) => y(v));
      let best = -1;
      let bt = 0;
      topPx.forEach((t, k) => {
        const th = botPx[k] - t;
        const edge = k > 0 && k < topPx.length - 1;
        if (th > bt && edge) {
          bt = th;
          best = k;
        }
      });
      const name = model.series[s];
      const lw = textWidth(name, 11, 700);
      const label = best >= 0 && bt >= 15 ? { x: xs(best), y: (topPx[best] + botPx[best]) / 2, thick: bt } : null;
      const fitsX = label ? label.x - lw / 2 > x0 + 2 && label.x + lw / 2 < x1 - 2 : false;
      return { s, name, top: topPx, bot: botPx, sw: palette[s], hi: hi.has(s), label: fitsX ? label : null };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, st, hi, p, H, W, model]);

  const stg = c.motion.stagger ?? 60;
  const marks = useMemo<Mark<Layer>[]>(
    () => layers.map((L, k) => ({ key: `l:${L.name}`, to: [...L.top, ...L.bot], from: [...L.top.map(() => mid), ...L.bot.map(() => mid)], delay: k * stg, parts: [L.top.length, L.bot.length], data: L })),
    [layers, mid, stg],
  );
  const m = useMotion(marks, c.motion);
  const D = c.motion.duration ?? 1100;
  const curve = props.curve ?? "smooth";

  const fv = c.fv;
  const events: ChartEvent<T>[] = useMemo(
    () =>
      lazyArray(model.keys.length, (k) => ({
        datum: null,
        index: k,
        key: model.keys[k],
        label: model.labels[k],
        value: rowVals.reduce((a, r) => a + (Number.isFinite(r[k]) ? r[k] : 0), 0),
        // 값이 없는 계열은 0이라고 읽지 않게 빼요 (라인 차트와 같아요)
        formatted: model.series
          .map((s, si) => (Number.isFinite(rowVals[si][k]) ? `${s} ${fv(rowVals[si][k])}` : null))
          .filter(Boolean)
          .join(", "),
      })),
    [model, rowVals, fv],
  );

  let tip: TooltipData | null = null;
  if (c.active !== null && model.keys[c.active] !== undefined) {
    const k = c.active;
    const rows = layers
      .map((L) => ({ L, v: rowVals[L.s][k] }))
      .filter((r) => Number.isFinite(r.v))
      .sort((a, b) => b.v - a.v)
      .map((r) => ({ label: r.L.name, value: c.fv(r.v), color: r.L.sw.fill, strong: r.L.hi }));
    tip = { x: xs(k), y: Math.min(...layers.map((L) => L.top[k])), title: model.labels[k], rows: capTipRows(rows, c.t.more) };
  }

  const msg = MSG[c.lang];
  const desc = props.description ?? `${msg.kind}. ${msg.desc(nS, model.series.join(", "), model.keys.length)}.`;

  return (
    <ChartFrame
      c={c}
      kind={msg.kind}
      ariaLabel={props.ariaLabel}
      description={desc}
      events={events}
      tip={tip}
      renderTip={props.tooltip}
      className={props.className}
      style={props.style}
      theme={props.theme}
      onPointerMove={(px, _py, e) => c.setActive(nearestIndex(centers, px), e.pointerType === "touch" ? "touch" : "pointer")}
    >
      <rect x={x0} y={top} width={x1 - x0} height={H - bottom - top} fill="transparent" />
      {m.items.map((it) => {
        const L = it.data;
        const n = L.top.length;
        const t = it.v.slice(0, n);
        const b = it.v.slice(n, 2 * n);
        const topPts = t.map((v, k) => [xs(k), v] as [number, number]);
        const botPts = b.map((v, k) => [xs(k), v] as [number, number]);
        return <path key={it.key} className="ztd-mark" d={areaPath(topPts, botPts, curve)} fill={L.sw.fill} stroke={p.paint("panel")} strokeWidth={1} opacity={it.exiting ? 0.4 : 1} />;
      })}
      {c.active !== null ? <line x1={xs(c.active)} x2={xs(c.active)} y1={top} y2={H - bottom} stroke={p.paint("ink")} strokeOpacity={0.55} strokeWidth={1} pointerEvents="none" /> : null}
      {c.showLabels
        ? layers.map((L) =>
            L.label ? (
              <Txt key={L.name} x={L.label.x} y={L.label.y} anchor="middle" size={11} weight={700} fill={L.sw.text} opacity={m.fade(D * 0.7, 300)}>
                {L.name}
              </Txt>
            ) : null,
          )
        : null}
      <XAxis c={c as ChartCtx<unknown>} model={model as SeriesModel<unknown>} xs={xs} x0={x0} x1={x1} y={H - bottom + 13} />
    </ChartFrame>
  );
}
