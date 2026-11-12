import { useId, useMemo } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { cssEntrance, useCssEntrance } from "../core/css";
import { clamp } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import { plural, type ChartLang } from "../core/i18n";
import type { Mark } from "../core/motion";
import { categoricalDots } from "../core/palette";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Highlight, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { hasField, numGetter, strGetter, uniq } from "../data/accessor";
import { BaseMap } from "../geo/BaseMap";
import { MapLabel } from "../geo/MapLabel";
import { MAX_POINTS, choosePlaceMap, placeDomain, placeIn, symbolPlace } from "../geo/places";
import { canCenter, cap, chooseCenter, mapNotLoaded, placeLabels, planePoint, pointBox, r1, regionLonLat, sharePct, type MapCenter, type MapPoint, type Rect } from "../geo/pointMap";
import type { GeoJSONFeatureCollection, GeoMap } from "../geo/types";
import { geoFrame, geoLayout, layoutAspect } from "../geo/view";

/** English ordinals (1st, 2nd, 3rd, 4th, 11th, 21st) */
const ORD = /* @__PURE__ */ new Intl.PluralRules("en-US", { type: "ordinal" });
const SUFFIX: Record<string, string> = { one: "st", two: "nd", few: "rd" };

const en = {
  kind: "Symbol map",
  share: (s: string) => `${s} of the total`,
  shareLabel: "Share",
  rankLabel: "Rank",
  groupLabel: "Group",
  rank: (k: number, n: number) => `${k}${SUFFIX[ORD.select(k)] ?? "th"} of ${n}`,
  desc: (n: number, total: string, top: string) => `${plural(n, "place")}, ${total} in total. Largest: ${top}`,
  skipped: (n: number) => `${plural(n, "row")} could not be placed on the map`,
  capped: (shown: number, n: number) => `The ${shown} largest of ${n} places are drawn`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "기호 지도",
    share: (s) => `전체의 ${s}`,
    shareLabel: "비율",
    rankLabel: "순위",
    groupLabel: "묶음",
    rank: (k, n) => `${n}곳 중 ${k}위`,
    desc: (n, total, top) => `지점 ${n}곳, 합계 ${total}. 가장 큰 곳: ${top}`,
    skipped: (n) => `지도에 놓지 못한 행 ${n}개`,
    capped: (shown, n) => `지점 ${n}곳 중 큰 ${shown}곳을 그려요`,
  },
};

export interface SymbolMapProps<T = Row> extends BaseChartProps<T> {
  /** Longitude field (degrees, -180 to 180). Default "lon" */
  lon?: Accessor<T, number>;
  /** Latitude field (degrees, -90 to 90). Default "lat" */
  lat?: Accessor<T, number>;
  /** Region name or code field. Rows without longitude and latitude get their circle at the center of this region (country, state). Default "region" (only when the data has it) */
  region?: Accessor<T, string>;
  /** Value field. Circle area is proportional to the value. Without it (and without a "size" field in the data), all circles are the same size */
  size?: Accessor<T, number>;
  /** Place name field. Default "label" (then "name", then the region name or coordinates) */
  label?: Accessor<T, string>;
  /** Group field. Each group gets its own circle color (the same colors as the card legend) */
  group?: Accessor<T, string>;
  /** Base map: "auto" (default: the registered map that contains the most places, the smaller map on a tie), a registered map name, a map object from ztd-charts/geo/*, or GeoJSON */
  map?: string | GeoMap | GeoJSONFeatureCollection;
  /** Zoom the world map to one region group: "europe", "asia", "africa", "americas", "oceania". Places outside it are left out */
  focus?: string;
  /** GeoJSON property to read as the region id */
  featureId?: string;
  /** GeoJSON property to read as the region name */
  featureName?: string;
  /** Circle radius range [smallest, largest] (px). By default fitted to the width. The largest is capped at 1/8 of the chart's shorter side */
  sizeRange?: [number, number];
  /** Center of the world map: "auto" (default, whichever side cuts fewer places at the map edge), "atlantic" (longitude 0), "pacific" (longitude 150, split in the Atlantic) */
  center?: MapCenter;
  /** Size legend (two or three reference circles). Default true */
  legend?: boolean;
}

