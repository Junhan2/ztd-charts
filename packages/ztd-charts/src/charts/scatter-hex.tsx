import { useId } from "react";
import { yAxisWidth } from "../core/axis";
import { cssEntrance, useCssEntrance } from "../core/css";
import type { FacetPlan } from "../core/facet";
import { formatNumber, makeTickFormatter, type FormatSpec, type ValueFormatter } from "../core/format";
import type { ChartLang } from "../core/i18n";
import { lazyArray } from "../core/lazy";
import { clamp } from "../core/geometry";
import { colorScaleOf, scaleSwatch, scaleT, type ColorScaleOptions } from "../core/palette";
import { scaleLinear, scaleLog, type LinearScale } from "../core/scale";
import { ScaleLegend, scaleLegendWidth } from "../core/scaleLegend";
import { textWidth, truncate } from "../core/text";
import type { ChartEvent, TooltipData } from "../core/types";
import { numGetter } from "../data/accessor";
import { DOT_PAD, HEX_TOP, PLOT_BOTTOM, hexBins, hexGap, hexGrid, hexNeighbor, hexOf, hexPath, type HexCell, type HexGrid } from "../layout/hexbin";
import { useChartTheme, type Painter } from "../theme/context";

/*
 * Hexagonal density for the scatter plot (options.bin "hex"). PointChart in bubble.tsx draws these cells instead of points.
 * It is passed only through SCATTER_KIT.hex and ScatterChart.facetPlan, so it stays out of the bundles of the bubble chart and other charts
 */

const en = {
  /** Number of points in a cell. count is a locale-formatted number */
  points: (n: number, count: string) => `${count} ${n === 1 ? "point" : "points"}`,
  range: (lo: string, hi: string) => `${lo} to ${hi}`,
  /** Sentence appended to the description: the number of cells and the densest cell */
  desc: (cells: number, top: string) => ` Binned into ${cells} ${cells === 1 ? "hexagon" : "hexagons"}. Densest: ${top}.`,
};
const TEXT: Record<ChartLang, typeof en> = {
  en,
  ko: {
    points: (_n, count) => `점 ${count}개`,
    range: (lo, hi) => `${lo}~${hi}`,
    desc: (cells, top) => ` 육각 칸 ${cells}개로 묶었어요. 가장 촘촘한 칸: ${top}.`,
  },
};

/** Opacity of the lightest step. Same as the tile grid map, so even a cell with one point stands out from the background */
const MIN_OPACITY = 0.14;

type Box = { x0: number; x1: number; y0: number; y1: number };

/** One cell and its color position t (0 to 1, passed to scaleSwatch) */
interface HexInfo extends HexCell {
  t: number;
}

interface HexModel {
  grid: HexGrid;
  /** Cells with the most points first (Home is the densest cell, End the sparsest) */
  cells: HexInfo[];
  /** Point counts at both ends of the color scale */
  lo: number;
  hi: number;
  /** "col,row" → index in cells */
  at: Map<string, number>;
  /** Color scale (always has a step count) */
  scale: ColorScaleOptions & { steps: number };
  /** Groups of same-color cells (lightest step first). d is a single path */
  groups: { t: number; d: string }[];
}

/** Maps points inside the axis range to screen coordinates. Points outside the range (zoom, fixed domain) and values at or below 0 on a log axis become NaN and are not counted */
function plotted(n: number, vx: (k: number) => number, vy: (k: number) => number, x: LinearScale, y: LinearScale): [Float64Array, Float64Array] {
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const [xa, xb] = x.domain;
  const [ya, yb] = y.domain;
  for (let k = 0; k < n; k++) {
    const a = vx(k);
    const b = vy(k);
    const inside = a >= xa && a <= xb && b >= ya && b <= yb;
    xs[k] = inside ? x(a) : NaN;
    ys[k] = inside ? y(b) : NaN;
  }
  return [xs, ys];
}

/** [Fewest, most] points across the cells. [Infinity, -Infinity] when there are no cells */
function countRange(cells: readonly HexCell[], lo = Infinity, hi = -Infinity): [number, number] {
  for (const c of cells) {
    lo = Math.min(lo, c.count);
    hi = Math.max(hi, c.count);
  }
  return [lo, hi];
}

