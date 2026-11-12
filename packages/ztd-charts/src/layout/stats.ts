import { quantileSorted } from "../core/geometry";
import { hasField } from "../data/accessor";

export interface BoxStats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** Whisker end. By default the farthest value within 1.5 times the interquartile range (Tukey); with whiskers, that percentile */
  lo: number;
  hi: number;
  mean: number;
  outliers: number[];
  n: number;
}

/** Quartiles, whiskers and outliers. whiskers gives the whisker-end percentiles [low, high] (0 to 100); without it, the Tukey method applies */
export function boxStats(values: readonly number[], whiskers?: readonly [number, number]): BoxStats {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return { min: NaN, q1: NaN, median: NaN, q3: NaN, max: NaN, lo: NaN, hi: NaN, mean: NaN, outliers: [], n: 0 };
  const q1 = quantileSorted(s, 0.25);
  const median = quantileSorted(s, 0.5);
  const q3 = quantileSorted(s, 0.75);
  const iqr = q3 - q1;
  const loF = whiskers ? quantileSorted(s, whiskers[0] / 100) : q1 - 1.5 * iqr;
  const hiF = whiskers ? quantileSorted(s, whiskers[1] / 100) : q3 + 1.5 * iqr;
  let lo = s[0];
  let hi = s[n - 1];
  for (const v of s)
    if (v >= loF) {
      lo = v;
      break;
    }
  for (let i = n - 1; i >= 0; i--)
    if (s[i] <= hiF) {
      hi = s[i];
      break;
    }
  let total = 0;
  for (const v of s) total += v;
  // Percentile whiskers reach that value; Tukey whiskers reach the farthest actual value inside the fences
  return { min: s[0], q1, median, q3, max: s[n - 1], lo: whiskers ? loF : lo, hi: whiskers ? hiF : hi, mean: total / n, outliers: s.filter((v) => v < loF || v > hiF), n };
}

/** Gaussian kernel density estimate (Silverman bandwidth) */
export function kde(values: readonly number[], xs: readonly number[], bandwidth?: number): number[] {
  const v = values.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (!n) return xs.map(() => 0);
  const mean = v.reduce((a, b) => a + b, 0) / n;
  // When all values are equal the standard deviation is 0. Instead of a fixed 1, 1/40 of the drawn range (xs) is used so other groups' curves do not flatten
  const range = xs.length > 1 ? Math.abs(xs[xs.length - 1] - xs[0]) : 0;
  const fallback = range > 0 ? range / 40 : Math.abs(mean) * 0.05 || 1;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || fallback;
  const s = [...v].sort((a, b) => a - b);
  const iqr = quantileSorted(s, 0.75) - quantileSorted(s, 0.25);
  const spread = Math.min(sd, iqr > 0 ? iqr / 1.34 : sd) || sd;
  const bw = bandwidth ?? Math.max(1e-9, 0.9 * spread * Math.pow(n, -0.2));
  const k = 1 / (Math.sqrt(2 * Math.PI) * bw * n);
  // With many values, approximate by binning
  if (n > 2000) {
    const bins = 512;
    const lo = s[0];
    const hi = s[n - 1];
    const step = (hi - lo) / bins || 1;
    const counts = new Array<number>(bins + 1).fill(0);
    for (const x of v) counts[Math.min(bins, Math.floor((x - lo) / step))]++;
    return xs.map((x) => {
      let acc = 0;
      for (let b = 0; b <= bins; b++) {
        if (!counts[b]) continue;
        const u = (x - (lo + b * step)) / bw;
        if (u > 6 || u < -6) continue;
        acc += counts[b] * Math.exp(-0.5 * u * u);
      }
      return acc * k;
    });
  }
  return xs.map((x) => {
    let acc = 0;
    for (const t of v) {
      const u = (x - t) / bw;
      if (u > 6 || u < -6) continue;
      acc += Math.exp(-0.5 * u * u);
    }
    return acc * k;
  });
}

