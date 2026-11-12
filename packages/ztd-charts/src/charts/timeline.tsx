import { useMemo, type KeyboardEvent, type ReactNode } from "react";
import { Tag, tagBox } from "../core/annotations";
import { AXIS_FONT, fitTickLabels } from "../core/axis";
import { BrushBand, useChartBrush, useZoom, type BrushProps } from "../core/brush";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { formatDate, formatDuration, makeTickFormatter, withUnit, type DayFirstProps } from "../core/format";
import { argMax, nearestIndex } from "../core/geometry";
import { HIGHLIGHT_KEYWORDS, resolveHighlight } from "../core/highlight";
import { plural, type ChartLang } from "../core/i18n";
import type { Mark } from "../core/motion";
import { categorical, swatch, type Swatch } from "../core/palette";
import { scaleLinear, timeTicks, type TimeTick } from "../core/scale";
import { overlaps, textWidth, truncate, type Box } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Highlight, Row, TooltipData, TooltipRow } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { DAY, readTimeline, statusStrip, timelineDomain, timelineGroups, timelineRows, type TimeKind, type TimelineItem, type TimelineSort } from "../layout/timeline";

const en = {
  kind: "Timeline",
  start: "Start",
  end: "End",
  at: "At",
  duration: "Duration",
  status: "Status",
  group: "Group",
  open: "open",
  now: "Now",
  range: (a: string, b: string) => `${a} to ${b}`,
  desc: (n: number, rows: number, a: string, b: string) => `${plural(n, "item")} on ${plural(rows, "row")}, from ${a} to ${b}`,
  longest: (label: string, d: string) => `Longest: ${label}, ${d}`,
  lines: "Reference lines",
  strip: (parts: string, more: number) => `Status strip: ${parts}${more ? `, and ${more} more` : ""}.`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "타임라인",
    start: "시작",
    end: "끝",
    at: "시각",
    duration: "걸린 시간",
    status: "상태",
    group: "묶음",
    open: "진행 중",
    now: "지금",
    range: (a, b) => `${a}~${b}`,
    desc: (n, rows, a, b) => `항목 ${n}개, 줄 ${rows}개, ${a}부터 ${b}까지`,
    longest: (label, d) => `가장 긴 항목은 ${label}, ${d}`,
    lines: "기준선",
    strip: (parts, more) => `상태 띠: ${parts}${more ? ` 외 ${more}개` : ""}.`,
  },
};

/** A vertical reference line on the time axis. x takes the same form as the axis (number or date) */
export interface TimelineReferenceLine {
  x: unknown;
  label?: string;
}

export interface TimelineProps<T = Row> extends BaseChartProps<T>, BrushProps, DayFirstProps {
  /** Row name field. Items with the same name share a row. Default "label" */
  label?: Accessor<T, string>;
  /** Start field (number, date, or date and time). Default "start" */
  start?: Accessor<T, unknown>;
  /** End field. When equal to the start, the item is an event drawn as a point; when empty, it is an open item that runs to now (or to the latest time when now is not set). Default "end" */
  end?: Accessor<T, unknown>;
  /** Group field. Each group gets its own color, and the legend is built from it */
  group?: Accessor<T, string>;
  /** Status field. Written inside bars and in the tooltip; without group, it sets the bar colors and the legend (status strip) */
  status?: Accessor<T, string>;
  /** Time axis kind. When omitted, "date" if most start and end cells are dates, otherwise "number". With "date", numbers are read as timestamps (10 digits means seconds) or years */
  xType?: TimeKind;
  /** Row order. "none" is data order, "start" earliest start first, "duration" longest total duration first. Default "none" */
  sort?: TimelineSort;
  /** Vertical reference lines on the time axis [{ x, label }]. Not drawn outside the axis range */
  referenceLines?: readonly TimelineReferenceLine[];
  /** Time of the "Now" vertical line (same form as the axis). Open items run up to it. The clock is never read while drawing, so server and browser renders match */
  now?: unknown;
  /** Groups to hide (group values, or status values without group). Colors and rows stay the same as when everything is shown */
  hidden?: readonly string[];
  /**
   * Adds a status strip as the bottom row. Consecutive runs of the same status in time order merge into one cell, painted in the status color with the status written inside.
   * Bars then use the default color (the longest item gets the accent color) and show the duration instead of the status. Requires status. Default false
   */
  statusStrip?: boolean;
}

