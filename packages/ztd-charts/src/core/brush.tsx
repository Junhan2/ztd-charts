import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Painter } from "../theme/context";
import { Txt } from "./ChartFrame";
import { DEFAULT_LOCALE, formatNumber } from "./format";
import type { ChartLang } from "./i18n";
import { textWidth } from "./text";

/** Range selection text (line, candlestick) */
const en = {
  zoomHint: " Press Enter to zoom in.",
  pickHint: " Press Enter to select.",
  high: "High",
  low: "Low",
  resetLabel: "Show all (reset zoom)",
  reset: "Show all",
  /** The high and low part of the announced sentence */
  extremes: (hi: string, lo: string) => `, high ${hi}, low ${lo}`,
  /** Name of the selected range, e.g. "Jan to Mar" */
  range: (a: string, b: string) => `${a} to ${b}`,
};
const BRUSH_TEXT: Record<ChartLang, typeof en> = {
  en,
  ko: {
    zoomHint: " Enter를 누르면 확대해요.",
    pickHint: " Enter를 누르면 이 구간을 골라요.",
    high: "최고",
    low: "최저",
    resetLabel: "전체 보기(확대 풀기)",
    reset: "전체 보기",
    extremes: (hi, lo) => `, 최고 ${hi}, 최저 ${lo}`,
    range: (a, b) => `${a}~${b}`,
  },
};

/** The selected range. Indexes of the currently visible points, both ends included (from < to) */
export interface BrushRange {
  from: number;
  to: number;
}

/** The x range a chart reports through onBrush. Indexes follow the full order before zooming */
export interface XRange {
  from: number;
  to: number;
  fromKey: string;
  toKey: string;
  fromLabel: string;
  toLabel: string;
}

/** Options for charts that support range selection */
export interface BrushProps {
  /**
   * Select an x range by dragging (mouse, pen; on the keyboard, Shift+arrow keys and Enter).
   * true shows the range's change with its high and low; "zoom" zooms into the range. Default false
   */
  brush?: boolean | "zoom";
  /** Called when a range is selected or cleared. Indexes follow the x order before zooming (sorted unique x; candle order for candlesticks) */
  onBrush?: (range: XRange | null) => void;
}

export interface BrushOptions {
  enabled: boolean;
  /** Number of visible points */
  count: number;
  /** Index of the point nearest to an svg x coordinate */
  indexAt: (x: number) => number;
  /** Whether a drag can start at this spot (the plot area) */
  inPlot: (x: number, y: number) => boolean;
  /** Called when the range is set (mouse release or Enter). null when cleared */
  onCommit: (r: BrushRange | null) => void;
  /** Keeps the band after the range is set. false when the view changes as soon as it is set, as with zoom. Default true */
  keep?: boolean;
}

export interface Brush {
  range: BrushRange | null;
  dragging: boolean;
  /** Selecting with the keyboard (Shift+arrow keys) and not yet confirmed with Enter */
  keyboard: boolean;
  /** true when a drag started */
  down: (x: number, y: number, e: PointerEvent<SVGSVGElement>) => boolean;
  /** true while dragging (the chart need not handle hover separately then) */
  move: (x: number) => boolean;
  up: (x: number, y: number, e: PointerEvent<SVGSVGElement>) => void;
  /** Shift+arrow keys to extend, Enter to confirm, Escape to clear. true when handled */
  key: (e: KeyboardEvent<HTMLDivElement>, active: number | null) => boolean;
}

const MIN_DRAG_PX = 4;

/**
 * Select an x range by dragging (mouse, pen). Touch is not used, since it would conflict with reading values by finger.
 * On the keyboard, select with Shift+arrow keys and confirm with Enter.
 */
