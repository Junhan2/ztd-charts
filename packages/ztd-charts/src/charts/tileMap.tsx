import { useMemo } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { roundRectPath, sum } from "../core/geometry";
import { HIGHLIGHT_KEYWORDS, resolveHighlight } from "../core/highlight";
import { plural, type ChartLang } from "../core/i18n";
import type { Mark } from "../core/motion";
import { makeFormatter } from "../core/format";
import { colorScaleOf, readableOn, scaleSwatch } from "../core/palette";
import { ScaleLegend, scaleLegendWidth } from "../core/scaleLegend";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Highlight, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter } from "../data/accessor";
import { gridName, resolveGrid, tileMatcher, tileNeighbor, type TileDef } from "../layout/tileGrid";
import { HANGUL } from "../layout/regions";

const en = {
  kind: "Tile map",
  legend: ["Less", "More"] as [string, string],
  noData: "No data",
  rankLabel: "Rank",
  rank: (k: number, n: number) => `${k} of ${n}`,
  desc: (n: number, hi: string, lo: string, mean: string) => `${plural(n, "region")} with data. Highest ${hi}, lowest ${lo}, mean ${mean}`,
  same: (n: number, v: string) => (n === 1 ? `1 region with data, at ${v}` : `${n} regions with data, all at the same value, ${v}`),
  missing: (n: number) => `${plural(n, "region")} without data`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "타일 격자 지도",
    legend: ["적음", "많음"],
    noData: "데이터 없음",
    rankLabel: "순위",
    rank: (k, n) => `${n}곳 중 ${k}위`,
    desc: (n, hi, lo, mean) => `데이터가 있는 지역 ${n}곳. 가장 높은 곳 ${hi}, 가장 낮은 곳 ${lo}, 평균 ${mean}`,
    same: (n, v) => (n === 1 ? `데이터가 있는 지역 1곳, 값 ${v}` : `데이터가 있는 지역 ${n}곳, 모두 같은 값 ${v}`),
    missing: (n) => `데이터 없는 지역 ${n}곳`,
  },
};

export interface TileMapProps<T = Row> extends BaseChartProps<T> {
  /** Region name or code field. Default "region" */
  region?: Accessor<T, string>;
  /** Value field. Default "value" */
  value?: Accessor<T, number>;
  /** "auto" (the built-in grid that matches the most region values), a built-in grid name ("us-states", "kr-sido", "kr-sido-2025") or a tile array [{ id, label, row, col, aliases }]. Default "auto" */
  map?: string | readonly TileDef[];
  /** Color legend on top. Default true */
  legend?: boolean;
  /** Names at both ends of the legend. Default ["Less", "More"] (["적음", "많음"] in the Korean locale) */
  legendLabels?: [string, string];
  /** Paints the smallest value darkest. The default highlight moves to the smallest value too. Default false */
  colorReverse?: boolean;
  /** Number of color steps (2 to 12). Default 5 */
  colorSteps?: number;
  /**
   * Language of region names on the built-in Korean grids. "auto" uses Korean ("서울") when any region value matched to a tile contains Hangul, otherwise the locale's language.
   * Tiles, tooltips, screen reader sentences and the table all follow it. Numbers and other text follow locale, and custom grids use their own label. Default "auto"
   */
  labels?: "auto" | "ko" | "en";
}

/** Maximum tile height (px) and maximum width-to-height ratio. Keeps tiles from going flat even in wide cards */
const MAX_TILE_H = 64;
const MAX_RATIO = 1.6;
/** Opacity of the lightest step. Keeps it distinct from empty (gray) tiles */
const MIN_OPACITY = 0.14;
/** Maximum time (ms) between the first and the last tile's entrance. The Korean province grid (16 cells, 448ms) is unchanged; the US state grid (2,352ms) is compressed to this */
const STAGGER_SPREAD = 480;
/**
 * Side padding (px) and width safety margin for value text. Chrome renders bold digits up to 6.5% wider than the textWidth estimate (3,400,000,000: estimated 92.2, actual 98.2),
 * so a value is written only when 1.1 times the estimated width fits the inner width
 */