/** Lane (one line of overlapping items) height: default, plot height cap, floor. With very many lanes, they are drawn at the floor (2px) and the chart grows taller accordingly */
const LANE_H = 26;
const MAX_PLOT_H = 520;
const MIN_LANE_H = 2;
const AXIS_H = 22;
/** Row name font size and the height one row needs. When rows are shorter than this, only every few rows get a name */
const ROW_FONT = 11.5;
const ROW_TEXT_H = 13;
/** Text on bars (duration, status): only when a lane is at least this tall */
const BAR_TEXT_MIN_LANE = 14;
const BAR_FONT = 11;
/** Inner padding (px) at both ends of the time axis, so point marks at the ends stay inside the plot */
const EDGE = 7;
/** Fill opacity of open items (items with an empty end). The dashed outline is strong, and the text inside is ink */
const OPEN_TINT = 0.28;
/** Minimum bar width (px). Short items on a long axis stay visible and can be pointed at (the tooltip and screen reader give the actual duration) */
const MIN_BAR_W = 3;
/** Maximum entrance delay (ms). The entrance never drags on, even with many items */
const MAX_DELAY = 600;
/** Gap between the status strip (bottom row) and the lane above. The strip row is LANE_H tall, and its cells are as tall as the bars in a default lane */
const STRIP_GAP = 6;
const STRIP_BAR = LANE_H * 0.62;

/**
 * Time ticks. Short ranges that need minute or second units (tick spacing of 30 minutes or less) and year-level ranges are picked here; everything in between (hours, days, weeks, months, quarters) uses timeTicks, as in the line chart.
 * Year ticks sit on January 1 of years that are multiples of a 1, 2, 5, 10, 20 or 50 year step (2000, 2005, 2010)
 */
function clockTicks(t0: number, t1: number, max: number, locale: string): TimeTick[] {
  const want = (t1 - t0) / Math.max(1, max);
  // Same threshold at which timeTicks switches to year units (tick spacing over six months)
  if (t1 > t0 && want > DAY * 30.44 * 6) {
    const y0 = new Date(t0).getFullYear();
    const years = new Date(t1).getFullYear() - y0;
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((k) => years / k <= max) ?? 1000;
    const out: TimeTick[] = [];
    for (let y = Math.ceil(y0 / step) * step, n = 0; n < 500; y += step, n++) {
      const t = new Date(y, 0, 1).getTime();
      if (t > t1) break;
      if (t >= t0) out.push({ t, label: formatDate(t, { locale, year: "numeric" }) });
    }
    if (out.length >= 2) return out;
  }
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800].map((s) => s * 1000).find((s) => s >= want);
  if (!(t1 > t0) || step === undefined) return timeTicks(t0, t1, max, locale);
  const fmt: Intl.DateTimeFormatOptions = step < 60000 ? { hour: "numeric", minute: "2-digit", second: "2-digit" } : { hour: "numeric", minute: "2-digit" };
  // Align to local time (so time zones like +5:30 still get ticks on the hour and half hour)
  const off = new Date(t0).getTimezoneOffset() * 60000;
  const out: TimeTick[] = [];
  for (let t = Math.ceil((t0 - off) / step) * step + off, n = 0; t <= t1 && n < 500; t += step, n++) out.push({ t, label: formatDate(t, { locale, ...fmt }) });
  return out;
}

/** Picks group names out of the highlight list and maps them to group indexes. Shared by the colors (the categorical highlight) and the card legend */
export function timelineGroupHighlight(h: Highlight<never> | undefined, groups: readonly string[]): Set<number> {
  const list = typeof h === "string" ? [h] : Array.isArray(h) ? h : [];
  const out = new Set<number>();
  for (const x of list) if (typeof x === "string" && !HIGHLIGHT_KEYWORDS.includes(x)) groups.forEach((g, i) => g === x && out.add(i));
  return out;
}

