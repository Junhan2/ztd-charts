import { Tag, tagBox } from "../core/annotations";
import { Txt } from "../core/ChartFrame";
import { argMin, linearFit, type LinearFit } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import { plural, type ChartLang } from "../core/i18n";
import { canvasColor, categoricalDots, type Swatch } from "../core/palette";
import { overlaps, textWidth, truncate, type Box } from "../core/text";
import type { Highlight } from "../core/types";
import { uniq } from "../data/accessor";
import type { Painter } from "../theme/context";
import { HEX_KIT } from "./scatter-hex";

/*
 * Math, text and drawing used only by the scatter plot. Only ScatterChart in bubble.tsx passes this kit (SCATTER_KIT),
 * so it stays out of bundles that import only BubbleChart. Both share PointChart in bubble.tsx, which draws the points and axes
 */

const en = {
  /** Point count per series. Example: " 3 series: Large 18 points, Small 9 points." */
  seriesCounts: (list: [string, number][]) => ` ${plural(list.length, "series", "series")}: ${list.map(([s, k]) => `${s} ${plural(k, "point")}`).join(", ")}.`,
  /** Correlation direction. sign 1 means rising, -1 falling, 0 no clear direction */
  trend: (sign: number, x: string, y: string, r2: string) =>
    sign > 0 ? ` ${y} rises as ${x} rises, R² ${r2}.` : sign < 0 ? ` ${y} falls as ${x} rises, R² ${r2}.` : ` No clear straight-line relationship between ${x} and ${y}, R² ${r2}.`,
  refs: (parts: string[]) => ` Reference ${parts.length > 1 ? "lines" : "line"} at ${parts.join(" and ")}.`,
  quadrants: (list: [string, number][]) => ` Quadrants: ${list.map(([q, k]) => `${q} ${k}`).join("; ")}.`,
  slope: "Trend slope",
  trendTag: "Trend",
  /** When no point falls inside the fixed domain (xDomain, yDomain) */
  outOfRange: "No points in this range.",
};
const TEXT: Record<ChartLang, typeof en> = {
  en,
  ko: {
    seriesCounts: (list) => ` 계열 ${list.length}개: ${list.map(([s, k]) => `${s} ${k}개`).join(", ")}.`,
    // Add "값" after each axis name so the Korean particle never breaks on the name's last letter
    trend: (sign, x, y, r2) =>
      sign > 0 ? ` ${x} 값이 클수록 ${y} 값도 커요(R² ${r2}).` : sign < 0 ? ` ${x} 값이 클수록 ${y} 값은 작아요(R² ${r2}).` : ` ${x} 값과 ${y} 값 사이에 뚜렷한 직선 관계가 없어요(R² ${r2}).`,
    refs: (parts) => ` 기준선 ${parts.join(", ")}.`,
    quadrants: (list) => ` 사분면: ${list.map(([q, k]) => `${q} ${k}개`).join(", ")}.`,
    slope: "추세 기울기",
    trendTag: "추세",
    outOfRange: "이 범위에는 점이 없어요.",
  },
};

/** Plot area: inside the axes */
export interface PlotBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** One quadrant label */
export interface PlacedTag {
  text: string;
  x: number;
  y: number;
  anchor: "start" | "end";
  box: Box;
}

/** Series label: a color dot and the series name. y is the middle of the line */
export interface SeriesLabel {
  si: number;
  y: number;
  box: Box;
}

/** One PointChart point (screen coordinates). si is the series index, -1 without series */
interface DotAt {
  x: number;
  y: number;
  r: number;
  hi: boolean;
  si: number;
}

/** Screen direction of an arrow key (down is +y). null for a non-arrow key */
function arrowStep(key: string): readonly [number, number] | null {
  switch (key) {
    case "ArrowRight":
      return [1, 0];
    case "ArrowLeft":
      return [-1, 0];
    case "ArrowDown":
      return [0, 1];
    case "ArrowUp":
      return [0, -1];
    default:
      return null;
  }
}

