import { useMemo } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { r2, roundRectPath } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter } from "../data/accessor";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Funnel chart",
  /** 전환율 열 제목 */
  header: "vs. previous",
  vsPrev: "vs. previous step",
  vsFirst: "vs. first step",
  count: "Count",
  drop: "Drop-off",
  rate: (first: boolean, pct: string) => `${pct} of ${first ? "first" : "previous"} step`,
  steps: (n: number) => plural(n, "step"),
  paren: (pct: string) => ` (${pct})`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "퍼널 차트",
    header: "전 단계 대비",
    vsPrev: "전 단계 대비",
    vsFirst: "첫 단계 대비",
    count: "인원",
    drop: "이탈",
    rate: (first, pct) => `${first ? "첫 단계" : "전 단계"} 대비 ${pct}`,
    steps: (n) => `${n}단계`,
    paren: (pct) => `(${pct})`,
  },
};

export interface FunnelChartProps<T = Row> extends BaseChartProps<T> {
  label?: Accessor<T, string>;
  value?: Accessor<T, number>;
  /** 오른쪽 전환율 표시. 기본 true */
  showRates?: boolean;
  /** 전환율 기준: "previous"(전 단계) | "first"(첫 단계). 기본 "previous" */
  rateBase?: "previous" | "first";
  /** 전환율 열 제목. 기본 "vs. previous" (한국어 로캘은 "전 단계 대비") */
  rateLabel?: string;
}

interface Stage<T> {
  i: number;
  label: string;
  value: number;
  rate: number | null;
  w: number;
  hi: boolean;
  datum: T;
}