export function useBrush(o: BrushOptions): Brush {
  const [range, setRange] = useState<BrushRange | null>(null);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ i: number; x: number; moved: boolean } | null>(null);
  const anchor = useRef<number | null>(null);

  const clear = () => {
    start.current = null;
    anchor.current = null;
    setDragging(false);
    setRange(null);
  };

  const down = (x: number, y: number, e: PointerEvent<SVGSVGElement>) => {
    if (!o.enabled || o.count < 2 || e.pointerType === "touch" || e.button !== 0 || !o.inPlot(x, y)) return false;
    start.current = { i: o.indexAt(x), x, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    return true;
  };

  const move = (x: number) => {
    const s = start.current;
    if (!s) return false;
    if (!s.moved && Math.abs(x - s.x) < MIN_DRAG_PX) return true;
    s.moved = true;
    const i = o.indexAt(x);
    const from = Math.min(s.i, i);
    const to = Math.max(s.i, i);
    setDragging(true);
    // Moving over the same point does not re-render
    setRange((prev) => (prev?.from === from && prev.to === to ? prev : { from, to }));
    return true;
  };

  const up = (x: number, _y: number, e: PointerEvent<SVGSVGElement>) => {
    const s = start.current;
    start.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!s) return;
    setDragging(false);
    // A click without movement clears the selected range
    if (!s.moved || e.type === "pointercancel") {
      if (range) {
        setRange(null);
        o.onCommit(null);
      }
      return;
    }
    const i = o.indexAt(x);
    const r = { from: Math.min(s.i, i), to: Math.max(s.i, i) };
    const ok = r.to > r.from;
    setRange(ok && o.keep !== false ? r : null);
    o.onCommit(ok ? r : null);
  };

  const key = (e: KeyboardEvent<HTMLDivElement>, active: number | null) => {
    if (!o.enabled) return false;
    if (e.key === "Escape" && range) {
      clear();
      o.onCommit(null);
      return true;
    }
    if (e.key === "Enter" && range && anchor.current !== null) {
      anchor.current = null;
      if (o.keep === false) setRange(null);
      o.onCommit(range);
      return true;
    }
    if (!e.shiftKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight") || o.count < 2) return false;
    const step = e.key === "ArrowRight" ? 1 : -1;
    const a = anchor.current ?? active ?? (step > 0 ? 0 : o.count - 1);
    // Moves the end opposite the anchor
    const end = range && anchor.current !== null ? (range.from === a ? range.to : range.from) : a;
    const next = Math.max(0, Math.min(o.count - 1, end + step));
    anchor.current = a;
    setRange(next === a ? null : { from: Math.min(a, next), to: Math.max(a, next) });
    return true;
  };

  return { range, dragging, keyboard: range !== null && anchor.current !== null, down, move, up, key };
}

export interface Zoom {
  /** The zoomed range [from, to] (in the full order before zooming). null when not zoomed */
  view: [number, number] | null;
  zoomTo: (range: [number, number]) => void;
  reset: () => void;
}

/** The zoomed range. Reset when the data (sig) changes */
export function useZoom(sig: string): Zoom {
  const [z, setZ] = useState<{ sig: string; range: [number, number] } | null>(null);
  // Reset in the very render where the data changed. Resetting in an effect would compute once more with the old range
  if (z && z.sig !== sig) setZ(null);
  return {
    view: z && z.sig === sig ? z.range : null,
    zoomTo: (range) => setZ({ sig, range }),
    reset: () => setZ(null),
  };
}

/**
 * Connects the brush and onBrush options to dragging, keyboard range selection and (with "zoom") zooming.
 * Spread frame into ChartFrame as is, and append hint to the end of the announced sentence
 */
export function useChartBrush(
  props: BrushProps,
  zoom: Zoom,
  o: Pick<BrushOptions, "count" | "indexAt" | "inPlot"> & { p: Painter; active: number | null; lang: ChartLang; toXRange: (r: BrushRange) => XRange },
) {
  const text = BRUSH_TEXT[o.lang];
  const mode = props.brush === "zoom" ? "zoom" : props.brush ? "select" : null;
  const brush = useBrush({
    enabled: mode !== null,
    count: o.count,
    indexAt: o.indexAt,
    inPlot: o.inPlot,
    keep: mode !== "zoom",
    onCommit: (r) => {
      const xr = r ? o.toXRange(r) : null;
      props.onBrush?.(xr);
      if (mode === "zoom" && xr && xr.to > xr.from) zoom.zoomTo([xr.from, xr.to]);
    },
  });
  const frame = {
    onPointerDown: mode ? brush.down : undefined,
    onPointerUp: mode ? brush.up : undefined,
    onKey: mode
      ? (e: KeyboardEvent<HTMLDivElement>) => {
          if (e.key === "Escape" && zoom.view && !brush.range) {
            zoom.reset();
            return true;
          }
          return brush.key(e, o.active);
        }
      : undefined,
    overlay: zoom.view ? <ZoomReset p={o.p} onReset={zoom.reset} text={text} /> : null,
  };
  const hint = brush.keyboard ? (mode === "zoom" ? text.zoomHint : text.pickHint) : "";
  return { brush, frame, hint, text };
}