/** Counts points (screen coordinates) into cells and groups the cells by color step. With domain (one shared color scale across small multiples), colors by that point-count range */
function hexModel(xs: Float64Array, ys: Float64Array, box: Box, size: unknown, colorSteps: number | undefined, domain: readonly [number, number] | undefined): HexModel {
  const grid = hexGrid(size, box);
  const raw = hexBins(grid, xs, ys, box);
  let [lo, hi] = countRange(raw);
  if (domain && Number.isFinite(domain[0]) && Number.isFinite(domain[1]) && domain[1] >= domain[0]) [lo, hi] = domain;
  const scale = colorScaleOf(undefined, undefined, colorSteps ?? 5) as HexModel["scale"];
  const tOf = (n: number) => (hi > lo ? clamp((n - lo) / (hi - lo), 0, 1) : 1);
  // raw is in row, then cell order, so each color step's path string is always the same for the same data
  const byStep = new Map<number, HexInfo[]>();
  const cells: HexInfo[] = raw.map((c) => {
    const cell = { ...c, t: tOf(c.count) };
    const k = scaleT(cell.t, scale);
    const list = byStep.get(k);
    if (list) list.push(cell);
    else byStep.set(k, [cell]);
    return cell;
  });
  cells.sort((a, b) => b.count - a.count || a.row - b.row || a.col - b.col);
  const gap = hexGap(grid.w);
  const groups = [...byStep.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => ({ t: list[0].t, d: hexPath(grid, list, gap) }));
  return { grid, cells, lo: Number.isFinite(lo) ? lo : 0, hi: Number.isFinite(hi) ? hi : 0, at: new Map(cells.map((c, k) => [`${c.col},${c.row}`, k])), scale, groups };
}

/** [Low, high] values a cell covers: clamps the screen interval [a, b] to the scale's screen range (the axis range) and maps it back through the scale. Edge cells never report values outside the axis (below 0, etc.) */
function covered(s: LinearScale, a: number, b: number): [number, number] {
  const min = Math.min(s.range[0], s.range[1]);
  const max = Math.max(s.range[0], s.range[1]);
  const u = s.invert(clamp(a, min, max));
  const v = s.invert(clamp(b, min, max));
  return u <= v ? [u, v] : [v, u];
}

/** Range text. Without a set format, uses decimals that fit the range width (two or three significant digits), and puts the unit only on the second value */
function rangeText(text: typeof en, [lo, hi]: [number, number], locale: string, fmt: ValueFormatter | null, unit = ""): string {
  const span = hi - lo;
  const dec = span > 0 ? Math.max(0, Math.min(6, 1 - Math.floor(Math.log10(span)))) : 2;
  const f = fmt ?? ((v: number) => formatNumber(v, { locale, maximumFractionDigits: dec }));
  return text.range(f(lo), `${f(hi)}${unit}`);
}

/** Shortens the y-axis title so it does not overlap the legend. Empty string when there is no room */
function fitTitle(title: string, left: number, legendW: number, W: number): string {
  const room = W - legendW - 12 - left;
  return textWidth(title, 10.5) <= room ? title : room > 24 ? truncate(title, room, 10.5) : "";
}

/** Chart props read by the hexagonal density */
interface HexProps {
  binSize?: number;
  colorSteps?: number;
  binDomain?: [number, number];
  binLegend?: boolean;
  xFormat?: unknown;
  format?: unknown;
  unit?: string;
  xLabel?: string;
  yLabel?: string;
}

/** PointChart's drawing state: filtered rows, scales, plot area, value-axis label width, chart context (text, formats), x format */
interface HexFrame {
  raw: readonly { x: number; y: number }[];
  x: LinearScale;
  y: LinearScale;
  box: Box;
  left: number;
  c: { lang: ChartLang; locale: string; fmt: ValueFormatter; width: number };
  xFmt: ValueFormatter;
}

/**
 * Everything for one hexagonal density plot: cell model, items (cells with the most points first), tooltip, screen reader text, description, legend, y-axis title, keyboard and pointer.
 * PointChart only builds this once and uses it, so the bubble chart bundle barely grows
 */
