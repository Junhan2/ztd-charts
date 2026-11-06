import { useMemo } from "react";
import { AXIS_FONT } from "../core/axis";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { extent, fitDomain, scaleLinear } from "../core/scale";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter } from "../data/accessor";
import type { ChartLang } from "../core/i18n";

const en = {
  kind: "Dumbbell chart",
  /** 두 값의 기본 이름 */
  names: ["Before", "After"] as [string, string],
  diff: "Difference",
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "덤벨 차트", names: ["이전", "이후"], diff: "차이" },
};

export interface DumbbellChartProps<T = Row> extends BaseChartProps<T> {
  label?: Accessor<T, string>;
  /** 이전 값. 기본 "start" */
  start?: Accessor<T, number>;
  /** 이후 값. 기본 "end" */
  end?: Accessor<T, number>;
  /** 범례 이름. 기본 ["Before", "After"] (한국어 로캘은 ["이전", "이후"]) */
  labels?: [string, string];
  /** 이후 값 순으로 정렬. 기본 true */
  sort?: boolean;
  /** 축에 0 포함. 기본 false */
  zero?: boolean;
}

interface Bell<T> {
  i: number;
  label: string;
  a: number;
  b: number;
  hi: boolean;
  datum: T;
}

/** 덤벨 차트: 항목마다 두 값의 차이 (전후, 목표와 실제) */
export function DumbbellChart<T = Row>(props: DumbbellChartProps<T>) {
  const n0 = props.data.length;
  const c = useChart(props, { height: () => Math.max(150, Math.min(360, n0 * 30 + 44)), duration: 800, stagger: 70 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];
  const names = props.labels ?? msg.names;

  const rows = useMemo<Bell<T>[]>(() => {
    const gl = strGetter(props.label, "label");
    const ga = numGetter(props.start, "start");
    const gb = numGetter(props.end, "end");
    let out = props.data.map((d, i) => ({ i, label: gl(d, i), a: ga(d, i), b: gb(d, i), hi: false, datum: d })).filter((r) => Number.isFinite(r.a) && Number.isFinite(r.b));
    if (props.sort !== false) out = [...out].sort((x, y) => y.b - x.b);
    out.forEach((r, k) => (r.i = k));
    const hi = resolveHighlight(props.highlight, out.map((r) => r.datum), out.map((r) => r.label), out.map((r) => r.b - r.a), "max");
    return out.map((r) => ({ ...r, hi: hi.has(r.i) }));
  }, [props.data, props.label, props.start, props.end, props.sort, props.highlight]);

  const [mn, mx] = extent(rows.flatMap((r) => [r.a, r.b]));
  const dom = fitDomain(mn, mx, 4, { zero: props.zero ?? false, pad: 0.08 });
  const labelW = Math.min(W * 0.3, Math.max(...rows.map((r) => textWidth(r.label, 11.5, 700)), 24) + 10);
  const top = 22;
  const bottom = 18;
  const valPad = Math.max(...rows.map((r) => textWidth(c.fmt(r.b), 11, 800)), 10) + 14;
  const x = scaleLinear(dom, [labelW + 10, W - valPad]);
  const band = (H - top - bottom) / Math.max(1, rows.length);
  const yOf = (k: number) => top + band * k + band / 2;

  const stg = c.motion.stagger ?? 70;
  const marks = useMemo<Mark<Bell<T>>[]>(() => rows.map((r, k) => ({ key: `d:${r.label}`, to: [x(r.a), x(r.b), 1], from: [x(r.a), x(r.a), 0], enter: [x(r.a), x(r.a), 0], delay: k * stg, data: r })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, W, dom[0], dom[1], stg]);
  const m = useMotion(marks, c.motion);
  const accent = swatch(p, "accent");

  const events: ChartEvent<T>[] = rows.map((r) => ({ datum: r.datum, index: r.i, key: r.label, label: r.label, value: r.b, formatted: `${names[0]} ${c.fv(r.a)} → ${names[1]} ${c.fv(r.b)}` }));
  let tip: TooltipData | null = null;
  if (c.active !== null && rows[c.active]) {
    const r = rows[c.active];
    tip = { x: x(Math.max(r.a, r.b)), y: yOf(c.active) - 6, title: r.label, rows: [{ label: names[0], value: c.fv(r.a), color: p.paint("neutralStrong") }, { label: names[1], value: c.fv(r.b), color: r.hi ? accent.fill : p.paint("ink") }, { label: msg.diff, value: `${r.b - r.a >= 0 ? "+" : "\u2212"}${c.fv(Math.abs(r.b - r.a))}` }] };
  }
  const ticks = x.ticks(Math.max(2, Math.round(W / 120)));
  const D = c.motion.duration ?? 800;
  const desc = props.description ?? `${msg.kind}. ${rows.map((r) => `${r.label} ${c.fv(r.a)}→${c.fv(r.b)}`).join(", ")}.`;

  return (
    <ChartFrame c={c} kind={msg.kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      <g aria-hidden="true">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top - 4} y2={H - bottom} stroke={p.paint("line")} />
            <Txt x={x(t)} y={H - bottom + 10} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
              {c.fmt(t)}
            </Txt>
          </g>
        ))}
        <circle cx={labelW + 14} cy={8} r={4} fill={p.paint("neutralStrong")} />
        <Txt x={labelW + 22} y={8} size={10.5} fill={p.paint("muted")}>
          {names[0]}
        </Txt>
        <circle cx={labelW + 32 + textWidth(names[0], 10.5)} cy={8} r={4.5} fill={p.paint("ink")} />
        <Txt x={labelW + 40 + textWidth(names[0], 10.5)} y={8} size={10.5} fill={p.paint("muted")}>
          {names[1]}
        </Txt>
      </g>
      {m.items.map((it) => {
        const r = it.data;
        // 줄은 지금 순서(r.i)로 정해요. m.items는 처음 생긴 순서라 정렬이 바뀌면 어긋나요.
        // 빠지는 줄은 옛 자리에 남아 새 줄과 겹치니 그리지 않아요
        if (it.exiting) return null;
        const k = r.i;
        const [xa, xb, o] = it.v;
        const cy = yOf(k);
        const endCol = r.hi ? accent.fill : p.paint("ink");
        const right = xb >= xa;
        return (
          <g key={it.key} className="ztd-mark" opacity={c.dim(k)} onPointerEnter={(e) => c.setActive(r.i, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(r.i)}>
            <rect x={0} y={cy - band / 2} width={W} height={band} fill="transparent" />
            <line x1={xa} x2={xb} y1={cy} y2={cy} stroke={r.hi ? accent.fill : p.paint("neutral")} strokeOpacity={r.hi ? 0.55 : 1} strokeWidth={4} strokeLinecap="round" />
            <circle cx={xa} cy={cy} r={4.5} fill={p.paint("neutralStrong")} opacity={Math.min(1, o * 2)} />
            <circle cx={xb} cy={cy} r={5.5} fill={endCol} stroke={c.active === r.i && c.via === "keyboard" ? p.paint("ink") : "none"} strokeWidth={2} opacity={o} />
            <Txt x={labelW} y={cy} anchor="end" size={11.5} weight={r.hi ? 800 : 600} fill={p.paint(r.hi ? "ink" : "muted")}>
              {truncate(r.label, labelW - 4, 11.5, 700)}
            </Txt>
            {c.showLabels ? (
              <Txt x={right ? xb + 10 : xb - 10} y={cy} anchor={right ? "start" : "end"} size={11} weight={r.hi ? 800 : 600} fill={p.paint(r.hi ? "ink" : "muted")} opacity={m.fade(k * stg + D * 0.4, 260)}>
                {c.fmt(r.b)}
              </Txt>
            ) : null}
          </g>
        );
      })}
    </ChartFrame>
  );
}
