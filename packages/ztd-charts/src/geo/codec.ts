import type { GeoJSONFeatureCollection, GeoMap, GeoShape, LonLat } from "./types";

/** 압축 글자표 (scripts/build-geo.mjs의 pack과 같아요): 한 글자에 5비트, 6번째 비트는 다음 글자로 이어짐 */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 한 정수에 쓰는 글자 수의 상한 (5비트 × 7 = 35비트). 넘으면 망가진 글자로 보고 그 수를 버려요 */
const MAX_DIGITS = 7;

/** 글자 → 정수 목록 (지그재그를 풀어 음수도 돌려줘요). 글자표 밖 글자는 건너뛰어요 */
function unpack(s: unknown): number[] {
  if (typeof s !== "string") return [];
  const code = new Int8Array(128).fill(-1);
  for (let i = 0; i < 64; i++) code[B64.charCodeAt(i)] = i;
  const out: number[] = [];
  let v = 0;
  let mul = 1;
  let digits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = code[s.charCodeAt(i)] ?? -1;
    if (c < 0) continue;
    v += (c & 31) * mul;
    digits++;
    if (c & 32 && digits < MAX_DIGITS) mul *= 32;
    else {
      if (!(c & 32)) out.push(v % 2 ? -(v + 1) / 2 : v / 2);
      v = 0;
      mul = 1;
      digits = 0;
    }
  }
  return out;
}

const decoded = /* @__PURE__ */ new WeakMap<GeoMap, GeoShape[]>();

/** 0 이상 정수이고 남은 입력보다 크지 않은 개수만 받아요 (꾸민 지도가 끝없이 돌게 하지 못해요). 아니면 -1 */
const count = (n: unknown, left: number) => (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= left ? n : -1);

/**
 * 내장 지도의 지역과 경계. 선을 지역끼리 나눠 써서(TopoJSON처럼) 고리마다 선을 이어 붙여요.
 * 고정 데이터라 지도마다 한 번만 풀어요 (같은 배열을 돌려주니 고치지 마세요).
 * 데이터에서 읽은 개수는 남은 입력보다 클 수 없고, 만드는 점은 선의 점 수 × 4를 넘지 않아요. 어긋나면 거기서 멈추고 그때까지 읽은 것만 써요
 */
export function mapShapes(m: GeoMap): GeoShape[] {
  const hit = decoded.get(m);
  if (hit) return hit;
  const t = Array.isArray(m.topo?.t) ? m.topo.t : [];
  const [step, tx, ty] = t.every((v) => Number.isFinite(v)) && t.length >= 3 ? t : [NaN, NaN, NaN];
  const ok = Number.isFinite(step) && step > 0;
  const a = ok ? unpack(m.topo.arcs) : [];
  const arcs: LonLat[][] = [];
  let total = 0;
  for (let i = 0; i < a.length; ) {
    const n = count(a[i++], (a.length - i) / 2);
    if (n < 0) break;
    const pts: LonLat[] = [];
    let x = 0;
    let y = 0;
    for (let k = 0; k < n; k++) {
      x += a[i++];
      y += a[i++];
      pts.push([x * step + tx, y * step + ty]);
    }
    total += n;
    arcs.push(pts);
  }
  const s = ok ? unpack(m.topo.shapes) : [];
  let j = 0;
  let budget = total * 4;
  const rows = Array.isArray(m.regions) ? m.regions : [];
  const out = rows.map((raw): GeoShape => {
    const row = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
    const polygons: LonLat[][][] = [];
    for (let np = count(s[j++], s.length - j); np > 0; np--) {
      const rings: LonLat[][] = [];
      for (let nr = count(s[j++], s.length - j); nr > 0; nr--) {
        const ring: LonLat[] = [];
        for (let na = count(s[j++], s.length - j), k = 0; k < na; k++) {
          const r = s[j++];
          const pts = (r >= 0 ? arcs[r] : arcs[~r]?.slice().reverse()) ?? [];
          budget -= pts.length;
          if (budget < 0) break;
          for (let q = k ? 1 : 0; q < pts.length; q++) ring.push(pts[q]);
        }
        // 닫는 점(첫 점과 같은 끝 점)은 빼요. 길은 Z로 닫아요
        if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
        if (ring.length >= 3) rings.push(ring);
        if (budget < 0 || j > s.length) break;
      }
      if (rings.length) polygons.push(rings);
      if (budget < 0 || j > s.length) break;
    }
    const id = row[0] ?? "";
    const ko = m.namesKo?.[id];
    return { id, name: row[1] ?? id, nameKo: typeof ko === "string" ? ko : undefined, keys: typeof ko === "string" ? [...row, ko] : row, polygons };
  });
  decoded.set(m, out);
  return out;
}

