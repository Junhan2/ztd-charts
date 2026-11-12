import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { CardTitleContext } from "../core/cardTitle";
import { ensureBaseStyles } from "../core/css";
import { useIsoLayoutEffect } from "../core/env";
import { SyncContext } from "../core/sync";
import { langOf, type ChartLang } from "../core/i18n";
import { levelBadge } from "../spec/labels";
import type { ChartLevel } from "../spec/types";
import { legendFill } from "../core/palette";
import { useChartLocale, useChartTheme, type Painter } from "../theme/context";
import type { ChartTheme } from "../theme/tokens";
import { ReplayContext } from "./replay";

/** Card, legend and state text (the server render uses it too) */
const en = {
  legend: "Legend",
  replay: "Replay animation",
  replayTitle: "Replay",
  sample: "Sample data",
  loadError: "Couldn't load data",
  retry: "Try again",
  loading: "Loading",
  empty: "No data to show",
  source: "Source",
  /** The sentence a screen reader reads after a toggleable legend is pressed */
  shown: (visible: number, total: number) => `${visible} of ${total} series shown`,
};
export const CARD_TEXT: Record<ChartLang, typeof en> = {
  en,
  ko: {
    legend: "범례",
    replay: "애니메이션 다시 재생",
    replayTitle: "다시 재생",
    sample: "예시 데이터",
    loadError: "데이터를 불러오지 못했어요",
    retry: "다시 시도",
    loading: "불러오는 중",
    empty: "표시할 데이터가 없어요",
    source: "출처",
    shown: (visible, total) => `${total}개 중 ${visible}개 보임`,
  },
};

/** Card inset: 20px left and right padding plus a 1px border on each side (ChartCard style below). Subtracted when server HTML draws a chart for hydration at the card's content width. Change it together with padding or border */
export const CARD_INSET = 42;

/** Text hidden on screen that only screen readers read (same values as ChartFrame. Kept separate because moving it out of that file shifts the bundle size of other charts) */
const SR_ONLY: CSSProperties = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };

/** Card text for the locale */
const useCardText = (locale?: string) => CARD_TEXT[langOf(useChartLocale(locale))];

export interface LegendItem {
  label: string;
  /** A CSS color or a token name ("accent", "ink", "neutral", "neutralStrong", "dim" …) */
  color?: string;
  /** Default "square" */
  shape?: "square" | "line" | "dash" | "circle";
}

export interface LegendProps {
  items: LegendItem[];
  align?: "start" | "end";
  theme?: Partial<ChartTheme>;
  size?: number;
  locale?: string;
  /** Hidden series (item labels). Pass together with onToggle */
  hidden?: readonly string[];
  /**
   * When given, items become toggle buttons (aria-pressed, Space and Enter). The last remaining series cannot be turned off (aria-disabled), and after a press the visible count is announced to screen readers.
   * Example: <Legend items={items} hidden={hidden} onToggle={(s) => setHidden((h) => (h.includes(s) ? h.filter((x) => x !== s) : [...h, s]))} /> with hidden={hidden} on the chart
   */
  onToggle?: (label: string) => void;
}

