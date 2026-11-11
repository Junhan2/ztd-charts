import { nameMatcher } from "../layout/regions";
import { geojsonShapes, mapShapes } from "./codec";
import { autoProjection, fitBox, lonLatBox, makeProjection, projectedBox, projectPoint, projectShape, ringsPath, shapeCenter, type Fit, type ProjectedShape, type Projection } from "./projection";
import { isGeoMap, mapMatcher } from "./registry";
import type { GeoJSONFeatureCollection, GeoMap, GeoShape } from "./types";

/**
 * 도법에 올린 지도 (크기와 상관없는 부분). 단계구분도와 그 위에 지점을 놓는 지도가 같이 써요.
 * shapes는 지도의 지역 순서 그대로이고, regions는 값을 칠하는 지역(숨긴 지역, 집중한 묶음 밖 지역, 상자 밖 지역을 뺀 번호)이에요
 */
export interface GeoLayout {
  shapes: readonly GeoShape[];
  projected: readonly ProjectedShape[];
  projection: Projection;
  /** 맞출 평면 상자: 집중한 묶음의 상자, 아니면 그리는 지역 전체 */
  box: readonly [number, number, number, number];
  /** 값을 칠하는 지역 번호 (지역 순서) */
  regions: readonly number[];
  /** 옅은 바탕으로만 그리는 지역 번호 (집중한 묶음 밖인데 상자 안에 걸친 나라) */
  context: readonly number[];
  /** 상자를 잘라 그려야 하는지 (집중했을 때) */
  clip: boolean;
  /** 지역마다 안의 한 점 (평면 좌표, shapeCenter). 화면 좌표는 geoFrame이 맞춰요 */
  centers: readonly [number, number][];
  /** 이름 → 지역 번호 (지역 순서). 없으면 -1 */
  match: (name: unknown) => number;
}

const overlaps = (a: readonly number[], b: readonly number[]) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const layouts = /* @__PURE__ */ new WeakMap<object, Map<string, GeoLayout>>();

/**
 * 지도(내장 지도나 GeoJSON)를 도법에 올려요. 지도와 옵션마다 한 번만 계산해요 (점마다 삼각함수라서 크기가 바뀔 때는 다시 하지 않아요).
 * focus는 내장 지도의 묶음(세계 지도의 "europe" 등), featureId, featureName은 GeoJSON에서 id와 이름을 읽을 속성이에요.
 * lon0은 세계 도법 내장 지도(묶음 없이)의 중앙 경선이에요 (기본 0. 지점 지도가 태평양을 건너는 흐름을 한 줄로 그리려고 150을 써요)
 */
