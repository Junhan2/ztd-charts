import { useMemo } from "react";
import { AXIS_FONT } from "../core/axis";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { nearestIndex, quantileSorted } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { extent, fitDomain, scaleLinear } from "../core/scale";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter, uniq } from "../data/accessor";
import { kde } from "../layout/stats";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Ridgeline",
  med: "Median",
  n: "Sample size",
  count: (n: number) => `${n}`,
  summary: (median: string, n: number) => `median ${median} (${plural(n, "value")})`,
  median: (name: string, v: string) => `${name} median ${v}`,
  groups: (n: number) => plural(n, "group"),
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "릿지라인",
    med: "중앙값",
    n: "표본",
    count: (n) => `${n}개`,
    summary: (median, n) => `중앙값 ${median}(${n}개)`,
    median: (name, v) => `${name} 중앙값 ${v}`,
    groups: (n) => `그룹 ${n}개`,
  },
};

export interface RidgelineChartProps<T = Row> extends BaseChartProps<T> {
  group?: Accessor<T, string>;
  value?: Accessor<T, number>;
  /** 곡선이 위로 겹치는 정도. 기본 1.5 */
  overlap?: number;
  /** KDE 대역폭. 없으면 자동 */
  bandwidth?: number;
  /** 정렬: "none"(데이터 순) | "median". 기본 "none" */
  sort?: "none" | "median";
  /** 강조 그룹. 판별 함수는 행이 아니라 그룹 이름을 받아요: (name, index) => boolean. 기본 중앙값이 가장 큰 그룹 */
  highlight?: BaseChartProps<T>["highlight"];
}

interface Ridge<T> {
  g: number;
  name: string;
  dens: number[];
  median: number;
  n: number;
  hi: boolean;
  datum: T | null;
}

const SAMPLES = 72;

