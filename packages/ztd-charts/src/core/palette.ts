import { composite, contrastRatio, mixHex, parseColor, pickText, toHex } from "../theme/color";

/** The actual color of top painted at opacity over under (sRGB alpha compositing, as browsers do) */
function compositeHex(top: string, under: string, opacity: number): string {
  const a = parseColor(top);
  const b = parseColor(under);
  if (!a || !b) return top;
  return toHex(composite([a[0], a[1], a[2], opacity], b));
}
import type { Painter } from "../theme/context";
import { cssVarName, lightTheme, type ColorToken } from "../theme/tokens";

export type Role = "accent" | "ink" | "strong" | "neutral" | "soft";

export interface Swatch {
  role: Role | "mix";
  fill: string;
  /** Text color on this fill */
  text: string;
  /** Actual color for calculations */
  raw: string;
}

export function swatch(p: Painter, role: Role): Swatch {
  const t = p.theme;
  switch (role) {
    case "accent":
      return { role, fill: p.paint("accent"), text: p.paint("onAccent"), raw: t.accent };
    case "ink":
      return { role, fill: p.paint("ink"), text: p.paint("onInk"), raw: t.ink };
    case "strong":
      return { role, fill: p.paint("neutralStrong"), text: p.paint("onNeutralStrong"), raw: t.neutralStrong };
    case "soft":
      return { role, fill: p.paint("neutralSoft"), text: p.paint("ink"), raw: t.neutralSoft };
    default:
      return { role: "neutral", fill: p.paint("neutral"), text: p.paint("ink"), raw: t.neutral };
  }
}

/**
 * Text color on a mixed background. At some mid brightness levels (luminance about 0.13 to 0.19) neither theme text color reaches 4.5:1,
 * so white and black join the candidates. On any background, either white or black reaches at least 4.58:1.
 */
export function readableOn(p: Painter, raw: string): string {
  const best = pickText(raw, [p.theme.ink, p.theme.onAccent, p.theme.onNeutralStrong]);
  if (contrastRatio(best, raw) >= 4.5) return best === p.theme.ink ? p.paint("ink") : best === p.theme.onAccent ? p.paint("onAccent") : p.paint("onNeutralStrong");
  return pickText(raw, ["#FFFFFF", "#000000"]);
}

/** Theme token swatch() uses for each role. Used where a CSS variable name is needed, such as canvas. Change it together with swatch */
const ROLE_TOKEN: Record<Role, ColorToken> = { accent: "accent", ink: "ink", strong: "neutralStrong", neutral: "neutral", soft: "neutralSoft" };

/** The actual color to paint on canvas. For a theme token, the value of its CSS variable (the calculation color when absent); for a mixed color, the calculation color */
export function canvasColor(sw: Swatch, read: (cssVar: string, fallback: string) => string): string {
  return sw.role === "mix" ? sw.raw : read(cssVarName(ROLE_TOKEN[sw.role]), sw.raw);
}

/** A color mixed between neutralStrong and neutral */
export function midSwatch(p: Painter, k: number): Swatch {
  const raw = mixHex(p.theme.neutralStrong, p.theme.neutral, k);
  return { role: "mix", fill: p.mix("neutralStrong", "neutral", k), text: readableOn(p, raw), raw };
}

/**
 * For when each item needs its own color (pie, donut, stacked bars).
 * Highlighted items get accent; the rest go in order ink → strong → … → neutral
 */
export function categorical(p: Painter, n: number, hi: ReadonlySet<number>): Swatch[] {
  const out: Swatch[] = new Array(n);
  const rest: number[] = [];
  for (let i = 0; i < n; i++) {
    if (hi.has(i)) out[i] = swatch(p, "accent");
    else rest.push(i);
  }
  const k = rest.length;
  rest.forEach((idx, j) => {
    if (k === 1) out[idx] = swatch(p, "neutral");
    else if (j === 0) out[idx] = swatch(p, "ink");
    else if (j === k - 1) out[idx] = swatch(p, "neutral");
    else if (k === 3) out[idx] = swatch(p, "strong");
    else {
      const t = (j - 1) / Math.max(1, k - 2);
      out[idx] = t <= 0.001 ? swatch(p, "strong") : midSwatch(p, 1 - t);
    }
  });
  return out;
}

/** A mixed color (midSwatch) as legend color text: "mix:0.5". legendFill turns it into a paint color */
const MIX_PREFIX = "mix:";

/**
 * Legend color text taken straight from the color function the chart draws with (token names; "mix:ratio" for mixed colors). Every card legend (autoLegend) uses this.
 * A painter that returns token names and mix ratios instead of paint colors is passed to the chart's color function (categorical, ramp, emphasis …), so the legend and the drawing come from the same rule
 */
