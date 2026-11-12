import { dayFirstOf, isDateText, toDate } from "../core/format";
import { fitDomain } from "../core/scale";
import { getter, strGetter, toNumber, uniq } from "../data/accessor";
import type { Accessor } from "../core/types";

/** Kind of time axis: "number" for numbers such as minutes or seconds, "date" for dates and times (ms) */
export type TimeKind = "number" | "date";

export interface TimelineItem<T = unknown> {
  /** Row index in the data */
  i: number;
  label: string;
  /** Start and end (ms for date). Swapped when the end comes before the start */
  start: number;
  end: number;
  /** An item still ongoing because its end is empty. end is now or the latest time in the data */
  open: boolean;
  /** An event whose start and end are equal (drawn as a point) */
  point: boolean;
  group: string;
  status: string;
  datum: T;
}

/** Counts of what was fixed or dropped while reading. The validator warns with the same counts */
export interface TimelineIssues {
  /** Items swapped because the end came before the start */
  swapped: number;
  /** Items left open because the end is empty */
  open: number;
  /** Items dropped because the start is missing or unreadable */
  noStart: number;
  /** Items dropped because the end is present but unreadable (an empty cell makes an open item) */
  badEnd: number;
  /** Items with a cell dropped for being of a different kind than the axis (a number on a date axis, a date on a number axis) */
  mixed: number;
  /** Items whose name, start, end and group are all the same (both are drawn) */
  duplicate: number;
}

export interface TimelineModel<T = unknown> {
  kind: TimeKind;
  items: TimelineItem<T>[];
  issues: TimelineIssues;
  /** On a date axis, every time is midnight (a date-only schedule). Durations are counted in days */
  dateOnly: boolean;
  /** On a date axis, some time has nonzero seconds (time text then includes seconds) */
  hasSeconds: boolean;
  /** Reads one axis value by the same rule as the data (reference lines, now). NaN when unreadable */
  read: (v: unknown) => number;
}

export interface TimelineFields<T> {
  label?: Accessor<T, string>;
  start?: Accessor<T, unknown>;
  end?: Accessor<T, unknown>;
  group?: Accessor<T, string>;
  status?: Accessor<T, string>;
}

const blank = (v: unknown) => v === undefined || v === null || v === "";

/** Kind of a value: date ("d"), number ("n"), empty (""), unreadable ("x"). Date text is judged by the same rule as an x axis (isDateText) */
function classOf(v: unknown): "d" | "n" | "" | "x" {
  if (blank(v)) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "x" : "d";
  if (typeof v === "number") return Number.isFinite(v) ? "n" : "x";
  if (typeof v === "string") {
    const s = v.trim();
    if (isDateText(s)) return "d";
    return Number.isFinite(toNumber(s)) ? "n" : s ? "x" : "";
  }
  return "x";
}

/**
 * Turns rows into timeline items. xType sets the axis kind; without it, the axis is a date axis when dates are the majority in the start and end cells.
 * Cells of another kind, such as a number on a date axis, are not read (with xType "date", numbers are read as timestamps or years too).
 * Items with an empty end are open and extend to now (an axis value) or, without it, to the latest time in the data
 */
