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

/** English ordinals (1st, 2nd, 3rd, 4th, 11th, 21st) */
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
  /** Region name or code field. Default "region" */
  region?: Accessor<T, string>;
  /** Value field. Default "value" */
  value?: Accessor<T, number>;
  /**
   * Map: "auto" (default, the registered map that matches the most region values), a registered map name ("world", "us-states", "kr-sido"),
   * a map object from ztd-charts/geo/*, or a GeoJSON FeatureCollection (longitude and latitude in degrees, Polygon and MultiPolygon)
   */
  map?: string | GeoMap | GeoJSONFeatureCollection;
  /** Zoom to one group of the map: "europe", "asia", "africa", "americas", "oceania" on the world map */
  focus?: string;
  /** GeoJSON property read as the region id. Without it, feature.id, then the id property, then code */
  featureId?: string;
  /** GeoJSON property read as the region name. Without it, the name property, then NAME */
  featureName?: string;
  /** Color legend on top. Default true */
  legend?: boolean;
  /** Labels at both ends of the legend. Default ["Less", "More"] (["적음", "많음"] in the Korean locale) */
  legendLabels?: [string, string];
  /** Paints the smallest value darkest. The default highlight moves to the smallest value too. Default false */
  colorReverse?: boolean;
  /** This value is the lightest; above it the accent color, below it gray (for increases and decreases) */
  colorCenter?: number;
  /** Number of color steps (2~12). Default 5 */
  colorSteps?: number;
  /** Ranking list beside the map (the highest and lowest regions). "auto" shows it only when the width is 600px or more. Default "auto" */
  ranking?: boolean | "auto";
  /** Language of region names on the Korean provinces map. "auto" uses Korean when the matched region values contain Hangul, otherwise the locale's language. Default "auto" */
  labels?: "auto" | "ko" | "en";
}

/** Opacity of the lightest step (same as the tile grid map). Keeps it distinct from empty regions (gray) */
const MIN_OPACITY = 0.14;
/** Ranking list width, row height, gap to the map, and the minimum width at which the list is added */
const LIST_W = 172;
const ROW_H = 17;
const LIST_GAP = 16;
const LIST_MIN_W = 600;
/** Minimum short-side length (px) of a ring that gets the thick highlight outline */
const OUTLINE_MIN = 8;
/** Number of entrance bands: regions are grouped into this many bands from west to east and appear in turn */
const BANDS = 10;

interface RegionInfo<T> {
  /** Region index in the map */
  i: number;
  label: string;
  value: number;
  datum: T | null;
  /** Value rank (1 is the largest; equal values share a rank). 0 without a value */
  rank: number;
}