export function legendColors(draw: (p: Painter) => Swatch[]): string[] {
  const names: Painter = { theme: lightTheme, cssVars: false, paint: (t) => t, color: (c) => c ?? "neutral", raw: (c) => c ?? "neutral", mix: (_a, _b, t) => `${MIX_PREFIX}${t}` };
  return draw(names).map((sw) => sw.fill);
}

/** Turns legend color text into a paint color: "mix:ratio" gives the same mixed color as midSwatch, anything else goes to p.color (a token gives the theme color, other text is used as is, none gives neutral) */
export function legendFill(p: Painter, c: string | undefined): string {
  return c?.startsWith(MIX_PREFIX) ? p.mix("neutralStrong", "neutral", Number(c.slice(MIX_PREFIX.length))) : p.color(c);
}

/**
 * categorical for points (scatter series). The faintest neutral step has only 1.3 to 1.4:1 contrast with the card background on a 4px-radius point, so it is nearly invisible;
 * the steps are set as if there were one more and the last one is dropped. With two series, the non-highlighted series uses ink instead of neutral
 */
export function categoricalDots(p: Painter, n: number, hi: ReadonlySet<number>): Swatch[] {
  return categorical(p, n + 1, hi).slice(0, n);
}

/** accent for the highlight only, neutral for everything else (the default design language) */
export function emphasis(p: Painter, n: number, hi: ReadonlySet<number>, rest: Role = "neutral"): Swatch[] {
  const a = swatch(p, "accent");
  const r = swatch(p, rest);
  return Array.from({ length: n }, (_, i) => (hi.has(i) ? a : r));
}

/**
 * For large areas (stacked area, stream): accent for the highlight, steps from neutralStrong to neutral for the rest.
 * Keeps bright areas such as ink from covering the screen.
 */
export function ramp(p: Painter, n: number, hi: ReadonlySet<number>): Swatch[] {
  const out: Swatch[] = new Array(n);
  const rest: number[] = [];
  for (let i = 0; i < n; i++) {
    if (hi.has(i)) out[i] = swatch(p, "accent");
    else rest.push(i);
  }
  const k = rest.length;
  rest.forEach((idx, j) => {
    if (k === 1) out[idx] = swatch(p, "neutral");
    else if (j === 0) out[idx] = swatch(p, "strong");
    else if (j === k - 1) out[idx] = swatch(p, "neutral");
    else out[idx] = midSwatch(p, 1 - j / (k - 1));
  });
  return out;
}

/** A 0 to 1 value as the intensity of the accent color (token), for heatmaps */
export function sequential(p: Painter, t: number, min = 0.1, token: "accent" | "neutralStrong" = "accent"): { fill: string; opacity: number; text: string; raw: string } {
  const k = Math.max(0, Math.min(1, t));
  const opacity = min + (1 - min) * k;
  const raw = compositeHex(p.theme[token], p.theme.panel, opacity);
  return { fill: p.paint(token), opacity, text: readableOn(p, raw), raw };
}

/** Color scale options: reverse flips it, center is the midpoint value (gray below it), steps is the number of steps (2 to 12) */
export interface ColorScaleOptions {
  reverse?: boolean;
  center?: number;
  steps?: number;
}

/**
 * Position adjusted by the color scale options. t is 0 to 1, or -1 to 1 with a center value.
 * Reversed, it is 1-t (-t with a center value); with steps, it is grouped into that many (with a center value and an odd step count, the middle step is 0, the faintest).
 * Below 0 leans to gray (neutralStrong), above 0 to the accent color, and the intensity is the absolute value
 */
export function scaleT(t: number, o: ColorScaleOptions): number {
  let k = o.reverse ? (o.center === undefined ? 1 - t : -t) : t;
  if (o.steps) {
    const lo = o.center === undefined ? 0 : -1;
    const i = Math.max(0, Math.min(o.steps - 1, Math.floor(((k - lo) / (1 - lo)) * o.steps)));
    k = lo + ((1 - lo) * i) / (o.steps - 1);
  }
  return k;
}

/** Cell color adjusted by the color scale options (gray or accent by the sign of scaleT, intensity by its absolute value) */
export function scaleSwatch(p: Painter, t: number, min: number, o: ColorScaleOptions): ReturnType<typeof sequential> {
  const k = scaleT(t, o);
  return sequential(p, Math.abs(k), min, k < 0 ? "neutralStrong" : "accent");
}

/** Bundles the color scale options (steps 2 to 12). With nothing set, scaleT returns t unchanged and scaleSwatch equals sequential */
export function colorScaleOf(reverse: boolean | undefined, center: number | undefined, steps: number | undefined): ColorScaleOptions {
  return { reverse, center, steps: steps === undefined ? undefined : Math.max(2, Math.min(12, Math.round(steps))) };
}
