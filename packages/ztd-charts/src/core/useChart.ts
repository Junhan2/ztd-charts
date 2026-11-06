import { useCallback, useMemo, useRef, useState } from "react";
import { useChartLocale, useChartTheme, type Painter } from "../theme/context";
import { dataSignature } from "../data/parse";
import { formatPercent, makeFormatter, type FormatName, type ValueFormatter } from "./format";
import { en, ko, langOf, type ChartLang, type ChartMessages } from "./i18n";
import { useHydrated, useMeasuredNode, useReducedMotion, useViewport } from "./hooks";
import type { UseMotionOptions } from "./useMotion";
import type { BaseChartProps, ChartEvent } from "./types";
import { isBrowser } from "./env";
import { useReplayKey } from "../components/replay";

export interface ChartSetupDefaults {
  height: number | ((width: number) => number);
  duration?: number;
  stagger?: number;
  format?: FormatName;
  /** SSR이나 측정 전 폭 */
  ssrWidth?: number;
}

export type ActiveVia = "pointer" | "keyboard" | "touch";

export interface ChartCtx<T> {
  p: Painter;
  width: number;
  height: number;
  measured: boolean;
  /** 폭을 컨테이너에서 재요 (width prop 없음) */
  responsive: boolean;
  /**
   * 브라우저 첫 마운트에서 폭을 재기 전 렌더. 화면에 그려지지 않고 곧바로 잰 폭으로 다시 그려요.
   * 무거운 배치는 이때 건너뛰어요
   */
  pending: boolean;
  node: HTMLDivElement | null;
  /** 서버 HTML을 하이드레이트한 뒤(또는 브라우저에서 바로 그릴 때) true. 캔버스 전환은 이걸 보고 해야 서버와 첫 렌더가 같아요 */
  hydrated: boolean;
  ref: (el: HTMLDivElement | null) => void;
  motion: UseMotionOptions;
  /** 값 + 단위 */
  fv: ValueFormatter;
  /** 값만 */
  fmt: ValueFormatter;
  /** 0~100 값을 "42%"로 (로캘 맞춤) */
  pct: ValueFormatter;
  /** 프롭, ThemeProvider, 기본값 순서로 정한 로캘 */
  locale: string;
  /** 차트 글자 언어 */
  lang: ChartLang;
  /** 여러 차트가 함께 쓰는 문구 */
  t: ChartMessages;
  active: number | null;
  via: ActiveVia | null;
  setActive: (i: number | null, via?: ActiveVia) => void;
  click: (i: number) => void;
  events: { current: ChartEvent<T>[] };
  showTooltip: boolean;
  showLabels: boolean;
  /** 호버 중인 다른 항목을 흐리게: i가 active가 아니면 낮은 불투명도 */
  dim: (i: number, base?: number) => number;
  sig: string;
  /** 사용자가 준 설명. 없으면 데이터가 없을 때 ChartFrame이 "No data."로 바꿔요 */
  description?: string;
}

/** 모든 차트가 처음에 부르는 설정 훅 */
// highlight는 차트마다 받는 꼴이 달라서(행, 이름, 노드) 여기서는 읽지 않아요
export function useChart<T>(props: Omit<BaseChartProps<T>, "highlight">, defaults: ChartSetupDefaults): ChartCtx<T> {
  const p = useChartTheme(props.theme);
  const [node, ref, measuredW] = useMeasuredNode<HTMLDivElement>(props.width);
  const hydrated = useHydrated();
  const width = props.width ?? (measuredW || defaults.ssrWidth || 480);
  const h = typeof defaults.height === "function" ? defaults.height(width) : defaults.height;
  const height = props.height ?? h;
  const reduced = useReducedMotion(props.reducedMotion ?? "auto");
  const enabled = props.animate !== false && !reduced && isBrowser;
  const view = useViewport(node, props.animateOnView !== false && enabled);
  const locale = useChartLocale(props.locale);
  const lang = langOf(locale);
  const fmt = useMemo(() => makeFormatter(props.format, locale, defaults.format), [props.format, locale, defaults.format]);
  const pct = useCallback((v: number) => formatPercent(v, { locale }), [locale]);
  const unit = props.unit ?? "";
  // 값이 없으면 "-"만 보여요. 단위를 붙이면 "-원"처럼 읽혀요
  const fv = useCallback((v: number) => (Number.isFinite(v) ? `${fmt(v)}${unit}` : fmt(v)), [fmt, unit]);
  const sig = useMemo(() => dataSignature(props.data), [props.data]);
  const [active, setActiveState] = useState<number | null>(null);
  const [via, setVia] = useState<ActiveVia | null>(null);
  const events = useRef<ChartEvent<T>[]>([]);
  const onHover = useRef(props.onHover);
  onHover.current = props.onHover;
  const onClick = useRef(props.onClick);
  onClick.current = props.onClick;

  // 지난 값은 ref로 비교해요. setState 갱신 함수 안에서 부르면 StrictMode가 두 번 돌려 onHover도 두 번 불려요
  const last = useRef<number | null>(null);
  const setActive = useCallback((i: number | null, how: ActiveVia = "pointer") => {
    if (last.current !== i) {
      last.current = i;
      const e = i === null ? null : events.current[i] ?? null;
      queueMicrotask(() => onHover.current?.(e));
    }
    setActiveState(i);
    setVia(i === null ? null : how);
  }, []);

  const click = useCallback((i: number) => {
    const e = events.current[i];
    if (e) onClick.current?.(e);
  }, []);

  const replayKey = useReplayKey(props.replayKey);
  const measured = props.width !== undefined || (measuredW ?? 0) > 0;
  const motion: UseMotionOptions = {
    enabled,
    active: view.visible && measured,
    near: view.near,
    replayKey,
    dataKey: sig,
    easing: props.easing ?? "spring",
    duration: props.duration ?? defaults.duration ?? 900,
    stagger: props.stagger ?? defaults.stagger ?? 0,
  };

  const dim = useCallback((i: number, base = 1) => (active === null || active === i ? base : base * 0.38), [active]);

  return {
    p,
    width,
    height,
    measured,
    responsive: props.width === undefined,
    pending: isBrowser && hydrated && props.width === undefined && measuredW === null,
    node,
    hydrated,
    ref,
    motion,
    fv,
    fmt,
    pct,
    locale,
    lang,
    t: lang === "ko" ? ko : en,
    active,
    via,
    setActive,
    click,
    events,
    showTooltip: props.tooltip !== false,
    showLabels: props.showLabels !== false,
    dim,
    sig,
    description: props.description,
  };
}
