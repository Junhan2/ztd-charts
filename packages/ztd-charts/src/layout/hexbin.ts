import { clamp, r2 } from "../core/geometry";

/*
 * Calculations for the scatter plot hexagonal density (options.bin "hex"). Points are counted into pointy-top hexagonal cells in screen coordinates (after the axis scales).
 * So log axes work as they are. Shared by the scatter plot drawing and the common color scale of small multiples (both in charts/scatter-hex.tsx)
 */

/**
 * Margins (px) of the sizeless point plot (PointChart in bubble.tsx): the legend row above the hexagonal density, the x axis label row below, and the padding inside the axis range.
 * The common color scale of small multiples (hexFacetPlan) uses the same values so it counts cells over the same plot area as the chart
 */
export const HEX_TOP = 20;
export const PLOT_BOTTOM = 24;
export const DOT_PAD = 4;

/** Default and range of the cell width (px, between two opposite sides). Below 4 there are tens of thousands of cells and the drawing only grows; above 200 one cell covers the plot */
export const HEX_SIZE = 16;
export const HEX_MIN = 4;
export const HEX_MAX = 200;

/** Cell width. The default when not a finite number; the nearer limit when out of range */
export function hexSize(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? clamp(v, HEX_MIN, HEX_MAX) : HEX_SIZE;
}

/** One cell. col and row are its grid position (odd rows shift half a cell right); cx and cy are its center (px) */
export interface HexCell {
  col: number;
  row: number;
  cx: number;
  cy: number;
  count: number;
}

/** Grid: cell width w, radius to a vertex r = w/√3, row spacing 1.5r. The top left (x0, y0) is the center of cell 0 in row 0 */
export interface HexGrid {
  w: number;
  r: number;
  x0: number;
  y0: number;
}

/**
 * Upper limit on the number of grid cells. hexBins allocates one integer (4 bytes) per grid cell, so even when a server render gets a huge width or height (a spec's options.height and so on),
 * memory stays under about 0.8MB. Normal sizes (up to 2400 × 1000px at width 4) stay below this, so the cell width is unchanged
 */
export const HEX_MAX_CELLS = 200_000;

/** Number of grid cells of width w covering the plot area box (the array length hexBins allocates) */
function cellsFor(w: number, box: { x0: number; x1: number; y0: number; y1: number }): number {
  const cols = Math.max(1, Math.ceil((box.x1 - box.x0) / w) + 3);
  const rows = Math.max(1, Math.ceil((box.y1 - box.y0) / ((1.5 * w) / Math.sqrt(3))) + 3);
  return cols * rows;
}

/**
 * Grid for the plot area box. The cell width is hexSize(size); if that width would exceed HEX_MAX_CELLS grid cells, it is widened until it does not.
 * So the cell count and memory stay within a fixed limit whatever the plot size. Tooltips and announcements state ranges from this grid (the cells actually drawn)
 */
export function hexGrid(size: unknown, box: { x0: number; x1: number; y0: number; y1: number }): HexGrid {
  let w = hexSize(size);
  if (cellsFor(w, box) > HEX_MAX_CELLS) {
    // Jump close in one step by area, then widen bit by bit until the edge cells fit as well
    w = Math.max(w, Math.sqrt(((box.x1 - box.x0) * (box.y1 - box.y0) * Math.sqrt(3)) / 1.5 / HEX_MAX_CELLS));
    while (cellsFor(w, box) > HEX_MAX_CELLS) w *= 1.02;
  }
  return { w, r: w / Math.sqrt(3), x0: box.x0, y0: box.y0 };
}

/** Center of a cell (px) */
export function hexCenter(g: HexGrid, col: number, row: number): [number, number] {
  return [g.x0 + (col + (row & 1) / 2) * g.w, g.y0 + row * 1.5 * g.r];
}

/**
 * The cell [col, row] a point falls in. Picks the nearest cell in each of the two nearest rows, then the one whose center is truly closer.
 * A hexagonal cell is the set of points nearest to its center, so one of the two is right (a cell three rows away is always farther)
 */
export function hexOf(g: HexGrid, x: number, y: number): [number, number] {
  hexInto(g, x, y, SPOT);
  return [SPOT[0], SPOT[1]];
}

/** The body of hexOf: writes [col, row] into out without creating a new array. Used in the hexBins loop over a million points */
const SPOT = new Int32Array(2);
function hexInto(g: HexGrid, x: number, y: number, out: Int32Array): void {
  const dy = 1.5 * g.r;
  const fy = (y - g.y0) / dy;
  const fx = (x - g.x0) / g.w;
  const j1 = Math.round(fy);
  const j2 = fy < j1 ? j1 - 1 : j1 + 1;
  const i1 = Math.round(fx - (j1 & 1) / 2);
  const i2 = Math.round(fx - (j2 & 1) / 2);
  // Distances to the centers of the two candidate cells (the same formula as hexCenter)
  const ax = g.x0 + (i1 + (j1 & 1) / 2) * g.w - x;
  const ay = g.y0 + j1 * dy - y;
  const bx = g.x0 + (i2 + (j2 & 1) / 2) * g.w - x;
  const by = g.y0 + j2 * dy - y;
  const first = ax * ax + ay * ay <= bx * bx + by * by;
  out[0] = first ? i1 : i2;
  out[1] = first ? j1 : j2;
}

