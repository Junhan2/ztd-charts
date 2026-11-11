import { numGetter, strGetter } from "../data/accessor";
import { resolveMeta } from "../spec/meta";
import type { ChartSpec } from "../spec/types";
import { inlineRows } from "../spec/validate";
import { choosePlaceMap, flowPlace, flowRowOk, symbolPlace } from "./places";
import { BUILTIN_MAPS, chooseMap, type MapChoice } from "./registry";

/** 지도 차트 (options.map으로 지도를 고르는 차트) */
const MAP_TYPES: readonly string[] = ["choropleth", "symbolMap", "flowMap"];

/** 스펙의 options.map을 지도로: 단계구분도는 지역 값으로, 기호 지도는 행의 자리로, 흐름 지도는 출발지와 도착지 이름으로 ("auto"일 때) */
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
    // 차트와 같이 그리는 행의 이름만 (같은 곳으로 가는 행, 값이 0 이하인 행은 빼요)
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
 * 스펙이 그리는 내장 지도 이름 ("auto"는 데이터로 고른 지도, 등록한 지도 가운데서). 지도 차트가 아니거나, GeoJSON이거나, 등록하지 않았으면 null.
 * CLI의 대화형 HTML이 그 지도 파일 하나만 넣고, 코드 조각이 그 지도를 불러오는 줄을 적을 때 써요
 */
export function specMapName(spec: Pick<ChartSpec, "type" | "data" | "encoding" | "options">): string | null {
  const type = resolveMeta(spec.type)?.type;
  if (!type || !MAP_TYPES.includes(type)) return null;
  const choice = specChoice(type, spec);
  const name = choice && "map" in choice ? choice.name : undefined;
  return name !== undefined && BUILTIN_MAPS.includes(name) ? name : null;
}
