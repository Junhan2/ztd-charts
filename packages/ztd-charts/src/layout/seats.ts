import { sum } from "../core/geometry";

/** Splits cells by the largest remainder method: the sum is exactly cells */
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

/** Group index for each cell: [2, 1] → [0, 0, 1]. Shared by the grid and the semicircle */
export function ownerOf(counts: readonly number[]): number[] {
  return counts.flatMap((n, k) => Array<number>(n).fill(k));
}

/** Inner radius of the semicircle (relative to an outer radius of 1) */
export const ARC_INNER = 0.38;
/** Maximum number of dots drawn in a semicircle waffle. Beyond it, one dot stands for several units (validateSpec too_many_units). At a dot radius of about 1px it fits in a 280px width */
export const ARC_MAX_DOTS = 3000;

/** One dot on the semicircle: r is the radius relative to an outer radius of 1, a the angle with 0 at the top, -π/2 at the left and π/2 at the right */
interface ArcSeat {
  r: number;
  a: number;
}

/**
 * Semicircle seat layout: places n dots on several rows of a semicircle with outer radius 1. The row count is the smallest that fits all dots (so the dots are largest),
 * and dots are split across rows in proportion to their capacity. They are returned in angle order from the left, so filling groups from the front gives each group a wedge. gap is the spacing between rows
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
