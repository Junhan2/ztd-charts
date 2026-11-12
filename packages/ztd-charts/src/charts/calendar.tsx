import { useCallback, useMemo } from "react";
import { CanvasLayer } from "../core/CanvasLayer";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { cssEntrance, useCssEntrance } from "../core/css";
import { dayFirstOf, formatDate, isoDay, toDate, type DayFirstProps } from "../core/format";
import { resolveHighlight } from "../core/highlight";
import { lazyArray } from "../core/lazy";
import type { Mark } from "../core/motion";
import { colorScaleOf, scaleSwatch, scaleT } from "../core/palette";
import { extent, robustMax } from "../core/scale";
import { textWidth } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { getter, numGetter } from "../data/accessor";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Calendar heatmap",
  desc: (days: number, max: string) => `${plural(days, "day")}, max ${max}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "캘린더 히트맵", desc: (days, max) => `${days}일, 최대 ${max}` },
};

export interface CalendarHeatmapProps<T = Row> extends BaseChartProps<T>, DayFirstProps {
  /** Date field. Default "date" */
  date?: Accessor<T, unknown>;
  value?: Accessor<T, number>;
  /** First day of the week. 0 Sunday (default), 1 Monday */
  weekStart?: 0 | 1;
  /** Gap between cells (px). Default 2.5 */
  gap?: number;
  /** Above this many days, draw on canvas. Default 4000 (about 11 years) */
  canvasThreshold?: number;
  /** Paints the smallest value darkest (for ranks, where rank 1 should be darkest). Default false */
  colorReverse?: boolean;
  /** The value that gets the lightest color. Above it the accent color, below it gray (such as 0 for profit and loss). Days at 0 keep the empty cell color */
  colorCenter?: number;
  /** Paints in this many discrete steps instead of a smooth scale (2~12) */
  colorSteps?: number;
}

interface Day<T> {
  i: number;
  t: number;
  week: number;
  wd: number;
  year: number;
  value: number;
  datum: T | null;
}

const DAY = 86400000;
const MIN_OPACITY = 0.18;

/** Calendar heatmap: daily amounts on a weekly grid (over 1 year, split into rows by year) */
export function CalendarHeatmap<T = Row>(props: CalendarHeatmapProps<T>) {
  const model = useMemo(() => {
    const gd = getter(props.date, "date");
    const gv = numGetter(props.value, "value");
    const byDay = new Map<number, { v: number; d: T }>();
    const df = props.dayFirst ?? dayFirstOf(props.data.map((d, i) => gd(d, i)));
    props.data.forEach((d, i) => {
      const dt = toDate(gd(d, i), df);
      if (!dt) return;
      const key = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
      const prev = byDay.get(key);
      // A missing value stays missing (no colour, "-" in the table) unless the day also has a real one.
      const v = gv(d, i);
      const pv = prev?.v ?? NaN;
      byDay.set(key, { v: Number.isFinite(v) ? (Number.isFinite(pv) ? pv : 0) + v : pv, d });
    });
    const keys = [...byDay.keys()].sort((a, b) => a - b);
    const years = keys.length ? [...new Set(keys.map((k) => new Date(k).getFullYear()))].sort() : [];
    return { byDay, keys, years };
  }, [props.data, props.date, props.value, props.dayFirst]);

  const nYears = Math.max(1, model.years.length);
  const multi = nYears > 1;
  const c = useChart(props, { height: (w) => (multi ? nYears * Math.max(70, Math.min(110, w / 8)) + 18 : Math.max(120, Math.min(190, w / 4.6 + 24))), duration: 700 });
  const { p, width: W, height: H } = c;
  const ws = props.weekStart ?? 0;
  // Weekday names follow the locale (2024-01-07 is a Sunday). The left column is widened to fit the names of rows 1, 3 and 5
  const wd = useMemo(() => {
    const f = new Intl.DateTimeFormat(c.locale, { weekday: "short" });
    return Array.from({ length: 7 }, (_, d) => f.format(new Date(2024, 0, 7 + d)));
  }, [c.locale]);
  const leftW = Math.max(22, Math.ceil(Math.max(...[1, 3, 5].map((r) => textWidth(wd[(r + ws) % 7], 9.5)))) + 10);
  const topH = 16;
  const maxGap = props.gap ?? 2.5;

  const days = useMemo<Day<T>[]>(() => {
    const out: Day<T>[] = [];
    if (!model.keys.length) return out;
    const first = new Date(model.keys[0]);
    const last = new Date(model.keys[model.keys.length - 1]);
    const ranges = multi ? model.years.map((y) => [new Date(y, 0, 1), new Date(y, 11, 31)] as const) : [[first, last] as const];
    ranges.forEach(([a, b], yi) => {
      const start = new Date(a);
      start.setDate(start.getDate() - ((start.getDay() - ws + 7) % 7));
      // Step one calendar day at a time. Adding 24 hours would skip or repeat a day in time zones with daylight saving time
      const end = b.getTime();
      for (const d = new Date(a.getFullYear(), a.getMonth(), a.getDate()); d.getTime() <= end; d.setDate(d.getDate() + 1)) {
        const tt = d.getTime();
        const week = Math.floor((tt - start.getTime() + 3600000) / (7 * DAY));
        const hit = model.byDay.get(tt);
        out.push({ i: out.length, t: tt, week, wd: (d.getDay() - ws + 7) % 7, year: yi, value: hit ? hit.v : 0, datum: hit?.d ?? null });
      }
    });
    return out;
  }, [model, multi, ws]);

  const stats = useMemo(() => {
    let weeks = 1;
    for (const d of days) if (d.week + 1 > weeks) weeks = d.week + 1;
    const vals = days.map((d) => d.value);
    return { weeks, ext: extent(vals), top95: robustMax(vals.filter((v) => v > 0)) };
  }, [days]);
  const { weeks, top95 } = stats;
  const [mn, mx] = stats.ext;
  const useCanvas = c.hydrated && days.length > (props.canvasThreshold ?? 4000);
  const blockH = (H - (multi ? 4 : 0)) / nYears;
  // Room available for one cell plus its gap. When it is so narrow that cells would shrink below 2px, the gap shrinks in proportion too, so the grid never exceeds the width
  const room = Math.max(0, Math.min((W - leftW - 2) / weeks, (blockH - topH - 4) / 7));
  const gap = room - maxGap >= 2 ? maxGap : (room * maxGap) / (maxGap + 2);
  const cell = room - gap;
  const step = cell + gap;
  const gridW = weeks * step;
  const x0 = leftW + Math.max(0, (W - leftW - gridW) / 2);
  const span = Math.max(1e-9, top95 - Math.min(0, mn)) || 1;
  // Color scale options. With a center value, the side farther from it (95th percentile) sets the end
  const scale = useMemo(() => colorScaleOf(props.colorReverse, props.colorCenter, props.colorSteps), [props.colorReverse, props.colorCenter, props.colorSteps]);
  const center = scale.center;
  const dev = useMemo(() => (center === undefined ? 0 : Math.max(1e-9, robustMax(days.filter((d) => d.value).map((d) => Math.abs(d.value - center))))), [days, center]);
  /** Position of a cell's color: 0~1 (a scale that continues through negative days), or -1~1 with a center value. Shared by the SVG cells and the canvas */
  const tOf = useCallback((v: number) => (center === undefined ? Math.min(1, (v - Math.min(0, mn)) / span) : Math.max(-1, Math.min(1, (v - center) / dev))), [center, dev, mn, span]);
  const hi = useMemo(
    () =>
      resolveHighlight(
        props.highlight as never,
        days.map((d) => d.datum) as never[],
        lazyArray(days.length, (k) => isoDay(days[k].t)),
        // With reversed colors, the default highlight moves to the darkest day (the smallest value) too. Days without data (0) are left out
        props.colorReverse ? days.map((d) => (d.datum ? d.value : NaN)) : days.map((d) => d.value),
        props.colorReverse ? "min" : "max",
      ),
    [days, props.highlight, props.colorReverse],
  );

  const D = c.motion.duration ?? 700;
  // The SVG runs the per-week entrance in CSS, and the engine only handles the start time and waiting for the chart to come into view. The canvas draws from the progress value
  const marks = useMemo<Mark<number>[]>(() => [{ key: "__clock", to: [1], from: [0], delay: useCanvas ? 0 : D * 0.9, data: 0 }], [D, useCanvas]);
  const m = useMotion(marks, c.motion);

  const dayFmt = useMemo(() => new Intl.DateTimeFormat(c.locale, { month: "long", day: "numeric", weekday: "short", ...(multi ? { year: "numeric" } : {}) }), [c.locale, multi]);
  const fv = c.fv;
  const events: ChartEvent<T>[] = useMemo(
    () =>
      lazyArray(days.length, (k) => {
        const d = days[k];
        const known = Number.isFinite(d.value);
        return { datum: d.datum, index: d.i, key: String(d.t), label: dayFmt.format(d.t), value: known ? d.value : null, formatted: known ? fv(d.value) : "-" };
      }),
    [days, dayFmt, fv],
  );
  const pos = (d: Day<T>) => ({ x: x0 + d.week * step, y: d.year * blockH + topH + d.wd * step });

  let tip: TooltipData | null = null;
  if (c.active !== null && days[c.active]) {
    const d = days[c.active];
    const q = pos(d);
    tip = { x: q.x + cell / 2, y: q.y, title: events[c.active].label, rows: [{ label: c.t.value, value: Number.isFinite(d.value) ? c.fv(d.value) : "-", color: p.paint("accent") }] };
  }

  const pending = c.pending;
  const months = useMemo(() => {
    const out: { x: number; y: number; label: string }[] = [];
    // Nothing is drawn before the width is measured, so positions are not computed either
    if (pending) return out;
    let last = "";
    for (const d of days) {
      const dt = new Date(d.t);
      const key = `${d.year}-${dt.getMonth()}`;
      if (key !== last && dt.getDate() <= 7) {
        const x = x0 + d.week * step;
        const y = d.year * blockH + 7;
        // Skip a label within 26px of the last one kept. With narrow cells, one remains every two or three months
        const prev = out[out.length - 1];
        if (!prev || prev.y !== y || x - prev.x >= 26) out.push({ x, y, label: formatDate(dt, { month: "short", locale: c.locale }) });
        last = key;
      }
    }
    return out;
  }, [pending, days, x0, step, blockH, c.locale]);

  const msg = MSG[c.lang];
  const desc = props.description ?? `${msg.kind}. ${msg.desc(days.length, c.fv(mx))}.`;
  const enabled = useCssEntrance(c, m);
  // (year, week, weekday) cell → day index. A flat array instead of building 10,000 string keys (-1 is an empty cell)
  const dayIndex = useMemo(() => {
    const idx = new Int32Array(nYears * weeks * 7).fill(-1);
    for (const d of days) idx[(d.year * weeks + d.week) * 7 + d.wd] = d.i;
    return idx;
  }, [days, nYears, weeks]);
  const weekNodes = useMemo(() => {
    if (useCanvas || pending) return null;
    const byWeek = new Map<string, Day<T>[]>();
    for (const d of days) {
      const k = `${d.year}:${d.week}`;
      const arr = byWeek.get(k);
      if (arr) arr.push(d);
      else byWeek.set(k, [d]);
    }
    return [...byWeek.entries()].map(([k, list]) => {
      const w = list[0].week;
      return (
        <g key={k} style={cssEntrance(enabled, m.waiting, "fade", (w / Math.max(1, weeks - 1)) * D * 0.9, 320)}>
          {list.map((d) => {
            const q = { x: x0 + d.week * step, y: d.year * blockH + topH + d.wd * step };
            // Negative values get color too (tOf is a scale that continues through negatives). Only 0 gets the empty cell color
            const s = d.value ? scaleSwatch(p, tOf(d.value), MIN_OPACITY, scale) : null;
            const isHi = hi.has(d.i);
            return <rect key={d.i} x={q.x} y={q.y} width={cell} height={cell} rx={Math.min(2.5, cell / 3)} fill={s ? s.fill : p.paint("neutralSoft")} opacity={s ? s.opacity : undefined} stroke={isHi ? p.paint("ink") : "none"} strokeWidth={1.2} />;
          })}
        </g>
      );
    });
    // Hover uses the overlay below, so the 10,000 cells are not redrawn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCanvas, pending, days, enabled, m.waiting, m.generation, weeks, D, x0, step, blockH, topH, cell, p, scale, tOf, hi]);

  // Labels are not rebuilt on every frame during the entrance (27 years means over 400 of them)
  const labels = useMemo(
    () => (
      <g aria-hidden="true">
        {months.map((mm, k) => (
          <Txt key={k} x={mm.x} y={mm.y} size={10} fill={p.paint("muted")}>
            {mm.label}
          </Txt>
        ))}
        {Array.from({ length: nYears }, (_, yi) =>
          [1, 3, 5].map((r) => (
            <Txt key={`${yi}-${r}`} x={x0 - 6} y={yi * blockH + topH + r * step + cell / 2} anchor="end" size={9.5} fill={p.paint("muted")}>
              {wd[(r + ws) % 7]}
            </Txt>
          )),
        )}
        {multi
          ? model.years.map((y, yi) => (
              <Txt key={y} x={2} y={yi * blockH + 7} size={10} weight={700} fill={p.paint("ink")}>
                {String(y)}
              </Txt>
            ))
          : null}
      </g>
    ),
    [months, nYears, x0, blockH, topH, step, cell, ws, multi, model.years, p, wd],
  );

  const prog = useCanvas ? m.get("__clock")?.[0] ?? 1 : 1;
  const draw = useMemo(() => {
    // Draw the full grid once, then run the entrance by copying it week by week (column slices), changing only the opacity
    let bitmap: HTMLCanvasElement | null = null;
    let bitmapKey = "";
    const paintAll = (ctx: CanvasRenderingContext2D, acc: string, soft: string, ink: string, neg: string) => {
      const rad = Math.min(2.5, cell / 3);
      const rounded = cell >= 5 && typeof ctx.roundRect === "function";
      // Cells never overlap, so opacity is bucketed into 32 levels and each level is painted in a single pass
      const LEVELS = 32;
      const accBins: number[][] = Array.from({ length: LEVELS + 1 }, () => []);
      // Days below the center value (color scale option) are bucketed separately in gray
      const negBins: number[][] = Array.from({ length: LEVELS + 1 }, () => []);
      const softBins: number[] = [];
      const marked: number[] = [];
      for (let k = 0; k < days.length; k++) {
        const d = days[k];
        if (d.value) {
          const pos = scaleT(tOf(d.value), scale);
          (pos < 0 ? negBins : accBins)[Math.round((MIN_OPACITY + (1 - MIN_OPACITY) * Math.min(1, Math.abs(pos))) * LEVELS)].push(k);
        } else softBins.push(k);
        if (hi.has(d.i)) marked.push(k);
      }
      const shapes = (list: number[]) => {
        ctx.beginPath();
        for (const k of list) {
          const d = days[k];
          const x = x0 + d.week * step;
          const y = d.year * blockH + topH + d.wd * step;
          if (rounded) ctx.roundRect(x, y, cell, cell, rad);
          else ctx.rect(x, y, cell, cell);
        }
      };
      ctx.fillStyle = soft;
      shapes(softBins);
      ctx.fill();
      for (const [bins, col] of [[accBins, acc], [negBins, neg]] as const) {
        ctx.fillStyle = col;
        for (let b = 1; b <= LEVELS; b++) {
          if (!bins[b].length) continue;
          ctx.globalAlpha = b / LEVELS;
          shapes(bins[b]);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (marked.length) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.2;
        shapes(marked);
        ctx.stroke();
      }
    };
    // The last opacity drawn per column. Only changed columns are cleared and copied again (the whole canvas is not cleared every frame)
    let drawn: Float32Array | null = null;
    return (ctx: CanvasRenderingContext2D, t: number, color: (v: string, fb: string) => string) => {
      const acc = color("--ztd-accent", p.theme.accent);
      const soft = color("--ztd-neutral-soft", p.theme.neutralSoft);
      const ink = color("--ztd-ink", p.theme.ink);
      const neg = color("--ztd-neutral-strong", p.theme.neutralStrong);
      const pw = ctx.canvas.width;
      const ph = ctx.canvas.height;
      const k = pw / Math.max(1, W);
      const key = `${acc}|${soft}|${ink}|${neg}|${pw}x${ph}`;
      if (!bitmap || bitmapKey !== key || !drawn) {
        bitmap = bitmap ?? document.createElement("canvas");
        bitmap.width = pw;
        bitmap.height = ph;
        const b = bitmap.getContext("2d");
        if (!b) return;
        b.setTransform(k, 0, 0, k, 0, 0);
        b.clearRect(0, 0, W, H);
        paintAll(b, acc, soft, ink, neg);
        bitmapKey = key;
        ctx.clearRect(0, 0, W, H);
        drawn = new Float32Array(weeks);
      }
      // Week by week from left to right (the same order as the SVG's CSS entrance). The last week is fully revealed at t=1
      const last = Math.max(1, weeks - 1);
      // Column edges snap to device pixels so neighboring columns are untouched
      const edge = (w: number) => Math.round(Math.min(pw, Math.max(0, (x0 + w * step - gap / 2) * k)));
      for (let w = 0; w < weeks; w++) {
        const o = Math.max(0, Math.min(1, (t - (w / last) * 0.75) / 0.25));
        if (o === drawn[w]) continue;
        const a = edge(w);
        const b = w === weeks - 1 ? pw : edge(w + 1);
        if (b > a) {
          ctx.clearRect(a / k, 0, (b - a) / k, H);
          if (o > 0) {
            ctx.globalAlpha = o;
            ctx.drawImage(bitmap, a, 0, b - a, ph, a / k, 0, (b - a) / k, H);
          }
        }
        drawn[w] = o;
      }
      ctx.globalAlpha = 1;
    };
  }, [days, weeks, x0, step, gap, blockH, cell, hi, W, H, p.theme.accent, p.theme.neutralSoft, p.theme.ink, p.theme.neutralStrong, scale, tOf]);

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
        const w = Math.floor((px - x0) / step);
        const yi = Math.floor(py / blockH);
        const wd = Math.floor((py - yi * blockH - topH) / step);
        const hit = yi >= 0 && yi < nYears && w >= 0 && w < weeks && wd >= 0 && wd < 7 ? dayIndex[(yi * weeks + w) * 7 + wd] : -1;
        const k = hit >= 0 ? hit : null;
        if (k !== c.active) c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer");
      }}
      onKey={(e) => {
        // Columns are weeks, so left and right arrows move one week (up and down move one day, as by default). Stops at the ends
        const d = e.key === "ArrowRight" ? 7 : e.key === "ArrowLeft" ? -7 : 0;
        if (!d || c.active === null) return false;
        if (days[c.active + d]) c.setActive(c.active + d, "keyboard");
        return true;
      }}
      underlay={useCanvas ? <CanvasLayer width={W} height={H} draw={draw} progress={prog} version={c.sig} manualClear /> : undefined}
    >
      {labels}
      {weekNodes ? <g key={m.generation}>{weekNodes}</g> : null}
      {c.active !== null && days[c.active] ? <rect x={pos(days[c.active]).x - 0.5} y={pos(days[c.active]).y - 0.5} width={cell + 1} height={cell + 1} rx={Math.min(3, cell / 3)} fill="none" stroke={p.paint("ink")} strokeWidth={1.6} pointerEvents="none" /> : null}
    </ChartFrame>
  );
}
