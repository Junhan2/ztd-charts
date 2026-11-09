import { composite, contrastRatio, mixHex, parseColor, pickText, toHex } from "../theme/color";

/** 불투명도 opacity로 칠한 top을 under 위에 얹은 실제 색 (sRGB 알파 합성, 브라우저와 같아요) */
function compositeHex(top: string, under: string, opacity: number): string {
  const a = parseColor(top);
  const b = parseColor(under);
  if (!a || !b) return top;
  return toHex(composite([a[0], a[1], a[2], opacity], b));
}
import type { Painter } from "../theme/context";
import { cssVarName, type ColorToken } from "../theme/tokens";

export type Role = "accent" | "ink" | "strong" | "neutral" | "soft";

export interface Swatch {
  role: Role | "mix";
  fill: string;
  /** 이 채움 위 글자색 */
  text: string;
  /** 계산용 실제 색 */
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
 * 섞은 바탕 위 글자색. 테마 글자색 두 개로 4.5:1이 안 나오는 중간 밝기(휘도 약 0.13~0.19)가 있어서
 * 흰색과 검은색까지 후보에 넣어요. 흰색, 검은색 중 하나는 어떤 바탕에서도 4.58:1 이상이에요.
 */
export function readableOn(p: Painter, raw: string): string {
  const best = pickText(raw, [p.theme.ink, p.theme.onAccent, p.theme.onNeutralStrong]);
  if (contrastRatio(best, raw) >= 4.5) return best === p.theme.ink ? p.paint("ink") : best === p.theme.onAccent ? p.paint("onAccent") : p.paint("onNeutralStrong");
  return pickText(raw, ["#FFFFFF", "#000000"]);
}

/** swatch()가 역할마다 쓰는 테마 토큰. 캔버스처럼 CSS 변수 이름이 필요한 곳이 써요. swatch를 바꾸면 같이 바꿔요 */
const ROLE_TOKEN: Record<Role, ColorToken> = { accent: "accent", ink: "ink", strong: "neutralStrong", neutral: "neutral", soft: "neutralSoft" };

/** 캔버스에 칠할 실제 색. 테마 토큰이면 그 CSS 변수 값을 읽고(없으면 계산용 색), 섞은 색이면 계산용 색이에요 */
export function canvasColor(sw: Swatch, read: (cssVar: string, fallback: string) => string): string {
  return sw.role === "mix" ? sw.raw : read(cssVarName(ROLE_TOKEN[sw.role]), sw.raw);
}

/** neutralStrong과 neutral 사이를 섞은 색 */
export function midSwatch(p: Painter, k: number): Swatch {
  const raw = mixHex(p.theme.neutralStrong, p.theme.neutral, k);
  return { role: "mix", fill: p.mix("neutralStrong", "neutral", k), text: readableOn(p, raw), raw };
}

/**
 * 항목마다 다른 색이 필요할 때 (파이, 도넛, 쌓은 막대).
 * 강조 항목은 accent, 나머지는 순서대로 ink → strong → … → neutral
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

/** categorical과 같은 순서의 토큰 이름 (범례용) */
export function categoricalTokens(n: number, hi: ReadonlySet<number>): string[] {
  const out: string[] = new Array(n);
  const rest: number[] = [];
  for (let i = 0; i < n; i++) {
    if (hi.has(i)) out[i] = "accent";
    else rest.push(i);
  }
  const k = rest.length;
  rest.forEach((idx, j) => {
    if (k === 1) out[idx] = "neutral";
    else if (j === 0) out[idx] = "ink";
    else if (j === k - 1) out[idx] = "neutral";
    else out[idx] = "neutralStrong";
  });
  return out;
}

/**
 * 점(산점도 계열)용 categorical. 가장 옅은 neutral 단계는 반지름 4px 점에서 카드 바탕과 대비가 1.3~1.4:1이라 거의 안 보여서,
 * 한 칸 더 있는 것처럼 정하고 마지막 칸을 버려요. 계열이 둘이면 강조 아닌 계열이 neutral 대신 ink예요
 */
export function categoricalDots(p: Painter, n: number, hi: ReadonlySet<number>): Swatch[] {
  return categorical(p, n + 1, hi).slice(0, n);
}

/** categoricalDots와 같은 순서의 토큰 이름 (범례용) */
export function categoricalDotTokens(n: number, hi: ReadonlySet<number>): string[] {
  return categoricalTokens(n + 1, hi).slice(0, n);
}

/** 강조만 accent, 나머지는 모두 neutral (기본 디자인 언어) */
export function emphasis(p: Painter, n: number, hi: ReadonlySet<number>, rest: Role = "neutral"): Swatch[] {
  const a = swatch(p, "accent");
  const r = swatch(p, rest);
  return Array.from({ length: n }, (_, i) => (hi.has(i) ? a : r));
}

/**
 * 넓은 면(쌓은 영역, 스트림)용: 강조는 accent, 나머지는 neutralStrong에서 neutral까지 단계.
 * ink처럼 밝은 면이 화면을 덮지 않게 해요.
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

/** 0~1 값을 강조색 진하기로 (히트맵) */
export function sequential(p: Painter, t: number, min = 0.1): { fill: string; opacity: number; text: string; raw: string } {
  const k = Math.max(0, Math.min(1, t));
  const opacity = min + (1 - min) * k;
  const raw = compositeHex(p.theme.accent, p.theme.panel, opacity);
  return { fill: p.paint("accent"), opacity, text: readableOn(p, raw), raw };
}