export function readTimeline<T>(data: readonly T[], f: TimelineFields<T>, o: { xType?: TimeKind; dayFirst?: boolean; now?: unknown } = {}): TimelineModel<T> {
  const gl = strGetter(f.label, "label");
  const gs = getter(f.start, "start");
  const ge = getter(f.end, "end");
  const gg = f.group === undefined ? null : strGetter(f.group, "group");
  const gt = f.status === undefined ? null : strGetter(f.status, "status");
  const rawS = data.map((d, i) => gs(d, i));
  const rawE = data.map((d, i) => ge(d, i));
  const raw = rawS.concat(rawE);
  let kind = o.xType;
  let dates = 0;
  let nums = 0;
  if (!kind) {
    for (const v of raw) {
      const k = classOf(v);
      if (k === "d") dates++;
      else if (k === "n") nums++;
    }
    kind = dates > nums ? "date" : "number";
  }
  const auto = !o.xType;
  const dayFirst = kind === "date" ? o.dayFirst ?? dayFirstOf(raw) : undefined;
  const want = kind === "date" ? "d" : "n";
  const read = (v: unknown): number => {
    if (auto && classOf(v) !== want) return NaN;
    return kind === "date" ? toDate(v, dayFirst)?.getTime() ?? NaN : toNumber(v);
  };
  const other = (v: unknown) => auto && classOf(v) === (want === "d" ? "n" : "d");
  const issues: TimelineIssues = { swapped: 0, open: 0, noStart: 0, badEnd: 0, mixed: 0, duplicate: 0 };
  const items: TimelineItem<T>[] = [];
  let hi = -Infinity;
  for (let i = 0; i < data.length; i++) {
    let s = read(rawS[i]);
    let e = read(rawE[i]);
    if (!Number.isFinite(s)) {
      if (other(rawS[i])) issues.mixed++;
      else issues.noStart++;
      continue;
    }
    const open = !Number.isFinite(e) && blank(rawE[i]);
    if (!Number.isFinite(e) && !open) {
      if (other(rawE[i])) issues.mixed++;
      else issues.badEnd++;
      continue;
    }
    if (open) issues.open++;
    else if (e < s) {
      [s, e] = [e, s];
      issues.swapped++;
    }
    hi = Math.max(hi, open ? s : e);
    const d = data[i];
    items.push({ i, label: gl(d, i), start: s, end: e, open, point: !open && e === s, group: gg ? gg(d, i) : "", status: gt ? gt(d, i) : "", datum: d });
  }
  // End of an open item: now when now is after the start, otherwise the latest time (an item that starts after that is a point)
  const now = o.now === undefined ? NaN : read(o.now);
  const seen = new Set<string>();
  for (const it of items) {
    if (it.open) {
      it.end = Number.isFinite(now) && now >= it.start ? now : Math.max(hi, it.start);
      it.point = it.end === it.start;
    }
    const key = `${it.label}\u0001${it.start}\u0001${it.end}\u0001${it.group}`;
    if (seen.has(key)) issues.duplicate++;
    else seen.add(key);
  }
  const date = kind === "date";
  const dateOnly = date && items.length > 0 && items.every((it) => isMidnight(it.start) && isMidnight(it.end));
  const hasSeconds = date && !dateOnly && items.some((it) => new Date(it.start).getSeconds() || new Date(it.end).getSeconds());
  return { kind, items, issues, dateOnly, hasSeconds, read };
}

/**
 * The values that split colors (missing values excluded). The chart and the card legend build them from the same rows by the same rule, so color positions match.
 * Groups (group) come in order of first appearance. States (rare) go rarest first (fewest rows first; on a tie, order of first appearance), so a state like a brief outage gets the strongest color
 */
export function timelineGroups<T>(data: readonly T[], field: Accessor<T, string>, rare = false): string[] {
  const g = strGetter(field, "group");
  const vals = data.map((d, i) => g(d, i)).filter(Boolean);
  const keys = uniq(vals);
  if (!rare) return keys;
  const count = new Map<string, number>();
  for (const v of vals) count.set(v, (count.get(v) ?? 0) + 1);
  return keys.map((k, i) => [k, i] as const).sort((a, b) => count.get(a[0])! - count.get(b[0])! || a[1] - b[1]).map(([k]) => k);
}

export const DAY = 86400000;

/**
 * Time axis range: numbers widen to fit the ticks, dates keep the data's ends as they are. When all times are equal, half a day on each side (a day for date-only data).
 * Shared by the chart and the validator (reference lines out of range). [0, 1] when there are no items
 */
export function timelineDomain(m: Pick<TimelineModel, "kind" | "items" | "dateOnly">): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const it of m.items) {
    if (it.start < lo) lo = it.start;
    if (it.end > hi) hi = it.end;
  }
  if (lo === Infinity) return [0, 1];
  if (m.kind === "number") return fitDomain(lo, hi, 5, { zero: false });
  const pad = m.dateOnly ? DAY : DAY / 2;
  return lo === hi ? [lo - pad, hi + pad] : [lo, hi];
}

const isMidnight = (t: number) => {
  const d = new Date(t);
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
};

/** Row order: "none" in order of first appearance, "start" by earliest start, "duration" by longest total duration */
export type TimelineSort = "none" | "start" | "duration";