export function geoLayout(source: GeoMap | GeoJSONFeatureCollection, opts: { focus?: string; featureId?: string; featureName?: string; lon0?: number } = {}): GeoLayout {
  // 중앙 경선은 세계 도법(Equal Earth) 내장 지도에만 써요. 없거나 0이면 예전 열쇠 그대로라 같은 배치를 다시 써요
  const lon0 = Number.isFinite(opts.lon0) ? ((((opts.lon0 as number) + 180) % 360) + 360) % 360 - 180 : 0;
  const key = `${opts.focus ?? ""}\u0001${opts.featureId ?? ""}\u0001${opts.featureName ?? ""}${lon0 ? `\u0001${lon0}` : ""}`;
  let byKey = layouts.get(source);
  const hit = byKey?.get(key);
  if (hit) return hit;
  const geoMap = isGeoMap(source) ? source : null;
  const shapes = geoMap ? mapShapes(geoMap) : geojsonShapes(source as GeoJSONFeatureCollection, opts.featureId, opts.featureName).shapes;
  const hidden = new Set(geoMap?.hidden ?? []);
  const focus = opts.focus !== undefined && geoMap?.focus && Object.hasOwn(geoMap.focus, opts.focus) ? geoMap.focus[opts.focus] : undefined;
  const shown = shapes.map((s, i) => i).filter((i) => !hidden.has(shapes[i].id) && shapes[i].polygons.length);
  // 도법: 묶음이면 그 중앙 경선의 Equal Earth, 내장 지도는 자기 도법, GeoJSON은 범위로 골라요. 원뿔 도법과 GeoJSON은 범위 가운데가 중앙 경선이에요
  let projection: Projection;
  if (focus) projection = makeProjection("equalEarth", focus.lon0);
  else {
    const ll = lonLatBox(shown.map((i) => shapes[i])) ?? [-180, -60, 180, 85];
    const name = geoMap ? geoMap.projection : autoProjection(ll);
    // 세계 도법 내장 지도는 lon0을 가운데에 둬요 (태평양 가운데 지도는 150: 고리는 반대편 경선 -30에서 잘려요)
    projection = makeProjection(name, name === "conic" || !geoMap ? (ll[0] + ll[2]) / 2 : name === "equalEarth" ? lon0 : 0, ll);
  }
  const projected = shapes.map((s) => projectShape(projection, s));
  let box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  if (focus) box = projectedBox(projection, focus.box);
  else
    for (const i of shown) {
      const b = projected[i].box;
      box = [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])];
    }
  if (!Number.isFinite(box[0])) box = [0, 0, 1, 1];
  const inBox = shown.filter((i) => overlaps(projected[i].box, box));
  const members = focus ? new Set(focus.ids.split(" ")) : null;
  const out: GeoLayout = {
    shapes,
    projected,
    projection,
    box,
    regions: members ? inBox.filter((i) => members.has(shapes[i].id)) : inBox,
    context: members ? inBox.filter((i) => !members.has(shapes[i].id)) : [],
    clip: !!focus,
    centers: projected.map(shapeCenter),
    match: geoMap ? mapMatcher(geoMap) : nameMatcher(shapes.map((s) => s.keys)),
  };
  if (!byKey) layouts.set(source, (byKey = new Map()));
  byKey.set(key, out);
  return out;
}

/** 평면 상자의 가로 대 세로 (지도 높이를 폭으로 정할 때) */
export function layoutAspect(g: GeoLayout): number {
  const w = g.box[2] - g.box[0];
  const h = g.box[3] - g.box[1];
  return w > 0 && h > 0 ? w / h : 2;
}

/** w × h에 맞춘 지도: 지역마다 길과 중심, 경위도 → 화면 좌표 */
export interface GeoFrame {
  fit: Fit;
  paths: string[];
  centers: [number, number][];
  /** [경도, 위도] → 화면 [x, y]. id를 주면 그 지역이 쓰는 도법 조각이에요 (미국의 알래스카, 하와이) */
  project: (lon: number, lat: number, id?: string) => [number, number];
}

/**
 * 크기에 맞춰 길을 만들어요. 길이 빈 지역(화면에서 1px보다 작아요)은 빈 글자예요.
 * box를 주면 지도 상자 대신 그 평면 상자에 맞춰요 (지점을 놓는 지도는 지도 밖 바다의 지점까지 들어가게 넓힌 상자)
 */
export function geoFrame(g: GeoLayout, w: number, h: number, pad = 2, box: readonly number[] = g.box): GeoFrame {
  const fit = fitBox(box, Math.max(1, w - pad * 2), Math.max(1, h - pad * 2));
  fit.tx += pad;
  fit.ty += pad;
  const used = new Set([...g.regions, ...g.context]);
  return {
    fit,
    paths: g.projected.map((s, i) => (used.has(i) ? ringsPath(s.rings, fit, [w, h]) : "")),
    centers: g.centers.map(([x, y]) => [x * fit.k + fit.tx, y * fit.k + fit.ty]),
    project: (lon, lat, id) => {
      const [x, y] = projectPoint(g.projection, lon, lat, id);
      return [x * fit.k + fit.tx, y * fit.k + fit.ty];
    },
  };
}