/**
 * Beeswarm layout: x is fixed, and y is pushed up or down so circles do not overlap.
 * Placing circles in x order, it gathers and merges the y ranges blocked by circles within 2r in x (the window),
 * then places the circle at 0 if no range covers 0, or otherwise at the nearer end of that range.
 * Start and end points are sorted separately (numeric sort without a compare function) and merged while counting overlaps.
 */
export function beeswarm(xs: readonly number[], radius: number, opts: { maxSpread?: number; padding?: number } = {}): number[] {
  const r = radius + (opts.padding ?? 0.6);
  const d = 2 * r;
  const d2 = d * d;
  const n = xs.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const ys = new Array<number>(n).fill(0);
  const limit = opts.maxSpread ?? Infinity;
  let starts = new Float64Array(64);
  let ends = new Float64Array(64);
  let head = 0;
  // Number of circles placed (overflow points do not count as obstacles)
  let count = 0;
  let overflow = 0;
  for (const i of order) {
    const x = xs[i];
    while (head < count && px[head] < x - d) head++;
    if (count - head > starts.length) {
      starts = new Float64Array(2 * (count - head));
      ends = new Float64Array(starts.length);
    }
    // Placing inside a neighbor's open interval (py - h, py + h) overlaps it. Just touching is fine.
    // A small margin keeps a spot touching two neighbors at once from vanishing when rounding errors join their intervals
    let w = 0;
    for (let j = head; j < count; j++) {
      const dx = x - px[j];
      const h2 = d2 - 1e-6 - dx * dx;
      if (h2 <= 0) continue;
      const h = Math.sqrt(h2);
      starts[w] = py[j] - h;
      ends[w] = py[j] + h;
      w++;
    }
    let y = 0;
    if (w > 0) {
      const S = starts.subarray(0, w).sort();
      const E = ends.subarray(0, w).sort();
      let si = 0;
      let depth = 0;
      let open = 0;
      for (let ei = 0; ei < w; ) {
        // On equal values, ends come first: the point between two intervals that only touch is free
        if (si < w && S[si] < E[ei]) {
          if (depth === 0) {
            open = S[si];
            if (open >= 0) break;
          }
          depth++;
          si++;
        } else {
          depth--;
          if (depth === 0 && E[ei] > 0) {
            const near = -open < E[ei] - 1e-6 ? open : E[ei];
            const far = near === open ? E[ei] : open;
            y = Math.abs(near) <= limit ? near : Math.abs(far) <= limit ? far : NaN;
            break;
          }
          ei++;
        }
      }
    }
    if (Number.isNaN(y)) {
      // When the band is full, points are scattered evenly within it (golden ratio sequence). Overlap is allowed, and they do not pile up in a line at the limit
      ys[i] = (((overflow++ * 0.6180339887498949) % 1) * 2 - 1) * limit;
      continue;
    }
    ys[i] = y;
    px[count] = x;
    py[count] = y;
    count++;
  }
  return ys;
}

/** Histogram binning. Precedence: edges → binWidth → bins → automatic (Freedman-Diaconis; Sturges for fewer than 30 samples) */
export interface BinOptions {
  /** Sets the bin edges directly. Two or more, in ascending order */
  edges?: readonly number[];
  /** Bin width. Edges fall on multiples of the width. Ignored with log */
  binWidth?: number;
  /** Approximate number of bins. The width is rounded to an easy-to-read value (1, 2, 2.5, 5 × 10ⁿ) */
  bins?: number;
  /** Logarithmic bins. Values at or below 0 are left out */
  log?: boolean;
}

/** Number of groups a histogram overlays. With more, only the first two are drawn and spec validation warns */
export const HISTOGRAM_MAX_GROUPS = 2;

/**
 * Whether the rows are pre-binned { x0, x1, count }: true when a count channel is given, or when there is no value channel and the first row has x0, x1 and count fields but no value field.
 * The chart and spec validation follow the same rule
 */
export function isPreBinned(first: object | undefined, value: unknown, count: unknown): boolean {
  if (count !== undefined) return true;
  if (value !== undefined || !first) return false;
  return ["x0", "x1", "count"].every((k) => hasField(first, k)) && !hasField(first, "value");
}