/** Ratio of change from a to b. null instead of a ratio when a is 0 */
export function changeRatio(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return (b - a) / Math.abs(a);
}

export function signedPercent(r: number, locale = DEFAULT_LOCALE): string {
  const v = Math.round(r * 1000) / 10;
  return `${v > 0 ? "+" : ""}${formatNumber(v, { locale, maximumFractionDigits: 1 })}%`;
}

/** The selected range: a faint band, lines at both ends and a summary chip on top */
export function BrushBand(props: { p: Painter; x0: number; x1: number; top: number; bottom: number; width: number; main: string; sub: string; dragging: boolean }) {
  const { p, top, bottom } = props;
  const a = Math.min(props.x0, props.x1);
  const b = Math.max(props.x0, props.x1);
  const mainW = textWidth(props.main, 11.5, 800);
  const subW = textWidth(props.sub, 10.5, 500) + 6;
  const chipW = mainW + subW + 16;
  const chipX = Math.max(2, Math.min(props.width - chipW - 2, (a + b) / 2 - chipW / 2));
  const chipY = top + 4;
  return (
    <g pointerEvents="none" aria-hidden="true">
      <rect x={a} y={top} width={Math.max(1, b - a)} height={Math.max(0, bottom - top)} fill={p.paint("accent")} opacity={props.dragging ? 0.1 : 0.14} />
      <line x1={a} x2={a} y1={top} y2={bottom} stroke={p.paint("accent")} strokeWidth={1} opacity={0.7} />
      <line x1={b} x2={b} y1={top} y2={bottom} stroke={p.paint("accent")} strokeWidth={1} opacity={0.7} />
      <rect x={chipX} y={chipY} width={chipW} height={22} rx={8} fill={p.paint("panel")} stroke={p.paint("line")} />
      <Txt x={chipX + 8} y={chipY + 11} size={11.5} weight={800} fill={p.paint("ink")}>
        {props.main}
      </Txt>
      <Txt x={chipX + 8 + mainW + 6} y={chipY + 11} size={10.5} weight={500} fill={p.paint("muted")}>
        {props.sub}
      </Txt>
    </g>
  );
}

interface TagPoint {
  x: number;
  y: number;
  /** Value text */
  text: string;
}

/** Tags for the range's high (above the point) and low (below the point). Placed on the other side when there is no room */
export function ExtremeTags(props: { p: Painter; width: number; top: number; bottom: number; max: TagPoint; min: TagPoint; lang: ChartLang }) {
  const { p, width, top, bottom, max, min } = props;
  const text = BRUSH_TEXT[props.lang];
  return (
    <>
      <PointTag p={p} x={max.x} y={max.y} text={`${text.high} ${max.text}`} below={max.y - 26 < top + 30} width={width} />
      <PointTag p={p} x={min.x} y={min.y} text={`${text.low} ${min.text}`} below={min.y + 26 < bottom} width={width} />
    </>
  );
}

/** Small value tag attached above (or below) a point */
function PointTag(props: { p: Painter; x: number; y: number; text: string; below?: boolean; width: number }) {
  const { p } = props;
  const w = textWidth(props.text, 10.5, 700) + 12;
  const h = 18;
  const tx = Math.max(2, Math.min(props.width - w - 2, props.x - w / 2));
  const ty = props.below ? props.y + 8 : props.y - h - 8;
  return (
    <g pointerEvents="none" aria-hidden="true">
      <circle cx={props.x} cy={props.y} r={3.5} fill={p.paint("ink")} stroke={p.paint("panel")} strokeWidth={2} />
      <rect x={tx} y={ty} width={w} height={h} rx={9} fill={p.paint("ink")} />
      <Txt x={tx + w / 2} y={ty + h / 2} anchor="middle" size={10.5} weight={700} fill={p.paint("onInk")}>
        {props.text}
      </Txt>
    </g>
  );
}

/** The "Show all" button shown at the top right while zoomed */
function ZoomReset(props: { p: Painter; onReset: () => void; text: typeof en }) {
  const { p } = props;
  return (
    <button
      type="button"
      className="ztd-btn"
      onClick={props.onReset}
      aria-label={props.text.resetLabel}
      style={{ position: "absolute", top: 0, right: 0, height: 24, padding: "0 10px", borderRadius: 12, border: `1px solid ${p.paint("line")}`, background: p.paint("panel"), color: p.paint("muted"), fontSize: 11.5, fontWeight: 600, zIndex: 4 }}
    >
      {props.text.reset}
    </button>
  );
}