function hexView<T>(props: HexProps, f: HexFrame) {
  const { raw, c } = f;
  const [xs, ys] = plotted(raw.length, (k) => raw[k].x, (k) => raw[k].y, f.x, f.y);
  const m = hexModel(xs, ys, f.box, props.binSize, props.colorSteps, props.binDomain);
  const t = TEXT[c.lang];
  const { locale } = c;
  // The set format if there is one, otherwise digits fitted to the range width
  const xFmt = props.xFormat !== undefined ? f.xFmt : null;
  const yFmt = props.format !== undefined ? c.fmt : null;
  const texts = (k: number) => {
    const cell = m.cells[k];
    const { w, r } = m.grid;
    return {
      count: t.points(cell.count, formatNumber(cell.count, { locale, maximumFractionDigits: 0 })),
      x: rangeText(t, covered(f.x, cell.cx - w / 2, cell.cx + w / 2), locale, xFmt),
      y: rangeText(t, covered(f.y, cell.cy - r, cell.cy + r), locale, yFmt, props.unit),
    };
  };
  /** "658 points, Request size (KB) 270 to 280, Latency (ms) 520 to 545 ms": adds the axis titles (x, y when missing), like the tooltip */
  const say = (k: number | null) => {
    if (k === null || !m.cells[k]) return "";
    const tx = texts(k);
    return `${tx.count}, ${props.xLabel ?? "x"} ${tx.x}, ${props.yLabel ?? "y"} ${tx.y}`;
  };
  const events: ChartEvent<T>[] = lazyArray(m.cells.length, (k) => {
    const tx = texts(k);
    const cell = m.cells[k];
    return { datum: null as T, index: k, key: `${cell.col},${cell.row}`, label: `x ${tx.x}, y ${tx.y}`, value: cell.count, formatted: tx.count };
  });
  // Color legend: only when there are cells and their point counts differ. The y-axis title is shortened so it does not overlap the legend
  const labels: [string, string] = [formatNumber(m.lo, { locale }), formatNumber(m.hi, { locale })];
  const legend = props.binLegend !== false && m.cells.length && m.hi > m.lo ? { right: c.width, labels } : null;
  return {
    m,
    events,
    say,
    desc: m.cells.length ? t.desc(m.cells.length, say(0)) : "",
    legend,
    yTitle: props.yLabel && legend ? fitTitle(props.yLabel, f.left, scaleLegendWidth(m.scale.steps, labels), c.width) : props.yLabel,
    tip: (k: number | null): TooltipData | null => {
      if (k === null || !m.cells[k]) return null;
      const tx = texts(k);
      return { x: m.cells[k].cx, y: m.cells[k].cy - m.grid.r, title: tx.count, rows: [{ label: props.xLabel ?? "x", value: tx.x }, { label: props.yLabel ?? "y", value: tx.y }] };
    },
    /** The cell under the pointer (null outside the plot area or on an empty cell) */
    at: (px: number, py: number): number | null => {
      const { box } = f;
      if (!(px >= box.x0 && px <= box.x1 && py >= box.y0 && py <= box.y1)) return null;
      const [i, j] = hexOf(m.grid, px, py);
      return m.at.get(`${i},${j}`) ?? null;
    },
    /** The cell an arrow direction (arrowStep) moves to: the densest cell first, then the neighbor in that direction (empty cells are skipped). null for a non-arrow key, -1 when there is nowhere to go */
    step: (dir: readonly [number, number] | null, active: number | null): number | null => {
      if (!dir || !m.cells.length) return null;
      return active === null || !m.cells[active] ? 0 : hexNeighbor(m.cells, active, dir);
    },
  };
}

export type HexView = ReturnType<typeof hexView>;

/**
 * Cell drawing: color step paths clipped to the plot area, the outline of the selected cell, and the color legend on top. The entrance reveals the steps in order, lightest first (CSS).
 * With reduced motion, and on a first render that takes over a server render, it shows the final state
 */
function HexLayer(props: { p: Painter; v: HexView; box: Box; active: number | null; c: { motion: { enabled: boolean }; hydrated: boolean }; m: { waiting: boolean; generation: number }; onPick: (k: number) => void }) {
  const { p, box, active } = props;
  const { m, legend } = props.v;
  const id = `${useId().replace(/:/g, "")}hx`;
  const enabled = useCssEntrance(props.c, props.m);
  const { scale } = m;
  const a = active !== null ? m.cells[active] : undefined;
  const aSw = a ? scaleSwatch(p, a.t, MIN_OPACITY, scale) : null;
  return (
    <>
      <defs>
        <clipPath id={id}>
          <rect x={box.x0} y={box.y0} width={Math.max(0, box.x1 - box.x0)} height={Math.max(0, box.y1 - box.y0)} />
        </clipPath>
      </defs>
      <g key={props.m.generation} clipPath={`url(#${id})`} onClick={() => active !== null && props.onPick(active)}>
        {m.groups.map((g, gi) => {
          const s = scaleSwatch(p, g.t, MIN_OPACITY, scale);
          return <path key={gi} className="ztd-mark" d={g.d} fill={s.fill} opacity={s.opacity * (a ? 0.55 : 1)} style={cssEntrance(enabled, props.m.waiting, "fade", gi * 70, 360)} />;
        })}
        {a && aSw ? <path d={hexPath(m.grid, [a], hexGap(m.grid.w))} fill={aSw.fill} fillOpacity={aSw.opacity} stroke={p.paint("ink")} strokeWidth={2} strokeLinejoin="round" pointerEvents="none" /> : null}
      </g>
      {legend ? <ScaleLegend p={p} right={legend.right} steps={scale.steps} scale={scale} labels={legend.labels} min={MIN_OPACITY} /> : null}
    </>
  );
}

