import { quantileSorted } from "../core/geometry";
import { getter, toNumber } from "./accessor";

/** Only values that read as numbers, smallest first */
const sortedNumbers = (values: readonly unknown[]) => new Float64Array(values.map(toNumber).filter(Number.isFinite)).sort();
const at = (sorted: Float64Array, p: number) => (p >= 0 && p <= 100 ? quantileSorted(sorted, p / 100) : NaN);

/**
 * The p-th percentile (0~100) of a list of values. Interpolates linearly between two values (same as Excel PERCENTILE.INC and the numpy default).
 * Values that do not read as numbers are dropped; NaN when no values remain or p is outside 0~100
 */
export function percentile(values: readonly unknown[], p: number): number {
  return at(sortedNumbers(values), p);
}

/** A percentile name ("p95") to a number (95). NaN unless "p" is followed by a number in 0~100. Shared by histogram marks and spec validation */
export function markPercentile(id: string): number {
  const m = /^p(\d+(?:\.\d+)?)$/.exec(id);
  const v = m ? Number(m[1]) : NaN;
  return v >= 0 && v <= 100 ? v : NaN;
}

export interface PercentilesOptions {
  /** Field to group by. An array to group by several fields (for example ["minute", "api"]). Dot paths work too, as in chart encoding */
  by: string | readonly string[];
  /** Numeric field to compute percentiles of */
  value: string;
  /** Percentiles to compute (0~100). Default [50, 95, 99]. Result field names are "p" plus the number, such as p50, p95, p99 */
  p?: readonly number[];
}

/**
 * Groups rows by by and computes the percentiles of value for each group. Use it to draw a p95 chart straight from measurements such as response times.
 * The result is { ...by fields, p50, p95, p99 } rows in order of each group's first appearance, so pass y={["p50", "p95", "p99"]}
 */
export function percentiles(rows: readonly Record<string, unknown>[], options: PercentilesOptions): Record<string, unknown>[] {
  const keys: readonly string[] = typeof options.by === "string" ? [options.by] : options.by;
  const reads = keys.map((k) => getter(k, k));
  const read = getter(options.value, options.value);
  const ps = options.p ?? [50, 95, 99];
  const groups = new Map<string, { row: Record<string, unknown>; values: unknown[] }>();
  rows.forEach((r, i) => {
    const ids = reads.map((g) => g(r, i));
    const id = JSON.stringify(ids);
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { row: Object.fromEntries(keys.map((k, j) => [k, ids[j]])), values: [] }));
    g.values.push(read(r, i));
  });
  return [...groups.values()].map(({ row, values }) => {
    const sorted = sortedNumbers(values);
    for (const p of ps) row[`p${p}`] = at(sorted, p);
    return row;
  });
}
