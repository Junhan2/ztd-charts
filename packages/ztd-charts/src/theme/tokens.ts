/**
 * Color, font and corner radius tokens.
 * The light theme has white cards with a sky accent; the dark theme has ink-black cards with a lime accent.
 * The secondary accent accent2 is a pink in the same tone as the accent color, and accent3 is the other theme's accent color (lime in light, sky in dark).
 * The landing page uses these two themes as is, so the landing page, docs, CLI and MCP renders and user code all show the same colors.
 * Corners follow the landing page's nested radii (28/18/14): 18px for cards, 14px for code blocks.
 */
export interface ChartTheme {
  name: string;
  /** Page background */
  bg: string;
  /** Card background */
  panel: string;
  /** Body text, and shapes with secondary emphasis */
  ink: string;
  /** Secondary text. Passes WCAG AA (4.5:1) on the card background */
  muted: string;
  /** Faint non-text marks (axes, auxiliary lines) */
  dim: string;
  /** The single accent */
  accent: string;
  /** Accent color for text. Passes AA on the card background */
  accentText: string;
  /** Text on the accent color */
  onAccent: string;
  /** Secondary accent 1 (pink). For a small outcome placed beside the accent color (the first front-row series of the skyline). Shapes reach 3:1 on the card and neutralSoft */
  accent2: string;
  /** Secondary accent 2 (lime in light, sky in dark). The second front-row series of the skyline. Shapes reach 3:1 on the card and neutralSoft */
  accent3: string;
  /** Text on ink-colored shapes */
  onInk: string;
  /** Borders, gridlines */
  line: string;
  /** Auxiliary lines, tracks */
  line2: string;
  /** Default fill for the other items */
  neutral: string;
  /** A fill darker than neutral */
  neutralStrong: string;
  /** Text on neutralStrong */
  onNeutralStrong: string;
  /** A fill lighter than neutral, tracks */
  neutralSoft: string;
  /** Hovered or focused background */
  lift: string;
  /** Light accent background (intermediate badge) */
  tint: string;
  fontFamily: string;
  monoFamily: string;
  /** Card and button corner radius (px) */
  radius: number;
  /** Code block corner radius (px) */
  radiusCode: number;
  /** Corner radius of small shapes (cells, bars) (px) */
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
  "accent2",
  "accent3",
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

/** Default dark theme: ink-black cards with a lime accent. Lime is bright enough for text on ink black, so accentText is the same color */
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
  accent2: "#FF8CC1",
  accent3: "#38C6F6",
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

/** Light theme: white cards with a sky accent. The sky blue (#38C6F6) is deepened so shapes pass 3:1 on white, and text uses an even deeper accentText */
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
  accent2: "#D8488C",
  accent3: "#659815",
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

/** A token name as a CSS variable name: accentText -> --ztd-accent-text */
export function cssVarName(key: string): string {
  return `--ztd-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
}

/** A theme as a CSS variables object */
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

/** A CSS string such as `:root { --ztd-...: ... }`. `<` becomes a CSS escape (\3c), so it cannot close the tag even inside <style> */
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
