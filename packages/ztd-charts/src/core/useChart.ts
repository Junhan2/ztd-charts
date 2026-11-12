import { useCallback, useMemo, useRef, useState } from "react";
import { useChartLocale, useChartTheme, type Painter } from "../theme/context";
import { dataSignature } from "../data/parse";
import { formatPercent, makeFormatter, withUnit, type FormatName, type ValueFormatter } from "./format";
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
  /** Width for SSR and before measurement */
  ssrWidth?: number;
}

/** "sync" is a position pointed at in another chart linked by the same syncId (the tooltip shows only on the chart being pointed at) */
export type ActiveVia = "pointer" | "keyboard" | "touch" | "sync";

export interface ChartCtx<T> {
  p: Painter;
  width: number;
  height: number;
  measured: boolean;
  /** The width is measured from the container (no width prop) */
  responsive: boolean;
  /**
   * The render before the width is measured on the first browser mount. It never reaches the screen and is redrawn right away with the measured width.
   * Heavy layout work is skipped during it
   */
  pending: boolean;
  node: HTMLDivElement | null;
  /** true after the server HTML is hydrated (or when drawing directly in the browser). Switch to canvas based on this so the first render matches the server */
  hydrated: boolean;
  ref: (el: HTMLDivElement | null) => void;
  motion: UseMotionOptions;
  /** Value plus unit */
  fv: ValueFormatter;
  /** Value only */
  fmt: ValueFormatter;
  /** Formats a 0 to 100 value as "42%" (locale-aware) */
  pct: ValueFormatter;
  /** Locale resolved from the prop, then ThemeProvider, then the default */
  locale: string;
  /** Language of chart text */
  lang: ChartLang;
  /** Text shared by several charts */
  t: ChartMessages;
  active: number | null;
  via: ActiveVia | null;
  setActive: (i: number | null, via?: ActiveVia) => void;
  click: (i: number) => void;
  events: { current: ChartEvent<T>[] };
  showTooltip: boolean;
  showLabels: boolean;
  /** Dims the other items during hover: a low opacity when i is not active */
  dim: (i: number, base?: number) => number;
  sig: string;
  /** The description the user gave. When it is absent and there is no data, ChartFrame uses "No data." */
  description?: string;
  /** Reduced motion is on. Hover transitions jump instead of gliding */
  reduced: boolean;
  /** Function that tells linked charts when the pointed position changes. Filled in by useSync (line, area, bar, candlestick) */
  publish: { current: ((i: number | null) => void) | null };
  /** Receives the position pointed at in another linked chart. Leaves things as they are while selecting with the keyboard */
  applySync: (i: number | null) => void;
}

/** Setup hook every chart calls first */
// highlight takes a different form in each chart (rows, names, nodes), so it is not read here
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
  const fv = useMemo(() => withUnit(fmt, props.unit), [fmt, props.unit]);
  const sig = useMemo(() => dataSignature(props.data), [props.data]);
  const [active, setActiveState] = useState<number | null>(null);
  const [via, setVia] = useState<ActiveVia | null>(null);
  const events = useRef<ChartEvent<T>[]>([]);
  const onHover = useRef(props.onHover);
  onHover.current = props.onHover;
  const onClick = useRef(props.onClick);
  onClick.current = props.onClick;

  const viaRef = useRef<ActiveVia | null>(null);
  const publish = useRef<((i: number | null) => void) | null>(null);

  // The previous value is compared through a ref. Calling from inside a setState updater would make StrictMode run it twice and call onHover twice too
  const last = useRef<number | null>(null);
  const setActive = useCallback(
    (i: number | null, how: ActiveVia = "pointer") => {
      if (last.current !== i) {
        last.current = i;
        const e = i === null ? null : events.current[i] ?? null;
        queueMicrotask(() => onHover.current?.(e));
        publish.current?.(i);
      }
      viaRef.current = i === null ? null : how;
      setActiveState(i);
      setVia(viaRef.current);
    },
    [],
  );

  // This chart was not touched directly, so onHover is not called
  const applySync = useCallback((i: number | null) => {
    if (viaRef.current === "keyboard") return;
    viaRef.current = i === null ? null : "sync";
    setActiveState(i);
    setVia(viaRef.current);
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
    reduced,
    publish,
    applySync,
  };
}
