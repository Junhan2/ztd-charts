import { nameMatcher, normName } from "../layout/regions";
import { geojsonShapes, mapShapes } from "./codec";
import { ALBERS_INSETS, autoProjection, lonLatBox } from "./projection";
import { chooseMap, getMap, isGeoMap, mapMatcher, registeredMaps, type MapChoice } from "./registry";
import type { GeoJSONFeatureCollection, GeoMap, GeoShape } from "./types";

/*
 * 지점을 놓는 지도(기호 지도, 흐름 지도)가 같이 쓰는 자리 찾기. 경계를 도법에 올리지 않고 경위도와 지역 이름표만 봐서
 * validateSpec도 차트와 같은 규칙으로 "지도 밖"을 알려요 (검사기 번들에 도법 계산이 들지 않아요)
 */

/** 지점을 받는 경위도 상자 [서, 남, 동, 북]. 동쪽 끝은 180보다 클 수 있어요(날짜 변경선에 걸친 상자). id는 그 상자의 도법 조각(미국의 "AK", "HI") */
export interface DomainBox {
  box: readonly [number, number, number, number];
  id?: string;
}

/** 지도에서 지점을 놓는 데 필요한 것: 받는 상자들, 그리는 지역 번호, 지역 이름 맞추기, 지역 */
export interface PlaceDomain {
  boxes: readonly DomainBox[];
  /** 그리는 지역 번호 (숨긴 지역, 집중한 묶음 밖 지역, 도형 없는 지역을 뺀 것) */
  shown: ReadonlySet<number>;
  match: (name: unknown) => number;
  shapes: readonly GeoShape[];
}

export interface DomainOptions {
  focus?: string;
  featureId?: string;
  featureName?: string;
}

const cache = /* @__PURE__ */ new WeakMap<object, Map<string, PlaceDomain>>();

/** 상자를 넓혀요: 폭과 높이의 5% (적어도 0.5°). 위도는 ±90 안으로 */
function padBox(b: readonly number[]): [number, number, number, number] {
  const dx = Math.max(0.5, (b[2] - b[0]) * 0.05);
  const dy = Math.max(0.5, (b[3] - b[1]) * 0.05);
  return [b[0] - dx, Math.max(-90, b[1] - dy), b[2] + dx, Math.min(90, b[3] + dy)];
}

/**
 * 지도가 지점을 받는 곳. 집중한 묶음은 그 상자 그대로, 세계 도법(Equal Earth) 지도는 모든 경도와 그리는 지역의 위도 범위(남극을 빼서 남위 약 60° 아래는 밖),
 * 그 밖의 지도(원뿔 도법, GeoJSON)는 그리는 지역의 경위도 상자를 조금 넓힌 곳이에요. albersUsa는 본토, 알래스카, 하와이 상자를 따로 둬요(옮겨 붙인 조각마다)
 */
export function placeDomain(source: GeoMap | GeoJSONFeatureCollection, opts: DomainOptions = {}): PlaceDomain {
  const key = `${opts.focus ?? ""}\u0001${opts.featureId ?? ""}\u0001${opts.featureName ?? ""}`;
  let byKey = cache.get(source);
  const hit = byKey?.get(key);
  if (hit) return hit;
  const geoMap = isGeoMap(source) ? source : null;
  const shapes = geoMap ? mapShapes(geoMap) : geojsonShapes(source as GeoJSONFeatureCollection, opts.featureId, opts.featureName).shapes;
  const hidden = new Set(geoMap?.hidden ?? []);
  const focus = opts.focus !== undefined && geoMap?.focus && Object.hasOwn(geoMap.focus, opts.focus) ? geoMap.focus[opts.focus] : undefined;
  const members = focus ? new Set(focus.ids.split(" ")) : null;
  const shown = new Set<number>();
  shapes.forEach((s, i) => {
    if (s.polygons.length && !hidden.has(s.id) && (!members || members.has(s.id))) shown.add(i);
  });
  const boxes: DomainBox[] = [];
  if (focus) boxes.push({ box: [...focus.box] as [number, number, number, number] });
  else {
    // albersUsa는 지역 id로 조각을 나눠요 (projection.ts의 makeProjection과 같은 id)
    const groups = new Map<string, GeoShape[]>();
    for (const i of shown) {
      const id = geoMap?.projection === "albersUsa" && ALBERS_INSETS.includes(shapes[i].id) ? shapes[i].id : "";
      const g = groups.get(id);
      if (g) g.push(shapes[i]);
      else groups.set(id, [shapes[i]]);
    }
    for (const [id, list] of groups) {
      const ll = lonLatBox(list);
      if (!ll) continue;
      const wide = (geoMap ? geoMap.projection : autoProjection(ll)) === "equalEarth";
      const b = padBox(ll);
      boxes.push({ box: wide ? [-180, b[1], 180, b[3]] : b, ...(id && { id }) });
    }
  }
  const out: PlaceDomain = { boxes, shown, shapes, match: geoMap ? mapMatcher(geoMap) : nameMatcher(shapes.map((s) => s.keys)) };
  if (!byKey) cache.set(source, (byKey = new Map()));
  byKey.set(key, out);
  return out;
}

/** 경위도가 숫자이고 범위 안인지 (경도 -180~180, 위도 -90~90) */
export function validLonLat(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
}

/** 이 지점을 받는 상자 (없으면 null). 경도는 한 바퀴 돌려서도 봐요 (동쪽 끝이 180을 넘는 상자) */
function domainBox(d: PlaceDomain, lon: number, lat: number): DomainBox | null {
  for (const b of d.boxes) {
    const [w, s, e, n] = b.box;
    if (lat < s || lat > n) continue;
    for (const L of [lon, lon + 360, lon - 360]) if (L >= w && L <= e) return b;
  }
  return null;
}

