import { useId, useMemo, useState } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { cssEntrance, useCssEntrance } from "../core/css";
import { clamp, sum } from "../core/geometry";
import { HIGHLIGHT_KEYWORDS, resolveHighlight } from "../core/highlight";
import { plural, type ChartLang } from "../core/i18n";
import type { Mark } from "../core/motion";
import { colorScaleOf, scaleSwatch, scaleT } from "../core/palette";
import { ScaleLegend, scaleLegendWidth } from "../core/scaleLegend";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Highlight, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter } from "../data/accessor";
import { BaseMap } from "../geo/BaseMap";
import { BUILTIN_MAPS, chooseMap } from "../geo/registry";
import type { GeoJSONFeatureCollection, GeoMap } from "../geo/types";
import { ringsPath } from "../geo/projection";
import { geoFrame, geoLayout, layoutAspect } from "../geo/view";
import { HANGUL, tileNeighbor } from "../layout/regions";

/** 영어 서수 (1st, 2nd, 3rd, 4th, 11th, 21st) */
const ORD = /* @__PURE__ */ new Intl.PluralRules("en-US", { type: "ordinal" });
const SUFFIX: Record<string, string> = { one: "st", two: "nd", few: "rd" };

const en = {
  kind: "Choropleth map",
  legend: ["Less", "More"] as [string, string],
  noData: "No data",
  rankLabel: "Rank",
  rank: (k: number, n: number) => `${k}${SUFFIX[ORD.select(k)] ?? "th"} of ${n}`,
  highest: "Highest",
  lowest: "Lowest",
  inStep: (n: number) => `${plural(n, "region")} in this step`,
  desc: (n: number, hi: string, lo: string, mean: string) => `${plural(n, "region")} with data. Highest ${hi}, lowest ${lo}, mean ${mean}`,
  same: (n: number, v: string) => (n === 1 ? `1 region with data, at ${v}` : `${n} regions with data, all at the same value, ${v}`),
  missing: (n: number) => `${plural(n, "region")} without data`,
  notLoaded: (name: string) =>
    name === "auto" ? "No map is registered. Import one from ztd-charts/geo and pass it to registerMap" : BUILTIN_MAPS.includes(name) ? `Map "${name}" is not registered. Import it from ztd-charts/geo/${name} and pass it to registerMap` : `Map "${name}" is not registered. Pass a map to registerMap, or use ${BUILTIN_MAPS.join(", ")} or a GeoJSON`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "단계구분도",
    legend: ["적음", "많음"],
    noData: "데이터 없음",
    rankLabel: "순위",
    rank: (k, n) => `${n}곳 중 ${k}위`,
    highest: "가장 높은 곳",
    lowest: "가장 낮은 곳",
    inStep: (n) => `이 단계 ${n}곳`,
    desc: (n, hi, lo, mean) => `데이터가 있는 지역 ${n}곳. 가장 높은 곳 ${hi}, 가장 낮은 곳 ${lo}, 평균 ${mean}`,
    same: (n, v) => (n === 1 ? `데이터가 있는 지역 1곳, 값 ${v}` : `데이터가 있는 지역 ${n}곳, 모두 같은 값 ${v}`),
    missing: (n) => `데이터 없는 지역 ${n}곳`,
    notLoaded: (name) =>
      name === "auto" ? "등록한 지도가 없어요. ztd-charts/geo의 지도를 registerMap에 넘겨 주세요" : BUILTIN_MAPS.includes(name) ? `"${name}" 지도를 등록하지 않았어요. ztd-charts/geo/${name}에서 불러와 registerMap에 넘겨 주세요` : `"${name}" 지도를 등록하지 않았어요. 지도를 registerMap에 넘기거나 ${BUILTIN_MAPS.join(", ")}, GeoJSON을 써 주세요`,
  },
};

