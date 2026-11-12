import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from "react";
import { DEFAULT_LOCALE } from "../core/format";
import { mixHex } from "./color";
import { cssVarName, darkTheme, mergeTheme, themes, themeToCssVars, type ChartTheme, type ColorToken, type ThemeName } from "./tokens";

export interface ThemeContextValue {
  theme: ChartTheme;
  /** When false, writes color values directly without var(). Needed for server-side PNG conversion */
  cssVars: boolean;
  /** Locale of the charts and cards below. When omitted, each component uses DEFAULT_LOCALE ("en-US") */
  locale?: string;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: darkTheme, cssVars: true });

export type ThemeInput = ThemeName | ChartTheme | Partial<ChartTheme>;

export function resolveThemeInput(input: ThemeInput | undefined, base: ChartTheme = darkTheme): ChartTheme {
  if (!input) return base;
  if (typeof input === "string") return themes[input] ?? base;
  return mergeTheme(base, input);
}

export interface ThemeProviderProps {
  /** "dark" | "light" or a token object. Passing only the tokens to change is enough */
  theme?: ThemeInput;
  /** Starts from this theme instead of the parent theme */
  base?: ThemeName;
  /** When false, draws color values directly without CSS variables. Default true */
  cssVars?: boolean;
  /** Also paints the background and text colors. Default false (display: contents) */
  paint?: boolean;
  /**
   * Locale of the charts and cards below. Sets the number and date formats and the language of text the charts generate (tooltips, screen reader sentences, buttons).
   * "ko" or "ko-*" gives Korean; anything else English. A chart's locale prop takes precedence. When omitted, follows the parent ThemeProvider; default "en-US"
   */
  locale?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Sets the theme and passes `--ztd-*` CSS variables down to descendants */
export function ThemeProvider(props: ThemeProviderProps) {
  const parent = useContext(ThemeContext);
  const start = props.base ? themes[props.base] : parent.theme;
  const theme = useMemo(() => resolveThemeInput(props.theme, start), [props.theme, start]);
  const cssVars = props.cssVars ?? parent.cssVars;
  const locale = props.locale ?? parent.locale;
  const value = useMemo(() => ({ theme, cssVars, locale }), [theme, cssVars, locale]);
  const vars = useMemo(() => themeToCssVars(theme), [theme]);
  const style: CSSProperties = props.paint
    ? { background: theme.bg, color: theme.ink, fontFamily: theme.fontFamily, ...vars, ...props.style }
    : { display: "contents", ...vars, ...props.style };
  return (
    <ThemeContext.Provider value={value}>
      <div className={props.className} data-ztd-theme={theme.name} lang={props.locale} style={style}>
        {props.children}
      </div>
    </ThemeContext.Provider>
  );
}

export interface Painter {
  theme: ChartTheme;
  cssVars: boolean;
  /** A token as a paintable value. With cssVars, var(--ztd-x, value) */
  paint: (token: ColorToken) => string;
  /** A token or a color string. A name such as "accent" is treated as a token */
  color: (c: string | undefined, fallback?: ColorToken) => string;
  /** A mix of two tokens. color-mix with cssVars */
  mix: (a: ColorToken, b: ColorToken, t: number) => string;
  /** The actual color value for calculations (contrast and so on) */
  raw: (c: string | undefined, fallback?: ColorToken) => string;
}

const TOKEN_SET = new Set<string>([
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
]);

export function isColorToken(c: string): c is ColorToken {
  return TOKEN_SET.has(c);
}

export function makePainter(theme: ChartTheme, cssVars: boolean): Painter {
  const paint = (token: ColorToken) => (cssVars ? `var(${cssVarName(token)}, ${theme[token]})` : theme[token]);
  return {
    theme,
    cssVars,
    paint,
    color: (c, fallback = "neutral") => {
      if (!c) return paint(fallback);
      return isColorToken(c) ? paint(c) : c;
    },
    raw: (c, fallback = "neutral") => {
      if (!c) return theme[fallback];
      return isColorToken(c) ? theme[c] : c;
    },
    mix: (a, b, t) => {
      const pct = Math.round(Math.max(0, Math.min(1, t)) * 1000) / 10;
      return cssVars ? `color-mix(in oklab, ${paint(a)} ${pct}%, ${paint(b)})` : mixHex(theme[a], theme[b], t);
    },
  };
}

export function useThemeContext(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** The current theme and painting helpers. override changes this component only */
export function useChartTheme(override?: Partial<ChartTheme>): Painter {
  const ctx = useContext(ThemeContext);
  return useMemo(() => {
    const theme = mergeTheme(ctx.theme, override);
    return makePainter(theme, ctx.cssVars);
  }, [ctx.theme, ctx.cssVars, override]);
}

/** The locale to use: the component's locale prop (override), then the ThemeProvider's locale, then DEFAULT_LOCALE ("en-US") */
export function useChartLocale(override?: string): string {
  const ctx = useContext(ThemeContext);
  return override ?? ctx.locale ?? DEFAULT_LOCALE;
}

/** A component's theme prop as CSS variables (applied only under that element) */
export function overrideVars(override?: Partial<ChartTheme>): Record<string, string> {
  if (!override) return {};
  return themeToCssVars(override);
}

export { cssVarName };
