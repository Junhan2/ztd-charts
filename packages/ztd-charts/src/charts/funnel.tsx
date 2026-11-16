import { useMemo } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { formatPercent } from "../core/format";
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
import { useChartLocale } from "../theme/context";

const en = {
  kind: "Funnel chart",
  /** Conversion rate column title */
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
  /** Show conversion rates on the right. Default true */
  showRates?: boolean;
  /** Conversion rate base: "previous" (previous stage) | "first" (first stage). Default "previous" */
  rateBase?: "previous" | "first";
  /** Conversion rate column title. Default "vs. previous" ("전 단계 대비" in the Korean locale) */
  rateLabel?: string;
  /**
   * Direction the stages run: "down" (top to bottom) | "right" (one column per stage from left to right, each rate vs. the previous stage in a pill on the band between bars,
   * and rates vs. the first stage under each count). "right" draws "down" when a column is too narrow for its bar and pill. Default "down"
   */
  flow?: "down" | "right";
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

/** Funnel chart: shows drop-off by stage. The default highlight is the stage with the lowest conversion rate */
export function FunnelChart<T = Row>(props: FunnelChartProps<T>) {
  const showRates = props.showRates !== false;
  const base = props.rateBase ?? "previous";
  const locale = useChartLocale(props.locale);

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

  // flow "right": one column per stage, its bar at the column's left (22% of the column, 14 to 34px), and each rate vs. the previous stage in a pill on the band between bars.
  // A column narrower than its bar + pill + 16px draws "down", with the "down" height. Pills are measured with textWidth, so server and browser decide the same
  const n = Math.max(1, rows.length);
  const pills = props.flow === "right" && showRates && base === "previous" ? rates.map((r, i) => (r === null ? 0 : textWidth(formatPercent(r, { locale }), 11, hi.has(i) ? 800 : 500) + 16)) : [];
  const barW = (w: number) => Math.max(14, Math.min(34, (w / n) * 0.22));
  const fits = (w: number) => props.flow === "right" && w / n >= barW(w) + Math.max(0, ...pills) + 16;
  const c = useChart(props, { height: (w) => (fits(w) ? Math.max(160, Math.min(220, w * 0.36)) : Math.max(180, Math.min(260, w * 0.56))), duration: 800, stagger: 110 });
  const { p, width: W, height: H } = c;
  const right = fits(W);

  const labelW = Math.min(120, Math.max(54, ...rows.map((r) => Math.max(textWidth(r.label, 11.5, 700), textWidth(c.fv(r.value), 10.5))))) + 8;
  const msg = MSG[c.lang];
  const rateTitle = props.rateLabel ?? msg.header;
  const rateW = showRates ? Math.max(44, textWidth(rateTitle, 10.5) * 0.6) : 0;
  const top = showRates ? 18 : 4;
  const plotX = labelW + 6;
  const plotW = Math.max(40, W - plotX - rateW - 10);
  const cxm = plotX + plotW / 2;
  const band = (H - top - 4) / n;
  const barH = Math.max(8, Math.min(34, band * 0.52));
  // flow "right": name and count (and with rateBase "first" the rate) in rows above the plot, then the bars centered on mid
  const col = W / n;
  const bw = barW(W);
  const third = showRates && base === "first";
  const plotTop = third ? 48 : 34;
  const plotH = H - plotTop - 4;
  const mid = plotTop + plotH / 2;
  // Bar sizes (widths for "down", heights for "right") are scaled to the largest stage, so a later stage above the first (or a first stage of 0) stays inside.
  const first = Math.max(0, ...rows.map((r) => r.value)) || 1;
  const maxW = right ? plotH : plotW;
  const minW = right ? 2 : 10;

  const stages = useMemo<Stage<T>[]>(() => rows.map((r, i) => ({ i, label: r.label, value: r.value, rate: rates[i], w: Math.max(minW, (r.value / first) * maxW), hi: hi.has(i), datum: r.d })), [rows, rates, hi, first, maxW, minW]);
  const stg = c.motion.stagger ?? 110;
  const D = c.motion.duration ?? 800;
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
      x: right ? col * s.i + bw / 2 : cxm,
      y: right ? mid - s.w / 2 : yMid(s.i) - barH / 2,
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
      {showRates && !right ? (
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
        // flow "right": this column's bar at x, and the band from its right edge to the next bar's left edge, one column on
        const x = col * i;
        const xr = x + bw;
        const xn = x + col;
        const xm = (xr + xn) / 2;
        const conn =
          next && no > 0.01
            ? right
              ? `M${r2(xr - 1)},${r2(mid - w / 2)}C${r2(xm)},${r2(mid - w / 2)} ${r2(xm)},${r2(mid - nw / 2)} ${r2(xn + 1)},${r2(mid - nw / 2)}L${r2(xn + 1)},${r2(mid + nw / 2)}C${r2(xm)},${r2(mid + nw / 2)} ${r2(xm)},${r2(mid + w / 2)} ${r2(xr - 1)},${r2(mid + w / 2)}Z`
              : `M${r2(cxm - w / 2)},${r2(yb - 1)}C${r2(cxm - w / 2)},${r2((yb + yt) / 2)} ${r2(cxm - nw / 2)},${r2((yb + yt) / 2)} ${r2(cxm - nw / 2)},${r2(yt + 1)}L${r2(cxm + nw / 2)},${r2(yt + 1)}C${r2(cxm + nw / 2)},${r2((yb + yt) / 2)} ${r2(cxm + w / 2)},${r2((yb + yt) / 2)} ${r2(cxm + w / 2)},${r2(yb - 1)}Z`
            : "";
        const sw = s.hi ? accent : neutral;
        // The column is one item: its bar, name and count, the band leaving it and that band's pill (the next stage's rate).
        // A band and its pill show once the later of their two bars has grown (a spring covers about 90% of the way in half its duration)
        const shown = Math.min(o, no) * m.fade((i + 1) * stg + D / 2, 300);
        const ns = stages[i + 1];
        return (
          <g key={i} opacity={c.dim(i)} className="ztd-mark" onPointerEnter={(e) => c.setActive(i, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(i)} style={{ cursor: props.onClick ? "pointer" : undefined }}>
            {right ? (
              <>
                <rect x={r2(x)} y={0} width={r2(col)} height={H} fill="transparent" />
                {conn ? <path d={conn} fill={p.paint("neutral")} opacity={0.55 * shown} /> : null}
                <path d={roundRectPath(x, mid - w / 2, bw, w, Math.min(7, bw / 3))} fill={sw.fill} opacity={o} />
                {c.active === i && c.via === "keyboard" ? <path d={roundRectPath(x - 3, mid - w / 2 - 3, bw + 6, w + 6, 8)} fill="none" stroke={p.paint("ink")} strokeWidth={2} /> : null}
                <g opacity={m.fade(i * stg + 120, 260)}>
                  <Txt x={x} y={8} size={11.5} weight={s.hi ? 800 : 600} fill={p.paint("ink")}>
                    {truncate(s.label, col - 6, 11.5, 700)}
                  </Txt>
                  <Txt x={x} y={22} size={10.5} fill={p.paint("muted")}>
                    {c.fv(s.value)}
                  </Txt>
                  {third && s.rate !== null ? (
                    <Txt x={x} y={36} size={10.5} weight={s.hi ? 800 : 500} fill={p.paint(s.hi ? "ink" : "muted")}>
                      {c.pct(s.rate)}
                    </Txt>
                  ) : null}
                </g>
                {conn && pills[i + 1] ? (
                  <g opacity={shown}>
                    <rect x={r2(xm - pills[i + 1] / 2)} y={r2(mid - 9)} width={r2(pills[i + 1])} height={18} rx={9} fill={p.paint("panel")} stroke={p.paint(ns.hi ? "accent" : "line")} />
                    <Txt x={xm} y={mid} anchor="middle" size={11} weight={ns.hi ? 800 : 500} fill={p.paint(ns.hi ? "ink" : "muted")}>
                      {c.pct(ns.rate ?? 0)}
                    </Txt>
                  </g>
                ) : null}
              </>
            ) : (
              <>
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
              </>
            )}
          </g>
        );
      })}
    </ChartFrame>
  );
}
