import { numGetter, strGetter } from "../data/accessor";
import { resolveMeta } from "../spec/meta";
import type { ChartSpec } from "../spec/types";
import { inlineRows } from "../spec/validate";
import { choosePlaceMap, flowPlace, flowRowOk, symbolPlace } from "./places";
import { BUILTIN_MAPS, chooseMap, type MapChoice } from "./registry";

/** Map charts (charts that pick a map with options.map) */
const MAP_TYPES: readonly string[] = ["choropleth", "symbolMap", "flowMap"];

/** Resolves a spec's options.map to a map: the choropleth by region values, the symbol map by row places, the flow map by origin and destination names (when "auto") */
function specChoice(type: string, spec: Pick<ChartSpec, "data" | "encoding" | "options">): MapChoice | null {
  const rows = inlineRows(spec.data) ?? [];
  const enc = spec.encoding ?? {};
  const field = (k: string) => (typeof enc[k] === "string" ? (enc[k] as string) : undefined);
  if (type === "symbolMap") {
    const glon = numGetter(field("lon"), "lon");
    const glat = numGetter(field("lat"), "lat");
    const greg = strGetter(field("region"), "region");
    return choosePlaceMap(spec.options?.map, () => rows.map((r, i) => symbolPlace(glon(r, i), glat(r, i), greg(r, i))));
  }
  if (type === "flowMap") {
    const has = (k: string) => rows.some((r) => r && typeof r === "object" && k in r);
    const gs = strGetter(field("source") ?? (has("source") ? "source" : "from"), "source");
    const gt = strGetter(field("target") ?? (has("target") ? "target" : "to"), "target");
    // Only the names of rows the chart actually draws (rows going to the same place and rows with a value at or below 0 are left out)
    const gv = numGetter(field("value") ?? (has("value") ? "value" : undefined), "value");
    const weighted = field("value") !== undefined || has("value");
    const names = new Set<string>();
    rows.forEach((r, i) => {
      const s = gs(r, i).trim();
      const t = gt(r, i).trim();
      if (flowRowOk(s, t, weighted ? gv(r, i) : 1)) names.add(s).add(t);
    });
    return choosePlaceMap(spec.options?.map, () => [...names].map((n) => flowPlace(spec.options?.places, n)));
  }
  const gr = strGetter(field("region"), "region");
  return chooseMap(spec.options?.map, () => rows.map((r, i) => gr(r, i)));
}

/**
 * Name of the built-in map a spec draws ("auto" resolves to the map chosen from the data, among the registered maps). null when it is not a map chart, uses GeoJSON, or the map is not registered.
 * Used by the CLI's interactive HTML to embed only that map file, and by code snippets to write the line that imports that map
 */
export function specMapName(spec: Pick<ChartSpec, "type" | "data" | "encoding" | "options">): string | null {
  const type = resolveMeta(spec.type)?.type;
  if (!type || !MAP_TYPES.includes(type)) return null;
  const choice = specChoice(type, spec);
  const name = choice && "map" in choice ? choice.name : undefined;
  return name !== undefined && BUILTIN_MAPS.includes(name) ? name : null;
}