/** 퍼널 차트: 단계별 이탈을 보여줘요. 기본 강조는 전환율이 가장 낮은 단계 */
export function FunnelChart<T = Row>(props: FunnelChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(180, Math.min(260, w * 0.56)), duration: 800, stagger: 110 });
  const { p, width: W, height: H } = c;
  const showRates = props.showRates !== false;
  const base = props.rateBase ?? "previous";

  const { rows, rates, hi } = useMemo(() => {
    const gl = strGetter(props.label, "label");
    const gv = numGetter(props.value, "value");
    const rows = props.data.map((d, i) => ({ d, i, label: gl(d, i), value: Math.max(0, gv(d, i) || 0) }));
    const rates = rows.map((r, i) => (i === 0 ? null : base === "first" ? (rows[0].value ? (r.value / rows[0].value) * 100 : 0) : rows[i - 1].value ? (r.value / rows[i - 1].value) * 100 : 0));
    let hi: Set<number>;
    if (props.highlight !== undefined) hi = resolveHighlight(props.highlight, rows.map((r) => r.d), rows.map((r) => r.label), rows.map((r) => r.value));
    else {
      let best = -1;
      let bv = Infinity;
      rates.forEach((r, i) => {
        if (r !== null && r < bv) {
          bv = r;
          best = i;
        }
      });
      hi = new Set(best >= 0 ? [best] : []);
    }
    return { rows, rates, hi };
  }, [props.data, props.label, props.value, props.highlight, base]);

  const labelW = Math.min(120, Math.max(54, ...rows.map((r) => Math.max(textWidth(r.label, 11.5, 700), textWidth(c.fv(r.value), 10.5))))) + 8;
  const msg = MSG[c.lang];
  const rateTitle = props.rateLabel ?? msg.header;
  const rateW = showRates ? Math.max(44, textWidth(rateTitle, 10.5) * 0.6) : 0;
  const top = showRates ? 18 : 4;
  const plotX = labelW + 6;
  const plotW = Math.max(40, W - plotX - rateW - 10);
  const cxm = plotX + plotW / 2;
  const n = Math.max(1, rows.length);
  const band = (H - top - 4) / n;
  const barH = Math.max(8, Math.min(34, band * 0.52));
  // Widths are scaled to the largest stage, so a later stage above the first (or a first stage of 0) stays inside.
  const first = Math.max(0, ...rows.map((r) => r.value)) || 1;
  const maxW = plotW;

  const stages = useMemo<Stage<T>[]>(() => rows.map((r, i) => ({ i, label: r.label, value: r.value, rate: rates[i], w: Math.max(10, (r.value / first) * maxW), hi: hi.has(i), datum: r.d })), [rows, rates, hi, first, maxW]);
  const stg = c.motion.stagger ?? 110;
  const marks = useMemo<Mark<Stage<T>>[]>(() => stages.map((s, i) => ({ key: `f:${s.label}`, to: [s.w, 1], from: [s.w * 0.15, 0], enter: [0, 0], delay: i * stg, data: s })), [stages, stg]);
  const m = useMotion(marks, c.motion);
  // By stage index: useMotion renames repeated labels (f:Step#2), so a label lookup would find the first one.
  const cur = new Map(m.items.filter((it) => !it.exiting).map((it) => [it.data.i, it]));

  const yMid = (i: number) => top + band * i + band / 2;
  const neutral = swatch(p, "neutral");
  const accent = swatch(p, "accent");

  const events: ChartEvent<T>[] = stages.map((s) => ({
    datum: s.datum,
    index: s.i,
    key: s.label,
    label: s.label,
    value: s.value,
    formatted: `${c.fv(s.value)}${s.rate !== null ? ` · ${msg.rate(base === "first", c.pct(s.rate))}` : ""}`,
  }));

  let tip: TooltipData | null = null;
  if (c.active !== null && stages[c.active]) {
    const s = stages[c.active];
    tip = {
      x: cxm,
      y: yMid(s.i) - barH / 2,
      title: s.label,
      rows: [
        { label: msg.count, value: c.fv(s.value), color: s.hi ? accent.fill : neutral.fill },
        ...(s.rate !== null ? [{ label: base === "first" ? msg.vsFirst : msg.vsPrev, value: c.pct(s.rate) }] : []),
        ...(s.i > 0 ? [{ label: msg.drop, value: c.fv(stages[s.i - 1].value - s.value) }] : []),
      ],
    };
  }

  const desc =
    props.description ??
    `${msg.kind}. ${msg.steps(stages.length)}: ${stages.map((s) => `${s.label} ${c.fv(s.value)}${s.rate !== null ? msg.paren(c.pct(s.rate)) : ""}`).join(", ")}.`;

  return (
    <ChartFrame c={c} kind={msg.kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      {showRates ? (
        <Txt x={W - 2} y={8} anchor="end" size={10.5} fill={p.paint("muted")} opacity={m.fade(0, 300)}>
          {rateTitle}
        </Txt>
      ) : null}
      {stages.map((s, i) => {
        const it = cur.get(i);
        if (!it) return null;
        const w = it.v[0];
        const o = it.v[1];
        const y = yMid(i);
        const next = stages[i + 1] ? cur.get(i + 1) : undefined;
        const nw = next ? next.v[0] : 0;
        const no = next ? next.v[1] : 0;
        const yb = y + barH / 2;
        const yt = y + band - barH / 2;
        const conn =
          next && no > 0.01
            ? `M${r2(cxm - w / 2)},${r2(yb - 1)}C${r2(cxm - w / 2)},${r2((yb + yt) / 2)} ${r2(cxm - nw / 2)},${r2((yb + yt) / 2)} ${r2(cxm - nw / 2)},${r2(yt + 1)}L${r2(cxm + nw / 2)},${r2(yt + 1)}C${r2(cxm + nw / 2)},${r2((yb + yt) / 2)} ${r2(cxm + w / 2)},${r2((yb + yt) / 2)} ${r2(cxm + w / 2)},${r2(yb - 1)}Z`
            : "";
        const sw = s.hi ? accent : neutral;
        return (
          <g key={i} opacity={c.dim(i)} className="ztd-mark" onPointerEnter={(e) => c.setActive(i, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(i)} style={{ cursor: props.onClick ? "pointer" : undefined }}>
            <rect x={plotX - labelW} y={y - band / 2} width={W - plotX + labelW} height={band} fill="transparent" />
            {conn ? <path d={conn} fill={p.paint("neutral")} opacity={0.55 * Math.min(o, no)} /> : null}
            <path d={roundRectPath(cxm - w / 2, y - barH / 2, w, barH, Math.min(7, barH / 3))} fill={sw.fill} opacity={o} />
            {c.active === i && c.via === "keyboard" ? <path d={roundRectPath(cxm - w / 2 - 3, y - barH / 2 - 3, w + 6, barH + 6, 8)} fill="none" stroke={p.paint("ink")} strokeWidth={2} /> : null}
            <g opacity={m.fade(i * (c.motion.stagger ?? 110) + 120, 260)}>
              <Txt x={labelW} y={y - 6} anchor="end" size={11.5} weight={s.hi ? 800 : 600} fill={p.paint("ink")}>
                {truncate(s.label, labelW - 4, 11.5, 700)}
              </Txt>
              <Txt x={labelW} y={y + 8} anchor="end" size={10.5} fill={p.paint("muted")}>
                {c.fv(s.value)}
              </Txt>
              {showRates && s.rate !== null ? (
                <Txt x={W - 2} y={top + band * i} anchor="end" size={12} weight={s.hi ? 800 : 500} fill={p.paint(s.hi ? "ink" : "muted")}>
                  {c.pct(s.rate)}
                </Txt>
              ) : null}
            </g>
          </g>
        );
      })}
    </ChartFrame>
  );
}
