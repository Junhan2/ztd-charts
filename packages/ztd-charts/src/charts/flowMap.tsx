import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { cssEntrance, useCssEntrance } from "../core/css";
import { clamp } from "../core/geometry";
import { HIGHLIGHT_KEYWORDS, resolveHighlight } from "../core/highlight";
import { plural, type ChartLang } from "../core/i18n";
import type { Mark } from "../core/motion";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Highlight, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { hasField, numGetter, strGetter } from "../data/accessor";
import { BaseMap } from "../geo/BaseMap";
import { MapLabel } from "../geo/MapLabel";
import { MAX_FLOWS, choosePlaceMap, flowPlace, flowRowOk, placeDomain, placeIn } from "../geo/places";
import { canCenter, cap, chooseCenter, mapNotLoaded, placeLabels, planePoint, pointBox, r1, regionLonLat, sharePct, type MapCenter, type MapPoint, type Rect } from "../geo/pointMap";
import { wrap, type SubProjection } from "../geo/projection";
import type { GeoJSONFeatureCollection, GeoMap } from "../geo/types";
import { geoFrame, geoLayout, layoutAspect, type GeoFrame } from "../geo/view";

const en = {
  kind: "Flow map",
  to: (a: string, b: string) => `${a} to ${b}`,
  share: (s: string) => `${s} of the total`,
  shareLabel: "Share",
  out: "Outgoing",
  in: "Incoming",
  largest: "Largest flows",
  desc: (n: number, places: number, total: string, top: string) => `${plural(n, "flow")} between ${plural(places, "place")}, ${total} in total. Largest: ${top}`,
  skipped: (n: number) => `${plural(n, "flow")} could not be placed on the map`,
  capped: (shown: number, n: number) => `The ${shown} largest of ${n} flows are drawn`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "흐름 지도",
    to: (a, b) => `${a}에서 ${b}`,
    share: (s) => `전체의 ${s}`,
    shareLabel: "비율",
    out: "나감",
    in: "들어옴",
    largest: "큰 흐름",
    desc: (n, places, total, top) => `지점 ${places}곳 사이 흐름 ${n}개, 합계 ${total}. 가장 큰 흐름: ${top}`,
    skipped: (n) => `지도에 놓지 못한 흐름 ${n}개`,
    capped: (shown, n) => `흐름 ${n}개 중 큰 ${shown}개를 그려요`,
  },
};

export interface FlowMapProps<T = Row> extends BaseChartProps<T> {
  /** 출발지 필드. 기본 "source" (없으면 "from"). 생키, 코드, 네트워크와 같은 행 꼴이에요 */
  source?: Accessor<T, string>;
  /** 도착지 필드. 기본 "target" (없으면 "to") */
  target?: Accessor<T, string>;
  /** 양 필드. 없으면(데이터에 "value" 필드도 없으면) 행마다 1이에요 */
  value?: Accessor<T, number>;
  /** 자리 이름 → [경도, 위도]. 여기 없는 이름은 지도의 지역(나라, 주) 가운데에 놓아요 */
  places?: Readonly<Record<string, readonly [number, number]>>;
  /** 바탕 지도: "auto"(기본, 자리를 가장 많이 받는 지도, 같으면 좁은 지도), 등록한 지도 이름, ztd-charts/geo/* 의 지도 객체, GeoJSON */
  map?: string | GeoMap | GeoJSONFeatureCollection;
  /** 세계 지도의 묶음만 크게: "europe", "asia", "africa", "americas", "oceania". 밖의 자리와 그 흐름은 빼요 */
  focus?: string;
  featureId?: string;
  featureName?: string;
  /** 지도 옆 큰 흐름 목록. "auto"는 폭이 600px 이상일 때만. 기본 "auto" */
  ranking?: boolean | "auto";
  /** 세계 지도의 가운데: "auto"(기본, 지도 끝에서 끊기는 흐름의 양이 적은 쪽), "atlantic"(경도 0), "pacific"(경도 150, 대서양에서 잘려요) */
  center?: MapCenter;
}

/** 흐름 이름 "출발 → 도착" (툴팁 제목, 목록, 강조 이름. 언어와 상관없어요) */
const arrow = (a: string, b: string) => `${a} → ${b}`;

/** 순위 목록 폭, 줄 높이, 지도와의 사이, 목록을 붙이는 최소 폭 (단계구분도와 같아요) */
const LIST_W = 172;
const ROW_H = 17;
const LIST_GAP = 16;
const LIST_MIN_W = 600;
/** 흐름이 이보다 많으면 선마다 넓은 투명 선(호버 자리)을 깔지 않아요 (네트워크와 같은 까닭) */
const HIT_FLOWS = 400;
/** 굽힘: 두 자리 사이 거리에 대한 가운데 조절점의 옆 거리. 진행 방향 오른쪽으로 굽어서 반대 방향 흐름은 반대쪽으로 굽어요 */
const BEND = 0.22;

