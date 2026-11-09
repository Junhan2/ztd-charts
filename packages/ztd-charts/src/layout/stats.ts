import { quantileSorted } from "../core/geometry";
import { hasField } from "../data/accessor";

export interface BoxStats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** 수염 끝. 기본은 사분위 범위의 1.5배 안에서 가장 먼 값(Tukey), whiskers를 주면 그 백분위 */
  lo: number;
  hi: number;
  mean: number;
  outliers: number[];
  n: number;
}

/** 사분위, 수염, 이상값. whiskers는 수염 끝 백분위 [낮은 쪽, 높은 쪽](0~100)이고, 없으면 Tukey 방식이에요 */
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
  // 백분위 수염은 그 값까지, Tukey 수염은 울타리 안에서 가장 먼 실제 값까지 그려요
  return { min: s[0], q1, median, q3, max: s[n - 1], lo: whiskers ? loF : lo, hi: whiskers ? hiF : hi, mean: total / n, outliers: s.filter((v) => v < loF || v > hiF), n };
}

/** 가우시안 커널 밀도 추정 (Silverman 대역폭) */
export function kde(values: readonly number[], xs: readonly number[], bandwidth?: number): number[] {
  const v = values.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (!n) return xs.map(() => 0);
  const mean = v.reduce((a, b) => a + b, 0) / n;
  // 값이 모두 같으면 표준편차가 0이에요. 고정값 1 대신 그리는 범위(xs)의 1/40을 써서 다른 그룹 곡선이 납작해지지 않게
  const range = xs.length > 1 ? Math.abs(xs[xs.length - 1] - xs[0]) : 0;
  const fallback = range > 0 ? range / 40 : Math.abs(mean) * 0.05 || 1;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || fallback;
  const s = [...v].sort((a, b) => a - b);
  const iqr = quantileSorted(s, 0.75) - quantileSorted(s, 0.25);
  const spread = Math.min(sd, iqr > 0 ? iqr / 1.34 : sd) || sd;
  const bw = bandwidth ?? Math.max(1e-9, 0.9 * spread * Math.pow(n, -0.2));
  const k = 1 / (Math.sqrt(2 * Math.PI) * bw * n);
  // 값이 많으면 구간 묶음으로 근사해요
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
 * 비스웜 배치: x는 고정, 원끼리 겹치지 않게 y를 위아래로 밀어요.
 * x 순서로 놓으면서, x로 2r 안에 있는 원들(창)이 막는 y 구간을 모아 합친 뒤
 * 0을 덮는 구간이 없으면 0, 있으면 그 구간의 가까운 끝에 놓아요.
 * 시작점과 끝점을 따로 정렬해(비교 함수 없는 숫자 정렬) 겹치는 수를 세며 합쳐요.
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
  // 자리를 잡은 원 수 (넘친 점은 장애물로 치지 않아요)
  let count = 0;
  let overflow = 0;
  for (const i of order) {
    const x = xs[i];
    while (head < count && px[head] < x - d) head++;
    if (count - head > starts.length) {
      starts = new Float64Array(2 * (count - head));
      ends = new Float64Array(starts.length);
    }
    // 이웃마다 열린 구간 (py - h, py + h) 안에 놓으면 겹쳐요. 딱 닿는 건 괜찮아요.
    // 두 이웃에 동시에 닿는 자리는 반올림 오차로 구간이 붙어 사라지지 않게 조금 여유를 둬요
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
        // 같은 값이면 끝을 먼저: 닿기만 하는 두 구간 사이는 빈자리예요
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
      // 띠가 꽉 차면 띠 안에 고르게 흩어요 (황금비 수열). 겹침을 허용하고, 한계선에 줄로 쌓이지 않아요
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

/** 히스토그램 구간 나누기. 정하는 순서는 edges → binWidth → bins → 자동(Freedman-Diaconis, 표본 30개 미만은 Sturges)이에요 */
export interface BinOptions {
  /** 경계를 직접 정해요. 작은 것부터 두 개 이상 */
  edges?: readonly number[];
  /** 구간 폭. 경계는 폭의 배수에 놓여요. log면 쓰지 않아요 */
  binWidth?: number;
  /** 대략의 구간 수. 폭은 읽기 쉬운 값(1, 2, 2.5, 5 × 10ⁿ)으로 맞춰요 */
  bins?: number;
  /** 로그 구간. 0 이하 값은 빼고 나눠요 */
  log?: boolean;
}

/** 히스토그램이 겹쳐 그리는 그룹 수. 더 많으면 앞의 둘만 그리고 스펙 검사가 경고해요 */
export const HISTOGRAM_MAX_GROUPS = 2;

/**
 * 미리 나눈 행 { x0, x1, count }인지: count 채널을 주거나, value 채널 없이 첫 행에 x0, x1, count 필드가 있고 value 필드가 없을 때예요.
 * 차트와 스펙 검사가 같은 규칙을 써요
 */
export function isPreBinned(first: object | undefined, value: unknown, count: unknown): boolean {
  if (count !== undefined) return true;
  if (value !== undefined || !first) return false;
  return ["x0", "x1", "count"].every((k) => hasField(first, k)) && !hasField(first, "value");
}

/** 자동으로 나눌 때의 구간 수 상한. 숨긴 표(60행)와 좁은 화면에서도 읽히게 둬요 */
const MAX_AUTO_BINS = 50;
/** binWidth, bins로 직접 정해도 넘지 않는 구간 수 */
const MAX_BINS = 200;
const NICE = [1, 2, 2.5, 5, 10];
/** 로그 구간의 한 자리(10배)마다 경계. 표준수(R5, R10)라 화면에서 폭이 거의 같아요 */
const LOG_STEPS = [[1], [1, 3], [1, 2, 5], [1, 1.6, 2.5, 4, 6.3], [1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8]];

const tidy = (v: number) => Number(v.toPrecision(12));

/** 읽기 쉬운 폭. up이면 w 이상에서 가장 작은 값, 아니면 가장 가까운 값 */
function niceWidth(w: number, up = false): number {
  const p = 10 ** Math.floor(Math.log10(w));
  const list = NICE.map((m) => tidy(m * p));
  if (up) return list.find((c) => c >= w * (1 - 1e-9)) ?? tidy(10 * p);
  return list.reduce((best, c) => (Math.abs(Math.log(c / w)) < Math.abs(Math.log(best / w)) ? c : best));
}

/** 폭 w의 배수로 lo부터 hi까지 덮는 경계 */
function linearEdges(lo: number, hi: number, w: number): number[] {
  const start = Math.floor(lo / w + 1e-9) * w;
  const n = Math.max(1, Math.ceil((hi - start) / w - 1e-9));
  const out = Array.from({ length: n + 1 }, (_, i) => tidy(start + i * w));
  // 반올림 오차로 끝값이 경계 밖에 남지 않게 한 칸씩 더해요
  if (out[0] > lo) out.unshift(tidy(out[0] - w));
  if (out[out.length - 1] < hi) out.push(tidy(out[out.length - 1] + w));
  return out;
}

/** 한 자리(10배)마다 steps를 곱한 값. lo가 든 자리보다 pad자리 아래부터 hi가 든 자리보다 pad자리 위까지예요(로그 구간 경계와 로그 축 눈금) */
export function decadeGrid(lo: number, hi: number, steps: readonly number[], pad = 0): number[] {
  const out: number[] = [];
  for (let d = Math.floor(Math.log10(lo)) - pad; d <= Math.ceil(Math.log10(hi)) + pad; d++) for (const m of steps) out.push(tidy(m * 10 ** d));
  return out;
}

/** 한 자리마다 steps의 경계로 lo부터 hi까지 덮어요 */
function logEdges(lo: number, hi: number, steps: readonly number[]): number[] {
  const all = decadeGrid(lo, hi, steps, 1);
  let a = all.length - 1;
  while (a > 0 && all[a] > lo * (1 + 1e-9)) a--;
  let b = a + 1;
  while (b < all.length - 1 && all[b] < hi * (1 - 1e-9)) b++;
  return all.slice(a, b + 1);
}

/** 자동 폭: 표본 30개 이상이고 사분위 범위가 있으면 Freedman-Diaconis(2 × IQR / ∛n), 아니면 Sturges(⌈log₂ n⌉ + 1개) */
function autoWidth(sorted: Float64Array): number {
  const n = sorted.length;
  const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
  if (n >= 30 && iqr > 0) return (2 * iqr) / Math.cbrt(n);
  return (sorted[n - 1] - sorted[0]) / (Math.ceil(Math.log2(n)) + 1);
}

/** 직접 준 경계를 정리해요: 숫자만, 작은 것부터, 겹치지 않게 (log면 0보다 큰 것만). 두 개가 안 되면 null */
function cleanEdges(edges: readonly number[], log: boolean): number[] | null {
  const out = [...new Set(edges.filter((e) => Number.isFinite(e) && (!log || e > 0)))].sort((a, b) => a - b);
  return out.length >= 2 ? out : null;
}

/**
 * 구간 경계. 길이는 구간 수 + 1이고, 경계를 직접 주지 않으면 모든 값을 덮어요.
 * 값이 모두 같으면 그 값을 가운데 둔 구간 하나예요(폭은 binWidth, 없으면 1. log면 v/2 ~ 2v). 값이 없으면 빈 배열
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
    // 로그 단위 목표 폭에 가장 가까운, 한 자리에 들어가는 구간 수(1, 2, 3, 5, 10). 많으면 성기게
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

/** v가 든 구간 번호. 구간은 [시작, 끝)이고 마지막 구간만 끝값을 넣어요. 경계 밖이거나 숫자가 아니면 -1 */
export function binIndex(edges: readonly number[], v: number): number {
  const n = edges.length - 1;
  if (n < 1 || !(v >= edges[0] && v <= edges[n])) return -1;
  // edges[a] <= v 인 가장 큰 a (마지막 경계값은 마지막 구간)
  let a = 0;
  let b = n;
  while (b - a > 1) {
    const m = (a + b) >> 1;
    if (edges[m] <= v) a = m;
    else b = m;
  }
  return a;
}

/** 구간마다 개수. 경계 밖의 값은 세지 않고 outside로 돌려줘요. 숫자가 아닌 값은 어디에도 세지 않아요 */
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
 * 점 그림의 묶음 크기: 1, 2, 5, 10, 20 … 가운데 가장 높은 열(maxCount)이 capacity개 자리에 들어가는 가장 작은 값.
 * 위 한도가 없어서 개수가 아무리 커도 한 열의 점은 capacity개를 넘지 않아요
 */
export function dotUnit(maxCount: number, capacity: number): number {
  const cap = Math.max(1, Math.floor(capacity));
  if (!(maxCount > cap)) return 1;
  if (!Number.isFinite(maxCount)) return Infinity;
  // 필요한 크기(maxCount / cap)보다 한 자릿수 아래부터 찾아요. 로그의 반올림 오차로 답을 건너뛰지 않게요
  for (let p = 10 ** Math.max(0, Math.floor(Math.log10(maxCount / cap)) - 1); ; p *= 10) for (const m of [1, 2, 5]) if (Math.ceil(maxCount / (m * p)) <= cap) return m * p;
}

/** 순위 (1이 가장 큼). 같은 값은 같은 순위 */
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
