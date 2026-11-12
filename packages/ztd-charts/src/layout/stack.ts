export type StackOffset = "zero" | "expand" | "silhouette" | "wiggle";

/**
 * Stacking. values[s][k] (series s, position k).
 * zero: from 0, expand: to 100%, silhouette: centered, wiggle: streamgraph (a baseline that reduces the bands' wobble)
 */
export function stack(values: readonly (readonly number[])[], offset: StackOffset = "zero"): { y0: number[][]; y1: number[][] } {
  const ns = values.length;
  const nk = ns ? values[0].length : 0;
  const y0 = values.map(() => new Array<number>(nk).fill(0));
  const y1 = values.map(() => new Array<number>(nk).fill(0));
  const v = (s: number, k: number) => {
    const x = values[s][k];
    return Number.isFinite(x) && x > 0 ? x : 0;
  };
  const base = new Array<number>(nk).fill(0);
  if (offset === "wiggle" && ns > 0 && nk > 1) {
    let b = 0;
    for (let k = 1; k < nk; k++) {
      let s1 = 0;
      let s2 = 0;
      for (let s = 0; s < ns; s++) {
        const cur = v(s, k);
        const dv = cur - v(s, k - 1);
        let s3 = 0;
        for (let j = 0; j < s; j++) s3 += v(j, k) - v(j, k - 1);
        s1 += cur;
        s2 += (dv / 2 + s3) * cur;
      }
      if (s1) b -= s2 / s1;
      base[k] = b;
    }
  }
  for (let k = 0; k < nk; k++) {
    // When stacking from 0, negatives stack separately below 0 (positives up, negatives down)
    if (offset === "zero") {
      let pos = 0;
      let neg = 0;
      for (let s = 0; s < ns; s++) {
        const x = values[s][k];
        const val = Number.isFinite(x) ? x : 0;
        if (val >= 0) {
          y0[s][k] = pos;
          pos += val;
          y1[s][k] = pos;
        } else {
          y0[s][k] = neg;
          neg += val;
          y1[s][k] = neg;
        }
      }
      continue;
    }
    let tot = 0;
    for (let s = 0; s < ns; s++) tot += v(s, k);
    let acc = offset === "silhouette" ? -tot / 2 : base[k];
    for (let s = 0; s < ns; s++) {
      let val = v(s, k);
      if (offset === "expand") val = tot ? (val / tot) * 100 : 0;
      y0[s][k] = acc;
      acc += val;
      y1[s][k] = acc;
    }
  }
  if (offset === "wiggle" && nk) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < nk; k++) {
      lo = Math.min(lo, y0[0]?.[k] ?? 0);
      hi = Math.max(hi, y1[ns - 1]?.[k] ?? 0);
    }
    // Aligns the mean center line to 0 so the thickest point sits in the middle
    let mid = 0;
    for (let k = 0; k < nk; k++) mid += ((y0[0]?.[k] ?? 0) + (y1[ns - 1]?.[k] ?? 0)) / 2;
    mid /= nk;
    for (let s = 0; s < ns; s++)
      for (let k = 0; k < nk; k++) {
        y0[s][k] -= mid;
        y1[s][k] -= mid;
      }
  }
  return { y0, y1 };
}

export interface DivergingOptions {
  /** Series positions to place below the zero line (left of it for horizontal bars), ordered outward from the zero line */
  negative?: readonly number[];
  /** Position of the series split half and half across the zero line */
  neutral?: number;
  /** Expresses each segment as a share (%) of its row's sum of absolute values */
  percent?: boolean;
  /** Series that take no space but still count in the percent denominator (hidden series). Hiding them does not move the other side */
  skip?: ReadonlySet<number>;
}

/**
 * Diverging stack (Likert, population pyramid). values[s][k]. y0 is the end at the zero line, y1 the outer end (for the neutral series, the left and right ends).
 * negative series stack below the zero line by their magnitude, the rest stack upward in data order. Values that are already negative go down by their sign,
 * and below the line they are placed from the outside so the data order reads from the left. neg and pos are each row's totals on either side (the neutral series excluded)
 */
export function divergingStack(values: readonly (readonly number[])[], opts: DivergingOptions = {}): { y0: number[][]; y1: number[][]; neg: number[]; pos: number[] } {
  const ns = values.length;
  const nk = ns ? values[0].length : 0;
  const y0 = values.map(() => new Array<number>(nk).fill(0));
  const y1 = values.map(() => new Array<number>(nk).fill(0));
  const neg = new Array<number>(nk).fill(0);
  const pos = new Array<number>(nk).fill(0);
  const mid = opts.neutral !== undefined && opts.neutral >= 0 && opts.neutral < ns ? opts.neutral : -1;
  const listed = [...new Set(opts.negative ?? [])].filter((s) => s >= 0 && s < ns && s !== mid);
  const rest = values.map((_, s) => s).filter((s) => s !== mid && !listed.includes(s));
  for (let k = 0; k < nk; k++) {
    let sum = 0;
    for (let s = 0; s < ns; s++) if (Number.isFinite(values[s][k])) sum += Math.abs(values[s][k]);
    const f = opts.percent ? (sum ? 100 / sum : 0) : 1;
    const size = (s: number) => (Number.isFinite(values[s][k]) && !opts.skip?.has(s) ? Math.abs(values[s][k]) * f : 0);
    const h = mid >= 0 ? size(mid) / 2 : 0;
    if (mid >= 0) {
      y0[mid][k] = -h;
      y1[mid][k] = h;
    }
    // 0 - h: without a neutral series it starts at 0, not -0
    let lo = 0 - h;
    let hi = h;
    const down = (s: number) => {
      y0[s][k] = lo;
      lo -= size(s);
      y1[s][k] = lo;
    };
    listed.forEach(down);
    for (const s of rest) {
      if (values[s][k] < 0) continue;
      y0[s][k] = hi;
      hi += size(s);
      y1[s][k] = hi;
    }
    for (let j = rest.length - 1; j >= 0; j--) if (values[rest[j]][k] < 0) down(rest[j]);
    neg[k] = 0 - lo - h;
    pos[k] = hi - h;
  }
  return { y0, y1, neg, pos };
}

/** Default highlighted series of a diverging stack: with negative set, the outermost positive series (the last one that is neither negative nor neutral); otherwise -1. Shared by the chart and the automatic legend */
export function divergingLead(n: number, negative: readonly number[], neutral = -1): number {
  if (!negative.some((s) => s >= 0)) return -1;
  for (let s = n - 1; s >= 0; s--) if (s !== neutral && !negative.includes(s)) return s;
  return -1;
}

/** Series order that suits a streamgraph (inside-out): series that peak early go to the middle */
export function insideOut(values: readonly (readonly number[])[]): number[] {
  const n = values.length;
  const peak = values.map((row) => {
    let best = 0;
    let bv = -Infinity;
    row.forEach((v, k) => {
      if (v > bv) {
        bv = v;
        best = k;
      }
    });
    return best;
  });
  const sums = values.map((row) => row.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0));
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => peak[a] - peak[b]);
  const top: number[] = [];
  const bottom: number[] = [];
  let st = 0;
  let sb = 0;
  for (const i of order) {
    if (st < sb) {
      top.push(i);
      st += sums[i];
    } else {
      bottom.push(i);
      sb += sums[i];
    }
  }
  return [...bottom.reverse(), ...top];
}
