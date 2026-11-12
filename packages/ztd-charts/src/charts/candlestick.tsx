import { useMemo, type ReactNode } from "react";
import { AnnotationsOver, AnnotationsUnder, annotationYs, describeAnnotations, type Annotation, type AnnotationGeom } from "../core/annotations";
import { AXIS_FONT, AxisPill, fitTickLabels, GridY, HoverLine, tickLabels, yAxisWidth } from "../core/axis";
import { BrushBand, changeRatio, ExtremeTags, signedPercent, useChartBrush, useZoom, type BrushProps } from "../core/brush";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { dayFirstOf, formatDate, makeTickFormatter, toDate, type DayFirstProps } from "../core/format";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { readableOn } from "../core/palette";
import { fitDomain, scaleLinear, timeTicks } from "../core/scale";
import { textWidth } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useSync } from "../core/sync";
import { useMotion } from "../core/useMotion";
import { getter, numGetter } from "../data/accessor";
import type { ColorToken } from "../theme/tokens";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  name: "Candlestick chart",
  open: "Open",
  high: "High",
  low: "Low",
  close: "Close",
  change: "Change",
  volume: "Volume",
  empty: "No data.",
  ohlc: (o: string, h: string, l: string, c: string) => `open ${o}, high ${h}, low ${l}, close ${c}`,
  /** Opening part when announcing the selected range */
  span: (from: string, to: string, change: string) => `${from} to ${to}: ${change}`,
  desc: (from: string, to: string, n: number, open: string, close: string) => `${from} to ${to}, ${plural(n, "candle")}. First open ${open}, last close ${close}`,
  /** Moving average line label */
  ma: (d: number) => `MA${d}`,
  /** Up, down and moving average entries of the card legend (card.legend: "auto") */
  up: "Up",
  down: "Down",
  maLegend: (d: number) => `${d}-day MA`,
};
/** Candlestick text. The spec card's automatic legend (Chart.tsx) uses it too */
export const CANDLE_TEXT: Record<ChartLang, typeof en> = {
  en,
  ko: {
    name: "캔들스틱",
    open: "시가",
    high: "고가",
    low: "저가",
    close: "종가",
    change: "등락률",
    volume: "거래량",
    empty: "데이터가 없어요.",
    ohlc: (o, h, l, c) => `시가 ${o}, 고가 ${h}, 저가 ${l}, 종가 ${c}`,
    span: (from, to, change) => `${from}부터 ${to}까지 ${change}`,
    desc: (from, to, n, open, close) => `${from}부터 ${to}까지 ${n}개 봉. 첫 시가 ${open}, 마지막 종가 ${close}`,
    ma: (d) => `${d}일선`,
    up: "상승",
    down: "하락",
    maLegend: (d) => `${d}일 이동평균`,
  },
};

export interface CandlestickChartProps<T = Row> extends BaseChartProps<T>, BrushProps, DayFirstProps {
  /** Date (time point) field. Default "date" */
  x?: Accessor<T, unknown>;
  /** Open, high, low and close fields. Default "open", "high", "low", "close" */
  open?: Accessor<T, number>;
  high?: Accessor<T, number>;
  low?: Accessor<T, number>;
  close?: Accessor<T, number>;
  /** Volume field. When present, drawn as small bars at the bottom */
  volume?: Accessor<T, number>;
  /** Periods of the closing-price moving average lines. Example: [5, 20] */
  ma?: number[];
  /** Color of rising candles. A theme token name or CSS color. Default "accent" (Korean convention: rises in red tones) */
  upColor?: string;
  /** Color of falling candles. Default "neutralStrong" */
  downColor?: string;
  /** Above this many candles, neighboring candles are merged (open from the first candle, close from the last, high and low from the extremes of the span). Default: plot width / 4 */
  maxCandles?: number;
  /** Fixed price axis range */
  yDomain?: [number, number];
  /** Annotations: target band, period, reference line, event, forecast, trend line (close), weekend shading */
  annotations?: Annotation[];
}

