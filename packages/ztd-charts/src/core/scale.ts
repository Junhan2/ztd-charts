import { DEFAULT_LOCALE, formatDate } from "./format";

export interface LinearScale {
  (v: number): number;
  domain: [number, number];
  range: [number, number];
  invert: (px: number) => number;
  ticks: (count?: number) => number[];
}

export function niceStep(span: number, count: number): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / Math.max(1, count);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  // Thresholds for snapping to 1·2·5 steps (√50, √10, √2)
  const k = m >= 7.071 ? 10 : m >= 3.162 ? 5 : m >= 1.414 ? 2 : 1;
  return k * p;
}

/**
 * Axis range. An end close to a tick extends to that tick; a far one extends only to the value plus padding.
 * (so no empty tick interval appears)
 */
export function fitDomain(min: number, max: number, count = 4, opts: { zero?: boolean; pad?: number } = {}): [number, number] {
  let lo = min;
  let hi = max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (opts.zero !== false) {
    if (lo > 0) lo = 0;
    if (hi < 0) hi = 0;
  }
  if (lo === hi) return lo === 0 ? [0, 1] : lo > 0 ? [0, lo * 1.2] : [lo * 1.2, 0];
  const span = hi - lo;
  const pad = opts.pad ?? 0.07;
  let step = niceStep(span, count);
  let d: [number, number] = [lo, hi];
  // Ticks are rebuilt over the widened range (ticksFor). If the padding makes the step larger, the range is refit to that step; otherwise a big gap is left above the last tick
  for (let k = 0; k < 4; k++) {
    const nHi = Math.ceil(hi / step - 1e-9) * step;
    const nLo = Math.floor(lo / step + 1e-9) * step;
    d = [lo === 0 ? 0 : lo - nLo <= step * 0.3 ? nLo : lo - span * pad, hi === 0 ? 0 : nHi - hi <= step * 0.3 ? nHi : hi + span * pad];
    const s = niceStep(d[1] - d[0], count);
    if (s === step) break;
    step = s;
  }
  return d;
}

/** Widens the range so the ticks fall on round values */
export function niceDomain(min: number, max: number, count = 4, opts: { zero?: boolean } = {}): [number, number] {
  let lo = min;
  let hi = max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (opts.zero !== false) {
    if (lo > 0) lo = 0;
    if (hi < 0) hi = 0;
  }
  if (lo === hi) return lo === 0 ? [0, 1] : lo > 0 ? [0, lo * 1.25] : [lo * 1.25, 0];
  const s = niceStep(hi - lo, count);
  return [Math.floor(lo / s + 1e-9) * s, Math.ceil(hi / s - 1e-9) * s];
}

export function ticksFor(d0: number, d1: number, count = 4): number[] {
  const lo = Math.min(d0, d1);
  const hi = Math.max(d0, d1);
  const s = niceStep(hi - lo, count);
  const out: number[] = [];
  const start = Math.ceil(lo / s - 1e-9) * s;
  for (let v = start, i = 0; v <= hi + s * 1e-9 && i < 200; v += s, i++) out.push(Number((Math.round(v / s) * s).toPrecision(12)));
  return out;
}

export function scaleLinear(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = ((v: number) => r0 + (v - d0) * k) as LinearScale;
  f.domain = domain;
  f.range = range;
  f.invert = (px: number) => (k === 0 ? d0 : d0 + (px - r0) / k);
  f.ticks = (count = 4) => ticksFor(d0, d1, count);
  return f;
}

/** Log axis range: fitDomain in log10 space (an end close to a power-of-10 tick extends to it). Half a decade above and below for a single value; [1, 10] when no value is above 0 */
export function fitLogDomain(min: number, max: number, count = 4): [number, number] {
  if (!(min > 0) || !(max > 0) || !Number.isFinite(min) || !Number.isFinite(max)) return [1, 10];
  const a0 = Math.log10(min);
  const b0 = Math.log10(max);
  if (a0 === b0) return [10 ** (a0 - 0.5), 10 ** (a0 + 0.5)];
  // So the tick step is one decade (the ends snap to power-of-10 ticks)
  const [a, b] = fitDomain(a0, b0, Math.max(count, Math.ceil(b0 - a0)), { zero: false });
  return [10 ** a, 10 ** b];
}

