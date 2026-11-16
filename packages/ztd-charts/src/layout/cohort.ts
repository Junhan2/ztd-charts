import { dayFirstOf, toDate } from "../core/format";
import type { Accessor } from "../core/types";
import { getter, numGetter, strGetter, toNumber } from "../data/accessor";

/** How the value channel is read: people still active, percents (58) or ratios (0.58) */
export type CohortValueType = "count" | "percent" | "ratio";

/** Most cells a cohort chart draws. Above it, only the most recent cohorts that fit are kept (validateSpec warns cohort_trimmed) */
export const COHORT_MAX_CELLS = 2500;

export interface CohortCell<T> {
  /** Cohort (row) and period (column) */
  row: number;
  col: number;
  /** Share still active (1 is 100%) */
  rate: number;
  /** People still active. NaN when unknown (shares without a size) */
  count: number;
  datum: T;
}

export interface CohortModel<T> {
  cohorts: string[];
  periods: string[];
  /** Size of each cohort. NaN when unknown */
  sizes: number[];
  /** Cells with a share, row by row */
  cells: CohortCell<T>[];
  type: CohortValueType;
  /** valueType "auto" read the type from the size of the values (no size channel). validateSpec says what it read */
  guessed: boolean;
  /** People counts are known: count values, or shares with a size channel */
  counted: boolean;
  /** Cells before trimming, and the older cohorts left out to stay within COHORT_MAX_CELLS */
  total: number;
  trimmed: number;
  /** First row of each cohort (for highlight predicates) */
  firsts: T[];
}

export interface CohortFields<T> {
  cohort?: Accessor<T, unknown>;
  period?: Accessor<T, unknown>;
  value?: Accessor<T, unknown>;
  size?: Accessor<T, unknown>;
}

/** Text of a cohort or period key. A number that is not finite (NaN, Infinity) is a missing key, like an empty cell */
function keyGetter<T>(a: Accessor<T, unknown> | undefined, def: string): (d: T, i: number) => string {
  const raw = getter(a, def);
  // strGetter runs on the value already read, so a function accessor is called once per row
  const text = strGetter<unknown>((v) => v, def);
  return (d, i) => {
    const v = raw(d, i);
    return typeof v === "number" && !Number.isFinite(v) ? "" : text(v, i).trim();
  };
}

/** Keys in ascending order of their numbers when every key reads as one, otherwise as they are (first appearance) */
function ordered(keys: string[], read: (k: string) => number): string[] {
  const nums = new Map(keys.map((k) => [k, read(k)]));
  return keys.every((k) => Number.isFinite(nums.get(k))) ? keys.sort((a, b) => nums.get(a)! - nums.get(b)!) : keys;
}

/**
 * Reads a long table (one row per cohort and period) into cells of shares. Cohorts are ascending when all read as dates and periods when all are numbers,
 * otherwise both keep the order they first appear in. Rows with the same cohort and period add up (as the heatmap does).
 * valueType "auto": counts with a size channel, ratios when every value is at most 1, percents when at most 100, otherwise counts with each cohort's first period as its size
 */
