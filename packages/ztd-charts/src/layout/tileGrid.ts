import { KR_LAYOUTS, KR_MERGED, KR_REGIONS } from "../data/krRegions";
import { US_LAYOUT, US_STATES, usStateKeys } from "../data/usStates";
import { bestMatch, HANGUL, nameMatcher, normName } from "./regions";

export { tileNeighbor } from "./regions";

/** 타일 하나. row, col은 0부터 세는 격자 칸이에요 */
export interface TileDef {
  /** 행을 맞출 때와 강조할 때 쓰는 이름. 같은 격자 안에서 겹치지 않아요 */
  id: string;
  /** 타일에 쓰는 이름. 없으면 id */
  label?: string;
  /** 한국어 로캘에서 쓰는 이름 (내장 격자) */
  labelKo?: string;
  /** 타일 위에만 쓰는 짧은 이름 (미국 격자의 "CA"). 툴팁과 표는 label이에요 */
  abbr?: string;
  row: number;
  col: number;
  /** 행을 맞출 때 같이 받는 이름 */
  aliases?: readonly string[];
}

/** 내장 격자 이름 */
export const TILE_MAPS: readonly string[] = ["us-states", "kr-sido", "kr-sido-2025"];
/** "auto"가 고르는 격자 (데이터 값이 가장 많이 맞는 격자, 같으면 앞). kr-sido-2025는 이름을 정했을 때만 써요 */
const AUTO_GRIDS = ["us-states", "kr-sido"];

const builtins = new Map<string, TileDef[]>();

/** 내장 격자의 배치(줄마다 빈칸으로 나눈 id, "-"는 빈 칸)와 id → 타일 내용 */
function builtinSource(name: string): { layout: readonly string[]; tile: (id: string) => Omit<TileDef, "row" | "col"> | undefined } | null {
  if (name === "us-states") {
    const byId = new Map(US_STATES.map((s) => [s[0], s]));
    return {
      layout: US_LAYOUT,
      tile: (id) => {
        const s = byId.get(id);
        return s && { id, label: s[1], abbr: id, aliases: usStateKeys(s) };
      },
    };
  }
  const layout = Object.hasOwn(KR_LAYOUTS, name) ? KR_LAYOUTS[name] : undefined;
  if (!layout) return null;
  const byId = new Map(KR_REGIONS.map((r) => [r[0], r]));
  return {
    layout,
    tile: (id) => {
      const r = byId.get(id);
      return r && { id, label: id, labelKo: r[1], aliases: r.slice(1) };
    },
  };
}

/** 내장 격자의 타일. 고정 데이터라 이름마다 한 번만 만들어요 (같은 배열을 돌려주니 고치지 마세요). 모르는 이름이면 null */
function builtinGrid(name: string): TileDef[] | null {
  let out = builtins.get(name);
  if (out) return out;
  const src = builtinSource(name);
  if (!src) return null;
  const tiles: TileDef[] = [];
  src.layout.forEach((line, row) =>
    line.split(" ").forEach((id, col) => {
      const t = src.tile(id);
      if (t) tiles.push({ ...t, row, col });
    }),
  );
  builtins.set(name, (out = tiles));
  return out;
}

/**
 * "auto"가 고른 내장 격자 이름: 지역 값이 가장 많이 맞는 격자(us-states, kr-sido 순서로 같으면 앞).
 * 하나도 맞지 않으면 us-states인데, 값에 한글이 있으면 kr-sido예요 (잘못 쓴 시도 이름도 예전처럼 한국 격자에서 가까운 이름을 권해요)
 */
function detectGrid(values: readonly unknown[]): string {
  const k = bestMatch(values, AUTO_GRIDS.map((g) => tileMatcher(builtinGrid(g) ?? [])));
  if (k >= 0) return AUTO_GRIDS[k];
  return values.some((v) => HANGUL.test(String(v ?? ""))) ? "kr-sido" : "us-states";
}

/** options.map 값을 격자 이름이나 타일 배열로: 없거나 "auto"면 데이터로 고른 내장 격자 */
export function gridName(map: unknown, values: () => readonly unknown[]): unknown {
  return map === undefined || map === "auto" ? detectGrid(values()) : map;
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

/** 타일이 받는 모든 이름 (id, 이름, 한국어 이름, 짧은 이름, aliases) */
export function tileNames(t: TileDef): string[] {
  return [t.id, t.label, t.labelKo, t.abbr, ...(t.aliases ?? [])].filter((n): n is string => typeof n === "string" && n !== "");
}

/** 이름 → 타일 번호. 맞는 타일이 없으면 -1이에요. 이름이 둘 이상의 타일에 있으면 앞 타일이에요 */
export function tileMatcher(tiles: readonly TileDef[]): (name: unknown) => number {
  return nameMatcher(tiles.map(tileNames));
}
