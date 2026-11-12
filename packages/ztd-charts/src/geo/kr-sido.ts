import { KR_LAYOUTS, KR_REGIONS } from "../data/krRegions";
import { KR_TOPO } from "./maps/krSidoData";
import type { GeoMap } from "./types";

// The order matches the order in which scripts/build-geo.mjs wrote the borders (the order of the 16 kr-sido places in krRegions.ts)
const rows = /* @__PURE__ */ KR_REGIONS.filter((r) => KR_LAYOUTS["kr-sido"].some((line) => line.split(" ").includes(r[0])));

/**
 * The 16 first-level divisions of South Korea (after Gwangju and Jeollanam-do merged into Jeonnam-Gwangju Integrated Special City on 2026-07-01). Uses a conic equal-area projection fitted to the center.
 * Accepts the same names as kr-sido on the tile grid map: short names ("서울"), official names, former names, English names and ISO 3166-2 codes ("KR-11")
 * @example import { krSido } from "ztd-charts/geo/kr-sido"; registerMap(krSido);
 */
export const krSido: GeoMap = {
  name: "kr-sido",
  projection: "conic",
  regions: /* @__PURE__ */ rows.map((r) => [r[0], r[0], ...r.slice(1)]),
  namesKo: /* @__PURE__ */ Object.fromEntries(rows.map((r) => [r[0], r[1]])),
  topo: KR_TOPO,
  source: "geoBoundaries KOR ADM1 (public domain, from Natural Earth), simplified, Gwangju and Jeollanam-do merged",
};
