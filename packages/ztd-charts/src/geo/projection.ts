import type { GeoShape, LonLat, ProjectionName } from "./types";

/** π / 180 (값으로 적어요: 맨 위 계산은 쓰지 않는 번들에도 남을 수 있어요) */
const RAD = 0.017453292519943295;
/** 감은 경도 (lon0 기준 -180~180) */
export const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** 라디안 경위도 → 단위 구 평면 (y는 위로) */
type Raw = (lam: number, phi: number) => [number, number];

/** Equal Earth (Šavrič, Patterson, Jenny 2018): 넓이가 맞고 대륙 모양이 덜 일그러진 세계 도법 */
const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
// √3 / 2. Math.sqrt를 맨 위에서 부르면 지도를 쓰지 않는 차트 번들에도 남아요
const M = 0.8660254037844386;
const equalEarthRaw: Raw = (lam, phi) => {
  const l = Math.asin(M * Math.sin(phi));
  const l2 = l * l;
  const l6 = l2 * l2 * l2;
  return [(lam * Math.cos(l)) / (M * (A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2))), l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2))];
};

/** 알베르스 정적 원뿔 도법 (표준 위선 두 개, 도). 두 위선이 적도를 사이에 두고 n이 0에 가까우면 람베르트 정적 원통 도법이에요 */
function conicRaw(lat1: number, lat2: number): Raw {
  const s1 = Math.sin(lat1 * RAD);
  const n = (s1 + Math.sin(lat2 * RAD)) / 2;
  if (Math.abs(n) < 1e-3) return (lam, phi) => [lam, Math.sin(phi)];
  const c = 1 + s1 * (2 * n - s1);
  const r0 = Math.sqrt(c) / n;
  return (lam, phi) => {
    const r = Math.sqrt(Math.max(0, c - 2 * n * Math.sin(phi))) / n;
    return [r * Math.sin(lam * n), r0 - r * Math.cos(lam * n)];
  };
}

/** 도법 한 조각: 중앙 경선(lon0), 가운데 점, 배율, 자리 옮김. 미국의 알래스카와 하와이는 따로 줄이고 옮긴 조각이에요 */
export interface SubProjection {
  lon0: number;
  /** lon0 기준으로 감은 경도와 위도(도) → 평면 [x, y] (y는 아래로) */
  raw: (lam: number, lat: number) => [number, number];
}

function sub(lon0: number, raw: Raw, center: LonLat = [0, 0], scale = 1, offset: [number, number] = [0, 0]): SubProjection {
  const [cx, cy] = raw(center[0] * RAD, center[1] * RAD);
  return {
    lon0,
    raw: (lam, lat) => {
      const [x, y] = raw(lam * RAD, Math.max(-90, Math.min(90, lat)) * RAD);
      return [scale * (x - cx) + offset[0], -scale * (y - cy) + offset[1]];
    },
  };
}

/** albersUsa에서 따로 줄이고 옮긴 조각의 지역 id (makeProjection의 pick, 지점 지도의 받는 상자가 같이 써요) */
export const ALBERS_INSETS: readonly string[] = ["AK", "HI"];

/** 도법: 점(과 지역 id)이 어느 조각으로 가는지 골라요. 지역 id를 주면 그 지역이 쓰는 조각이에요 (알래스카 "AK", 하와이 "HI") */
export interface Projection {
  name: ProjectionName;
  pick: (lon: number, lat: number, id?: string) => SubProjection;
}

/** [경도, 위도] → 단위 평면 [x, y] (y는 아래로). 바탕 지도와 같은 도법으로 다른 지점을 놓을 때 써요 */
export function projectPoint(p: Projection, lon: number, lat: number, id?: string): [number, number] {
  const s = p.pick(lon, lat, id);
  return s.raw(wrap(lon - s.lon0), lat);
}

/**
 * 도법 만들기. equalEarth는 lon0을 중앙 경선으로, conic은 경위도 상자 [서, 남, 동, 북] 가운데에 맞추고 표준 위선을 상자 높이의 1/6, 5/6에 둬요.
 * albersUsa는 본토 48개 주(29.5°, 45.5°), 알래스카(0.35배), 하와이를 d3-geo의 geoAlbersUsa와 같은 자리에 둬요
 */
