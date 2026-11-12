import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from "react";
import { DEFAULT_LOCALE } from "../core/format";
import { mixHex } from "./color";
import { cssVarName, darkTheme, mergeTheme, themes, themeToCssVars, type ChartTheme, type ColorToken, type ThemeName } from "./tokens";

export interface ThemeContextValue {
  theme: ChartTheme;
  /** false면 var() 없이 색 값을 그대로 써요. 서버에서 PNG로 바꿀 때 필요해요 */
  cssVars: boolean;
  /** 아래 차트, 카드의 로캘. 없으면 각 컴포넌트가 DEFAULT_LOCALE("en-US")을 써요 */
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
  /** "dark" | "light" 또는 토큰 객체. 바꿀 토큰만 넘겨도 돼요 */
  theme?: ThemeInput;
  /** 부모 테마 대신 이 테마에서 시작해요 */
  base?: ThemeName;
  /** false면 CSS 변수 없이 색 값을 그대로 그려요. 기본 true */
  cssVars?: boolean;
  /** 바탕색과 글자색까지 칠해요. 기본 false (display: contents) */
  paint?: boolean;
  /**
   * 아래 차트와 카드의 로캘. 숫자, 날짜 형식과 차트가 만드는 글자(툴팁, 스크린리더 문장, 버튼)의 언어를 정해요.
   * "ko"나 "ko-*"면 한국어, 그 밖은 영어. 차트의 locale 프롭이 더 우선이에요. 없으면 부모 ThemeProvider를 따르고, 기본 "en-US"
   */
  locale?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** 테마를 정하고 `--ztd-*` CSS 변수를 하위 요소에 내려줘요 */
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
  /** 토큰을 칠할 값으로. cssVars면 var(--ztd-x, 값) */
  paint: (token: ColorToken) => string;
  /** 토큰 또는 색 문자열. "accent" 같은 이름이면 토큰으로 봐요 */
  color: (c: string | undefined, fallback?: ColorToken) => string;
  /** 두 토큰을 섞은 색. cssVars면 color-mix */
  mix: (a: ColorToken, b: ColorToken, t: number) => string;
  /** 계산용 실제 색 값 (대비 계산 등) */
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

/** 현재 테마와 칠하기 도구. override는 이 컴포넌트만 바꿔요 */
export function useChartTheme(override?: Partial<ChartTheme>): Painter {
  const ctx = useContext(ThemeContext);
  return useMemo(() => {
    const theme = mergeTheme(ctx.theme, override);
    return makePainter(theme, ctx.cssVars);
  }, [ctx.theme, ctx.cssVars, override]);
}

/** 쓸 로캘: 컴포넌트의 locale 프롭(override), ThemeProvider의 locale, DEFAULT_LOCALE("en-US") 순서 */
export function useChartLocale(override?: string): string {
  const ctx = useContext(ThemeContext);
  return override ?? ctx.locale ?? DEFAULT_LOCALE;
}

/** 컴포넌트의 theme 프롭을 CSS 변수로 (해당 요소 아래에서만 적용) */
export function overrideVars(override?: Partial<ChartTheme>): Record<string, string> {
  if (!override) return {};
  return themeToCssVars(override);
}

export { cssVarName };