/** 릿지라인: 그룹별 분포를 겹쳐 쌓은 곡선 */
export function RidgelineChart<T = Row>(props: RidgelineChartProps<T>) {
  const groups0 = useMemo(() => uniq(props.data.map((d, i) => strGetter(props.group, "group")(d, i))), [props.data, props.group]);
  const c = useChart(props, { height: () => Math.max(180, Math.min(380, groups0.length * 36 + 60)), duration: 900, stagger: 90 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];

  const model = useMemo(() => {
    const gg = strGetter(props.group, "group");
    const gv = numGetter(props.value, "value");
    const by = new Map<string, number[]>();
    props.data.forEach((d, i) => {
      const v = gv(d, i);
      if (!Number.isFinite(v)) return;
      const g = gg(d, i);
      const arr = by.get(g);
      if (arr) arr.push(v);
      else by.set(g, [v]);
    });
    let names = groups0.filter((g) => by.has(g));
    const all = [...by.values()].flat();
    const [mn, mx] = extent(all);
    const dom = fitDomain(mn, mx, 4, { zero: false, pad: 0.06 });
    const xsv = Array.from({ length: SAMPLES }, (_, k) => dom[0] + ((dom[1] - dom[0]) * k) / (SAMPLES - 1));
    const medians = new Map(names.map((g) => [g, quantileSorted([...by.get(g)!].sort((a, b) => a - b), 0.5)]));
    if (props.sort === "median") names = [...names].sort((a, b) => medians.get(a)! - medians.get(b)!);
    const ridges: Ridge<T>[] = names.map((g, k) => ({ g: k, name: g, dens: kde(by.get(g)!, xsv, props.bandwidth), median: medians.get(g)!, n: by.get(g)!.length, hi: false, datum: null }));
    const hi = resolveHighlight(props.highlight as never, names as never[], names, ridges.map((r) => r.median), "max");
    ridges.forEach((r) => (r.hi = hi.has(r.g)));
    const peak = Math.max(...ridges.flatMap((r) => r.dens), 1e-9);
    return { ridges, dom, xsv, peak };
  }, [props.data, props.group, props.value, props.bandwidth, props.sort, props.highlight, groups0]);

  const labelW = Math.min(W * 0.26, Math.max(...model.ridges.map((r) => textWidth(r.name, 11.5, 700)), 20) + 10);
  const bottom = 20;
  const top = 8;
  const nG = Math.max(1, model.ridges.length);
  // 0이면 그룹이 하나일 때 0으로 나눠 NaN이 돼요. 아주 작은 수로 막아요 (그룹 하나면 산 높이는 그림 높이 전체)
  const overlap = Math.max(1e-6, props.overlap ?? 1.5);
  const step = (H - top - bottom) / (nG - 1 + overlap);
  const amp = step * overlap;
  const x = scaleLinear(model.dom, [labelW + 8, W - 8]);
  const baseY = (k: number) => top + amp + step * k;

  const stg = c.motion.stagger ?? 90;
  const marks = useMemo<Mark<Ridge<T>>[]>(() => model.ridges.map((r, k) => ({ key: `r:${r.name}`, to: r.dens.map((d) => (d / model.peak) * amp), from: r.dens.map(() => 0), enter: r.dens.map(() => 0), delay: k * stg, data: r })), [model, amp, stg]);
  const m = useMotion(marks, c.motion);
  const accent = swatch(p, "accent");

  const events: ChartEvent<T>[] = model.ridges.map((r) => ({ datum: null, index: r.g, key: r.name, label: r.name, value: r.median, formatted: msg.summary(c.fv(r.median), r.n) }));
  let tip: TooltipData | null = null;
  if (c.active !== null && model.ridges[c.active]) {
    const r = model.ridges[c.active];
    tip = { x: x(r.median), y: baseY(r.g) - amp * 0.6, title: r.name, rows: [{ label: msg.med, value: c.fv(r.median), color: r.hi ? accent.fill : p.paint("neutralStrong") }, { label: msg.n, value: msg.count(r.n) }] };
  }
  const ticks = x.ticks(Math.max(2, Math.round(W / 110)));
  const D = c.motion.duration ?? 900;
  const desc = props.description ?? `${msg.kind}. ${msg.groups(nG)}: ${model.ridges.map((r) => msg.median(r.name, c.fv(r.median))).join(", ")}.`;

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
        // 산은 겹쳐서(기본 1.5배) 아래 산의 봉우리가 위 산 기준선을 넘어요. 나중에 그린 아래 산부터 포인터가 산 안에 있는지 봐요
        const j = nearestIndex(model.xsv, x.invert(px));
        let k = -1;
        for (let g = model.ridges.length - 1; g >= 0; g--) {
          const b = baseY(g);
          const h = ((model.ridges[g].dens[j] ?? 0) / model.peak) * amp;
          if (py <= b + 1 && py >= b - h - 1) {
            k = g;
            break;
          }
        }
        // 산 밖이면 포인터 바로 아래 기준선의 산
        if (k < 0) k = Math.max(0, Math.min(nG - 1, Math.ceil((py - top - amp) / step)));
        if (k !== c.active) c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer");
      }}
    >
      <g aria-hidden="true">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={H - bottom} stroke={p.paint("line")} />
            <Txt x={x(t)} y={H - bottom + 11} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
              {c.fmt(t)}
            </Txt>
          </g>
        ))}
      </g>
      {m.items.map((it) => {
        const r = it.data;
        const b = baseY(r.g);
        const pts = it.v.map((h, k) => `${x(model.xsv[k]).toFixed(2)},${(b - h).toFixed(2)}`);
        const d = `M${x(model.xsv[0]).toFixed(2)},${b}L${pts.join("L")}L${x(model.xsv[SAMPLES - 1]).toFixed(2)},${b}Z`;
        const line = `M${pts.join("L")}`;
        const isA = c.active === r.g;
        return (
          <g key={it.key} className="ztd-mark" opacity={it.exiting ? 0.4 : c.dim(r.g)}>
            <path d={d} fill={r.hi ? accent.fill : p.paint("neutral")} fillOpacity={r.hi ? 0.88 : 0.92} />
            <path d={line} fill="none" stroke={r.hi ? accent.fill : isA ? p.paint("ink") : p.paint("neutralStrong")} strokeWidth={r.hi || isA ? 1.8 : 1.2} strokeLinejoin="round" />
            <line x1={labelW + 8} x2={W - 8} y1={b} y2={b} stroke={p.paint("line2")} />
          </g>
        );
      })}
      {model.ridges.map((r) => (
        <g key={r.name} pointerEvents="none">
          <Txt x={labelW} y={baseY(r.g) - 6} anchor="end" size={11.5} weight={r.hi ? 800 : 600} fill={p.paint(r.hi ? "ink" : "muted")}>
            {truncate(r.name, labelW - 4, 11.5, 700)}
          </Txt>
          <line x1={x(r.median)} x2={x(r.median)} y1={baseY(r.g) - 5} y2={baseY(r.g)} stroke={p.paint(r.hi ? "onAccent" : "ink")} strokeWidth={1.6} opacity={m.fade(r.g * stg + D * 0.6, 260)} />
        </g>
      ))}
    </ChartFrame>
  );
}
