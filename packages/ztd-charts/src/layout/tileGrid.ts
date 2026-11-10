import { KR_LAYOUTS, KR_MERGED, KR_REGIONS } from "../data/krRegions";

/** 타일 하나. row, col은 0부터 세는 격자 칸이에요 */
export interface TileDef {
  /** 행을 맞출 때와 강조할 때 쓰는 이름. 같은 격자 안에서 겹치지 않아요 */
  id: string;
  /** 타일에 쓰는 이름. 없으면 id */
  label?: string;
  /** 한국어 로캘에서 쓰는 이름 (내장 격자) */
  labelKo?: string;
  row: number;
  col: number;
  /** 행을 맞출 때 같이 받는 이름 */
  aliases?: readonly string[];
}

/** 내장 격자 이름 */
export const TILE_MAPS: readonly string[] = Object.keys(KR_LAYOUTS);

/** 이름 맞추기 기준: 유니코드 정규화(NFC), 앞뒤 빈칸 떼기, 대소문자 무시 */
export function normName(s: unknown): string {
  return String(s ?? "")
    .normalize("NFC")
    .trim()
    .toLowerCase();
}

const builtins = new Map<string, TileDef[]>();

/** 내장 격자의 타일. 고정 데이터라 이름마다 한 번만 만들어요 (같은 배열을 돌려주니 고치지 마세요). 모르는 이름이면 null */
function builtinGrid(name: string): TileDef[] | null {
  const layout = Object.hasOwn(KR_LAYOUTS, name) ? KR_LAYOUTS[name] : undefined;
  if (!layout) return null;
  let out = builtins.get(name);
  if (!out) {
    const byId = new Map(KR_REGIONS.map((r) => [r[0], r]));
    const tiles: TileDef[] = [];
    layout.forEach((line, row) =>
      line.split(" ").forEach((id, col) => {
        const r = byId.get(id);
        if (r) tiles.push({ id, label: id, labelKo: r[1], row, col, aliases: r.slice(1) });
      }),
    );
    builtins.set(name, (out = tiles));
  }
  return out;
}

/**
 * 그 격자에서 합쳐져 사라진 지역 이름인지 (kr-sido의 광주, 전남). 합친 지역이 없는 격자면 null.
 * 이름이 이 격자의 타일에 맞지 않을 때만 물어봐요 (나머지 지역은 두 격자에서 이름이 같아요)
 */
export function mergedAway(map: unknown): { before: string; is: (name: unknown) => boolean } | null {
  const m = typeof map === "string" && Object.hasOwn(KR_MERGED, map) ? KR_MERGED[map] : undefined;
  if (!m) return null;
  const match = tileMatcher((builtinGrid(m.before) ?? []).filter((t) => m.ids.includes(t.id)));
  return { before: m.before, is: (name) => match(name) >= 0 };
}

const isCell = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 1000;

/** 사용자 격자의 타일 하나가 쓸 수 있는 꼴인지: id 글자, row, col 0 이상 정수, label 글자, aliases 글자 배열 */
export function isTileDef(t: unknown): t is TileDef {
  if (!t || typeof t !== "object" || Array.isArray(t)) return false;
  const o = t as Record<string, unknown>;
  return typeof o.id === "string" && o.id.trim() !== "" && isCell(o.row) && isCell(o.col) && (o.label === undefined || typeof o.label === "string") && (o.aliases === undefined || (Array.isArray(o.aliases) && o.aliases.every((a) => typeof a === "string")));
}

/** 사용자 격자에서 뺀 타일: 몇 번째인지, 왜인지(꼴이 틀림, id가 겹침, 칸이 겹침), 칸이 겹치면 먼저 그 칸에 있던 타일 id */
export interface DroppedTile {
  index: number;
  reason: "shape" | "id" | "cell";
  other?: string;
}

/**
 * options.map을 타일 목록으로 (읽는 순서: 위 줄부터, 왼쪽부터). 내장 이름이나 타일 배열을 받아요.
 * 사용자 격자는 꼴이 틀린 타일, 앞 타일과 id나 칸이 겹치는 타일을 빼고 onDrop으로 알려요 (validateSpec이 오류로 바꿔요). 모르는 이름이나 꼴이면 null
 */
export function resolveGrid(map: unknown, onDrop?: (d: DroppedTile) => void): TileDef[] | null {
  if (typeof map === "string") return builtinGrid(map);
  if (!Array.isArray(map)) return null;
  const ids = new Set<string>();
  const cells = new Map<string, string>();
  const out: TileDef[] = [];
  map.forEach((t: unknown, index) => {
    if (!isTileDef(t)) return onDrop?.({ index, reason: "shape" });
    const cell = `${t.row},${t.col}`;
    const id = normName(t.id);
    if (ids.has(id)) return onDrop?.({ index, reason: "id" });
    if (cells.has(cell)) return onDrop?.({ index, reason: "cell", other: cells.get(cell) });
    ids.add(id);
    cells.set(cell, t.id);
    out.push({ id: t.id, label: t.label ?? t.id, row: t.row, col: t.col, aliases: t.aliases });
  });
  return out.sort((a, b) => a.row - b.row || a.col - b.col);
}

/** 타일이 받는 모든 이름 (id, 이름, 한국어 이름, aliases) */
export function tileNames(t: TileDef): string[] {
  return [t.id, t.label, t.labelKo, ...(t.aliases ?? [])].filter((n): n is string => typeof n === "string" && n !== "");
}

/** 이름 → 타일 번호. 맞는 타일이 없으면 -1이에요. 이름이 둘 이상의 타일에 있으면 앞 타일이에요 */
export function tileMatcher(tiles: readonly TileDef[]): (name: unknown) => number {
  const index = new Map<string, number>();
  tiles.forEach((t, i) => {
    for (const n of tileNames(t)) {
      const k = normName(n);
      if (!index.has(k)) index.set(k, i);
    }
  });
  return (name) => index.get(normName(name)) ?? -1;
}

const DIRS: Record<string, [number, number]> = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };

/**
 * 화살표 방향의 가장 가까운 타일 (빈 칸은 건너뛰어요). 방향으로 간 거리 + 옆으로 비킨 거리 × 2가 가장 작은 타일이고,
 * 옆으로 비킨 거리가 간 거리보다 크면(45°보다 비스듬하면) 그 방향이 아니라고 봐요. 같으면 앞 타일(읽는 순서)이에요. 없으면 -1
 */
export function tileNeighbor(tiles: readonly Pick<TileDef, "row" | "col">[], from: number, key: string): number {
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
