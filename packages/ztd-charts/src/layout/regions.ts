/**
 * Region name matching and arrow-key neighbors (shared by the tile grid map and the choropleth).
 * It holds no boundary data, so importing it does not enlarge the tile grid map
 */

/** Hangul (for picking the language of region names, and for picking the Korea map when no names match) */
export const HANGUL = /[가-힣ㄱ-ㆎ]/;

/**
 * Name matching rule: Unicode normalization (NFC), trimmed ends, inner runs of spaces collapsed to one, case ignored.
 * All-digit codes lose their leading zeros (ISO numeric "004" equals 4, FIPS "06" equals 6)
 */
export function normName(s: unknown): string {
  const k = String(s ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return /^\d+$/.test(k) ? k.replace(/^0+(?=\d)/, "") : k;
}

/** List of accepted names per region → a function that maps a name to a region index. -1 when no region matches; when a name belongs to two or more regions, the earlier region wins */
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
 * Counts how many values match each candidate (map or grid) and returns the index of the best match. On a tie, the earlier candidate.
 * -1 when nothing matches. Each distinct value is counted once
 */
export function bestMatch(values: readonly unknown[], matchers: readonly ((name: unknown) => number)[]): number {
  // Each distinct value is normalized once (only about as many as there are regions, even for 10,000 rows)
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
 * Nearest cell in the arrow direction (row and col are grid cells or screen coordinates). It is the cell with the smallest distance along the direction + sideways offset × 2;
 * a cell whose sideways offset exceeds the distance along the direction (more oblique than 45°) is not in that direction. On a tie, the earlier cell. -1 when there is none
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
