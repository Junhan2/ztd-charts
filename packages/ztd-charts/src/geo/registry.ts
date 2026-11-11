import { bestMatch, nameMatcher } from "../layout/regions";
import type { GeoJSONFeatureCollection, GeoMap } from "./types";

/** 패키지에 든 지도 이름. 지도마다 입구 ztd-charts/geo/<이름>이 있어요 */
export const BUILTIN_MAPS: readonly string[] = ["world", "us-states", "kr-sido"];

/** 내장 지도 입구가 내보내는 이름: "us-states" → "usStates" (import { usStates } from "ztd-charts/geo/us-states") */
export function mapExportName(name: string): string {
  return name.replace(/-(\w)/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * 등록한 지도. 패키지 입구(ztd-charts, ztd-charts/spec, ztd-charts/server)는 따로 묶여서 모듈이 여러 벌일 수 있어요.
 * 그래서 한 곳(globalThis의 Symbol.for 열쇠)에 둬요: 서버 입구가 등록한 지도를 spec 입구의 validateSpec도 봐요
 */
function store(): Map<string, GeoMap> {
  // 열쇠는 함수 안에서 만들어요 (맨 위에 두면 지도를 쓰지 않는 차트 번들에도 남아요)
  const g = globalThis as unknown as Record<symbol, Map<string, GeoMap> | undefined>;
  return (g[Symbol.for("ztd-charts.geo.maps")] ??= new Map());
}

/** 꼴이 지도인지 (ztd-charts/geo/* 가 내보내는 객체) */
export function isGeoMap(v: unknown): v is GeoMap {
  const m = v as GeoMap | null;
  return !!m && typeof m === "object" && typeof m.name === "string" && Array.isArray(m.regions) && !!m.topo && typeof m.topo.arcs === "string";
}

/** 꼴이 GeoJSON FeatureCollection인지 */
export function isFeatureCollection(v: unknown): v is GeoJSONFeatureCollection {
  const f = v as GeoJSONFeatureCollection | null;
  return !!f && typeof f === "object" && f.type === "FeatureCollection" && Array.isArray(f.features);
}

/**
 * 지도를 이름으로 등록해요. 스펙의 options.map: "world"와 "auto"가 등록한 지도를 찾아요.
 * 브라우저에서는 그리는 지도만 등록하면 경계 데이터가 그만큼만 실려요. ztd-charts/server는 내장 지도를 모두 미리 등록해요
 * @example import { world } from "ztd-charts/geo/world"; registerMap(world);
 */
export function registerMap(...maps: GeoMap[]): void {
  for (const m of maps) if (isGeoMap(m)) store().set(m.name, m);
}

/** 등록한 지도 (없으면 undefined) */
export function getMap(name: string): GeoMap | undefined {
  return store().get(name);
}

/** 등록한 지도 이름 (등록한 순서) */
export function registeredMaps(): string[] {
  return [...store().keys()];
}

/** 지역마다 받는 이름 (id, 영어 이름, 다른 이름, 코드, 한국어 이름) */
export function regionKeys(m: GeoMap): (readonly string[])[] {
  // 글자가 아닌 칸은 빼요 (꾸민 지도 객체가 맞추기를 깨지 못하게)
  return m.regions.map((raw) => {
    const row = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
    const ko = row[0] !== undefined ? m.namesKo?.[row[0]] : undefined;
    return typeof ko === "string" ? [...row, ko] : row;
  });
}

const matchers = /* @__PURE__ */ new WeakMap<GeoMap, (name: unknown) => number>();
/** 이름 → 지역 번호 (regions 순서). 맞는 지역이 없으면 -1 */
export function mapMatcher(m: GeoMap): (name: unknown) => number {
  let f = matchers.get(m);
  if (!f) matchers.set(m, (f = nameMatcher(regionKeys(m))));
  return f;
}

/** options.map으로 고른 지도. 이름은 맞는데 등록하지 않았으면 missing이에요 ("auto"인데 등록한 지도가 하나도 없을 때도) */
export type MapChoice = { map: GeoMap | GeoJSONFeatureCollection; name?: string } | { missing: string };

/**
 * options.map을 지도로: 없거나 "auto"면 등록한 지도 가운데 지역 값이 가장 많이 맞는 지도(같으면 먼저 등록한 지도, 하나도 안 맞으면 처음 지도),
 * 이름이면 그 지도, 지도 객체나 GeoJSON이면 그대로예요. 그 밖의 꼴이면 null
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
