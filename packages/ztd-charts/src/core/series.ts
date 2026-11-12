import { DEFAULT_LOCALE, dateParts, dayFirstOf, isDateText, isYear, toDate } from "./format";
import { langOf } from "./i18n";
import { lazyArray } from "./lazy";
import { getter, toNumber, uniq } from "../data/accessor";
import type { Accessor } from "./types";

export type XType = "number" | "date" | "band";

/** Turns a date or numeric x value into a number (ms for dates, NaN when unreadable). Data and annotations are read by the same rule */
export const xNum = (type: XType, v: unknown, dayFirst?: boolean): number => (type === "date" ? toDate(v, dayFirst)?.getTime() ?? NaN : toNumber(v));

export interface SeriesModel<T> {
  type: XType;
  /** Unique keys sorted in x order */
  keys: string[];
  /** Numeric position of each key (the index for band, ms for date) */
  xnum: number[];
  /** Display labels */
  labels: string[];
  series: string[];
  /** values[s][k], NaN for a missing value */
  values: number[][];
  rows: (T | null)[][];
  /** Only after reduction by bucketSeries: the actual values of the representative rows (the same rows as keys, labels and rows), not the range averages (values). Read by tooltips and events */
  rowValues?: number[][];
}

/** The model without the hidden series (hidden, names joined with \u0001) and the positions of the remaining series. With nothing hidden, the model is returned as is. All x keys are kept, so dates do not shift */
export function visibleSeries<M extends SeriesModel<unknown>>(m: M, hiddenKey: string): [M, number[]] {
  const off = new Set(hiddenKey ? hiddenKey.split("\u0001") : []);
  const keep = m.series.flatMap((s, i) => (off.has(s) ? [] : [i]));
  if (keep.length === m.series.length) return [m, keep];
  const at = <A>(a: A[]) => keep.map((i) => a[i]);
  return [{ ...m, series: at(m.series), values: at(m.values), rows: at(m.rows), ...(m.rowValues && { rowValues: at(m.rowValues) }) }, keep];
}

/** Key for linked views (syncId). Text categories that look like dates ("2025-01", "2025.01.05") are normalized to the same form as a date x (timestamp text) */
export function syncKeyOf(raw: string): string {
  if (!isDateText(raw.trim())) return raw;
  const t = toDate(raw)?.getTime();
  return t === undefined || !Number.isFinite(t) ? raw : String(t);
}

export function detectXType(raw: readonly unknown[]): XType {
  const vals = raw.filter((v) => v !== null && v !== undefined && v !== "");
  if (!vals.length) return "band";
  if (vals.every((v) => v instanceof Date)) return "date";
  if (vals.every((v) => typeof v === "string" && isDateText(v.trim()))) return "date";
  if (vals.every((v) => typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())))) {
    return "number";
  }
  return "band";
}

/** How to combine several rows with the same x and series. "sum" (add) | "mean" (average) | "last" (last row) | "count" (row count) */
export type Aggregate = "sum" | "mean" | "last" | "count";

export interface PrepOptions {
  xType?: XType;
  locale?: string;
  dateFormat?: Intl.DateTimeFormatOptions;
  /** How to combine several rows with the same x and series. Default "sum" */
  aggregate?: Aggregate;
  /** Reads a date like "05/03/2024", where either part could be the day or the month, as day first. When unset, the unambiguous dates in the column decide; without those, month first */
  dayFirst?: boolean;
}

/**
 * Turns a long table (x, y, series) or a wide table (x plus several value columns) into a series matrix.
 * Given an array for y, those columns become the series.
 */
