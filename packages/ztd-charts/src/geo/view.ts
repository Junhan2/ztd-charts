import { nameMatcher } from "../layout/regions";
import { geojsonShapes, mapShapes } from "./codec";
import { autoProjection, fitBox, lonLatBox, makeProjection, projectedBox, projectPoint, projectShape, ringsPath, shapeCenter, type Fit, type ProjectedShape, type Projection } from "./projection";
import { isGeoMap, mapMatcher } from "./registry";
import type { GeoJSONFeatureCollection, GeoMap, GeoShape } from "./types";

/**
 * A projected map (the size-independent part). Shared by the choropleth and the maps that place points on top of it.
 * shapes keeps the map's region order, and regions are the regions colored by value (indexes excluding hidden regions, regions outside the focused group, and regions outside the box)
 */
export interface GeoLayout {
  shapes: readonly GeoShape[];
  projected: readonly ProjectedShape[];
  projection: Projection;
  /** Plane box to fit: the focused group's box, otherwise all drawn regions */
  box: readonly [number, number, number, number];
  /** Indexes of the regions colored by value (region order) */
  regions: readonly number[];
  /** Indexes of regions drawn only as faint background (countries outside the focused group that reach into the box) */
  context: readonly number[];
  /** Whether drawing must be clipped to the box (when focused) */
  clip: boolean;
  /** A point inside each region (plane coordinates, shapeCenter). geoFrame maps them to screen coordinates */
  centers: readonly [number, number][];
  /** Name → region index (region order). -1 if none */
  match: (name: unknown) => number;
}

const overlaps = (a: readonly number[], b: readonly number[]) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const layouts = /* @__PURE__ */ new WeakMap<object, Map<string, GeoLayout>>();

/**
 * Projects a map (built-in or GeoJSON). Computed once per map and options (every point needs trigonometry, so it is not redone when the size changes).
 * focus is a group of a built-in map ("europe" etc. on the world map); featureId and featureName are the GeoJSON properties to read ids and names from.
 * lon0 is the central meridian of a built-in world-projection map (without a group) (default 0; point maps use 150 to draw flows across the Pacific as one line)
 */
export function geoLayout(source: GeoMap | GeoJSONFeatureCollection, opts: { focus?: string; featureId?: string; featureName?: string; lon0?: number } = {}): GeoLayout {
  // The central meridian applies only to built-in world-projection (Equal Earth) maps. When missing or 0, the cache key is unchanged, so the same layout is reused
  const lon0 = Number.isFinite(opts.lon0) ? ((((opts.lon0 as number) + 180) % 360) + 360) % 360 - 180 : 0;
  const key = `${opts.focus ?? ""}\u0001${opts.featureId ?? ""}\u0001${opts.featureName ?? ""}${lon0 ? `\u0001${lon0}` : ""}`;
  let byKey = layouts.get(source);
  const hit = byKey?.get(key);
  if (hit) return hit;
  const geoMap = isGeoMap(source) ? source : null;
  const shapes = geoMap ? mapShapes(geoMap) : geojsonShapes(source as GeoJSONFeatureCollection, opts.featureId, opts.featureName).shapes;
  const hidden = new Set(geoMap?.hidden ?? []);
  const focus = opts.focus !== undefined && geoMap?.focus && Object.hasOwn(geoMap.focus, opts.focus) ? geoMap.focus[opts.focus] : undefined;
  const shown = shapes.map((s, i) => i).filter((i) => !hidden.has(shapes[i].id) && shapes[i].polygons.length);
  // Projection: Equal Earth on the group's central meridian for a group, the map's own projection for a built-in map, and one chosen by extent for GeoJSON. For the conic projection and GeoJSON, the center of the extent is the central meridian
  let projection: Projection;
  if (focus) projection = makeProjection("equalEarth", focus.lon0);
  else {
    const ll = lonLatBox(shown.map((i) => shapes[i])) ?? [-180, -60, 180, 85];
    const name = geoMap ? geoMap.projection : autoProjection(ll);
    // Built-in world-projection maps center on lon0 (a Pacific-centered map uses 150: rings are cut at the antimeridian, -30)
    projection = makeProjection(name, name === "conic" || !geoMap ? (ll[0] + ll[2]) / 2 : name === "equalEarth" ? lon0 : 0, ll);
  }
  const projected = shapes.map((s) => projectShape(projection, s));
  let box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  if (focus) box = projectedBox(projection, focus.box);
  else
    for (const i of shown) {
      const b = projected[i].box;
      box = [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])];
    }
  if (!Number.isFinite(box[0])) box = [0, 0, 1, 1];
  const inBox = shown.filter((i) => overlaps(projected[i].box, box));
  const members = focus ? new Set(focus.ids.split(" ")) : null;
  const out: GeoLayout = {
    shapes,
    projected,
    projection,
    box,
    regions: members ? inBox.filter((i) => members.has(shapes[i].id)) : inBox,
    context: members ? inBox.filter((i) => !members.has(shapes[i].id)) : [],
    clip: !!focus,
    centers: projected.map(shapeCenter),
    match: geoMap ? mapMatcher(geoMap) : nameMatcher(shapes.map((s) => s.keys)),
  };
  if (!byKey) layouts.set(source, (byKey = new Map()));
  byKey.set(key, out);
  return out;
}

/** Width-to-height ratio of the plane box (to derive the map height from the width) */
export function layoutAspect(g: GeoLayout): number {
  const w = g.box[2] - g.box[0];
  const h = g.box[3] - g.box[1];
  return w > 0 && h > 0 ? w / h : 2;
}

/** A map fitted to w × h: a path and center per region, and longitude/latitude → screen coordinates */
export interface GeoFrame {
  fit: Fit;
  paths: string[];
  centers: [number, number][];
  /** [longitude, latitude] → screen [x, y]. Given an id, uses the projection piece of that region (Alaska and Hawaii in the US) */
  project: (lon: number, lat: number, id?: string) => [number, number];
}

/**
 * Builds the paths for the given size. A region that is not drawn (neither colored by value nor a faint background region) or that lies entirely outside the view gets an empty string.
 * A region under 1px is drawn as a 1.6px square (see ringsPath).
 * With box, fits that plane box instead of the map box (point maps pass a box widened to include points at sea outside the map)
 */
export function geoFrame(g: GeoLayout, w: number, h: number, pad = 2, box: readonly number[] = g.box): GeoFrame {
  const fit = fitBox(box, Math.max(1, w - pad * 2), Math.max(1, h - pad * 2));
  fit.tx += pad;
  fit.ty += pad;
  const used = new Set([...g.regions, ...g.context]);
  return {
    fit,
    paths: g.projected.map((s, i) => (used.has(i) ? ringsPath(s.rings, fit, [w, h]) : "")),
    centers: g.centers.map(([x, y]) => [x * fit.k + fit.tx, y * fit.k + fit.ty]),
    project: (lon, lat, id) => {
      const [x, y] = projectPoint(g.projection, lon, lat, id);
      return [x * fit.k + fit.tx, y * fit.k + fit.ty];
    },
  };
}
