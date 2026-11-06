import { useMemo } from "react";
import { AxisXBand, GridY, yAxisWidth } from "../core/axis";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { makeTickFormatter } from "../core/format";
import { roundRectPath } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { fitDomain, scaleBand, scaleLinear } from "../core/scale";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { getter, numGetter, strGetter } from "../data/accessor";
import type { ChartLang } from "../core/i18n";

const en = {
  kind: "Waterfall chart",
  total: "Total",
  up: "Increase",
  down: "Decrease",
  cum: "Cumulative",
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "폭포 차트", total: "합계", up: "증가", down: "감소", cum: "누적" },
};

export interface WaterfallChartProps<T = Row> extends BaseChartProps<T> {
  label?: Accessor<T, string>;
  value?: Accessor<T, number>;
  /** "total"이면 합계 막대. 값이 없으면 누적값을 써요. 기본: 첫 행만 total */
  type?: Accessor<T, string>;
  /** 첫 행을 시작 합계로 볼지. 기본 true */
  startTotal?: boolean;
  /** 끝에 누적 합계 막대를 붙여요. 문자열이면 그 이름으로 (기본 이름 "Total", 한국어 로캘은 "합계") */
  endTotal?: string | boolean;
  /** 막대 사이 연결선. 기본 true */
  connectors?: boolean;
  /** 범례 이름 */
  increaseLabel?: string;
  decreaseLabel?: string;
}

interface Step<T> {
  i: number;
  label: string;
  value: number;
  start: number;
  end: number;
  total: boolean;
  hi: boolean;
  datum: T | null;
}

