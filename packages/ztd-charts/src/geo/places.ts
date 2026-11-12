import { nameMatcher, normName } from "../layout/regions";
import { geojsonShapes, mapShapes } from "./codec";
import { ALBERS_INSETS, autoProjection, lonLatBox } from "./projection";
import { chooseMap, getMap, isGeoMap, mapMatcher, registeredMaps, type MapChoice } from "./registry";
import type { GeoJSONFeatureCollection, GeoMap, GeoShape } from "./types";

/*
 * Placement shared by the maps that place points (symbol map, flow map). It looks only at longitudes, latitudes and region labels, without projecting borders,
 * so validateSpec reports "outside the map" by the same rule as the chart (and the validator bundle carries no projection math)
 */

/** A longitude/latitude box that accepts points [west, south, east, north]. The east edge can exceed 180 (a box crossing the date line). id is the box's projection piece ("AK", "HI" in the US) */
export interface DomainBox {
  box: readonly [number, number, number, number];
  id?: string;
}

/** What placing points on a map needs: the accepting boxes, the drawn region indexes, region name matching, and the regions */
export interface PlaceDomain {
  boxes: readonly DomainBox[];
  /** Indexes of the drawn regions (excluding hidden regions, regions outside the focused group, and regions without geometry) */
  shown: ReadonlySet<number>;
  match: (name: unknown) => number;
  shapes: readonly GeoShape[];
}

export interface DomainOptions {
  focus?: string;
  featureId?: string;
  featureName?: string;
}

const cache = /* @__PURE__ */ new WeakMap<object, Map<string, PlaceDomain>>();

/** Pads the box by 5% of its width and height (at least 0.5°). Latitude stays within ±90 */
function padBox(b: readonly number[]): [number, number, number, number] {
  const dx = Math.max(0.5, (b[2] - b[0]) * 0.05);
  const dy = Math.max(0.5, (b[3] - b[1]) * 0.05);
  return [b[0] - dx, Math.max(-90, b[1] - dy), b[2] + dx, Math.min(90, b[3] + dy)];
}

/**
 * Where a map accepts points. A focused group uses its box as is; a world projection (Equal Earth) map takes every longitude and the latitude range of the drawn regions (Antarctica is excluded, so below about 60° south is outside);
 * other maps (conic projection, GeoJSON) take the drawn regions' longitude/latitude box, padded slightly. albersUsa keeps separate boxes for the mainland, Alaska and Hawaii (one per inset piece)
 */
export function placeDomain(source: GeoMap | GeoJSONFeatureCollection, opts: DomainOptions = {}): PlaceDomain {
  const key = `${opts.focus ?? ""}\u0001${opts.featureId ?? ""}\u0001${opts.featureName ?? ""}`;
  let byKey = cache.get(source);
  const hit = byKey?.get(key);
  if (hit) return hit;
  const geoMap = isGeoMap(source) ? source : null;
  const shapes = geoMap ? mapShapes(geoMap) : geojsonShapes(source as GeoJSONFeatureCollection, opts.featureId, opts.featureName).shapes;
  const hidden = new Set(geoMap?.hidden ?? []);
  const focus = opts.focus !== undefined && geoMap?.focus && Object.hasOwn(geoMap.focus, opts.focus) ? geoMap.focus[opts.focus] : undefined;
  const members = focus ? new Set(focus.ids.split(" ")) : null;
  const shown = new Set<number>();
  shapes.forEach((s, i) => {
    if (s.polygons.length && !hidden.has(s.id) && (!members || members.has(s.id))) shown.add(i);
  });
  const boxes: DomainBox[] = [];
  if (focus) boxes.push({ box: [...focus.box] as [number, number, number, number] });
  else {
    // albersUsa splits pieces by region id (the same ids as makeProjection in projection.ts)
    const groups = new Map<string, GeoShape[]>();
    for (const i of shown) {
      const id = geoMap?.projection === "albersUsa" && ALBERS_INSETS.includes(shapes[i].id) ? shapes[i].id : "";
      const g = groups.get(id);
      if (g) g.push(shapes[i]);
      else groups.set(id, [shapes[i]]);
    }
    for (const [id, list] of groups) {
      const ll = lonLatBox(list);
      if (!ll) continue;
      const wide = (geoMap ? geoMap.projection : autoProjection(ll)) === "equalEarth";
      const b = padBox(ll);
      boxes.push({ box: wide ? [-180, b[1], 180, b[3]] : b, ...(id && { id }) });
    }
  }
  const out: PlaceDomain = { boxes, shown, shapes, match: geoMap ? mapMatcher(geoMap) : nameMatcher(shapes.map((s) => s.keys)) };
  if (!byKey) cache.set(source, (byKey = new Map()));
  byKey.set(key, out);
  return out;
}

/** Whether longitude and latitude are numbers within range (longitude -180 to 180, latitude -90 to 90) */
export function validLonLat(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
}

