import { useEffect, useId, useMemo, useState } from "react";
import { AXIS_FONT, AxisPill } from "../core/axis";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { makeFormatter, withUnit, type DayFirstProps } from "../core/format";
import { clamp, nearestIndex } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import { langOf, plural, type ChartLang } from "../core/i18n";
import type { Mark } from "../core/motion";
import { robustMax } from "../core/scale";
import { prepSeries, type Aggregate, type SeriesModel, type XType } from "../core/series";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart, type ChartCtx } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { lttb } from "../data/parse";
import { niceWidth } from "../layout/stats";
import { HORIZON_MAX_SERIES } from "../spec/meta";
import { contrastRatio, mixHex } from "../theme/color";
import { isColorToken, useChartLocale, type Painter } from "../theme/context";
import { XAxis, xScaleFor } from "./line";

const en = {
  kind: "Horizon chart",
  /** Legend: the range of one band */
  range: (lo: string, hi: string) => `${lo} to ${hi}`,
  /** Legend: the top band when values past it are clipped into it */
  above: (lo: string) => `${lo} and above`,
  /** Legend: the down color */
  below: (v: string) => `below ${v}`,
  /** Legend ends with scale "free" */
  lower: "Lower",
  higher: "Higher",
  /** One row in the screen reader table */
  item: (last: string, min: string, max: string) => `latest ${last}, min ${min}, max ${max}`,
  /** Announced when the time moves */
  at: (name: string, label: string, v: string) => `${name}, ${label}: ${v}`,
  desc: (nS: number, nP: number, bands: number, size: string | null) => `${plural(nS, "series", "series")}, ${plural(nP, "point")} each, ${plural(bands, "band")} ${size === null ? "with each row on its own scale" : `of ${size}`}.`,
  ends: (hi: string, hiV: string, lo: string, loV: string) => ` Largest last value: ${hi} ${hiV}. Smallest: ${lo} ${loV}.`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "호라이즌 차트",
    range: (lo, hi) => `${lo}~${hi}`,
    above: (lo) => `${lo} 이상`,
    below: (v) => `${v} 미만`,
    lower: "낮음",
    higher: "높음",
    item: (last, min, max) => `최근 ${last}, 최저 ${min}, 최고 ${max}`,
    at: (name, label, v) => `${name}, ${label}: ${v}`,
    desc: (nS, nP, bands, size) => `계열 ${nS}개, 계열마다 ${nP}개 지점, 층 ${bands}개${size === null ? "(줄마다 자기 눈금)" : `(한 층 ${size})`}.`,
    ends: (hi, hiV, lo, loV) => ` 마지막 값이 가장 큰 계열은 ${hi} ${hiV}, 가장 작은 계열은 ${lo} ${loV}.`,
  },
};

export interface HorizonChartProps<T = Row> extends BaseChartProps<T>, DayFirstProps {
  /** x field. Dates ("2025-03"), numbers and categories all work. Default "x" */
  x?: Accessor<T, unknown>;
  /** y field. An array turns several columns of a wide table into series. Default "y" */
  y?: Accessor<T, number> | string[];
  /** Series field (long table) */
  series?: Accessor<T, string>;
  /** Sets the x type explicitly */
  xType?: XType;
  /** How to combine several rows with the same x and series. Default "sum" */
  aggregate?: Aggregate;
  /** Color bands per row, 1 to 3. Default: 1 (the mirror alone) when rowHeight is 24 or more, otherwise 2 */
  bands?: number;
  /** Row height in px, 12 to 48. Default 18 with up to 24 series, otherwise 14. An explicit height spreads the rows to fill it */
  rowHeight?: number;
  /** Value where the bands start. Above it in the accent color; below it mirrored into the same row in downColor. Default 0 */
  baseline?: number;
  /** Color below the baseline. A theme token or CSS color. Default "neutralStrong" */
  downColor?: string;
  /** "shared" (default) puts every row on the same bands, so heights compare. "free" fits each row to its own values */
  scale?: "shared" | "free";
  /** Value column on the right: the last value, or the value at the pointed time. Default true */
  showValues?: boolean;
  /** Reading legend on top: band colors and their ranges. Default true */
  legend?: boolean;
  /** Series to highlight. A predicate receives the series name, not a row: (name, index) => boolean. Default none */
  highlight?: BaseChartProps<T>["highlight"];
}

