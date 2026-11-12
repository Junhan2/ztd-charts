import type { GeoShape, LonLat, ProjectionName } from "./types";

/** π / 180 (written as a value: a top-level computation could stay in bundles that do not use it) */
const RAD = 0.017453292519943295;
/** Wrapped longitude (-180 to 180 relative to lon0) */
export const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Longitude and latitude in radians → plane of the unit sphere (y up) */
type Raw = (lam: number, phi: number) => [number, number];

/** Equal Earth (Šavrič, Patterson, Jenny 2018): an equal-area world projection with less distorted continent shapes */
const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
// √3 / 2. Calling Math.sqrt at the top level would leave it in the bundles of charts that use no map
const M = 0.8660254037844386;
const equalEarthRaw: Raw = (lam, phi) => {
  const l = Math.asin(M * Math.sin(phi));
  const l2 = l * l;
  const l6 = l2 * l2 * l2;
  return [(lam * Math.cos(l)) / (M * (A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2))), l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2))];
};

/** Albers equal-area conic projection (two standard parallels, in degrees). When the parallels straddle the equator so n is near 0, it becomes the Lambert cylindrical equal-area projection */
function conicRaw(lat1: number, lat2: number): Raw {
  const s1 = Math.sin(lat1 * RAD);
  const n = (s1 + Math.sin(lat2 * RAD)) / 2;
  if (Math.abs(n) < 1e-3) return (lam, phi) => [lam, Math.sin(phi)];
  const c = 1 + s1 * (2 * n - s1);
  const r0 = Math.sqrt(c) / n;
  return (lam, phi) => {
    const r = Math.sqrt(Math.max(0, c - 2 * n * Math.sin(phi))) / n;
    return [r * Math.sin(lam * n), r0 - r * Math.cos(lam * n)];
  };
}

/** One projection piece: central meridian (lon0), center point, scale, offset. Alaska and Hawaii in the US are separately scaled and moved pieces */
export interface SubProjection {
  lon0: number;
  /** Longitude wrapped around lon0 and latitude (degrees) → plane [x, y] (y down) */
  raw: (lam: number, lat: number) => [number, number];
}

function sub(lon0: number, raw: Raw, center: LonLat = [0, 0], scale = 1, offset: [number, number] = [0, 0]): SubProjection {
  const [cx, cy] = raw(center[0] * RAD, center[1] * RAD);
  return {
    lon0,
    raw: (lam, lat) => {
      const [x, y] = raw(lam * RAD, Math.max(-90, Math.min(90, lat)) * RAD);
      return [scale * (x - cx) + offset[0], -scale * (y - cy) + offset[1]];
    },
  };
}

/** Region ids of the separately scaled and moved pieces in albersUsa (shared by makeProjection's pick and the accepting boxes of point maps) */
export const ALBERS_INSETS: readonly string[] = ["AK", "HI"];

/** Projection: picks which piece a point (and region id) goes to. Given a region id, it is the piece that region uses (Alaska "AK", Hawaii "HI") */
export interface Projection {
  name: ProjectionName;
  pick: (lon: number, lat: number, id?: string) => SubProjection;
}

/** [longitude, latitude] → unit plane [x, y] (y down). Used to place other points with the same projection as the base map */
export function projectPoint(p: Projection, lon: number, lat: number, id?: string): [number, number] {
  const s = p.pick(lon, lat, id);
  return s.raw(wrap(lon - s.lon0), lat);
}

/**
 * Builds a projection. equalEarth uses lon0 as its central meridian; conic centers on the box [west, south, east, north] and puts the standard parallels at 1/6 and 5/6 of the box height.
 * albersUsa places the 48 mainland states (29.5°, 45.5°), Alaska (0.35x) and Hawaii where d3-geo's geoAlbersUsa does
 */