/** Number of entrance bands: circles are grouped into this many bands, largest first, and appear in turn */
const BANDS = 8;

interface Pt<T> {
  row: number;
  datum: T;
  label: string;
  value: number;
  group: number;
  at: MapPoint;
  /** Value rank (1 is the largest; equal values share a rank) */
  rank: number;
}

/** The largest number of the form 1, 2, 5 × 10^k that is at most v (size legend values) */
function niceDown(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return 0;
  const e = 10 ** Math.floor(Math.log10(v));
  const m = v / e;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * e;
}

const okRange = (r: unknown): r is [number, number] => Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === "number" && Number.isFinite(x));

/** Turns sizeRange into usable radii: smaller first, at least 0.5px, the largest capped at 1/8 of the shorter side (side). null when malformed */
function rangeOf(r: unknown, side: number): [number, number] | null {
  if (!okRange(r)) return null;
  const top = Math.max(1, side / 8);
  const lo = clamp(Math.min(r[0], r[1]), 0.5, top);
  return [lo, clamp(Math.max(r[0], r[1]), lo, top)];
}

/**
 * Symbol map: one circle per place on a faint base map. Circle area is proportional to the value (square-root radius), so absolute amounts compare directly (a choropleth makes large regions look heavy).
 * Small circles are drawn over large ones so they are never hidden, and only the largest place gets the accent color. A place is a longitude and latitude, or a region name on the map (its center)
 */
