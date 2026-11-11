/** 도법 이름. "equalEarth"는 세계, "albersUsa"는 알래스카와 하와이를 옮겨 붙인 미국, "conic"은 지역 가운데에 맞춘 원뿔 정적 도법이에요 */
export type ProjectionName = "equalEarth" | "albersUsa" | "conic";

/**
 * 내장 지도 하나 (ztd-charts/geo/world 같은 입구가 내보내요). registerMap으로 등록하거나 map 프롭으로 바로 넘겨요.
 * 경계는 TopoJSON처럼 선을 지역끼리 나눠 쓰고, 좌표는 눈금에 맞춘 차이를 글자로 압축했어요 (geo/codec.ts가 풀어요)
 */
export interface GeoMap {
  /** options.map에 쓰는 이름. 예: "world" */
  name: string;
  projection: ProjectionName;
  /** 지역마다 [id, 영어 이름, 받는 이름...]. 순서가 topo.shapes와 같아요 */
  regions: readonly (readonly string[])[];
  /** 지역 id → 한국어 이름 */
  namesKo?: Readonly<Record<string, string>>;
  /** 크게 볼 수 있는 묶음(대륙): 이름 → [서, 남, 동, 북] 경위도 상자, 중앙 경선, 묶음에 드는 지역 id(빈칸으로 나눔) */
  focus?: Readonly<Record<string, { box: readonly [number, number, number, number]; lon0: number; ids: string }>>;
  /** 기본으로 그리지 않는 지역 id (세계 지도의 남극) */
  hidden?: readonly string[];
  /** 압축한 경계: t는 [눈금, x 시작, y 시작], arcs는 선, shapes는 지역마다 다각형, 고리, 선 번호 */
  topo: { t: readonly number[]; arcs: string; shapes: string };
  /** 출처와 이용 조건 한 줄 */
  source: string;
}

/** [경도, 위도] (도) */
export type LonLat = [number, number];

/** 풀어 놓은 지역 하나. polygons는 다각형마다 고리 목록이고, 첫 고리가 바깥이에요 */
export interface GeoShape {
  id: string;
  name: string;
  nameKo?: string;
  /** 맞출 때 받는 이름 (id, 이름, 한국어 이름, 다른 이름, 코드) */
  keys: readonly string[];
  polygons: LonLat[][][];
}

/** GeoJSON FeatureCollection (경위도 도). Polygon, MultiPolygon만 그려요 */
export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: readonly {
    type?: string;
    id?: string | number;
    properties?: Record<string, unknown> | null;
    geometry?: { type: string; coordinates?: unknown } | null;
  }[];
}
