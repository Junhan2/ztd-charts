import { US_STATES, usStateKeys } from "../data/usStates";
import { US_TOPO } from "./maps/usStatesData";
import type { GeoMap } from "./types";

/**
 * The 50 US states and Washington, DC. Uses the Albers projection with Alaska and Hawaii moved below the mainland (albersUsa).
 * States match by postal abbreviation ("CA"), FIPS code ("06", 6), "US-CA" or name
 * @example import { usStates } from "ztd-charts/geo/us-states"; registerMap(usStates);
 */
export const usStates: GeoMap = {
  name: "us-states",
  projection: "albersUsa",
  // The order matches the order in which scripts/build-geo.mjs wrote the borders (the usStates.ts order)
  regions: /* @__PURE__ */ US_STATES.map((s) => [s[0], s[1], ...usStateKeys(s)]),
  topo: US_TOPO,
  source: "US Census Bureau state boundaries (public domain), via us-atlas 3.0.1 (ISC), simplified",
};
