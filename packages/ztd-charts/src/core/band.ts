import { numGetter } from "../data/accessor";
import { areaPath, r2, type Curve } from "./geometry";
import type { Accessor } from "./types";

/**
 * Shape of one series' range band (pixels). The top and bottom y are interpolated by the motion engine along with the line; x stays as in the data.
 * The band breaks at any x with a missing bound and splits into pieces
 */
export interface BandShape {
  /** Start position of each piece, with the total length at the end. [0, 5, 9] means two pieces, 0 to 4 and 5 to 8 */
  runs: number[];
  /** x of each point. For steps, the left edge of the pixel column */
  xl: number[];
  /** For steps (point reduction), the right edge of the pixel column. Empty for the point shape */
  xr: number[];
  /** y of the top bound (upper) */
  top: number[];
  /** y of the bottom bound (lower) */
  bottom: number[];
}

/** Range band bound field. Same form as y: for a wide table, an array in the same order as the y columns; for a long table, a single field */
export type BoundField<T> = Accessor<T, unknown> | readonly string[];

const isFieldList = <T>(f: BoundField<T>): f is readonly string[] => Array.isArray(f);

/**
 * Bound field of the s-th series (used for both values and names).
 * A wide table pairs the s-th bound field with the s-th y column (a single field or a function covers only the first series); a long table uses one field for every row (the first field when given an array). null when that series has no field
 */
export function boundField<T>(f: BoundField<T>, s: number, wide: boolean): Accessor<T, unknown> | null {
  const list = isFieldList(f) ? f : [f];
  return !wide ? list[0] : s < list.length ? list[s] : null;
}

/**
 * [lower, upper] values to draw as a band for each series (the same [series][x] form as rows). Read from the rows prepSeries kept for each cell, so x is not read again.
 * When a cell has several rows, y is summed but the band uses the last row's bounds.
 * A lower above the upper is drawn swapped; an x before from, or with either bound missing, is NaN (the band breaks)
 */
export function bandBounds<T>(rows: readonly (readonly (T | null)[])[], lower: BoundField<T>, upper: BoundField<T>, wide: boolean, data: readonly T[], from: number): { lo: number[]; hi: number[] }[] {
  // Only bounds given as functions need the original row index
  const index = typeof lower === "function" || typeof upper === "function" ? new Map(data.map((d, i) => [d, i])) : null;
  return rows.map((row, s) => {
    const lo = new Array<number>(row.length).fill(NaN);
    const hi = new Array<number>(row.length).fill(NaN);
    const fl = boundField(lower, s, wide);
    const fh = boundField(upper, s, wide);
    if (fl === null || fh === null) return { lo, hi };
    const readLo = numGetter(fl, "");
    const readHi = numGetter(fh, "");
    for (let k = Math.max(0, from); k < row.length; k++) {
      const d = row[k];
      if (d === null) continue;
      const i = index?.get(d) ?? -1;
      const a = readLo(d, i);
      const b = readHi(d, i);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      lo[k] = Math.min(a, b);
      hi[k] = Math.max(a, b);
    }
    return { lo, hi };
  });
}

/** Whether a value lies outside the band (an x without a band does not count) */
export const isOutside = (v: number, lo: number, hi: number): boolean => Number.isFinite(v) && Number.isFinite(lo) && (v < lo || v > hi);

/** Runs [start, end] of consecutive x values that have both bounds (inclusive). Single-point runs have no area, so they are left out */
export function bandRuns(lo: readonly number[], hi: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  let a = -1;
  for (let k = 0; k <= lo.length; k++) {
    const ok = k < lo.length && Number.isFinite(lo[k]) && Number.isFinite(hi[k]);
    if (ok && a < 0) a = k;
    else if (!ok && a >= 0) {
      if (k - 1 > a) out.push([a, k - 1]);
      a = -1;
    }
  }
  return out;
}

/**
 * Turns one piece into pixel-column steps. For every column that a segment between two neighboring points passes through, it collects the two points' lowest lower and highest upper.
 * So each column is filled across its full width from at most the lowest lower to at least the highest upper of its points, and columns without points stay connected
 */