export function makeProjection(name: ProjectionName, lon0 = 0, box?: readonly number[]): Projection {
  if (name === "albersUsa") {
    const lower = sub(-96, conicRaw(29.5, 45.5), [-0.6, 38.7]);
    const alaska = sub(-154, conicRaw(55, 65), [-2, 58.5], 0.35, [-0.307, 0.201]);
    const hawaii = sub(-157, conicRaw(8, 18), [-3, 19.9], 1, [-0.205, 0.212]);
    return {
      name,
      pick: (lon, lat, id) => {
        if (id !== undefined) return id === "AK" ? alaska : id === "HI" ? hawaii : lower;
        if (lat >= 50 && (lon <= -129 || lon >= 170)) return alaska;
        return lat >= 18 && lat <= 23 && lon >= -161 && lon <= -154 ? hawaii : lower;
      },
    };
  }
  if (name === "conic" && box) {
    const [, s, , n] = box;
    const one = sub(lon0, conicRaw(s + (n - s) / 6, s + ((n - s) * 5) / 6), [0, (s + n) / 2]);
    return { name, pick: () => one };
  }
  const one = sub(lon0, equalEarthRaw);
  return { name: "equalEarth", pick: () => one };
}

/**
 * 지역들의 경위도 상자 [서, 남, 동, 북]. 경도는 빈 곳이 가장 넓은 자리를 끊는 곳으로 봐서, 날짜 변경선에 걸친 지역(피지, 알류샨)도 좁게 잡아요.
 * 동쪽 끝은 180보다 클 수 있어요. 점이 없으면 null
 */
export function lonLatBox(shapes: readonly GeoShape[]): [number, number, number, number] | null {
  const lons: number[] = [];
  let s = Infinity;
  let n = -Infinity;
  for (const sh of shapes)
    for (const poly of sh.polygons)
      for (const [lon, lat] of poly[0]) {
        lons.push(wrap(lon));
        if (lat < s) s = lat;
        if (lat > n) n = lat;
      }
  if (!lons.length) return null;
  lons.sort((a, b) => a - b);
  let gap = lons[0] + 360 - lons[lons.length - 1];
  let west = lons[0];
  for (let i = 1; i < lons.length; i++) {
    if (lons[i] - lons[i - 1] > gap) {
      gap = lons[i] - lons[i - 1];
      west = lons[i];
    }
  }
  return [west, s, west + 360 - gap, n];
}

/** 이 상자에 맞는 도법 이름: 경도 150°나 위도 70°보다 넓으면 세계 도법, 아니면 원뿔 도법 */
export function autoProjection(box: readonly number[]): ProjectionName {
  return box[2] - box[0] > 150 || box[3] - box[1] > 70 ? "equalEarth" : "conic";
}

/** 세로선 x = at에서 고리를 잘라 keep 쪽(1: 오른쪽, -1: 왼쪽)만 남겨요 (서덜랜드-호지먼, 한 반평면) */
function clipSide(ring: LonLat[], at: number, keep: 1 | -1): LonLat[] {
  const out: LonLat[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ina = (a[0] - at) * keep >= 0;
    const inb = (b[0] - at) * keep >= 0;
    if (ina) out.push(a);
    if (ina !== inb) out.push([at, a[1] + ((b[1] - a[1]) * (at - a[0])) / (b[0] - a[0])]);
  }
  return out;
}

/**
 * 중앙 경선 기준으로 감은 고리를 ±180°(반대편 경선)에서 잘라요. 건너는 곳이 짝수면 경도를 이어 붙인 뒤 ±180에서 잘라 반대쪽 조각을 옮기고,
 * 홀수면(극을 감싸는 고리, 남극) 끊긴 자리에서 극까지 내려갔다 오는 점을 넣어요. 건너지 않으면 그대로예요
 */