/**
 * Choropleth: a map with regions painted in stepped colors by value. The map is a built-in map registered with registerMap (ztd-charts/geo/*) or GeoJSON.
 * Small regions are hard to see on a map, so when there is room the highest and lowest regions are listed beside it
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
    // When several rows match the same region, the later row wins (validateSpec reports it). Rows that match no region, or fall outside the focus group, are dropped
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
    // Rank: the number of larger values + 1 (a binary search over the sorted values, so it stays fast with many regions)
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

  /** Order for the keyboard, table and live region: regions with the largest values first, then regions without data (in map order) */
  const order = useMemo(() => [...regions].sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity) || a.i - b.i), [regions]);
  const withData = order.filter((r) => r.rank > 0);
  const n = withData.length;
  const mx = n ? withData[0].value : 0;
  const mn = n ? withData[n - 1].value : 0;
  const flat = n > 0 && mx === mn;

  // A non-numeric step count or center value falls back to the default (for specs, validateSpec catches it first)
  const stepsIn = Number.isFinite(props.colorSteps) ? props.colorSteps : 5;
  const centerIn = Number.isFinite(props.colorCenter) ? props.colorCenter : undefined;
  const scale = useMemo(() => colorScaleOf(props.colorReverse, centerIn, stepsIn), [props.colorReverse, centerIn, stepsIn]);
  const steps = scale.steps ?? 5;
  const center = scale.center;
  /** Value → color scale position (same as the heatmap: -1~1 with a center value, otherwise 0~1) */
  const tOf = (v: number) => {
    if (center !== undefined) {
      const span = Math.max(Math.abs(mx - center), Math.abs(mn - center));
      return span > 0 ? clamp((v - center) / span, -1, 1) : 0;
    }
    return mx > mn ? (v - mn) / (mx - mn) : 1;
  };

  // The map fitted to the screen size (region paths, centers). With a ranking list, the map goes on the left
  const showList = listFor(W) && n >= 2;
  const mapW = showList ? W - LIST_W - LIST_GAP : W;
  const mapH = Math.max(1, H - legendH);
  const frame = useMemo(() => (layout ? geoFrame(layout, mapW, mapH) : null), [layout, mapW, mapH]);

  // Per-region fills that do not change (not recomputed on hover or on each entrance frame)
  const looks = useMemo(
    () =>
      regions.map((r) => {
        const sw = r.rank ? scaleSwatch(p, tOf(r.value), MIN_OPACITY, scale) : null;
        return { sw, step: r.rank ? scaleT(tOf(r.value), scale) : NaN };
      }),
    [regions, p, scale, mx, mn], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [step, setStep] = useState<number | null>(null);
  /** Color step of legend cell k (a region whose step equals this value is in that step) */
  const stepValue = (k: number) => scaleT(center === undefined ? k / (steps - 1) : (2 * k) / (steps - 1) - 1, scale);

  const posOf = useMemo(() => new Map(regions.map((r, k) => [r.i, k])), [regions]);
  const hiSet = useMemo(() => {
    if (!layout) return new Set<number>();
    // Names are looked up by the map's region labels (no match gives -1, which is dropped). Numbers are rank order (0 is the largest)
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
  // Arrow-key neighbors: screen center coordinates treated like grid cells (row = y, col = x)
  const centers = useMemo(() => listed.map((r) => ({ row: frame?.centers[r.i][1] ?? 0, col: frame?.centers[r.i][0] ?? 0 })), [listed, frame]);

  // Entrance bands: group regions by center x into BANDS bands from west to east (regions with an empty path are not drawn)
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
   * Highlight outline: only rings whose short side is at least OUTLINE_MIN px get the thick outline, because on small islands and small countries a thick line covers the fill and turns into a black dot.
   * A region with only such rings gets a thin outline plus a ring marker around it, so it can be found (its fill color stays visible)
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
  // Ranking list: everything if it fits; otherwise the top half for the highest regions and the bottom for the lowest (two header rows)
  const listRows = Math.max(0, Math.floor((mapH - 8) / ROW_H) - 2);
  // Hovering a legend step lists only that step's regions, in rank order (the header row shows how many)
  const inStep = (k: number) => Math.abs((looks[k]?.step ?? NaN) - stepAt) < 1e-9;
  const stepRows = step === null ? [] : withData.filter((r) => inStep(posOf.get(r.i) ?? -1));
  const top = step !== null ? stepRows.slice(0, listRows + 1) : n <= listRows + 1 ? withData : withData.slice(0, Math.ceil(listRows / 2));
  const bottom = step !== null || n <= listRows + 1 ? [] : withData.slice(n - Math.floor(listRows / 2));
  const listX = W - LIST_W;
  // Header rows: when split into highest and lowest, and when listing a legend step
  const heads = bottom.length > 0 || step !== null;

  const setFromPointer = (k: number | null, type: string) => c.setActive(k, type === "touch" ? "touch" : "pointer");

  /** Dimming: when a region is selected, the rest dim slightly (0.55, same as the tile grid map). When a legend step is hovered, the fill below switches regions outside the step to the no-data color instead */
  const dimOf = (k: number) => (step === null && c.active !== null && listed[c.active]?.i !== regions[k].i ? 0.55 : 1);

  // The no-data cell only when it fits left of the legend (dropped when narrow; empty regions are gray, so they show on the map anyway)
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
        // Home goes to the highest region (default), End to the lowest value (regions without data come after it)
        if (e.key === "End" && n) {
          c.setActive(n - 1, "keyboard");
          return true;
        }
        if (!e.key.startsWith("Arrow")) return false;
        // The first arrow key press starts at the highest region. After that, the nearest region in that direction (by center), or stay put when there is none
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
          {/* Hovering a legend cell keeps only that step's regions (cell positions use the same math as ScaleLegend) */}
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
          {/* Sea: moving outside the regions clears the selection */}
          <rect width={mapW} height={mapH} fill="transparent" onPointerEnter={(e) => (c.via === "keyboard" ? undefined : setFromPointer(null, e.pointerType))} />
          <g clipPath={layout.clip ? `url(#${uid}c)` : undefined}>
            {layout.context.length ? <BaseMap p={p} frame={frame} regions={layout.context} opacity={0.6} /> : null}
            {bands.map((members, band) =>
              members.length ? (
                <g key={band} style={cssEntrance(enabled, motion.waiting, "fade", band * stg, dur)}>
                  {members.map((k) => {
                    const r = regions[k];
                    // While a legend step is hovered, regions outside it take the no-data color (so even the lightest step does not blend with dimmed regions)
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
            {/* Regions in the hovered legend step get a thin outline (so even a light step stands out from the background) */}
            {step !== null ? (
              <g pointerEvents="none" fill="none" stroke={p.paint("ink")} strokeWidth={0.75} strokeLinejoin="round">
                {regions.map((r, k) => (inStep(k) && frame.paths[r.i] ? <path key={`s${r.i}`} d={frame.paths[r.i]} /> : null))}
              </g>
            ) : null}
            {/* Outlines of highlighted and selected regions go on top (so neighboring regions do not cover them) */}
            {regions.map((r, k) => {
              const isActive = active?.i === r.i;
              // While a legend step is hovered, hide highlight outlines outside that step (so they do not read as part of the step)
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