const VALUE_PAD = 4;
const WIDTH_SAFETY = 1.1;

interface TileInfo<T> {
  i: number;
  tile: TileDef;
  label: string;
  value: number;
  datum: T | null;
  /** Value rank (1 is the largest). 0 when there is no value */
  rank: number;
}

/** Tile name text: the largest size that fits on one line, otherwise two lines split at a space or "-", otherwise truncated */
function fitName(label: string, w: number): { lines: string[]; size: number; cut: boolean } {
  for (const size of [11.5, 11, 10, 9]) if (textWidth(label, size, 600) <= w) return { lines: [label], size, cut: false };
  const at = Math.max(label.lastIndexOf(" "), label.lastIndexOf("-"));
  if (at > 0) {
    const lines = [label.slice(0, at + (label[at] === "-" ? 1 : 0)).trim(), label.slice(at + 1).trim()];
    for (const size of [10, 9]) if (lines.every((l) => textWidth(l, size, 600) <= w)) return { lines, size, cut: false };
  }
  return { lines: [truncate(label, w, 9, 600)], size: 9, cut: true };
}

/**
 * Tile grid map: one equal-size tile per region at its approximate position, colored by value.
 * With no boundary data or projection, small regions (Seoul, Sejong) read at the same size as large provinces
 */