/** Upper limit on the bin count for automatic binning. Keeps the hidden table (60 rows) and narrow screens readable */
const MAX_AUTO_BINS = 50;
/** Bin count that is never exceeded, even when set directly with binWidth or bins */
const MAX_BINS = 200;
const NICE = [1, 2, 2.5, 5, 10];
/** Edges within each decade (10x) of logarithmic bins. They are preferred numbers (R5, R10), so their widths look nearly equal on screen */
const LOG_STEPS = [[1], [1, 3], [1, 2, 5], [1, 1.6, 2.5, 4, 6.3], [1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8]];

const tidy = (v: number) => Number(v.toPrecision(12));

/** An easy-to-read width. With up, the smallest such value at or above w; otherwise the nearest one */
function niceWidth(w: number, up = false): number {
  const p = 10 ** Math.floor(Math.log10(w));
  const list = NICE.map((m) => tidy(m * p));
  if (up) return list.find((c) => c >= w * (1 - 1e-9)) ?? tidy(10 * p);
  return list.reduce((best, c) => (Math.abs(Math.log(c / w)) < Math.abs(Math.log(best / w)) ? c : best));
}

/** Edges at multiples of width w covering lo to hi */
function linearEdges(lo: number, hi: number, w: number): number[] {
  const start = Math.floor(lo / w + 1e-9) * w;
  const n = Math.max(1, Math.ceil((hi - start) / w - 1e-9));
  const out = Array.from({ length: n + 1 }, (_, i) => tidy(start + i * w));
  // Adds one more bin at an end so rounding errors do not leave an end value outside the edges
  if (out[0] > lo) out.unshift(tidy(out[0] - w));
  if (out[out.length - 1] < hi) out.push(tidy(out[out.length - 1] + w));
  return out;
}

/** steps multiplied into each decade (10x), from pad decades below the one holding lo to pad decades above the one holding hi (logarithmic bin edges and log axis ticks) */
export function decadeGrid(lo: number, hi: number, steps: readonly number[], pad = 0): number[] {
  const out: number[] = [];
  for (let d = Math.floor(Math.log10(lo)) - pad; d <= Math.ceil(Math.log10(hi)) + pad; d++) for (const m of steps) out.push(tidy(m * 10 ** d));
  return out;
}

/** Covers lo to hi with the steps edges in each decade */
function logEdges(lo: number, hi: number, steps: readonly number[]): number[] {
  const all = decadeGrid(lo, hi, steps, 1);
  let a = all.length - 1;
  while (a > 0 && all[a] > lo * (1 + 1e-9)) a--;
  let b = a + 1;
  while (b < all.length - 1 && all[b] < hi * (1 - 1e-9)) b++;
  return all.slice(a, b + 1);
}

/** Automatic width: Freedman-Diaconis (2 × IQR / ∛n) with 30 or more samples and a nonzero interquartile range, otherwise Sturges (⌈log₂ n⌉ + 1 bins) */
function autoWidth(sorted: Float64Array): number {
  const n = sorted.length;
  const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
  if (n >= 30 && iqr > 0) return (2 * iqr) / Math.cbrt(n);
  return (sorted[n - 1] - sorted[0]) / (Math.ceil(Math.log2(n)) + 1);
}

/** Cleans edges given directly: numbers only, ascending, no duplicates (only values above 0 with log). null when fewer than two remain */
function cleanEdges(edges: readonly number[], log: boolean): number[] | null {
  const out = [...new Set(edges.filter((e) => Number.isFinite(e) && (!log || e > 0)))].sort((a, b) => a - b);
  return out.length >= 2 ? out : null;
}

/**
 * Bin edges. The length is the bin count + 1, and unless edges are given directly they cover every value.
 * When all values are equal, a single bin centered on that value (width binWidth, or 1 without it; v/2 to 2v with log). An empty array when there are no values
 */