/** The box that accepts this point (null if none). The longitude is also checked one full turn over (for boxes whose east edge exceeds 180) */
function domainBox(d: PlaceDomain, lon: number, lat: number): DomainBox | null {
  for (const b of d.boxes) {
    const [w, s, e, n] = b.box;
    if (lat < s || lat > n) continue;
    for (const L of [lon, lon + 360, lon - 360]) if (L >= w && L <= e) return b;
  }
  return null;
}

/** One place: a longitude and latitude, or a region name on the map (that region's center) */
export type PlaceInput = { lon: number; lat: number } | { name: unknown };

/** Result of placing: a point (with the accepting box's piece id), a region index, or the reason it cannot be placed */
export type Placed = { lon: number; lat: number; id?: string } | { region: number } | { miss: "invalid" | "outside" | "unmatched" };

/** Places one place on the map. Coordinates must be in range (invalid) and inside the map's accepted area (outside). A name must match a drawn region (unmatched, outside) */
export function placeIn(d: PlaceDomain, p: PlaceInput): Placed {
  if ("name" in p) {
    const k = d.match(p.name);
    if (k < 0) return { miss: "unmatched" };
    return d.shown.has(k) ? { region: k } : { miss: "outside" };
  }
  if (!validLonLat(p.lon, p.lat)) return { miss: "invalid" };
  const b = domainBox(d, p.lon, p.lat);
  return b ? { lon: p.lon, lat: p.lat, ...(b.id && { id: b.id }) } : { miss: "outside" };
}

/** Total area of the boxes (degrees², used to pick the smaller of maps that accept the same count) */
const areaOf = (d: PlaceDomain) => d.boxes.reduce((t, b) => t + (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]), 0);

/**
 * Resolves options.map to a map (for maps that place points). Names, map objects and GeoJSON work as in the choropleth (chooseMap).
 * When missing or "auto", it is the registered map that accepts the most places: coordinates count when they fall in the map's accepted area, names when they match a drawn region.
 * On a tie, the map with the smaller accepted area (kr-sido for Seoul alone, us-states for US cities only), then the map registered first.
 * When no map accepts anything (empty data), world if "world" is registered, otherwise the first map
 */
export function choosePlaceMap(option: unknown, items: () => readonly PlaceInput[]): MapChoice | null {
  if (option !== undefined && option !== "auto") return chooseMap(option, () => []);
  const names = registeredMaps();
  if (!names.length) return { missing: "auto" };
  const list = items();
  // Count each name only once (even with 10,000 rows, matching runs once per distinct name)
  const seen = new Set<string>();
  const unique = list.filter((p) => {
    if (!("name" in p)) return true;
    const k = normName(p.name);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  let best = -1;
  let bestN = 0;
  let bestArea = Infinity;
  names.forEach((name, i) => {
    const d = placeDomain(getMap(name)!);
    let n = 0;
    for (const p of unique) if (!("miss" in placeIn(d, p))) n++;
    const area = areaOf(d);
    if (n > bestN || (n === bestN && n > 0 && area < bestArea)) {
      best = i;
      bestN = n;
      bestArea = area;
    }
  });
  const name = best >= 0 ? names[best] : names.includes("world") ? "world" : names[0];
  return { map: getMap(name)!, name };
}

/**
 * Cap on individually drawn circles (symbol map) and flows (flow map). Even if a spec written by someone else (MCP) brings 100,000 rows, the SVG element count stops here.
 * Beyond it, only this many are drawn, largest values first, and validateSpec reports it (totals, shares and ranks still count everything)
 */
export const MAX_POINTS = 2000;
export const MAX_FLOWS = 1000;

/**
 * Place of one symbol map row: its coordinates when longitude and latitude are both numbers, otherwise its region when a region name is given, otherwise an unplaceable place (NaN).
 * Out-of-range coordinates (latitude 120) are passed through so placeIn reports them as invalid (they do not fall back to the region name)
 */
export function symbolPlace(lon: number, lat: number, region: string): PlaceInput {
  if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat };
  return region.trim() ? { name: region } : { lon: NaN, lat: NaN };
}

/**
 * One entry of options.places ([longitude, latitude], two numbers or numeric strings). null when the name is not there (it is then matched as a region name).
 * When the name is there but malformed, the place is unplaceable (NaN) and does not fall back to the region name (same as bad_place in validateSpec)
 */
export function placeEntry(places: unknown, name: string): { lon: number; lat: number } | null {
  if (!places || typeof places !== "object" || Array.isArray(places) || !Object.hasOwn(places, name)) return null;
  const v = (places as Record<string, unknown>)[name];
  if (!Array.isArray(v) || v.length !== 2) return { lon: NaN, lat: NaN };
  const num = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN);
  return { lon: num(v[0]), lat: num(v[1]) };
}

/** Whether the flow map draws a row: both names present and different, and a value above 0 (the chart, validateSpec and specMapName share this rule) */
export function flowRowOk(s: string, t: string, v: number): boolean {
  return !!s && !!t && s !== t && v > 0 && Number.isFinite(v);
}

/** One flow map place name: its coordinates when listed in options.places, otherwise a region name on the map */
export function flowPlace(places: unknown, name: string): PlaceInput {
  return placeEntry(places, name) ?? { name };
}