export function makeProjection(name: ProjectionName, lon0 = 0, box?: readonly number[]): Projection {
  if (name === "albersUsa") {
    const lower = sub(-96, conicRaw(29.5, 45.5), [-0.6, 38.7]);
    const alaska = sub(-154, conicRaw(55, 65), [-2, 58.5], 0.35, [-0.307, 0.201]);
    const hawaii = sub(-157, conicRaw(8, 18), [-3, 19.9], 1, [-0.205, 0.212]);
    return {
      name,
      pick: (lon, lat, id) => {
        if (id !== undefined) return id === "AK" ? alaska : id === "HI" ? hawaii : lower;
        if (lat >= 50 && (lon <= -129 || lon >= 170)) return alaska;
        return lat >= 18 && lat <= 23 && lon >= -161 && lon <= -154 ? hawaii : lower;
      },
    };
  }
  if (name === "conic" && box) {
    const [, s, , n] = box;
    const one = sub(lon0, conicRaw(s + (n - s) / 6, s + ((n - s) * 5) / 6), [0, (s + n) / 2]);
    return { name, pick: () => one };
  }
  const one = sub(lon0, equalEarthRaw);
  return { name: "equalEarth", pick: () => one };
}

/**
 * Longitude/latitude box of the regions [west, south, east, north]. Longitude is cut at the widest empty gap, so regions crossing the date line (Fiji, the Aleutians) still get a narrow box.
 * The east edge can exceed 180. null when there are no points
 */
export function lonLatBox(shapes: readonly GeoShape[]): [number, number, number, number] | null {
  const lons: number[] = [];
  let s = Infinity;
  let n = -Infinity;
  for (const sh of shapes)
    for (const poly of sh.polygons)
      for (const [lon, lat] of poly[0]) {
        lons.push(wrap(lon));
        if (lat < s) s = lat;
        if (lat > n) n = lat;
      }
  if (!lons.length) return null;
  lons.sort((a, b) => a - b);
  let gap = lons[0] + 360 - lons[lons.length - 1];
  let west = lons[0];
  for (let i = 1; i < lons.length; i++) {
    if (lons[i] - lons[i - 1] > gap) {
      gap = lons[i] - lons[i - 1];
      west = lons[i];
    }
  }
  return [west, s, west + 360 - gap, n];
}

/** Projection name that suits this box: the world projection when wider than 150° of longitude or 70° of latitude, otherwise the conic projection */
export function autoProjection(box: readonly number[]): ProjectionName {
  return box[2] - box[0] > 150 || box[3] - box[1] > 70 ? "equalEarth" : "conic";
}

/** Cuts a ring at the vertical line x = at and keeps only the keep side (1: right, -1: left) (Sutherland-Hodgman, one half-plane) */
function clipSide(ring: LonLat[], at: number, keep: 1 | -1): LonLat[] {
  const out: LonLat[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ina = (a[0] - at) * keep >= 0;
    const inb = (b[0] - at) * keep >= 0;
    if (ina) out.push(a);
    if (ina !== inb) out.push([at, a[1] + ((b[1] - a[1]) * (at - a[0])) / (b[0] - a[0])]);
  }
  return out;
}

/**
 * Cuts a ring wrapped around the central meridian at ±180° (the antimeridian). With an even number of crossings, it unwraps the longitudes, cuts at ±180 and moves the far piece across;
 * with an odd number (a ring enclosing a pole, Antarctica), it inserts points that run from the break down to the pole and back. A ring that does not cross is returned as is
 */
export function cutRing(ring: LonLat[]): LonLat[][] {
  let jumps = 0;
  let at = -1;
  for (let i = 0; i < ring.length; i++) {
    if (Math.abs(ring[i][0] - ring[(i + ring.length - 1) % ring.length][0]) > 180) {
      jumps++;
      if (at < 0) at = i;
    }
  }
  if (!jumps) return [ring];
  if (jumps % 2) {
    const a = ring[(at + ring.length - 1) % ring.length];
    const b = ring[at];
    const side = a[0] > 0 ? 180 : -180;
    const span = 360 - Math.abs(a[0] - b[0]);
    const lat = a[1] + ((b[1] - a[1]) * (Math.abs(side - a[0]) || 0)) / (span || 1);
    const pole = ring.reduce((t, p) => t + p[1], 0) < 0 ? -90 : 90;
    return [[...ring.slice(0, at), [side, lat], [side, pole], [-side, pole], [-side, lat], ...ring.slice(at)]];
  }
  const un: LonLat[] = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    let lon = ring[i][0];
    const prev = un[i - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    un.push([lon, ring[i][1]]);
  }
  const out: LonLat[][] = [];
  for (const k of [-1, 0, 1]) {
    const piece = clipSide(clipSide(un, k * 360 - 180, 1), k * 360 + 180, -1);
    // A ring that only touches the meridian leaves a zero-area piece (drawing it would leave a line at the map edge)
    let area = 0;
    for (let i = 0, j = piece.length - 1; i < piece.length; j = i++) area += (piece[j][0] - piece[i][0]) * (piece[j][1] + piece[i][1]);
    if (piece.length >= 3 && Math.abs(area) > 1e-9) out.push(k ? piece.map(([x, y]) => [x - k * 360, y] as LonLat) : piece);
  }
  return out;
}

