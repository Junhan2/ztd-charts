import { bestMatch, nameMatcher } from "../layout/regions";
import type { GeoJSONFeatureCollection, GeoMap } from "./types";

/** Names of the maps included in the package. Each map has its own entry point, ztd-charts/geo/<name> */
export const BUILTIN_MAPS: readonly string[] = ["world", "us-states", "kr-sido"];

/** Export name of a built-in map's entry point: "us-states" → "usStates" (import { usStates } from "ztd-charts/geo/us-states") */
export function mapExportName(name: string): string {
  return name.replace(/-(\w)/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * Registered maps. The package entry points (ztd-charts, ztd-charts/spec, ztd-charts/server) are bundled separately, so the module can exist in several copies.
 * The maps are therefore kept in one place (a Symbol.for key on globalThis): validateSpec in the spec entry point sees maps registered by the server entry point
 */
function store(): Map<string, GeoMap> {
  // Create the key inside the function (at the top level it would stay in the bundles of charts that use no map)
  const g = globalThis as unknown as Record<symbol, Map<string, GeoMap> | undefined>;
  return (g[Symbol.for("ztd-charts.geo.maps")] ??= new Map());
}

/** Whether the value is shaped like a map (the objects exported by ztd-charts/geo/*) */
export function isGeoMap(v: unknown): v is GeoMap {
  const m = v as GeoMap | null;
  return !!m && typeof m === "object" && typeof m.name === "string" && Array.isArray(m.regions) && !!m.topo && typeof m.topo.arcs === "string";
}

/** Whether the value is shaped like a GeoJSON FeatureCollection */
export function isFeatureCollection(v: unknown): v is GeoJSONFeatureCollection {
  const f = v as GeoJSONFeatureCollection | null;
  return !!f && typeof f === "object" && f.type === "FeatureCollection" && Array.isArray(f.features);
}

/**
 * Registers maps by name. A spec's options.map: "world" and "auto" look up registered maps.
 * In the browser, registering only the maps you draw ships only that boundary data. ztd-charts/server registers every built-in map up front
 * @example import { world } from "ztd-charts/geo/world"; registerMap(world);
 */
export function registerMap(...maps: GeoMap[]): void {
  for (const m of maps) if (isGeoMap(m)) store().set(m.name, m);
}

/** A registered map (undefined if none) */
export function getMap(name: string): GeoMap | undefined {
  return store().get(name);
}

/** Names of the registered maps (in registration order) */
export function registeredMaps(): string[] {
  return [...store().keys()];
}

/** Accepted names per region (id, English name, other names, codes, Korean name) */
export function regionKeys(m: GeoMap): (readonly string[])[] {
  // Skip entries that are not strings (so a crafted map object cannot break matching)
  return m.regions.map((raw) => {
    const row = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
    const ko = row[0] !== undefined ? m.namesKo?.[row[0]] : undefined;
    return typeof ko === "string" ? [...row, ko] : row;
  });
}

const matchers = /* @__PURE__ */ new WeakMap<GeoMap, (name: unknown) => number>();
/** Name → region index (regions order). -1 when no region matches */
export function mapMatcher(m: GeoMap): (name: unknown) => number {
  let f = matchers.get(m);
  if (!f) matchers.set(m, (f = nameMatcher(regionKeys(m))));
  return f;
}

/** The map chosen by options.map. missing when the name is valid but not registered (also when it is "auto" and no map is registered) */
export type MapChoice = { map: GeoMap | GeoJSONFeatureCollection; name?: string } | { missing: string };

/**
 * Resolves options.map to a map: when missing or "auto", the registered map that matches the most region values (on a tie the map registered first; with no match at all, the first map);
 * a name gives that map; a map object or GeoJSON is used as is. null for any other shape
 */
export function chooseMap(option: unknown, values: () => readonly unknown[]): MapChoice | null {
  if (option === undefined || option === "auto") {
    const names = registeredMaps();
    if (!names.length) return { missing: "auto" };
    const k = bestMatch(values(), names.map((n) => mapMatcher(getMap(n)!)));
    const name = names[Math.max(0, k)];
    return { map: getMap(name)!, name };
  }
  if (typeof option === "string") {
    const m = getMap(option);
    return m ? { map: m, name: option } : { missing: option };
  }
  if (isGeoMap(option)) return { map: option, name: option.name };
  return isFeatureCollection(option) ? { map: option } : null;
}
