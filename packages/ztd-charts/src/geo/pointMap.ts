import { formatPercent } from "../core/format";
import type { ChartLang } from "../core/i18n";
import { textWidth } from "../core/text";
import { projectPoint, wrap, type SubProjection } from "./projection";
import type { Placed } from "./places";
import { BUILTIN_MAPS, isGeoMap } from "./registry";
import type { GeoShape } from "./types";
import type { GeoLayout } from "./view";

/*
 * Drawing code shared by the maps that place points (symbol map, flow map): projecting placed points onto the plane, a frame that includes every point, and non-overlapping labels.
 * It uses the projection code, so only the charts import it (the validator uses places.ts only)
 */

/** One place projected onto the plane: plane coordinates (screen coordinates come from geoFrame's fit), longitude and latitude, and the projection piece at that spot */
export interface MapPoint {
  x: number;
  y: number;
  lon: number;
  lat: number;
  sub: SubProjection;
}

const lonLatCenters = /* @__PURE__ */ new WeakMap<GeoShape, [number, number]>();

/**
 * Representative coordinates of a region: the area centroid of the outer ring of its largest polygon (in the longitude/latitude plane). Rings crossing the date line are unwrapped from their first point before measuring.
 * The region's center point (shapeCenter) is used for screen positions; these coordinates are used only to decide whether a flow crosses the date line
 */
export function regionLonLat(s: GeoShape): [number, number] {
  const hit = lonLatCenters.get(s);
  if (hit) return hit;
  let best: [number, number] = [NaN, NaN];
  let bestA = -1;
  for (const poly of s.polygons) {
    const ring = poly[0];
    if (!ring || ring.length < 3) continue;
    const lon0 = ring[0][0];
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = lon0 + wrap(ring[i][0] - lon0);
      const xj = lon0 + wrap(ring[j][0] - lon0);
      const c = xj * ring[i][1] - xi * ring[j][1];
      a += c;
      cx += (xj + xi) * c;
      cy += (ring[j][1] + ring[i][1]) * c;
    }
    if (Math.abs(a) > bestA && a !== 0) {
      bestA = Math.abs(a);
      best = [wrap(cx / (3 * a)), cy / (3 * a)];
    }
  }
  if (bestA < 0) best = s.polygons[0]?.[0]?.[0] ? [s.polygons[0][0][0][0], s.polygons[0][0][0][1]] : [NaN, NaN];
  lonLatCenters.set(s, best);
  return best;
}

/** Center of the world map: "atlantic" has central meridian 0 (antimeridian 180, split in the Pacific), "pacific" has 150 (antimeridian -30, split in the Atlantic) */
export type MapCenter = "auto" | "atlantic" | "pacific";
const CENTER_LON = { atlantic: 0, pacific: 150 } as const;

/** Maps whose center can change: built-in world-projection maps not cropped to a group (focus) */
export function canCenter(source: unknown, focus: string | undefined): boolean {
  const m = isGeoMap(source) ? source : null;
  return !!m && m.projection === "equalEarth" && !(focus !== undefined && m.focus && Object.hasOwn(m.focus, focus));
}

/**
 * Picks the central meridian. "auto" (default) picks whichever of the two centers cuts less: for flows, the total amount whose shorter route crosses the antimeridian; for points, the number within 20° of the antimeridian (the map edge).
 * On a tie, the Atlantic center (0). Each flow and point is looked at only once
 */
export function chooseCenter(option: unknown, flows: readonly { a: number; b: number; w: number }[], lons: readonly number[]): number {
  if (option === "atlantic" || option === "pacific") return CENTER_LON[option];
  const cost = (lon0: number) => {
    let c = 0;
    for (const f of flows) if (Math.abs(wrap(f.b - lon0) - wrap(f.a - lon0)) > 180) c = cap(c + f.w);
    for (const lon of lons) if (Math.abs(wrap(lon - lon0)) > 160) c += 1;
    return c;
  };
  return cost(CENTER_LON.pacific) < cost(CENTER_LON.atlantic) ? CENTER_LON.pacific : CENTER_LON.atlantic;
}

/** Rounds to 0.1px (-0 becomes 0) */
export const r1 = (v: number) => Math.round(v * 10) / 10 || 0;
/** Stops at the largest number so a sum cannot overflow to Infinity (two 1e308s) */
export const cap = (v: number) => Math.min(Number.MAX_VALUE, v);

/** Projects a placed place (placeIn) onto the plane. A region uses its center point (shapeCenter); coordinates use their piece's projection. null when it cannot be placed */
export function planePoint(g: GeoLayout, at: Placed): MapPoint | null {
  if ("miss" in at) return null;
  const albers = g.projection.name === "albersUsa";
  if ("region" in at) {
    const [x, y] = g.centers[at.region] ?? [NaN, NaN];
    const s = g.shapes[at.region];
    const [lon, lat] = regionLonLat(s);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(lon)) return null;
    return { x, y, lon, lat, sub: g.projection.pick(lon, lat, albers ? s.id : undefined) };
  }
  const id = albers ? at.id ?? "" : undefined;
  const [x, y] = projectPoint(g.projection, at.lon, at.lat, id);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, lon: at.lon, lat: at.lat, sub: g.projection.pick(at.lon, at.lat, id) } : null;
}

