import { useMemo } from "react";
import { AXIS_FONT, AxisXBand, GridY, yAxisWidth } from "../core/axis";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { makeTickFormatter } from "../core/format";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { extent, fitDomain, scaleBand, scaleLinear } from "../core/scale";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter } from "../data/accessor";

export interface LollipopChartProps<T = Row> extends BaseChartProps<T> {
  label?: Accessor<T, string>;
  value?: Accessor<T, number>;
  /** 기본 "horizontal" */
  orientation?: "horizontal" | "vertical";
  /** 큰 순서 정렬. 기본 true */
  sort?: boolean;
}

interface Pop<T> {
  i: number;
  label: string;
  value: number;
  hi: boolean;
  datum: T;
}

/** 롤리팝 차트: 막대 대신 선과 점. 항목이 많아도 가벼워 보여요 */
export function LollipopChart<T = Row>(props: LollipopChartProps<T>) {
  const vertical = props.orientation === "vertical";
  const n0 = props.data.length;
  const c = useChart(props, { height: (w) => (vertical ? Math.max(200, Math.min(280, w * 0.52)) : Math.max(150, Math.min(380, n0 * 28 + 30))), duration: 800, stagger: 60 });
  const { p, width: W, height: H } = c;

  const rows = useMemo<Pop<T>[]>(() => {
    const gl = strGetter(props.label, "label");
    const gv = numGetter(props.value, "value");
    // 값이 없으면 NaN 그대로 둬요. 그림은 0 자리에, 글자는 "-"로 (0이라고 읽히지 않게)
    let out = props.data.map((d, i) => ({ i, label: gl(d, i), value: gv(d, i), hi: false, datum: d }));
    if (props.sort !== false) out = [...out].sort((a, b) => (b.value || 0) - (a.value || 0));
    out.forEach((r, k) => (r.i = k));
    const hi = resolveHighlight(props.highlight, out.map((r) => r.datum), out.map((r) => r.label), out.map((r) => r.value), "max");
    return out.map((r) => ({ ...r, hi: hi.has(r.i) }));
  }, [props.data, props.label, props.value, props.sort, props.highlight]);

  const [mn, mx] = extent(rows.map((r) => r.value));
  const dom = fitDomain(mn, mx, 4);
  const tickFmt = makeTickFormatter(props.format, c.locale, Math.max(Math.abs(dom[0]), Math.abs(dom[1])));
  const accent = swatch(p, "accent");
  const stg = c.motion.stagger ?? 60;
  const labelW = vertical ? 0 : Math.min(W * 0.32, Math.max(...rows.map((r) => textWidth(r.label, 11.5, 700)), 24) + 10);
  const fx = (v: number) => (Number.isFinite(v) ? c.fmt(v) : "-");
  const fvx = (v: number) => (Number.isFinite(v) ? c.fv(v) : "-");
  const valPad = vertical ? 0 : Math.max(...rows.map((r) => textWidth(fx(r.value), 11, 800)), 10) + 16;
  // 음수 값 글자는 막대 끝 바깥(가로는 왼쪽, 세로는 아래)에 써요. 그 자리를 남겨요
  const negPad = mn < 0 ? (vertical ? 16 : Math.max(...rows.map((r) => (r.value < 0 ? textWidth(fx(r.value), 11, 800) : 0))) + 16) : 0;
  const yTicks = scaleLinear(dom, [0, 1]).ticks(4);
  const left = vertical ? yAxisWidth(yTicks, tickFmt, c.locale) : labelW + 6;
  const top = vertical ? 16 : 4;
  const bottom = vertical ? 22 : 18;
  // 칸은 순서로 나눠요. 이름이 같은 항목도 따로 칸을 받아요
  const keys = rows.map((_, k) => `${k}`);
  const band = vertical ? scaleBand(keys, [left + 4, W - 4], 0.4, 0.1) : scaleBand(keys, [top, H - bottom], 0.4, 0.1);
  const v = vertical ? scaleLinear(dom, [H - bottom - negPad, top]) : scaleLinear(dom, [left + negPad, W - valPad]);
  const base = v(Math.max(dom[0], 0));

  // 둘째 값은 점의 불투명도. 0 값은 줄기가 자라지 않아도 점이 나타나요
  const marks = useMemo<Mark<Pop<T>>[]>(() => rows.map((r, k) => ({ key: `l:${r.label}`, to: [v(r.value || 0), 1], from: [base, 0], enter: [base, 0], delay: k * stg, data: r })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, W, H, dom[0], dom[1], stg, vertical]);
  const m = useMotion(marks, c.motion);

  const events: ChartEvent<T>[] = rows.map((r) => ({ datum: r.datum, index: r.i, key: r.label, label: r.label, value: Number.isFinite(r.value) ? r.value : null, formatted: fvx(r.value) }));
  let tip: TooltipData | null = null;
  if (c.active !== null && rows[c.active]) {
    const r = rows[c.active];
    const pos = band(`${r.i}`) + band.bandwidth / 2;
    const e = v(r.value || 0);
    tip = vertical ? { x: pos, y: e - 6, title: r.label, rows: [{ value: fvx(r.value), color: r.hi ? accent.fill : p.paint("ink") }] } : { x: e, y: pos - 6, title: r.label, rows: [{ value: fvx(r.value), color: r.hi ? accent.fill : p.paint("ink") }] };
  }
  const D = c.motion.duration ?? 800;
  const kind = c.lang === "ko" ? "롤리팝 차트" : "Lollipop chart";
  const desc = props.description ?? `${kind}. ${rows.map((r) => `${r.label} ${fvx(r.value)}`).join(", ")}.`;
  const ticks = v.ticks(vertical ? 4 : Math.max(2, Math.round(W / 120)));

  return (
    <ChartFrame c={c} kind={kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      {vertical ? (
        <GridY p={p} ticks={yTicks} y={v} x0={left} x1={W} fmt={tickFmt} locale={c.locale} />
      ) : (
        <g aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={v(t)} x2={v(t)} y1={top} y2={H - bottom} stroke={p.paint(t === 0 ? "dim" : "line")} />
              <Txt x={v(t)} y={H - bottom + 10} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
                {tickFmt(t)}
              </Txt>
            </g>
          ))}
        </g>
      )}
      {m.items.map((it) => {
        const r = it.data;
        // 빠지는 항목은 옛 순서 칸에 남아 새 항목과 겹치니 그리지 않아요
        if (it.exiting) return null;
        const [end, o] = it.v;
        const pos = band(`${r.i}`) + band.bandwidth / 2;
        const col = r.hi ? accent.fill : p.paint("neutralStrong");
        const neg = r.value < 0;
        return (
          <g key={it.key} className="ztd-mark" opacity={c.dim(r.i)} onPointerEnter={(e) => c.setActive(r.i, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(r.i)}>
            {vertical ? <rect x={pos - band.step / 2} y={top} width={band.step} height={H - bottom - top} fill="transparent" /> : <rect x={0} y={pos - band.step / 2} width={W} height={band.step} fill="transparent" />}
            {vertical ? <line x1={pos} x2={pos} y1={base} y2={end} stroke={r.hi ? accent.fill : p.paint("neutral")} strokeWidth={2.2} /> : <line x1={base} x2={end} y1={pos} y2={pos} stroke={r.hi ? accent.fill : p.paint("neutral")} strokeWidth={2.2} />}
            <circle cx={vertical ? pos : end} cy={vertical ? end : pos} r={r.hi ? 6.5 : 5.5} fill={col} stroke={c.active === r.i && c.via === "keyboard" ? p.paint("ink") : p.paint("panel")} strokeWidth={2} opacity={Math.min(1, o * 1.5)} />
            {!vertical ? (
              <Txt x={labelW} y={pos} anchor="end" size={11.5} weight={r.hi ? 800 : 600} fill={p.paint(r.hi ? "ink" : "muted")}>
                {truncate(r.label, labelW - 4, 11.5, 700)}
              </Txt>
            ) : null}
            {c.showLabels ? (
              vertical ? (
                <Txt x={pos} y={neg ? end + 14 : end - 14} anchor="middle" size={10.5} weight={r.hi ? 800 : 600} fill={p.paint(r.hi ? "ink" : "muted")} opacity={m.fade(r.i * stg + D * 0.45, 260)}>
                  {fx(r.value)}
                </Txt>
              ) : (
                <Txt x={neg ? end - 12 : end + 12} y={pos} anchor={neg ? "end" : "start"} size={11} weight={r.hi ? 800 : 600} fill={p.paint(r.hi ? "ink" : "muted")} opacity={m.fade(r.i * stg + D * 0.45, 260)}>
                  {fx(r.value)}
                </Txt>
              )
            ) : null}
          </g>
        );
      })}
      {vertical ? <AxisXBand p={p} labels={rows.map((r) => r.label)} centers={rows.map((r) => band(`${r.i}`) + band.bandwidth / 2)} y={H - bottom + 13} strong={new Set(rows.filter((r) => r.hi).map((r) => r.i))} /> : null}
    </ChartFrame>
  );
}
