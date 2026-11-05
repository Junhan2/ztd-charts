import { useMemo } from "react";
import { AXIS_FONT } from "../core/axis";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { roundRectPath } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { niceDomain, scaleLinear } from "../core/scale";
import { textWidth, wrapLines } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter } from "../data/accessor";
import type { ChartLang } from "../core/i18n";

const en = {
  kind: "Bullet chart",
  actual: "Actual",
  target: "Target",
  targetWord: "target",
  achieved: "Achieved",
  withTarget: (t: string) => ` (target ${t})`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "불릿 차트", actual: "실적", target: "목표", targetWord: "목표", achieved: "달성률", withTarget: (t) => `(목표 ${t})` },
};

export interface BulletChartProps<T = Row> extends BaseChartProps<T> {
  label?: Accessor<T, string>;
  /** 실제 값. 기본 "value" */
  value?: Accessor<T, number>;
  /** 목표 값. 기본 "target" */
  target?: Accessor<T, number>;
  /** 구간 경계 필드들 (작은 것부터). 예: ["poor", "ok", "good"] */
  ranges?: string[];
  /** 행마다 축 범위를 따로. 기본 true */
  independent?: boolean;
}

interface BulletRow<T> {
  i: number;
  label: string;
  value: number;
  target: number;
  ranges: number[];
  max: number;
  hi: boolean;
  datum: T;
}

