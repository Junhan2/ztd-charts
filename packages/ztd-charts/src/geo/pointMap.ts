import { formatPercent } from "../core/format";
import type { ChartLang } from "../core/i18n";
import { textWidth } from "../core/text";
import { projectPoint, wrap, type SubProjection } from "./projection";
import type { Placed } from "./places";
import { BUILTIN_MAPS, isGeoMap } from "./registry";
import type { GeoShape } from "./types";
import type { GeoLayout } from "./view";

/*
 * 지점을 놓는 지도(기호 지도, 흐름 지도)의 그리기 쪽 공통 부분: 놓은 자리를 평면에 올리기, 지점까지 들어가는 틀, 겹치지 않는 이름표.
 * 도법 코드를 써서 차트만 불러요 (검사기는 places.ts만 써요)
 */

/** 평면에 올린 자리 하나: 평면 좌표(화면 좌표는 geoFrame의 fit으로), 경위도, 그 자리의 도법 조각 */
export interface MapPoint {
  x: number;
  y: number;
  lon: number;
  lat: number;
  sub: SubProjection;
}

const lonLatCenters = /* @__PURE__ */ new WeakMap<GeoShape, [number, number]>();

/**
 * 지역의 대표 경위도: 가장 넓은(경위도 평면에서) 다각형 바깥 고리의 넓이 중심. 날짜 변경선을 건너는 고리는 첫 점 기준으로 이어 붙여 재요.
 * 지역 가운데 점(shapeCenter)은 화면 자리에 쓰고, 이 경위도는 흐름이 날짜 변경선을 건너는지 정할 때만 써요
 */
export function regionLonLat(s: GeoShape): [number, number] {
  const hit = lonLatCenters.get(s);
  if (hit) return hit;
  let best: [number, number] = [NaN, NaN];
  let bestA = -1;
  for (const poly of s.polygons) {
    const ring = poly[0];
    if (!ring || ring.length < 3) continue;
    const lon0 = ring[0][0];
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = lon0 + wrap(ring[i][0] - lon0);
      const xj = lon0 + wrap(ring[j][0] - lon0);
      const c = xj * ring[i][1] - xi * ring[j][1];
      a += c;
      cx += (xj + xi) * c;
      cy += (ring[j][1] + ring[i][1]) * c;
    }
    if (Math.abs(a) > bestA && a !== 0) {
      bestA = Math.abs(a);
      best = [wrap(cx / (3 * a)), cy / (3 * a)];
    }
  }
  if (bestA < 0) best = s.polygons[0]?.[0]?.[0] ? [s.polygons[0][0][0][0], s.polygons[0][0][0][1]] : [NaN, NaN];
  lonLatCenters.set(s, best);
  return best;
}

/** 세계 지도의 가운데: "atlantic"은 중앙 경선 0(반대편 경선 180, 태평양에서 잘려요), "pacific"은 150(반대편 경선 -30, 대서양에서 잘려요) */
export type MapCenter = "auto" | "atlantic" | "pacific";
const CENTER_LON = { atlantic: 0, pacific: 150 } as const;

/** 가운데를 바꿀 수 있는 지도: 세계 도법 내장 지도이고 묶음(focus)으로 자르지 않았을 때 */
export function canCenter(source: unknown, focus: string | undefined): boolean {
  const m = isGeoMap(source) ? source : null;
  return !!m && m.projection === "equalEarth" && !(focus !== undefined && m.focus && Object.hasOwn(m.focus, focus));
}

/**
 * 중앙 경선 고르기. "auto"(기본)는 두 가운데 가운데 덜 잘리는 쪽이에요: 흐름은 짧은 길이 반대편 경선을 건너는 양의 합, 지점은 반대편 경선 20° 안(지도 끝)에 놓이는 수.
 * 같으면 대서양 가운데(0)예요. 흐름과 지점 수만큼 한 번씩만 봐요
 */
export function chooseCenter(option: unknown, flows: readonly { a: number; b: number; w: number }[], lons: readonly number[]): number {
  if (option === "atlantic" || option === "pacific") return CENTER_LON[option];
  const cost = (lon0: number) => {
    let c = 0;
    for (const f of flows) if (Math.abs(wrap(f.b - lon0) - wrap(f.a - lon0)) > 180) c = cap(c + f.w);
    for (const lon of lons) if (Math.abs(wrap(lon - lon0)) > 160) c += 1;
    return c;
  };
  return cost(CENTER_LON.pacific) < cost(CENTER_LON.atlantic) ? CENTER_LON.pacific : CENTER_LON.atlantic;
}

/** 0.1px로 반올림 (-0은 0) */
export const r1 = (v: number) => Math.round(v * 10) / 10 || 0;
/** 합이 넘쳐 Infinity가 되지 않게 가장 큰 수에서 멈춰요 (1e308 두 개) */
export const cap = (v: number) => Math.min(Number.MAX_VALUE, v);

/** 놓은 자리(placeIn)를 평면에 올려요. 지역은 지역 가운데 점(shapeCenter), 경위도는 그 조각의 도법이에요. 못 놓으면 null */
export function planePoint(g: GeoLayout, at: Placed): MapPoint | null {
  if ("miss" in at) return null;
  const albers = g.projection.name === "albersUsa";
  if ("region" in at) {
    const [x, y] = g.centers[at.region] ?? [NaN, NaN];
    const s = g.shapes[at.region];
    const [lon, lat] = regionLonLat(s);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(lon)) return null;
    return { x, y, lon, lat, sub: g.projection.pick(lon, lat, albers ? s.id : undefined) };
  }
  const id = albers ? at.id ?? "" : undefined;
  const [x, y] = projectPoint(g.projection, at.lon, at.lat, id);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, lon: at.lon, lat: at.lat, sub: g.projection.pick(at.lon, at.lat, id) } : null;
}

