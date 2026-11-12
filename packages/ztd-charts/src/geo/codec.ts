import type { GeoJSONFeatureCollection, GeoMap, GeoShape, LonLat } from "./types";

/** Encoding alphabet (same as pack in scripts/build-geo.mjs): 5 bits per character, with the 6th bit meaning the number continues in the next character */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Maximum characters per integer (5 bits × 7 = 35 bits). Beyond that the text is treated as corrupt and the number is dropped */
const MAX_DIGITS = 7;

/** Text → list of integers (zigzag-decoded, so negatives come back too). Characters outside the alphabet are skipped */
function unpack(s: unknown): number[] {
  if (typeof s !== "string") return [];
  const code = new Int8Array(128).fill(-1);
  for (let i = 0; i < 64; i++) code[B64.charCodeAt(i)] = i;
  const out: number[] = [];
  let v = 0;
  let mul = 1;
  let digits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = code[s.charCodeAt(i)] ?? -1;
    if (c < 0) continue;
    v += (c & 31) * mul;
    digits++;
    if (c & 32 && digits < MAX_DIGITS) mul *= 32;
    else {
      if (!(c & 32)) out.push(v % 2 ? -(v + 1) / 2 : v / 2);
      v = 0;
      mul = 1;
      digits = 0;
    }
  }
  return out;
}

const decoded = /* @__PURE__ */ new WeakMap<GeoMap, GeoShape[]>();

/** Accepts only counts that are integers of 0 or more and no larger than the remaining input (so a crafted map cannot cause an endless loop). Otherwise -1 */
const count = (n: unknown, left: number) => (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= left ? n : -1);

/**
 * Regions and borders of a built-in map. Regions share arcs (as in TopoJSON), and each ring is stitched together from its arcs.
 * The data is fixed, so each map is decoded only once (the same array is returned, so do not modify it).
 * Counts read from the data can never exceed the remaining input, and the points built never exceed the arcs' point count × 4. On any mismatch, decoding stops there and uses only what was read so far
 */
export function mapShapes(m: GeoMap): GeoShape[] {
  const hit = decoded.get(m);
  if (hit) return hit;
  const t = Array.isArray(m.topo?.t) ? m.topo.t : [];
  const [step, tx, ty] = t.every((v) => Number.isFinite(v)) && t.length >= 3 ? t : [NaN, NaN, NaN];
  const ok = Number.isFinite(step) && step > 0;
  const a = ok ? unpack(m.topo.arcs) : [];
  const arcs: LonLat[][] = [];
  let total = 0;
  for (let i = 0; i < a.length; ) {
    const n = count(a[i++], (a.length - i) / 2);
    if (n < 0) break;
    const pts: LonLat[] = [];
    let x = 0;
    let y = 0;
    for (let k = 0; k < n; k++) {
      x += a[i++];
      y += a[i++];
      pts.push([x * step + tx, y * step + ty]);
    }
    total += n;
    arcs.push(pts);
  }
  const s = ok ? unpack(m.topo.shapes) : [];
  let j = 0;
  let budget = total * 4;
  const rows = Array.isArray(m.regions) ? m.regions : [];
  const out = rows.map((raw): GeoShape => {
    const row = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
    const polygons: LonLat[][][] = [];
    for (let np = count(s[j++], s.length - j); np > 0; np--) {
      const rings: LonLat[][] = [];
      for (let nr = count(s[j++], s.length - j); nr > 0; nr--) {
        const ring: LonLat[] = [];
        for (let na = count(s[j++], s.length - j), k = 0; k < na; k++) {
          const r = s[j++];
          const pts = (r >= 0 ? arcs[r] : arcs[~r]?.slice().reverse()) ?? [];
          budget -= pts.length;
          if (budget < 0) break;
          for (let q = k ? 1 : 0; q < pts.length; q++) ring.push(pts[q]);
        }
        // Drop the closing point (an end point equal to the first). Paths are closed with Z
        if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
        if (ring.length >= 3) rings.push(ring);
        if (budget < 0 || j > s.length) break;
      }
      if (rings.length) polygons.push(rings);
      if (budget < 0 || j > s.length) break;
    }
    const id = row[0] ?? "";
    const ko = m.namesKo?.[id];
    return { id, name: row[1] ?? id, nameKo: typeof ko === "string" ? ko : undefined, keys: typeof ko === "string" ? [...row, ko] : row, polygons };
  });
  decoded.set(m, out);
  return out;
}