export function SymbolMap<T = Row>(props: SymbolMapProps<T>) {
  // Reading rows: a point when both longitude and latitude are numbers, otherwise a region name
  const { counted, rows: read } = useMemo(() => {
    const has = (k: string) => props.data.some((d) => d !== null && typeof d === "object" && hasField(d as object, k));
    const glon = numGetter(props.lon, "lon");
    const glat = numGetter(props.lat, "lat");
    const greg = props.region !== undefined || has("region") ? strGetter(props.region, "region") : () => "";
    const sized = props.size !== undefined || has("size");
    const gsize = numGetter(props.size, "size");
    const glabel = props.label !== undefined || has("label") ? strGetter(props.label, "label") : has("name") ? strGetter<T>("name", "name") : () => "";
    const ggroup = props.group !== undefined ? strGetter(props.group, "group") : null;
    return { counted: !sized, rows: props.data.map((d, i) => ({ d, place: symbolPlace(glon(d, i), glat(d, i), greg(d, i)), value: sized ? gsize(d, i) : 1, label: glabel(d, i).trim(), group: ggroup ? ggroup(d, i) : "" })) };
  }, [props.data, props.lon, props.lat, props.region, props.size, props.label, props.group]);

  const choice = useMemo(() => choosePlaceMap(props.map, () => read.map((r) => r.place)), [props.map, read]);
  const source = choice && "map" in choice ? choice.map : null;
  const geoOpts = useMemo(() => ({ focus: props.focus, featureId: props.featureId, featureName: props.featureName }), [props.focus, props.featureId, props.featureName]);
  // Place rows on the map (before projection: choosing the center needs longitudes). A region uses its representative coordinates
  const placed = useMemo(() => {
    if (!source) return [];
    const domain = placeDomain(source, geoOpts);
    return read.map((r) => placeIn(domain, r.place));
  }, [source, geoOpts, read]);
  const lon0 = useMemo(() => {
    if (!source || !canCenter(source, props.focus)) return undefined;
    const domain = placeDomain(source, geoOpts);
    const lons = placed.flatMap((at) => ("lon" in at ? [at.lon] : "region" in at ? [regionLonLat(domain.shapes[at.region])[0]] : []));
    return chooseCenter(props.center, [], lons);
  }, [source, geoOpts, placed, props.focus, props.center]);
  const layout = useMemo(() => (source ? geoLayout(source, { ...geoOpts, lon0 }) : null), [source, geoOpts, lon0]);
  const aspect = layout ? layoutAspect(layout) : 2;
  // Height: the map's aspect ratio plus circle padding (the largest radius) above and below (so the map does not shrink by the padding)
  const rMaxFor = (w: number) => rangeOf(props.sizeRange, w)?.[1] ?? clamp(w / 26, 8, 30);
  const c = useChart(props, {
    height: (w) => {
      const m = rMaxFor(w) + 2;
      return Math.round(Math.max(120, Math.min((w - 2 * m) / aspect + 2 * m, w * 0.85)));
    },
    duration: 520,
    stagger: 70,
  });
  const { p, width: W, height: H, fv } = c;
  const msg = MSG[c.lang];
  const uid = useId().replace(/:/g, "");

  // Placeable points, largest value first (data order on ties). Rows whose value is at or below 0 or not a number, and rows off the map, are left out
  const model = useMemo(() => {
    const groups = uniq(read.map((r) => r.group).filter(Boolean));
    const groupOf = new Map(groups.map((g, i) => [g, i]));
    if (!layout) return { pts: [] as Pt<T>[], all: 0, total: 0, skipped: read.length, groups };
    const list: Pt<T>[] = [];
    read.forEach((r, row) => {
      if (!(r.value > 0) || !Number.isFinite(r.value)) return;
      const where = placed[row];
      const at = planePoint(layout, where);
      if (!at) return;
      const label = r.label || ("region" in where ? (c.lang === "ko" ? layout.shapes[where.region].nameKo : undefined) ?? layout.shapes[where.region].name : `${Math.abs(at.lat).toFixed(2)}°${at.lat < 0 ? "S" : "N"}, ${Math.abs(at.lon).toFixed(2)}°${at.lon < 0 ? "W" : "E"}`);
      list.push({ row, datum: r.d, label, value: r.value, group: groupOf.get(r.group) ?? -1, at, rank: 0 });
    });
    list.sort((a, b) => b.value - a.value || a.row - b.row);
    // Equal values share a rank
    list.forEach((pt, k) => (pt.rank = k && list[k - 1].value === pt.value ? list[k - 1].rank : k + 1));
    let total = 0;
    for (const pt of list) total = cap(total + pt.value);
    return { pts: list.slice(0, MAX_POINTS), all: list.length, total, skipped: read.length - list.length, groups };
  }, [layout, placed, read, c.lang]);
  const { pts, all, total } = model;
  const n = pts.length;
  const vmax = n ? pts[0].value : 0;
  const flat = n > 0 && pts[n - 1].value === vmax;

  // Radius: area proportional to the value (square root), with a floor and a ceiling. When all are the same size (no value field), small dots
  const range = rangeOf(props.sizeRange, Math.min(W, H)) ?? [n > 500 ? 1.5 : 2.5, rMaxFor(W)];
  const [rMin, rMax] = range;
  const radius = (v: number) => (counted || flat ? clamp(Math.min(rMax, W / 90), rMin, rMax) : clamp(rMax * Math.sqrt(v / vmax), rMin, rMax));
  const pad = counted || flat ? radius(vmax) + 2 : rMax + 2;
  const box = useMemo(() => (layout ? pointBox(layout, pts.map((pt) => pt.at)) : null), [layout, pts]);
  const frame = useMemo(() => (layout && box ? geoFrame(layout, W, H, pad, box) : null), [layout, box, W, H, pad]);
  const screen = useMemo(() => (frame ? pts.map((pt) => [pt.at.x * frame.fit.k + frame.fit.tx, pt.at.y * frame.fit.k + frame.fit.ty] as [number, number]) : []), [frame, pts]);

  // Highlight: the largest place by default ("max"). A name matches the place name, a number the value order (0 is the largest). No highlight when all values are equal
  const hiSet = useMemo(() => {
    const h = props.highlight;
    const kept = flat && (typeof h === "string" || Array.isArray(h)) ? ((Array.isArray(h) ? h : [h]) as (number | string)[]).filter((x) => x !== "max" && x !== "min") : h;
    return resolveHighlight(kept as Highlight<T> | undefined, pts.map((pt) => pt.datum), pts.map((pt) => pt.label), pts.map((pt) => pt.value), flat ? "none" : "max");
  }, [props.highlight, pts, flat]);

  const colors = useMemo(() => (model.groups.length ? categoricalDots(p, model.groups.length, new Set()) : []), [p, model.groups.length]);
  const fillOf = (pt: Pt<T>, k: number) => (pt.group >= 0 && colors[pt.group] ? colors[pt.group].fill : hiSet.has(k) ? p.paint("accent") : p.paint("neutralStrong"));

  // Share text (the total is always finite thanks to cap)
  const shares = useMemo(() => pts.map((pt) => (total > 0 ? sharePct((pt.value / total) * 100, c.locale) : "")), [pts, total, c.locale]);
  const events: ChartEvent<T>[] = useMemo(
    () => pts.map((pt, k) => ({ datum: pt.datum, index: pt.row, key: `${pt.row}`, label: pt.label, value: pt.value, ...(pt.group >= 0 && { series: model.groups[pt.group] }), formatted: [fv(pt.value), shares[k] && msg.share(shares[k]), msg.rank(pt.rank, all)].filter(Boolean).join(", ") })),
    [pts, shares, all, fv, msg, model.groups],
  );

  // Size legend: two or three rounded values below the largest value (dropped when the radius is under 3px)
  const legendVals = useMemo(() => {
    if (props.legend === false || counted || flat || !n) return [];
    // The largest circle shows the largest value rounded down to two digits (4.2M); the others use the 1, 2, 5 step at or below 1/4 and 1/20 of it
    const e = 10 ** (Math.floor(Math.log10(vmax)) - 1);
    const v1 = Number.isFinite(e) && e > 0 ? Math.floor(vmax / e) * e : vmax;
    return [...new Set([v1, niceDown(v1 / 4), niceDown(v1 / 20)])].filter((v) => v > 0 && radius(v) >= 3).slice(0, 3);
  }, [props.legend, counted, flat, n, vmax, rMax, rMin]); // eslint-disable-line react-hooks/exhaustive-deps
  const legend = useMemo(() => {
    if (!legendVals.length) return null;
    const R = radius(legendVals[0]);
    const texts = legendVals.map((v) => fv(v));
    const tw = Math.max(...texts.map((t) => textWidth(t, 10)));
    const bw = 2 * R + 6 + tw;
    const bh = 2 * R;
    if (bw > W * 0.45 || bh > H * 0.45) return null;
    // The corner overlapping the fewest circles (on a tie, the earlier of bottom left, bottom right, top left, top right)
    const corners: [number, number][] = [
      [4, H - 4 - bh],
      [W - 4 - bw, H - 4 - bh],
      [4, 4],
      [W - 4 - bw, 4],
    ];
    let best = corners[0];
    let bestScore = Infinity;
    for (const [x0, y0] of corners) {
      let score = 0;
      screen.forEach(([x, y], k) => {
        const r = radius(pts[k].value);
        const ox = Math.min(x + r, x0 + bw) - Math.max(x - r, x0);
        const oy = Math.min(y + r, y0 + bh) - Math.max(y - r, y0);
        if (ox > 0 && oy > 0) score += ox * oy;
      });
      if (score < bestScore) {
        bestScore = score;
        best = [x0, y0];
      }
    }
    // When the value texts overlap (within 11px), drop the middle value
    const items = legendVals.map((v, k) => ({ r: radius(v), text: texts[k] }));
    const kept = items.filter((it, k) => k === 0 || items[k - 1].r * 2 - it.r * 2 >= 11);
    return { x0: best[0], y0: best[1], R, bw, bh, items: kept };
  }, [legendVals, screen, pts, W, H, fv]); // eslint-disable-line react-hooks/exhaustive-deps

  // Labels: the highlighted places, then a few of the next largest. Dropped on overlap (they also avoid the size legend)
  const labels = useMemo(() => {
    if (!c.showLabels || !n) return [];
    // When narrow (under 390px), label only the highlighted places
    const top = W >= 600 ? 6 : W >= 390 ? 4 : 0;
    // Even with very many highlighted places (a function, a long array), label candidates are capped at 40
    const order = [...pts.keys()].filter((k) => hiSet.has(k)).slice(0, 40).concat([...pts.keys()].filter((k) => !hiSet.has(k)).slice(0, top));
    const avoid: Rect[] = legend ? [[legend.x0, legend.y0, legend.x0 + legend.bw, legend.y0 + legend.bh]] : [];
    // Look first for spots that do not cover other circles (up to 300 large circles)
    const circles = screen.slice(0, 300).map(([x, y], k): Rect => {
      const r = radius(pts[k].value);
      return [x - r, y - r, x + r, y + r];
    });
    return placeLabels(
      order.map((k) => ({ x: screen[k][0], y: screen[k][1], r: radius(pts[k].value), text: truncate(pts[k].label, Math.min(140, W * 0.35), 11, 600), weight: hiSet.has(k) ? 700 : 600 })),
      W,
      H,
      11,
      avoid,
      circles,
    ).map((l) => ({ ...l, k: order[l.k] }));
  }, [c.showLabels, n, pts, hiSet, screen, W, H, legend]); // eslint-disable-line react-hooks/exhaustive-deps

  const numMarks = useMemo<Mark<null>[]>(() => [{ key: "__m", to: [1], from: [0], data: null }], []);
  const motion = useMotion(numMarks, c.motion);
  const enabled = useCssEntrance(c, motion);
  const dur = c.motion.duration ?? 520;
  const stg = c.motion.stagger ?? 70;
  const per = Math.max(1, Math.ceil(n / BANDS));

  const active = c.active !== null && c.active < n ? c.active : null;
  let tip: TooltipData | null = null;
  if (active !== null && screen[active]) {
    const pt = pts[active];
    const [x, y] = screen[active];
    const share = shares[active];
    tip = {
      x: clamp(x, 0, W),
      y: clamp(y - radius(pt.value), 0, H),
      title: pt.label,
      rows: [
        { label: c.t.value, value: fv(pt.value), color: fillOf(pt, active) },
        ...(share ? [{ label: msg.shareLabel, value: share, strong: false }] : []),
        { label: msg.rankLabel, value: msg.rank(pt.rank, all), strong: false },
        ...(pt.group >= 0 ? [{ label: msg.groupLabel, value: model.groups[pt.group], strong: false }] : []),
      ],
    };
  }

  const missingMap = choice && "missing" in choice ? choice.missing : null;
  const notes = [model.skipped ? msg.skipped(model.skipped) : "", all > n ? msg.capped(n, all) : ""].filter(Boolean);
  const summary = !n ? "" : `${msg.kind}. ${msg.desc(all, fv(total), `${pts[0].label} ${fv(vmax)}`)}`;
  const desc = props.description ?? (n ? `${summary}${notes.length ? `. ${notes.join(". ")}` : ""}.` : missingMap ? mapNotLoaded(missingMap, c.lang) : "");
  const announce = c.via === "keyboard" && active !== null && events[active] ? `${events[active].label}, ${events[active].formatted}` : "";

  const setFromPointer = (k: number | null, type: string) => c.setActive(k, type === "touch" ? "touch" : "pointer");
  const circleOf = (pt: Pt<T>, k: number) => (
    <circle
      key={pt.row}
      cx={r1(screen[k][0])}
      cy={r1(screen[k][1])}
      r={r1(radius(pt.value))}
      fill={fillOf(pt, k)}
      fillOpacity={hiSet.has(k) && pt.group < 0 ? 0.9 : 0.75}
      stroke={p.paint("panel")}
      strokeWidth={0.8}
      className="ztd-mark ztd-pop"
      onPointerEnter={(e) => setFromPointer(k, e.pointerType)}
      onClick={() => c.click(k)}
    />
  );
  const ring = (k: number, extra: number, w: number) => <circle key={`o${pts[k].row}`} cx={r1(screen[k][0])} cy={r1(screen[k][1])} r={r1(radius(pts[k].value) + extra)} fill="none" stroke={p.paint("ink")} strokeWidth={w} pointerEvents="none" />;
  // Build the circles and highlight outlines once, independent of hover (so 2,000 of them are not rebuilt on every hover)
  const circleLayer = useMemo(
    () =>
      Array.from({ length: Math.ceil(n / per) }, (_, band) => (
        <g key={band} style={cssEntrance(enabled, motion.waiting, "pop", band * stg, dur)}>
          {pts.slice(band * per, (band + 1) * per).map((pt, j) => circleOf(pt, band * per + j))}
        </g>
      )),
    [pts, screen, hiSet, colors, p, enabled, motion.waiting, per, stg, dur, rMin, rMax, counted, flat], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // With group colors, the highlight is an outline
  const hiRings = useMemo(() => pts.flatMap((pt, k) => (hiSet.has(k) && pt.group >= 0 ? [ring(k, 0, 1.4)] : [])), [pts, screen, hiSet, p, rMin, rMax, counted, flat]); // eslint-disable-line react-hooks/exhaustive-deps

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
        layout?.clip ? (
          <clipPath id={`${uid}c`}>
            <rect width={W} height={H} />
          </clipPath>
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
          {/* Sea: leaving the circles clears the selection */}
          <rect width={W} height={H} fill="transparent" onPointerEnter={(e) => (c.via === "keyboard" ? undefined : setFromPointer(null, e.pointerType))} />
          <g clipPath={layout.clip ? `url(#${uid}c)` : undefined}>
            {layout.context.length ? <BaseMap p={p} frame={frame} regions={layout.context} opacity={0.6} /> : null}
            <BaseMap p={p} frame={frame} regions={layout.regions} />
            {legend ? (
              <g aria-hidden="true" pointerEvents="none">
                {legend.items.map((it, k) => (
                  <g key={k}>
                    <circle cx={legend.x0 + legend.R} cy={legend.y0 + legend.bh - it.r} r={it.r} fill="none" stroke={p.paint("muted")} strokeWidth={0.8} />
                    <line x1={legend.x0 + legend.R} x2={legend.x0 + 2 * legend.R + 3} y1={legend.y0 + legend.bh - 2 * it.r} y2={legend.y0 + legend.bh - 2 * it.r} stroke={p.paint("muted")} strokeWidth={0.6} strokeDasharray="2 2" />
                    <Txt x={legend.x0 + 2 * legend.R + 6} y={legend.y0 + legend.bh - 2 * it.r} size={10} fill={p.paint("muted")}>
                      {it.text}
                    </Txt>
                  </g>
                ))}
              </g>
            ) : null}
            <g opacity={active !== null ? 0.45 : undefined}>{circleLayer}</g>
            {hiRings}
            {/* The selected circle is drawn once more above the dimmed layer, with a ring (focus ring) */}
            {active !== null ? (
              <g pointerEvents="none">
                {circleOf(pts[active], active)}
                {ring(active, 2.5, 2)}
              </g>
            ) : null}
          </g>
          {labels.map((l) => (
            <MapLabel key={`l${pts[l.k].row}`} p={p} l={l} dim={active !== null && active !== l.k} />
          ))}
        </g>
      ) : null}
    </ChartFrame>
  );
}
