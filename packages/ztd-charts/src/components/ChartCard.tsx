import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { CardTitleContext } from "../core/cardTitle";
import { ensureBaseStyles } from "../core/css";
import { useIsoLayoutEffect } from "../core/env";
import { SyncContext } from "../core/sync";
import { langOf, type ChartLang } from "../core/i18n";
import { levelBadge } from "../spec/labels";
import type { ChartLevel } from "../spec/types";
import { useChartLocale, useChartTheme, isColorToken, type Painter } from "../theme/context";
import type { ChartTheme } from "../theme/tokens";
import { ReplayContext } from "./replay";

/** 카드, 범례, 상태 문구 (서버 렌더도 써요) */
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
  /** 켜고 끄는 범례를 누른 뒤 화면 낭독기가 읽는 문장 */
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

/** 카드 안쪽 여백: 좌우 padding 20px과 테두리 1px씩(아래 ChartCard 스타일). 서버 HTML이 이어받는 차트를 카드 안 내용 폭으로 그릴 때 빼요. padding이나 border를 바꾸면 같이 바꿔요 */
export const CARD_INSET = 42;

/** 화면에는 안 보이고 화면 낭독기만 읽는 글 (ChartFrame과 같은 값. 그 파일에서 옮기면 다른 차트 묶음 크기가 흔들려서 따로 둬요) */
const SR_ONLY: CSSProperties = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };

/** 로캘에 맞는 카드 문구 */
const useCardText = (locale?: string) => CARD_TEXT[langOf(useChartLocale(locale))];

export interface LegendItem {
  label: string;
  /** CSS 색 또는 토큰 이름("accent", "ink", "neutral", "neutralStrong", "dim" …) */
  color?: string;
  /** 기본 "square" */
  shape?: "square" | "line" | "dash" | "circle";
}

export interface LegendProps {
  items: LegendItem[];
  align?: "start" | "end";
  theme?: Partial<ChartTheme>;
  size?: number;
  locale?: string;
  /** 숨긴 계열(항목 label). onToggle과 같이 줘요 */
  hidden?: readonly string[];
  /**
   * 주면 항목이 켜고 끄는 단추가 돼요(aria-pressed, Space와 Enter). 마지막 남은 계열은 끌 수 없고(aria-disabled), 누른 뒤 보이는 수를 화면 낭독기에 알려요.
   * 예: <Legend items={items} hidden={hidden} onToggle={(s) => setHidden((h) => (h.includes(s) ? h.filter((x) => x !== s) : [...h, s]))} /> 와 차트의 hidden={hidden}
   */
  onToggle?: (label: string) => void;
}

