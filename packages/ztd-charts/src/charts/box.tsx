import { useMemo } from "react";
import { AxisXBand, GridY, yAxisWidth } from "../core/axis";
import { ChartFrame } from "../core/ChartFrame";
import { makeTickFormatter } from "../core/format";
import { roundRectPath } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { extent, fitDomain, scaleBand, scaleLinear } from "../core/scale";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter, uniq } from "../data/accessor";
import { boxStats, kde, type BoxStats } from "../layout/stats";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  box: "Box plot",
  violin: "Violin plot",
  max: "Max (whisker)",
  q3: "Q3",
  med: "Median",
  q1: "Q1",
  min: "Min (whisker)",
  pct: (p: number) => `P${p} (whisker)`,
  n: "Sample size",
  count: (n: number, outliers: number) => `${n}${outliers ? ` · ${plural(outliers, "outlier")}` : ""}`,
  summary: (median: string, q1: string, q3: string) => `median ${median}, IQR ${q1} to ${q3}`,
  median: (name: string, v: string) => `${name} median ${v}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    box: "박스 플롯",
    violin: "바이올린 플롯",
    max: "최대(수염)",
    q3: "3사분위",
    med: "중앙값",
    q1: "1사분위",
    min: "최소(수염)",
    pct: (p) => `${p}백분위(수염)`,
    n: "표본",
    count: (n, outliers) => `${n}개${outliers ? ` · 이상값 ${outliers}` : ""}`,
    summary: (median, q1, q3) => `중앙값 ${median}, 사분위 ${q1}~${q3}`,
    median: (name, v) => `${name} 중앙값 ${v}`,
  },
};

export interface BoxPlotProps<T = Row> extends BaseChartProps<T> {
  group?: Accessor<T, string>;
  value?: Accessor<T, number>;
  /** "box" | "violin" | "both". 기본 "box" */
  variant?: "box" | "violin" | "both";
  /** 이상값 점. 기본 true */
  outliers?: boolean;
  /** 축에 0 포함. 기본 false */
  zero?: boolean;
  /** 수염 끝 백분위 [낮은 쪽, 높은 쪽](0~100). 예: [5, 95]. 없으면 사분위 범위의 1.5배 안에서 가장 먼 값(Tukey) */
  whiskers?: readonly [number, number];
  /** 강조 그룹. 판별 함수는 행이 아니라 그룹 이름을 받아요: (name, index) => boolean. 기본 중앙값이 가장 큰 그룹 */
  highlight?: BaseChartProps<T>["highlight"];
}

interface BoxInfo {
  g: number;
  name: string;
  st: BoxStats;
  dens: number[];
  hi: boolean;
}

const VS = 48;

/** 박스 플롯과 바이올린: 그룹별 분포 요약 (사분위, 중앙값, 이상값) */
export function BoxPlot<T = Row>(props: BoxPlotProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(200, Math.min(300, w * 0.55)), duration: 850, stagger: 90 });
  const { p, width: W, height: H } = c;
  const variant = props.variant ?? "box";
  // 배열을 그때그때 새로 넘겨도 값이 같으면 다시 계산하지 않게 두 숫자로 풀어요.
  // 0~100 안의 두 숫자일 때만 백분위 수염이고(거꾸로 줘도 작은 쪽이 아래), 아니면 Tukey 수염이에요. 스펙 검사를 거치지 않은 값도 NaN을 그리지 않아요
  const [wa = NaN, wb = NaN] = props.whiskers ?? [];
  const isPct = wa >= 0 && wa <= 100 && wb >= 0 && wb <= 100;
  const wLo = isPct ? Math.min(wa, wb) : undefined;
  const wHi = isPct ? Math.max(wa, wb) : undefined;

  const model = useMemo(() => {
    const gg = strGetter(props.group, "group");
    const gv = numGetter(props.value, "value");
    const allNames = uniq(props.data.map((d, i) => gg(d, i)));
    const by = new Map<string, number[]>(allNames.map((n) => [n, []]));
    props.data.forEach((d, i) => {
      const v = gv(d, i);
      if (Number.isFinite(v)) by.get(gg(d, i))!.push(v);
    });
    // 값이 하나도 없는 그룹은 빼요 (사분위가 NaN이 되어 SVG에 NaN이 남아요)
    const names = allNames.filter((n) => by.get(n)!.length > 0);
    const stats = names.map((n) => boxStats(by.get(n)!, wLo !== undefined && wHi !== undefined ? [wLo, wHi] : undefined));
    const all = [...by.values()].flat();
    const [mn, mx] = extent(all);
    const dom = fitDomain(mn, mx, 4, { zero: props.zero ?? false, pad: 0.06 });
    const ys = Array.from({ length: VS }, (_, k) => dom[0] + ((dom[1] - dom[0]) * k) / (VS - 1));
    const dens = variant === "box" ? names.map(() => [] as number[]) : names.map((n) => kde(by.get(n)!, ys));
    const hi = resolveHighlight(props.highlight as never, names as never[], names, stats.map((s) => s.median), "max");
    const boxes: BoxInfo[] = names.map((n, g) => ({ g, name: n, st: stats[g], dens: dens[g], hi: hi.has(g) }));
    const peak = Math.max(1e-9, ...dens.flat());
    return { boxes, dom, ys, peak };
  }, [props.data, props.group, props.value, props.highlight, props.zero, variant, wLo, wHi]);

  const tickFmt = makeTickFormatter(props.format, c.locale, Math.max(Math.abs(model.dom[0]), Math.abs(model.dom[1])));
  const ticks = scaleLinear(model.dom, [0, 1]).ticks(Math.max(2, Math.round(H / 70)));
  const left = yAxisWidth(ticks, tickFmt, c.locale);
  const top = 10;
  const bottom = 22;
  const y = scaleLinear(model.dom, [H - bottom, top]);
  const band = scaleBand(model.boxes.map((b) => b.name), [left + 4, W - 4], 0.35, 0.15);
  const bw = Math.min(band.bandwidth, 64);

  const stg = c.motion.stagger ?? 90;
  const marks = useMemo<Mark<BoxInfo>[]>(
    () =>
      model.boxes.map((b, k) => {
        const med = y(b.st.median);
        const to = [y(b.st.q1), y(b.st.q3), y(b.st.lo), y(b.st.hi), med, 1];
        return { key: `b:${b.name}`, to, from: [med, med, med, med, med, 0], enter: [med, med, med, med, med, 0], delay: k * stg, data: b };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, H, stg],
  );
  const m = useMotion(marks, c.motion);
  const accent = swatch(p, "accent");

  const msg = MSG[c.lang];
  const events: ChartEvent<T>[] = model.boxes.map((b) => ({ datum: null, index: b.g, key: b.name, label: b.name, value: b.st.median, formatted: msg.summary(c.fv(b.st.median), c.fv(b.st.q1), c.fv(b.st.q3)) }));
  let tip: TooltipData | null = null;
  if (c.active !== null && model.boxes[c.active]) {
    const b = model.boxes[c.active];
    tip = {
      x: band(b.name) + band.bandwidth / 2,
      y: y(b.st.hi),
      title: b.name,
      rows: [
        { label: wHi !== undefined ? msg.pct(wHi) : msg.max, value: c.fv(b.st.hi) },
        { label: msg.q3, value: c.fv(b.st.q3) },
        { label: msg.med, value: c.fv(b.st.median), color: b.hi ? accent.fill : p.paint("neutral"), strong: true },
        { label: msg.q1, value: c.fv(b.st.q1) },
        { label: wLo !== undefined ? msg.pct(wLo) : msg.min, value: c.fv(b.st.lo) },
        { label: msg.n, value: msg.count(b.st.n, b.st.outliers.length) },
      ],
    };
  }
  const kind = variant === "box" ? msg.box : msg.violin;
  const desc = props.description ?? `${kind}. ${model.boxes.map((b) => msg.median(b.name, c.fv(b.st.median))).join(", ")}.`;

  return (
    <ChartFrame c={c} kind={kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      <GridY p={p} ticks={ticks} y={y} x0={left} x1={W} fmt={tickFmt} locale={c.locale} zero={false} />
      {m.items.map((it) => {
        const b = it.data;
        const [q1, q3, lo, hi, med, o] = it.v;
        const cx = band(b.name) + band.bandwidth / 2;
        const fill = b.hi ? accent.fill : p.paint("neutral");
        const stroke = b.hi ? accent.fill : p.paint("neutralStrong");
        const isA = c.active === b.g;
        const half = variant === "box" ? bw / 2 : bw * 0.18;
        let violin: string | null = null;
        if (variant !== "box") {
          const wmax = Math.min(band.bandwidth / 2, 40);
          const pts = model.ys.map((v, k) => [cx + (b.dens[k] / model.peak) * wmax * o, y(v)] as [number, number]);
          const back = [...pts].reverse().map(([px, py]) => [cx - (px - cx), py] as [number, number]);
          violin = `M${pts.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join("L")}L${back.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join("L")}Z`;
        }
        return (
          <g key={it.key} className="ztd-mark" opacity={it.exiting ? 0.4 : c.dim(b.g)} onPointerEnter={(e) => c.setActive(b.g, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(b.g)}>
            <rect x={cx - band.step / 2} y={top} width={band.step} height={H - top - bottom} fill="transparent" />
            {violin ? <path d={violin} fill={fill} fillOpacity={b.hi ? 0.85 : 0.9} stroke={stroke} strokeWidth={1} /> : null}
            <line x1={cx} x2={cx} y1={hi} y2={q3} stroke={p.paint(b.hi && variant === "box" ? "accent" : "dim")} strokeWidth={1.4} />
            <line x1={cx} x2={cx} y1={q1} y2={lo} stroke={p.paint(b.hi && variant === "box" ? "accent" : "dim")} strokeWidth={1.4} />
            {variant === "box" ? (
              <>
                <line x1={cx - bw * 0.22} x2={cx + bw * 0.22} y1={hi} y2={hi} stroke={p.paint("dim")} strokeWidth={1.4} />
                <line x1={cx - bw * 0.22} x2={cx + bw * 0.22} y1={lo} y2={lo} stroke={p.paint("dim")} strokeWidth={1.4} />
              </>
            ) : null}
            <path d={roundRectPath(cx - half, Math.min(q1, q3), half * 2, Math.abs(q1 - q3), Math.min(4, half / 2))} fill={variant === "box" ? fill : p.paint(b.hi ? "onAccent" : "ink")} fillOpacity={variant === "box" ? 1 : 0.9} stroke={isA && c.via === "keyboard" ? p.paint("ink") : "none"} strokeWidth={2} />
            <line x1={cx - half} x2={cx + half} y1={med} y2={med} stroke={variant === "box" ? p.paint(b.hi ? "onAccent" : "ink") : p.paint(b.hi ? "accent" : "panel")} strokeWidth={2.2} />
            {props.outliers !== false
              ? b.st.outliers.map((v, k) => <circle key={k} cx={cx} cy={y(v)} r={2.6} fill="none" stroke={p.paint(b.hi ? "accent" : "neutralStrong")} strokeWidth={1.3} opacity={o} />)
              : null}
          </g>
        );
      })}
      <AxisXBand p={p} width={W} labels={model.boxes.map((b) => b.name)} centers={model.boxes.map((b) => band(b.name) + band.bandwidth / 2)} y={H - bottom + 13} strong={new Set(model.boxes.filter((b) => b.hi).map((b) => b.g))} />
    </ChartFrame>
  );
}
