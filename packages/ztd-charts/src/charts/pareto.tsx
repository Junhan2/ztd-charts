import { useMemo } from "react";
import { AxisXBand, GridY, yAxisWidth } from "../core/axis";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { linePath, roundRectPath, sum } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { scaleBand, scaleLinear } from "../core/scale";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter } from "../data/accessor";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Pareto chart",
  share: "Share",
  cum: "Cumulative",
  rank: (r: number) => `#${r}`,
  summary: (v: string, share: string, cum: string) => `${v} · share ${share} · cumulative ${cum}`,
  desc: (n: number, top: number, cum: string) => `${plural(n, "item")}, the top ${top} add up to ${cum}.`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "파레토 차트",
    share: "비중",
    cum: "누적",
    rank: (r) => `${r}위`,
    summary: (v, share, cum) => `${v} · 비중 ${share} · 누적 ${cum}`,
    desc: (n, top, cum) => `${n}개 항목, 상위 ${top}개가 누적 ${cum}를 차지해요.`,
  },
};

export interface ParetoChartProps<T = Row> extends BaseChartProps<T> {
  label?: Accessor<T, string>;
  value?: Accessor<T, number>;
  /** 기준선(%). 기본 80 */
  threshold?: number;
  /** 큰 순서 정렬. 기본 true */
  sort?: boolean;
  /** x 라벨 대신 "#1, #2…" 순위 (한국어 로캘은 "1위, 2위…"). 기본 false */
  rankLabels?: boolean;
}

interface ParetoBar<T> {
  i: number;
  label: string;
  value: number;
  share: number;
  cum: number;
  hi: boolean;
  datum: T;
}

