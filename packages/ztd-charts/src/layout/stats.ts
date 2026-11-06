import { quantileSorted } from "../core/geometry";

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
