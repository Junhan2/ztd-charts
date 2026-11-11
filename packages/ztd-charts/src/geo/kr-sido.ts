import { KR_LAYOUTS, KR_REGIONS } from "../data/krRegions";
import { KR_TOPO } from "./maps/krSidoData";
import type { GeoMap } from "./types";

// 순서는 scripts/build-geo.mjs가 경계를 적은 순서(krRegions.ts에서 kr-sido 16곳의 순서)와 같아요
const rows = /* @__PURE__ */ KR_REGIONS.filter((r) => KR_LAYOUTS["kr-sido"].some((line) => line.split(" ").includes(r[0])));

/**
 * 대한민국 광역 지자체 16곳 (2026-07-01 광주와 전남이 전남광주통합특별시로 합쳐진 뒤). 가운데에 맞춘 원뿔 정적 도법이에요.
 * 타일 격자 지도의 kr-sido와 같은 이름을 받아요: 짧은 이름("서울"), 공식 이름, 예전 이름, 영어 이름, ISO 3166-2 코드("KR-11")
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