/** One projected region: plane points per ring [x0, y0, x1, y1 ...], each ring's polygon index and whether it is an outer ring, and the box */
export interface ProjectedShape {
  rings: Float64Array[];
  poly: number[];
  outer: boolean[];
  box: [number, number, number, number];
}

/** Cuts a region's rings for its projection piece and projects them onto the plane. The piece is picked by region id (albersUsa) */
export function projectShape(p: Projection, shape: GeoShape): ProjectedShape {
  const rings: Float64Array[] = [];
  const polyOf: number[] = [];
  const outer: boolean[] = [];
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  shape.polygons.forEach((poly, pi) =>
    poly.forEach((ring, ri) => {
      const s = p.pick(ring[0][0], ring[0][1], p.name === "albersUsa" ? shape.id : undefined);
      for (const piece of cutRing(ring.map(([lon, lat]) => [wrap(lon - s.lon0), lat] as LonLat))) {
        const xy = new Float64Array(piece.length * 2);
        piece.forEach(([lam, lat], i) => {
          const [x, y] = s.raw(lam, lat);
          xy[i * 2] = x;
          xy[i * 2 + 1] = y;
          if (x < box[0]) box[0] = x;
          if (y < box[1]) box[1] = y;
          if (x > box[2]) box[2] = x;
          if (y > box[3]) box[3] = y;
        });
        rings.push(xy);
        polyOf.push(pi);
        outer.push(ri === 0);
      }
    }),
  );
  return { rings, poly: polyOf, outer, box };
}

/** Plane box of the projected outline of a longitude/latitude box [west, south, east, north] (24 points per edge) */
export function projectedBox(p: Projection, box: readonly number[]): [number, number, number, number] {
  const out: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const [w, s, e, n] = box;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    for (const [lon, lat] of [
      [w + (e - w) * t, s],
      [w + (e - w) * t, n],
      [w, s + (n - s) * t],
      [e, s + (n - s) * t],
    ]) {
      const [x, y] = projectPoint(p, lon, lat);
      out[0] = Math.min(out[0], x);
      out[1] = Math.min(out[1], y);
      out[2] = Math.max(out[2], x);
      out[3] = Math.max(out[3], y);
    }
  }
  return out;
}

/** Scale and offset that center a plane box within w × h: screen x = k·x + tx */
export interface Fit {
  k: number;
  tx: number;
  ty: number;
}
export function fitBox(box: readonly number[], w: number, h: number): Fit {
  const bw = box[2] - box[0];
  const bh = box[3] - box[1];
  const k = bw > 0 && bh > 0 ? Math.min(w / bw, h / bh) : 1;
  return { k, tx: (w - bw * k) / 2 - box[0] * k, ty: (h - bh * k) / 2 - box[1] * k };
}

const r1 = (v: number) => Math.round(v * 10) / 10 || 0;

/**
 * Turns rings into one SVG path: coordinates are rounded to 0.1px, and points within 0.35px of the previous one are dropped (smaller SVG, stable snapshots).
 * After the first point, each point is written as the difference from the previous one (l). The differences are between rounded coordinates, so they never drift as they add up. Rings smaller than 1px on screen (small islands, Dokdo)
 * are drawn as a 1.6px square at their spot so they do not vanish from the map (1px stays visible even under a 0.6px border). With minSide, rings whose shorter side is below it are dropped (for outlines).
 * Rings entirely outside view (width, height) are dropped (countries clipped out of view on a focused map; as a bonus, resvg no longer stalls on clipped empty shapes). Empty string when nothing is left
 */