/** 폭포 차트: 시작값에서 끝값까지 증감 요인을 나눠 보여줘요 */
export function WaterfallChart<T = Row>(props: WaterfallChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(190, Math.min(260, w * 0.55)), duration: 650, stagger: 130 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];
  const totalLabel = msg.total;

  const steps = useMemo(() => {
    const gl = strGetter(props.label, "label");
    const gv = numGetter(props.value, "value");
    const gt = props.type ? getter(props.type, "type") : getter(undefined, "type");
    const out: Step<T>[] = [];
    let run = 0;
    props.data.forEach((d, i) => {
      const raw = gv(d, i);
      const t = String(gt(d, i) ?? "").toLowerCase();
      const isTotal = t === "total" || t === "합계" || (i === 0 && props.startTotal !== false && t !== "delta");
      if (isTotal) {
        const v = Number.isFinite(raw) ? raw : run;
        out.push({ i, label: gl(d, i), value: v, start: 0, end: v, total: true, hi: false, datum: d });
        run = v;
      } else {
        const v = Number.isFinite(raw) ? raw : 0;
        out.push({ i, label: gl(d, i), value: v, start: run, end: run + v, total: false, hi: false, datum: d });
        run += v;
      }
    });
    if (props.endTotal) out.push({ i: out.length, label: typeof props.endTotal === "string" ? props.endTotal : totalLabel, value: run, start: 0, end: run, total: true, hi: false, datum: null });
    const deltas = out.map((s) => (s.total ? -Infinity : s.value));
    const hi = resolveHighlight(props.highlight, out.map((s) => s.datum as T), out.map((s) => s.label), deltas, "max");
    hi.forEach((k) => {
      if (out[k]) out[k].hi = true;
    });
    return out;
  }, [props.data, props.label, props.value, props.type, props.startTotal, props.endTotal, props.highlight, totalLabel]);

  const lo = Math.min(0, ...steps.map((s) => Math.min(s.start, s.end)));
  const hiV = Math.max(0, ...steps.map((s) => Math.max(s.start, s.end)));
  const dom = fitDomain(lo, hiV, 3);
  const tickFmt = makeTickFormatter(props.format, c.locale, Math.max(Math.abs(dom[0]), Math.abs(dom[1])));
  const ticks = scaleLinear(dom, [0, 1]).ticks(3);
  const left = yAxisWidth(ticks, tickFmt, c.locale);
  const top = 20;
  const bottom = 22;
  const y = scaleLinear(dom, [H - bottom, top]);
  // 칸은 순서로 나눠요. 이름이 같은 단계("Other"가 두 번)도 따로 칸을 받아요
  const x = scaleBand(
    steps.map((s) => `${s.i}`),
    [left + 4, W - 2],
    0.34,
    0.12,
  );
  const bw = x.bandwidth;
  const r = Math.min(p.theme.radiusMark, bw / 4);

  const stg = c.motion.stagger ?? 130;
  const marks = useMemo<Mark<Step<T>>[]>(
    () =>
      steps.map((s, k) => {
        const y0 = y(s.start);
        const y1 = y(s.end);
        return { key: `w:${s.label}`, to: [y0, y1, 1], from: [y0, y0, 0], enter: [y0, y0, 0], delay: k * stg, data: s };
      }),
    // y는 dom, H에서 정해져요
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps, dom[0], dom[1], H, stg],
  );
  const m = useMotion(marks, c.motion);

  const total = swatch(p, "ink");
  const accent = swatch(p, "accent");
  const inc = swatch(p, "neutral");
  const dec = swatch(p, "strong");
  // 늘거나 준 양에 부호를 붙여요. 단위가 붙는 곳은 c.fv, 막대 위 라벨처럼 단위 없는 곳은 c.fmt
  const signed = (v: number, f: (n: number) => string) => (v > 0 ? `+${f(v)}` : v < 0 ? `\u2212${f(-v)}` : f(0));
  const signFmt = (v: number) => signed(v, c.fmt);

  const events: ChartEvent<T>[] = steps.map((s, k) => ({ datum: s.datum, index: k, key: s.label, label: s.label, value: s.value, formatted: s.total ? c.fv(s.value) : signed(s.value, c.fv) }));

  let tip: TooltipData | null = null;
  if (c.active !== null && steps[c.active]) {
    const s = steps[c.active];
    tip = {
      x: x(`${s.i}`) + bw / 2,
      y: Math.min(y(s.start), y(s.end)),
      title: s.label,
      rows: s.total ? [{ label: totalLabel, value: c.fv(s.value), color: total.fill }] : [{ label: s.value >= 0 ? msg.up : msg.down, value: signed(s.value, c.fv), color: s.hi ? accent.fill : s.value >= 0 ? inc.fill : dec.fill }, { label: msg.cum, value: c.fv(s.end) }],
    };
  }

  const desc = props.description ?? `${msg.kind}. ${steps.map((s) => (s.total ? `${s.label} ${c.fv(s.value)}` : `${s.label} ${signFmt(s.value)}`)).join(", ")}.`;

  return (
    <ChartFrame c={c} kind={msg.kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      <GridY p={p} ticks={ticks} y={y} x0={left} x1={W} fmt={tickFmt} locale={c.locale} />
      {m.items.map((it) => {
        const s = it.data;
        // 칸은 지금 순서(s.i)로 정해요. m.items는 처음 생긴 순서라 데이터 순서가 바뀌면 어긋나요.
        // 빠지는 막대는 옛 순서 칸에 남아 새 막대와 겹치니 그리지 않아요
        if (it.exiting) return null;
        const k = s.i;
        const [ya, yb, o] = it.v;
        const top0 = Math.min(ya, yb);
        const h = Math.abs(yb - ya);
        const sw = s.total ? total : s.hi ? accent : s.value >= 0 ? inc : dec;
        const bx = x(`${k}`);
        const next = steps[k + 1];
        const lvl = y(s.end);
        const labelY = (s.total || s.value >= 0 ? top0 : top0 + h) + (s.total || s.value >= 0 ? -9 : 10);
        const lo2 = m.fade(k * stg + 260, 240);
        return (
          <g key={it.key} className="ztd-mark" opacity={c.dim(s.i)} onPointerEnter={(e) => c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(k)}>
            <rect x={Math.max(0, bx - (x.step - bw) / 2)} y={top} width={Math.max(0, Math.min(W, bx - (x.step - bw) / 2 + x.step) - Math.max(0, bx - (x.step - bw) / 2))} height={H - bottom - top} fill="transparent" />
            {props.connectors !== false && next ? <line x1={bx + bw} x2={x(`${k + 1}`)} y1={Math.round(lvl) + 0.5} y2={Math.round(lvl) + 0.5} stroke={p.paint("dim")} strokeWidth={1} strokeDasharray="2 3" opacity={lo2 * 0.9} /> : null}
            <path d={roundRectPath(bx, top0, bw, Math.max(h, o > 0 ? 1 : 0), s.value >= 0 || s.total ? { tl: r, tr: r } : { bl: r, br: r })} fill={sw.fill} opacity={Math.max(0.001, o)} />
            {c.active === k && c.via === "keyboard" ? <path d={roundRectPath(bx - 3, top0 - 3, bw + 6, h + 6, 5)} fill="none" stroke={p.paint("ink")} strokeWidth={2} /> : null}
            {c.showLabels ? (
              <Txt x={bx + bw / 2} y={labelY} anchor="middle" size={11} weight={s.total || s.hi ? 800 : 500} fill={p.paint(s.total || s.hi ? "ink" : "muted")} opacity={lo2}>
                {s.total ? c.fmt(s.value) : signFmt(s.value)}
              </Txt>
            ) : null}
          </g>
        );
      })}
      <AxisXBand p={p} labels={steps.map((s) => s.label)} centers={steps.map((s) => x(`${s.i}`) + bw / 2)} y={H - bottom + 13} strong={new Set(steps.map((s, k) => (s.total ? k : -1)).filter((k) => k >= 0))} />
    </ChartFrame>
  );
}