/**
 * The nearest point in an arrow's direction. Looks only at points in the half-plane from `from` in that direction (larger x for the right key) and picks the one with the shortest pixel distance.
 * Among points stacked on the same spot, the right and down keys go to the next index, the left and up keys to the previous one. null when no point lies in that direction
 */
export function nearestInDirection(pts: readonly { x: number; y: number }[], from: number, step: readonly [number, number]): number | null {
  const o = pts[from];
  const forward = step[0] + step[1] > 0;
  let best: number | null = null;
  let bd = Infinity;
  for (let k = 0; k < pts.length; k++) {
    if (k === from) continue;
    const dx = pts[k].x - o.x;
    const dy = pts[k].y - o.y;
    const ahead = dx * step[0] + dy * step[1] > 0 || (dx === 0 && dy === 0 && (forward ? k > from : k < from));
    if (!ahead) continue;
    const d = dx * dx + dy * dy;
    if (d < bd || (d === bd && best !== null && Math.abs(k - from) < Math.abs(best - from))) {
      bd = d;
      best = k;
    }
  }
  return best;
}

/** The point the first arrow key goes to: among the highlighted points (all points if none), the one at the far end opposite the key. The right key starts from the leftmost point */
function entryPoint(pts: readonly DotAt[], step: readonly [number, number]): number | null {
  const anyHi = pts.some((q) => q.hi);
  const k = argMin(pts.map((q) => (anyHi && !q.hi ? Infinity : q.x * step[0] + q.y * step[1])));
  return k < 0 ? null : k;
}