const GAP = 2;
const AXIS_H = 22;
const LEGEND_LINE = 18;
const SWATCH = 16;
/** Shares of the base color tried in each step of the band color rule */
const TOWARD_CARD = [0.3, 0.4, 0.5, 0.6, 0.7];
const TOWARD_INK = [1, 0.75, 0.5];

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Band colors for one base color, band 1 first. (1) The lightest mix toward the card that still reaches 3:1 against it starts band 1, and the bands step evenly up to the base color.
 * (2) When no such mix exists, band 1 is the first mix toward the text color that reaches 3:1, and higher bands darken further (s x [1, 0.6] or s x [1, 0.74, 0.49]).
 * The three-band steps are the set closest to [1, 0.75, 0.5] (0.01 apart) that keeps neighbours 1.5:1 apart in both default themes: with 0.75 and 0.5 the light theme's gray bands 1 and 2 were 1.48:1.
 * The choice uses the theme's actual colors; painting uses p.mix, so CSS variables keep working
 */
export function horizonBandColors(p: Painter, base: string, n: number): string[] {
  const c = p.raw(base);
  const { panel, ink } = p.theme;
  const reaches = (hex: string) => contrastRatio(hex, panel) >= 3;
  const tone = (toward: "panel" | "ink", k: number) => (k >= 1 ? p.color(base) : isColorToken(base) ? p.mix(base, toward, k) : mixHex(c, p.theme[toward], k));
  const t = TOWARD_CARD.find((k) => reaches(mixHex(c, panel, k)));
  if (t !== undefined) return Array.from({ length: n }, (_, i) => tone("panel", n > 1 ? t + ((1 - t) * i) / (n - 1) : 1));
  const s = TOWARD_INK.find((k) => reaches(mixHex(c, ink, k))) ?? 0.5;
  return (n > 2 ? [1, 0.74, 0.49] : [1, 0.6]).slice(0, n).map((k) => tone("ink", s * k));
}

/** Band size B: robustMax(|value - baseline|) / bands, rounded up to 1, 2, 2.5 or 5 x 10^n. Larger values are clipped in the top band */
export function horizonBandSize(values: ArrayLike<number>, baseline: number, bands: number): number {
  // robustMax skips values that are not finite and returns 1 when none are left
  const m = robustMax(Array.from(values, (v) => Math.abs(v - baseline))) / bands;
  return m > 0 ? niceWidth(m, true) : 1;
}

/** One legend entry: optional text before, swatches of band colors (u above the baseline, d below), text after */
interface LegendEntry {
  pre?: string;
  tone: "u" | "d";
  bands: number[];
  text: string;
}
/** Entries flow left to right and wrap to a new line when the next one does not fit. sx is where an entry's swatches start */
function placeLegend(entries: LegendEntry[], w: number) {
  let x = 0;
  let line = 0;
  const at = entries.map((e) => {
    const pre = e.pre ? textWidth(e.pre, AXIS_FONT) + 4 : 0;
    const ew = pre + e.bands.length * (SWATCH + 2) + 2 + textWidth(e.text, AXIS_FONT);
    if (x > 0 && x + ew > w) {
      line++;
      x = 0;
    }
    const pos = { x, line, sx: x + pre };
    x += ew + 12;
    return pos;
  });
  return { at, lines: entries.length ? line + 1 : 0 };
}

/**
 * Horizon chart: many time series in thin rows. Each value is folded into a few colored bands of size B (stronger for larger values),
 * and values below the baseline are mirrored into the same row in the down color. Rows share one B by default, so their heights compare
 */