export function binEdges(values: readonly number[], opts: BinOptions = {}): number[] {
  const log = opts.log === true;
  const given = opts.edges ? cleanEdges(opts.edges, log) : null;
  if (given) return given;
  const raw = Float64Array.from(values.filter((x) => Number.isFinite(x) && (!log || x > 0))).sort();
  if (!raw.length) return [];
  const lo = raw[0];
  const hi = raw[raw.length - 1];
  const width = opts.binWidth !== undefined && opts.binWidth > 0 && !log ? opts.binWidth : undefined;
  if (lo === hi) {
    if (log) return [tidy(lo / 2), tidy(lo * 2)];
    const w = width ?? 1;
    return [lo - w / 2, lo + w / 2];
  }
  const count = opts.bins !== undefined && opts.bins >= 1 ? Math.round(opts.bins) : undefined;
  const cap = width !== undefined || count !== undefined ? MAX_BINS : MAX_AUTO_BINS;
  if (log) {
    // The bins per decade (1, 2, 3, 5, 10) closest to the target width in log units; coarser when there are too many
    const target = count !== undefined ? Math.log10(hi / lo) / count : autoWidth(raw.map(Math.log10));
    const miss = (st: readonly number[]) => Math.abs(Math.log(1 / st.length / target));
    let k = LOG_STEPS.reduce((best, st, i) => (miss(st) < miss(LOG_STEPS[best]) ? i : best), 0);
    let out = logEdges(lo, hi, LOG_STEPS[k]);
    while (out.length - 1 > cap && k > 0) out = logEdges(lo, hi, LOG_STEPS[--k]);
    return out;
  }
  let w = width ?? niceWidth(count !== undefined ? (hi - lo) / count : autoWidth(raw));
  if ((hi - lo) / w > cap) w = niceWidth((hi - lo) / cap, true);
  let out = linearEdges(lo, hi, w);
  while (out.length - 1 > cap) out = linearEdges(lo, hi, (w = niceWidth(w * 1.01, true)));
  return out;
}

/** Index of the bin containing v. Bins are [start, end), and only the last bin includes its end value. -1 outside the edges or for a non-number */
export function binIndex(edges: readonly number[], v: number): number {
  const n = edges.length - 1;
  if (n < 1 || !(v >= edges[0] && v <= edges[n])) return -1;
  // The largest a with edges[a] <= v (the last edge value belongs to the last bin)
  let a = 0;
  let b = n;
  while (b - a > 1) {
    const m = (a + b) >> 1;
    if (edges[m] <= v) a = m;
    else b = m;
  }
  return a;
}

/** Count per bin. Values outside the edges are not counted in a bin but returned as outside. Non-numeric values are not counted anywhere */
export function binCounts(values: readonly number[], edges: readonly number[]): { counts: number[]; outside: number } {
  const counts = new Array<number>(Math.max(0, edges.length - 1)).fill(0);
  let outside = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const k = binIndex(edges, v);
    if (k < 0) outside++;
    else counts[k]++;
  }
  return { counts, outside };
}

/**
 * Unit size of a dot plot: the smallest of 1, 2, 5, 10, 20 … at which the tallest column (maxCount) fits in capacity slots.
 * There is no upper limit, so however large the count, a column never holds more than capacity dots
 */
export function dotUnit(maxCount: number, capacity: number): number {
  const cap = Math.max(1, Math.floor(capacity));
  if (!(maxCount > cap)) return 1;
  if (!Number.isFinite(maxCount)) return Infinity;
  // Searches from one order of magnitude below the needed size (maxCount / cap), so rounding errors in the log do not skip the answer
  for (let p = 10 ** Math.max(0, Math.floor(Math.log10(maxCount / cap)) - 1); ; p *= 10) for (const m of [1, 2, 5]) if (Math.ceil(maxCount / (m * p)) <= cap) return m * p;
}

/** Ranks (1 is the largest). Equal values share a rank */
export function ranks(values: readonly number[], desc = true): number[] {
  const idx = values.map((v, i) => ({ v, i })).sort((a, b) => (desc ? b.v - a.v : a.v - b.v));
  const out = new Array<number>(values.length);
  let rank = 0;
  let prev: number | null = null;
  idx.forEach((d, k) => {
    if (prev === null || d.v !== prev) rank = k + 1;
    out[d.i] = rank;
    prev = d.v;
  });
  return out;
}
