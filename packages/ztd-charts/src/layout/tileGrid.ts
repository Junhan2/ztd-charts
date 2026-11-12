import { KR_LAYOUTS, KR_MERGED, KR_REGIONS } from "../data/krRegions";
import { US_LAYOUT, US_STATES, usStateKeys } from "../data/usStates";
import { bestMatch, HANGUL, nameMatcher, normName } from "./regions";

export { tileNeighbor } from "./regions";

/** One tile. row and col are grid cells counted from 0 */
export interface TileDef {
  /** Name used to match rows and to highlight. Unique within a grid */
  id: string;
  /** Name written on the tile. Defaults to id */
  label?: string;
  /** Name used in the Korean locale (built-in grids) */
  labelKo?: string;
  /** Short name written only on the tile ("CA" in the US grid). Tooltips and the table use label */
  abbr?: string;
  row: number;
  col: number;
  /** Other names accepted when matching rows */
  aliases?: readonly string[];
}

/** Names of the built-in grids */
export const TILE_MAPS: readonly string[] = ["us-states", "kr-sido", "kr-sido-2025"];
/** Grids "auto" picks from (the grid matching the most data values; on a tie, the earlier one). kr-sido-2025 is used only when named explicitly */
const AUTO_GRIDS = ["us-states", "kr-sido"];

const builtins = new Map<string, TileDef[]>();

/** A built-in grid's layout (space-separated ids per row, "-" for an empty cell) and its id → tile content mapping */
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

/** Tiles of a built-in grid. Fixed data, so they are built once per name (the same array is returned, so do not modify it). null for an unknown name */
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
 * Name of the built-in grid "auto" picks: the grid matching the most region values (in the order us-states, kr-sido; on a tie, the earlier one).
 * When nothing matches it is us-states, but kr-sido when the values contain Hangul (so misspelled province names still get close-name suggestions from the Korean grid, as before)
 */
function detectGrid(values: readonly unknown[]): string {
  const k = bestMatch(values, AUTO_GRIDS.map((g) => tileMatcher(builtinGrid(g) ?? [])));
  if (k >= 0) return AUTO_GRIDS[k];
  return values.some((v) => HANGUL.test(String(v ?? ""))) ? "kr-sido" : "us-states";
}

/** Resolves options.map to a grid name or a tile array: when absent or "auto", the built-in grid picked from the data */
export function gridName(map: unknown, values: () => readonly unknown[]): unknown {
  return map === undefined || map === "auto" ? detectGrid(values()) : map;
}

/**
 * Whether a name belongs to a region merged away in that grid (Gwangju and Jeonnam in kr-sido). null for a grid without merged regions.
 * Ask only when a name matches no tile of this grid (all other regions have the same names in both grids)
 */
export function mergedAway(map: unknown): { before: string; is: (name: unknown) => boolean } | null {
  const m = typeof map === "string" && Object.hasOwn(KR_MERGED, map) ? KR_MERGED[map] : undefined;
  if (!m) return null;
  const match = tileMatcher((builtinGrid(m.before) ?? []).filter((t) => m.ids.includes(t.id)));
  return { before: m.before, is: (name) => match(name) >= 0 };
}

const isCell = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 1000;

/** Whether one tile of a user grid has a usable shape: a string id, row and col as integers of 0 or more, a string label, an aliases array of strings */
export function isTileDef(t: unknown): t is TileDef {
  if (!t || typeof t !== "object" || Array.isArray(t)) return false;
  const o = t as Record<string, unknown>;
  return typeof o.id === "string" && o.id.trim() !== "" && isCell(o.row) && isCell(o.col) && (o.label === undefined || typeof o.label === "string") && (o.aliases === undefined || (Array.isArray(o.aliases) && o.aliases.every((a) => typeof a === "string")));
}

/** A tile dropped from a user grid: its position, the reason (bad shape, duplicate id, duplicate cell) and, for a duplicate cell, the id of the tile already in that cell */
export interface DroppedTile {
  index: number;
  reason: "shape" | "id" | "cell";
  other?: string;
}

/**
 * Turns options.map into a tile list (in reading order: top row first, left first). Accepts a built-in name or a tile array.
 * For a user grid, tiles with a bad shape, or whose id or cell duplicates an earlier tile, are dropped and reported through onDrop (validateSpec turns them into errors). null for an unknown name or shape
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

/** Every name a tile accepts (id, name, Korean name, short name, aliases) */
export function tileNames(t: TileDef): string[] {
  return [t.id, t.label, t.labelKo, t.abbr, ...(t.aliases ?? [])].filter((n): n is string => typeof n === "string" && n !== "");
}

/** Name → tile index. -1 when no tile matches. When a name belongs to two or more tiles, the earlier tile wins */
export function tileMatcher(tiles: readonly TileDef[]): (name: unknown) => number {
  return nameMatcher(tiles.map(tileNames));
}