export interface TimelineRow {
  label: string;
  /** Items in the row (positions in items), in time order */
  items: number[];
  /** Number of lanes that overlapping items are split into (1 or more) */
  lanes: number;
  /** Total lanes of the rows before (the index of this row's first lane) */
  lane0: number;
}

/**
 * Gathers items with the same name into one row, splitting it into lanes where they overlap. Lanes fill from the first (the item that starts earlier goes on top).
 * Touching items (end = next start) continue in one lane (status bands, points at bar ends). Only two points at the same time split into separate lanes. lane[k] is the lane index of items[k] (within its row)
 */
export function timelineRows(items: readonly TimelineItem[], sort: TimelineSort = "none"): { rows: TimelineRow[]; lane: Int32Array } {
  const byLabel = new Map<string, number[]>();
  items.forEach((it, k) => {
    const list = byLabel.get(it.label);
    if (list) list.push(k);
    else byLabel.set(it.label, [k]);
  });
  const lane = new Int32Array(items.length);
  const rows: TimelineRow[] = [];
  for (const [label, list] of byLabel) {
    list.sort((a, b) => items[a].start - items[b].start || items[a].end - items[b].end || a - b);
    const ends: number[] = [];
    const points: boolean[] = [];
    for (const k of list) {
      const it = items[k];
      let l = 0;
      while (l < ends.length && !(ends[l] < it.start || (ends[l] === it.start && !(points[l] && it.point)))) l++;
      ends[l] = it.end;
      points[l] = it.point;
      lane[k] = l;
    }
    rows.push({ label, items: list, lanes: ends.length, lane0: 0 });
  }
  if (sort === "start") rows.sort((a, b) => items[a.items[0]].start - items[b.items[0]].start);
  else if (sort === "duration") {
    const total = (r: TimelineRow) => r.items.reduce((s, k) => s + items[k].end - items[k].start, 0);
    const t = new Map(rows.map((r) => [r, total(r)]));
    rows.sort((a, b) => t.get(b)! - t.get(a)!);
  }
  let acc = 0;
  for (const r of rows) {
    r.lane0 = acc;
    acc += r.lanes;
  }
  return { rows, lane };
}

/** One span of the status strip: a stretch [t0, t1) where the same state continues. open means it ends with an item that is still ongoing */
export interface StatusSpan {
  status: string;
  t0: number;
  t1: number;
  open: boolean;
}

/**
 * Status strip (options.statusStrip): at each moment, the state of the latest-starting item among those ongoing then (on a tie, the later item).
 * Touching spans of the same state merge into one, and the strip stays empty while no item is ongoing. Items with an empty state are left out, and points (start = end) are given separately as points.
 * pieces are the spans before merging, used to find the item (position in items) at the time pointed on the strip
 */
export function statusStrip(items: readonly TimelineItem[], keys: readonly number[]): { spans: StatusSpan[]; pieces: { t0: number; t1: number; k: number }[]; points: number[] } {
  const bars = keys.filter((k) => items[k].status && !items[k].point).sort((a, b) => items[a].start - items[b].start || a - b);
  const cuts = Array.from(new Set(bars.flatMap((k) => [items[k].start, items[k].end]))).sort((a, b) => a - b);
  const pieces: { t0: number; t1: number; k: number }[] = [];
  // Stacked in start order, so the top is the latest-starting item. Finished items are removed when they reach the top
  const stack: number[] = [];
  let next = 0;
  for (let c = 0; c + 1 < cuts.length; c++) {
    const t = cuts[c];
    while (next < bars.length && items[bars[next]].start <= t) stack.push(bars[next++]);
    while (stack.length && items[stack[stack.length - 1]].end <= t) stack.pop();
    if (stack.length) pieces.push({ t0: t, t1: cuts[c + 1], k: stack[stack.length - 1] });
  }
  const spans: StatusSpan[] = [];
  for (const pc of pieces) {
    const it = items[pc.k];
    const last = spans[spans.length - 1];
    if (last && last.status === it.status && last.t1 === pc.t0) {
      last.t1 = pc.t1;
      last.open = it.open && pc.t1 === it.end;
    } else spans.push({ status: it.status, t0: pc.t0, t1: pc.t1, open: it.open && pc.t1 === it.end });
  }
  return { spans, pieces, points: keys.filter((k) => items[k].status && items[k].point) };
}
