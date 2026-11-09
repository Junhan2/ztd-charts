import { numGetter } from "../data/accessor";
import { areaPath, r2, type Curve } from "./geometry";
import type { Accessor } from "./types";

/**
 * 계열 하나의 범위 띠 모양 (픽셀). 위, 아래 y는 움직임 엔진이 선과 함께 보간하고 x는 데이터 그대로예요.
 * 경계가 빠진 x에서 끊겨 조각으로 나뉘어요
 */
export interface BandShape {
  /** 조각마다 시작 위치와 끝에 전체 길이. [0, 5, 9]면 0~4, 5~8 두 조각 */
  runs: number[];
  /** 점의 x. 계단이면 픽셀 열의 왼쪽 끝 */
  xl: number[];
  /** 계단(점 줄이기)일 때 픽셀 열의 오른쪽 끝. 점 모양이면 비어요 */
  xr: number[];
  /** 위 경계(upper) y */
  top: number[];
  /** 아래 경계(lower) y */
  bottom: number[];
}

/** 범위 띠 경계 필드. y와 같은 꼴이에요: 넓은 표면 y 열과 같은 순서의 배열, 긴 표면 필드 하나 */
export type BoundField<T> = Accessor<T, unknown> | readonly string[];

const isFieldList = <T>(f: BoundField<T>): f is readonly string[] => Array.isArray(f);

/**
 * s번째 계열의 경계 필드 (값과 이름이 같이 써요).
 * 넓은 표는 s번째 y 열에 s번째 경계 필드를 맞추고 (필드 하나나 함수면 첫 계열만), 긴 표는 행마다 필드 하나예요 (배열이면 첫 필드). 그 계열의 필드가 없으면 null
 */
export function boundField<T>(f: BoundField<T>, s: number, wide: boolean): Accessor<T, unknown> | null {
  const list = isFieldList(f) ? f : [f];
  return !wide ? list[0] : s < list.length ? list[s] : null;
}

/**
 * 계열마다 띠로 그릴 [아래, 위] 값 (rows와 같은 [계열][x] 꼴). prepSeries가 칸마다 남긴 행(rows)에서 읽어서 x를 다시 읽지 않아요.
 * 같은 칸에 행이 여럿이면 y는 합치지만 띠는 마지막 행 경계예요.
 * 아래가 위보다 크면 바꿔 그리고, from보다 앞 x와 한쪽이라도 빠진 x는 NaN이에요 (띠가 끊겨요)
 */
export function bandBounds<T>(rows: readonly (readonly (T | null)[])[], lower: BoundField<T>, upper: BoundField<T>, wide: boolean, data: readonly T[], from: number): { lo: number[]; hi: number[] }[] {
  // 함수로 준 경계만 원래 행 번호가 필요해요
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

/** 값이 띠 밖인지 (띠가 없는 x는 아니에요) */
export const isOutside = (v: number, lo: number, hi: number): boolean => Number.isFinite(v) && Number.isFinite(lo) && (v < lo || v > hi);

/** 경계가 모두 있는 x가 이어진 구간 [시작, 끝] (양끝 포함). 점 하나짜리는 면이 없어서 빼요 */
function bandRuns(lo: readonly number[], hi: readonly number[]): [number, number][] {
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
 * 조각 하나를 픽셀 열 계단으로. 이웃한 두 점 사이 구간이 지나는 열마다 두 점의 아래 최솟값, 위 최댓값을 모아요.
 * 그래서 열마다 그 열 점들의 lower 최솟값 이하, upper 최댓값 이상을 열 전체 폭에 칠하고, 점이 없는 열도 이어져요
 */
function stepColumns(out: BandShape, xs: (k: number) => number, lo: readonly number[], hi: readonly number[], y: (v: number) => number, a: number, b: number): void {
  const xa = xs(a);
  const xb = xs(b);
  // 차트가 여백보다 좁으면 x가 뒤집혀요. 그릴 열이 없어요
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
    // 마지막 점이 열 경계에 딱 걸리면 폭 0인 열이 생겨요
    if (right <= left && c > 0) continue;
    out.xl.push(left);
    out.xr.push(right);
    out.top.push(y(H[c]));
    out.bottom.push(y(L[c]));
  }
}

/**
 * 띠 모양. lo, hi는 x 순서의 값(bandBounds)이고 xs는 그 픽셀 x예요.
 * 띠 점이 budget보다 많으면 구간 평균 대신 픽셀 열 계단(stepColumns)으로 줄여요. 그리지 않으면 null
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

/** 계단 조각 하나: 위 경계를 왼쪽에서 오른쪽으로, 아래 경계를 되돌아와요. 값이 같은 이웃 열은 한 번에 그어요 */
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

/** 띠 path 하나 (조각마다 닫힌 면). top, bottom은 지금 그리는 y (움직임 엔진의 값) */
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