/** 스펙으로 받는 GeoJSON의 상한: 지물 수와 좌표 수 (MCP 서버는 남이 쓴 스펙을 그려요). 코드에서 넘기는 GeoJSON은 막지 않아요 */
export const GEOJSON_LIMITS = { features: 20_000, points: 1_000_000 };

/** GeoJSON의 지물 수와 좌표 수를 새 배열을 만들지 않고 세요 (상한을 넘으면 거기서 멈춰요) */
export function geojsonSize(fc: GeoJSONFeatureCollection): { features: number; points: number } {
  const features = Array.isArray(fc.features) ? fc.features : [];
  let points = 0;
  for (const f of features) {
    const g = f && typeof f === "object" ? f.geometry : null;
    const c = g && Array.isArray(g.coordinates) ? (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []) : [];
    for (const poly of c as unknown[]) if (Array.isArray(poly)) for (const ring of poly) if (Array.isArray(ring)) points += ring.length;
    if (points > GEOJSON_LIMITS.points) break;
  }
  return { features: features.length, points };
}

/** GeoJSON을 지역 목록으로 바꾼 결과: 그릴 도형이 없어 뺀 지물 번호, 범위 밖 좌표 수(위도는 ±90으로 묶고 경도는 감아요) */
export interface GeoJSONShapes {
  shapes: GeoShape[];
  skipped: number[];
  outOfRange: number;
}

const textOf = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined);

/** 고리 하나: 숫자 두 개짜리 점만, 위도는 ±90 안으로, 이어진 같은 점과 닫는 점은 빼요. 점이 3개가 안 되면 null */
function cleanRing(raw: unknown, bad: { n: number }): LonLat[] | null {
  if (!Array.isArray(raw)) return null;
  const out: LonLat[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number" || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    let [lon, lat] = p as [number, number];
    if (lat > 90 || lat < -90 || lon > 540 || lon < -540) {
      bad.n++;
      lat = Math.max(-90, Math.min(90, lat));
      lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    } else if (lon > 180 || lon < -180) bad.n++;
    const last = out[out.length - 1];
    if (!last || last[0] !== lon || last[1] !== lat) out.push([lon, lat]);
  }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out.length >= 3 ? out : null;
}

/**
 * GeoJSON FeatureCollection(경위도 도)을 지역 목록으로. Polygon, MultiPolygon만 그리고, 바깥 고리가 없는 다각형과 도형이 없는 지물은 빼요.
 * id는 idKey 속성, feature.id, 속성 id, code 순서, 이름은 nameKey 속성, 속성 name, NAME 순서예요. 없으면 몇 번째 지물인지(1부터)
 */
export function geojsonShapes(fc: GeoJSONFeatureCollection, idKey?: string, nameKey?: string): GeoJSONShapes {
  // 검사기와 차트가 같은 GeoJSON을 두 번 읽지 않게 객체와 속성 이름마다 한 번만 읽어요
  const key = `${idKey ?? ""}\u0001${nameKey ?? ""}`;
  let byKey = read.get(fc);
  const hit = byKey?.get(key);
  if (hit) return hit;
  const out = readGeojson(fc, idKey, nameKey);
  if (!byKey) read.set(fc, (byKey = new Map()));
  byKey.set(key, out);
  return out;
}

const read = /* @__PURE__ */ new WeakMap<object, Map<string, GeoJSONShapes>>();

function readGeojson(fc: GeoJSONFeatureCollection, idKey?: string, nameKey?: string): GeoJSONShapes {
  const shapes: GeoShape[] = [];
  const skipped: number[] = [];
  const bad = { n: 0 };
  (Array.isArray(fc.features) ? fc.features : []).forEach((f, i) => {
    const props = (f && typeof f.properties === "object" && f.properties) || {};
    const g = f?.geometry;
    const coords = g && Array.isArray(g.coordinates) ? (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []) : [];
    const polygons: LonLat[][][] = [];
    for (const poly of coords as unknown[]) {
      if (!Array.isArray(poly)) continue;
      const outer = cleanRing(poly[0], bad);
      if (!outer) continue;
      polygons.push([outer, ...poly.slice(1).map((r) => cleanRing(r, bad)).filter((r): r is LonLat[] => r !== null)]);
    }
    // 그릴 도형이 없는 지물은 지역이 아니에요 (그 지역 행은 맞지 않는 행으로 알려요)
    if (!polygons.length) return void skipped.push(i);
    const id = (idKey ? textOf(props[idKey]) : undefined) ?? textOf(f?.id) ?? textOf(props.id) ?? textOf(props.code) ?? String(i + 1);
    const name = (nameKey ? textOf(props[nameKey]) : undefined) ?? textOf(props.name) ?? textOf(props.NAME) ?? id;
    shapes.push({ id, name, keys: [...new Set([id, name, textOf(f?.id)].filter((k): k is string => !!k))], polygons });
  });
  return { shapes, skipped, outOfRange: bad.n };
}
