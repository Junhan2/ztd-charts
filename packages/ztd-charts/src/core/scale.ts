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
  // 1·2·5 단계로 끊는 경계 (√50, √10, √2)
  const k = m >= 7.071 ? 10 : m >= 3.162 ? 5 : m >= 1.414 ? 2 : 1;
  return k * p;
}

/**
 * 축 범위. 끝이 눈금에 가까우면 눈금까지, 멀면 값 + 여유만큼만 넓혀요.
 * (빈 눈금 칸이 생기지 않게)
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
  // 눈금은 넓힌 범위로 다시 만들어요(ticksFor). 여유 때문에 간격이 커지면 그 간격으로 다시 맞춰요. 안 그러면 마지막 눈금 위가 크게 비어요
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

/** 눈금이 깔끔하게 떨어지도록 범위를 넓혀요 */
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

/** 로그 축 범위: log10 공간에서 fitDomain(끝이 10배 눈금에 가까우면 눈금까지). 값이 하나면 위아래 반 자리, 0보다 큰 값이 없으면 [1, 10] */
export function fitLogDomain(min: number, max: number, count = 4): [number, number] {
  if (!(min > 0) || !(max > 0) || !Number.isFinite(min) || !Number.isFinite(max)) return [1, 10];
  const a0 = Math.log10(min);
  const b0 = Math.log10(max);
  if (a0 === b0) return [10 ** (a0 - 0.5), 10 ** (a0 + 0.5)];
  // 눈금 간격이 10배 한 칸이 되게 (끝이 10배 눈금에 붙어요)
  const [a, b] = fitDomain(a0, b0, Math.max(count, Math.ceil(b0 - a0)), { zero: false });
  return [10 ** a, 10 ** b];
}

/** 로그 축 눈금: 10배 한 칸이 110px 이상이면 1·2·5, 아니면 10의 거듭제곱(24px보다 좁으면 k칸마다). 둘이 안 되면 1~9, 그래도 안 되면 선형 눈금 */
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

/** 로그 자: 0 이하 값은 NaN(그리지 않아요). ticks는 자의 픽셀 길이로 고른 로그 눈금 */
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

/** 칸 나누기. padding은 칸 사이 비율, outer는 양 끝 여백 비율 */
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

/** 색 진하기 기준 최댓값: 값이 많으면 95퍼센타일이라 튀는 값 하나에 전체가 흐려지지 않아요 */
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

/** 시간 축 눈금: 기간과 폭에 맞춰 일, 주, 월, 분기, 연 단위를 골라요 */
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
        // 연도는 네 자리로 ("Nov 23"은 11월 23일로 읽혀요)
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
