import { polar, TAU } from "../core/geometry";

export interface ChordGroup {
  index: number;
  a0: number;
  a1: number;
  value: number;
}

export interface ChordEnd {
  index: number;
  sub: number;
  a0: number;
  a1: number;
  value: number;
}

export interface Chord {
  source: ChordEnd;
  target: ChordEnd;
}

/**
 * 코드 다이어그램 배치. 마디마다 상대와 주고받은 합(보낸 값 + 받은 값, 자기 자신은 한 번)에 비례한 각도라서,
 * 받기만 하는 마디도 호가 생겨요. 칸의 value 는 한쪽 방향 값 그대로예요(툴팁의 보낸·받은 값).
 */
export function chordLayout(matrix: readonly (readonly number[])[], padAngle = 0.04): { groups: ChordGroup[]; chords: Chord[] } {
  const n = matrix.length;
  const at = (i: number, j: number) => Math.max(0, matrix[i]?.[j] || 0);
  const pair = (i: number, j: number) => at(i, j) + (i === j ? 0 : at(j, i));
  const size = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => pair(i, j)).reduce((a, b) => a + b, 0));
  const total = size.reduce((a, b) => a + b, 0);
  const pad = Math.min(padAngle, n ? (TAU * 0.5) / n : 0);
  const k = total > 0 ? Math.max(0, TAU - pad * n) / total : 0;
  const groups: ChordGroup[] = [];
  const sub: ChordEnd[][] = Array.from({ length: n }, () => []);
  let x = 0;
  for (let i = 0; i < n; i++) {
    const g0 = x;
    for (let j = 0; j < n; j++) {
      const s0 = x;
      x += pair(i, j) * k;
      sub[i][j] = { index: i, sub: j, a0: s0, a1: x, value: at(i, j) };
    }
    groups.push({ index: i, a0: g0, a1: x, value: size[i] });
    x += pad;
  }
  const chords: Chord[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const a = sub[i][j];
      const b = sub[j][i];
      if (a.value <= 0 && b.value <= 0) continue;
      chords.push(a.value >= b.value ? { source: a, target: b } : { source: b, target: a });
    }
  }
  return { groups, chords };
}

/** 리본 path: 두 호를 가운데를 지나는 2차 곡선으로 이어요 */
export function ribbonPath(cx: number, cy: number, r: number, s0: number, s1: number, t0: number, t1: number): string {
  const p = (a: number) => polar(cx, cy, r, a);
  const f = (n: number) => Math.round(n * 100) / 100;
  const [sx0, sy0] = p(s0);
  const [sx1, sy1] = p(s1);
  const [tx0, ty0] = p(t0);
  const [tx1, ty1] = p(t1);
  const largeS = s1 - s0 > Math.PI ? 1 : 0;
  const largeT = t1 - t0 > Math.PI ? 1 : 0;
  const same = s0 === t0 && s1 === t1;
  let d = `M${f(sx0)},${f(sy0)}A${f(r)},${f(r)} 0 ${largeS} 1 ${f(sx1)},${f(sy1)}`;
  if (same) {
    d += `Q${f(cx)},${f(cy)} ${f(sx0)},${f(sy0)}Z`;
    return d;
  }
  d += `Q${f(cx)},${f(cy)} ${f(tx0)},${f(ty0)}A${f(r)},${f(r)} 0 ${largeT} 1 ${f(tx1)},${f(ty1)}Q${f(cx)},${f(cy)} ${f(sx0)},${f(sy0)}Z`;
  return d;
}
