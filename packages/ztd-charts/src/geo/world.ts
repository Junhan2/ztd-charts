import { WORLD_FOCUS, WORLD_REGIONS, WORLD_TOPO } from "./maps/worldData";
import type { GeoMap } from "./types";

/**
 * 세계 지도: Natural Earth 1:110m 나라 177곳 (남극은 기본으로 빼요). Equal Earth 도법이에요.
 * 나라는 ISO 3166-1 알파-2("KR"), 알파-3("KOR"), 숫자 코드(410), 영어 이름, 흔한 다른 이름("South Korea", "Korea, Republic of")으로 맞춰요.
 * 국경은 Natural Earth의 실제 관할(de facto) 경계를 따라요. 다르게 그려야 하면 GeoJSON을 options.map으로 넘겨 주세요.
 * focus로 묶음(europe, asia, africa, americas, oceania)만 크게 볼 수 있어요 (UN M49 지역)
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