/** 지도 상자에 지점들을 더한 평면 상자 (지도 밖 바다의 지점도 틀 안에 들어가게). 집중한 지도는 묶음 상자 그대로예요 (밖은 잘라요) */
export function pointBox(g: GeoLayout, pts: readonly { x: number; y: number }[]): [number, number, number, number] {
  const b: [number, number, number, number] = [g.box[0], g.box[1], g.box[2], g.box[3]];
  if (g.clip) return b;
  for (const p of pts) {
    if (p.x < b[0]) b[0] = p.x;
    if (p.y < b[1]) b[1] = p.y;
    if (p.x > b[2]) b[2] = p.x;
    if (p.y > b[3]) b[3] = p.y;
  }
  return b;
}

/** 이름표 후보: 점 자리(x, y), 점 반지름, 글자 */
export interface LabelCandidate {
  x: number;
  y: number;
  r: number;
  text: string;
  weight?: number;
}
/** 놓은 이름표: 글자 시작(anchor start/end) 자리 */
export interface PlacedLabel {
  x: number;
  y: number;
  anchor: "start" | "end" | "middle";
  text: string;
  weight: number;
  /** 후보 번호 */
  k: number;
}

export type Rect = [number, number, number, number];
const hits = (a: Rect, b: Rect) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/**
 * 겹치지 않는 이름표: 후보를 주어진 순서(중요한 것부터)로 오른쪽, 왼쪽, 위, 아래 자리를 차례로 보고, 이미 놓은 이름표나 피할 상자(avoid)와 겹치지 않고
 * 틀(w × h) 안에 들고 다른 점(obstacles)도 덮지 않는 첫 자리에 둬요. 들어갈 자리가 없으면 그 이름표는 빼요.
 * 같은 자리(1px 안)에 겹친 점은 앞 후보 하나만 적어요. 글자 크기 size
 */
export function placeLabels(cands: readonly LabelCandidate[], w: number, h: number, size: number, avoid: readonly Rect[] = [], obstacles: readonly Rect[] = []): PlacedLabel[] {
  const taken: Rect[] = [...avoid];
  const out: PlacedLabel[] = [];
  const hh = size * 0.62;
  const seen = new Set<string>();
  cands.forEach((c, k) => {
    const at = `${Math.round(c.x)} ${Math.round(c.y)}`;
    if (seen.has(at)) return;
    seen.add(at);
    const weight = c.weight ?? 600;
    const tw = textWidth(c.text, size, weight);
    const gap = c.r + 3;
    const spots: [number, number, PlacedLabel["anchor"], Rect][] = [
      [c.x + gap, c.y, "start", [c.x + gap, c.y - hh, c.x + gap + tw, c.y + hh]],
      [c.x - gap, c.y, "end", [c.x - gap - tw, c.y - hh, c.x - gap, c.y + hh]],
      [c.x, c.y - gap - hh, "middle", [c.x - tw / 2, c.y - gap - 2 * hh, c.x + tw / 2, c.y - gap]],
      [c.x, c.y + gap + hh, "middle", [c.x - tw / 2, c.y + gap, c.x + tw / 2, c.y + gap + 2 * hh]],
    ];
    for (const [x, y, anchor, rect] of spots) {
      if (rect[0] < 1 || rect[1] < 0 || rect[2] > w - 1 || rect[3] > h) continue;
      if (taken.some((t) => hits(t, rect)) || obstacles.some((t) => hits(t, rect))) continue;
      taken.push(rect);
      out.push({ x, y, anchor, text: c.text, weight, k });
      return;
    }
  });
  return out;
}

/** 비율(0~100)을 로캘에 맞춰: 10% 아래는 소수 한 자리(9.3%), 그 위는 정수(25%) */
export function sharePct(v: number, locale: string): string {
  return formatPercent(v, { locale, maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 });
}

/** 지도를 등록하지 않았을 때의 안내 (단계구분도와 같은 글) */
export function mapNotLoaded(name: string, lang: ChartLang): string {
  if (lang === "ko")
    return name === "auto" ? "등록한 지도가 없어요. ztd-charts/geo의 지도를 registerMap에 넘겨 주세요" : BUILTIN_MAPS.includes(name) ? `"${name}" 지도를 등록하지 않았어요. ztd-charts/geo/${name}에서 불러와 registerMap에 넘겨 주세요` : `"${name}" 지도를 등록하지 않았어요. 지도를 registerMap에 넘기거나 ${BUILTIN_MAPS.join(", ")}, GeoJSON을 써 주세요`;
  return name === "auto" ? "No map is registered. Import one from ztd-charts/geo and pass it to registerMap" : BUILTIN_MAPS.includes(name) ? `Map "${name}" is not registered. Import it from ztd-charts/geo/${name} and pass it to registerMap` : `Map "${name}" is not registered. Pass a map to registerMap, or use ${BUILTIN_MAPS.join(", ")} or a GeoJSON`;
}