interface Candle<T> {
  /** Index of the first source row (after sorting) */
  i: number;
  /** Number of merged rows */
  span: number;
  key: string;
  label: string;
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  datum: T;
}

/** Moving average line colors (shortest period first). The card legend uses this order too */
export const MA_TOKENS = ["ink", "muted", "dim"] as const;

/** Moving average periods to draw: the first 3 of those that are at least 2 and smaller than the candle count */
export function maPeriods(ma: readonly number[] | undefined, count: number): number[] {
  return (ma ?? []).filter((d) => d >= 2 && d < count).slice(0, MA_TOKENS.length);
}

/** Rows to candles in time order. Rows without a close are dropped; a missing open, high or low is filled from neighboring values. dated tells whether every row is a date */
function toCandles<T>(data: readonly T[], props: Pick<CandlestickChartProps<T>, "x" | "open" | "high" | "low" | "close" | "volume" | "dayFirst">, locale: string): { candles: Candle<T>[]; dated: boolean } {
  const gx = getter(props.x, "date");
  const go = numGetter(props.open, "open");
  const gh = numGetter(props.high, "high");
  const gl = numGetter(props.low, "low");
  const gc = numGetter(props.close, "close");
  const gv = props.volume === undefined ? null : numGetter(props.volume, "volume");
  const df = props.dayFirst ?? dayFirstOf(data.map((d, i) => gx(d, i)));
  const raw = data.map((d, i) => {
    const xv = gx(d, i);
    // A numeric x counts as a timestamp (ms) only above 1e10. Small numbers (1, 2, 3 or the year 2024) stay as labels instead of becoming dates in 1970
    // A four-digit year string ("2020") is a label too, not 1 January of that year.
    const dt = (typeof xv === "number" && Math.abs(xv) <= 1e10) || (typeof xv === "string" && /^\d{4}$/.test(xv.trim())) ? null : toDate(xv, df);
    return { d, i, xv, dt, t: dt ? dt.getTime() : i, c: gc(d, i), o: go(d, i), h: gh(d, i), l: gl(d, i), v: gv ? gv(d, i) : NaN };
  });
  const dated = raw.every((r) => r.dt);
  const rows = raw.filter((r) => Number.isFinite(r.c));
  if (dated) rows.sort((a, b) => a.t - b.t);
  const out: Candle<T>[] = [];
  const keys = new Set<string>();
  let prev = NaN;
  rows.forEach((r, k) => {
    const o = Number.isFinite(r.o) ? r.o : Number.isFinite(prev) ? prev : r.c;
    const h = Math.max(o, r.c, Number.isFinite(r.h) ? r.h : -Infinity);
    const l = Math.min(o, r.c, Number.isFinite(r.l) ? r.l : Infinity);
    const label = r.dt ? formatDate(r.dt, { locale, year: "numeric", month: "short", day: "numeric" }) : String(r.xv ?? k + 1);
    // So that event and range (onBrush) keys stay unique even when the same time point appears twice
    let key = r.dt ? String(r.t) : String(r.xv);
    if (keys.has(key)) key = `${key}#${k}`;
    keys.add(key);
    out.push({ i: k, span: 1, key, label, t: dated ? r.t : k, o, h, l, c: r.c, v: r.v, datum: r.d });
    prev = r.c;
  });
  return { candles: out, dated };
}

/** Merge neighboring candles down to at most max */
function mergeCandles<T>(cs: Candle<T>[], max: number): Candle<T>[] {
  if (cs.length <= max || max < 2) return cs;
  const size = Math.ceil(cs.length / max);
  const out: Candle<T>[] = [];
  for (let a = 0; a < cs.length; a += size) {
    const g = cs.slice(a, a + size);
    const first = g[0];
    const last = g[g.length - 1];
    let h = -Infinity;
    let l = Infinity;
    let v = 0;
    let hasV = false;
    for (const q of g) {
      h = Math.max(h, q.h);
      l = Math.min(l, q.l);
      if (Number.isFinite(q.v)) {
        v += q.v;
        hasV = true;
      }
    }
    out.push({ i: first.i, span: g.reduce((s, q) => s + q.span, 0), key: first.key, label: g.length > 1 ? `${first.label} ~ ${last.label}` : first.label, t: first.t, o: first.o, h, l, c: last.c, v: hasV ? v : NaN, datum: last.datum });
  }
  return out;
}

