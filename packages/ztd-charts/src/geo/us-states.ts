import { US_STATES, usStateKeys } from "../data/usStates";
import { US_TOPO } from "./maps/usStatesData";
import type { GeoMap } from "./types";

/**
 * 미국 주 50곳과 워싱턴 DC. 알래스카와 하와이를 본토 아래에 옮겨 붙인 알베르스 도법(albersUsa)이에요.
 * 주는 우편 약자("CA"), FIPS 코드("06", 6), "US-CA", 이름으로 맞춰요
 * @example import { usStates } from "ztd-charts/geo/us-states"; registerMap(usStates);
 */
export const usStates: GeoMap = {
  name: "us-states",
  projection: "albersUsa",
  // 순서는 scripts/build-geo.mjs가 경계를 적은 순서(usStates.ts 순서)와 같아요
  regions: /* @__PURE__ */ US_STATES.map((s) => [s[0], s[1], ...usStateKeys(s)]),
  topo: US_TOPO,
  source: "US Census Bureau state boundaries (public domain), via us-atlas 3.0.1 (ISC), simplified",
};