export interface ChoroplethProps<T = Row> extends BaseChartProps<T> {
  /** 지역 이름이나 코드 필드. 기본 "region" */
  region?: Accessor<T, string>;
  /** 값 필드. 기본 "value" */
  value?: Accessor<T, number>;
  /**
   * 지도: "auto"(기본, 등록한 지도 가운데 지역 값이 가장 많이 맞는 지도), 등록한 지도 이름("world", "us-states", "kr-sido"),
   * ztd-charts/geo/* 의 지도 객체, 또는 GeoJSON FeatureCollection(경위도 도, Polygon과 MultiPolygon)
   */
  map?: string | GeoMap | GeoJSONFeatureCollection;
  /** 지도의 묶음만 크게: 세계 지도의 "europe", "asia", "africa", "americas", "oceania" */
  focus?: string;
  /** GeoJSON에서 지역 id로 읽을 속성. 없으면 feature.id, 속성 id, code 순서 */
  featureId?: string;
  /** GeoJSON에서 지역 이름으로 읽을 속성. 없으면 속성 name, NAME 순서 */
  featureName?: string;
  /** 위쪽 색 범례. 기본 true */
  legend?: boolean;
  /** 범례 양끝 이름. 기본 ["Less", "More"] (한국어 로캘은 ["적음", "많음"]) */
  legendLabels?: [string, string];
  /** 가장 작은 값을 가장 진하게 칠해요. 기본 강조도 가장 작은 값으로 옮겨요. 기본 false */
  colorReverse?: boolean;
  /** 이 값이 가장 옅고, 위는 강조색, 아래는 회색이에요 (늘고 준 값) */
  colorCenter?: number;
  /** 색 단계 수 (2~12). 기본 5 */
  colorSteps?: number;
  /** 지도 옆 순위 목록(가장 높은 곳과 낮은 곳). "auto"는 폭이 600px 이상일 때만. 기본 "auto" */
  ranking?: boolean | "auto";
  /** 한국 시도 지도의 지역 이름 언어. "auto"는 맞은 지역 값에 한글이 있으면 한국어, 아니면 locale 언어. 기본 "auto" */
  labels?: "auto" | "ko" | "en";
}

/** 가장 옅은 단계의 불투명도 (타일 격자 지도와 같아요). 빈 지역(회색)과 구분돼요 */
const MIN_OPACITY = 0.14;
/** 순위 목록 폭, 줄 높이, 지도와의 사이, 목록을 붙이는 최소 폭 */
const LIST_W = 172;
const ROW_H = 17;
const LIST_GAP = 16;
const LIST_MIN_W = 600;
/** 굵은 강조 테두리를 두르는 고리의 짧은 변 최소 길이(px) */
const OUTLINE_MIN = 8;
/** 등장 띠 수: 지역을 서쪽에서 동쪽으로 이만큼 묶어 차례로 나타나게 해요 */
const BANDS = 10;

interface RegionInfo<T> {
  /** 지도의 지역 번호 */
  i: number;
  label: string;
  value: number;
  datum: T | null;
  /** 값 순위 (1이 가장 큼, 같은 값은 같은 순위). 값이 없으면 0 */
  rank: number;
}

/**
 * 단계구분도: 지역을 값의 단계 색으로 칠한 지도. 지도는 registerMap으로 등록한 내장 지도(ztd-charts/geo/*)나 GeoJSON이에요.
 * 작은 지역은 지도에서 잘 안 보여서, 폭이 넉넉하면 옆에 가장 높은 곳과 낮은 곳을 적어요
 */