export function Legend(props: LegendProps) {
  const p = useChartTheme(props.theme);
  const text = useCardText(props.locale);
  // Announce the visible count only after the first press. Left empty on first render so it matches the server render
  const [touched, setTouched] = useState(false);
  const size = props.size ?? 11.5;
  const toggle = props.onToggle;
  // Hidden series apply only to a toggleable legend
  const off = new Set(toggle ? props.hidden : undefined);
  const shown = props.items.filter((it) => !off.has(it.label)).length;
  const list = (
    <ul
      aria-label={text.legend}
      style={{ display: "flex", flexWrap: "wrap", justifyContent: props.align === "start" ? "flex-start" : "flex-end", gap: "4px 12px", margin: 0, padding: 0, listStyle: "none" }}
    >
      {props.items.map((it, i) => {
        const on = !off.has(it.label);
        const last = on && shown === 1;
        const body = (
          <>
            <LegendSwatch p={p} item={it} off={!on} />
            <span style={on ? undefined : { textDecoration: "line-through" }}>{it.label}</span>
          </>
        );
        return (
          <li key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: size, color: p.paint("muted"), lineHeight: 1.3 }}>
            {toggle ? (
              // The name is the same in every state; aria-pressed conveys the state. Hidden items are struck through with a faded swatch (not conveyed by color alone). Hit area of 24px or more
              <button
                type="button"
                className="ztd-btn"
                aria-pressed={on}
                aria-disabled={last || undefined}
                onClick={() => {
                  if (last) return;
                  toggle(it.label);
                  setTouched(true);
                }}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 24, minWidth: 24, padding: "0 2px", margin: 0, border: 0, borderRadius: 4, background: "transparent", color: "inherit", fontSize: "inherit", lineHeight: "inherit", cursor: last ? "default" : undefined }}
              >
                {body}
              </button>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
  if (!toggle) return list;
  return (
    <>
      {list}
      <span aria-live="polite" aria-atomic="true" style={SR_ONLY}>
        {touched ? text.shown(shown, props.items.length) : ""}
      </span>
    </>
  );
}

function LegendSwatch({ p, item, off }: { p: Painter; item: LegendItem; off?: boolean }) {
  // Tokens become theme colors, mixed colors ("mix:ratio") the same mix as the chart marks, anything else as is
  const color = legendFill(p, item.color);
  const shape = item.shape ?? "square";
  if (shape === "line" || shape === "dash")
    return (
      <svg width={14} height={8} aria-hidden="true" style={{ flex: "none", opacity: off ? 0.35 : undefined }}>
        <line x1={1} x2={13} y1={4} y2={4} stroke={color} strokeWidth={2} strokeDasharray={shape === "dash" ? "3 2" : undefined} strokeLinecap="round" />
        {shape === "line" ? <circle cx={7} cy={4} r={2.2} fill={color} /> : null}
      </svg>
    );
  return (
    <span
      aria-hidden="true"
      style={{
        width: 9,
        height: 9,
        flex: "none",
        borderRadius: shape === "circle" ? 9 : 2.5,
        background: color,
        boxShadow: item.color === "neutral" || item.color === "neutralSoft" || !item.color ? `inset 0 0 0 1px ${p.paint("line2")}` : undefined,
        opacity: off ? 0.35 : undefined,
      }}
    />
  );
}

/** Level id. The badge text follows the locale (Basic, 기본 …). The old Korean values "기본" | "중급" | "심화" are accepted too */
export type Level = ChartLevel;

/** Level badge. An unknown value is shown as its own text in the default style */
export function Badge(props: { level: Level | string; theme?: Partial<ChartTheme>; locale?: string }) {
  const p = useChartTheme(props.theme);
  const b = levelBadge(props.level, langOf(useChartLocale(props.locale)));
  return (
    <span style={{ background: p.paint(b.bg), color: p.paint(b.fg), borderRadius: 8, padding: "3px 9px", fontSize: 12.5, fontWeight: 700, lineHeight: "18px", whiteSpace: "nowrap", flex: "none" }}>{b.text}</span>
  );
}

export interface ChartCardProps {
  /** Number. Example: "01" */
  number?: string | number;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Legend to the right of the subtitle. An array or any node */
  legend?: LegendItem[] | ReactNode;
  /** Replay button. When true, replays the chart inside */
  replay?: boolean;
  /** Called when replay is pressed */
  onReplay?: () => void;
  replayLabel?: string;
  /** Right side of the title row */
  actions?: ReactNode;
  /** One-line summary below */
  takeaway?: ReactNode;
  /** Source line under the chart. Follows "Source: " (Korean "출처: ") */
  source?: ReactNode;
  /** Note on the source line (such as the as-of date). Joined after the source with " · " */
  note?: ReactNode;
  /** A word in the title to color with the accent color (its first occurrence in a text title). Use it instead of a legend */
  accent?: string;
  /** Level badge: "basic" | "intermediate" | "advanced" (the old "기본" | "중급" | "심화" work too). The text follows the locale */
  level?: Level | string;
  /** Sample data label. A string shows that text instead */
  sample?: boolean | string;
  /** Locale of the card text (replay button, badge, sample data). Follows ThemeProvider when omitted. The chart inside takes the chart's locale or ThemeProvider */
  locale?: string;
  className?: string;
  style?: CSSProperties;
  theme?: Partial<ChartTheme>;
  /** Card title tag. Default "h3" */
  as?: "h2" | "h3" | "h4";
  id?: string;
  children?: ReactNode;
}

/** Colors the first accent word in a text title with color. Returns the title as is when there is no accent or the title is not text */
function accentTitle(title: ReactNode, accent: string | undefined, color: string): ReactNode {
  if (typeof title !== "string" || !accent) return title;
  const i = title.indexOf(accent);
  if (i < 0) return title;
  return (
    <>
      {title.slice(0, i)}
      <span style={{ color }}>{accent}</span>
      {title.slice(i + accent.length)}
    </>
  );
}

/** Chart card: number, title, subtitle, legend, source line, one-line summary, level badge */
export function ChartCard(props: ChartCardProps) {
  const p = useChartTheme(props.theme);
  const text = useCardText(props.locale);
  const [replayN, setReplayN] = useState(0);
  useIsoLayoutEffect(() => ensureBaseStyles(), []);
  const replay = () => {
    setReplayN((n) => n + 1);
    props.onReplay?.();
  };
  const legend = Array.isArray(props.legend) ? <Legend items={props.legend as LegendItem[]} theme={props.theme} locale={props.locale} /> : props.legend;
  const H = props.as ?? "h3";
  const num = props.number === undefined ? null : typeof props.number === "number" ? String(props.number).padStart(2, "0") : props.number;
  const showReplay = props.replay || props.onReplay;
  const sourceLine =
    props.source !== undefined || props.note !== undefined ? (
      <p style={{ margin: 0, fontSize: 12, color: p.paint("muted"), lineHeight: 1.4 }}>
        {props.source !== undefined ? `${text.source}: ` : null}
        {props.source}
        {props.source !== undefined && props.note !== undefined ? " · " : null}
        {props.note}
      </p>
    ) : null;
  const footer =
    props.takeaway !== undefined || props.level || props.sample ? (
      <footer style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 2 }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: p.paint("ink"), letterSpacing: -0.3, lineHeight: 1.3, minWidth: 0 }}>{props.takeaway}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flex: "none" }}>
          {props.sample ? <span style={{ fontSize: 11.5, color: p.paint("muted"), whiteSpace: "nowrap" }}>{typeof props.sample === "string" ? props.sample : text.sample}</span> : null}
          {props.level ? <Badge level={props.level} theme={props.theme} locale={props.locale} /> : null}
        </span>
      </footer>
    ) : null;
  return (
    <section
      id={props.id}
      className={`ztd-card${props.className ? ` ${props.className}` : ""}`}
      style={{
        background: p.paint("panel"),
        color: p.paint("ink"),
        border: `1px solid ${p.paint("line")}`,
        borderRadius: `var(--ztd-radius, ${p.theme.radius}px)`,
        padding: "20px 20px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minWidth: 0,
        boxSizing: "border-box",
        fontFamily: p.cssVars ? `var(--ztd-font, ${p.theme.fontFamily})` : p.theme.fontFamily,
        // Keeps Korean titles and summaries from breaking mid-word (even when the page sets nothing). On two lines, balances the line lengths so the last line is not left with a single word
        wordBreak: "keep-all",
        textWrap: "balance",
        ...props.style,
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {num ? (
            <span style={{ fontFamily: p.cssVars ? `var(--ztd-mono, ${p.theme.monoFamily})` : p.theme.monoFamily, fontSize: 17, fontWeight: 700, color: p.paint("accentText"), letterSpacing: -0.2, flex: "none" }}>{num}</span>
          ) : null}
          <H style={{ margin: 0, fontSize: 22, fontWeight: 800, color: p.paint("ink"), letterSpacing: -0.5, lineHeight: 1.25, minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{accentTitle(props.title, props.accent, p.paint("accentText"))}</H>
          {props.actions}
          {showReplay ? (
            <button
              type="button"
              className="ztd-btn"
              onClick={replay}
              aria-label={props.replayLabel ?? text.replay}
              title={props.replayLabel ?? text.replayTitle}
              style={{ background: "transparent", color: p.paint("muted"), border: `1px solid ${p.paint("line2")}`, borderRadius: 14, width: 28, height: 28, display: "inline-grid", placeItems: "center", padding: 0, flex: "none" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <path d="M3 3v6h6" />
              </svg>
            </button>
          ) : null}
        </div>
        {props.subtitle !== undefined || legend ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "4px 12px", flexWrap: "wrap", minHeight: 18 }}>
            {props.subtitle !== undefined ? <span style={{ fontSize: 12.5, color: p.paint("muted"), lineHeight: 1.4 }}>{props.subtitle}</span> : <span />}
            {legend}
          </div>
        ) : null}
      </header>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", minHeight: 0, minWidth: 0 }}>
        <ReplayContext.Provider value={replayN}>
          {/* A text title becomes the accessible name of the chart inside (screen readers read the title instead of "Bar chart") */}
          <CardTitleContext.Provider value={typeof props.title === "string" || typeof props.title === "number" ? String(props.title) : undefined}>{props.children}</CardTitleContext.Provider>
        </ReplayContext.Provider>
      </div>
      {/* The source line and the bottom row share one slot. One more slot would change the useId values of the chart inside, so the markup would differ from before */}
      {sourceLine ? (
        <>
          {sourceLine}
          {footer}
        </>
      ) : (
        footer
      )}
    </section>
  );
}

export interface ChartGridProps {
  /** Cells per row. Collapses to 1 cell on narrow screens. Default 2 */
  columns?: 1 | 2 | 3;
  /** Gap between cells (px). Default 16 */
  gap?: number;
  /** Minimum cell width (px). Narrower than this, the number of cells per row drops. Default 320 */
  minColumnWidth?: number;
  /** Charts inside show the hovered x together (compare the same date). A string links them under that name (also with charts in other grids). Default false */
  sync?: boolean | string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** A grid that keeps its cell count but reduces it when narrow. Works with CSS alone, no media queries */
export function ChartGrid(props: ChartGridProps) {
  const n = props.columns ?? 2;
  const gap = props.gap ?? 16;
  const min = props.minColumnWidth ?? 320;
  const track = n === 1 ? "minmax(0, 1fr)" : `repeat(auto-fill, minmax(min(100%, max(${min}px, calc((100% - ${(n - 1) * gap}px) / ${n} - 0.5px))), 1fr))`;
  const auto = useId();
  const sync = props.sync === true ? auto : props.sync || undefined;
  const grid = (
    <div className={props.className} style={{ display: "grid", gridTemplateColumns: track, gap, alignItems: "stretch", ...props.style }}>
      {props.children}
    </div>
  );
  return sync ? <SyncContext.Provider value={sync}>{grid}</SyncContext.Provider> : grid;
}

export interface ChartStateProps {
  loading?: boolean;
  error?: Error | string | null;
  empty?: boolean;
  onRetry?: () => void;
  height?: number;
  emptyText?: string;
  theme?: Partial<ChartTheme>;
  /** Locale of the state text. Follows ThemeProvider when omitted */
  locale?: string;
  children?: ReactNode;
}

/** Shows loading, error and empty-data states at the same height. children when all is well */
export function ChartState(props: ChartStateProps) {
  const p = useChartTheme(props.theme);
  const text = useCardText(props.locale);
  const h = props.height ?? 220;
  useIsoLayoutEffect(() => ensureBaseStyles(), []);
  if (props.error) {
    const msg = typeof props.error === "string" ? props.error : props.error.message;
    return (
      <div role="alert" style={{ height: h, display: "grid", placeItems: "center", textAlign: "center", border: `1px dashed ${p.paint("line2")}`, borderRadius: 10 }}>
        <div style={{ display: "grid", gap: 8, justifyItems: "center", padding: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: p.paint("ink") }}>{text.loadError}</span>
          <span style={{ fontSize: 12, color: p.paint("muted"), maxWidth: 280, wordBreak: "break-word" }}>{msg}</span>
          {props.onRetry ? (
            <button type="button" className="ztd-btn" onClick={props.onRetry} style={{ marginTop: 4, background: p.paint("ink"), color: p.paint("onInk"), border: "none", borderRadius: 14, padding: "5px 14px", fontSize: 12.5, fontWeight: 700 }}>
              {text.retry}
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  if (props.loading) {
    return (
      <div role="status" aria-busy="true" aria-label={text.loading} style={{ height: h, display: "flex", alignItems: "flex-end", gap: 8, padding: "12px 4px" }}>
        {[0.55, 0.8, 0.4, 0.95, 0.65, 0.75, 0.5].map((k, i) => (
          <span key={i} className="ztd-skeleton" style={{ flex: 1, height: `${k * 100}%`, background: p.paint("lift"), borderRadius: 6, animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    );
  }
  if (props.empty) {
    return (
      <div style={{ height: h, display: "grid", placeItems: "center", border: `1px dashed ${p.paint("line2")}`, borderRadius: 10 }}>
        <span style={{ fontSize: 13, color: p.paint("muted") }}>{props.emptyText ?? text.empty}</span>
      </div>
    );
  }
  return <>{props.children}</>;
}
