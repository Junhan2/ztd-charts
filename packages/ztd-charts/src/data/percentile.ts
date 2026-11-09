import { quantileSorted } from "../core/geometry";
import { getter, toNumber } from "./accessor";

/** 숫자로 읽히는 값만 작은 것부터 */
const sortedNumbers = (values: readonly unknown[]) => new Float64Array(values.map(toNumber).filter(Number.isFinite)).sort();
const at = (sorted: Float64Array, p: number) => (p >= 0 && p <= 100 ? quantileSorted(sorted, p / 100) : NaN);

/**
 * 값 목록의 p 백분위(0~100). 두 값 사이는 선형 보간해요(엑셀 PERCENTILE.INC, numpy 기본값과 같아요).
 * 숫자로 읽히지 않는 값은 빼고, 남는 값이 없거나 p가 0~100 밖이면 NaN
 */
export function percentile(values: readonly unknown[], p: number): number {
  return at(sortedNumbers(values), p);
}

/** 분위 이름("p95")을 숫자(95)로. "p" 뒤 0~100 숫자가 아니면 NaN이에요. 히스토그램 marks와 스펙 검사가 같이 써요 */
export function markPercentile(id: string): number {
  const m = /^p(\d+(?:\.\d+)?)$/.exec(id);
  const v = m ? Number(m[1]) : NaN;
  return v >= 0 && v <= 100 ? v : NaN;
}

export interface PercentilesOptions {
  /** 묶을 필드. 여러 필드로 묶으려면 배열(예: ["minute", "api"]). 차트 encoding처럼 점 경로도 돼요 */
  by: string | readonly string[];
  /** 백분위를 구할 숫자 필드 */
  value: string;
  /** 구할 백분위(0~100). 기본 [50, 95, 99]. 결과 필드 이름은 p50, p95, p99처럼 "p" 뒤에 숫자예요 */
  p?: readonly number[];
}

/**
 * 행을 by로 묶어 묶음마다 value의 백분위를 구해요. 응답 시간 같은 측정값에서 p95 차트를 바로 그릴 때 써요.
 * 결과는 묶음이 처음 나온 순서대로 { ...by 필드, p50, p95, p99 } 행이라 y={["p50", "p95", "p99"]}로 넘기면 돼요
 */
export function percentiles(rows: readonly Record<string, unknown>[], options: PercentilesOptions): Record<string, unknown>[] {
  const keys: readonly string[] = typeof options.by === "string" ? [options.by] : options.by;
  const reads = keys.map((k) => getter(k, k));
  const read = getter(options.value, options.value);
  const ps = options.p ?? [50, 95, 99];
  const groups = new Map<string, { row: Record<string, unknown>; values: unknown[] }>();
  rows.forEach((r, i) => {
    const ids = reads.map((g) => g(r, i));
    const id = JSON.stringify(ids);
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { row: Object.fromEntries(keys.map((k, j) => [k, ids[j]])), values: [] }));
    g.values.push(read(r, i));
  });
  return [...groups.values()].map(({ row, values }) => {
    const sorted = sortedNumbers(values);
    for (const p of ps) row[`p${p}`] = at(sorted, p);
    return row;
  });
}