interface Place {
  name: string;
  at: MapPoint;
  out: number;
  in: number;
}
interface Flow<T> {
  a: number;
  b: number;
  value: number;
  datum: T;
  row: number;
}

type XY = [number, number];
const lerp = (p: XY, q: XY, t: number): XY => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
const qAt = (p0: XY, c: XY, p1: XY, t: number): XY => lerp(lerp(p0, c, t), lerp(c, p1, t), t);

/** 곡선 위에서 끝점 p1과의 거리가 d인 t (뒤쪽 절반에서 이분 탐색 24번). 곡선이 그보다 짧으면 0 */
function tAtDistance(p0: XY, c: XY, p1: XY, d: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const q = qAt(p0, c, p1, mid);
    if (Math.hypot(q[0] - p1[0], q[1] - p1[1]) > d) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** 그릴 조각 하나: 선 길, 화살촉(없으면 ""), 날짜 변경선에서 자를 조각이면 그 도법 조각 */
interface Piece {
  d: string;
  arrow: string;
  cut: SubProjection | null;
}

/**
 * 흐름 하나의 조각들. 같은 도법 조각에서 짧은 길이 날짜 변경선(중앙 경선의 반대편)을 건너면, 도착지를 한 바퀴 옮긴 곡선(지도 오른쪽 밖으로 나감)과
 * 출발지를 옮긴 곡선(왼쪽 밖에서 들어옴) 둘로 그리고 지구 테두리로 잘라요. 화살촉은 진짜 도착지 쪽 조각 끝에 둬요
 */
function flowPieces(A: MapPoint, B: MapPoint, fr: GeoFrame, rB: number, w: number): Piece[] {
  const k = fr.fit.k;
  const scr = (m: { x: number; y: number }): XY => [m.x * k + fr.fit.tx, m.y * k + fr.fit.ty];
  const a = scr(A);
  const b = scr(B);
  if (A.sub === B.sub) {
    const la = wrap(A.lon - A.sub.lon0);
    const lb = wrap(B.lon - B.sub.lon0);
    if (Math.abs(lb - la) > 180) {
      const s = Math.sign(lb - la);
      const shift = (m: MapPoint, lam: number, by: number): XY => {
        const [x0, y0] = m.sub.raw(lam, m.lat);
        const [x1, y1] = m.sub.raw(lam + by, m.lat);
        const p = scr(m);
        return [p[0] + (x1 - x0) * k, p[1] + (y1 - y0) * k];
      };
      const out = curve(a, shift(B, lb, -360 * s), 0, 0, A.sub);
      const into = curve(shift(A, la, 360 * s), b, rB, w, A.sub);
      // 지도 끝에서 끊긴 두 조각이 한 흐름으로 읽히게 나가는 끝과 들어오는 끝에 같은 화살촉을 둬요
      const ring = sphereRing(A.sub, fr);
      out.arrow = edgeArrow(a, shift(B, lb, -360 * s), ring, w, false);
      into.arrow = `${edgeArrow(shift(A, la, 360 * s), b, ring, w, true)}${into.arrow}`;
      return [out, into];
    }
  }
  return [curve(a, b, rB, w, null)];
}

/** 곡선의 가운데 조절점 (진행 방향 오른쪽) */
const control = (p0: XY, p1: XY): XY => [(p0[0] + p1[0]) / 2 - (p1[1] - p0[1]) * BEND, (p0[1] + p1[1]) / 2 + (p1[0] - p0[0]) * BEND];
/** 화살촉 길이와 반폭 (선 굵기 w에 따라) */
const arrowSize = (w: number): [number, number] => [clamp(w * 1.4 + 4, 6, 20), clamp(w * 0.8 + 2.5, 3.5, 13)];
/** tip을 끝으로, base 쪽에서 오는 화살촉 길 */
function arrowPath(tip: XY, base: XY, half: number): string {
  const ux = tip[0] - base[0];
  const uy = tip[1] - base[1];
  const ul = Math.hypot(ux, uy) || 1;
  const nx = (-uy / ul) * half;
  const ny = (ux / ul) * half;
  return `M${r1(tip[0])} ${r1(tip[1])}L${r1(base[0] + nx)} ${r1(base[1] + ny)}L${r1(base[0] - nx)} ${r1(base[1] - ny)}Z`;
}

/** 점이 고리(화면 좌표 다각형) 안인지 */
function inside(q: XY, ring: readonly XY[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * 지도 끝의 화살촉: 곡선을 48칸으로 나눠 지구 테두리 안에 있는 마지막 칸(나가는 조각) 또는 첫 칸(들어오는 조각)에서 진행 방향으로 둬요.
 * 테두리 안에 든 칸이 없으면 빈 글자
 */
function edgeArrow(p0: XY, p1: XY, ring: readonly XY[], w: number, entering: boolean): string {
  const c = control(p0, p1);
  const [aLen, half] = arrowSize(w);
  let edge = -1;
  for (let i = 0; i <= 48; i++) {
    const t = entering ? i / 48 : 1 - i / 48;
    if (inside(qAt(p0, c, p1, t), ring)) {
      edge = t;
      break;
    }
  }
  if (edge < 0) return "";
  const tip = qAt(p0, c, p1, edge);
  const step = entering ? Math.min(1, edge + 0.01) : Math.max(0, edge - 0.01);
  const toward = qAt(p0, c, p1, step);
  // 진행 방향: 나가는 조각은 앞(끝 쪽)으로, 들어오는 조각도 앞으로 (화살촉 뿌리는 진행 반대쪽)
  const dx = entering ? toward[0] - tip[0] : tip[0] - toward[0];
  const dy = entering ? toward[1] - tip[1] : tip[1] - toward[1];
  const dl = Math.hypot(dx, dy) || 1;
  const head: XY = entering ? [tip[0] + (dx / dl) * aLen, tip[1] + (dy / dl) * aLen] : tip;
  const base: XY = [head[0] - (dx / dl) * aLen, head[1] - (dy / dl) * aLen];
  return arrowPath(head, base, half);
}

/** p0에서 p1까지 오른쪽으로 굽은 2차 곡선. rB > 0이면 끝을 도착 점 둘레에서 멈추고 화살촉을 둬요 */
function curve(p0: XY, p1: XY, rB: number, w: number, cut: SubProjection | null): Piece {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  if (len < 1) return { d: "", arrow: "", cut };
  const c = control(p0, p1);
  const [aLen, half] = arrowSize(w);
  // 너무 짧으면(점 둘과 화살촉이 들어가지 않으면) 화살촉 없이 이어요
  if (!(rB > 0) || len < rB * 2 + aLen + 6) return { d: `M${r1(p0[0])} ${r1(p0[1])}Q${r1(c[0])} ${r1(c[1])} ${r1(p1[0])} ${r1(p1[1])}`, arrow: "", cut };
  const tTip = tAtDistance(p0, c, p1, rB + 1.5);
  const tBase = tAtDistance(p0, c, p1, rB + 1.5 + aLen);
  // 선은 화살촉 밑동보다 조금 안까지 (밑동과 선 사이 틈이 없게)
  const tEnd = tAtDistance(p0, c, p1, rB + 1.5 + aLen * 0.6);
  const end = qAt(p0, c, p1, tEnd);
  const sc = lerp(p0, c, tEnd);
  const tip = qAt(p0, c, p1, tTip);
  const base = qAt(p0, c, p1, tBase);
  return {
    d: `M${r1(p0[0])} ${r1(p0[1])}Q${r1(sc[0])} ${r1(sc[1])} ${r1(end[0])} ${r1(end[1])}`,
    arrow: arrowPath(tip, base, half),
    cut,
  };
}

/** 도법 조각의 지구 테두리(중앙 경선 반대편 두 줄, 위도 3°마다)를 화면 점으로. 날짜 변경선을 건너는 흐름을 자르고 끝 화살촉을 둘 때 써요 */
function sphereRing(sub: SubProjection, fr: GeoFrame): XY[] {
  const at = ([x, y]: [number, number]): XY => [x * fr.fit.k + fr.fit.tx, y * fr.fit.k + fr.fit.ty];
  const pts: XY[] = [];
  for (let lat = -90; lat <= 90; lat += 3) pts.push(at(sub.raw(180, lat)));
  for (let lat = 90; lat >= -90; lat -= 3) pts.push(at(sub.raw(-180, lat)));
  return pts;
}
const sphereOutline = (sub: SubProjection, fr: GeoFrame) => `M${sphereRing(sub, fr).map(([x, y]) => `${r1(x)} ${r1(y)}`).join("L")}Z`;

/**
 * 흐름 지도: 출발지와 도착지를 굽은 선으로 잇고 굵기가 양이에요. 도착지에 화살촉이 있어 방향이 읽히고, 반대 방향 흐름은 반대쪽으로 굽어 둘 다 보여요.
 * 가장 큰 흐름이 강조색이고, 가는 선을 굵은 선 위에 그려요. 자리는 options.places의 경위도나 지도의 지역 이름이에요.
 * 행 꼴(source, target, value)이 생키, 코드, 네트워크와 같아서 한 데이터로 바꿔 볼 수 있어요
 */
export function FlowMap<T = Row>(props: FlowMapProps<T>) {
  // 행을 흐름으로: 이름 앞뒤 빈칸은 떼요. 같은 방향의 같은 쌍은 더해요(네트워크, 코드와 같은 규칙). 빈 이름, 자기 자신, 0 이하나 숫자가 아닌 값은 빼요
  const pairs = useMemo(() => {
    const has = (k: string) => props.data.some((d) => d !== null && typeof d === "object" && hasField(d as object, k));
    const gs = strGetter(props.source ?? (has("source") ? "source" : "from"), "source");
    const gt = strGetter(props.target ?? (has("target") ? "target" : "to"), "target");
    const weighted = props.value !== undefined || has("value");
    const gv = numGetter(props.value, "value");
    const byKey = new Map<string, { s: string; t: string; value: number; datum: T; row: number }>();
    props.data.forEach((d, row) => {
      const s = gs(d, row).trim();
      const t = gt(d, row).trim();
      const v = weighted ? gv(d, row) : 1;
      if (!flowRowOk(s, t, v)) return;
      const key = `${s}\u0001${t}`;
      const hit = byKey.get(key);
      if (hit) hit.value = cap(hit.value + v);
      else byKey.set(key, { s, t, value: v, datum: d, row });
    });
    return [...byKey.values()];
  }, [props.data, props.source, props.target, props.value]);
  const names = useMemo(() => {
    const seen = new Set<string>();
    for (const f of pairs) seen.add(f.s).add(f.t);
    return [...seen];
  }, [pairs]);

  const choice = useMemo(() => choosePlaceMap(props.map, () => names.map((nm) => flowPlace(props.places, nm))), [props.map, props.places, names]);
  const source = choice && "map" in choice ? choice.map : null;
  const geoOpts = useMemo(() => ({ focus: props.focus, featureId: props.featureId, featureName: props.featureName }), [props.focus, props.featureId, props.featureName]);
  // 이름마다 자리 (도법 전에: 가운데를 고르는 데 경도가 필요해요)
  const placedOf = useMemo(() => {
    const out = new Map<string, ReturnType<typeof placeIn>>();
    if (!source) return out;
    const domain = placeDomain(source, geoOpts);
    for (const name of names) out.set(name, placeIn(domain, flowPlace(props.places, name)));
    return out;
  }, [source, geoOpts, names, props.places]);
  const lon0 = useMemo(() => {
    if (!source || !canCenter(source, props.focus)) return undefined;
    const domain = placeDomain(source, geoOpts);
    const lonOf = (name: string) => {
      const at = placedOf.get(name);
      return !at || "miss" in at ? NaN : "lon" in at ? at.lon : regionLonLat(domain.shapes[at.region])[0];
    };
    const segs = pairs.flatMap((f) => {
      const a = lonOf(f.s);
      const b = lonOf(f.t);
      return Number.isFinite(a) && Number.isFinite(b) ? [{ a, b, w: f.value }] : [];
    });
    return chooseCenter(props.center, segs, []);
  }, [source, geoOpts, placedOf, pairs, props.focus, props.center]);
  const layout = useMemo(() => (source ? geoLayout(source, { ...geoOpts, lon0 }) : null), [source, geoOpts, lon0]);
  const aspect = layout ? layoutAspect(layout) : 2;
  const listFor = (w: number) => props.ranking === true || (props.ranking !== false && w >= LIST_MIN_W);
  const c = useChart(props, {
    height: (w) => Math.round(Math.max(120, Math.min((listFor(w) ? w - LIST_W - LIST_GAP : w) / aspect, w * 0.85))),
    duration: 1100,
  });
  const { p, width: W, height: H, fv } = c;
  const msg = MSG[c.lang];
  const uid = useId().replace(/:/g, "");

  // 자리를 지도에 놓고, 두 자리가 다 놓인 흐름만 남겨 큰 것부터 (같으면 데이터 순서). 합계와 자리마다 나가고 들어온 양은 모든 흐름으로 세요
  const model = useMemo(() => {
    if (!layout) return { places: [] as Place[], flows: [] as Flow<T>[], all: 0, total: 0, skipped: pairs.length };
    // 같은 지역에 맞는 이름("United States"와 "united states", "USA")은 자리 하나예요 (먼저 나온 이름으로 적어요)
    const index = new Map<string, number>();
    const byRegion = new Map<number, number>();
    const places: Place[] = [];
    for (const name of names) {
      const placed = placedOf.get(name)!;
      const same = "region" in placed ? byRegion.get(placed.region) : undefined;
      if (same !== undefined) {
        index.set(name, same);
        continue;
      }
      const at = planePoint(layout, placed);
      if (!at) continue;
      if ("region" in placed) byRegion.set(placed.region, places.length);
      index.set(name, places.length);
      places.push({ name, at, out: 0, in: 0 });
    }
    // 합친 자리끼리의 흐름도 방향마다 하나로 더해요. 합쳐서 같은 자리로 가는 흐름은 빼요
    const list: Flow<T>[] = [];
    const flowAt = new Map<number, Flow<T>>();
    for (const f of pairs) {
      const a = index.get(f.s);
      const b = index.get(f.t);
      if (a === undefined || b === undefined || a === b) continue;
      const hit = flowAt.get(a * places.length + b);
      if (hit) hit.value = cap(hit.value + f.value);
      else {
        const fl = { a, b, value: f.value, datum: f.datum, row: f.row };
        flowAt.set(a * places.length + b, fl);
        list.push(fl);
      }
      places[a].out = cap(places[a].out + f.value);
      places[b].in = cap(places[b].in + f.value);
    }
    list.sort((x, y) => y.value - x.value || x.row - y.row);
    let total = 0;
    for (const f of list) total = cap(total + f.value);
    // 자리를 놓지 못한 흐름 수 (빈 이름, 자기 자신, 값이 틀린 행은 validateSpec이 알려요)
    return { places, flows: list.slice(0, MAX_FLOWS), all: list.length, total, skipped: pairs.filter((f) => index.get(f.s) === undefined || index.get(f.t) === undefined).length };
  }, [layout, placedOf, names, pairs]);
  const { places, flows, all, total } = model;
  const n = flows.length;
  const vmax = n ? flows[0].value : 0;

  const showList = listFor(W) && n >= 2;
  const mapW = showList ? W - LIST_W - LIST_GAP : W;
  const wMax = clamp(mapW / 70, 3, 12);
  const widthOf = (v: number) => clamp(wMax * (v / (vmax || 1)), 1, wMax);
  // 점: 나가고 들어온 양의 합에 따라 (제곱근)
  const tmax = useMemo(() => places.reduce((m, pl) => Math.max(m, cap(pl.out + pl.in)), 0), [places]);
  const dotR = (pl: Place) => (tmax > 0 ? 2.5 + 4 * Math.sqrt(cap(pl.out + pl.in) / tmax) : 3);
  const shownPlaces = useMemo(() => {
    const s = new Set<number>();
    for (const f of flows) s.add(f.a).add(f.b);
    return s;
  }, [flows]);

  const box = useMemo(() => (layout ? pointBox(layout, [...shownPlaces].map((i) => places[i].at)) : null), [layout, places, shownPlaces]);
  const frame = useMemo(() => (layout && box ? geoFrame(layout, mapW, H, 9, box) : null), [layout, box, mapW, H]);
  const scr = (pl: Place): XY => (frame ? [pl.at.x * frame.fit.k + frame.fit.tx, pl.at.y * frame.fit.k + frame.fit.ty] : [0, 0]);

  // 강조: 기본 가장 큰 흐름. 자리 이름이면 그 자리의 흐름 모두, 숫자는 큰 순서 (0이 가장 큼)
  const hiSet = useMemo(() => {
    const h = props.highlight;
    const byPlace = typeof h === "string" && !HIGHLIGHT_KEYWORDS.includes(h) ? places.findIndex((pl) => pl.name === h) : -1;
    if (byPlace >= 0) return new Set(flows.flatMap((f, k) => (f.a === byPlace || f.b === byPlace ? [k] : [])));
    return resolveHighlight(h as Highlight<T> | undefined, flows.map((f) => f.datum), flows.map((f) => arrow(places[f.a].name, places[f.b].name)), flows.map((f) => f.value), "max");
  }, [props.highlight, flows, places]);

  const geom = useMemo(() => (frame ? flows.map((f) => flowPieces(places[f.a].at, places[f.b].at, frame, dotR(places[f.b]), widthOf(f.value))) : []), [frame, flows, places, tmax, wMax, vmax]); // eslint-disable-line react-hooks/exhaustive-deps
  const cuts = useMemo(() => {
    const subs: SubProjection[] = [];
    for (const pieces of geom) for (const pc of pieces) if (pc.cut && !subs.includes(pc.cut)) subs.push(pc.cut);
    return subs;
  }, [geom]);

  // 비율 글 (합계는 cap으로 늘 유한해요)
  const shares = useMemo(() => flows.map((f) => (total > 0 ? sharePct((f.value / total) * 100, c.locale) : "")), [flows, total, c.locale]);
  const events: ChartEvent<T>[] = useMemo(
    () => flows.map((f, k) => ({ datum: f.datum, index: k, key: `${places[f.a].name}\u0001${places[f.b].name}`, label: msg.to(places[f.a].name, places[f.b].name), value: f.value, formatted: [fv(f.value), shares[k] && msg.share(shares[k])].filter(Boolean).join(", ") })),
    [flows, places, shares, fv, msg],
  );

  const [placeOn, setPlaceOn] = useState<number | null>(null);
  const active = c.active !== null && c.active < n ? c.active : null;
  const hot = placeOn !== null && places[placeOn] ? placeOn : null;
  /** 고른 흐름이나 올린 자리의 흐름 (나머지는 흐려요). 고른 것이 없으면 null */
  const litFlows = active !== null ? [active] : hot !== null ? flows.flatMap((f, k) => (f.a === hot || f.b === hot ? [k] : [])) : null;
  /** 밝게 두는 자리: 고른 흐름의 두 끝, 또는 올린 자리 */
  const lit = (i: number) => hot === i || (active !== null && (flows[active].a === i || flows[active].b === i));
  const setFromPointer = (k: number | null, type: string) => c.setActive(k, type === "touch" ? "touch" : "pointer");
  // 자리 점의 호버는 미리 만든 점에서 불러요 (점을 호버마다 다시 만들지 않게 늘 지금의 c를 봐요)
  const onPlace = useRef<(i: number) => void>(() => undefined);
  onPlace.current = (i) => {
    if (c.via === "keyboard") return;
    c.setActive(null);
    setPlaceOn(i);
  };

  const numMarks = useMemo<Mark<null>[]>(() => [{ key: "__g", to: [1], from: [0], data: null }], []);
  const motion = useMotion(numMarks, c.motion);
  const enabled = useCssEntrance(c, motion);
  const grow = motion.get("__g")?.[0] ?? 1;
  const dash = grow < 0.999;
  const dur = c.motion.duration ?? 1100;

  // 선과 화살촉: 굵은 것부터 그려서 가는 선이 위에 와요. 등장 중에는 선 길이 1로 놓고 띠의 CSS 변수만 바꿔요 (프레임마다 선을 다시 만들지 않아요).
  // 호버로는 다시 만들지 않아요: 고르면 이 층 전체를 흐리고 고른 흐름만 위에 한 번 더 그려요
  const drawFlow = (k: number, lines: ReactNode[], heads: ReactNode[], hits: ReactNode[] | null) => {
    const w = r1(widthOf(flows[k].value));
    const col = hiSet.has(k) ? p.paint("accent") : p.paint("neutralStrong");
    const op = hiSet.has(k) ? 0.95 : 0.8;
    geom[k].forEach((pc, j) => {
      if (!pc.d) return;
      const clip = pc.cut ? `url(#${uid}s${cuts.indexOf(pc.cut)})` : undefined;
      const hitLine = hits === null && n > HIT_FLOWS;
      lines.push(
        <path
          key={`${k}:${j}`}
          d={pc.d}
          fill="none"
          stroke={col}
          strokeWidth={w}
          strokeLinecap="round"
          opacity={op}
          clipPath={clip}
          className="ztd-mark"
          pathLength={dash ? 1 : undefined}
          strokeDasharray={dash ? "1 1" : undefined}
          style={dash ? { strokeDashoffset: "var(--ztd-grow)" } : undefined}
          pointerEvents={hitLine ? "stroke" : "none"}
          onPointerEnter={hitLine ? (e) => setFromPointer(k, e.pointerType) : undefined}
        />,
      );
      if (pc.arrow) heads.push(<path key={`${k}:${j}`} d={pc.arrow} fill={col} opacity={op} clipPath={clip} className="ztd-mark" pointerEvents="none" />);
      if (hits) hits.push(<path key={`${k}:${j}`} d={pc.d} fill="none" stroke="transparent" strokeWidth={Math.max(w + 6, 10)} clipPath={clip} onPointerEnter={(e) => setFromPointer(k, e.pointerType)} onClick={() => c.click(k)} />);
    });
  };
  const linkLayer = useMemo(() => {
    const lines: ReactNode[] = [];
    const heads: ReactNode[] = [];
    const hits: ReactNode[] = [];
    geom.forEach((_, k) => drawFlow(k, lines, heads, n <= HIT_FLOWS ? hits : null));
    return { lines, heads, hits };
  }, [geom, flows, hiSet, p, dash, cuts, uid, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const litLayer = (() => {
    const lines: ReactNode[] = [];
    const heads: ReactNode[] = [];
    for (const k of litFlows ?? []) drawFlow(k, lines, heads, []);
    return { lines, heads };
  })();

  // 이름표: 강조한 흐름의 두 자리, 그다음 양이 많은 자리 몇 곳. 겹치면 빼요
  const labels = useMemo(() => {
    if (!c.showLabels || !frame || !n) return [];
    // 좁으면(390px 아래) 강조한 흐름의 두 끝만 적어요
    const top = mapW >= 560 ? 8 : mapW >= 390 ? 5 : 0;
    const first = [...new Set(flows.flatMap((f, k) => (hiSet.has(k) ? [f.a, f.b] : [])))].slice(0, 40);
    const rest = [...shownPlaces].filter((i) => !first.includes(i)).sort((x, y) => cap(places[y].out + places[y].in) - cap(places[x].out + places[x].in) || x - y);
    const order = [...first, ...rest].slice(0, Math.max(top, first.length));
    const dots = [...shownPlaces].map((i): Rect => {
      const [x, y] = scr(places[i]);
      const r = dotR(places[i]);
      return [x - r, y - r, x + r, y + r];
    });
    return placeLabels(
      order.map((i) => {
        const [x, y] = scr(places[i]);
        return { x, y, r: dotR(places[i]), text: truncate(places[i].name, Math.min(130, mapW * 0.3), 11, 600) };
      }),
      mapW,
      H,
      11,
      [],
      dots,
    ).map((l) => ({ ...l, k: order[l.k] }));
  }, [c.showLabels, frame, n, flows, hiSet, shownPlaces, places, mapW, H]); // eslint-disable-line react-hooks/exhaustive-deps

  let tip: TooltipData | null = null;
  if (frame && active !== null) {
    const f = flows[active];
    const [ax, ay] = scr(places[f.a]);
    const [bx, by] = scr(places[f.b]);
    const share = shares[active];
    tip = {
      x: clamp((ax + bx) / 2, 0, mapW),
      y: clamp((ay + by) / 2, 0, H),
      title: arrow(places[f.a].name, places[f.b].name),
      rows: [{ label: c.t.value, value: fv(f.value), color: hiSet.has(active) ? p.paint("accent") : p.paint("neutralStrong") }, ...(share ? [{ label: msg.shareLabel, value: share, strong: false }] : [])],
    };
  } else if (frame && hot !== null) {
    const pl = places[hot];
    const [x, y] = scr(pl);
    tip = { x: clamp(x, 0, mapW), y: clamp(y, 0, H), title: pl.name, rows: [{ label: msg.out, value: fv(pl.out) }, { label: msg.in, value: fv(pl.in) }] };
  }

  const missingMap = choice && "missing" in choice ? choice.missing : null;
  const notes = [model.skipped ? msg.skipped(model.skipped) : "", all > n ? msg.capped(n, all) : ""].filter(Boolean);
  const top = n ? `${msg.to(places[flows[0].a].name, places[flows[0].b].name)}, ${fv(vmax)}` : "";
  const desc = props.description ?? (n ? `${msg.kind}. ${msg.desc(all, shownPlaces.size, fv(total), top)}${notes.length ? `. ${notes.join(". ")}` : ""}.` : missingMap ? mapNotLoaded(missingMap, c.lang) : "");
  const announce = c.via === "keyboard" && active !== null && events[active] ? `${events[active].label}, ${events[active].formatted}` : "";

  // 순위 목록: 들어가는 만큼 큰 흐름부터 (머리 줄 하나)
  const listRows = Math.max(0, Math.floor((H - 8) / ROW_H) - 1);
  const listed = showList ? flows.slice(0, listRows) : [];
  const listX = W - LIST_W;

  const clearPointer = (type: string) => {
    if (c.via === "keyboard") return;
    setPlaceOn(null);
    setFromPointer(null, type);
  };
  // 자리 점: 호버와 상관없이 한 번 만들어요. 고르면 이 층을 흐리고 밝은 자리만 위에 다시 그려요
  const dotOf = (i: number, grow = 0) => {
    const [x, y] = scr(places[i]);
    return <circle key={places[i].name} cx={r1(x)} cy={r1(y)} r={r1(dotR(places[i]) + grow)} fill={p.paint("ink")} stroke={p.paint("panel")} strokeWidth={1.2} className="ztd-mark" onPointerEnter={() => onPlace.current(i)} />;
  };
  const dotLayer = useMemo(() => [...shownPlaces].map((i) => dotOf(i)), [shownPlaces, places, frame, p, tmax]); // eslint-disable-line react-hooks/exhaustive-deps
  const dimmed = litFlows !== null;

  return (
    <ChartFrame
      c={c}
      kind={msg.kind}
      ariaLabel={props.ariaLabel}
      description={desc}
      emptyText={missingMap ? mapNotLoaded(missingMap, c.lang) : undefined}
      events={events}
      tip={tip}
      renderTip={props.tooltip}
      announce={announce}
      className={props.className}
      style={props.style}
      theme={props.theme}
      defs={
        frame && (layout?.clip || cuts.length) ? (
          <>
            {layout?.clip ? (
              <clipPath id={`${uid}c`}>
                <rect width={mapW} height={H} />
              </clipPath>
            ) : null}
            {cuts.map((sub, i) => (
              <clipPath key={i} id={`${uid}s${i}`}>
                <path d={sphereOutline(sub, frame)} />
              </clipPath>
            ))}
          </>
        ) : undefined
      }
    >
      {missingMap ? (
        <Txt x={W / 2} y={H / 2} anchor="middle" size={12} fill={p.paint("muted")}>
          {truncate(mapNotLoaded(missingMap, c.lang), W - 16, 12)}
        </Txt>
      ) : null}
      {frame && layout ? (
        <g key={motion.generation}>
          <rect width={mapW} height={H} fill="transparent" onPointerEnter={(e) => clearPointer(e.pointerType)} />
          <g clipPath={layout.clip ? `url(#${uid}c)` : undefined}>
            {layout.context.length ? <BaseMap p={p} frame={frame} regions={layout.context} opacity={0.6} /> : null}
            <BaseMap p={p} frame={frame} regions={layout.regions} />
            <g opacity={dimmed ? 0.15 : undefined}>
              <g style={dash ? ({ "--ztd-grow": r1(1 - grow) } as Record<string, number>) : undefined}>{linkLayer.lines}</g>
              <g opacity={dash ? clamp((grow - 0.85) / 0.15, 0, 1) : undefined}>{linkLayer.heads}</g>
            </g>
            {dimmed ? (
              <g pointerEvents="none">
                {litLayer.lines}
                {litLayer.heads}
              </g>
            ) : null}
            {linkLayer.hits}
            <g style={cssEntrance(enabled, motion.waiting, "fade", 0, Math.min(400, dur))}>
              <g opacity={dimmed ? 0.35 : undefined}>{dotLayer}</g>
              {dimmed ? [...shownPlaces].filter(lit).map((i) => dotOf(i, 1)) : null}
            </g>
          </g>
          {labels.map((l) => (
            <MapLabel key={places[l.k].name} p={p} l={l} dim={dimmed && !lit(l.k)} />
          ))}
        </g>
      ) : null}
      {showList ? (
        <g transform={`translate(${listX} 0)`}>
          <Txt x={0} y={ROW_H / 2} size={10} weight={600} fill={p.paint("muted")}>
            {msg.largest}
          </Txt>
          {listed.map((f, k) => {
            const y = (k + 1) * ROW_H;
            const value = fv(f.value);
            const vw = textWidth(value, 11, 600);
            const bar = Math.max(4, (LIST_W - vw - 6) * (f.value / (vmax || 1)));
            const isActive = active === k;
            return (
              <g key={k} onPointerEnter={(e) => setFromPointer(k, e.pointerType)}>
                <rect x={-4} y={y} width={LIST_W + 4} height={ROW_H} rx={4} fill={isActive ? p.paint("lift") : "transparent"} />
                {/* 양만큼의 막대를 글자 뒤에 옅게 깔아요 (강조한 흐름은 강조색) */}
                <rect x={-2} y={y + 1.5} width={r1(bar)} height={ROW_H - 3} rx={3} fill={hiSet.has(k) ? p.paint("accent") : p.paint("neutralSoft")} opacity={hiSet.has(k) ? 0.2 : 1} />
                <Txt x={2} y={y + ROW_H / 2} size={11} weight={hiSet.has(k) ? 700 : 500} fill={p.paint("ink")}>
                  {truncate(arrow(places[f.a].name, places[f.b].name), LIST_W - vw - 10, 11, hiSet.has(k) ? 700 : 500)}
                </Txt>
                <Txt x={LIST_W - 2} y={y + ROW_H / 2} anchor="end" size={11} weight={600} fill={p.paint("ink")}>
                  {value}
                </Txt>
              </g>
            );
          })}
        </g>
      ) : null}
    </ChartFrame>
  );
}