/** Limits for GeoJSON received in a spec: feature count and coordinate count (the MCP server renders specs written by others). GeoJSON passed in from code is not limited */
export const GEOJSON_LIMITS = { features: 20_000, points: 1_000_000 };

/** Counts a GeoJSON's features and coordinates without building new arrays (stops once a limit is exceeded) */
export function geojsonSize(fc: GeoJSONFeatureCollection): { features: number; points: number } {
  const features = Array.isArray(fc.features) ? fc.features : [];
  let points = 0;
  for (const f of features) {
    const g = f && typeof f === "object" ? f.geometry : null;
    const c = g && Array.isArray(g.coordinates) ? (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []) : [];
    for (const poly of c as unknown[]) if (Array.isArray(poly)) for (const ring of poly) if (Array.isArray(ring)) points += ring.length;
    if (points > GEOJSON_LIMITS.points) break;
  }
  return { features: features.length, points };
}

/** Result of turning GeoJSON into a region list: indexes of features dropped for having no drawable geometry, and the count of out-of-range coordinates (latitude is clamped to ±90, longitude is wrapped) */
export interface GeoJSONShapes {
  shapes: GeoShape[];
  skipped: number[];
  outOfRange: number;
}

const textOf = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined);

/** One ring: only points made of two numbers, latitude clamped within ±90, consecutive duplicates and the closing point removed. null with fewer than 3 points */
function cleanRing(raw: unknown, bad: { n: number }): LonLat[] | null {
  if (!Array.isArray(raw)) return null;
  const out: LonLat[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number" || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    let [lon, lat] = p as [number, number];
    if (lat > 90 || lat < -90 || lon > 540 || lon < -540) {
      bad.n++;
      lat = Math.max(-90, Math.min(90, lat));
      lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    } else if (lon > 180 || lon < -180) bad.n++;
    const last = out[out.length - 1];
    if (!last || last[0] !== lon || last[1] !== lat) out.push([lon, lat]);
  }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out.length >= 3 ? out : null;
}

/**
 * Turns a GeoJSON FeatureCollection (longitude and latitude in degrees) into a region list. Only Polygon and MultiPolygon are drawn; polygons without an outer ring and features without geometry are dropped.
 * The id comes from the idKey property, feature.id, then the id and code properties; the name from the nameKey property, then the name and NAME properties. Without them, the feature's position (from 1)
 */
export function geojsonShapes(fc: GeoJSONFeatureCollection, idKey?: string, nameKey?: string): GeoJSONShapes {
  // Read once per object and property names, so the validator and the chart do not read the same GeoJSON twice
  const key = `${idKey ?? ""}\u0001${nameKey ?? ""}`;
  let byKey = read.get(fc);
  const hit = byKey?.get(key);
  if (hit) return hit;
  const out = readGeojson(fc, idKey, nameKey);
  if (!byKey) read.set(fc, (byKey = new Map()));
  byKey.set(key, out);
  return out;
}

const read = /* @__PURE__ */ new WeakMap<object, Map<string, GeoJSONShapes>>();

function readGeojson(fc: GeoJSONFeatureCollection, idKey?: string, nameKey?: string): GeoJSONShapes {
  const shapes: GeoShape[] = [];
  const skipped: number[] = [];
  const bad = { n: 0 };
  (Array.isArray(fc.features) ? fc.features : []).forEach((f, i) => {
    const props = (f && typeof f.properties === "object" && f.properties) || {};
    const g = f?.geometry;
    const coords = g && Array.isArray(g.coordinates) ? (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []) : [];
    const polygons: LonLat[][][] = [];
    for (const poly of coords as unknown[]) {
      if (!Array.isArray(poly)) continue;
      const outer = cleanRing(poly[0], bad);
      if (!outer) continue;
      polygons.push([outer, ...poly.slice(1).map((r) => cleanRing(r, bad)).filter((r): r is LonLat[] => r !== null)]);
    }
    // A feature with no drawable geometry is not a region (rows for it are reported as unmatched rows)
    if (!polygons.length) return void skipped.push(i);
    const id = (idKey ? textOf(props[idKey]) : undefined) ?? textOf(f?.id) ?? textOf(props.id) ?? textOf(props.code) ?? String(i + 1);
    const name = (nameKey ? textOf(props[nameKey]) : undefined) ?? textOf(props.name) ?? textOf(props.NAME) ?? id;
    shapes.push({ id, name, keys: [...new Set([id, name, textOf(f?.id)].filter((k): k is string => !!k))], polygons });
  });
  return { shapes, skipped, outOfRange: bad.n };
}