export function cutRing(ring: LonLat[]): LonLat[][] {
  let jumps = 0;
  let at = -1;
  for (let i = 0; i < ring.length; i++) {
    if (Math.abs(ring[i][0] - ring[(i + ring.length - 1) % ring.length][0]) > 180) {
      jumps++;
      if (at < 0) at = i;
    }
  }
  if (!jumps) return [ring];
  if (jumps % 2) {
    const a = ring[(at + ring.length - 1) % ring.length];
    const b = ring[at];
    const side = a[0] > 0 ? 180 : -180;
    const span = 360 - Math.abs(a[0] - b[0]);
    const lat = a[1] + ((b[1] - a[1]) * (Math.abs(side - a[0]) || 0)) / (span || 1);
    const pole = ring.reduce((t, p) => t + p[1], 0) < 0 ? -90 : 90;
    return [[...ring.slice(0, at), [side, lat], [side, pole], [-side, pole], [-side, lat], ...ring.slice(at)]];
  }
  const un: LonLat[] = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    let lon = ring[i][0];
    const prev = un[i - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    un.push([lon, ring[i][1]]);
  }
  const out: LonLat[][] = [];
  for (const k of [-1, 0, 1]) {
    const piece = clipSide(clipSide(un, k * 360 - 180, 1), k * 360 + 180, -1);
    // 경선에 닿기만 한 고리는 넓이 0인 조각이 남아요 (그리면 지도 끝에 선이 생겨요)
    let area = 0;
    for (let i = 0, j = piece.length - 1; i < piece.length; j = i++) area += (piece[j][0] - piece[i][0]) * (piece[j][1] + piece[i][1]);
    if (piece.length >= 3 && Math.abs(area) > 1e-9) out.push(k ? piece.map(([x, y]) => [x - k * 360, y] as LonLat) : piece);
  }
  return out;
}

/** 도법에 올린 지역 하나: 고리마다 평면 점 [x0, y0, x1, y1 ...], 고리마다 몇 번째 다각형인지와 바깥 고리인지, 상자 */
export interface ProjectedShape {
  rings: Float64Array[];
  poly: number[];
  outer: boolean[];
  box: [number, number, number, number];
}

/** 지역의 고리를 도법 조각 기준으로 자르고 평면에 올려요. 지역 id로 조각을 골라요 (albersUsa) */
export function projectShape(p: Projection, shape: GeoShape): ProjectedShape {
  const rings: Float64Array[] = [];
  const polyOf: number[] = [];
  const outer: boolean[] = [];
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  shape.polygons.forEach((poly, pi) =>
    poly.forEach((ring, ri) => {
      const s = p.pick(ring[0][0], ring[0][1], p.name === "albersUsa" ? shape.id : undefined);
      for (const piece of cutRing(ring.map(([lon, lat]) => [wrap(lon - s.lon0), lat] as LonLat))) {
        const xy = new Float64Array(piece.length * 2);
        piece.forEach(([lam, lat], i) => {
          const [x, y] = s.raw(lam, lat);
          xy[i * 2] = x;
          xy[i * 2 + 1] = y;
          if (x < box[0]) box[0] = x;
          if (y < box[1]) box[1] = y;
          if (x > box[2]) box[2] = x;
          if (y > box[3]) box[3] = y;
        });
        rings.push(xy);
        polyOf.push(pi);
        outer.push(ri === 0);
      }
    }),
  );
  return { rings, poly: polyOf, outer, box };
}

/** 경위도 상자 [서, 남, 동, 북]의 테두리를 도법에 올린 평면 상자 (테두리마다 24점) */
export function projectedBox(p: Projection, box: readonly number[]): [number, number, number, number] {
  const out: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const [w, s, e, n] = box;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    for (const [lon, lat] of [
      [w + (e - w) * t, s],
      [w + (e - w) * t, n],
      [w, s + (n - s) * t],
      [e, s + (n - s) * t],
    ]) {
      const [x, y] = projectPoint(p, lon, lat);
      out[0] = Math.min(out[0], x);
      out[1] = Math.min(out[1], y);
      out[2] = Math.max(out[2], x);
      out[3] = Math.max(out[3], y);
    }
  }
  return out;
}

/** 평면 상자를 w × h 안 가운데에 맞추는 배율과 자리: 화면 x = k·x + tx */
export interface Fit {
  k: number;
  tx: number;
  ty: number;
}
export function fitBox(box: readonly number[], w: number, h: number): Fit {
  const bw = box[2] - box[0];
  const bh = box[3] - box[1];
  const k = bw > 0 && bh > 0 ? Math.min(w / bw, h / bh) : 1;
  return { k, tx: (w - bw * k) / 2 - box[0] * k, ty: (h - bh * k) / 2 - box[1] * k };
}

const r1 = (v: number) => Math.round(v * 10) / 10 || 0;

/**
 * 고리들을 SVG 길 하나로: 좌표는 0.1px로 반올림하고, 앞 점에서 0.35px 안의 점은 빼요(작은 SVG, 고정된 스냅숏).
 * 첫 점 뒤로는 앞 점과의 차이(l)로 적어요. 차이는 반올림한 좌표끼리라 쌓여도 어긋나지 않아요. 화면에서 1px보다 작아진 고리(작은 섬, 독도)는
 * 그 자리의 1.6px 네모로 그려서 지도에서 사라지지 않아요(경계선 0.6px을 그려도 1px이 보여요). minSide를 주면 짧은 변이 그보다 작은 고리는 빼요(테두리용).
 * view(폭, 높이) 밖에 통째로 있는 고리는 빼요 (집중한 지도에서 잘려 안 보이는 나라. 덤으로 resvg가 잘린 빈 도형에서 멈추지 않아요). 남은 것이 없으면 빈 글자
 */
