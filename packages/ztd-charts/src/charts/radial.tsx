import { useMemo } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { arcLine, polar, TAU } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter } from "../data/accessor";
import type { ChartLang } from "../core/i18n";

const en = {
  radial: "Radial bar chart",
  gauge: "Gauge",
  vsTarget: "vs. target",
  current: "Current",
  target: "Target",
  targetWord: "target",
  achieved: "Achieved",
  range: "Range",
  rangeWord: "range",
  span: (a: string, b: string) => `${a} to ${b}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { radial: "방사형 막대", gauge: "게이지", vsTarget: "목표 대비", current: "현재", target: "목표", targetWord: "목표", achieved: "달성률", range: "범위", rangeWord: "범위", span: (a, b) => `${a}~${b}` },
};

export interface RadialBarChartProps<T = Row> extends BaseChartProps<T> {
  label?: Accessor<T, string>;
  value?: Accessor<T, number>;
  /** 한 바퀴의 값. 기본 100 */
  max?: number;
  /** 호 길이(도). 기본 270 */
  sweep?: number;
}

interface RingInfo<T> {
  i: number;
  label: string;
  value: number;
  frac: number;
  hi: boolean;
  datum: T;
}

/** 방사형 막대: 목표 대비 달성률 같은 비율을 고리로 */
export function RadialBarChart<T = Row>(props: RadialBarChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(200, Math.min(270, w * 0.6)), duration: 1000, stagger: 120, format: "percent" });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];
  const max = props.max ?? 100;
  const sweepDeg = Math.max(30, Math.min(360, props.sweep ?? 270));
  const span = (sweepDeg / 360) * TAU;

  const rings = useMemo<RingInfo<T>[]>(() => {
    const gl = strGetter(props.label, "label");
    const gv = numGetter(props.value, "value");
    const rows = props.data.map((d, i) => ({ d, i, label: gl(d, i), value: gv(d, i) || 0 }));
    const hi = resolveHighlight(props.highlight, rows.map((r) => r.d), rows.map((r) => r.label), rows.map((r) => r.value), "max");
    return rows.map((r) => ({ i: r.i, label: r.label, value: r.value, frac: Math.max(0, Math.min(1, r.value / max)), hi: hi.has(r.i), datum: r.d }));
  }, [props.data, props.label, props.value, props.highlight, max]);

  const n = Math.max(1, rings.length);
  const R = Math.max(30, Math.min(H / 2 - 6, W / 2 - 8));
  const cx = W / 2 + (sweepDeg < 360 ? R * 0.18 : 0);
  const cy = H / 2;
  const inner = R * 0.26;
  const step = (R - inner) / n;
  const thick = Math.max(4, Math.min(18, step * 0.64));
  const radius = (k: number) => R - step * k - step / 2;
  // 12시에서 시작해 시계 방향으로. 비어 있는 왼쪽 위 사분면에 라벨을 세워요
  const start = 0;

  const stg = c.motion.stagger ?? 120;
  const marks = useMemo<Mark<RingInfo<T>>[]>(() => rings.map((r, k) => ({ key: `r:${r.label}`, to: [r.frac], from: [0], enter: [0], delay: k * stg, data: r })), [rings, stg]);
  const m = useMotion(marks, c.motion);
  const accent = swatch(p, "accent");

  const events: ChartEvent<T>[] = rings.map((r) => ({ datum: r.datum, index: r.i, key: r.label, label: r.label, value: r.value, formatted: c.fv(r.value) }));
  let tip: TooltipData | null = null;
  if (c.active !== null && rings[c.active]) {
    const r = rings[c.active];
    const [tx, ty] = polar(cx, cy, radius(c.active), start + span * r.frac);
    tip = { x: tx, y: ty, title: r.label, rows: [{ label: c.t.value, value: c.fv(r.value), color: r.hi ? accent.fill : p.paint("neutralStrong") }, { label: msg.vsTarget, value: c.pct((r.value / max) * 100) }] };
  }
  const D = c.motion.duration ?? 1000;
  const desc = props.description ?? `${msg.radial}. ${rings.map((r) => `${r.label} ${c.fv(r.value)}`).join(", ")}.`;
  const labelMax = Math.max(40, cx - 12);

  return (
    <ChartFrame c={c} kind={msg.radial} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      {m.items.map((it) => {
        // The ring's place comes from the data order: useMotion keeps its own item order across updates,
        // and an exiting ring would push the inner ones out until it left.
        if (it.exiting) return null;
        const r = it.data;
        const rad = radius(r.i);
        const t = it.v[0];
        const isA = c.active === r.i;
        return (
          <g key={it.key} className="ztd-mark" opacity={c.dim(r.i)} onPointerEnter={(e) => c.setActive(r.i, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(r.i)}>
            <path d={arcLine(cx, cy, rad, start, start + span)} fill="none" stroke={p.paint("neutralSoft")} strokeWidth={thick} strokeLinecap="round" />
            {t > 0.002 ? <path d={arcLine(cx, cy, rad, start, start + span * t)} fill="none" stroke={r.hi ? accent.fill : p.paint("neutralStrong")} strokeWidth={thick} strokeLinecap="round" /> : null}
            {isA && c.via === "keyboard" ? <path d={arcLine(cx, cy, rad, start, start + span)} fill="none" stroke={p.paint("ink")} strokeWidth={1.5} strokeDasharray="2 3" /> : null}
          </g>
        );
      })}
      {sweepDeg < 360 && c.showLabels
        ? rings.map((r, k) => {
            const rad = radius(k);
            const [lx, ly] = polar(cx, cy, rad, start);
            const fs = Math.max(9.5, Math.min(11.5, step * 0.62));
            const text = `${r.label} ${c.fmt(r.value)}${props.unit ?? ""}`;
            return (
              <Txt key={k} x={lx - 8} y={ly} anchor="end" size={fs} weight={r.hi ? 800 : 500} fill={p.paint(r.hi ? "ink" : "muted")} opacity={m.fade(k * stg + D * 0.3, 280)}>
                {truncate(text, labelMax, fs, r.hi ? 800 : 500)}
              </Txt>
            );
          })
        : null}
      {sweepDeg >= 360 && rings.length ? (
        <Txt x={cx} y={cy} anchor="middle" size={Math.min(22, inner * 0.6)} weight={800} fill={p.paint("ink")} opacity={m.fade(D * 0.4, 300)}>
          {c.fv(rings.find((r) => r.hi)?.value ?? rings[0].value)}
        </Txt>
      ) : null}
    </ChartFrame>
  );
}

export interface GaugeChartProps<T = Row> extends Omit<BaseChartProps<T>, "data"> {
  /** 값. data 대신 바로 넘겨도 돼요 */
  value?: number;
  data?: readonly T[];
  /** data를 쓸 때 값 필드. 기본 "value" */
  valueKey?: Accessor<T, number>;
  min?: number;
  max?: number;
  /** 목표 눈금 */
  target?: number;
  /** data를 쓸 때 목표 필드. 기본 "target" */
  targetKey?: Accessor<T, number>;
  /** 가운데 숫자 아래 설명 */
  label?: string;
  /** "arc"(240도, 기본) | "semi"(반원) | "ring"(진행률 고리) | "ticks"(눈금이 값까지 켜지는 240도) */
  variant?: "arc" | "semi" | "ring" | "ticks";
  /** 구간 경계값. 예: [50, 80] -> 0~50, 50~80, 80~max (arc, semi) */
  bands?: number[];
  /** variant="ticks"일 때 눈금 개수. 기본은 크기에 맞춰 24~64개 */
  ticks?: number;
}

/** 눈금으로 쪼갠 호. 진행도 lit(0~1)까지 켜요 */
function TickArc(props: { cx: number; cy: number; r: number; len: number; start: number; span: number; count?: number; lit: number; on: string; off: string }) {
  const { cx, cy, r, len, start, span, lit, on, off } = props;
  const n = Math.max(2, Math.round(props.count ?? Math.max(24, Math.min(64, ((r - len / 2) * span) / 8))));
  // 눈금마다 켜진 선과 꺼진 선을 미리 만들어 둬요. 등장 중 프레임마다는 켜진 개수만 바뀌어서 React가 나머지를 건너뛰어요
  const lines = useMemo(() => {
    const gapPx = ((r - len / 2) * span) / (n - 1);
    const w = Math.max(1.6, Math.min(3.4, gapPx * 0.42));
    return Array.from({ length: n }, (_, i) => {
      const a = start + span * (i / (n - 1));
      const [x0, y0] = polar(cx, cy, r - len, a);
      const [x1, y1] = polar(cx, cy, r - 1, a);
      const line = (stroke: string) => <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={stroke} strokeWidth={w} strokeLinecap="round" />;
      return { on: line(on), off: line(off) };
    });
  }, [cx, cy, r, len, start, span, n, on, off]);
  return <g aria-hidden="true">{lines.map((l, i) => (lit > 0.002 && i / (n - 1) <= lit + 1e-6 ? l.on : l.off))}</g>;
}

/** 게이지: KPI 하나의 현재값과 목표. variant="ring"이면 진행률 고리, "ticks"면 눈금 */
export function GaugeChart<T = Row>(props: GaugeChartProps<T>) {
  const data = useMemo(() => props.data ?? ([{ value: props.value ?? 0, target: props.target }] as unknown as T[]), [props.data, props.value, props.target]);
  const variant = props.variant ?? "arc";
  const c = useChart({ ...props, data } as BaseChartProps<T>, { height: (w) => (variant === "semi" ? Math.max(150, Math.min(210, w * 0.5)) : Math.max(180, Math.min(240, w * 0.6))), duration: 1100, format: "integer" });
  const { p, width: W, height: H } = c;
  const gv = numGetter(props.valueKey, "value");
  const gt = numGetter(props.targetKey, "target");
  const value = props.value ?? (data[0] ? gv(data[0], 0) : 0);
  const target = props.target ?? (data[0] ? gt(data[0], 0) : NaN);
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const tfrac = Number.isFinite(target) ? Math.max(0, Math.min(1, (target - min) / (max - min || 1))) : NaN;
  const sweepDeg = variant === "ring" ? 360 : variant === "semi" ? 180 : 240;
  const span = (sweepDeg / 360) * TAU;
  const start = variant === "ring" ? 0 : -span / 2;
  const R = variant === "semi" ? Math.max(30, Math.min(H - 26, W / 2 - 10)) : Math.max(30, Math.min(H / 2 - 6, W / 2 - 10));
  const cx = W / 2;
  const cy = variant === "semi" ? H - 18 : variant === "ring" ? H / 2 : H / 2 + R * 0.12;
  const thick = Math.max(8, Math.min(variant === "ring" ? 16 : 20, R * 0.17));

  const marks = useMemo<Mark<null>[]>(() => [{ key: "v", to: [frac, value], from: [0, min], enter: [0, min], data: null }], [frac, value, min]);
  const m = useMotion(marks, c.motion);
  const cur = m.get("v") ?? [frac, value];
  const accent = swatch(p, "accent");
  const bands = props.bands?.filter((b) => b > min && b < max) ?? [];
  const msg = MSG[c.lang];
  const name = props.label ?? c.t.value;
  const range = msg.span(c.fmt(min), c.fmt(max));
  // No rows and no value prop: no event, so the frame describes the chart as empty instead of as a 0.
  const events: ChartEvent<T>[] = props.value === undefined && !data.length ? [] : [{ datum: data[0] ?? null, index: 0, key: "value", label: name, value, formatted: `${c.fv(value)}${Number.isFinite(target) ? ` / ${msg.targetWord} ${c.fv(target)}` : ""}` }];
  const tip: TooltipData | null = c.active === 0 ? { x: cx, y: cy - R, title: name, rows: [{ label: msg.current, value: c.fv(value), color: accent.fill }, ...(Number.isFinite(target) ? [{ label: msg.target, value: c.fv(target) }, ...(target ? [{ label: msg.achieved, value: c.pct((value / target) * 100) }] : [])] : []), { label: msg.range, value: range }] } : null;
  const big = Math.max(18, Math.min(42, R * 0.42));
  const desc = props.description ?? `${msg.gauge}. ${name} ${c.fv(value)}, ${msg.rangeWord} ${range}${Number.isFinite(target) ? `, ${msg.targetWord} ${c.fv(target)}` : ""}.`;

  return (
    <ChartFrame c={c} kind={msg.gauge} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip as never} className={props.className} style={props.style} theme={props.theme}>
      <g onPointerEnter={(e) => c.setActive(0, e.pointerType === "touch" ? "touch" : "pointer")}>
        {variant === "ticks" ? (
          <TickArc cx={cx} cy={cy} r={R} len={thick * 1.3} start={start} span={span} count={props.ticks} lit={cur[0]} on={accent.fill} off={p.paint("neutralSoft")} />
        ) : (
          <>
            <path d={arcLine(cx, cy, R - thick / 2, start, start + span)} fill="none" stroke={p.paint("neutralSoft")} strokeWidth={thick} strokeLinecap={variant === "ring" ? "butt" : "round"} />
            {bands.map((b, k) => {
              const f = (b - min) / (max - min);
              const [x0, y0] = polar(cx, cy, R - thick - 3, start + span * f);
              const [x1, y1] = polar(cx, cy, R + 2, start + span * f);
              return <line key={k} x1={x0} y1={y0} x2={x1} y2={y1} stroke={p.paint("panel")} strokeWidth={2} />;
            })}
            {cur[0] > 0.002 ? <path d={arcLine(cx, cy, R - thick / 2, start, start + span * cur[0])} fill="none" stroke={accent.fill} strokeWidth={thick} strokeLinecap="round" /> : null}
          </>
        )}
        {Number.isFinite(tfrac) ? (
          (() => {
            const [x0, y0] = polar(cx, cy, R - thick - 4, start + span * tfrac);
            const [x1, y1] = polar(cx, cy, R + 4, start + span * tfrac);
            return <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={p.paint("ink")} strokeWidth={2.5} strokeLinecap="round" opacity={m.fade(500, 300)} />;
          })()
        ) : null}
      </g>
      <Txt x={cx} y={variant === "semi" ? cy - big * 0.55 : cy - (props.label ? big * 0.18 : 0)} anchor="middle" size={big} weight={800} fill={p.paint("ink")} letterSpacing={-1}>
        {`${c.fmt(cur[1])}${props.unit ?? ""}`}
      </Txt>
      {props.label ? (
        <Txt x={cx} y={variant === "semi" ? cy - 6 : cy + big * 0.5} anchor="middle" size={11.5} fill={p.paint("muted")}>
          {truncate(props.label, R * 1.5, 11.5)}
        </Txt>
      ) : null}
      {variant !== "ring" ? (
        <g aria-hidden="true">
          {(() => {
            const [x0, y0] = polar(cx, cy, R - thick / 2, start);
            const [x1, y1] = polar(cx, cy, R - thick / 2, start + span);
            const off = variant === "semi" ? 12 : thick / 2 + 10;
            return (
              <>
                <Txt x={x0} y={y0 + off} anchor="middle" size={10} fill={p.paint("muted")}>
                  {c.fmt(min)}
                </Txt>
                <Txt x={x1} y={y1 + off} anchor="middle" size={10} fill={p.paint("muted")}>
                  {c.fmt(max)}
                </Txt>
              </>
            );
          })()}
        </g>
      ) : null}
      {Number.isFinite(target) && c.showLabels && variant !== "ring" ? (
        (() => {
          const [x, y] = polar(cx, cy, R + 14, start + span * tfrac);
          const s = Math.sin(start + span * tfrac);
          return (
            <Txt x={x} y={y} anchor={s > 0.2 ? "start" : s < -0.2 ? "end" : "middle"} size={10.5} weight={700} fill={p.paint("ink")} opacity={m.fade(600, 300)}>
              {`${msg.target} ${c.fmt(target)}`}
            </Txt>
          );
        })()
      ) : null}
    </ChartFrame>
  );
}
