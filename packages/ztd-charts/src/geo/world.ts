import { WORLD_FOCUS, WORLD_REGIONS, WORLD_TOPO } from "./maps/worldData";
import type { GeoMap } from "./types";

/**
 * World map: the 177 countries of Natural Earth 1:110m (Antarctica is left out by default). Uses the Equal Earth projection.
 * Countries match by ISO 3166-1 alpha-2 ("KR"), alpha-3 ("KOR"), numeric code (410), English name, or common alternative names ("South Korea", "Korea, Republic of").
 * Borders follow Natural Earth's de facto boundaries. If you need them drawn differently, pass your own GeoJSON as options.map.
 * focus zooms into one group (europe, asia, africa, americas, oceania) (UN M49 regions)
 * @example import { world } from "ztd-charts/geo/world"; registerMap(world);
 */
export const world: GeoMap = {
  name: "world",
  projection: "equalEarth",
  regions: WORLD_REGIONS,
  focus: WORLD_FOCUS,
  hidden: ["ATA"],
  topo: WORLD_TOPO,
  source: "Natural Earth 1:110m countries (public domain), via world-atlas 2.0.2 (ISC)",
};