/**
 * Counts points into cells in a single pass. xs and ys are screen coordinates; points outside [x0, x1] × [y0, y1] and non-finite points are skipped.
 * Per-cell counts go into a dense integer array, so even a million points take one pass, and empty cells are not returned. The order is by row, then cell
 */
export function hexBins(g: HexGrid, xs: ArrayLike<number>, ys: ArrayLike<number>, box: { x0: number; x1: number; y0: number; y1: number }): HexCell[] {
  // Edge points can also land in outer cells (index -1, last + 1), so one extra cell is kept on each side.
  // The grid is the one hexGrid fitted within HEX_MAX_CELLS; even when a different area is passed, the array stops at that limit (points in rows beyond it are not counted)
  const cols = Math.max(1, Math.ceil((box.x1 - g.x0) / g.w) + 3);
  const rows = Math.min(Math.max(1, Math.ceil((box.y1 - g.y0) / (1.5 * g.r)) + 3), Math.max(1, Math.floor(HEX_MAX_CELLS / cols)));
  const counts = new Int32Array(Math.min(cols * rows, HEX_MAX_CELLS));
  const at = new Int32Array(2);
  for (let k = 0; k < xs.length; k++) {
    const x = xs[k];
    const y = ys[k];
    if (!(x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1)) continue;
    hexInto(g, x, y, at);
    const c = at[0] + 1;
    const rr = at[1] + 1;
    if (c >= 0 && c < cols && rr >= 0 && rr < rows) counts[rr * cols + c]++;
  }
  const out: HexCell[] = [];
  for (let idx = 0; idx < counts.length; idx++) {
    const n = counts[idx];
    if (!n) continue;
    const col = (idx % cols) - 1;
    const row = Math.floor(idx / cols) - 1;
    const [cx, cy] = hexCenter(g, col, row);
    out.push({ col, row, cx, cy, count: n });
  }
  return out;
}

/** Gap between cells (px). Following the same idea as heatmap cells, it narrows as cells shrink and disappears when they are very small */
export function hexGap(w: number): number {
  return w > 14 ? 1.5 : w > 6 ? 1 : 0;
}

/**
 * One path gathering the cells of the same color. Each cell is "M<top vertex>" followed by the same six relative-coordinate sides, so it stays short even with thousands of cells.
 * Cells shrink by gap, leaving an even gap between neighbors
 */
export function hexPath(g: HexGrid, cells: readonly Pick<HexCell, "cx" | "cy">[], gap = 0): string {
  const r = Math.max(0.1, g.r - gap / Math.sqrt(3));
  const hw = r2((r * Math.sqrt(3)) / 2);
  const hr = r2(r / 2);
  const rr = r2(r);
  const shape = `l${hw},${hr}v${rr}l-${hw},${hr}l-${hw}-${hr}v-${rr}z`;
  let d = "";
  for (const c of cells) d += `M${r2(c.cx)},${r2(c.cy - r)}${shape}`;
  return d;
}

/**
 * Neighbor cell in the arrow direction (d, in screen terms, so down is +y; arrowStep in scatter-kit). It is the cell with the nearest center within 45 degrees of that direction, so empty cells are skipped and it moves on to the next cell.
 * Up and down, the two cells in the row directly above (below) are equally far, so even rows pick the right one and odd rows the left one, and repeated presses do not drift sideways.
 * -1 when there is no cell in that direction
 */
export function hexNeighbor(cells: readonly Pick<HexCell, "cx" | "cy" | "row">[], from: number, d: readonly [number, number]): number {
  const a = cells[from];
  if (!a) return -1;
  const lean = a.row & 1 ? -1 : 1;
  let best = -1;
  let bd = Infinity;
  let bLean = -Infinity;
  for (let k = 0; k < cells.length; k++) {
    const dx = cells[k].cx - a.cx;
    const dy = cells[k].cy - a.cy;
    const along = dx * d[0] + dy * d[1];
    const across = Math.abs(dx * d[1] - dy * d[0]);
    if (along <= 0 || across > along + 1e-6) continue;
    const dist = Math.round((dx * dx + dy * dy) * 1e4);
    const l = Math.sign(dx) * lean;
    if (dist < bd || (dist === bd && l > bLean)) {
      bd = dist;
      bLean = l;
      best = k;
    }
  }
  return best;
}
