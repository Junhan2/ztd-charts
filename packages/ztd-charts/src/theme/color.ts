export type RGBA = [number, number, number, number];

const NAMED: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
  transparent: "#00000000",
};

/** #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), var(--x, #hex) 를 RGBA로. 못 읽으면 null */
export function parseColor(input: string | undefined | null): RGBA | null {
  if (!input) return null;
  let s = input.trim();
  const v = /^var\(\s*--[\w-]+\s*,\s*(.+)\)$/i.exec(s);
  if (v) s = v[1].trim();
  if (NAMED[s.toLowerCase()]) s = NAMED[s.toLowerCase()];
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    // parseInt는 "12345g"를 "12345"까지 읽어서 16진수 글자만인지 먼저 봐요
    if ((h.length !== 6 && h.length !== 8) || /[^\da-f]/i.test(h)) return null;
    const n = parseInt(h, 16);
    if (h.length === 6) return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16) / 255];
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = parts.slice(0, 3).map((p) => (p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
    const a = parts[3] !== undefined ? (parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
    if (ch.some((c) => Number.isNaN(c))) return null;
    return [ch[0], ch[1], ch[2], Number.isNaN(a) ? 1 : a];
  }
  return null;
}

export function toHex(c: RGBA): string {
  const h = (x: number) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0");
  return `#${h(c[0])}${h(c[1])}${h(c[2])}${c[3] < 1 ? h(c[3] * 255) : ""}`.toUpperCase();
}

/** 반투명 색을 바탕색 위에 얹은 결과 */
export function composite(top: RGBA, under: RGBA): RGBA {
  const a = top[3];
  return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 상대 휘도 */
export function luminance(c: RGBA): number {
  return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
}

/** WCAG 대비. 두 색 중 하나라도 못 읽으면 0 */
export function contrastRatio(a: string | RGBA, b: string | RGBA, backdrop?: string | RGBA): number {
  const pa = typeof a === "string" ? parseColor(a) : a;
  let pb = typeof b === "string" ? parseColor(b) : b;
  if (!pa || !pb) return 0;
  const bd = backdrop ? (typeof backdrop === "string" ? parseColor(backdrop) : backdrop) : null;
  if (pb[3] < 1 && bd) pb = composite(pb, bd);
  const fa = pa[3] < 1 ? composite(pa, pb) : pa;
  const l1 = luminance(fa);
  const l2 = luminance(pb);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function toLinear(c: RGBA): [number, number, number] {
  return [channel(c[0]), channel(c[1]), channel(c[2])];
}
function fromLinear(x: number): number {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, v * 255));
}

function rgbToOklab(c: RGBA): [number, number, number] {
  const [r, g, b] = toLinear(c);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function oklabToRgb([L, A, B]: [number, number, number], alpha: number): RGBA {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    alpha,
  ];
}

/** a를 t만큼, b를 1-t만큼 섞어요 (oklab). CSS color-mix(in oklab, a t%, b)와 같은 결과 */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return a;
  const la = rgbToOklab(pa);
  const lb = rgbToOklab(pb);
  const k = Math.max(0, Math.min(1, t));
  return toHex(oklabToRgb([la[0] * k + lb[0] * (1 - k), la[1] * k + lb[1] * (1 - k), la[2] * k + lb[2] * (1 - k)], pa[3] * k + pb[3] * (1 - k)));
}

/** 두 후보 중 바탕과 대비가 더 큰 글자색 */
export function pickText(background: string, candidates: string[], backdrop?: string): string {
  let best = candidates[0];
  let bestC = -1;
  for (const c of candidates) {
    const r = contrastRatio(c, background, backdrop);
    if (r > bestC) {
      bestC = r;
      best = c;
    }
  }
  return best;
}