/** The map box extended by the points, in plane coordinates (so points at sea outside the map still fit in the frame). A focused map keeps its group box (anything outside is clipped) */
export function pointBox(g: GeoLayout, pts: readonly { x: number; y: number }[]): [number, number, number, number] {
  const b: [number, number, number, number] = [g.box[0], g.box[1], g.box[2], g.box[3]];
  if (g.clip) return b;
  for (const p of pts) {
    if (p.x < b[0]) b[0] = p.x;
    if (p.y < b[1]) b[1] = p.y;
    if (p.x > b[2]) b[2] = p.x;
    if (p.y > b[3]) b[3] = p.y;
  }
  return b;
}

/** Label candidate: point position (x, y), point radius, text */
export interface LabelCandidate {
  x: number;
  y: number;
  r: number;
  text: string;
  weight?: number;
}
/** A placed label: the text anchor position (anchor start/end) */
export interface PlacedLabel {
  x: number;
  y: number;
  anchor: "start" | "end" | "middle";
  text: string;
  weight: number;
  /** Candidate index */
  k: number;
}

export type Rect = [number, number, number, number];
const hits = (a: Rect, b: Rect) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/**
 * Non-overlapping labels: takes the candidates in the given order (most important first) and tries the right, left, above and below positions in turn, placing each at the first spot that overlaps no placed label or avoid box,
 * stays within the frame (w × h) and covers no other point (obstacles). A label with no room is dropped.
 * For points stacked on the same spot (within 1px), only the first candidate is labeled. Font size is size
 */
export function placeLabels(cands: readonly LabelCandidate[], w: number, h: number, size: number, avoid: readonly Rect[] = [], obstacles: readonly Rect[] = []): PlacedLabel[] {
  const taken: Rect[] = [...avoid];
  const out: PlacedLabel[] = [];
  const hh = size * 0.62;
  const seen = new Set<string>();
  cands.forEach((c, k) => {
    const at = `${Math.round(c.x)} ${Math.round(c.y)}`;
    if (seen.has(at)) return;
    seen.add(at);
    const weight = c.weight ?? 600;
    const tw = textWidth(c.text, size, weight);
    const gap = c.r + 3;
    const spots: [number, number, PlacedLabel["anchor"], Rect][] = [
      [c.x + gap, c.y, "start", [c.x + gap, c.y - hh, c.x + gap + tw, c.y + hh]],
      [c.x - gap, c.y, "end", [c.x - gap - tw, c.y - hh, c.x - gap, c.y + hh]],
      [c.x, c.y - gap - hh, "middle", [c.x - tw / 2, c.y - gap - 2 * hh, c.x + tw / 2, c.y - gap]],
      [c.x, c.y + gap + hh, "middle", [c.x - tw / 2, c.y + gap, c.x + tw / 2, c.y + gap + 2 * hh]],
    ];
    for (const [x, y, anchor, rect] of spots) {
      if (rect[0] < 1 || rect[1] < 0 || rect[2] > w - 1 || rect[3] > h) continue;
      if (taken.some((t) => hits(t, rect)) || obstacles.some((t) => hits(t, rect))) continue;
      taken.push(rect);
      out.push({ x, y, anchor, text: c.text, weight, k });
      return;
    }
  });
  return out;
}

/** Formats a share (0 to 100) for the locale: one decimal below 10% (9.3%), whole numbers above (25%) */
export function sharePct(v: number, locale: string): string {
  return formatPercent(v, { locale, maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 });
}

/** Message shown when the map is not registered (same text as the choropleth) */
export function mapNotLoaded(name: string, lang: ChartLang): string {
  if (lang === "ko")
    return name === "auto" ? "등록한 지도가 없어요. ztd-charts/geo의 지도를 registerMap에 넘겨 주세요" : BUILTIN_MAPS.includes(name) ? `"${name}" 지도를 등록하지 않았어요. ztd-charts/geo/${name}에서 불러와 registerMap에 넘겨 주세요` : `"${name}" 지도를 등록하지 않았어요. 지도를 registerMap에 넘기거나 ${BUILTIN_MAPS.join(", ")}, GeoJSON을 써 주세요`;
  return name === "auto" ? "No map is registered. Import one from ztd-charts/geo and pass it to registerMap" : BUILTIN_MAPS.includes(name) ? `Map "${name}" is not registered. Import it from ztd-charts/geo/${name} and pass it to registerMap` : `Map "${name}" is not registered. Pass a map to registerMap, or use ${BUILTIN_MAPS.join(", ")} or a GeoJSON`;
}