/** First index in a sorted array whose value is at least v (greater than v with after). The length when there is none */
function bound(sorted: readonly number[], v: number, after = false): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (after ? sorted[mid] <= v : sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Timeline: things with a start and an end (schedules, deploys and job runs, agent run logs, incident timelines) as bars on a time axis.
 * Items with the same name share a row, and overlapping items get separate lanes so none is hidden. An item whose start equals its end is a point
 */
export function Timeline<T = Row>(props: TimelineProps<T>) {
  const model = useMemo(
    () => readTimeline(props.data, { label: props.label, start: props.start, end: props.end, group: props.group, status: props.status }, { xType: props.xType, dayFirst: props.dayFirst, now: props.now }),
    [props.data, props.label, props.start, props.end, props.group, props.status, props.xType, props.dayFirst, props.now],
  );
  const { items, kind, dateOnly } = model;
  const sort: TimelineSort = props.sort === "start" || props.sort === "duration" ? props.sort : "none";
  const { rows, lane } = useMemo(() => timelineRows(items, sort), [items, sort]);
  const lanes = rows.reduce((s, r) => s + r.lanes, 0);
  // Status strip: only when turned on and some item has a status. Adds one row below the lanes
  const stripOn = props.statusStrip === true && props.status !== undefined && items.some((it) => it.status !== "");
  const stripH = stripOn ? STRIP_GAP + LANE_H : 0;
  // From a spec it may not be an array (the validator reports it)
  const refLines = Array.isArray(props.referenceLines) ? props.referenceLines : [];
  const top = refLines.length > 0 || props.now !== undefined ? 24 : 6;
  const c = useChart(props, { height: () => top + AXIS_H + stripH + Math.max(40, Math.min(lanes * LANE_H, MAX_PLOT_H), lanes * MIN_LANE_H), duration: 700, stagger: 40 });
  const { p, width: W, height: H, locale, fv } = c;
  const msg = MSG[c.lang];
  const zoom = useZoom(c.sig);

  // Order for the keyboard, table and highlight: row order, then time order within a row. order[e] is a position in items
  const order = useMemo(() => rows.flatMap((r) => r.items), [rows]);
  // The value that splits colors: group, or status without it (status strip). Same rows and same rule as the card legend (values of rows dropped as unreadable still keep their color slot)
  const byStatus = props.group === undefined;
  const colorField = byStatus ? props.status : props.group;
  const keyOf = (it: TimelineItem) => (byStatus ? it.status : it.group);
  const groups = useMemo(() => (colorField === undefined ? [] : timelineGroups(props.data, colorField, byStatus)), [props.data, colorField, byStatus]);
  const groupOf = useMemo(() => new Map(groups.map((g, i) => [g, i])), [groups]);
  const hl = props.highlight;
  // For a group highlighted by name, the accent color is the highlight. Other highlighted items (the longest item, a row name) get an outline over their group color
  const namedGroups = useMemo(() => timelineGroupHighlight(hl as Highlight<never>, groups), [hl, groups]);
  // Bar color comes from the group, or from the status without one. When the status strip takes over the status colors, bars use the default color, so the longest item is highlighted (the legend still shows statuses, in the strip's colors)
  const barColored = groups.length > 0 && !(stripOn && byStatus);
  const hiItems = useMemo(() => {
    const dur = order.map((k) => items[k].end - items[k].start);
    const at = resolveHighlight(hl, order.map((k) => items[k].datum), order.map((k) => items[k].label), dur, barColored ? "none" : "max");
    const out = new Set([...at].map((e) => order[e]));
    // Highlighting by group name highlights every item in that group
    if (namedGroups.size) items.forEach((it, k) => namedGroups.has(groupOf.get(keyOf(it)) ?? -1) && out.add(k));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hl, order, items, barColored, groupOf, namedGroups, byStatus]);
  const colors = useMemo<Swatch[] | null>(() => (groups.length ? categorical(p, groups.length, namedGroups) : null), [p, groups, namedGroups]);
  const barColors = barColored ? colors : null;
  // Strip colors: the legend colors when the legend shows statuses; when it shows groups, computed separately for the statuses by the same rule (rarer statuses are darker)
  const stripGroups = useMemo(() => (!stripOn ? [] : byStatus ? groups : timelineGroups(props.data, props.status!, true)), [stripOn, byStatus, groups, props.data, props.status]);
  const stripColors = useMemo<Swatch[]>(
    () => (!stripOn ? [] : byStatus && colors ? colors : categorical(p, stripGroups.length, timelineGroupHighlight(hl as Highlight<never>, stripGroups))),
    [stripOn, byStatus, colors, p, stripGroups, hl],
  );
  const stripOf = useMemo(() => new Map(stripGroups.map((g, i) => [g, i])), [stripGroups]);
  const hiddenKey = Array.isArray(props.hidden) ? props.hidden.join("\u0001") : "";
  const off = useMemo(() => new Set(groups.length && hiddenKey ? hiddenKey.split("\u0001") : []), [groups.length, hiddenKey]);

  // Item start and end times (drag to zoom snaps to these)
  const bounds = useMemo(() => Array.from(new Set(items.flatMap((it) => [it.start, it.end]))).sort((a, b) => a - b), [items]);
  const lo = bounds.length ? bounds[0] : 0;
  const hi = bounds.length ? bounds[bounds.length - 1] : 1;
  const full = useMemo(() => timelineDomain(model), [model]);
  const zv = zoom.view && bounds[zoom.view[1]] > bounds[zoom.view[0]] ? zoom.view : null;
  const v0 = zv ? bounds[zv[0]] : full[0];
  const v1 = zv ? bounds[zv[1]] : full[1];

  // Time text: value + unit for numbers; month and day for dates only (plus the year when spanning several years); the time within a single day; otherwise date and time
  const timeFmt = useMemo((): Intl.DateTimeFormatOptions => {
    if (dateOnly) return new Date(lo).getFullYear() === new Date(hi).getFullYear() ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" };
    const clock: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", ...(model.hasSeconds ? { second: "2-digit" } : {}) };
    return hi - lo < DAY * 1.5 ? clock : { month: "short", day: "numeric", ...clock };
  }, [dateOnly, model.hasSeconds, lo, hi]);
  const tText = (t: number) => (kind === "number" ? fv(t) : formatDate(t, { locale, ...timeFmt }));
  // Duration: value + unit on a number axis, a day count for dates only (a day with a DST change still counts as one day), otherwise the "2d 4h" form. Shared by the tooltip, bar text and range selection
  const spanText = (ms: number) => (kind === "number" ? fv(ms) : formatDuration(dateOnly ? Math.round(ms / DAY) * DAY : ms, locale));
  // Per-item text that never changes: the duration and its width (regular and highlight weight). Not rebuilt on every entrance frame
  const durs = useMemo(() => {
    const text = items.map((it) => spanText(it.end - it.start));
    return { text, w: text.map((s) => textWidth(s, BAR_FONT, 600)), wHi: text.map((s) => textWidth(s, BAR_FONT, 800)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, kind, dateOnly, fv, locale]);

  // Row name column, plot area
  const stripName = stripOn ? msg.status : "";
  const longestLabel = useMemo(() => rows.reduce((w, r) => Math.max(w, textWidth(r.label, ROW_FONT, 700)), Math.max(24, stripName ? textWidth(stripName, ROW_FONT, 700) : 0)), [rows, stripName]);
  const labelW = Math.min(W * 0.32, longestLabel + 10);
  const x0 = labelW + 10;
  const x1 = Math.max(x0 + 10, W - 16);
  const plotBottom = H - AXIS_H;
  // Bottom edge of the lanes. The status strip is one row below it
  const lanesBottom = plotBottom - stripH;
  const stripY = lanesBottom + STRIP_GAP + LANE_H / 2;
  const laneH = (lanesBottom - top) / Math.max(1, lanes);
  const bh = laneH >= 6 ? Math.min(18, Math.max(4, laneH * 0.62)) : Math.max(1, laneH * 0.8);
  // Inset both ends by half a point mark's width (so a point at the axis end does not touch the row names)
  const xs = scaleLinear([v0, v1], [x0 + EDGE, x1 - EDGE]);
  const rowOf = useMemo(() => {
    const m = new Int32Array(items.length);
    rows.forEach((r, ri) => r.items.forEach((k) => (m[k] = ri)));
    return m;
  }, [rows, items.length]);
  const yOf = (k: number) => top + (rows[rowOf[k]].lane0 + lane[k] + 0.5) * laneH;

  // Visible items: not in a hidden group and overlapping the current range. events follow this order
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shown = useMemo(() => order.filter((k) => !off.has(keyOf(items[k])) && items[k].end >= v0 && items[k].start <= v1), [order, off, items, v0, v1, byStatus]);
  const eventOf = useMemo(() => new Map(shown.map((k, e) => [k, e])), [shown]);
  // The status strip is built from the visible items (excluding hidden groups and items out of range)
  const strip = useMemo(() => (stripOn ? statusStrip(items, shown) : null), [stripOn, items, shown]);

  const stg = c.motion.stagger ?? 40;
  const textOn = c.showLabels && laneH >= BAR_TEXT_MIN_LANE;
  const marks = useMemo<Mark<number>[]>(() => {
    const seen = new Map<string, number>();
    return shown.map((k, e) => {
      const it = items[k];
      const n = (seen.get(it.label) ?? 0) + 1;
      seen.set(it.label, n);
      const xa = Math.max(x0, Math.min(x1, xs(it.start)));
      const xb = it.point ? xa : Math.max(xa + MIN_BAR_W, Math.min(x1, xs(it.end)));
      const y = yOf(k);
      return { key: `${it.label}\u0001${n}`, to: [xa, xb, 1, y], from: [xa, xa, 0, y], delay: Math.min(e * stg, MAX_DELAY), data: k };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, items, rows, rowOf, lane, x0, x1, v0, v1, top, laneH, stg]);
  const m = useMotion(marks, c.motion);

  // Status text inside bars: shortened once, for the final width (not on every entrance frame). Points are measured but not shortened. With a status strip, statuses are written only in the strip
  const statusFit = useMemo(() => {
    const out = new Map<number, { text: string; w: number }>();
    if (!textOn || stripOn) return out;
    for (const mk of marks) {
      const it = items[mk.data];
      if (!it.status) continue;
      const text = it.point ? it.status : truncate(it.status, Math.max(1, mk.to[1] - mk.to[0]) - 12, BAR_FONT, 600);
      out.set(mk.data, { text, w: textWidth(text, BAR_FONT, 600) });
    }
    return out;
  }, [marks, items, textOn, stripOn]);

  // Items with an empty group are gray, with no group color (they are not in the legend either)
  const swOf = (k: number): Swatch => {
    const g = groupOf.get(keyOf(items[k]));
    return barColors && g !== undefined ? barColors[g] : swatch(p, !barColors && hiItems.has(k) ? "accent" : "neutral");
  };

  // Start (px) of the next item in the same lane: the room for writing the duration after the bar
  const nextX = useMemo(() => {
    const out = new Float64Array(items.length).fill(W - 2);
    for (const r of rows) {
      const last = new Map<number, number>();
      for (const k of r.items) {
        if (off.has(keyOf(items[k]))) continue;
        const prev = last.get(lane[k]);
        if (prev !== undefined) out[prev] = xs(items[k].start);
        last.set(lane[k], k);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, items, lane, off, W, x0, x1, v0, v1, byStatus]);

  const events: ChartEvent<T>[] = useMemo(
    () =>
      shown.map((k, e) => {
        const it = items[k];
        const when = it.point ? tText(it.start) : `${msg.range(tText(it.start), tText(it.end))}, ${durs.text[k]}`;
        return { datum: it.datum, index: e, key: `${it.label}#${it.i}`, label: it.label, value: it.end - it.start, ...(it.group && { series: it.group }), formatted: `${when}${it.status ? `, ${it.status}` : ""}` };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, items, msg, durs, fv, locale, timeFmt, kind],
  );

  // Drag to zoom (the line chart's brush). The range snaps to the start and end times of items in the current range
  const { b0, visB, visX } = useMemo(() => {
    const a = bound(bounds, v0);
    const vis = bounds.slice(a, Math.max(a, bound(bounds, v1, true)));
    return { b0: a, visB: vis, visX: vis.map((t) => xs(t)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, v0, v1, x0, x1]);
  const activeK = c.active !== null ? shown[c.active] : undefined;
  const { brush, frame: brushFrame, hint } = useChartBrush({ brush: props.brush ? "zoom" : false, onBrush: props.onBrush }, zoom, {
    p,
    active: activeK === undefined ? null : Math.max(0, nearestIndex(visB, items[activeK].start)),
    lang: c.lang,
    count: visB.length,
    indexAt: (px) => nearestIndex(visX, px),
    inPlot: (px, py) => px >= x0 - 4 && px <= x1 + 4 && py >= top && py <= plotBottom,
    toXRange: (r) => ({ from: b0 + r.from, to: b0 + r.to, fromKey: String(visB[r.from]), toKey: String(visB[r.to]), fromLabel: tText(visB[r.from]), toLabel: tText(visB[r.to]) }),
  });

  // Pointer: the item containing x in the lane at that height, or else the nearest item within 10px. On the status strip, the item that set the strip color at that time (points within 6px)
  const pick = (px: number, py: number): number | null => {
    if (strip && py >= lanesBottom + STRIP_GAP / 2 && py <= plotBottom) {
      const at = strip.points.find((k) => Math.abs(xs(items[k].start) - px) <= 6);
      if (at !== undefined) return eventOf.get(at) ?? null;
      const t = xs.invert(px);
      const piece = strip.pieces.find((q) => q.t0 <= t && t < q.t1);
      return piece ? (eventOf.get(piece.k) ?? null) : null;
    }
    const g = Math.floor((py - top) / laneH);
    if (g < 0 || g >= lanes) return null;
    let lo2 = 0;
    let hi2 = rows.length - 1;
    while (lo2 < hi2) {
      const mid = (lo2 + hi2 + 1) >> 1;
      if (rows[mid].lane0 <= g) lo2 = mid;
      else hi2 = mid - 1;
    }
    const r = rows[lo2];
    let best: number | null = null;
    let bd = 10;
    for (const k of r.items) {
      const e = eventOf.get(k);
      if (e === undefined || lane[k] !== g - r.lane0) continue;
      const a = xs(items[k].start);
      const d = Math.max(0, a - px, px - Math.max(xs(items[k].end), items[k].point ? a : a + MIN_BAR_W));
      if (d < bd || (d === 0 && bd === 0)) {
        bd = d;
        best = e;
      }
    }
    return best;
  };

  // Keyboard: up and down move between rows, left and right through time order within the row. Moving to another row lands on the item with the closest start
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (brushFrame.onKey?.(e)) return true;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "ArrowLeft" && e.key !== "ArrowRight") return false;
    if (!shown.length) return true;
    if (activeK === undefined) {
      c.setActive(e.key === "ArrowUp" || e.key === "ArrowLeft" ? shown.length - 1 : 0, "keyboard");
      return true;
    }
    const ri = rowOf[activeK];
    const inRow = (r: number) => rows[r].items.filter((k) => eventOf.has(k));
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const list = inRow(ri);
      const next = list[list.indexOf(activeK) + (e.key === "ArrowRight" ? 1 : -1)];
      if (next !== undefined) c.setActive(eventOf.get(next)!, "keyboard");
      return true;
    }
    const step = e.key === "ArrowDown" ? 1 : -1;
    for (let r = ri + step; r >= 0 && r < rows.length; r += step) {
      const list = inRow(r);
      if (!list.length) continue;
      const t = items[activeK].start;
      const near = list.reduce((a, k) => (Math.abs(items[k].start - t) < Math.abs(items[a].start - t) ? k : a), list[0]);
      c.setActive(eventOf.get(near)!, "keyboard");
      break;
    }
    return true;
  };

  let tip: TooltipData | null = null;
  let announce = "";
  if (activeK !== undefined && !brush.dragging) {
    const it = items[activeK];
    const sw = swOf(activeK);
    const tr: TooltipRow[] = it.point
      ? [{ label: msg.at, value: tText(it.start), color: sw.fill }]
      : [
          { label: msg.start, value: tText(it.start), strong: false },
          { label: msg.end, value: it.open ? `${tText(it.end)} (${msg.open})` : tText(it.end), strong: false },
          { label: msg.duration, value: durs.text[activeK], color: sw.fill },
        ];
    if (it.group) tr.push({ label: msg.group, value: it.group, strong: false });
    if (it.status) tr.push({ label: msg.status, value: it.status, strong: false });
    const xa = Math.max(x0, xs(it.start));
    const xb = Math.max(xa + (it.point ? 0 : MIN_BAR_W), Math.min(x1, xs(it.end)));
    tip = { x: (xa + xb) / 2, y: yOf(activeK) - bh / 2, title: it.label, rows: tr };
    if (c.via === "keyboard") announce = `${it.label}, ${events[c.active!].formatted}`;
  }

  // The range being dragged
  let brushLayer: ReactNode = null;
  if (brush.range && brush.range.to < visB.length) {
    const a = visB[brush.range.from];
    const b = visB[brush.range.to];
    const span = spanText(b - a);
    brushLayer = <BrushBand p={p} x0={xs(a)} x1={xs(b)} top={top} bottom={plotBottom} width={W} main={span} sub={msg.range(tText(a), tText(b))} dragging={brush.dragging} />;
    if (!brush.dragging) announce = `${msg.range(tText(a), tText(b))}, ${span}.${hint}`;
  }

  // Ticks: value + unit for numbers; for dates, a unit that fits the range (seconds to years)
  const maxTicks = Math.max(2, Math.floor((x1 - x0) / (kind === "number" ? 70 : 64)));
  // Number ticks match other number axes: large numbers in compact form (2T), or the set format. The tooltip and screen reader use the full number
  const userFormat = props.format;
  const unit = props.unit;
  const ticks = useMemo(
    () => {
      const tf = withUnit(makeTickFormatter(userFormat, locale, Math.max(Math.abs(v0), Math.abs(v1))), unit);
      return fitTickLabels(kind === "number" ? xs.ticks(maxTicks).map((t) => ({ x: xs(t), label: tf(t) })) : clockTicks(v0, v1, maxTicks, locale).map((t) => ({ x: xs(t.t), label: t.label })), -2, W + 2);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, maxTicks, v0, v1, x0, x1, W, userFormat, unit, locale],
  );

  // Reference lines: only those in range. Labels go in the band on top; when a label would overlap the previous one, only the line is drawn
  const lines = [
    ...refLines.map((r) => ({ t: model.read(r?.x), label: typeof r?.label === "string" ? r.label : "", now: false })),
    ...(props.now !== undefined ? [{ t: model.read(props.now), label: msg.now, now: true }] : []),
  ].filter((l) => Number.isFinite(l.t) && l.t >= v0 && l.t <= v1);
  const taken: Box[] = [];
  const lineNodes = lines.map((l, i) => {
    const x = xs(l.t);
    const text = l.label ? truncate(l.label, 140, 10.5, l.now ? 700 : 500) : "";
    const left = x + tagBox(text, 0, 0, "start", l.now).w + 2 > W;
    const box = text ? tagBox(text, left ? x - 3 : x + 3, top - 14, left ? "end" : "start", l.now) : null;
    const fits = box !== null && box.x >= 0 && !taken.some((o) => overlaps(box, o, 4));
    if (fits) taken.push(box);
    return (
      <g key={i}>
        <line x1={x} x2={x} y1={top - (fits ? 14 : 2)} y2={plotBottom} stroke={p.paint(l.now ? "ink" : "dim")} strokeOpacity={l.now ? 0.55 : 1} strokeDasharray={l.now ? "2 3" : "4 3"} />
        {fits ? <Tag p={p} x={left ? x - 3 : x + 3} y={top - 14} text={text} anchor={left ? "end" : "start"} strong={l.now} /> : null}
      </g>
    );
  });

  // Row names: when rows are short, one every k rows (so they do not overlap). They do not change during the entrance and are rebuilt only when the pointed row changes
  const activeRow = activeK === undefined ? -1 : rowOf[activeK];
  const rowNodes = useMemo(() => {
    const minLanes = rows.reduce((mn, r) => Math.min(mn, r.lanes), Infinity);
    const every = Math.max(1, Math.ceil(ROW_TEXT_H / Math.max(0.01, Math.min(minLanes * laneH, LANE_H))));
    const split = rows.some((r) => r.lanes > 1);
    let lastY = -Infinity;
    return rows.map((r, ri) => {
      const y = top + (r.lane0 + r.lanes / 2) * laneH;
      const show = ri % every === 0 && y - lastY >= ROW_TEXT_H;
      if (show) lastY = y;
      const strong = ri === activeRow || r.items.some((k) => hiItems.has(k));
      return (
        <g key={ri}>
          {split && ri ? <line x1={0} x2={W} y1={top + r.lane0 * laneH} y2={top + r.lane0 * laneH} stroke={p.paint("line")} opacity={0.7} /> : null}
          {show ? (
            <Txt x={labelW} y={y} anchor="end" size={ROW_FONT} weight={strong ? 700 : 600} fill={p.paint(strong ? "ink" : "muted")}>
              {truncate(r.label, labelW - 4, ROW_FONT, 700)}
            </Txt>
          ) : null}
        </g>
      );
    });
  }, [rows, laneH, top, labelW, W, p, hiItems, activeRow]);

  const D = c.motion.duration ?? 700;
  const rad = Math.min(p.theme.radiusMark, bh / 2);
  const longest = useMemo(() => (shown.length ? shown[argMax(shown.map((k) => items[k].end - items[k].start))] : -1), [shown, items]);
  const linesText = lines.length ? ` ${msg.lines}: ${lines.map((l) => `${l.label ? `${l.label} ` : ""}${tText(l.t)}`).join(", ")}.` : "";
  // The status strip is read out too: up to the first 8 cells in time order (a point reads as its time)
  let stripText = "";
  if (strip) {
    const parts = [
      ...strip.spans.map((s) => ({ t: s.t0, text: `${s.status} ${msg.range(tText(s.t0), tText(s.t1))}` })),
      ...strip.points.map((k) => ({ t: items[k].start, text: `${items[k].status} ${tText(items[k].start)}` })),
    ].sort((a, b) => a.t - b.t);
    if (parts.length) stripText = ` ${msg.strip(parts.slice(0, 8).map((q) => q.text).join(", "), Math.max(0, parts.length - 8))}`;
  }
  const desc = props.description ?? (shown.length ? `${msg.kind}. ${msg.desc(shown.length, rows.length, tText(v0 > lo ? v0 : lo), tText(v1 < hi ? v1 : hi))}. ${longest >= 0 && !items[longest].point ? `${msg.longest(items[longest].label, durs.text[longest])}.` : ""}${linesText}${stripText}`.trim() : "");

  return (
    <ChartFrame
      c={c}
      kind={msg.kind}
      ariaLabel={props.ariaLabel}
      description={desc}
      events={events}
      tip={tip}
      renderTip={props.tooltip}
      announce={announce || undefined}
      className={props.className}
      style={props.style}
      theme={props.theme}
      onPointerDown={brushFrame.onPointerDown}
      onPointerUp={brushFrame.onPointerUp}
      overlay={brushFrame.overlay}
      onPointerMove={(px, py, e) => {
        if (brush.move(px)) return;
        const k = pick(px, py);
        if (k !== c.active) c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer");
      }}
      onKey={onKey}
    >
      <g aria-hidden="true">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={t.x} x2={t.x} y1={top} y2={plotBottom} stroke={p.paint("line")} />
            <Txt x={t.x} y={plotBottom + 12} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
              {t.label}
            </Txt>
          </g>
        ))}
        {rowNodes}
      </g>
      {m.items.map((mi) => {
        if (mi.exiting) return null;
        const k = mi.data;
        const e = eventOf.get(k);
        if (e === undefined) return null;
        const it = items[k];
        const [xa, xb, o, y] = mi.v;
        const sw = swOf(k);
        const isHi = hiItems.has(k);
        const ringed = (c.active === e && c.via === "keyboard") || (barColors !== null && isHi && !namedGroups.has(groupOf.get(keyOf(it)) ?? -1));
        const op = c.dim(e) * Math.min(1, o * 1.5);
        const fade = m.fade(Math.min(e * stg, MAX_DELAY) + D * 0.4, 260);
        const status = statusFit.get(k);
        if (it.point) {
          const s = Math.max(3, Math.min(bh, 12) / 2 + 1);
          return (
            <g key={mi.key} opacity={op}>
              <path d={`M${xa} ${y - s}L${xa + s} ${y}L${xa} ${y + s}L${xa - s} ${y}Z`} fill={sw.fill} stroke={p.paint(ringed ? "ink" : "panel")} strokeWidth={ringed ? 2 : 1} className="ztd-mark" onClick={() => c.click(e)} />
              {status && xa + s + 6 + status.w < nextX[k] - 4 ? (
                <Txt x={xa + s + 6} y={y} size={BAR_FONT} weight={600} fill={p.paint("muted")} opacity={fade}>
                  {status.text}
                </Txt>
              ) : null}
            </g>
          );
        }
        const w = Math.max(1, xb - xa);
        const dur = textOn ? durs.text[k] : "";
        const dw = isHi ? durs.wHi[k] : durs.w[k];
        const durOut = dur && xa + w + 6 + dw < nextX[k] - 4;
        // For items with a status, the inside of the bar is reserved for the status. Even when the status does not fit, it is not replaced with the duration (so statuses and durations do not mix in the status strip). With the bottom-row status strip, the inside of the bar shows the duration
        const durIn = dur && !durOut && (stripOn || !it.status) && dw + 12 <= w;
        return (
          <g key={mi.key} opacity={op}>
            <rect
              x={xa}
              y={y - bh / 2}
              width={w}
              height={bh}
              rx={rad}
              fill={sw.fill}
              fillOpacity={it.open ? OPEN_TINT : 1}
              stroke={ringed ? p.paint("ink") : it.open ? sw.fill : "none"}
              strokeWidth={ringed ? 2 : 1}
              strokeDasharray={it.open ? "3 2" : undefined}
              className="ztd-mark"
              onClick={() => c.click(e)}
            />
            {status?.text ? (
              <Txt x={xa + 6} y={y} size={BAR_FONT} weight={600} fill={it.open ? p.paint("ink") : sw.text} opacity={fade}>
                {status.text}
              </Txt>
            ) : null}
            {durOut || durIn ? (
              <Txt x={durOut ? xa + w + 6 : xa + w - 6} y={y} anchor={durOut ? "start" : "end"} size={BAR_FONT} weight={isHi ? 800 : 600} fill={durIn ? (it.open ? p.paint("ink") : sw.text) : p.paint(isHi ? "ink" : "muted")} opacity={fade}>
                {dur}
              </Txt>
            ) : null}
          </g>
        );
      })}
      {strip ? (
        // Bottom-row status strip: appears once the bars have nearly finished growing. Pointing at it is resolved by pick to the item at that time
        <g className="ztd-strip" aria-hidden="true" opacity={m.fade(Math.min(shown.length * stg, MAX_DELAY) + D * 0.4, 260)}>
          <Txt x={labelW} y={stripY} anchor="end" size={ROW_FONT} weight={600} fill={p.paint("muted")}>
            {msg.status}
          </Txt>
          {strip.spans.map((s, i) => {
            if (s.t1 < v0 || s.t0 > v1) return null;
            const xa = Math.max(x0, xs(s.t0));
            const w = Math.max(MIN_BAR_W, Math.min(x1, xs(s.t1)) - xa - 2);
            const sw = stripColors[stripOf.get(s.status) ?? 0];
            const text = c.showLabels ? truncate(s.status, w - 12, BAR_FONT, 600) : "";
            return (
              <g key={i}>
                <rect x={xa} y={stripY - STRIP_BAR / 2} width={w} height={STRIP_BAR} rx={Math.min(p.theme.radiusMark, STRIP_BAR / 2)} fill={sw.fill} fillOpacity={s.open ? OPEN_TINT : 1} stroke={s.open ? sw.fill : "none"} strokeDasharray={s.open ? "3 2" : undefined} />
                {text ? (
                  <Txt x={xa + w / 2} y={stripY} anchor="middle" size={BAR_FONT} weight={600} fill={s.open ? p.paint("ink") : sw.text}>
                    {text}
                  </Txt>
                ) : null}
              </g>
            );
          })}
          {strip.points.map((k) => {
            const t = items[k].start;
            if (t < v0 || t > v1) return null;
            const x = xs(t);
            const s = 7;
            return <path key={`p${k}`} d={`M${x} ${stripY - s}L${x + s} ${stripY}L${x} ${stripY + s}L${x - s} ${stripY}Z`} fill={stripColors[stripOf.get(items[k].status) ?? 0].fill} stroke={p.paint("panel")} />;
          })}
        </g>
      ) : null}
      <g aria-hidden="true" pointerEvents="none">
        {lineNodes}
      </g>
      {brushLayer}
    </ChartFrame>
  );
}
