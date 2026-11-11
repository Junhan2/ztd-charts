/**
 * 지역 이름 맞추기와 방향키 이웃 (타일 격자 지도, 단계구분도가 같이 써요).
 * 경계 데이터는 없어서 타일 격자 지도가 불러도 커지지 않아요
 */

/** 한글 (지역 이름 언어를 고르거나, 맞는 이름이 없을 때 한국 지도를 고를 때) */
export const HANGUL = /[가-힣ㄱ-ㆎ]/;

/**
 * 이름 맞추기 기준: 유니코드 정규화(NFC), 앞뒤 빈칸 떼기, 안쪽 빈칸 여럿은 하나로, 대소문자 무시.
 * 숫자로만 된 코드는 앞의 0을 떼요 (ISO 숫자 "004"와 4, FIPS "06"과 6이 같아요)
 */
export function normName(s: unknown): string {
  const k = String(s ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return /^\d+$/.test(k) ? k.replace(/^0+(?=\d)/, "") : k;
}

/** 지역마다 받는 이름 목록 → 이름을 지역 번호로 바꾸는 함수. 맞는 지역이 없으면 -1, 이름이 둘 이상의 지역에 있으면 앞 지역이에요 */
export function nameMatcher(keys: readonly (readonly string[])[]): (name: unknown) => number {
  const index = new Map<string, number>();
  keys.forEach((names, i) => {
    for (const n of names) {
      const k = normName(n);
      if (k && !index.has(k)) index.set(k, i);
    }
  });
  return (name) => index.get(normName(name)) ?? -1;
}

/**
 * 후보(지도나 격자)마다 값이 몇 개 맞는지 세서 가장 많이 맞는 후보 번호. 같으면 앞 후보예요.
 * 하나도 맞지 않으면 -1이에요. 값은 같은 것을 한 번만 세요
 */
export function bestMatch(values: readonly unknown[], matchers: readonly ((name: unknown) => number)[]): number {
  // 같은 값은 한 번만 정규화해요 (1만 행이어도 지역 수만큼)
  const names = [...new Set([...new Set(values)].map(normName))].filter(Boolean);
  let best = -1;
  let bestN = 0;
  matchers.forEach((m, i) => {
    const n = names.filter((v) => m(v) >= 0).length;
    if (n > bestN) {
      bestN = n;
      best = i;
    }
  });
  return best;
}

const DIRS: Record<string, [number, number]> = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };

/**
 * 화살표 방향의 가장 가까운 칸 (row, col은 격자 칸이나 화면 좌표). 방향으로 간 거리 + 옆으로 비킨 거리 × 2가 가장 작은 칸이고,
 * 옆으로 비킨 거리가 간 거리보다 크면(45°보다 비스듬하면) 그 방향이 아니라고 봐요. 같으면 앞 칸이에요. 없으면 -1
 */
export function tileNeighbor(tiles: readonly { row: number; col: number }[], from: number, key: string): number {
  const d = DIRS[key];
  const a = tiles[from];
  if (!d || !a) return -1;
  let best = -1;
  let bestScore = Infinity;
  tiles.forEach((b, i) => {
    const along = (b.row - a.row) * d[0] + (b.col - a.col) * d[1];
    const across = Math.abs(d[0] ? b.col - a.col : b.row - a.row);
    if (along <= 0 || across > along) return;
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
