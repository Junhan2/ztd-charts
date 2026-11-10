import type { Highlight } from "./types";

/** 이름 대신 쓰는 강조 낱말 (resolveHighlight가 받는 것과 같아요) */
export const HIGHLIGHT_KEYWORDS: readonly string[] = ["max", "min", "first", "last", "none"];

/**
 * 강조 대상을 인덱스 집합으로.
 * labels: 항목 라벨, values: 비교용 값
 */
export function resolveHighlight<T>(
  h: Highlight<T> | undefined,
  data: readonly T[],
  labels: readonly string[],
  values: readonly number[],
  fallback: "max" | "min" | "first" | "last" | "none" = "max",
): Set<number> {
  const out = new Set<number>();
  const n = labels.length;
  const pick = (mode: string) => {
    if (!n) return;
    if (mode === "none") return;
    if (mode === "first") out.add(0);
    else if (mode === "last") out.add(n - 1);
    else if (mode === "max" || mode === "min") {
      let best = -1;
      let bv = mode === "max" ? -Infinity : Infinity;
      values.forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        if (mode === "max" ? v > bv : v < bv) {
          bv = v;
          best = i;
        }
      });
      if (best >= 0) out.add(best);
    }
  };
  if (h === undefined || h === null) {
    pick(fallback);
    return out;
  }
  if (typeof h === "function") {
    data.forEach((d, i) => {
      // 히트맵의 빈 칸처럼 행이 없는 항목은 판별 함수에 넘기지 않아요
      if (i < n && d !== null && d !== undefined && h(d, i)) out.add(i);
    });
    return out;
  }
  const list = Array.isArray(h) ? h : [h];
  for (const item of list) {
    if (typeof item === "number") {
      if (item >= 0 && item < n) out.add(item);
    } else if (item === "max" || item === "min" || item === "first" || item === "last" || item === "none") pick(item);
    else {
      labels.forEach((l, i) => {
        if (l === item) out.add(i);
      });
    }
  }
  return out;
}
