import { useId, useMemo } from "react";
import type { DayFirstProps } from "../core/format";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { areaPath, argMax, argMin, evenIndex, linePath, roundRectPath } from "../core/geometry";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { extent, scaleLinear } from "../core/scale";
import { prepSeries } from "../core/series";
import { textWidth } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { lazyArray } from "../core/lazy";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { lttb } from "../data/parse";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Sparkline",
  desc: (n: number, lo: string, hi: string, last: string) => `${plural(n, "point")}, low ${lo}, high ${hi}, last ${last}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "스파크라인", desc: (n, lo, hi, last) => `${n}개 지점, 최저 ${lo}, 최고 ${hi}, 마지막 ${last}` },
};

export interface SparklineProps<T = Row> extends BaseChartProps<T>, DayFirstProps {
  x?: Accessor<T, unknown>;
  y?: Accessor<T, number>;
  /** "line" | "area" | "bar". Default "area" */
  variant?: "line" | "area" | "bar";
  /** Show the last value as text on the right. Default true */
  showValue?: boolean;
  /** Mark the highest and lowest points. Default false */
  showExtremes?: boolean;
  /** Highlighted point: "last" | "max" | "min". Default "last" */
  mark?: "last" | "max" | "min" | "none";
}

/** Sparkline: a small trend line to place next to a table or KPI */
export function Sparkline<T = Row>(props: SparklineProps<T>) {
  const c = useChart(props, { height: 48, duration: 900 });
  const { p, width: W, height: H } = c;
  const gid = useId().replace(/:/g, "");
  const model = useMemo(() => prepSeries(props.data, props.x, props.y as never, undefined, { locale: c.locale, dayFirst: props.dayFirst }), [props.data, props.x, props.y, c.locale, props.dayFirst]);
  const vals = useMemo(() => model.values[0] ?? [], [model]);
  const variant = props.variant ?? "area";
  // The last value is the first number from the end (so the text and point do not vanish when the final value is missing)
  let li = vals.length - 1;
  while (li >= 0 && !Number.isFinite(vals[li])) li--;
  const last = li < 0 ? NaN : vals[li];
  const valText = Number.isFinite(last) ? c.fv(last) : "";
  const valW = props.showValue !== false && valText ? textWidth(valText, 13, 800) + 10 : 0;
  const x0 = 2;
  const x1 = W - valW - 4;
  const [mn, mx] = extent(vals);
  // Bars grow from 0. When all values are negative, 0 is at the top ([0, 1] when all are 0)
  const y = scaleLinear(variant === "bar" ? [Math.min(0, mn), Math.max(0, mx) || (mn < 0 ? 0 : 1)] : [mn, mx === mn ? mn + 1 : mx], [H - 4, 5]);
  const n = vals.length;
  const xs = (k: number) => (n > 1 ? x0 + (k / (n - 1)) * (x1 - x0) : (x0 + x1) / 2);

  const kMark = props.mark === "none" ? -1 : props.mark === "max" ? argMax(vals) : props.mark === "min" ? argMin(vals) : li;
  // How many slots one bar covers. Group them when denser than one bar per 2px
  const per = variant === "bar" ? Math.max(1, Math.ceil(n / Math.max(1, (x1 - x0) / 2))) : 1;

  const pts = useMemo(() => {
    let idx = vals.map((v, k) => (Number.isFinite(v) ? k : -1)).filter((k) => k >= 0);
    const limit = Math.max(40, Math.round((x1 - x0) * 1.5));
    if (idx.length > limit && variant !== "bar") idx = lttb(idx.map((k) => ({ x: k, y: vals[k], k })), limit).map((q) => q.k);
    if (per > 1) {
      // One bar per group: the highlighted bar if there is one, otherwise the value farthest from 0 (so 10,000 bars are not all drawn)
      const out: number[] = [];
      let b = -1;
      let g = -1;
      for (const k of idx) {
        const gk = Math.floor(k / per);
        if (gk !== g) {
          if (b >= 0) out.push(b);
          g = gk;
          b = k;
        } else if (k === kMark || (b !== kMark && Math.abs(vals[k]) > Math.abs(vals[b]))) b = k;
      }
      if (b >= 0) out.push(b);
      idx = out;
    }
    return idx;
  }, [vals, x1, x0, variant, per, kMark]);

  const markers = useMemo<Mark<null>[]>(() => [{ key: "__d", to: [1], from: [0], data: null }], []);
  const m = useMotion(markers, c.motion);
  const t = m.get("__d")?.[0] ?? 1;
  const accent = swatch(p, "accent");

  const fv = c.fv;
  // No value at all: no events, so the frame describes the chart as empty rather than "low 0, high 1".
  const events: ChartEvent<T>[] = useMemo(() => (!vals.some(Number.isFinite) ? [] : lazyArray(model.keys.length, (k) => ({ datum: model.rows[0][k], index: k, key: model.keys[k], label: model.labels[k], value: Number.isFinite(vals[k]) ? vals[k] : null, formatted: Number.isFinite(vals[k]) ? fv(vals[k]) : "-" }))), [model, vals, fv]);
  let tip: TooltipData | null = null;
  if (c.active !== null && Number.isFinite(vals[c.active])) tip = { x: xs(c.active), y: y(vals[c.active]), title: model.labels[c.active], rows: [{ value: c.fv(vals[c.active]) }] };

  const line = pts.map((k) => [xs(k), y(vals[k])] as [number, number]);
  const msg = MSG[c.lang];
  const desc = props.description ?? `${msg.kind}. ${msg.desc(n, c.fv(mn), c.fv(mx), valText)}.`;
  const clipW = x0 + (x1 - x0 + 8) * t;

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
      // Points are evenly spaced, so the nearest one is computed (no coordinate array is built on every move)
      onPointerMove={(px, _py, e) => n && c.setActive(evenIndex(px, x0, x1, n), e.pointerType === "touch" ? "touch" : "pointer")}
      defs={
        <>
          <clipPath id={`${gid}c`}>
            <rect x={-2} y={-2} width={Math.max(0, clipW + 2)} height={H + 4} />
          </clipPath>
          <linearGradient id={`${gid}g`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={p.paint("accent")} stopOpacity={0.3} />
            <stop offset="100%" stopColor={p.paint("accent")} stopOpacity={0} />
          </linearGradient>
        </>
      }
    >
      <rect x={x0} y={0} width={Math.max(0, x1 - x0)} height={H} fill="transparent" />
      <g clipPath={`url(#${gid}c)`}>
        {variant === "bar" ? (
          pts.map((k) => {
            const bw = Math.max(1, ((x1 - x0) / Math.max(1, n)) * per * 0.7);
            const yy = y(vals[k]);
            const y0 = y(0);
            // A grouped bar sits in the middle of its group (so it does not overlap the neighboring group's bar)
            const bx = per > 1 ? xs(Math.min(n - 1, (Math.floor(k / per) + 0.5) * per - 0.5)) : xs(k);
            return <path key={k} d={roundRectPath(bx - bw / 2, Math.min(yy, y0), bw, Math.abs(y0 - yy), 1.5)} fill={k === kMark ? accent.fill : p.paint("neutralStrong")} />;
          })
        ) : (
          <>
            {variant === "area" ? <path d={areaPath(line, line.map(([xx]) => [xx, H - 2] as [number, number]), "smooth")} fill={`url(#${gid}g)`} /> : null}
            <path d={linePath(line, "smooth")} fill="none" stroke={accent.fill} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
          </>
        )}
      </g>
      {props.showExtremes && n > 2
        ? // With every value missing there is no highest or lowest point (avoids cy="NaN")
          [argMax(vals), argMin(vals)].filter((k) => k >= 0 && Number.isFinite(vals[k])).map((k, j) => <circle key={j} cx={xs(k)} cy={y(vals[k])} r={2.4} fill={p.paint("panel")} stroke={p.paint("ink")} strokeWidth={1.3} opacity={t >= 0.99 ? 1 : 0} />)
        : null}
      {kMark >= 0 && variant !== "bar" && Number.isFinite(vals[kMark]) ? <circle cx={xs(kMark)} cy={y(vals[kMark])} r={3.2} fill={accent.fill} stroke={p.paint("panel")} strokeWidth={1.5} opacity={Math.max(0, (t - 0.85) / 0.15)} /> : null}
      {c.active !== null && Number.isFinite(vals[c.active]) ? <circle cx={xs(c.active)} cy={y(vals[c.active])} r={3.4} fill={p.paint("ink")} stroke={p.paint("panel")} strokeWidth={1.5} pointerEvents="none" /> : null}
      {valW ? (
        <Txt x={W - 2} y={H / 2} anchor="end" size={13} weight={800} fill={p.paint("ink")} opacity={m.fade(600, 300)}>
          {valText}
        </Txt>
      ) : null}
    </ChartFrame>
  );
}