export function TileMap<T = Row>(props: TileMapProps<T>) {
  // "auto" (default) is the built-in grid that matches the most region values (Korean province data still gets kr-sido, the old default)
  const grid = useMemo(() => {
    const gr = strGetter(props.region, "region");
    return resolveGrid(gridName(props.map, () => props.data.map((d, i) => gr(d, i)))) ?? [];
  }, [props.map, props.data, props.region]);
  const nRows = grid.reduce((m, t) => Math.max(m, t.row + 1), 0);
  const nCols = grid.reduce((m, t) => Math.max(m, t.col + 1), 0);
  const legendH = props.legend === false ? 0 : 22;
  const c = useChart(props, { height: (w) => legendH + nRows * Math.min(w / Math.max(1, nCols), MAX_TILE_H), duration: 520, stagger: 28 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];

  // Name → tile: shared by row matching and highlighting ("서울", "Seoul" and "KR-11" are all the same tile)
  const match = useMemo(() => tileMatcher(grid), [grid]);
  const tiles = useMemo<TileInfo<T>[]>(() => {
    const gr = strGetter(props.region, "region");
    const gv = numGetter(props.value, "value");
    const out: TileInfo<T>[] = grid.map((tile, i) => ({ i, tile, label: "", value: NaN, datum: null, rank: 0 }));
    let hangul = false;
    // When several rows match the same tile, the later row wins (validateSpec reports it). Rows whose value is not a number count as no data
    props.data.forEach((d, i) => {
      const name = gr(d, i);
      const k = match(name);
      if (k < 0) return;
      hangul ||= HANGUL.test(String(name));
      out[k].value = gv(d, i);
      out[k].datum = d;
    });
    // Name language: as set if given; with "auto", Korean when the data is in Hangul, otherwise the locale's language (custom grids without Korean names use label)
    const lang = props.labels === "ko" || props.labels === "en" ? props.labels : hangul ? "ko" : c.lang;
    for (const t of out) t.label = (lang === "ko" ? t.tile.labelKo : undefined) ?? t.tile.label ?? t.tile.id;
    // Ranks are among tiles with values (equal values share a rank). Same rule as ranks in layout/stats, but importing that module grows the TileMap bundle by about 0.1KB, so it is counted here
    const vals = out.filter((t) => Number.isFinite(t.value)).map((t) => t.value);
    for (const t of out) if (Number.isFinite(t.value)) t.rank = 1 + vals.filter((v) => v > t.value).length;
    return out;
  }, [grid, match, props.data, props.region, props.value, props.labels, c.lang]);

  /** Order for the keyboard, table and live region: tiles with larger values first, then tiles without data (reading order). When neither has a rank the difference is NaN, so it falls through to reading order */
  const order = useMemo(() => [...tiles].sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity) || a.i - b.i), [tiles]);
  const withData = order.filter((t) => t.rank > 0);
  const n = withData.length;
  const mn = n ? withData[n - 1].value : 0;
  const mx = n ? withData[0].value : 0;
  /** When all values are equal there is no largest or smallest: the "max" and "min" highlights and the highest and lowest in the description are not used */
  const flat = n > 0 && mx === mn;

  const scale = useMemo(() => colorScaleOf(props.colorReverse, undefined, props.colorSteps ?? 5), [props.colorReverse, props.colorSteps]);
  const steps = scale.steps ?? 5;

  const hiSet = useMemo(() => {
    // A name is turned into a tile index through the region labels (-1 when no tile matches, which resolveHighlight drops). A number is a tile index (reading order)
    const h = props.highlight;
    const byName = (x: number | string) => (typeof x === "string" && !HIGHLIGHT_KEYWORDS.includes(x) ? match(x) : x);
    const resolved =
      typeof h === "string" || typeof h === "number" || Array.isArray(h)
        ? ((Array.isArray(h) ? h : [h]) as (number | string)[]).filter((x) => !(flat && (x === "max" || x === "min"))).map(byName)
        : h;
    // Tiles without data (null) are not passed to the predicate (resolveHighlight)
    return resolveHighlight(resolved as Highlight<T> | undefined, tiles.map((t) => t.datum) as T[], tiles.map((t) => t.tile.id), tiles.map((t) => t.value), flat ? "none" : props.colorReverse ? "min" : "max");
  }, [match, tiles, flat, props.highlight, props.colorReverse]);

  // Cell size: the width divided by the columns, height up to its limit, width up to 1.6 times the height. Leftover width is split between both sides to center the grid
  const baseW = W / Math.max(1, nCols);
  const ch = Math.max(1, Math.min(baseW, (H - legendH) / Math.max(1, nRows)));
  const cw = Math.min(baseW, ch * MAX_RATIO);
  const gridW = cw * nCols;
  const x0 = (W - gridW) / 2;
  const y0 = legendH;
  const gap = Math.min(cw, ch) > 30 ? 4 : 2;
  const rad = Math.min(p.theme.radiusMark + 2, Math.min(cw, ch) / 5);

  // The parts of each tile that do not change (position, color, text fitting). Even when re-rendered on every entrance frame and every hover, this is not measured again
  const { fmt, showLabels, locale } = c;
  // Next candidate for a long value: the locale's compact form (1.2B, 12억). With a set format, keep that form: drop the value rather than shorten it
  const userFormat = props.format !== undefined;
  const short = useMemo(() => (userFormat ? null : makeFormatter("compact", locale)), [userFormat, locale]);
  const looks = useMemo(() => {
    const raw = tiles.map((t) => {
      const b = { x: x0 + t.tile.col * cw + gap / 2, y: y0 + t.tile.row * ch + gap / 2, w: Math.max(0.5, cw - gap), h: Math.max(0.5, ch - gap) };
      const sw = t.rank ? scaleSwatch(p, mx > mn ? (t.value - mn) / (mx - mn) : 1, MIN_OPACITY, scale) : null;
      // The name comes first: the value is written only when the whole name fits and there is room below it
      // Tiles show the short name when there is one ("CA" on the US grid). The tooltip and table use the full name
      const name = fitName(t.tile.abbr ?? t.label, b.w - 6);
      const lineH = name.size + 2;
      // Values try the full number, then the compact form, then nothing. Written at the largest size where 1.1 times the estimated width fits the inner width (the width minus 4px on each side) (the tooltip and table always show the full number)
      const sizeFor = (s: string) => [13, 11.5].find((size) => textWidth(s, size, 700) * WIDTH_SAFETY <= b.w - VALUE_PAD * 2 && name.lines.length * lineH + size + 3 + 8 <= b.h);
      let valueText = sw && showLabels && !name.cut ? fmt(t.value) : "";
      let valueSize = valueText ? sizeFor(valueText) : undefined;
      if (valueText && valueSize === undefined && short) valueSize = sizeFor((valueText = short(t.value)));
      if (valueSize === undefined) valueText = "";
      return { b, sw, name, valueText, valueSize, lineH, fits: !name.cut && b.h >= name.lines.length * lineH + 4 };
    });
    // Text is decided for the whole chart, not per tile: if every name fits (shrunk down to 9px at the smallest), all are written; if even one does not, none are.
    // Same for values: written only when they fit in every tile that has one. If only some tiles kept their names, they could not be told apart from empty tiles (the tooltip, table and screen reader always give the name and value)
    const names = showLabels && raw.every((l) => l.fits);
    const values = names && raw.every((l) => !l.sw || l.valueSize !== undefined);
    return raw.map(({ b, sw, name, lineH, fits: _, ...v }) => {
      const valueSize = values ? v.valueSize : undefined;
      const blockH = name.lines.length * lineH + (valueSize ? valueSize + 3 : 0);
      return {
        b,
        d: roundRectPath(b.x, b.y, b.w, b.h, rad),
        ring: roundRectPath(b.x - 1.5, b.y - 1.5, b.w + 3, b.h + 3, rad + 1.5),
        sw,
        ink: sw ? sw.text : readableOn(p, p.theme.neutralSoft),
        name,
        valueText: values ? v.valueText : "",
        valueSize,
        lineH,
        top: b.y + b.h / 2 - blockH / 2,
        showName: names,
      };
    });
  }, [tiles, x0, y0, cw, ch, gap, rad, p, mn, mx, scale, fmt, short, showLabels]);

  // Delays between tiles follow grid order. The total spread is capped at STAGGER_SPREAD, so even a large grid (51 US places) finishes in about a second (the 16 Korean places are unchanged)
  const lastCell = tiles.reduce((m, t) => Math.max(m, t.tile.row * nCols + t.tile.col), 0);
  const stg = Math.min(c.motion.stagger ?? 28, STAGGER_SPREAD / Math.max(1, lastCell));
  const marks = useMemo<Mark<TileInfo<T>>[]>(() => tiles.map((t) => ({ key: `t${t.tile.id}`, to: [1], from: [0], delay: (t.tile.row * nCols + t.tile.col) * stg, data: t })), [tiles, nCols, stg]);
  const m = useMotion(marks, c.motion);

  const fv = c.fv;
  // With no tile that has a value there are no items: only empty tiles are drawn, and the description is ChartFrame's "No data."
  const listed = useMemo(() => (n ? order : []), [order, n]);
  const events: ChartEvent<T>[] = useMemo(
    () =>
      listed.map((t) => ({
        datum: t.datum,
        index: t.i,
        key: t.tile.id,
        label: t.label,
        value: t.rank ? t.value : null,
        formatted: t.rank ? `${fv(t.value)}, ${msg.rank(t.rank, n)}` : msg.noData,
      })),
    [listed, fv, msg, n],
  );
  const eventOf = useMemo(() => new Map(listed.map((t, k) => [t.i, k])), [listed]);
  const cellOf = useMemo(() => new Map(grid.map((t, i) => [`${t.row},${t.col}`, i])), [grid]);

  const activeTile = c.active !== null ? listed[c.active] : undefined;
  let tip: TooltipData | null = null;
  if (activeTile) {
    const b = looks[activeTile.i].b;
    tip = {
      x: b.x + b.w / 2,
      y: b.y,
      title: activeTile.label,
      rows: activeTile.rank ? [{ label: c.t.value, value: fv(activeTile.value), color: p.paint("accent") }, { label: msg.rankLabel, value: msg.rank(activeTile.rank, n), strong: false }] : [{ label: c.t.value, value: msg.noData, strong: false }],
    };
  }

  const ll = props.legendLabels ?? msg.legend;
  const lw = scaleLegendWidth(steps, ll);
  const legendRight = Math.min(W, Math.max(x0 + gridW, lw));
  const mean = n ? sum(withData.map((t) => t.value)) / n : 0;
  const lacking = tiles.length - n;
  const summary = !n ? "" : flat ? msg.same(n, fv(mx)) : msg.desc(n, `${withData[0].label} ${fv(mx)}`, `${withData[n - 1].label} ${fv(mn)}`, fv(mean));
  const desc = props.description ?? (n ? `${msg.kind}. ${summary}${lacking ? `. ${msg.missing(lacking)}` : ""}.` : "");
  // Tiles without data are reachable by keyboard too and read as "No data" (they are in the table as well). So instead of the default sentence's "(k/N)", read the same text with the rank in it,
  // and End goes to the tile with the smallest value instead of the default (the last item, a tile without data)
  const announce = c.via === "keyboard" && c.active !== null && events[c.active] ? `${events[c.active].label}: ${events[c.active].formatted}` : "";

  return (
    <ChartFrame
      c={c}
      kind={msg.kind}
      ariaLabel={props.ariaLabel}
      description={desc}
      events={events}
      tip={tip}
      renderTip={props.tooltip}
      announce={announce}
      className={props.className}
      style={props.style}
      theme={props.theme}
      onPointerMove={(px, py, e) => {
        const i = cellOf.get(`${Math.floor((py - y0) / ch)},${Math.floor((px - x0) / cw)}`);
        const k = i === undefined ? null : eventOf.get(i) ?? null;
        if (k !== c.active) c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer");
      }}
      onKey={(e) => {
        // End goes to the tile with the smallest value (tiles without data come after it). Home goes to the largest tile, as by default
        if (e.key === "End" && n) {
          c.setActive(n - 1, "keyboard");
          return true;
        }
        if (!e.key.startsWith("Arrow") || !activeTile) return false;
        // Arrows move to the nearest tile in that direction, or stay put when there is none
        const next = tileNeighbor(grid, activeTile.i, e.key);
        if (next >= 0) c.setActive(eventOf.get(next) ?? null, "keyboard");
        return true;
      }}
    >
      {props.legend !== false && n ? <ScaleLegend p={p} right={legendRight} steps={steps} scale={scale} labels={ll} min={MIN_OPACITY} /> : null}
      {m.items.map((it) => {
        // An exiting tile is a cell of a grid no longer shown, so it has no place in the new grid (t.i is the old grid index)
        if (it.exiting) return null;
        const t = it.data;
        const { b, d, ring, sw, ink, name, valueText, valueSize, lineH, top, showName } = looks[t.i];
        const k = eventOf.get(t.i) ?? -1;
        const isHi = hiSet.has(t.i);
        const isActive = c.active === k;
        return (
          <g key={it.key} opacity={it.v[0]}>
            <path
              d={d}
              fill={sw ? sw.fill : p.paint("neutralSoft")}
              opacity={(sw ? sw.opacity : 1) * (c.active === null || isActive ? 1 : 0.55)}
              className="ztd-mark"
              onPointerEnter={(e) => c.setActive(k < 0 ? null : k, e.pointerType === "touch" ? "touch" : "pointer")}
              onClick={() => k >= 0 && c.click(k)}
            />
            {isHi || isActive ? <path d={ring} fill="none" stroke={p.paint("ink")} strokeWidth={isActive ? 2.5 : 2} pointerEvents="none" /> : null}
            {showName
              ? name.lines.map((line, j) => (
                  <Txt key={j} x={b.x + b.w / 2} y={top + j * lineH + lineH / 2} anchor="middle" size={name.size} weight={isHi ? 700 : sw ? 600 : 500} fill={ink}>
                    {line}
                  </Txt>
                ))
              : null}
            {showName && valueSize ? (
              <Txt x={b.x + b.w / 2} y={top + name.lines.length * lineH + 3 + valueSize / 2} anchor="middle" size={valueSize} weight={isHi ? 800 : 700} fill={ink}>
                {valueText}
              </Txt>
            ) : null}
          </g>
        );
      })}
    </ChartFrame>
  );
}
