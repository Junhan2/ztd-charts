export type StackOffset = "zero" | "expand" | "silhouette" | "wiggle";

/**
 * 쌓기. values[s][k] (계열 s, 위치 k).
 * zero: 0부터, expand: 100% 기준, silhouette: 가운데 기준, wiggle: 스트림그래프 (띠의 출렁임을 줄이는 기준선)
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
    // 0부터 쌓을 때는 음수를 0 아래로 따로 쌓아요 (양수는 위로, 음수는 아래로)
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
    // 가장 두꺼운 지점이 가운데 오도록 평균 중심선을 0에 맞춰요
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
  /** 0선 아래(가로 막대면 왼쪽)에 놓을 계열 자리. 0선에서 바깥 순서예요 */
  negative?: readonly number[];
  /** 0선 양쪽에 반씩 놓는 계열 자리 */
  neutral?: number;
  /** 조각을 그 줄 절댓값 합의 몫(%)으로 */
  percent?: boolean;
  /** 자리는 차지하지 않고 percent의 분모에만 드는 계열 (숨긴 계열). 숨겨도 다른 쪽이 움직이지 않아요 */
  skip?: ReadonlySet<number>;
}

/**
 * 양쪽으로 쌓기 (리커트, 인구 피라미드). values[s][k]. y0은 0선 쪽 끝, y1은 바깥 끝이에요(가운데 계열은 왼쪽 끝, 오른쪽 끝).
 * negative 계열은 값 크기만큼 0선 아래로, 나머지는 데이터 순서로 위로 쌓아요. 이미 음수인 값은 부호대로 아래로 가고,
 * 아래쪽에서는 데이터 순서가 왼쪽부터 읽히게 바깥부터 놓아요. neg, pos는 줄마다 양쪽 합계(가운데 계열은 빼요)
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
    // 0 - h: 가운데 계열이 없을 때 -0이 아니라 0에서 시작해요
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

/** 양쪽 쌓기의 기본 강조 계열: negative가 있으면 가장 바깥 긍정 계열(negative도 neutral도 아닌 마지막 계열), 없으면 -1. 차트와 자동 범례가 같이 써요 */
export function divergingLead(n: number, negative: readonly number[], neutral = -1): number {
  if (!negative.some((s) => s >= 0)) return -1;
  for (let s = n - 1; s >= 0; s--) if (s !== neutral && !negative.includes(s)) return s;
  return -1;
}

/** 스트림그래프에 보기 좋은 계열 순서 (inside-out): 일찍 큰 값이 나오는 계열을 가운데로 */
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
