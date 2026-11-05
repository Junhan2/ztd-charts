/**
 * 색, 글꼴, 모서리 토큰.
 * 라이트 테마는 흰 카드와 하늘 강조, 다크 테마는 먹색 카드와 라임 강조예요.
 * 랜딩 페이지도 이 두 테마를 그대로 써서 랜딩, 문서, CLI와 MCP 렌더, 사용자 코드가 같은 색으로 보여요.
 * 모서리는 랜딩의 겹친 모서리(28/18/14)를 따라 카드 18px, 코드 블록 14px이에요.
 */
export interface ChartTheme {
  name: string;
  /** 페이지 바탕 */
  bg: string;
  /** 카드 바탕 */
  panel: string;
  /** 본문 글자, 두 번째로 강조하는 도형 */
  ink: string;
  /** 보조 글자. 카드 바탕 위에서 WCAG AA(4.5:1)를 넘겨요 */
  muted: string;
  /** 글자가 아닌 흐린 표시(축, 보조선) */
  dim: string;
  /** 강조 한 가지 */
  accent: string;
  /** 글자로 쓰는 강조색. 카드 바탕 위에서 AA를 넘겨요 */
  accentText: string;
  /** 강조색 위 글자 */
  onAccent: string;
  /** ink 색 도형 위 글자 */
  onInk: string;
  /** 테두리, 눈금선 */
  line: string;
  /** 보조 선, 트랙 */
  line2: string;
  /** 나머지 항목의 기본 채움 */
  neutral: string;
  /** neutral보다 진한 채움 */
  neutralStrong: string;
  /** neutralStrong 위 글자 */
  onNeutralStrong: string;
  /** neutral보다 옅은 채움, 트랙 */
  neutralSoft: string;
  /** 호버, 포커스된 바탕 */
  lift: string;
  /** 강조색 옅은 바탕 (중급 배지) */
  tint: string;
  fontFamily: string;
  monoFamily: string;
  /** 카드, 버튼 모서리(px) */
  radius: number;
  /** 코드 블록 모서리(px) */
  radiusCode: number;
  /** 작은 도형(칸, 막대) 모서리(px) */
  radiusMark: number;
}

export type ColorToken = Exclude<keyof ChartTheme, "name" | "fontFamily" | "monoFamily" | "radius" | "radiusCode" | "radiusMark">;

export const COLOR_TOKENS: readonly ColorToken[] = [
  "bg",
  "panel",
  "ink",
  "muted",
  "dim",
  "accent",
  "accentText",
  "onAccent",
  "onInk",
  "line",
  "line2",
  "neutral",
  "neutralStrong",
  "onNeutralStrong",
  "neutralSoft",
  "lift",
  "tint",
];

export const DEFAULT_FONT = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, -apple-system, sans-serif';
export const DEFAULT_MONO = '"Roboto Mono", "Share Tech Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/** 기본 다크 테마: 먹색 카드와 라임 강조. 라임은 먹색 위 글자로도 충분히 밝아서 accentText도 같은 색이에요 */
export const darkTheme: ChartTheme = {
  name: "dark",
  bg: "#14171B",
  panel: "#14171B",
  ink: "#F1F3F5",
  muted: "#A3ABB5",
  dim: "#5B636D",
  accent: "#D6FD70",
  accentText: "#D6FD70",
  onAccent: "#14171B",
  onInk: "#14171B",
  line: "#2A2F36",
  line2: "#22272D",
  neutral: "#3A414A",
  neutralStrong: "#5F6772",
  onNeutralStrong: "#F1F3F5",
  neutralSoft: "#262B31",
  lift: "#1D2126",
  tint: "rgba(214, 253, 112, 0.14)",
  fontFamily: DEFAULT_FONT,
  monoFamily: DEFAULT_MONO,
  radius: 18,
  radiusCode: 14,
  radiusMark: 4,
};

/** 라이트 테마: 흰 카드와 하늘 강조. 하늘색(#38C6F6)을 진하게 해서 흰 바탕 위 도형 3:1을 넘기고, 글자에는 더 진한 accentText를 써요 */
export const lightTheme: ChartTheme = {
  name: "light",
  bg: "#FFFFFF",
  panel: "#FFFFFF",
  ink: "#14171B",
  muted: "#5D6570",
  dim: "#B3B9C2",
  accent: "#0B8FD8",
  accentText: "#006DA8",
  onAccent: "#14171B",
  onInk: "#FFFFFF",
  line: "#E6E9ED",
  line2: "#F0F2F5",
  neutral: "#D5DAE0",
  neutralStrong: "#9AA3AE",
  onNeutralStrong: "#14171B",
  neutralSoft: "#EEF1F4",
  lift: "#F4F6F8",
  tint: "rgba(11, 143, 216, 0.12)",
  fontFamily: DEFAULT_FONT,
  monoFamily: DEFAULT_MONO,
  radius: 18,
  radiusCode: 14,
  radiusMark: 4,
};

export const themes = { dark: darkTheme, light: lightTheme } as const;
export type ThemeName = keyof typeof themes;

/** 토큰 이름을 CSS 변수 이름으로: accentText -> --ztd-accent-text */
export function cssVarName(key: string): string {
  return `--ztd-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
}

/** 테마를 CSS 변수 객체로 */
export function themeToCssVars(theme: Partial<ChartTheme>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of COLOR_TOKENS) {
    const v = theme[k];
    if (typeof v === "string") out[cssVarName(k)] = v;
  }
  if (theme.fontFamily) out["--ztd-font"] = theme.fontFamily;
  if (theme.monoFamily) out["--ztd-mono"] = theme.monoFamily;
  if (theme.radius !== undefined) out["--ztd-radius"] = `${theme.radius}px`;
  if (theme.radiusCode !== undefined) out["--ztd-radius-code"] = `${theme.radiusCode}px`;
  if (theme.radiusMark !== undefined) out["--ztd-radius-mark"] = `${theme.radiusMark}px`;
  return out;
}

/** `:root { --ztd-...: ... }` 같은 CSS 문자열. `<`는 CSS 이스케이프(\3c)로 바꿔서 <style> 안에 넣어도 태그를 닫지 못해요 */
export function themeToCss(theme: ChartTheme, selector = ":root"): string {
  const vars = themeToCssVars(theme);
  return `${selector} {\n${Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n")}\n}`.replace(/</g, "\\3c ");
}

export function mergeTheme(base: ChartTheme, over?: Partial<ChartTheme> | null): ChartTheme {
  if (!over) return base;
  const out: ChartTheme = { ...base };
  for (const k of Object.keys(over) as (keyof ChartTheme)[]) {
    const v = over[k];
    if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}