/** Simple moving average. The first period-1 values are NaN */
function movingAverage(values: readonly number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period < 1) return out;
  let sum = 0;
  for (let k = 0; k < values.length; k++) {
    sum += values[k];
    if (k >= period) sum -= values[k - period];
    if (k >= period - 1) out[k] = sum / period;
  }
  return out;
}

/** Candlestick: open, high, low and close per period. Rises in the accent color, falls in gray */
export function CandlestickChart<T = Row>(props: CandlestickChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(240, Math.min(340, w * 0.55)), duration: 700, format: "number" });
  const { p, width: W, height: H } = c;

  const all = useMemo(() => toCandles(props.data, props, c.locale), [props.data, props.x, props.open, props.high, props.low, props.close, props.volume, props.dayFirst, c.locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const dated = all.dated;
  // The zoomed range (in candle order)
  const zoom = useZoom(c.sig);
  const view = zoom.view;
  const visible = useMemo(() => (view ? all.candles.slice(view[0], view[1] + 1) : all.candles), [all, view]);

  const { up, down } = useMemo(() => {
    const color = (v: string | undefined, fb: ColorToken) => ({ fill: p.color(v, fb), text: readableOn(p, p.raw(v, fb)) });
    return { up: color(props.upColor, "accent"), down: color(props.downColor, "neutralStrong") };
  }, [p, props.upColor, props.downColor]);

  // Axes and plot area (the price axis on the right)
  const top = 10;
  const bottom = 22;
  const plotW0 = Math.max(40, W - 56);
  const maxCandles = Math.max(8, Math.round(props.maxCandles ?? plotW0 / 4));
  // Merge candles and measure the price and volume ranges in one pass
  const { cs, lo, hi, vmax, hasVolume } = useMemo(() => {
    const merged = mergeCandles(visible, maxCandles);
    let l = Infinity;
    let h = -Infinity;
    let v = 0;
    let anyVolume = false;
    for (const q of merged) {
      l = Math.min(l, q.l);
      h = Math.max(h, q.h);
      if (Number.isFinite(q.v)) {
        v = Math.max(v, q.v);
        anyVolume = true;
      }
    }
    const empty = !Number.isFinite(l);
    return { cs: merged, lo: empty ? 0 : l, hi: empty ? 1 : h, vmax: v, hasVolume: props.volume !== undefined && anyVolume };
  }, [visible, maxCandles, props.volume]);
  const n = cs.length;
  const volH = hasVolume ? Math.max(28, (H - top - bottom) * 0.18) : 0;
  const priceBottom = H - bottom - (hasVolume ? volH + 8 : 0);
  const yCount = Math.max(2, Math.round((priceBottom - top) / 60));
  // Keep annotation reference lines and bands inside the axis too (lo and hi stay the raw data values for the description and price tag)
  const noteYs = annotationYs(props.annotations);
  const dom: [number, number] = props.yDomain ?? fitDomain(Math.min(lo, ...noteYs), Math.max(hi, ...noteYs), yCount, { zero: false });
  // The price axis shows full, unabbreviated numbers, as is the convention on financial screens (format overrides this)
  const tickFmt = makeTickFormatter(props.format, c.locale, 0);
  const yTicks = scaleLinear(dom, [0, 1]).ticks(yCount);
  // Fit the wider of the axis ticks and the closing price tag
  const right = Math.max(yAxisWidth(yTicks, tickFmt, c.locale), textWidth(tickFmt(hi), 10.5, 700) + 14) + 4;
  const x0 = 4;
  const x1 = W - right;
  const step = n ? (x1 - x0) / n : 1;
  const bodyW = Math.max(1, Math.min(18, step * 0.64));
  const cx = (k: number) => x0 + step * (k + 0.5);
  const y = scaleLinear(dom, [priceBottom, top]);
  const vy = (v: number) => H - bottom - (vmax > 0 && Number.isFinite(v) ? (v / vmax) * volH : 0);

  const hiSet = useMemo(
    () => resolveHighlight(props.highlight, cs.map((q) => q.datum), cs.map((q) => q.label), cs.map((q) => q.c), "last"),
    [props.highlight, cs],
  );
  const markK = hiSet.size ? Math.max(...hiSet) : -1;

  const sweep = Math.min(700, 12 * n);
  const marks = useMemo<Mark<number>[]>(
    () =>
      cs.map((q, k) => {
        const mid = (y(q.o) + y(q.c)) / 2;
        const base = H - bottom;
        return { key: q.key, to: [y(q.o), y(q.c), y(q.h), y(q.l), vy(q.v)], from: [mid, mid, mid, mid, base], enter: [mid, mid, mid, mid, base], delay: n > 1 ? (k / (n - 1)) * sweep : 0, data: k };
      }),
    // y and vy are determined by the values below
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cs, H, dom[0], dom[1], volH, vmax, sweep],
  );
  const m = useMotion(marks, c.motion);

  // Moving averages are computed from all closes before merging or zooming, and a merged candle reads the value of its last original candle
  // (averaging merged candles would turn the 5-day line into an average of 5 groups, and zooming would leave the start empty)
  const maFull = useMemo(() => {
    const closes = all.candles.map((q) => q.c);
    return maPeriods(props.ma, closes.length).map((d) => ({ d, v: movingAverage(closes, d) }));
  }, [props.ma, all]);
  const mas = useMemo(() => maFull.map((ma) => ({ d: ma.d, v: cs.map((q) => ma.v[q.i + q.span - 1]) })), [maFull, cs]);
  // Moving average lines are rebuilt only when the size or candles change (only opacity changes during the entrance).
  // Using linePath from geometry would bundle the curve code as well (about 1KB), so straight segments are joined here
  const maPaths = useMemo(
    () =>
      mas.map((ma) => {
        let d = "";
        ma.v.forEach((v, k) => {
          if (Number.isFinite(v)) d += `${d ? "L" : "M"}${cx(k).toFixed(1)},${y(v).toFixed(1)}`;
        });
        return d;
      }),
    // cx and y are determined by the values below
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mas, x1, priceBottom, dom[0], dom[1]],
  );

  const fv = c.fv;
  const msg = CANDLE_TEXT[c.lang];
  const events = useMemo<ChartEvent<T>[]>(
    () => cs.map((q, k) => ({ datum: q.datum, index: k, key: q.key, label: q.label, value: q.c, formatted: msg.ohlc(fv(q.o), fv(q.h), fv(q.l), fv(q.c)) })),
    [cs, fv, msg],
  );
  const prevClose = (k: number) => (k > 0 ? cs[k - 1].c : NaN);
  const indexAt = (px: number) => Math.max(0, Math.min(n - 1, Math.floor((px - x0) / step)));

  const { brush, frame: brushFrame, hint, text: brushText } = useChartBrush(props, zoom, {
    p,
    active: c.active,
    lang: c.lang,
    count: n,
    indexAt,
    inPlot: (px, py) => px >= x0 && px <= x1 && py >= top && py <= H - bottom,
    // A candle's i is its position in the full, unzoomed order, so return it as is
    toXRange: (r) => {
      const a = cs[r.from];
      const b = cs[r.to];
      return { from: a.i, to: b.i + b.span - 1, fromKey: a.key, toKey: b.key, fromLabel: a.label, toLabel: b.label };
    },
  });

  useSync(c, props.syncId, cs.map((q) => q.key), cs.map((q) => q.label));
  let tip: TooltipData | null = null;
  if (c.active !== null && cs[c.active] && !brush.dragging) {
    const q = cs[c.active];
    const ch = changeRatio(prevClose(c.active), q.c);
    const col = q.c >= q.o ? up.fill : down.fill;
    tip = {
      x: cx(c.active),
      y: y(q.h),
      title: q.label,
      rows: [
        { label: msg.open, value: c.fv(q.o), strong: false },
        { label: msg.high, value: c.fv(q.h), strong: false },
        { label: msg.low, value: c.fv(q.l), strong: false },
        { label: msg.close, value: c.fv(q.c), color: col },
        ...(ch !== null ? [{ label: msg.change, value: signedPercent(ch, c.locale) }] : []),
        ...(Number.isFinite(q.v) ? [{ label: msg.volume, value: c.fmt(q.v), strong: false }] : []),
      ],
    };
  }

  // Selected period: change from the first open to the last close, highest high, lowest low
  let brushLayer: ReactNode = null;
  let announce: string | undefined;
  if (brush.range && brush.range.to < n) {
    const { from, to } = brush.range;
    let maxK = from;
    let minK = from;
    for (let k = from; k <= to; k++) {
      if (cs[k].h > cs[maxK].h) maxK = k;
      if (cs[k].l < cs[minK].l) minK = k;
    }
    const ratio = changeRatio(cs[from].o, cs[to].c);
    const main = ratio !== null ? signedPercent(ratio, c.locale) : "-";
    const short = (q: Candle<T>) => (dated ? formatDate(q.t, { locale: c.locale, month: "short", day: "numeric" }) : q.label);
    const sub = brushText.range(short(cs[from]), short(cs[to]));
    brushLayer = (
      <>
        <BrushBand p={p} x0={cx(from) - step / 2} x1={cx(to) + step / 2} top={top} bottom={H - bottom} width={W} main={main} sub={sub} dragging={brush.dragging} />
        <ExtremeTags p={p} lang={c.lang} width={W} top={top} bottom={priceBottom} max={{ x: cx(maxK), y: y(cs[maxK].h), text: c.fv(cs[maxK].h) }} min={{ x: cx(minK), y: y(cs[minK].l), text: c.fv(cs[minK].l) }} />
      </>
    );
    if (!brush.dragging) announce = `${msg.span(cs[from].label, cs[to].label, main)}${brushText.extremes(c.fv(cs[maxK].h), c.fv(cs[minK].l))}.${hint}`;
  }

  // Closing price line of the last (highlighted) candle and its price tag on the axis
  const last = markK >= 0 ? cs[markK] : null;
  const tagY = last ? Math.max(top + 8, Math.min(priceBottom - 8, y(last.c))) : null;
  let lastTag: ReactNode = null;
  if (last && tagY !== null) {
    const col = last.c >= last.o ? up : down;
    const text = tickFmt(last.c);
    const tw = textWidth(text, 10.5, 700) + 10;
    lastTag = (
      <g pointerEvents="none" opacity={m.fade(sweep + 200, 300)} aria-hidden="true">
        <line x1={x0} x2={x1} y1={y(last.c)} y2={y(last.c)} stroke={col.fill} strokeWidth={1} strokeDasharray="2 3" opacity={0.85} />
        <rect x={x1 + 3} y={tagY - 9} width={tw} height={18} rx={5} fill={col.fill} />
        <Txt x={x1 + 3 + tw / 2} y={tagY} anchor="middle" size={10.5} weight={700} fill={col.text}>
          {text}
        </Txt>
      </g>
    );
  }

  // Time axis ticks. For dates, attach each tick to the last candle that reaches the tick's time
  const xTicks = useMemo(() => {
    const ticks: { x: number; label: string }[] = [];
    if (n > 1) {
      const maxT = Math.max(2, Math.floor((x1 - x0) / 80));
      if (dated) {
        let kk = 0;
        for (const tk of timeTicks(cs[0].t, cs[n - 1].t, maxT, c.locale)) {
          while (kk < n - 1 && cs[kk + 1].t <= tk.t) kk++;
          ticks.push({ x: cx(kk), label: tk.label });
        }
      } else {
        const every = Math.max(1, Math.ceil(n / maxT));
        for (let k = 0; k < n; k += every) ticks.push({ x: cx(k), label: cs[k].label });
      }
    }
    return fitTickLabels(ticks, 0, x1 + 2);
    // cx is determined by x1 and the candle count
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cs, dated, x1, c.locale]);

  const autoDesc = useMemo(() => {
    if (!n) return `${msg.name}. ${msg.empty}`;
    const ch = changeRatio(cs[0].o, cs[n - 1].c);
    return `${msg.name}. ${msg.desc(cs[0].label, cs[n - 1].label, n, fv(cs[0].o), fv(cs[n - 1].c))}${ch !== null ? ` (${signedPercent(ch, c.locale)})` : ""}${brushText.extremes(fv(hi), fv(lo))}.`;
  }, [cs, n, lo, hi, fv, c.locale, msg, brushText]);
  const maColors = MA_TOKENS.map((t) => p.paint(t));

  // Annotation x values to pixels. Dates interpolate between candles by time, and beyond the visible range they extend by the average candle spacing
  const per = n > 1 ? (cs[n - 1].t - cs[0].t) / (n - 1) || 1 : 1;
  const xAtTime = (t: number) => {
    if (t <= cs[0].t) return cx(0) - ((cs[0].t - t) / per) * step;
    if (t >= cs[n - 1].t) return cx(n - 1) + ((t - cs[n - 1].t) / per) * step;
    let a = 0;
    let b = n - 1;
    while (b - a > 1) {
      const mid = (a + b) >> 1;
      if (cs[mid].t <= t) a = mid;
      else b = mid;
    }
    return cx(a) + ((t - cs[a].t) / (cs[b].t - cs[a].t || 1)) * step;
  };
  // The candle with the same time point (date), key or label. -1 when none
  const kOf = (val: unknown) => {
    const t = dated ? toDate(val)?.getTime() : undefined;
    return cs.findIndex((q) => (dated ? q.t === t : q.key === String(val) || q.label === String(val)));
  };
  const xAt = (val: unknown): number | null => {
    if (!n) return null;
    if (dated) {
      const d = toDate(val);
      return d ? xAtTime(d.getTime()) : null;
    }
    const k = kOf(val);
    return k < 0 ? null : cx(k);
  };
  // x in annotation descriptions: the candle label ("2025년 9월 25일") when a candle exists at that time point
  const xText = (val: unknown) => cs[kOf(val)]?.label ?? String(val ?? "");
  const ag: AnnotationGeom = {
    p,
    lang: c.lang,
    xAt,
    half: step / 2,
    y,
    x0,
    x1,
    // The moving average value text sits in the top row, so start below it
    top: top + (mas.length ? 14 : 0),
    bottom: priceBottom,
    time: dated && n > 1 ? { t0: cs[0].t, t1: cs[n - 1].t, n, xt: xAtTime } : undefined,
    points: () => cs.map((q, k) => ({ x: cx(k), y: y(q.c) })),
  };

  // Moving average values: for the pointed candle (the last candle when none). The card legend gives the names
  const maK = c.active !== null && cs[c.active] ? c.active : n - 1;
  let maX = x0 + 2;
  const maLabels = mas.map((ma, mi) => {
    const text = `${msg.ma(ma.d)} ${Number.isFinite(ma.v[maK]) ? tickFmt(ma.v[maK]) : "-"}`;
    const node = (
      <Txt key={ma.d} x={maX} y={top + 2} size={10} weight={700} fill={maColors[mi]}>
        {text}
      </Txt>
    );
    maX += textWidth(text, 10, 700) + 10;
    return node;
  });

  return (
    <ChartFrame
      c={c}
      kind={msg.name}
      ariaLabel={props.ariaLabel}
      description={props.description ?? `${autoDesc}${describeAnnotations(props.annotations, c.lang, c.fv, xText)}`}
      events={events}
      tip={tip}
      renderTip={props.tooltip}
      className={props.className}
      style={props.style}
      theme={props.theme}
      onPointerMove={(px, _py, e) => {
        if (!n) return;
        brush.move(px);
        c.setActive(indexAt(px), e.pointerType === "touch" ? "touch" : "pointer");
      }}
      {...brushFrame}
      announce={announce}
    >
      <GridY p={p} ticks={yTicks} y={y} x0={x0} x1={x1} fmt={tickFmt} locale={c.locale} side="right" zero={false} labels={false} />
      <g aria-hidden="true">
        {/* Tick labels hidden behind the price tag are not drawn (when they overlap, both are hard to read) */}
        {tickLabels(yTicks, tickFmt, c.locale).map((label, i) =>
          tagY !== null && Math.abs(y(yTicks[i]) - tagY) < 14 ? null : (
            <Txt key={yTicks[i]} x={x1 + 6} y={Math.round(y(yTicks[i])) + 0.5} size={AXIS_FONT} fill={p.paint("muted")}>
              {label}
            </Txt>
          ),
        )}
      </g>
      <rect x={x0} y={top} width={Math.max(0, x1 - x0)} height={Math.max(0, H - bottom - top)} fill="transparent" />
      <AnnotationsUnder list={props.annotations} g={ag} />
      {hasVolume ? <line x1={x0} x2={x1} y1={H - bottom + 0.5} y2={H - bottom + 0.5} stroke={p.paint("line")} /> : null}
      {m.items.map((it) => {
        const k = it.data;
        const q = cs[k];
        if (!q) return null;
        const [yo, yc, yh, yl, yv] = it.v;
        const rising = q.c >= q.o;
        const col = rising ? up.fill : down.fill;
        const xx = cx(k);
        const bodyTop = Math.min(yo, yc);
        const bodyH = Math.max(1, Math.abs(yc - yo));
        const dimmed = c.active !== null && c.active !== k ? 0.55 : 1;
        return (
          <g key={it.key} opacity={it.exiting ? 0.3 : dimmed}>
            {hasVolume && Number.isFinite(q.v) ? <rect x={xx - bodyW / 2} y={yv} width={bodyW} height={Math.max(0, H - bottom - yv)} fill={col} opacity={0.32} /> : null}
            <line x1={xx} x2={xx} y1={yh} y2={yl} stroke={col} strokeWidth={1} />
            <rect x={xx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} rx={bodyW >= 6 ? 1.5 : 0} fill={col} />
          </g>
        );
      })}
      {maPaths.map((d, mi) =>
        d ? <path key={mas[mi].d} d={d} fill="none" stroke={maColors[mi]} strokeWidth={mi === 0 ? 1.4 : 1.2} strokeLinejoin="round" opacity={m.fade(sweep, 400) * 0.9} pointerEvents="none" /> : null,
      )}
      {mas.length > 0 ? (
        <g aria-hidden="true" opacity={m.fade(sweep, 400)}>
          {maLabels}
        </g>
      ) : null}
      <AnnotationsOver list={props.annotations} g={ag} />
      {lastTag}
      {c.active !== null && cs[c.active] && !brush.dragging ? (
        <HoverLine p={p} x={cx(c.active)} top={top} bottom={H - bottom} dots={[{ k: 0, y: y(cs[c.active].c), color: cs[c.active].c >= cs[c.active].o ? up.fill : down.fill, strong: true }]} />
      ) : null}
      {brushLayer}
      <g aria-hidden="true">
        {xTicks.map((t, i) => (
          <Txt key={i} x={t.x} y={H - bottom + 13} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
            {t.label}
          </Txt>
        ))}
      </g>
      {c.active !== null && cs[c.active] && !brush.dragging ? <AxisPill p={p} x={cx(c.active)} y={H - bottom + 13} label={cs[c.active].label} width={W} /> : null}
    </ChartFrame>
  );
}