/** A value from 0 up to (but not including) 1, set by the seed and row index. It avoids Math.random, so it is the same on the server and in the browser, however many times it renders */
function seededUnit(seed: number, i: number): number {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The smallest gap between distinct x values. 1 when all values are equal */
function smallestGap(xs: readonly number[]): number {
  const s = [...new Set(xs)].sort((a, b) => a - b);
  let g = Infinity;
  for (let k = 1; k < s.length; k++) g = Math.min(g, s[k] - s[k - 1]);
  return Number.isFinite(g) ? g : 1;
}

/** Series highlight. A name, index, array or "first" (default) is matched against the series; a predicate highlights a series when any one of its rows matches. The card legend (autoLegend) uses this too */
export function seriesHighlight<T>(h: Highlight<T> | undefined, data: readonly T[], names: readonly string[], seriesOf: (d: T, i: number) => string): Set<number> {
  if (typeof h !== "function") return resolveHighlight(h, names, names, names.map(() => 0), "first");
  const index = new Map(names.map((s, k) => [s, k]));
  const out = new Set<number>();
  data.forEach((d, i) => {
    const k = index.get(seriesOf(d, i));
    if (k !== undefined && h(d, i)) out.add(k);
  });
  return out;
}

/** Trend line endpoints in data units [x0, y0, x1, y1]. Drawn over the points' x range and clipped outside the y-axis range. null when no line is left */
function fitSegment(fit: LinearFit, x0: number, x1: number, [ylo, yhi]: readonly [number, number]): [number, number, number, number] | null {
  let a = x0;
  let b = x1;
  if (fit.slope) {
    const xa = x0 + (ylo - fit.at(x0)) / fit.slope;
    const xb = x0 + (yhi - fit.at(x0)) / fit.slope;
    a = Math.max(a, Math.min(xa, xb));
    b = Math.min(b, Math.max(xa, xb));
  } else if (fit.at(x0) < ylo || fit.at(x0) > yhi) return null;
  return b > a ? [a, fit.at(a), b, fit.at(b)] : null;
}

/**
 * Trend line label position: the first spot that does not overlap avoid (quadrant names), tried in this order: above the right end, below the right end, above the left end, below the left end.
 * The label's outer edge extends 2px past the line end. Even when the line ends at the top of the plot and the label drops beside it, the line end never pokes out past the label
 */
function fitTagSpot(line: { x1: number; y1: number; x2: number; y2: number }, text: string, avoid: readonly Box[], b: PlotBox): { x: number; y: number; anchor: "start" | "end" } {
  const clampY = (v: number) => Math.max(b.y0 + 9, Math.min(b.y1 - 9, v));
  const tries: { x: number; y: number; anchor: "start" | "end" }[] = [
    { x: line.x2 + 2, y: clampY(line.y2 - 11), anchor: "end" },
    { x: line.x2 + 2, y: clampY(line.y2 + 11), anchor: "end" },
    { x: line.x1 - 2, y: clampY(line.y1 - 11), anchor: "start" },
    { x: line.x1 - 2, y: clampY(line.y1 + 11), anchor: "start" },
  ];
  return tries.find((t) => !avoid.some((q) => overlaps(q, tagBox(text, t.x, t.y, t.anchor), 2))) ?? tries[0];
}

/** Quadrant labels: the top two quadrants are labeled at the top of the plot, the bottom two just below the horizontal reference line, at the outer corners. Labels are shortened or dropped when a quadrant is narrow */
function quadrantTags(names: readonly string[], xr: number, yr: number, b: PlotBox): PlacedTag[] {
  const cells: { x: number; y: number; w: number; h: number; anchor: "start" | "end" }[] = [
    { x: b.x0 + 4, y: b.y0 + 10, w: xr - b.x0, h: yr - b.y0, anchor: "start" },
    { x: b.x1 - 4, y: b.y0 + 10, w: b.x1 - xr, h: yr - b.y0, anchor: "end" },
    { x: b.x0 + 4, y: yr + 10, w: xr - b.x0, h: b.y1 - yr, anchor: "start" },
    { x: b.x1 - 4, y: yr + 10, w: b.x1 - xr, h: b.y1 - yr, anchor: "end" },
  ];
  const out: PlacedTag[] = [];
  cells.forEach((q, k) => {
    const name = names[k];
    if (!name || q.h < 22 || q.w < 40) return;
    const text = truncate(name, q.w - 16, 10.5, 500);
    out.push({ text, x: q.x, y: q.y, anchor: q.anchor, box: tagBox(text, q.x, q.y, q.anchor) });
  });
  return out;
}

/** One series label line: color dot + 4px + text */
const SERIES_LABEL_SIZE = 11;
const seriesLabelWeight = (hi: boolean) => (hi ? 700 : 600);

/**
 * Series label positions: starting from the real point nearest the centroid, the first spot beside it (right, left, above, below) that overlaps no point, reserved box, other label or the area outside the plot.
 * A color dot and name floating in empty space look like missing data, so each name sits right next to a real point of its series.
 * Dropped when more than 4 series are visible or there is no room (the legend and tooltip carry the names)
 */
function placeSeriesLabels(
  dots: readonly DotAt[],
  names: readonly string[],
  hiSeries: ReadonlySet<number>,
  around: { box: PlotBox; reserved: readonly Box[]; grid: { g: Map<string, number[]>; cell: number } },
): SeriesLabel[] {
  const sums = names.map(() => ({ x: 0, y: 0, n: 0 }));
  for (const d of dots) {
    const s = sums[d.si];
    if (!s) continue;
    s.x += d.x;
    s.y += d.y;
    s.n++;
  }
  if (sums.filter((s) => s.n).length > 4) return [];
  const { box, reserved, grid } = around;
  const isFree = (b: Box) => {
    if (b.x < box.x0 + 2 || b.x + b.w > box.x1 - 2 || b.y < box.y0 || b.y + b.h > box.y1 - 2) return false;
    if (reserved.some((q) => overlaps(q, b, 2))) return false;
    for (let gx = Math.floor(b.x / grid.cell); gx <= Math.floor((b.x + b.w) / grid.cell); gx++)
      for (let gy = Math.floor(b.y / grid.cell); gy <= Math.floor((b.y + b.h) / grid.cell); gy++)
        for (const k of grid.g.get(`${gx},${gy}`) ?? []) {
          const d = dots[k];
          const nx = Math.max(b.x, Math.min(d.x, b.x + b.w));
          const ny = Math.max(b.y, Math.min(d.y, b.y + b.h));
          if (Math.hypot(d.x - nx, d.y - ny) < d.r + 1.5) return false;
        }
    return true;
  };
  const out: SeriesLabel[] = [];
  sums.forEach((s, si) => {
    if (!s.n) return;
    const w = textWidth(names[si], SERIES_LABEL_SIZE, seriesLabelWeight(hiSeries.has(si)));
    const h = 14;
    const cx = s.x / s.n;
    const cy = s.y / s.n;
    const near = dots.filter((d) => d.si === si).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    for (const d of near.slice(0, 40)) {
      const gap = d.r + 4;
      const tries = [
        { x: d.x + gap, y: d.y - h / 2, w, h },
        { x: d.x - gap - w, y: d.y - h / 2, w, h },
        { x: d.x - w / 2, y: d.y - gap - h, w, h },
        { x: d.x - w / 2, y: d.y + gap, w, h },
      ];
      const b = tries.find((t) => isFree(t) && !out.some((l) => overlaps(l.box, t, 2)));
      if (!b) continue;
      out.push({ si, y: b.y + h / 2, box: b });
      return;
    }
  });
  return out;
}

/** Sentences appended to the default description when scatter options change the plot: point count per series, correlation direction and R², reference lines, point count per quadrant */
function describeScatter(
  text: typeof en,
  o: {
    points: readonly { x: number; y: number; si: number }[];
    seriesNames: readonly string[];
    fit: LinearFit | null;
    xName: string;
    yName: string;
    refs: string[];
    refX?: number;
    refY?: number;
    quadrants: readonly string[];
  },
): string {
  let s = "";
  if (o.seriesNames.length) {
    const counts = o.seriesNames.map((name): [string, number] => [name, 0]);
    for (const q of o.points) if (counts[q.si]) counts[q.si][1]++;
    const shown = counts.filter(([, k]) => k > 0);
    if (shown.length) s += text.seriesCounts(shown);
  }
  // Below an R² of 0.1 (a correlation of about 0.3), no direction is stated
  if (o.fit) s += text.trend(o.fit.r2 < 0.1 ? 0 : Math.sign(o.fit.slope), o.xName, o.yName, o.fit.r2.toFixed(2));
  if (o.refs.length) s += text.refs(o.refs);
  const { refX, refY } = o;
  if (o.quadrants.length && refX !== undefined && refY !== undefined) {
    const counts = [0, 0, 0, 0];
    // Points on a line count toward the right and upper quadrants
    for (const q of o.points) counts[(q.y >= refY ? 0 : 2) + (q.x >= refX ? 1 : 0)]++;
    const named = o.quadrants.slice(0, 4).map((q, k): [string, number] => [q, counts[k]]).filter(([q]) => q);
    if (named.length) s += text.quadrants(named);
  }
  return s;
}

/** A group of points painted in one pass on the canvas. fill reads the CSS variable's value at draw time to get the actual color */
export interface CanvasGroup {
  ks: readonly number[];
  isHi: boolean;
  fill: (read: (cssVar: string, fallback: string) => string) => string;
}

/** Canvas paint groups per series: non-highlighted series first, faded, then the highlighted series */
function seriesCanvasGroups(dots: readonly DotAt[], colors: readonly Swatch[], hi: ReadonlySet<number>): CanvasGroup[] {
  const ks: number[][] = colors.map(() => []);
  dots.forEach((d, k) => ks[d.si]?.push(k));
  return [...ks.keys()].sort((a, b) => Number(hi.has(a)) - Number(hi.has(b))).map((si) => ({ ks: ks[si], isHi: hi.has(si), fill: (read) => canvasColor(colors[si], read) }));
}

/** Reference lines: drawn under the points (same look as the line chart's referenceLines) */
function RefLines({ p, x, y, box }: { p: Painter; x: number | null; y: number | null; box: PlotBox }) {
  return (
    <g aria-hidden="true" pointerEvents="none">
      {x !== null ? <line x1={x} x2={x} y1={box.y0} y2={box.y1} stroke={p.paint("dim")} strokeDasharray="3 3" /> : null}
      {y !== null ? <line x1={box.x0} x2={box.x1} y1={y} y2={y} stroke={p.paint("dim")} strokeDasharray="3 3" /> : null}
    </g>
  );
}

/** Scatter labels drawn over the points: the trend line and its label, quadrant names, series names. fade is the opacity they fade in to after the entrance */
function Overlay(props: {
  p: Painter;
  fade: number;
  trendTag: string;
  fitLine: { x1: number; y1: number; x2: number; y2: number } | null;
  fitTag: { x: number; y: number; anchor: "start" | "end" } | null;
  quads: readonly PlacedTag[];
  seriesLabels: readonly SeriesLabel[];
  seriesNames: readonly string[];
  colors: readonly Swatch[] | null;
  hiSeries: ReadonlySet<number> | null;
}) {
  const { p, fade, fitLine, fitTag, quads, colors, hiSeries } = props;
  return (
    <>
      {fitLine && fitTag ? (
        <g aria-hidden="true" pointerEvents="none" opacity={fade}>
          <line {...fitLine} stroke={p.paint("muted")} strokeWidth={1.5} strokeDasharray="6 4" strokeLinecap="round" />
          <Tag p={p} x={fitTag.x} y={fitTag.y} text={props.trendTag} anchor={fitTag.anchor} />
        </g>
      ) : null}
      {quads.length ? (
        <g aria-hidden="true" pointerEvents="none">
          {quads.map((q) => (
            <Tag key={`${q.anchor}${q.y}`} p={p} x={q.x} y={q.y} text={q.text} anchor={q.anchor} />
          ))}
        </g>
      ) : null}
      {colors && hiSeries
        ? props.seriesLabels.map((l) => {
            const isHi = hiSeries.has(l.si);
            return (
              <g key={`s${l.si}`} aria-hidden="true" pointerEvents="none" opacity={fade}>
                <Txt x={l.box.x} y={l.y} size={SERIES_LABEL_SIZE} weight={seriesLabelWeight(isHi)} fill={p.paint(isHi ? "ink" : "muted")}>
                  {props.seriesNames[l.si]}
                </Txt>
              </g>
            );
          })
        : null}
    </>
  );
}

/** Whether there are points but none inside the fixed range [x0, x1] × [y0, y1] (stops at the first point inside) */
function noneInside(pts: readonly { x: number; y: number }[], [x0, x1]: readonly number[], [y0, y1]: readonly number[]): boolean {
  return pts.length > 0 && !pts.some((q) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1);
}

/** The scatter features ScatterChart passes to PointChart */
export const SCATTER_KIT = {
  text: TEXT,
  arrowStep,
  nearestInDirection,
  entryPoint,
  seededUnit,
  smallestGap,
  uniq,
  seriesHighlight,
  colors: categoricalDots,
  canvasGroups: seriesCanvasGroups,
  linearFit,
  fitSegment,
  fitTagSpot,
  quadrantTags,
  tagBox,
  placeSeriesLabels,
  describe: describeScatter,
  RefLines,
  Overlay,
  /** Hexagonal density (options.bin "hex") */
  hex: HEX_KIT,
  noneInside,
};

export type ScatterKit = typeof SCATTER_KIT;