/** One color legend for all the small multiples (FacetPlan.legend). The server SVG finds it by class and moves it */
function FacetLegend({ steps, labels }: { steps: number; labels: [string, string] }) {
  const p = useChartTheme();
  const w = Math.ceil(scaleLegendWidth(steps, labels)) + 8;
  return (
    <svg className="ztd-facet-legend" width={w} height={16} viewBox={`0 0 ${w} 16`} overflow="visible">
      <ScaleLegend p={p} right={w} steps={steps} scale={colorScaleOf(undefined, undefined, steps)} labels={labels} min={MIN_OPACITY} />
    </svg>
  );
}

/**
 * Shared color scale for small multiples (ChartFacets): with a shared value axis, counts the cells of each panel over the same plot area as the chart, passes the [fewest, most] points across all panels
 * as the panel prop binDomain, and draws the color legend once above the group (FacetPlan.legend) instead of in every panel. So a color means the same point count in every panel.
 * When it is not a hexagonal density or each panel has its own axes (scale "free"), returns the plan unchanged, so each panel keeps its own legend
 */
export function hexFacetPlan(plan: FacetPlan, cp: Record<string, unknown>, locale: string): FacetPlan {
  const first = plan.panels[0]?.props;
  const dx = first?.xDomain as [number, number] | undefined;
  const dy = first?.yDomain as [number, number] | undefined;
  if (cp.bin !== "hex" || !dx || !dy) return plan;
  const isLog = cp.yScale === "log";
  const { pw, ph } = plan;
  // Same layout as PointChart: the legend is outside the panel, so the top is that of a plain scatter plot (20 with a y-axis title, 10 without), the bottom holds the x-axis label row, plus padding inside the axis range, and the left is the value-axis label width (only in panels that show those labels)
  const top = cp.yLabel ? HEX_TOP : 10;
  const y = (isLog ? scaleLog : scaleLinear)(dy, [ph - PLOT_BOTTOM - DOT_PAD, top + DOT_PAD]);
  const axisW = yAxisWidth(y.ticks(Math.max(2, Math.round(ph / 70))), makeTickFormatter(cp.format as FormatSpec | undefined, locale, Math.max(Math.abs(dy[0]), Math.abs(dy[1]))), locale);
  const gx = numGetter<Record<string, unknown>>(cp.x as string | undefined, "x");
  const gy = numGetter<Record<string, unknown>>(cp.y as string | undefined, "y");
  let lo = Infinity;
  let hi = -Infinity;
  for (const pn of plan.panels) {
    const rows = pn.props.data as Record<string, unknown>[];
    const left = pn.props.showYAxis === false ? 0 : axisW;
    const x = scaleLinear(dx, [left + 6 + DOT_PAD, pw - 8 - DOT_PAD]);
    const [xs, ys] = plotted(rows.length, (k) => gx(rows[k], k), (k) => gy(rows[k], k), x, y);
    const box = { x0: left, x1: pw, y0: top, y1: ph - PLOT_BOTTOM };
    [lo, hi] = countRange(hexBins(hexGrid(cp.binSize, box), xs, ys, box), lo, hi);
  }
  const panels = plan.panels.map((pn) => ({ ...pn, props: { ...pn.props, binLegend: false, ...(hi >= lo && { binDomain: [lo, hi] }) } }));
  const steps = colorScaleOf(undefined, undefined, (cp.colorSteps as number | undefined) ?? 5).steps ?? 5;
  const legend = hi > lo ? <FacetLegend steps={steps} labels={[formatNumber(lo, { locale }), formatNumber(hi, { locale })]} /> : undefined;
  return { ...plan, panels, legend };
}

/** The hexagonal density kit PointChart receives */
export const HEX_KIT = { view: hexView, Layer: HexLayer };