/** Log axis ticks: 1·2·5 when one decade spans at least 110px, otherwise powers of 10 (every k-th one when narrower than 24px). 1 to 9 when that gives fewer than two, and linear ticks when that still fails */
export function logTicks(lo: number, hi: number, px: number): number[] {
  const l0 = Math.log10(lo);
  const l1 = Math.log10(hi);
  const per = px / Math.max(1e-9, l1 - l0);
  const pick = (steps: number[], every = 1) => {
    const out: number[] = [];
    for (let d = Math.floor(l0); d <= Math.ceil(l1); d++) {
      if (d % every) continue;
      for (const m of steps) {
        const v = Number((m * 10 ** d).toPrecision(12));
        if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) out.push(v);
      }
    }
    return out;
  };
  const t = per >= 110 ? pick([1, 2, 5]) : pick([1], Math.max(1, Math.ceil(24 / per)));
  if (t.length >= 2) return t;
  const nine = pick([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  return nine.length >= 2 ? nine : ticksFor(lo, hi, 3);
}

/** Log scale: values at or below 0 give NaN (not drawn). ticks gives log ticks chosen by the scale's pixel length */
export function scaleLog(domain: [number, number], range: [number, number]): LinearScale {
  const s = scaleLinear([Math.log10(domain[0]), Math.log10(domain[1])], range);
  const f = ((v: number) => (v > 0 ? s(Math.log10(v)) : Number.NaN)) as LinearScale;
  f.domain = domain;
  f.range = range;
  f.invert = (px: number) => 10 ** s.invert(px);
  f.ticks = () => logTicks(domain[0], domain[1], Math.abs(range[1] - range[0]));
  return f;
}

export function scaleSqrt(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const s0 = Math.sqrt(Math.max(0, d0));
  const s1 = Math.sqrt(Math.max(0, d1));
  return (v) => (s1 === s0 ? r1 : r0 + ((Math.sqrt(Math.max(0, v)) - s0) / (s1 - s0)) * (r1 - r0));
}

export interface BandScale {
  (key: string): number;
  bandwidth: number;
  step: number;
  domain: string[];
  index: (key: string) => number;
}

/** Splits a range into bands. padding is the ratio between bands, outer the ratio of the margins at both ends */
export function scaleBand(domain: string[], range: [number, number], padding = 0.2, outer = padding / 2): BandScale {
  const n = domain.length;
  const [r0, r1] = range;
  const span = r1 - r0;
  const step = n ? span / Math.max(1, n - padding + outer * 2) : span;
  const bw = step * (1 - padding);
  const start = r0 + step * outer;
  const idx = new Map(domain.map((k, i) => [k, i]));
  const f = ((key: string) => start + (idx.get(key) ?? 0) * step) as BandScale;
  f.bandwidth = Math.max(0, bw);
  f.step = step;
  f.domain = domain;
  f.index = (k) => idx.get(k) ?? -1;
  return f;
}

export function extent(xs: Iterable<number>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of xs) {
    if (!Number.isFinite(x)) continue;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return lo === Infinity ? [0, 1] : [lo, hi];
}

/** Maximum used for color intensity: with many values it is the 95th percentile, so a single outlier does not wash out everything else */
export function robustMax(values: ArrayLike<number>): number {
  const v: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) v.push(values[i]);
  if (!v.length) return 1;
  v.sort((a, b) => a - b);
  if (v.length < 24) return v[v.length - 1];
  return v[Math.min(v.length - 1, Math.floor(v.length * 0.95))] || v[v.length - 1];
}

const DAY = 86400000;

export interface TimeTick {
  t: number;
  label: string;
}

/** Time axis ticks: picks day, week, month, quarter or year units to suit the span and width */
export function timeTicks(t0: number, t1: number, maxTicks: number, locale = DEFAULT_LOCALE): TimeTick[] {
  const span = t1 - t0;
  if (!(span > 0)) return [{ t: t0, label: formatDate(t0, { locale, month: "short", day: "numeric" }) }];
  const days = span / DAY;
  const out: TimeTick[] = [];
  const d0 = new Date(t0);
  const sameYear = new Date(t0).getFullYear() === new Date(t1).getFullYear();
  const pushRange = (start: Date, inc: (d: Date) => void, fmt: Intl.DateTimeFormatOptions, yearOnChange = false) => {
    const d = new Date(start);
    let lastYear = -1;
    let guard = 0;
    while (d.getTime() <= t1 && guard++ < 500) {
      if (d.getTime() >= t0) {
        const y = d.getFullYear();
        const showYear = yearOnChange && !sameYear && y !== lastYear;
        // Years in four digits ("Nov 23" reads as November 23)
        out.push({ t: d.getTime(), label: formatDate(d, { locale, ...fmt, ...(showYear ? { year: "numeric" } : {}) }) });
        lastYear = y;
      }
      inc(d);
    }
  };
  if (days <= 1.5) {
    const hours = Math.max(1, Math.ceil(span / 3600000 / Math.max(1, maxTicks)));
    const step = [1, 2, 3, 4, 6, 12].find((h) => h >= hours) ?? 12;
    const s = new Date(d0);
    s.setMinutes(0, 0, 0);
    pushRange(s, (d) => d.setHours(d.getHours() + step), { hour: "numeric" });
  } else if (days <= maxTicks * 1.2) {
    const s = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());
    pushRange(s, (d) => d.setDate(d.getDate() + 1), { month: "numeric", day: "numeric" });
  } else if (days <= maxTicks * 7 * 1.2) {
    const s = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());
    s.setDate(s.getDate() + ((8 - s.getDay()) % 7));
    pushRange(s, (d) => d.setDate(d.getDate() + 7), { month: "numeric", day: "numeric" });
  } else {
    const months = days / 30.44;
    const per = Math.max(1, Math.ceil(months / Math.max(1, maxTicks)));
    const step = [1, 2, 3, 6, 12, 24, 60].find((m) => m >= per) ?? 120;
    if (step >= 12) {
      const s = new Date(d0.getFullYear() + (d0.getMonth() > 0 || d0.getDate() > 1 ? 1 : 0), 0, 1);
      pushRange(s, (d) => d.setFullYear(d.getFullYear() + step / 12), { year: "numeric" });
    } else {
      const s = new Date(d0.getFullYear(), d0.getMonth() + (d0.getDate() > 1 ? 1 : 0), 1);
      const m0 = s.getMonth() % step;
      if (m0) s.setMonth(s.getMonth() + (step - m0));
      pushRange(s, (d) => d.setMonth(d.getMonth() + step), { month: "short" }, true);
    }
  }
  return out;
}