/** 불릿 차트: 목표와 구간(나쁨, 보통, 좋음) 대비 실적 */
export function BulletChart<T = Row>(props: BulletChartProps<T>) {
  const rowH = 40;
  // 함께 쓰는 축(independent={false})이면 아래에 눈금 글자 자리를 둬요
  const axisH = props.independent === false ? 16 : 0;
  const c = useChart(props, { height: () => Math.max(90, props.data.length * rowH + 8) + axisH, duration: 800, stagger: 110 });
  const { p, width: W, height: H } = c;

  const rows = useMemo<BulletRow<T>[]>(() => {
    const gl = strGetter(props.label, "label");
    const gv = numGetter(props.value, "value");
    const gt = numGetter(props.target, "target");
    const rkeys = props.ranges ?? [];
    const base = props.data.map((d, i) => {
      const v = gv(d, i);
      const t = gt(d, i);
      const ranges = rkeys.map((k) => numGetter<T>(k, k)(d, i)).filter(Number.isFinite);
      const max = niceDomain(0, Math.max(v || 0, t || 0, ...ranges), 4)[1];
      // 값이 없으면 NaN 그대로 둬요. 그림은 0 길이로, 글자는 "-"로 (0이라고 읽히지 않게)
      return { i, label: gl(d, i), value: v, target: t, ranges, max, hi: false, datum: d };
    });
    const ratios = base.map((r) => (Number.isFinite(r.target) && r.target ? r.value / r.target : Infinity));
    const hi = resolveHighlight(props.highlight, base.map((r) => r.datum), base.map((r) => r.label), ratios, "min");
    return base.map((r) => ({ ...r, hi: hi.has(r.i) }));
  }, [props.data, props.label, props.value, props.target, props.ranges, props.highlight]);

  const globalMax = Math.max(...rows.map((r) => r.max), 1);
  const labelW = Math.min(W * 0.34, Math.max(...rows.map((r) => textWidth(r.label, 11.5, 600)), 30) + 10);
  const fx = (v: number) => (Number.isFinite(v) ? c.fmt(v) : "-");
  const fvx = (v: number) => (Number.isFinite(v) ? c.fv(v) : "-");
  const valW = Math.max(...rows.map((r) => textWidth(fx(r.value), 12, 800)), 20) + 12;
  const x0 = labelW + 6;
  const x1 = W - valW;
  const band = (H - 8 - axisH) / Math.max(1, rows.length);
  const barH = Math.max(6, Math.min(12, band * 0.26));
  const rangeH = Math.max(12, Math.min(26, band * 0.58));

  const stg = c.motion.stagger ?? 110;
  const marks = useMemo<Mark<BulletRow<T>>[]>(
    () =>
      rows.map((r, k) => {
        const sx = scaleLinear([0, props.independent === false ? globalMax : r.max], [x0, x1]);
        return { key: `b:${r.label}`, to: [sx(r.value || 0), Number.isFinite(r.target) ? sx(r.target) : x0, 1], from: [x0, Number.isFinite(r.target) ? sx(r.target) : x0, 0], enter: [x0, x0, 0], delay: k * stg, data: r };
      }),
    [rows, x0, x1, globalMax, props.independent, stg],
  );
  const m = useMotion(marks, c.motion);
  const accent = swatch(p, "accent");
  const shades = [p.paint("neutralSoft"), p.paint("neutral"), p.mix("neutral", "neutralStrong", 0.62)];

  const msg = MSG[c.lang];
  const events: ChartEvent<T>[] = rows.map((r) => ({ datum: r.datum, index: r.i, key: r.label, label: r.label, value: Number.isFinite(r.value) ? r.value : null, formatted: `${fvx(r.value)}${Number.isFinite(r.target) ? ` / ${msg.targetWord} ${c.fv(r.target)}${Number.isFinite(r.value) ? ` (${c.pct((r.value / (r.target || 1)) * 100)})` : ""}` : ""}` }));
  let tip: TooltipData | null = null;
  if (c.active !== null && rows[c.active]) {
    const r = rows[c.active];
    const sx = scaleLinear([0, props.independent === false ? globalMax : r.max], [x0, x1]);
    tip = { x: sx(r.value || 0), y: 4 + band * r.i + band / 2 - rangeH / 2, title: r.label, rows: [{ label: msg.actual, value: fvx(r.value), color: r.hi ? accent.fill : p.paint("ink") }, ...(Number.isFinite(r.target) ? [{ label: msg.target, value: c.fv(r.target) }, { label: msg.achieved, value: c.pct((r.value / (r.target || 1)) * 100) }] : [])] };
  }
  const desc = props.description ?? `${msg.kind}. ${rows.map((r) => `${r.label} ${fvx(r.value)}${Number.isFinite(r.target) ? msg.withTarget(c.fv(r.target)) : ""}`).join(", ")}.`;

  return (
    <ChartFrame c={c} kind={msg.kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      {m.items.map((it) => {
        const r = it.data;
        // 줄은 지금 순서(r.i)로 정해요. m.items는 처음 생긴 순서라 데이터 순서가 바뀌면 어긋나요.
        // 빠지는 줄은 옛 자리에 남아 새 줄과 겹치니 그리지 않아요
        if (it.exiting) return null;
        const k = r.i;
        const sx = scaleLinear([0, props.independent === false ? globalMax : r.max], [x0, x1]);
        const cy = 4 + band * k + band / 2;
        const [vx, tx, o] = it.v;
        const edges = [0, ...r.ranges, r.max].filter((v, j, a) => j === 0 || v > a[j - 1]);
        const isA = c.active === r.i;
        return (
          <g key={it.key} className="ztd-mark" opacity={c.dim(r.i)} onPointerEnter={(e) => c.setActive(r.i, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(r.i)}>
            <rect x={0} y={cy - band / 2} width={W} height={band} fill="transparent" />
            {edges.slice(0, -1).map((e0, j) => {
              const e1 = edges[j + 1];
              const shade = shades[Math.min(shades.length - 1, Math.round((j / Math.max(1, edges.length - 2)) * (shades.length - 1)))];
              return <path key={j} d={roundRectPath(sx(e0), cy - rangeH / 2, sx(e1) - sx(e0), rangeH, { tl: j === 0 ? 3 : 0, bl: j === 0 ? 3 : 0, tr: j === edges.length - 2 ? 3 : 0, br: j === edges.length - 2 ? 3 : 0 })} fill={shade} opacity={0.35 + 0.65 * o} />;
            })}
            <path d={roundRectPath(x0, cy - barH / 2, Math.max(0, vx - x0), barH, 2)} fill={r.hi ? accent.fill : p.paint("ink")} />
            {Number.isFinite(r.target) ? <line x1={tx} x2={tx} y1={cy - rangeH / 2 - 2} y2={cy + rangeH / 2 + 2} stroke={p.paint("ink")} strokeWidth={2.5} strokeLinecap="round" opacity={o} /> : null}
            {isA && c.via === "keyboard" ? <rect x={x0 - 3} y={cy - rangeH / 2 - 4} width={x1 - x0 + 6} height={rangeH + 8} rx={5} fill="none" stroke={p.paint("ink")} strokeWidth={1.5} /> : null}
            {/* 줄이 넉넉하면 이름을 두 줄로 나눠요. 좁은 화면에서 "Revenue (10…"처럼 단위가 잘리지 않아요 */}
            {wrapLines(r.label, labelW - 4, 11.5, band >= 34 ? 2 : 1, 700).map((line, j, lines) => (
              <Txt key={j} x={labelW} y={cy + (j - (lines.length - 1) / 2) * 13} anchor="end" size={11.5} weight={r.hi ? 800 : 600} fill={p.paint("ink")}>
                {line}
              </Txt>
            ))}
            <Txt x={W - 2} y={cy} anchor="end" size={12} weight={r.hi ? 800 : 600} fill={p.paint(r.hi ? "ink" : "muted")} opacity={m.fade(k * stg + 300, 260)}>
              {fx(r.value)}
            </Txt>
          </g>
        );
      })}
      {props.independent === false ? (
        <g aria-hidden="true">
          {scaleLinear([0, globalMax], [x0, x1])
            .ticks(4)
            .map((t) => (
              <Txt key={t} x={scaleLinear([0, globalMax], [x0, x1])(t)} y={H - 9} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
                {c.fmt(t)}
              </Txt>
            ))}
        </g>
      ) : null}
    </ChartFrame>
  );
}