export function HorizonChart<T = Row>(props: HorizonChartProps<T>) {
  // The data, the bands and the legend text are worked out before useChart: the legend can wrap, and the chart height depends on it
  const locale = useChartLocale(props.locale);
  const msg = MSG[langOf(locale)];
  const prepped = useMemo(
    () => prepSeries(props.data, props.x, props.y as never, props.series, { xType: props.xType, locale, aggregate: props.aggregate, dayFirst: props.dayFirst }),
    [props.data, props.x, props.y, props.series, props.xType, locale, props.aggregate, props.dayFirst],
  );
  // Up to 60 rows. The validator reports the rest (too_many_series)
  const model = useMemo(() => (prepped.series.length <= HORIZON_MAX_SERIES ? prepped : { ...prepped, series: prepped.series.slice(0, HORIZON_MAX_SERIES), values: prepped.values.slice(0, HORIZON_MAX_SERIES), rows: prepped.rows.slice(0, HORIZON_MAX_SERIES) }), [prepped]);
  const nS = model.series.length;
  const K = model.keys.length;
  const rowH0 = clamp(Number.isFinite(props.rowHeight) ? props.rowHeight! : nS <= 24 ? 18 : 14, 12, 48);
  const bands = Number.isFinite(props.bands) ? clamp(Math.round(props.bands!), 1, 3) : rowH0 >= 24 ? 1 : 2;
  const baseline = Number.isFinite(props.baseline) ? props.baseline! : 0;
  const free = props.scale === "free";
  // One band size for every row, or one per row with "free"
  const sizes = useMemo(() => (free ? model.values.map((vs) => horizonBandSize(vs, baseline, bands)) : [horizonBandSize(model.values.flat(), baseline, bands)]), [model, baseline, bands, free]);
  const stats = useMemo(
    () =>
      model.values.map((vs) => {
        let last = NaN;
        let lastK = -1;
        let min = Infinity;
        let max = -Infinity;
        vs.forEach((v, k) => {
          if (!Number.isFinite(v)) return;
          last = v;
          lastK = k;
          min = Math.min(min, v);
          max = Math.max(max, v);
        });
        return { last, lastK, min, max };
      }),
    [model],
  );
  const below = stats.some((s) => s.min < baseline);
  // The same formatters useChart builds (c.fmt, c.fv), made here because the legend, and so the chart height, needs them first
  const fmt = useMemo(() => makeFormatter(props.format, locale), [props.format, locale]);
  const fv = useMemo(() => withUnit(fmt, props.unit), [fmt, props.unit]);
  const legendOn = props.legend !== false && nS > 0;
  const entries = useMemo((): LegendEntry[] => {
    if (!legendOn) return [];
    const all = Array.from({ length: bands }, (_, b) => b);
    const down: LegendEntry[] = below ? [{ tone: "d", bands: all, text: msg.below(fv(baseline)) }] : [];
    if (free) return [{ pre: msg.lower, tone: "u", bands: all, text: msg.higher }, ...down];
    const at = (b: number) => baseline + b * sizes[0];
    // Values past the top band are clipped into it, so then its range stays open, unless it is the only band: there the range is the only scale.
    // The bands mirror, so values below the baseline count too
    const cap = bands * sizes[0];
    const open = stats.some((st) => st.max - baseline > cap || baseline - st.min > cap);
    return [...all.map((b): LegendEntry => ({ tone: "u", bands: [b], text: open && b && b === bands - 1 ? msg.above(fv(at(b))) : msg.range(fmt(at(b)), fv(at(b + 1))) })), ...down];
  }, [legendOn, bands, below, free, msg, fmt, fv, baseline, sizes, stats]);
  const topOf = (lines: number) => (legendOn ? lines * LEGEND_LINE + 8 : 4);

  const c = useChart(props, { height: (w) => topOf(placeLegend(entries, w).lines) + Math.max(1, nS) * (rowH0 + GAP) - GAP + AXIS_H, duration: 900, stagger: 30 });
  const { p, width: W, height: H } = c;
  const gid = useId().replace(/:/g, "");
  // The pointed time (x index). Shown only while a row is active, so leaving the chart hides it
  const [time, setTime] = useState<number | null>(null);
  const t = c.active !== null && time !== null && time < K ? time : null;
  useEffect(() => {
    if (c.active === null) setTime(null);
  }, [c.active]);

  const legend = placeLegend(entries, W);
  const top = topOf(legend.lines);
  const rowH = props.height === undefined || !nS ? rowH0 : Math.max(2, (H - top - AXIS_H - (nS - 1) * GAP) / nS);
  const rowTop = (s: number) => top + s * (rowH + GAP);
  const rowsBottom = top + Math.max(1, nS) * (rowH + GAP) - GAP;
  const size = clamp(rowH - 1, 7, 11);
  const names = model.series;
  const display = (s: number) => names[s] || c.t.value;
  const showValues = props.showValues !== false;
  const nameW = Math.min(W * 0.28, Math.max(0, ...names.map((_, s) => textWidth(display(s), size, 700))) + 10);
  // The widest of each row's last, lowest and highest value (the value column does not jump while pointing)
  const valueW = useMemo(() => (showValues ? Math.max(0, ...stats.flatMap((st) => [st.last, st.min, st.max].filter(Number.isFinite).map((v) => textWidth(fv(v), size, 700)))) + 10 : 0), [showValues, stats, fv, size]);
  const x0 = nameW;
  const x1 = Math.max(x0 + 1, W - valueW);
  const xs = useMemo(() => xScaleFor(model as SeriesModel<unknown>, x0, x1), [model, x0, x1]);
  const centers = useMemo(() => model.keys.map((_, k) => xs(k)), [model, xs]);

  // Each row's area above and below the baseline, built once so that B fits the row height. Band b is the same path moved down (b - 1) rows
  const shapes = useMemo(() => {
    if (c.pending) return [];
    const budget = Math.max(3, Math.round(x1 - x0));
    return model.values.map((vs, s) => {
      const B = sizes[free ? s : 0];
      const bottom = top + s * (rowH + GAP) + rowH;
      // Connected runs (a missing value breaks the area), each reduced with LTTB to about one point per pixel
      let runs: number[][] = [];
      for (let k = 0; k < vs.length; k++) {
        if (!Number.isFinite(vs[k])) continue;
        const last = runs[runs.length - 1];
        if (last && last[last.length - 1] === k - 1) last.push(k);
        else runs.push([k]);
      }
      const count = runs.reduce((n, q) => n + q.length, 0);
      if (count > budget) runs = runs.map((q) => lttb(q.map((k) => ({ x: centers[k], y: vs[k], k })), Math.max(3, Math.round((budget * q.length) / count))).map((o) => o.k));
      const area = (sign: 1 | -1) => {
        let d = "";
        let any = false;
        for (const q of runs) {
          // [x, height] per kept point. Where two neighbours lie on opposite sides of the baseline, the crossing (height 0) goes between them, so the up and down areas meet there
          const pts: number[][] = [];
          q.forEach((k, i) => {
            const v = vs[k] - baseline;
            const u = i ? vs[q[i - 1]] - baseline : 0;
            if (u * v < 0) pts.push([centers[q[i - 1]] + ((centers[k] - centers[q[i - 1]]) * u) / (u - v), 0]);
            const h = Math.min(bands * rowH, (Math.max(0, sign * v) / B) * rowH);
            if (h > 0) any = true;
            pts.push([centers[k], h]);
          });
          // A point alone between gaps gets 2px, so it does not vanish
          const xy = pts.length > 1 ? pts : [[pts[0][0] - 1, pts[0][1]], [pts[0][0] + 1, pts[0][1]]];
          d += `M${r1(xy[0][0])},${r1(bottom)}L${xy.map(([x, h]) => `${r1(x)},${r1(bottom - h)}`).join("L")}L${r1(xy[xy.length - 1][0])},${r1(bottom)}Z`;
        }
        return any ? d : null;
      };
      return { u: area(1), d: area(-1) };
    });
  }, [c.pending, model, sizes, free, bands, baseline, rowH, top, x0, x1, centers]);

  // Band colors above (u) and below (d) the baseline
  const cols = useMemo(() => ({ u: horizonBandColors(p, "accent", bands), d: horizonBandColors(p, props.downColor || "neutralStrong", bands) }), [p, props.downColor, bands]);
  const toneOf = (s: number, v: number) => {
    const d = v - baseline;
    return cols[d >= 0 ? "u" : "d"][clamp(Math.ceil(Math.abs(d) / sizes[free ? s : 0]) - 1, 0, bands - 1)];
  };
  // The rows do not change while pointing, so a pointer move does not rebuild them (about 600 elements at 50 rows)
  const bandLayer = useMemo(
    () =>
      shapes.map((sh, s) => (
        <g key={s} clipPath={`url(#${gid}c${s})`}>
          <rect x={r1(x0)} y={r1(top + s * (rowH + GAP))} width={r1(x1 - x0)} height={r1(rowH)} fill={p.paint("lift")} />
          {(["u", "d"] as const).map((k) => {
            const d = sh[k];
            const id = `${gid}${k}${s}`;
            return d ? (
              <g key={k}>
                <g fill={cols[k][0]}>
                  <path id={id} d={d} />
                </g>
                {cols[k].slice(1).map((col, b) => (
                  <use key={b} href={`#${id}`} y={r1((b + 1) * rowH)} fill={col} />
                ))}
              </g>
            ) : null;
          })}
        </g>
      )),
    [shapes, gid, x0, x1, top, rowH, p, cols],
  );
  const hi = useMemo(() => resolveHighlight(props.highlight as never, names as never[], names, stats.map((st) => st.last), "none"), [props.highlight, names, stats]);

  // Rows wipe in from the left, one after another
  const stg = Math.min(c.motion.stagger ?? 30, 600 / Math.max(1, nS));
  const marks = useMemo<Mark<number>[]>(() => names.map((name, s) => ({ key: `r:${name}`, to: [1], from: [0], delay: s * stg, data: s })), [names, stg]);
  const m = useMotion(marks, c.motion);
  const shown = new Map(m.items.filter((it) => !it.exiting).map((it) => [it.data, it.v[0]]));

  const events: ChartEvent<T>[] = useMemo(
    () =>
      names.map((_, s) => {
        const st = stats[s];
        const ok = Number.isFinite(st.last);
        return { datum: st.lastK >= 0 ? model.rows[s][st.lastK] : null, index: s, key: names[s], label: names[s] || c.t.value, value: ok ? st.last : null, formatted: ok ? msg.item(fv(st.last), fv(st.min), fv(st.max)) : fv(NaN) };
      }),
    [names, stats, model, msg, fv, c.t.value],
  );

  // The pointed value: the active row at the pointed time, shared by the tooltip and the announcement
  const pt = c.active !== null && c.active < nS && t !== null ? { s: c.active, k: t, v: model.values[c.active][t] } : null;
  const tip: TooltipData | null = pt && { x: centers[pt.k], y: rowTop(pt.s), title: model.labels[pt.k], rows: [{ label: display(pt.s), value: fv(pt.v), color: Number.isFinite(pt.v) ? toneOf(pt.s, pt.v) : undefined }] };
  const announce = c.via === "keyboard" && pt ? msg.at(display(pt.s), model.labels[pt.k], fv(pt.v)) : undefined;

  const ends = stats.map((st, s) => ({ s, v: st.last })).filter((e) => Number.isFinite(e.v));
  let desc = `${msg.kind}. ${msg.desc(nS, K, bands, free ? null : fv(sizes[0]))}`;
  if (ends.length > 1) {
    const hiE = ends.reduce((a, b) => (b.v > a.v ? b : a));
    const loE = ends.reduce((a, b) => (b.v < a.v ? b : a));
    desc += msg.ends(display(hiE.s), fv(hiE.v), display(loE.s), fv(loE.v));
  }

  const legendLayer = legendOn ? (
    <g aria-hidden="true">
      {entries.map((e, i) => {
        const { x, line, sx } = legend.at[i];
        const y = line * LEGEND_LINE + 9;
        return (
          <g key={i}>
            {e.pre ? (
              <Txt x={x} y={y} size={AXIS_FONT} fill={p.paint("muted")}>
                {e.pre}
              </Txt>
            ) : null}
            {e.bands.map((b, j) => (
              <rect key={b} x={sx + j * (SWATCH + 2)} y={y - 6} width={SWATCH} height={12} rx={2} fill={cols[e.tone][b]} />
            ))}
            <Txt x={sx + e.bands.length * (SWATCH + 2) + 2} y={y} size={AXIS_FONT} fill={p.paint("muted")}>
              {e.text}
            </Txt>
          </g>
        );
      })}
    </g>
  ) : null;

  return (
    <ChartFrame
      c={c}
      kind={msg.kind}
      ariaLabel={props.ariaLabel}
      description={props.description ?? desc}
      events={events}
      tip={tip}
      renderTip={props.tooltip}
      className={props.className}
      style={props.style}
      theme={props.theme}
      announce={announce}
      onPointerMove={(px, py, e) => {
        if (!nS || !K) return;
        const s = clamp(Math.floor((py - top + GAP / 2) / (rowH + GAP)), 0, nS - 1);
        const k = nearestIndex(centers, px);
        if (k !== time) setTime(k);
        if (s !== c.active) c.setActive(s, e.pointerType === "touch" ? "touch" : "pointer");
      }}
      onKey={(e) => {
        if (!nS || !K) return false;
        // Left and right move in time on the selected row (the first row when none is selected); up and down stay the default row moves
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          setTime(clamp((t ?? K - 1) + (e.key === "ArrowRight" ? 1 : -1), 0, K - 1));
          c.setActive(c.active ?? 0, "keyboard");
          return true;
        }
        if (e.key === "Escape" && t !== null) {
          setTime(null);
          c.setActive(null, "keyboard");
          return true;
        }
        return false;
      }}
      defs={
        nS
          ? names.map((_, s) => (
              <clipPath key={s} id={`${gid}c${s}`}>
                <rect x={r1(x0)} y={r1(rowTop(s))} width={r1((x1 - x0) * (shown.get(s) ?? 1))} height={r1(rowH)} />
              </clipPath>
            ))
          : undefined
      }
    >
      {legendLayer}
      {bandLayer}
      {c.active !== null && c.active < nS ? <rect x={r1(x0 - 1.5)} y={r1(rowTop(c.active) - 1.5)} width={r1(x1 - x0 + 3)} height={r1(rowH + 3)} rx={3} fill="none" stroke={p.paint("ink")} pointerEvents="none" /> : null}
      {names.map((_, s) => {
        const strong = hi.has(s) || c.active === s;
        const y = rowTop(s) + rowH / 2;
        const weight = strong ? 700 : 500;
        const fill = p.paint(hi.size && !strong ? "muted" : "ink");
        return (
          <g key={s} pointerEvents="none">
            <Txt x={0} y={y} size={size} weight={weight} fill={fill}>
              {truncate(display(s), nameW - 8, size, weight)}
            </Txt>
            {showValues ? (
              <Txt x={W} y={y} anchor="end" size={size} weight={strong ? 700 : 600} fill={fill}>
                {fv(t !== null ? model.values[s][t] : stats[s].last)}
              </Txt>
            ) : null}
          </g>
        );
      })}
      {t !== null ? (
        <g className="ztd-guide" aria-hidden="true" pointerEvents="none" style={{ transform: `translate(${r1(centers[t])}px,0px)` }}>
          <line x1={0} x2={0} y1={top - 2} y2={rowsBottom + 2} stroke={p.paint("ink")} />
        </g>
      ) : null}
      {nS ? <XAxis c={c as ChartCtx<unknown>} model={model as SeriesModel<unknown>} xs={xs} x0={x0} x1={x1} y={rowsBottom + 13} /> : null}
      {t !== null ? <AxisPill p={p} x={centers[t]} y={rowsBottom + 13} label={model.labels[t]} width={W} /> : null}
    </ChartFrame>
  );
}
