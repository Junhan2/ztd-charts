/** Projection name. "equalEarth" is for the world, "albersUsa" for the US with Alaska and Hawaii moved in as insets, and "conic" is a conic equal-area projection centered on the region */
export type ProjectionName = "equalEarth" | "albersUsa" | "conic";

/**
 * One built-in map (exported by entry points such as ztd-charts/geo/world). Register it with registerMap or pass it straight to the map prop.
 * Borders share arcs between regions as in TopoJSON, and coordinates are stored as quantized deltas compressed into text (geo/codec.ts decodes them)
 */
export interface GeoMap {
  /** Name used in options.map. Example: "world" */
  name: string;
  projection: ProjectionName;
  /** Per region: [id, English name, accepted names...]. Same order as topo.shapes */
  regions: readonly (readonly string[])[];
  /** Region id → Korean name */
  namesKo?: Readonly<Record<string, string>>;
  /** Groups (continents) that can be zoomed into: name → [west, south, east, north] longitude/latitude box, central meridian, and the region ids in the group (space-separated) */
  focus?: Readonly<Record<string, { box: readonly [number, number, number, number]; lon0: number; ids: string }>>;
  /** Region ids not drawn by default (Antarctica on the world map) */
  hidden?: readonly string[];
  /** Compressed borders: t is [quantization step, x origin, y origin], arcs the arcs, shapes the polygons, rings and arc indexes of each region */
  topo: { t: readonly number[]; arcs: string; shapes: string };
  /** One line with the source and license terms */
  source: string;
}

/** [longitude, latitude] (degrees) */
export type LonLat = [number, number];

/** One decoded region. polygons holds a ring list per polygon, with the outer ring first */
export interface GeoShape {
  id: string;
  name: string;
  nameKo?: string;
  /** Names accepted when matching (id, name, Korean name, other names, codes) */
  keys: readonly string[];
  polygons: LonLat[][][];
}

/** GeoJSON FeatureCollection (longitude and latitude in degrees). Only Polygon and MultiPolygon are drawn */
export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: readonly {
    type?: string;
    id?: string | number;
    properties?: Record<string, unknown> | null;
    geometry?: { type: string; coordinates?: unknown } | null;
  }[];
}