/** 파레토 차트: 큰 순서의 막대 + 누적 비율 선. 상위 몇 개가 80%를 만드는지 보여줘요 */
export function ParetoChart<T = Row>(props: ParetoChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(190, Math.min(260, w * 0.55)), duration: 650, stagger: 55 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];
  const th = props.threshold ?? 80;

  const bars = useMemo(() => {
    const gl = strGetter(props.label, "label");
    const gv = numGetter(props.value, "value");
    let rows = props.data.map((d, i) => ({ d, i, label: gl(d, i), value: Math.max(0, gv(d, i) || 0) }));
    if (props.sort !== false) rows = [...rows].sort((a, b) => b.value - a.value);
    const total = sum(rows.map((r) => r.value)) || 1;
    let acc = 0;
    const out: ParetoBar<T>[] = rows.map((r, k) => {
      acc += r.value;
      return { i: k, label: r.label, value: r.value, share: (r.value / total) * 100, cum: (acc / total) * 100, hi: false, datum: r.d };
    });
    if (props.highlight !== undefined) {
      resolveHighlight(props.highlight, out.map((b) => b.datum), out.map((b) => b.label), out.map((b) => b.value)).forEach((k) => (out[k].hi = true));
    } else {
      // 누적이 기준선에 닿기 전까지 (최소 1개)
      for (const b of out) {
        b.hi = true;
        if (b.cum >= th - 0.5) break;
        const next = out[b.i + 1];
        if (next && next.cum > th + 0.5) break;
      }
    }
    return out;
  }, [props.data, props.label, props.value, props.sort, props.highlight, th]);

  const ticks = [0, 50, 100];
  const tickFmt = (v: number) => String(v);
  const left = yAxisWidth(ticks, tickFmt);
  const top = 12;
  const bottom = 22;
  const right = 30;
  const y = scaleLinear([0, 100], [H - bottom, top]);
  const labels = bars.map((b, k) => (props.rankLabels ? msg.rank(k + 1) : b.label));
  // 칸은 순서로 나눠요. 이름이 같은 항목도 따로 칸을 받아요
  const x = scaleBand(labels.map((_, k) => `${k}`), [left + 4, W - right], 0.28, 0.1);
  const bw = x.bandwidth;
  const cxs = labels.map((_, k) => x(`${k}`) + bw / 2);

  const stg = c.motion.stagger ?? 55;
  const D = c.motion.duration ?? 650;
  const lineDelay = bars.length * stg * 0.6 + D * 0.35;
  const marks = useMemo<Mark<ParetoBar<T> | null>[]>(() => {
    const ms: Mark<ParetoBar<T> | null>[] = bars.map((b, k) => ({ key: `b:${b.label}`, to: [y(b.share), y(b.cum)], from: [y(0), y(0)], enter: [y(0), y(0)], delay: k * stg, data: b }));
    ms.push({ key: "__draw", to: [1], from: [0], delay: lineDelay, data: null });
    return ms;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, H, stg, lineDelay]);
  const m = useMotion(marks, { ...c.motion });
  const draw = m.get("__draw")?.[0] ?? 1;

  const accent = swatch(p, "accent");
  const neutral = swatch(p, "neutral");
  // 누적선 점은 막대 순서(b.i) 자리에 둬요. m.items는 처음 생긴 순서라 정렬이 바뀌면 선이 엉켜요
  const pts: [number, number][] = [];
  m.items.forEach((it) => {
    if (it.data && !it.exiting) pts[it.data.i] = [cxs[it.data.i] ?? 0, it.v[1]];
  });
  const lastHi = [...bars].reverse().find((b) => b.hi);

  const events: ChartEvent<T>[] = bars.map((b) => ({ datum: b.datum, index: b.i, key: b.label, label: b.label, value: b.value, formatted: msg.summary(c.fv(b.value), c.pct(b.share), c.pct(b.cum)) }));

  let tip: TooltipData | null = null;
  if (c.active !== null && bars[c.active]) {
    const b = bars[c.active];
    tip = { x: cxs[b.i], y: Math.min(y(b.share), y(b.cum)), title: `${props.rankLabels ? `${msg.rank(b.i + 1)} · ` : ""}${b.label}`, rows: [{ label: c.t.value, value: c.fv(b.value), color: b.hi ? accent.fill : neutral.fill }, { label: msg.share, value: c.pct(b.share) }, { label: msg.cum, value: c.pct(b.cum) }] };
  }

  const desc = props.description ?? `${msg.kind}. ${msg.desc(bars.length, bars.filter((b) => b.hi).length, lastHi ? c.pct(lastHi.cum) : "-")}`;
  const r = Math.min(p.theme.radiusMark, bw / 4);
  const thY = y(th);

  return (
    <ChartFrame c={c} kind={msg.kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      <GridY p={p} ticks={ticks} y={y} x0={left} x1={W - right} fmt={tickFmt} />
      <line x1={left} x2={W - right} y1={thY} y2={thY} stroke={p.paint("dim")} strokeDasharray="3 3" strokeWidth={1} />
      <Txt x={W - right + 4} y={thY} size={10.5} fill={p.paint("muted")}>
        {`${th}%`}
      </Txt>
      {m.items.map((it) => {
        const b = it.data;
        // 빠지는 막대는 옛 순서 칸에 남아 새 막대와 겹치니 그리지 않아요
        if (!b || it.exiting) return null;
        const yy = it.v[0];
        const h = y(0) - yy;
        const k = b.i;
        return (
          <g key={it.key} className="ztd-mark" opacity={c.dim(k)} onPointerEnter={(e) => c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(k)}>
            <rect x={x(`${k}`) - (x.step - bw) / 2} y={top} width={x.step} height={H - bottom - top} fill="transparent" />
            <path d={roundRectPath(x(`${k}`), yy, bw, Math.max(0, h), { tl: r, tr: r })} fill={b.hi ? accent.fill : neutral.fill} />
            {c.active === k && c.via === "keyboard" ? <path d={roundRectPath(x(`${k}`) - 3, yy - 3, bw + 6, h + 6, 5)} fill="none" stroke={p.paint("ink")} strokeWidth={2} /> : null}
          </g>
        );
      })}
      {pts.length > 1 ? <path d={linePath(pts, "linear")} fill="none" stroke={p.paint("ink")} strokeWidth={1.6} strokeLinejoin="round" pathLength={1} strokeDasharray={draw < 1 ? "1 1" : undefined} strokeDashoffset={draw < 1 ? 1 - draw : undefined} pointerEvents="none" /> : null}
      {pts.map((pt, k) => {
        const b = bars[k];
        if (!b) return null;
        const appear = Math.max(0, Math.min(1, (draw - k / Math.max(1, pts.length - 1)) * 6 + (draw >= 1 ? 1 : 0)));
        const isMark = lastHi && b.i === lastHi.i;
        return <circle key={k} cx={pt[0]} cy={pt[1]} r={isMark ? 3.6 : 2.4} fill={p.paint("ink")} opacity={Math.min(1, appear)} pointerEvents="none" />;
      })}
      {lastHi && c.showLabels && pts[lastHi.i] ? (
        <Txt x={pts[lastHi.i][0] + 8} y={pts[lastHi.i][1] + 12} size={12} weight={800} fill={p.paint("ink")} opacity={Math.max(0, (draw - 0.6) / 0.4)}>
          {c.pct(lastHi.cum)}
        </Txt>
      ) : null}
      <AxisXBand p={p} labels={labels} centers={cxs} y={H - bottom + 13} />
    </ChartFrame>
  );
}
