export const TAU = Math.PI * 2;

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) if (Number.isFinite(x)) s += x;
  return s;
}
export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** a radians clockwise from 12 o'clock */
export function polar(cx: number, cy: number, r: number, a: number): [number, number] {
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

/** Donut/pie slice path. A pie slice when r0 = 0 */
export function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const da = a1 - a0;
  if (!(Math.abs(da) > 1e-4) || r1 <= 0) return "";
  const full = Math.abs(da) >= TAU - 1e-4;
  if (full) {
    const ring = (r: number, sweep: 0 | 1) => {
      const [x0, y0] = polar(cx, cy, r, a0);
      const [x1, y1] = polar(cx, cy, r, a0 + Math.PI);
      return `M${r2(x0)},${r2(y0)}A${r2(r)},${r2(r)} 0 1 ${sweep} ${r2(x1)},${r2(y1)}A${r2(r)},${r2(r)} 0 1 ${sweep} ${r2(x0)},${r2(y0)}Z`;
    };
    return r0 > 0 ? `${ring(r1, 1)}${ring(r0, 0)}` : ring(r1, 1);
  }
  const s = da > 0 ? 1 : 0;
  const large = Math.abs(da) > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r1, a0);
  const [x1, y1] = polar(cx, cy, r1, a1);
  if (r0 <= 0) return `M${r2(cx)},${r2(cy)}L${r2(x0)},${r2(y0)}A${r2(r1)},${r2(r1)} 0 ${large} ${s} ${r2(x1)},${r2(y1)}Z`;
  const [x2, y2] = polar(cx, cy, r0, a1);
  const [x3, y3] = polar(cx, cy, r0, a0);
  return `M${r2(x0)},${r2(y0)}A${r2(r1)},${r2(r1)} 0 ${large} ${s} ${r2(x1)},${r2(y1)}L${r2(x2)},${r2(y2)}A${r2(r0)},${r2(r0)} 0 ${large} ${1 - s} ${r2(x3)},${r2(y3)}Z`;
}

/** Open arc (stroke) path */
export function arcLine(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const da = a1 - a0;
  if (!(Math.abs(da) > 1e-4)) return "";
  const e = Math.abs(da) >= TAU - 1e-4 ? a0 + (da > 0 ? TAU - 1e-4 : -(TAU - 1e-4)) : a1;
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, e);
  const large = Math.abs(e - a0) > Math.PI ? 1 : 0;
  return `M${r2(x0)},${r2(y0)}A${r2(r)},${r2(r)} 0 ${large} ${da > 0 ? 1 : 0} ${r2(x1)},${r2(y1)}`;
}

export interface Corners {
  tl?: number;
  tr?: number;
  br?: number;
  bl?: number;
}

/** Rectangle path whose corners can each take their own radius */
export function roundRectPath(x: number, y: number, w: number, h: number, c: Corners | number): string {
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  if (w <= 0.01 || h <= 0.01) return "";
  const k = typeof c === "number" ? { tl: c, tr: c, br: c, bl: c } : c;
  const m = Math.min(w, h) / 2;
  const tl = clamp(k.tl ?? 0, 0, m);
  const tr = clamp(k.tr ?? 0, 0, m);
  const br = clamp(k.br ?? 0, 0, m);
  const bl = clamp(k.bl ?? 0, 0, m);
  return (
    `M${r2(x + tl)},${r2(y)}H${r2(x + w - tr)}` +
    (tr ? `A${r2(tr)},${r2(tr)} 0 0 1 ${r2(x + w)},${r2(y + tr)}` : "") +
    `V${r2(y + h - br)}` +
    (br ? `A${r2(br)},${r2(br)} 0 0 1 ${r2(x + w - br)},${r2(y + h)}` : "") +
    `H${r2(x + bl)}` +
    (bl ? `A${r2(bl)},${r2(bl)} 0 0 1 ${r2(x)},${r2(y + h - bl)}` : "") +
    `V${r2(y + tl)}` +
    (tl ? `A${r2(tl)},${r2(tl)} 0 0 1 ${r2(x + tl)},${r2(y)}` : "") +
    "Z"
  );
}

type Pt = [number, number];

