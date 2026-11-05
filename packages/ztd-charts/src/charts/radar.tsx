import { useMemo } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { polar, TAU } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { niceDomain } from "../core/scale";
import { prepSeries } from "../core/series";
import { textWidth } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Highlight, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Radar chart",
  desc: (n: number, axes: string, nS: number) => `${plural(n, "metric")} (${axes}), ${plural(nS, "series", "series")}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "레이더 차트", desc: (n, axes, nS) => `지표 ${n}개(${axes}), 계열 ${nS}개` },
};

export interface RadarChartProps<T = Row> extends Omit<BaseChartProps<T>, "highlight"> {
  /** 강조할 계열(이름 또는 인덱스). 함수는 계열 이름을 받아요. 기본 첫 계열 */
  highlight?: Highlight<string>;
  /** 축(지표) 필드. 기본 "axis" */
  axis?: Accessor<T, string>;
  /** 계열 필드. 넓은 표면 value에 배열로 */
  series?: Accessor<T, string>;
  value?: Accessor<T, number> | string[];
  /** 바깥 고리 값. 없으면 데이터 최댓값을 깔끔하게 올림 */
  max?: number;
  /** 고리 수. 기본 4 */
  levels?: number;
  /** 다각형 대신 원 격자. 기본 false */
  circular?: boolean;
}

interface Poly {
  s: number;
  name: string;
  r: number[];
  hi: boolean;
}

/** 레이더 차트: 여러 지표를 한 번에 비교 */
export function RadarChart<T = Row>(props: RadarChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(220, Math.min(300, w * 0.66)), duration: 900, stagger: 160 });
  const { p, width: W, height: H } = c;
  const model = useMemo(() => prepSeries(props.data, props.axis ?? "axis", props.value as never, props.series, { xType: "band", locale: c.locale, sum: true }), [props.data, props.axis, props.value, props.series, c.locale]);
  const axes = model.labels;
  const n = axes.length;
  const hi = useMemo(() => resolveHighlight(props.highlight as never, model.series as never[], model.series, model.series.map(() => 0), "first"), [model, props.highlight]);
  const mxData = Math.max(0, ...model.values.flat().filter(Number.isFinite));
  const max = props.max ?? niceDomain(0, mxData, props.levels ?? 4)[1];
  const levels = props.levels ?? 4;
  const labW = Math.max(...axes.map((a) => textWidth(a, 11.5, 600)), 20) + 10;
  const R = Math.max(30, Math.min(W / 2 - labW, H / 2 - 22));
  const cx = W / 2;
  const cy = H / 2 + 2;
  const ang = (k: number) => (k / Math.max(1, n)) * TAU;

  const polys = useMemo<Poly[]>(() => model.series.map((name, s) => ({ s, name, r: model.values[s].map((v) => (Number.isFinite(v) ? (Math.max(0, v) / max) * R : 0)), hi: hi.has(s) })), [model, max, R, hi]);
  const stg = c.motion.stagger ?? 160;
  const order = useMemo(() => [...polys].sort((a, b) => Number(a.hi) - Number(b.hi)), [polys]);
  const marks = useMemo<Mark<Poly>[]>(() => order.map((pl, k) => ({ key: `r:${pl.name}`, to: pl.r, from: pl.r.map(() => 0), enter: pl.r.map(() => 0), delay: k * stg, data: pl })), [order, stg]);
  const m = useMotion(marks, c.motion);

  const accent = swatch(p, "accent");
  const events: ChartEvent<T>[] = axes.map((a, k) => ({ datum: null, index: k, key: a, label: a, value: model.values[[...hi][0] ?? 0]?.[k] ?? null, formatted: model.series.map((s, si) => `${s || c.t.value} ${c.fv(model.values[si][k])}`).join(", ") }));

  let tip: TooltipData | null = null;
  if (c.active !== null && axes[c.active] !== undefined) {
    const k = c.active;
    const rr = Math.max(...polys.map((pl) => pl.r[k] ?? 0));
    const [tx, ty] = polar(cx, cy, rr, ang(k));
    tip = { x: tx, y: ty, title: axes[k], rows: polys.map((pl) => ({ label: pl.name || c.t.value, value: c.fv(model.values[pl.s][k]), color: pl.hi ? accent.fill : p.paint("neutralStrong"), strong: pl.hi })) };
  }

  const ring = (rad: number) => {
    if (props.circular) return `M${cx - rad},${cy}a${rad},${rad} 0 1 0 ${rad * 2},0a${rad},${rad} 0 1 0 ${-rad * 2},0`;
    return (
      axes
        .map((_, k) => {
          const [x, y] = polar(cx, cy, rad, ang(k));
          return `${k ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join("") + "Z"
    );
  };
  const D = c.motion.duration ?? 900;
  const msg = MSG[c.lang];
  const desc = props.description ?? `${msg.kind}. ${msg.desc(n, axes.join(", "), model.series.length)}.`;

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
      onPointerMove={(px, py, e) => {
        const a = Math.atan2(px - cx, -(py - cy));
        const k = Math.round((((a + TAU) % TAU) / TAU) * n) % n;
        const dist = Math.hypot(px - cx, py - cy);
        c.setActive(dist < R + 30 ? k : null, e.pointerType === "touch" ? "touch" : "pointer");
      }}
    >
      <g aria-hidden="true">
        {Array.from({ length: levels }, (_, l) => (
          <path key={l} d={ring((R * (l + 1)) / levels)} fill="none" stroke={p.paint("line")} strokeWidth={1} />
        ))}
        {axes.map((a, k) => {
          const [x, y] = polar(cx, cy, R, ang(k));
          return <line key={k} x1={cx} y1={cy} x2={x} y2={y} stroke={p.paint(c.active === k ? "dim" : "line")} strokeWidth={1} />;
        })}
        {Array.from({ length: levels }, (_, l) => {
          const v = (max * (l + 1)) / levels;
          const [x, y] = polar(cx, cy, (R * (l + 1)) / levels, 0);
          // 강조 다각형 채움 위에 놓일 수 있어서 muted 대신 ink (대비 4.5:1 이상)
          return (
            <Txt key={l} x={x + 4} y={y + 1} size={9.5} fill={p.paint("ink")}>
              {c.fmt(v)}
            </Txt>
          );
        })}
      </g>
      {m.items.map((it) => {
        const pl = it.data;
        const pts = it.v.map((r, k) => polar(cx, cy, r, ang(k)));
        const d = pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join("") + "Z";
        const col = pl.hi ? accent.fill : p.paint("neutralStrong");
        return (
          <g key={it.key} opacity={it.exiting ? 0.4 : 1} pointerEvents="none">
            <path d={d} fill={pl.hi ? accent.fill : p.paint("neutral")} fillOpacity={pl.hi ? 0.2 : 0.22} stroke={col} strokeWidth={pl.hi ? 2.2 : 1.4} strokeLinejoin="round" />
            {pl.hi ? pts.map(([x, y], k) => <circle key={k} cx={x} cy={y} r={c.active === k ? 4.5 : 3} fill={col} stroke={p.paint("panel")} strokeWidth={1.5} />) : null}
          </g>
        );
      })}
      <g aria-hidden="true">
        {axes.map((a, k) => {
          const t = ang(k);
          const [x, y] = polar(cx, cy, R + 12, t);
          const s = Math.sin(t);
          const anchor = s > 0.15 ? "start" : s < -0.15 ? "end" : "middle";
          const dy = Math.cos(t) > 0.9 ? -4 : Math.cos(t) < -0.9 ? 4 : 0;
          const strong = c.active === k;
          return (
            <Txt key={k} x={x} y={y + dy} anchor={anchor} size={11.5} weight={strong ? 800 : 600} fill={p.paint(strong ? "ink" : "muted")} opacity={m.fade(D * 0.4, 300)}>
              {a}
            </Txt>
          );
        })}
      </g>
    </ChartFrame>
  );
}
