import { useMemo } from "react";
import { AxisXBand } from "../core/axis";
import { capTipRows, ChartFrame, Txt } from "../core/ChartFrame";
import { evenIndex, monotonePath } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { prepSeries } from "../core/series";
import { textWidth, truncate, truncateBeside } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { ranks } from "../layout/stats";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Bump chart",
  rank: (r: number | string) => `#${r}`,
  desc: (n: number, from: string, to: string) => `Rank changes of ${plural(n, "item")}, from ${from} to ${to}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "범프 차트", rank: (r) => `${r}위`, desc: (n, from, to) => `${n}개 항목의 순위 변화, ${from}부터 ${to}까지` },
};

export interface BumpChartProps<T = Row> extends BaseChartProps<T> {
  x?: Accessor<T, unknown>;
  series?: Accessor<T, string>;
  /** 순위 필드 (1이 1등). 없으면 value로 순위를 매겨요 */
  rank?: Accessor<T, number>;
  /** 값 필드. rank가 없을 때 큰 값이 1등 */
  value?: Accessor<T, number>;
}

interface BumpLine {
  s: number;
  name: string;
  ranks: number[];
  hi: boolean;
}

/** 범프 차트: 시간에 따른 순위 변화 */
export function BumpChart<T = Row>(props: BumpChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(200, Math.min(300, w * 0.55)), duration: 1100, stagger: 90 });
  const { p, width: W, height: H } = c;
  const byRank = props.rank !== undefined || props.value === undefined;
  const model = useMemo(() => prepSeries(props.data, props.x, (byRank ? props.rank ?? "rank" : props.value) as never, props.series, { xType: "band", locale: c.locale, sum: false }), [props.data, props.x, props.rank, props.value, props.series, byRank, c.locale]);
  const nK = model.keys.length;
  const nS = model.series.length;

  const lines = useMemo<BumpLine[]>(() => {
    const rk: number[][] = model.series.map(() => new Array<number>(nK).fill(NaN));
    for (let k = 0; k < nK; k++) {
      if (byRank) model.series.forEach((_, s) => (rk[s][k] = model.values[s][k]));
      else {
        const col = model.series.map((_, s) => (Number.isFinite(model.values[s][k]) ? model.values[s][k] : -Infinity));
        const r = ranks(col, true);
        model.series.forEach((_, s) => (rk[s][k] = Number.isFinite(model.values[s][k]) ? r[s] : NaN));
      }
    }
    const improve = rk.map((r) => {
      const a = r.find(Number.isFinite) ?? 0;
      const b = [...r].reverse().find(Number.isFinite) ?? 0;
      return a - b;
    });
    const hi = resolveHighlight(props.highlight as never, model.series as never[], model.series, improve, "max");
    return model.series.map((name, s) => ({ s, name, ranks: rk[s], hi: hi.has(s) }));
  }, [model, nK, byRank, props.highlight]);

  const maxRank = Math.max(nS, ...lines.flatMap((l) => l.ranks.filter(Number.isFinite)));
  const lw = Math.min(W * 0.24, Math.max(...lines.map((l) => textWidth(l.name, 11, 800)), 20) + 16);
  const msg = MSG[c.lang];
  const rw = Math.min(W * 0.26, Math.max(...lines.map((l) => textWidth(`${msg.rank([...l.ranks].reverse().find(Number.isFinite) ?? "")} ${l.name}`, 11, 800)), 20) + 16);
  const top = 12;
  const bottom = 24;
  const x0 = lw;
  const x1 = W - rw;
  const xs = (k: number) => (nK > 1 ? x0 + (k * (x1 - x0)) / (nK - 1) : (x0 + x1) / 2);
  const rowH = (H - top - bottom) / Math.max(1, maxRank - 1 || 1);
  const yr = (r: number) => top + (r - 1) * rowH;

  const stg = c.motion.stagger ?? 90;
  const order = useMemo(() => [...lines].sort((a, b) => Number(a.hi) - Number(b.hi)), [lines]);
  const marks = useMemo<Mark<BumpLine>[]>(() => order.map((l, k) => ({ key: `b:${l.name}`, to: [1, ...l.ranks.map((r) => (Number.isFinite(r) ? yr(r) : NaN))], from: [0, ...l.ranks.map((r) => (Number.isFinite(r) ? yr(r) : NaN))], enter: [0, ...l.ranks.map((r) => (Number.isFinite(r) ? yr(r) : NaN))], delay: k * stg * 0.6, parts: [1, l.ranks.length], data: l })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, stg, H, maxRank]);
  const m = useMotion(marks, c.motion);
  const accent = swatch(p, "accent");

  const events: ChartEvent<T>[] = model.keys.map((key, k) => ({ datum: null, index: k, key, label: model.labels[k], value: null, formatted: [...lines].filter((l) => Number.isFinite(l.ranks[k])).sort((a, b) => a.ranks[k] - b.ranks[k]).map((l) => `${msg.rank(l.ranks[k])} ${l.name}`).join(", ") }));
  let tip: TooltipData | null = null;
  if (c.active !== null && model.keys[c.active] !== undefined) {
    const k = c.active;
    const rows = [...lines].filter((l) => Number.isFinite(l.ranks[k])).sort((a, b) => a.ranks[k] - b.ranks[k]).map((l) => ({ label: l.name, value: msg.rank(l.ranks[k]), color: l.hi ? accent.fill : p.paint("neutralStrong"), strong: l.hi }));
    tip = { x: xs(k), y: top, title: model.labels[k], rows: capTipRows(rows, c.t.more) };
  }
  const D = c.motion.duration ?? 1100;
  const desc = props.description ?? `${msg.kind}. ${msg.desc(nS, model.labels[0] ?? "", model.labels[nK - 1] ?? "")}.`;

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
      // 열이 고르게 놓여서 가까운 열은 계산으로 찾아요 (움직일 때마다 좌표 배열을 만들지 않아요)
      onPointerMove={(px, _py, e) => nK && c.setActive(evenIndex(px, x0, x1, nK), e.pointerType === "touch" ? "touch" : "pointer")}
    >
      <rect x={x0} y={0} width={Math.max(0, x1 - x0)} height={H - bottom} fill="transparent" />
      {c.active !== null ? <line x1={xs(c.active)} x2={xs(c.active)} y1={top - 8} y2={H - bottom + 2} stroke={p.paint("line2")} strokeWidth={Math.max(8, (x1 - x0) / Math.max(1, nK - 1) * 0.6)} pointerEvents="none" /> : null}
      {m.items.map((it) => {
        const l = it.data;
        const draw = it.v[0];
        const ys = it.v.slice(1);
        const pts = ys.map((yy, k) => [xs(k), yy] as [number, number]).filter((q) => Number.isFinite(q[1]));
        const col = l.hi ? accent.fill : p.paint("neutralStrong");
        const dash = draw < 0.999;
        return (
          <g key={it.key} opacity={it.exiting ? 0.4 : 1} pointerEvents="none">
            <path d={monotonePath(pts)} fill="none" stroke={col} strokeOpacity={l.hi ? 1 : 0.6} strokeWidth={l.hi ? 3.4 : 2} strokeLinecap="round" strokeLinejoin="round" pathLength={dash ? 1 : undefined} strokeDasharray={dash ? "1 1" : undefined} strokeDashoffset={dash ? 1 - draw : undefined} />
            {pts.map(([xx, yy], k) => {
              const f = pts.length > 1 ? k / (pts.length - 1) : 1;
              const o = Math.max(0, Math.min(1, (draw - f) * 8 + (draw >= 0.999 ? 1 : 0)));
              return <circle key={k} cx={xx} cy={yy} r={l.hi ? 4.6 : 3.4} fill={l.hi ? col : p.paint("panel")} stroke={col} strokeWidth={l.hi ? 0 : 1.6} opacity={Math.min(1, o)} />;
            })}
          </g>
        );
      })}
      {c.showLabels
        ? lines.map((l) => {
            const r0 = l.ranks.find(Number.isFinite);
            const r1 = [...l.ranks].reverse().find(Number.isFinite);
            const strong = l.hi;
            const fill = p.paint(strong ? "ink" : "muted");
            return (
              <g key={l.name} opacity={m.fade(D * 0.55, 300)}>
                {r0 !== undefined ? (
                  <Txt x={x0 - 10} y={yr(r0)} anchor="end" size={11} weight={strong ? 800 : 500} fill={fill}>
                    {truncate(l.name, lw - 10, 11, strong ? 800 : 500)}
                  </Txt>
                ) : null}
                {r1 !== undefined ? (
                  <Txt x={x1 + 10} y={yr(r1)} size={11} weight={strong ? 800 : 500} fill={fill}>
                    {`${msg.rank(r1)} ${truncateBeside(l.name, msg.rank(r1), rw - 10, 11, strong ? 800 : 500)}`}
                  </Txt>
                ) : null}
              </g>
            );
          })
        : null}
      <AxisXBand p={p} labels={model.labels} centers={model.keys.map((_, k) => xs(k))} y={H - bottom + 14} />
    </ChartFrame>
  );
}