export function prepSeries<T>(data: readonly T[], x: Accessor<T, unknown> | undefined, y: Accessor<T, unknown> | readonly string[] | undefined, series: Accessor<T, unknown> | undefined, opts: PrepOptions = {}): SeriesModel<T> {
  const getX = getter(x, "x");
  const wide = Array.isArray(y);
  const yKeys = wide ? (y as readonly string[]) : null;
  const getY = wide ? null : getter(y as Accessor<T, unknown> | undefined, "y");
  const getS = !wide && series !== undefined ? getter(series, "series") : null;
  const rawX = data.map((d, i) => getX(d, i));
  const type = opts.xType ?? detectXType(rawX);
  const locale = opts.locale ?? DEFAULT_LOCALE;
  // x is read only once (parsing dates twice is noticeably slow at 10,000 rows). Only the check below, which picks month or quarter labels, looks again, when the first value is a month or quarter and there are under 5,000 rows
  let keys: string[];
  let xnum: number[];
  let rowKey: Int32Array;
  if (type === "band") {
    const strs = rawX.map((v) => String(v ?? ""));
    keys = uniq(strs);
    const kIndex = new Map(keys.map((k, i) => [k, i]));
    xnum = keys.map((_, i) => i);
    rowKey = Int32Array.from(strs, (k) => kIndex.get(k) ?? -1);
  } else {
    const dayFirst = type === "date" ? opts.dayFirst ?? dayFirstOf(rawX) : undefined;
    const nums = rawX.map((v) => xNum(type, v, dayFirst));
    const uniqNums = Array.from(new Set(nums.filter((n) => Number.isFinite(n)))).sort((a, b) => a - b);
    const kIndex = new Map(uniqNums.map((n, i) => [n, i]));
    xnum = uniqNums;
    keys = uniqNums.map(String);
    rowKey = Int32Array.from(nums, (n) => kIndex.get(n) ?? -1);
  }
  let dfmt = opts.dateFormat;
  // Whether the column holds only months ("2024-03", "2024년 3월", "Mar 2024") or quarters ("2024Q1") (this decides the label format)
  const kindOf = (v: unknown) => (typeof v === "string" ? dateParts(v.trim())?.[3] : undefined);
  const k0 = type === "date" && rawX.length < 5000 ? kindOf(rawX[0]) : undefined;
  const same = (k0 === 2 || k0 === 3) && rawX.every((v) => kindOf(v) === k0);
  const quarterly = same && k0 === 3;
  if (type === "date" && !dfmt) {
    const span = xnum.length > 1 ? xnum[xnum.length - 1] - xnum[0] : 0;
    const monthly = same && k0 === 2;
    dfmt = monthly || span > 86400000 * 120 ? { month: "short" } : span < 86400000 * 2 ? { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" } : { month: "numeric", day: "numeric" };
    if (span > 86400000 * 800) dfmt = { year: "numeric", month: "short" };
  }
  let labels: string[];
  if (type === "band") labels = keys;
  else if (quarterly && !opts.dateFormat) {
    const ko = langOf(locale) === "ko";
    labels = xnum.map((n) => {
      const d = new Date(n);
      const q = Math.floor(d.getMonth() / 3) + 1;
      return ko ? `${d.getFullYear()}년 ${q}분기` : `Q${q} ${d.getFullYear()}`;
    });
  } else {
    // A numeric x gets up to 6 decimals (so 0.001 and 0.002 do not both become "0"); all 4-digit integers mean years, written without separators ("2019", not "2,019")
    const year = xnum.every(isYear);
    const fmt = type === "date" ? new Intl.DateTimeFormat(locale, dfmt) : new Intl.NumberFormat(locale, year ? { useGrouping: false } : { maximumFractionDigits: 6 });
    labels = xnum.length > 1000 ? lazyArray(xnum.length, (i) => fmt.format(xnum[i])) : xnum.map((n) => fmt.format(n));
  }
  const seriesNames = yKeys ? [...yKeys] : getS ? uniq(data.map((d, i) => String(getS(d, i) ?? ""))) : [""];
  const sIndex = new Map(seriesNames.map((s, i) => [s, i]));
  const values = seriesNames.map(() => new Array<number>(keys.length).fill(NaN));
  const rows = seriesNames.map(() => new Array<T | null>(keys.length).fill(null));
  const agg: Aggregate = opts.aggregate ?? "sum";
  // The mean counts only numeric values (missing values do not drag the mean down)
  const counts = agg === "mean" ? seriesNames.map(() => new Uint32Array(keys.length)) : null;
  const add = (s: number, k: number, v: number, d: T) => {
    const prev = values[s][k];
    if (agg === "last") values[s][k] = v;
    else if (agg === "count") values[s][k] = (Number.isFinite(prev) ? prev : 0) + 1;
    else if (agg === "mean") {
      if (Number.isFinite(v)) {
        values[s][k] = (Number.isFinite(prev) ? prev : 0) + v;
        counts![s][k]++;
      }
    } else values[s][k] = Number.isFinite(prev) ? prev + (Number.isFinite(v) ? v : 0) : v;
    rows[s][k] = d;
  };
  for (let i = 0; i < data.length; i++) {
    const k = rowKey[i];
    if (k < 0) continue;
    const d = data[i];
    if (yKeys) {
      for (let s = 0; s < yKeys.length; s++) add(s, k, toNumber((d as Record<string, unknown>)[yKeys[s]]), d);
    } else {
      const s = getS ? sIndex.get(String(getS(d, i) ?? "")) ?? 0 : 0;
      add(s, k, toNumber(getY!(d, i)), d);
    }
  }
  if (counts) for (let s = 0; s < values.length; s++) for (let k = 0; k < keys.length; k++) if (counts[s][k] > 1) values[s][k] /= counts[s][k];
  return { type, keys, xnum, labels, series: seriesNames, values, rows };
}

/**
 * Reduces x to range averages. All series share the same x, so the layers of stacked charts (area, stream) stay aligned.
 * The representative key and label are the ones in the middle of each range. That row's actual values are kept in rowValues (the averages are for drawing).
 */
export function bucketSeries<T>(m: SeriesModel<T>, maxPoints: number): SeriesModel<T> {
  const n = m.keys.length;
  if (n <= maxPoints || maxPoints < 2) return m;
  const size = n / maxPoints;
  const pick: number[] = [];
  const ranges: [number, number][] = [];
  for (let b = 0; b < maxPoints; b++) {
    const a = Math.floor(b * size);
    const e = Math.min(n, Math.floor((b + 1) * size));
    if (e <= a) continue;
    ranges.push([a, e]);
    pick.push(b === 0 ? 0 : b === maxPoints - 1 ? n - 1 : Math.floor((a + e - 1) / 2));
  }
  const values = m.values.map((row) =>
    ranges.map(([a, e]) => {
      let s = 0;
      let c = 0;
      for (let k = a; k < e; k++)
        if (Number.isFinite(row[k])) {
          s += row[k];
          c++;
        }
      return c ? s / c : NaN;
    }),
  );
  return {
    type: m.type,
    keys: pick.map((k) => m.keys[k]),
    xnum: m.type === "band" ? pick.map((_, i) => i) : pick.map((k) => m.xnum[k]),
    labels: lazyArray(pick.length, (i) => m.labels[pick[i]]),
    series: m.series,
    values,
    rows: m.rows.map((r) => pick.map((k) => r[k])),
    rowValues: m.values.map((r) => pick.map((k) => r[k])),
  };
}