export function Choropleth<T = Row>(props: ChoroplethProps<T>) {
  const gr = strGetter(props.region, "region");
  const choice = useMemo(() => chooseMap(props.map, () => props.data.map((d, i) => gr(d, i))), [props.map, props.data, props.region]); // eslint-disable-line react-hooks/exhaustive-deps
  const source = choice && "map" in choice ? choice.map : null;
  const layout = useMemo(() => (source ? geoLayout(source, { focus: props.focus, featureId: props.featureId, featureName: props.featureName }) : null), [source, props.focus, props.featureId, props.featureName]);
  const aspect = layout ? layoutAspect(layout) : 2;
  const legendH = props.legend === false ? 0 : 22;
  const listFor = (w: number) => props.ranking === true || (props.ranking !== false && w >= LIST_MIN_W);
  const c = useChart(props, {
    height: (w) => {
      const mw = listFor(w) ? w - LIST_W - LIST_GAP : w;
      return Math.round(legendH + Math.max(120, Math.min(mw / aspect, w * 0.85)));
    },
    duration: 480,
    stagger: 60,
  });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];
  const uid = useId().replace(/:/g, "");

  const regions = useMemo<RegionInfo<T>[]>(() => {
    if (!layout) return [];
    const gv = numGetter(props.value, "value");
    const byShape = new Map<number, RegionInfo<T>>();
    const out = layout.regions.map((i) => {
      const r: RegionInfo<T> = { i, label: "", value: NaN, datum: null, rank: 0 };
      byShape.set(i, r);
      return r;
    });
    let hangul = false;
    // 같은 지역에 맞는 행이 여럿이면 뒤 행이 이겨요 (validateSpec이 알려요). 맞지 않는 행, 묶음 밖 행은 빼요
    props.data.forEach((d, k) => {
      const name = gr(d, k);
      const r = byShape.get(layout.match(name));
      if (!r) return;
      hangul ||= HANGUL.test(String(name));
      r.value = gv(d, k);
      r.datum = d;
    });
    const lang = props.labels === "ko" || props.labels === "en" ? props.labels : hangul ? "ko" : c.lang;
    for (const r of out) {
      const s = layout.shapes[r.i];
      r.label = (lang === "ko" ? s.nameKo : undefined) ?? s.name;
    }
    const vals = out.filter((r) => Number.isFinite(r.value)).map((r) => r.value).sort((a, b) => b - a);
    // 순위: 자기보다 큰 값의 수 + 1 (정렬한 값에서 이분 탐색이라 지역이 많아도 빨라요)
    for (const r of out)
      if (Number.isFinite(r.value)) {
        let lo = 0;
        let hi = vals.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (vals[mid] > r.value) lo = mid + 1;
          else hi = mid;
        }
        r.rank = lo + 1;
      }
    return out;
  }, [layout, props.data, props.region, props.value, props.labels, c.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 키보드, 표, 라이브 영역 순서: 값이 큰 지역부터, 그다음 데이터 없는 지역(지도 순서) */
  const order = useMemo(() => [...regions].sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity) || a.i - b.i), [regions]);
  const withData = order.filter((r) => r.rank > 0);
  const n = withData.length;
  const mx = n ? withData[0].value : 0;
  const mn = n ? withData[n - 1].value : 0;
  const flat = n > 0 && mx === mn;

  // 숫자가 아닌 단계 수, 가운데 값은 기본값으로 (스펙은 validateSpec이 먼저 막아요)
  const stepsIn = Number.isFinite(props.colorSteps) ? props.colorSteps : 5;
  const centerIn = Number.isFinite(props.colorCenter) ? props.colorCenter : undefined;
  const scale = useMemo(() => colorScaleOf(props.colorReverse, centerIn, stepsIn), [props.colorReverse, centerIn, stepsIn]);
  const steps = scale.steps ?? 5;
  const center = scale.center;
  /** 값 → 색 척도 위치 (히트맵과 같아요: 가운데 값이 있으면 -1~1, 없으면 0~1) */
  const tOf = (v: number) => {
    if (center !== undefined) {
      const span = Math.max(Math.abs(mx - center), Math.abs(mn - center));
      return span > 0 ? clamp((v - center) / span, -1, 1) : 0;
    }
    return mx > mn ? (v - mn) / (mx - mn) : 1;
  };

  // 화면 크기에 맞춘 지도 (지역 길, 중심). 순위 목록이 있으면 지도는 왼쪽에 둬요
  const showList = listFor(W) && n >= 2;
  const mapW = showList ? W - LIST_W - LIST_GAP : W;
  const mapH = Math.max(1, H - legendH);
  const frame = useMemo(() => (layout ? geoFrame(layout, mapW, mapH) : null), [layout, mapW, mapH]);

  // 지역마다 바뀌지 않는 칠 (호버와 등장 프레임마다 다시 재지 않아요)
  const looks = useMemo(
    () =>
      regions.map((r) => {
        const sw = r.rank ? scaleSwatch(p, tOf(r.value), MIN_OPACITY, scale) : null;
        return { sw, step: r.rank ? scaleT(tOf(r.value), scale) : NaN };
      }),
    [regions, p, scale, mx, mn], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [step, setStep] = useState<number | null>(null);
  /** 범례 칸 k의 색 단계 (지역의 step과 같은 값이면 그 단계예요) */
  const stepValue = (k: number) => scaleT(center === undefined ? k / (steps - 1) : (2 * k) / (steps - 1) - 1, scale);

  const posOf = useMemo(() => new Map(regions.map((r, k) => [r.i, k])), [regions]);
  const hiSet = useMemo(() => {
    if (!layout) return new Set<number>();
    // 이름은 지도의 지역 이름표로 찾아요 (맞는 지역이 없으면 -1이라 버려요). 숫자는 순위 순서(0이 가장 큼)예요
    const h = props.highlight;
    const byName = (x: number | string) => (typeof x === "string" && !HIGHLIGHT_KEYWORDS.includes(x) ? (posOf.get(layout.match(x)) ?? -1) : typeof x === "number" ? (order[x] ? posOf.get(order[x].i)! : -1) : x);
    const resolved =
      typeof h === "string" || typeof h === "number" || Array.isArray(h)
        ? ((Array.isArray(h) ? h : [h]) as (number | string)[]).filter((x) => !(flat && (x === "max" || x === "min"))).map(byName)
        : h;
    return resolveHighlight(resolved as Highlight<T> | undefined, regions.map((r) => r.datum) as T[], regions.map((r) => r.label), regions.map((r) => r.value), flat ? "none" : props.colorReverse ? "min" : "max");
  }, [layout, regions, posOf, order, flat, props.highlight, props.colorReverse]);

  const { fv } = c;
  const listed = useMemo(() => (n ? order : []), [order, n]);
  const events: ChartEvent<T>[] = useMemo(
    () =>
      listed.map((r) => ({
        datum: r.datum,
        index: r.i,
        key: layout?.shapes[r.i].id ?? r.label,
        label: r.label,
        value: r.rank ? r.value : null,
        formatted: r.rank ? `${fv(r.value)}, ${msg.rank(r.rank, n)}` : msg.noData,
      })),
    [listed, layout, fv, msg, n],
  );
  const eventOf = useMemo(() => new Map(listed.map((r, k) => [r.i, k])), [listed]);
  // 방향키 이웃: 화면 중심 좌표를 격자 칸처럼 (row = y, col = x)
  const centers = useMemo(() => listed.map((r) => ({ row: frame?.centers[r.i][1] ?? 0, col: frame?.centers[r.i][0] ?? 0 })), [listed, frame]);

  // 등장 띠: 지역을 중심 x로 서쪽에서 동쪽까지 BANDS개로 묶어요 (길이 빈 지역은 그리지 않아요)
  const bands = useMemo(() => {
    const out: number[][] = Array.from({ length: BANDS }, () => []);
    if (frame)
      regions.forEach((r, k) => {
        if (!frame.paths[r.i]) return;
        const cx = frame.centers[r.i][0];
        out[Math.min(BANDS - 1, Math.max(0, Math.floor(((Number.isFinite(cx) ? cx : 0) / Math.max(1, mapW)) * BANDS)))].push(k);
      });
    return out;
  }, [frame, regions, mapW]);

  /**
   * 강조 테두리: 짧은 변이 OUTLINE_MIN px 이상인 고리만 굵게 둘러요. 작은 섬과 작은 나라는 굵은 선이 칠을 덮어 검은 점이 되거든요.
   * 그런 고리만 있는 지역은 얇은 선으로 두르고, 둘레에 고리 표시를 그려 자리를 찾게 해요 (칠한 색은 그대로 보여요)
   */
  const outlineOf = (i: number) => {
    const big = frame && layout ? ringsPath(layout.projected[i].rings, frame.fit, [mapW, mapH], OUTLINE_MIN) : "";
    const b = layout?.projected[i].box ?? [0, 0, 0, 0];
    const k = frame?.fit.k ?? 1;
    const half = (Math.max(b[2] - b[0], b[3] - b[1]) * k) / 2;
    const [cx, cy] = frame?.centers[i] ?? [0, 0];
    return { big, cx: Number.isFinite(cx) ? cx : 0, cy: Number.isFinite(cy) ? cy : 0, r: clamp(half + 4, 6, 14) };
  };

  const numMarks = useMemo<Mark<null>[]>(() => [{ key: "__m", to: [1], from: [0], data: null }], []);
  const motion = useMotion(numMarks, c.motion);
  const enabled = useCssEntrance(c, motion);
  const dur = c.motion.duration ?? 480;
  const stg = c.motion.stagger ?? 60;

  const active = c.active !== null ? listed[c.active] : undefined;
  let tip: TooltipData | null = null;
  if (active && frame) {
    const [x, y] = frame.centers[active.i];
    const k = posOf.get(active.i) ?? -1;
    tip = {
      x: clamp(Number.isFinite(x) ? x : mapW / 2, 0, mapW),
      y: legendH + clamp(Number.isFinite(y) ? y : mapH / 2, 0, mapH),
      title: active.label,
      rows: active.rank ? [{ label: c.t.value, value: fv(active.value), color: looks[k]?.sw?.raw ?? p.paint("accent") }, { label: msg.rankLabel, value: msg.rank(active.rank, n), strong: false }] : [{ label: c.t.value, value: msg.noData, strong: false }],
    };
  }

  const ll = props.legendLabels ?? msg.legend;
  const lw = scaleLegendWidth(steps, ll);
  const lacking = regions.length - n;
  const mean = n ? sum(withData.map((r) => r.value)) / n : 0;
  const summary = !n ? "" : flat ? msg.same(n, fv(mx)) : msg.desc(n, `${withData[0].label} ${fv(mx)}`, `${withData[n - 1].label} ${fv(mn)}`, fv(mean));
  const missingMap = choice && "missing" in choice ? choice.missing : null;
  const desc = props.description ?? (n ? `${msg.kind}. ${summary}${lacking ? `. ${msg.missing(lacking)}` : ""}.` : missingMap ? msg.notLoaded(missingMap) : "");
  const announce = c.via === "keyboard" && c.active !== null && events[c.active] ? `${events[c.active].label}: ${events[c.active].formatted}` : "";

  const stepAt = step === null ? NaN : stepValue(step);
  // 순위 목록: 다 들어가면 모두, 아니면 위쪽 절반을 가장 높은 곳, 아래를 가장 낮은 곳으로 (머리 줄 두 개)
  const listRows = Math.max(0, Math.floor((mapH - 8) / ROW_H) - 2);
  // 범례 단계에 올리면 그 단계 지역만 순위대로 (머리 줄에 몇 곳인지)
  const inStep = (k: number) => Math.abs((looks[k]?.step ?? NaN) - stepAt) < 1e-9;
  const stepRows = step === null ? [] : withData.filter((r) => inStep(posOf.get(r.i) ?? -1));
  const top = step !== null ? stepRows.slice(0, listRows + 1) : n <= listRows + 1 ? withData : withData.slice(0, Math.ceil(listRows / 2));
  const bottom = step !== null || n <= listRows + 1 ? [] : withData.slice(n - Math.floor(listRows / 2));
  const listX = W - LIST_W;
  // 머리 줄: 높은 곳과 낮은 곳으로 나눌 때와 범례 단계 목록일 때
  const heads = bottom.length > 0 || step !== null;

  const setFromPointer = (k: number | null, type: string) => c.setActive(k, type === "touch" ? "touch" : "pointer");

  /** 흐리기: 지역을 고르면 나머지를 조금(0.55, 타일 격자 지도와 같아요). 범례 단계에 올렸을 때는 아래 칠에서 단계 밖 지역을 데이터 없음 색으로 바꿔요 */
  const dimOf = (k: number) => (step === null && c.active !== null && listed[c.active]?.i !== regions[k].i ? 0.55 : 1);

  // 데이터 없음 칸은 범례 왼쪽에 들어갈 때만 (좁으면 빼요. 빈 지역은 회색이라 지도에서도 보여요)
  const noDataFull = textWidth(msg.noData, 10) + 18;
  const noDataW = lacking && n && mapW - lw - 14 - noDataFull >= 0 ? noDataFull : 0;
  const stepStart = mapW - steps * 14 - textWidth(ll[1], 10);

  return (
    <ChartFrame
      c={c}
      kind={msg.kind}
      ariaLabel={props.ariaLabel}
      description={desc}
      emptyText={missingMap ? msg.notLoaded(missingMap) : undefined}
      events={events}
      tip={tip}
      renderTip={props.tooltip}
      announce={announce}
      className={props.className}
      style={props.style}
      theme={props.theme}
      defs={
        layout?.clip ? (
          <clipPath id={`${uid}c`}>
            <rect width={mapW} height={mapH} />
          </clipPath>
        ) : undefined
      }
      onKey={(e) => {
        // Home은 가장 높은 곳(기본), End는 값이 가장 낮은 곳 (데이터 없는 지역은 그 뒤에 있어요)
        if (e.key === "End" && n) {
          c.setActive(n - 1, "keyboard");
          return true;
        }
        if (!e.key.startsWith("Arrow")) return false;
        // 처음 누른 방향키는 가장 높은 곳에서 시작해요. 그다음은 그 방향의 가장 가까운 지역(중심 기준), 없으면 그 자리
        const next = c.active === null ? 0 : tileNeighbor(centers, c.active, e.key);
        if (next >= 0) c.setActive(next, "keyboard");
        return true;
      }}
    >
      {missingMap ? (
        <Txt x={W / 2} y={H / 2} anchor="middle" size={12} fill={p.paint("muted")}>
          {truncate(msg.notLoaded(missingMap), W - 16, 12)}
        </Txt>
      ) : null}
      {props.legend !== false && n ? (
        <g>
          <ScaleLegend p={p} right={mapW} steps={steps} scale={scale} labels={ll} min={MIN_OPACITY} />
          {/* 범례 칸에 올리면 그 단계 지역만 남겨요 (칸 자리는 ScaleLegend와 같은 계산) */}
          {Array.from({ length: steps }, (_, k) => (
            <rect key={k} x={stepStart - 7 + k * 14} y={0} width={14} height={16} fill="transparent" onPointerEnter={() => setStep(k)} onPointerLeave={() => setStep(null)} />
          ))}
          {noDataW ? (
            <g aria-hidden="true">
              <rect x={mapW - lw - 14 - noDataW} y={3} width={12} height={9} rx={2} fill={p.paint("neutralSoft")} stroke={p.paint("line2")} strokeWidth={0.5} />
              <Txt x={mapW - lw - 14 - noDataW + 16} y={7.5} size={10} fill={p.paint("muted")}>
                {msg.noData}
              </Txt>
            </g>
          ) : null}
        </g>
      ) : null}
      {frame && layout ? (
        <g key={motion.generation} transform={legendH ? `translate(0 ${legendH})` : undefined}>
          {/* 바다: 지역 밖으로 나가면 고른 것을 지워요 */}
          <rect width={mapW} height={mapH} fill="transparent" onPointerEnter={(e) => (c.via === "keyboard" ? undefined : setFromPointer(null, e.pointerType))} />
          <g clipPath={layout.clip ? `url(#${uid}c)` : undefined}>
            {layout.context.length ? <BaseMap p={p} frame={frame} regions={layout.context} opacity={0.6} /> : null}
            {bands.map((members, band) =>
              members.length ? (
                <g key={band} style={cssEntrance(enabled, motion.waiting, "fade", band * stg, dur)}>
                  {members.map((k) => {
                    const r = regions[k];
                    // 범례 단계에 올리면 단계 밖 지역은 데이터 없음 색으로 (가장 옅은 단계도 흐린 지역과 섞이지 않게)
                    const sw = step !== null && !inStep(k) ? null : looks[k].sw;
                    const ev = eventOf.get(r.i);
                    return (
                      <path
                        key={r.i}
                        d={frame.paths[r.i]}
                        fill={sw ? sw.fill : p.paint("neutralSoft")}
                        opacity={(sw ? sw.opacity : 1) * dimOf(k)}
                        stroke={p.paint("panel")}
                        strokeWidth={0.6}
                        strokeLinejoin="round"
                        fillRule="evenodd"
                        className="ztd-mark"
                        onPointerEnter={(e) => setFromPointer(ev ?? null, e.pointerType)}
                        onClick={() => ev !== undefined && c.click(ev)}
                      />
                    );
                  })}
                </g>
              ) : null,
            )}
            {/* 범례 단계에 올린 지역은 얇은 테두리로 (옅은 단계도 바탕과 구분돼요) */}
            {step !== null ? (
              <g pointerEvents="none" fill="none" stroke={p.paint("ink")} strokeWidth={0.75} strokeLinejoin="round">
                {regions.map((r, k) => (inStep(k) && frame.paths[r.i] ? <path key={`s${r.i}`} d={frame.paths[r.i]} /> : null))}
              </g>
            ) : null}
            {/* 강조와 고른 지역의 테두리는 위에 (이웃 지역에 가려지지 않게) */}
            {regions.map((r, k) => {
              const isActive = active?.i === r.i;
              // 범례 단계에 올린 동안은 그 단계 밖 강조 테두리를 숨겨요 (단계 지역으로 읽히지 않게)
              if (!((hiSet.has(k) && (step === null || inStep(k))) || isActive) || !frame.paths[r.i]) return null;
              const o = outlineOf(r.i);
              const w = isActive ? 2 : 1.4;
              return o.big ? (
                <path key={`o${r.i}`} d={o.big} fill="none" stroke={p.paint("ink")} strokeWidth={w} strokeLinejoin="round" pointerEvents="none" />
              ) : (
                <g key={`o${r.i}`} pointerEvents="none">
                  <path d={frame.paths[r.i]} fill="none" stroke={p.paint("ink")} strokeWidth={0.75} strokeLinejoin="round" />
                  <circle cx={o.cx} cy={o.cy} r={o.r} fill="none" stroke={p.paint("ink")} strokeWidth={w} />
                </g>
              );
            })}
          </g>
        </g>
      ) : null}
      {showList ? (
        <g transform={`translate(${listX} ${legendH})`}>
          {[
            [step !== null ? msg.inStep(stepRows.length) : msg.highest, top, 0] as const,
            [msg.lowest, bottom, (top.length + 1) * ROW_H + 6] as const,
          ].map(([head, rows, y0]) =>
            rows.length ? (
              <g key={head} transform={y0 ? `translate(0 ${y0})` : undefined}>
                {heads ? (
                  <Txt x={0} y={ROW_H / 2} size={10} weight={600} fill={p.paint("muted")}>
                    {head}
                  </Txt>
                ) : null}
                {rows.map((r, j) => {
                  const k = posOf.get(r.i) ?? 0;
                  const y = (j + (heads ? 1 : 0)) * ROW_H;
                  const value = fv(r.value);
                  const vw = textWidth(value, 11, 600);
                  const isActive = active?.i === r.i;
                  return (
                    <g key={r.i} onPointerEnter={(e) => setFromPointer(eventOf.get(r.i) ?? null, e.pointerType)}>
                      <rect x={-4} y={y} width={LIST_W + 4} height={ROW_H} rx={4} fill={isActive ? p.paint("lift") : "transparent"} />
                      <rect x={0} y={y + ROW_H / 2 - 4} width={8} height={8} rx={2} fill={looks[k].sw?.fill ?? p.paint("neutralSoft")} opacity={looks[k].sw?.opacity ?? 1} />
                      <Txt x={12} y={y + ROW_H / 2} size={11} weight={hiSet.has(k) ? 700 : 500} fill={p.paint("ink")}>
                        {truncate(`${r.rank}. ${r.label}`, LIST_W - vw - 22, 11, hiSet.has(k) ? 700 : 500)}
                      </Txt>
                      <Txt x={LIST_W - 2} y={y + ROW_H / 2} anchor="end" size={11} weight={600} fill={p.paint("ink")}>
                        {value}
                      </Txt>
                    </g>
                  );
                })}
              </g>
            ) : null,
          )}
        </g>
      ) : null}
    </ChartFrame>
  );
}