export function ringsPath(rings: readonly Float64Array[], f: Fit, view?: readonly [number, number], minSide = 0): string {
  let d = "";
  for (const xy of rings) {
    let part = "";
    let px = NaN;
    let py = NaN;
    let n = 0;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < xy.length; i += 2) {
      const x = r1(xy[i] * f.k + f.tx);
      const y = r1(xy[i + 1] * f.k + f.ty);
      if (Math.abs(x - px) < 0.35 && Math.abs(y - py) < 0.35) continue;
      part += n ? `${n === 1 ? "l" : " "}${r1(x - px)} ${r1(y - py)}` : `M${x} ${y}`;
      px = x;
      py = y;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const outside = view !== undefined && (x1 < 0 || y1 < 0 || x0 > view[0] || y0 > view[1]);
    if (outside || Math.min(x1 - x0, y1 - y0) < minSide) continue;
    if (n >= 3 && (x1 - x0 >= 1 || y1 - y0 >= 1)) d += `${part}Z`;
    else if (!minSide) d += `M${r1((x0 + x1) / 2 - 0.8)} ${r1((y0 + y1) / 2 - 0.8)}h1.6v1.6h-1.6Z`;
  }
  return d;
}

/** 고리의 넓이(부호 있음)와 넓이 중심 (평면 좌표) */
function ringMoments(xy: Float64Array): [number, number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = xy.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const c = xy[j * 2] * xy[i * 2 + 1] - xy[i * 2] * xy[j * 2 + 1];
    a += c;
    cx += (xy[j * 2] + xy[i * 2]) * c;
    cy += (xy[j * 2 + 1] + xy[i * 2 + 1]) * c;
  }
  return [a / 2, a ? cx / (3 * a) : NaN, a ? cy / (3 * a) : NaN];
}

/**
 * 지역 안의 한 점 (화면 좌표): 가장 넓은 다각형(구멍을 뺀 넓이)의 넓이 중심 높이에서 가로로 그은 선이 다각형 안을 지나는 가장 긴 구간의 가운데.
 * 넓이 중심은 구멍(경기도 안의 서울)이나 바깥(굽은 나라)에 떨어질 수 있어서 이렇게 해요. 평면 좌표라 크기가 바뀌어도 다시 재지 않아요
 */
export function shapeCenter(s: ProjectedShape): [number, number] {
  const area = new Map<number, number>();
  const m = s.rings.map(ringMoments);
  s.rings.forEach((_, i) => area.set(s.poly[i], (area.get(s.poly[i]) ?? 0) + (s.outer[i] ? 1 : -1) * Math.abs(m[i][0])));
  let best = -1;
  let bestA = 0;
  for (const [p, a] of area)
    if (a > bestA) {
      bestA = a;
      best = p;
    }
  if (best < 0) return [NaN, NaN];
  const mine = s.rings.map((_, i) => i).filter((i) => s.poly[i] === best);
  // 바깥 고리들의 넓이 중심 높이 (넓이로 가중)
  let wy = 0;
  let wa = 0;
  for (const i of mine)
    if (s.outer[i]) {
      wy += m[i][2] * Math.abs(m[i][0]);
      wa += Math.abs(m[i][0]);
    }
  const y = wy / wa;
  const xs: number[] = [];
  for (const i of mine) {
    const xy = s.rings[i];
    const n = xy.length / 2;
    for (let a = 0, b = n - 1; a < n; b = a++) {
      const y1 = xy[a * 2 + 1];
      const y2 = xy[b * 2 + 1];
      if (y1 > y !== y2 > y) xs.push(xy[a * 2] + ((xy[b * 2] - xy[a * 2]) * (y - y1)) / (y2 - y1));
    }
  }
  xs.sort((a, b) => a - b);
  let x = NaN;
  let span = -1;
  for (let k = 0; k + 1 < xs.length; k += 2)
    if (xs[k + 1] - xs[k] > span) {
      span = xs[k + 1] - xs[k];
      x = (xs[k] + xs[k + 1]) / 2;
    }
  return [x, y];
}