export function readCohort<T>(data: readonly T[], f: CohortFields<T>, valueType?: unknown): CohortModel<T> {
  const gc = keyGetter(f.cohort, "cohort");
  const gp = keyGetter(f.period, "period");
  const gv = numGetter(f.value, "value");
  const gs = f.size === undefined ? null : numGetter(f.size, "size");
  const info = new Map<string, { size: number; first: T; cells: Map<string, { v: number; d: T }> }>();
  const seen = new Set<string>();
  data.forEach((d, i) => {
    const c = gc(d, i);
    const p = gp(d, i);
    if (!c || !p) return;
    let co = info.get(c);
    if (!co) info.set(c, (co = { size: NaN, first: d, cells: new Map() }));
    // The first size of each cohort counts
    if (gs && Number.isNaN(co.size)) co.size = gs(d, i);
    seen.add(p);
    const v = gv(d, i);
    const cell = co.cells.get(p);
    // Only numbers add up, so a duplicate row without a value does not erase the value before it
    if (!cell) co.cells.set(p, { v, d });
    else if (Number.isFinite(v)) co.cells.set(p, { v: (Number.isFinite(cell.v) ? cell.v : 0) + v, d });
  });
  // Day-first dates (13/01/2024) are read day-first throughout, as the other charts read a date column
  const keys = [...info.keys()];
  const dayFirst = dayFirstOf(keys);
  let cohorts = ordered(keys, (k) => toDate(k, dayFirst)?.getTime() ?? NaN);
  // The values of each cohort, in cohort order
  const lists = cohorts.map((c) => [...info.get(c)!.cells.values()].map((x) => x.v).filter(Number.isFinite));
  const values = lists.flat();
  const auto = valueType !== "count" && valueType !== "percent" && valueType !== "ratio";
  const type: CohortValueType = !auto ? (valueType as CohortValueType) : gs ? "count" : values.every((v) => v <= 1) ? "ratio" : values.every((v) => v <= 100) ? "percent" : "count";

  // Over the cap, keep the most recent cohorts that fit (at least one). trimmed counts the older cohorts left out
  let room = COHORT_MAX_CELLS;
  let trimmed = cohorts.length;
  while (trimmed > 0 && (trimmed === cohorts.length || lists[trimmed - 1].length <= room)) room -= lists[--trimmed].length;
  cohorts = cohorts.slice(trimmed);
  // Periods that the kept cohorts reach
  const reached = new Set(cohorts.flatMap((c) => [...info.get(c)!.cells.keys()]));
  const periods = ordered([...seen], toNumber).filter((p) => reached.has(p));
  const counted = type === "count" || !!gs;
  const cells: CohortCell<T>[] = [];
  const sizes = cohorts.map((c, row) => {
    const co = info.get(c)!;
    // A count cohort without a size takes the value of its first period
    const size = type === "count" && !(co.size > 0) ? (periods.map((p) => co.cells.get(p)?.v ?? NaN).find(Number.isFinite) ?? NaN) : co.size;
    periods.forEach((p, col) => {
      const x = co.cells.get(p);
      if (!x) return;
      const rate = type === "count" ? x.v / size : type === "percent" ? x.v / 100 : x.v;
      if (Number.isFinite(rate)) cells.push({ row, col, rate, count: type === "count" ? x.v : Math.round(rate * size), datum: x.d });
    });
    return size;
  });
  return { cohorts, periods, sizes, cells, type, guessed: auto && !gs && values.length > 0, counted, total: values.length, trimmed, firsts: cohorts.map((c) => info.get(c)!.first) };
}

/** Average of each period. With people counts: the people still active over the cohort sizes, counting only the cohorts that reached the period; otherwise the plain mean of the shares */
export function cohortAverages<T>(m: Pick<CohortModel<T>, "cells" | "periods" | "sizes">): { rate: number; count: number; size: number }[] {
  // One pass over the cells, adding each to its period
  const acc = m.periods.map(() => ({ kept: 0, size: 0, sum: 0, n: 0 }));
  for (const c of m.cells) {
    const a = acc[c.col];
    a.sum += c.rate;
    a.n++;
    // Counts are NaN without people counts (shares without a size), so this sums only known people
    if (Number.isFinite(c.count) && m.sizes[c.row] > 0) {
      a.kept += c.count;
      a.size += m.sizes[c.row];
    }
  }
  return acc.map(({ kept, size, sum, n }) => (size > 0 ? { rate: kept / size, count: kept, size } : { rate: n ? sum / n : NaN, count: NaN, size: NaN }));
}

/** The base column: the first period column with values, when every cohort in it is at 99.5% or more. -1 when there is none. It is painted light gray and left out of the color scale */
export function baseColumn(cells: readonly { col: number; rate: number }[]): number {
  const first = cells.reduce((m, c) => Math.min(m, c.col), Infinity);
  return Number.isFinite(first) && cells.every((c) => c.col !== first || c.rate >= 0.995) ? first : -1;
}
