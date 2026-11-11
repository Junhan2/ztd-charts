import { sum } from "../core/geometry";

/** 가장 큰 나머지 방식으로 칸 나누기: 합이 정확히 cells가 돼요 */
export function allocateCells(values: readonly number[], cells: number, total?: number): number[] {
  // A total below the sum would hand out more cells than there are.
  const t = Math.max(total ?? 0, sum(values));
  if (!(t > 0)) return values.map(() => 0);
  const exact = values.map((v) => (Math.max(0, v) / t) * cells);
  const out = exact.map((x) => Math.floor(x));
  const target = total === undefined ? cells : Math.min(cells, Math.round((sum(values) / t) * cells));
  let left = target - sum(out);
  const order = exact.map((x, i) => ({ r: x - Math.floor(x), i })).sort((a, b) => b.r - a.r);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++;
  return out;
}

/** 칸마다 묶음 번호: [2, 1] → [0, 0, 1]. 격자와 반원이 같이 써요 */
export function ownerOf(counts: readonly number[]): number[] {
  return counts.flatMap((n, k) => Array<number>(n).fill(k));
}

/** 반원 안쪽 반지름 (바깥 반지름 1 기준) */
export const ARC_INNER = 0.38;
/** 반원 와플에 그리는 점의 최대 수. 넘으면 점 하나가 여러 단위예요 (validateSpec too_many_units). 점 반지름 약 1px로 280px 폭에 들어가요 */
export const ARC_MAX_DOTS = 3000;

/** 반원 위 점 하나: r은 바깥 반지름 1 기준 반지름, a는 위쪽 0, 왼쪽 -π/2, 오른쪽 π/2인 각도 */
interface ArcSeat {
  r: number;
  a: number;
}

/**
 * 반원 좌석 배치: 점 n개를 바깥 반지름 1인 반원 여러 줄에 놓아요. 줄 수는 점이 다 들어가는 가장 적은 수(점이 가장 커요)이고,
 * 줄마다 들어가는 수에 비례해 나눠요. 왼쪽부터 각도 순서로 돌려줘서 앞에서부터 묶음을 채우면 묶음마다 부채꼴이 돼요. gap은 줄 사이 간격
 */
export function arcSeats(n: number): { rows: number; gap: number; seats: ArcSeat[] } {
  const gapOf = (k: number) => (1 - ARC_INNER) / Math.max(1, k - 1);
  const radii = (k: number) => Array.from({ length: k }, (_, i) => (k === 1 ? 1 : ARC_INNER + gapOf(k) * i));
  const capsOf = (k: number) => radii(k).map((r) => Math.floor((Math.PI * r) / gapOf(k) + 1e-9) + 1);
  let rows = 1;
  while (sum(capsOf(rows)) < n) rows++;
  const rs = radii(rows);
  const seats: ArcSeat[] = [];
  allocateCells(capsOf(rows), n).forEach((k, i) => {
    for (let j = 0; j < k; j++) seats.push({ r: rs[i], a: k === 1 ? 0 : -Math.PI / 2 + (Math.PI * j) / (k - 1) });
  });
  seats.sort((s, t) => s.a - t.a || s.r - t.r);
  return { rows, gap: gapOf(rows), seats };
}