export function ringsPath(rings: readonly Float64Array[], f: Fit, view?: readonly [number, number], minSide = 0): string {
  let d = "";
  for (const xy of rings) {
    let part = "";
    let px = NaN;
    let py = NaN;
    let n = 0;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < xy.length; i += 2) {
      const x = r1(xy[i] * f.k + f.tx);
      const y = r1(xy[i + 1] * f.k + f.ty);
      if (Math.abs(x - px) < 0.35 && Math.abs(y - py) < 0.35) continue;
      part += n ? `${n === 1 ? "l" : " "}${r1(x - px)} ${r1(y - py)}` : `M${x} ${y}`;
      px = x;
      py = y;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const outside = view !== undefined && (x1 < 0 || y1 < 0 || x0 > view[0] || y0 > view[1]);
    if (outside || Math.min(x1 - x0, y1 - y0) < minSide) continue;
    if (n >= 3 && (x1 - x0 >= 1 || y1 - y0 >= 1)) d += `${part}Z`;
    else if (!minSide) d += `M${r1((x0 + x1) / 2 - 0.8)} ${r1((y0 + y1) / 2 - 0.8)}h1.6v1.6h-1.6Z`;
  }
  return d;
}

/** Signed area and area centroid of a ring (plane coordinates) */
function ringMoments(xy: Float64Array): [number, number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = xy.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const c = xy[j * 2] * xy[i * 2 + 1] - xy[i * 2] * xy[j * 2 + 1];
    a += c;
    cx += (xy[j * 2] + xy[i * 2]) * c;
    cy += (xy[j * 2 + 1] + xy[i * 2 + 1]) * c;
  }
  return [a / 2, a ? cx / (3 * a) : NaN, a ? cy / (3 * a) : NaN];
}

/**
 * A point inside a region (screen coordinates): the midpoint of the longest stretch inside the polygon along a horizontal line at the area centroid's height of the largest polygon (area minus holes).
 * The centroid itself can land in a hole (Seoul inside Gyeonggi-do) or outside (a curved country), hence this approach. It is in plane coordinates, so it is not remeasured when the size changes
 */
export function shapeCenter(s: ProjectedShape): [number, number] {
  const area = new Map<number, number>();
  const m = s.rings.map(ringMoments);
  s.rings.forEach((_, i) => area.set(s.poly[i], (area.get(s.poly[i]) ?? 0) + (s.outer[i] ? 1 : -1) * Math.abs(m[i][0])));
  let best = -1;
  let bestA = 0;
  for (const [p, a] of area)
    if (a > bestA) {
      bestA = a;
      best = p;
    }
  if (best < 0) return [NaN, NaN];
  const mine = s.rings.map((_, i) => i).filter((i) => s.poly[i] === best);
  // Height of the outer rings' area centroid (area-weighted)
  let wy = 0;
  let wa = 0;
  for (const i of mine)
    if (s.outer[i]) {
      wy += m[i][2] * Math.abs(m[i][0]);
      wa += Math.abs(m[i][0]);
    }
  const y = wy / wa;
  const xs: number[] = [];
  for (const i of mine) {
    const xy = s.rings[i];
    const n = xy.length / 2;
    for (let a = 0, b = n - 1; a < n; b = a++) {
      const y1 = xy[a * 2 + 1];
      const y2 = xy[b * 2 + 1];
      if (y1 > y !== y2 > y) xs.push(xy[a * 2] + ((xy[b * 2] - xy[a * 2]) * (y - y1)) / (y2 - y1));
    }
  }
  xs.sort((a, b) => a - b);
  let x = NaN;
  let span = -1;
  for (let k = 0; k + 1 < xs.length; k += 2)
    if (xs[k + 1] - xs[k] > span) {
      span = xs[k + 1] - xs[k];
      x = (xs[k] + xs[k + 1]) / 2;
    }
  return [x, y];
}