function stepColumns(out: BandShape, xs: (k: number) => number, lo: readonly number[], hi: readonly number[], y: (v: number) => number, a: number, b: number): void {
  const xa = xs(a);
  const xb = xs(b);
  // When the chart is narrower than its margins, x flips. There are no columns to draw
  if (!(xb >= xa)) return;
  const c0 = Math.floor(xa);
  const n = Math.floor(xb) - c0 + 1;
  const L = new Array<number>(n).fill(Infinity);
  const H = new Array<number>(n).fill(-Infinity);
  let from = 0;
  for (let k = a; k < b; k++) {
    const l = Math.min(lo[k], lo[k + 1]);
    const h = Math.max(hi[k], hi[k + 1]);
    const to = Math.floor(xs(k + 1)) - c0;
    for (let c = from; c <= to; c++) {
      if (l < L[c]) L[c] = l;
      if (h > H[c]) H[c] = h;
    }
    from = to;
  }
  for (let c = 0; c < n; c++) {
    const left = Math.max(xa, c0 + c);
    const right = Math.min(xb, c0 + c + 1);
    // When the last point falls exactly on a column boundary, a zero-width column appears
    if (right <= left && c > 0) continue;
    out.xl.push(left);
    out.xr.push(right);
    out.top.push(y(H[c]));
    out.bottom.push(y(L[c]));
  }
}

/**
 * Band shape. lo and hi are the values in x order (bandBounds), and xs gives their pixel x.
 * With more band points than budget, it reduces them to pixel-column steps (stepColumns) instead of range averages. null when nothing is drawn
 */
export function bandShape(xs: (k: number) => number, lo: readonly number[], hi: readonly number[], y: (v: number) => number, budget: number): BandShape | null {
  const runs = bandRuns(lo, hi);
  if (!runs.length) return null;
  const count = runs.reduce((s, [a, b]) => s + b - a + 1, 0);
  const shape: BandShape = { runs: [], xl: [], xr: [], top: [], bottom: [] };
  const step = count > budget;
  for (const [a, b] of runs) {
    shape.runs.push(shape.top.length);
    if (step) stepColumns(shape, xs, lo, hi, y, a, b);
    else
      for (let k = a; k <= b; k++) {
        shape.xl.push(xs(k));
        shape.top.push(y(hi[k]));
        shape.bottom.push(y(lo[k]));
      }
  }
  shape.runs.push(shape.top.length);
  return shape;
}

/** One step piece: along the top bound from left to right, then back along the bottom bound. Neighboring columns with equal values are drawn in one stroke */
function stepPath(xl: readonly number[], xr: readonly number[], top: readonly number[], bottom: readonly number[], a: number, b: number): string {
  let cur = r2(top[a]);
  let d = `M${r2(xl[a])},${cur}`;
  for (let i = a + 1; i < b; i++) {
    const t = r2(top[i]);
    if (t !== cur) d += `H${r2(xl[i])}V${(cur = t)}`;
  }
  cur = r2(bottom[b - 1]);
  d += `H${r2(xr[b - 1])}V${cur}`;
  for (let i = b - 2; i >= a; i--) {
    const v = r2(bottom[i]);
    if (v !== cur) d += `H${r2(xr[i])}V${(cur = v)}`;
  }
  return `${d}H${r2(xl[a])}Z`;
}

const points = (xs: readonly number[], ys: readonly number[], a: number, b: number): [number, number][] => xs.slice(a, b).map((x, i) => [x, ys[a + i]]);

/** One band path (a closed area per piece). top and bottom are the y values being drawn now (the motion engine's values) */
export function bandPath(s: BandShape, top: readonly number[], bottom: readonly number[], curve: Curve): string {
  let d = "";
  for (let r = 0; r + 1 < s.runs.length; r++) {
    const from = s.runs[r];
    const to = s.runs[r + 1];
    if (to - from < 1) continue;
    d += s.xr.length ? stepPath(s.xl, s.xr, top, bottom, from, to) : areaPath(points(s.xl, top, from, to), points(s.xl, bottom, from, to), curve);
  }
  return d;
}