export function Legend(props: LegendProps) {
  const p = useChartTheme(props.theme);
  const text = useCardText(props.locale);
  // 한 번 누른 뒤부터 지금 보이는 수를 알려요. 처음 그릴 때는 비워 둬서 서버 그림과 같아요
  const [touched, setTouched] = useState(false);
  const size = props.size ?? 11.5;
  const toggle = props.onToggle;
  // 숨긴 계열은 켜고 끄는 범례에서만 봐요
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
              // 이름은 상태와 상관없이 같고 상태는 aria-pressed가 알려요. 숨긴 항목은 줄을 긋고 색 칸을 옅게 해요(색만으로 알리지 않아요). 누를 자리는 24px 이상
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
  const color = item.color ? (isColorToken(item.color) ? p.paint(item.color) : item.color) : p.paint("neutral");
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

/** 수준 id. 배지 글자는 로캘에 맞춰요 (Basic, 기본 …). 예전 한글 값 "기본" | "중급" | "심화"도 받아요 */
export type Level = ChartLevel;

/** 수준 배지. 모르는 값은 글자 그대로 기본 모양으로 */
export function Badge(props: { level: Level | string; theme?: Partial<ChartTheme>; locale?: string }) {
  const p = useChartTheme(props.theme);
  const b = levelBadge(props.level, langOf(useChartLocale(props.locale)));
  return (
    <span style={{ background: p.paint(b.bg), color: p.paint(b.fg), borderRadius: 8, padding: "3px 9px", fontSize: 12.5, fontWeight: 700, lineHeight: "18px", whiteSpace: "nowrap", flex: "none" }}>{b.text}</span>
  );
}

export interface ChartCardProps {
  /** 번호. 예: "01" */
  number?: string | number;
  title: ReactNode;
  subtitle?: ReactNode;
  /** 부제목 오른쪽 범례. 배열이나 아무 노드 */
  legend?: LegendItem[] | ReactNode;
  /** 다시 재생 버튼. true면 안쪽 차트를 다시 재생해요 */
  replay?: boolean;
  /** 다시 재생을 눌렀을 때 */
  onReplay?: () => void;
  replayLabel?: string;
  /** 제목 줄 오른쪽 */
  actions?: ReactNode;
  /** 아래 한 줄 요약 */
  takeaway?: ReactNode;
  /** 차트 아래 출처 줄. "Source: "(한국어 "출처: ") 뒤에 붙어요 */
  source?: ReactNode;
  /** 출처 줄의 메모(기준일 등). 출처 뒤에 " · "로 이어요 */
  note?: ReactNode;
  /** 강조색으로 칠할 제목 속 낱말(글자 제목에서 처음 나오는 곳). 범례 대신 써요 */
  accent?: string;
  /** 수준 배지: "basic" | "intermediate" | "advanced" (예전 "기본" | "중급" | "심화"도 돼요). 글자는 로캘에 맞춰요 */
  level?: Level | string;
  /** 예시 데이터 표시. 문자열이면 그 문구로 */
  sample?: boolean | string;
  /** 카드 글자(다시 재생 버튼, 배지, 예시 데이터)의 로캘. 없으면 ThemeProvider를 따라요. 안쪽 차트는 차트의 locale이나 ThemeProvider로 정해요 */
  locale?: string;
  className?: string;
  style?: CSSProperties;
  theme?: Partial<ChartTheme>;
  /** 카드 제목 태그. 기본 "h3" */
  as?: "h2" | "h3" | "h4";
  id?: string;
  children?: ReactNode;
}

/** 글자 제목 속 첫 accent 낱말을 color로. 없거나 글자 제목이 아니면 제목 그대로 */
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

/** 차트 카드: 번호, 제목, 부제, 범례, 출처 줄, 한 줄 요약, 수준 배지 */
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
        // 한국어 제목, 요약이 낱말 가운데서 줄을 바꾸지 않게 (페이지가 정하지 않아도). 두 줄이면 줄 길이를 고르게 해서 마지막 줄에 낱말 하나만 남지 않게
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
          {/* 글자 제목이면 안쪽 차트의 접근 가능한 이름이 돼요 (화면 낭독기가 "Bar chart" 대신 제목을 읽어요) */}
          <CardTitleContext.Provider value={typeof props.title === "string" || typeof props.title === "number" ? String(props.title) : undefined}>{props.children}</CardTitleContext.Provider>
        </ReplayContext.Provider>
      </div>
      {/* 출처 줄과 아랫줄은 한 자리에 둬요. 자리가 하나 늘면 안쪽 차트의 useId 값이 바뀌어 예전 마크업과 달라져요 */}
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
  /** 한 줄 칸 수. 좁은 화면에서는 1칸으로 접혀요. 기본 2 */
  columns?: 1 | 2 | 3;
  /** 칸 사이(px). 기본 16 */
  gap?: number;
  /** 한 칸의 최소 폭(px). 이보다 좁아지면 칸 수가 줄어요. 기본 320 */
  minColumnWidth?: number;
  /** 안의 차트들이 짚은 x를 함께 보여 줘요(같은 날짜 맞춰 보기). 문자열이면 그 이름으로 묶어요(다른 그리드의 차트와도). 기본 false */
  sync?: boolean | string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** 칸 수를 지키되 좁으면 줄어드는 그리드. 미디어 쿼리 없이 CSS만으로 동작해요 */
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
  /** 상태 글자의 로캘. 없으면 ThemeProvider를 따라요 */
  locale?: string;
  children?: ReactNode;
}

/** 로딩, 오류, 빈 데이터 상태를 같은 높이로 보여줘요. 정상이면 children */
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