/** Monotone cubic (Fritsch-Carlson). It never overshoots the values */
export function monotonePath(pts: Pt[], move = true): string {
  const n = pts.length;
  if (!n) return "";
  const head = (p: Pt) => `${move ? "M" : "L"}${r2(p[0])},${r2(p[1])}`;
  if (n < 3) return head(pts[0]) + pts.slice(1).map((p) => `L${r2(p[0])},${r2(p[1])}`).join("");
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const d = pts[i + 1][0] - pts[i][0];
    dx.push(d);
    m.push(d === 0 ? 0 : (pts[i + 1][1] - pts[i][1]) / d);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t.push(0);
    else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t.push((w1 + w2) / (w1 / m[i - 1] + w2 / m[i]));
    }
  }
  t.push(m[n - 2]);
  let d = head(pts[0]);
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${r2(pts[i][0] + h)},${r2(pts[i][1] + t[i] * h)} ${r2(pts[i + 1][0] - h)},${r2(pts[i + 1][1] - t[i + 1] * h)} ${r2(pts[i + 1][0])},${r2(pts[i + 1][1])}`;
  }
  return d;
}

export type Curve = "smooth" | "linear" | "step";

export function linePath(pts: Pt[], curve: Curve = "smooth"): string {
  if (!pts.length) return "";
  if (curve === "smooth") return monotonePath(pts);
  if (curve === "step") {
    let d = `M${r2(pts[0][0])},${r2(pts[0][1])}`;
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1][0] + pts[i][0]) / 2;
      d += `H${r2(mx)}V${r2(pts[i][1])}H${r2(pts[i][0])}`;
    }
    return d;
  }
  return polyline(pts);
}

/** Path joining points with straight lines. Charts that need no curve code (live line) import only this */
export function polyline(pts: Pt[]): string {
  if (!pts.length) return "";
  let d = `M${r2(pts[0][0])},${r2(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += `L${r2(pts[i][0])},${r2(pts[i][1])}`;
  return d;
}

/** Area path from a top and a bottom boundary */
export function areaPath(top: Pt[], bottom: Pt[], curve: Curve = "smooth"): string {
  if (!top.length) return "";
  const rev = [...bottom].reverse();
  const up = linePath(top, curve);
  let down: string;
  if (curve === "smooth") down = monotonePath(rev.map((p) => [p[0], p[1]] as Pt), false);
  else if (curve === "step") down = linePath(rev, "step").replace(/^M/, "L");
  else down = rev.map((p) => `L${r2(p[0])},${r2(p[1])}`).join("");
  return `${up}${down}Z`;
}

/** Index nearest to px among n items spaced evenly from x0 to x1 */
export function evenIndex(px: number, x0: number, x1: number, n: number): number {
  return Math.max(0, Math.min(n - 1, Math.round(((px - x0) / (x1 - x0 || 1)) * (n - 1))));
}

/** Index nearest to v in a sorted array */
export function nearestIndex(sorted: readonly number[], v: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  if (hi < 0) return -1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid;
    else hi = mid;
  }
  return Math.abs(sorted[lo] - v) <= Math.abs(sorted[hi] - v) ? lo : hi;
}

export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  if (!sorted.length) return NaN;
  const p = (sorted.length - 1) * q;
  const b = Math.floor(p);
  const r = p - b;
  return sorted[b + 1] !== undefined ? sorted[b] + r * (sorted[b + 1] - sorted[b]) : sorted[b];
}

export function argMax(xs: readonly number[]): number {
  let best = -1;
  let bv = -Infinity;
  xs.forEach((v, i) => {
    if (v > bv) {
      bv = v;
      best = i;
    }
  });
  return best;
}
export function argMin(xs: readonly number[]): number {
  let best = -1;
  let bv = Infinity;
  xs.forEach((v, i) => {
    if (v < bv) {
      bv = v;
      best = i;
    }
  });
  return best;
}

export interface LinearFit {
  /** How much y grows when x grows by 1 */
  slope: number;
  /** Coefficient of determination (0 to 1). The closer the points hug the line, the closer to 1; 0 when all x or all y are equal */
  r2: number;
  /** y on the line */
  at: (x: number) => number;
}

/**
 * Least-squares line. Shared by the trend line annotations of line, bar and candlestick charts and by the scatter plot trend line.
 * When all x are equal, it is a horizontal line with slope 0
 */
export function linearFit(pts: readonly { x: number; y: number }[]): LinearFit {
  const n = pts.length;
  const mx = pts.reduce((s, q) => s + q.x, 0) / n;
  const my = pts.reduce((s, q) => s + q.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const q of pts) {
    sxy += (q.x - mx) * (q.y - my);
    sxx += (q.x - mx) ** 2;
    syy += (q.y - my) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  return { slope, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0, at: (x) => my + slope * (x - mx) };
}