/** 자리 하나: 경위도, 또는 지도의 지역 이름(그 지역 가운데) */
export type PlaceInput = { lon: number; lat: number } | { name: unknown };

/** 자리를 찾은 결과: 지점(받는 상자의 조각 id), 지역 번호, 또는 못 놓는 까닭 */
export type Placed = { lon: number; lat: number; id?: string } | { region: number } | { miss: "invalid" | "outside" | "unmatched" };

/** 자리 하나를 지도에 놓아요. 경위도는 범위 안이어야 하고(invalid) 지도가 받는 곳이어야 해요(outside). 이름은 그리는 지역에 맞아야 해요(unmatched, outside) */
export function placeIn(d: PlaceDomain, p: PlaceInput): Placed {
  if ("name" in p) {
    const k = d.match(p.name);
    if (k < 0) return { miss: "unmatched" };
    return d.shown.has(k) ? { region: k } : { miss: "outside" };
  }
  if (!validLonLat(p.lon, p.lat)) return { miss: "invalid" };
  const b = domainBox(d, p.lon, p.lat);
  return b ? { lon: p.lon, lat: p.lat, ...(b.id && { id: b.id }) } : { miss: "outside" };
}

/** 상자들의 넓이 합 (도², 같은 수를 받는 지도 가운데 더 좁은 지도를 고를 때) */
const areaOf = (d: PlaceDomain) => d.boxes.reduce((t, b) => t + (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]), 0);

/**
 * options.map을 지도로 (지점을 놓는 지도). 이름, 지도 객체, GeoJSON은 단계구분도와 같아요(chooseMap).
 * 없거나 "auto"면 등록한 지도 가운데 자리를 가장 많이 받는 지도예요: 경위도는 그 지도가 받는 곳에 들면, 이름은 그리는 지역에 맞으면 하나로 세요.
 * 같으면 받는 곳이 좁은 지도(서울만 있으면 kr-sido, 미국 도시만 있으면 us-states), 그것도 같으면 먼저 등록한 지도예요.
 * 하나도 받지 않으면(빈 데이터) "world"를 등록했으면 world, 아니면 처음 지도예요
 */
export function choosePlaceMap(option: unknown, items: () => readonly PlaceInput[]): MapChoice | null {
  if (option !== undefined && option !== "auto") return chooseMap(option, () => []);
  const names = registeredMaps();
  if (!names.length) return { missing: "auto" };
  const list = items();
  // 같은 이름은 한 번만 세요 (1만 행이어도 이름 수만큼만 맞춰요)
  const seen = new Set<string>();
  const unique = list.filter((p) => {
    if (!("name" in p)) return true;
    const k = normName(p.name);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  let best = -1;
  let bestN = 0;
  let bestArea = Infinity;
  names.forEach((name, i) => {
    const d = placeDomain(getMap(name)!);
    let n = 0;
    for (const p of unique) if (!("miss" in placeIn(d, p))) n++;
    const area = areaOf(d);
    if (n > bestN || (n === bestN && n > 0 && area < bestArea)) {
      best = i;
      bestN = n;
      bestArea = area;
    }
  });
  const name = best >= 0 ? names[best] : names.includes("world") ? "world" : names[0];
  return { map: getMap(name)!, name };
}

/**
 * 따로 그리는 원(기호 지도)과 흐름(흐름 지도)의 상한. 남이 쓴 스펙(MCP)에 10만 행이 와도 SVG 요소 수가 이만큼에서 멈춰요.
 * 넘으면 값이 큰 것부터 이만큼만 그리고 validateSpec이 알려요 (합계, 비율, 순위는 모두로 세요)
 */
export const MAX_POINTS = 2000;
export const MAX_FLOWS = 1000;

/**
 * 기호 지도 행 하나의 자리: 경도와 위도가 둘 다 숫자면 그 경위도, 아니면 지역 이름이 있으면 그 지역, 둘 다 없으면 못 놓는 자리(NaN)예요.
 * 범위 밖 경위도(위도 120)는 그대로 넘겨서 placeIn이 invalid로 알려요 (지역 이름으로 넘어가지 않아요)
 */
export function symbolPlace(lon: number, lat: number, region: string): PlaceInput {
  if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat };
  return region.trim() ? { name: region } : { lon: NaN, lat: NaN };
}

/**
 * options.places의 자리 하나 ([경도, 위도], 숫자나 숫자 글자 둘). 그 이름이 없으면 null(지역 이름으로 맞춰요).
 * 이름은 있는데 꼴이 틀리면 못 놓는 자리(NaN)라서 지역 이름으로 넘어가지 않아요 (validateSpec의 bad_place와 같아요)
 */
export function placeEntry(places: unknown, name: string): { lon: number; lat: number } | null {
  if (!places || typeof places !== "object" || Array.isArray(places) || !Object.hasOwn(places, name)) return null;
  const v = (places as Record<string, unknown>)[name];
  if (!Array.isArray(v) || v.length !== 2) return { lon: NaN, lat: NaN };
  const num = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN);
  return { lon: num(v[0]), lat: num(v[1]) };
}

/** 흐름 지도가 그리는 행인지: 두 이름이 있고 서로 다르며 값이 0보다 큰 수 (차트, validateSpec, specMapName이 같은 규칙) */
export function flowRowOk(s: string, t: string, v: number): boolean {
  return !!s && !!t && s !== t && v > 0 && Number.isFinite(v);
}

/** 흐름 지도의 자리 이름 하나: options.places에 있으면 그 경위도, 없으면 지도의 지역 이름이에요 */
export function flowPlace(places: unknown, name: string): PlaceInput {
  return placeEntry(places, name) ?? { name };
}
