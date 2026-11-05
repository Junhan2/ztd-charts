import { useMemo, type ReactNode } from "react";
import { AXIS_FONT, fitTickLabels, GridY, tickLabels, yAxisWidth } from "../core/axis";
import { BrushBand, changeRatio, ExtremeTags, signedPercent, useChartBrush, useZoom, type BrushProps } from "../core/brush";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { formatDate, makeTickFormatter, toDate } from "../core/format";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { readableOn } from "../core/palette";
import { fitDomain, scaleLinear, timeTicks } from "../core/scale";
import { textWidth } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
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
  /** 고른 구간을 읽어 줄 때 앞부분 */
  span: (from: string, to: string, change: string) => `${from} to ${to}: ${change}`,
  desc: (from: string, to: string, n: number, open: string, close: string) => `${from} to ${to}, ${plural(n, "candle")}. First open ${open}, last close ${close}`,
  /** 이동평균선 이름표 */
  ma: (d: number) => `MA${d}`,
  /** 카드 범례(card.legend: "auto")의 상승, 하락, 이동평균선 */
  up: "Up",
  down: "Down",
  maLegend: (d: number) => `${d}-day MA`,
};
/** 캔들스틱 문구. 스펙 카드의 자동 범례(Chart.tsx)도 써요 */
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

export interface CandlestickChartProps<T = Row> extends BaseChartProps<T>, BrushProps {
  /** 날짜(시점) 필드. 기본 "date" */
  x?: Accessor<T, unknown>;
  /** 시가, 고가, 저가, 종가 필드. 기본 "open", "high", "low", "close" */
  open?: Accessor<T, number>;
  high?: Accessor<T, number>;
  low?: Accessor<T, number>;
  close?: Accessor<T, number>;
  /** 거래량 필드. 있으면 아래에 작은 막대로 */
  volume?: Accessor<T, number>;
  /** 종가 이동평균선 기간. 예: [5, 20] */
  ma?: number[];
  /** 오르는 봉 색. 테마 토큰 이름이나 CSS 색. 기본 "accent" (한국식: 상승은 붉은 계열) */
  upColor?: string;
  /** 내리는 봉 색. 기본 "neutralStrong" */
  downColor?: string;
  /** 봉이 이보다 많으면 이웃 봉을 합쳐요 (시가는 첫 봉, 종가는 끝 봉, 고가와 저가는 구간 끝값). 기본 그림 폭 / 4 */
  maxCandles?: number;
  /** 가격 축 범위 고정 */
  yDomain?: [number, number];
}

interface Candle<T> {
  /** 원본(정렬 뒤) 첫 행 인덱스 */
  i: number;
  /** 합친 행 수 */
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

/** 이동평균선 색 (짧은 기간부터). 카드 범례도 이 순서를 써요 */
export const MA_TOKENS = ["ink", "muted", "dim"] as const;

/** 그릴 이동평균 기간: 2 이상이고 봉 수보다 작은 것 중 앞의 3개 */
export function maPeriods(ma: readonly number[] | undefined, count: number): number[] {
  return (ma ?? []).filter((d) => d >= 2 && d < count).slice(0, MA_TOKENS.length);
}

/** 행을 시점 순 봉으로. 종가가 없는 행은 빼고, 시가, 고가, 저가가 비면 이웃 값으로 채워요. dated는 모든 행이 날짜인지 */
function toCandles<T>(data: readonly T[], props: Pick<CandlestickChartProps<T>, "x" | "open" | "high" | "low" | "close" | "volume">, locale: string): { candles: Candle<T>[]; dated: boolean } {
  const gx = getter(props.x, "date");
  const go = numGetter(props.open, "open");
  const gh = numGetter(props.high, "high");
  const gl = numGetter(props.low, "low");
  const gc = numGetter(props.close, "close");
  const gv = props.volume === undefined ? null : numGetter(props.volume, "volume");
  const raw = data.map((d, i) => {
    const xv = gx(d, i);
    // 숫자 x는 1e10보다 클 때만 시각(ms)으로 봐요. 작은 수(1, 2, 3이나 연도 2024)는 1970년 날짜가 아니라 그대로 이름표로
    // A four-digit year string ("2020") is a label too, not 1 January of that year.
    const dt = (typeof xv === "number" && Math.abs(xv) <= 1e10) || (typeof xv === "string" && /^\d{4}$/.test(xv.trim())) ? null : toDate(xv);
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
    // 같은 시점이 두 번 와도 이벤트와 구간(onBrush)의 키가 겹치지 않게
    let key = r.dt ? String(r.t) : String(r.xv);
    if (keys.has(key)) key = `${key}#${k}`;
    keys.add(key);
    out.push({ i: k, span: 1, key, label, t: dated ? r.t : k, o, h, l, c: r.c, v: r.v, datum: r.d });
    prev = r.c;
  });
  return { candles: out, dated };
}

/** 이웃 봉을 묶어 max개 이하로 */
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

/** 단순 이동평균. 앞쪽 period-1개는 NaN */
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

/** 캔들스틱: 기간마다 시가, 고가, 저가, 종가. 상승은 강조색, 하락은 회색 */
export function CandlestickChart<T = Row>(props: CandlestickChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(240, Math.min(340, w * 0.55)), duration: 700, format: "number" });
  const { p, width: W, height: H } = c;

  const all = useMemo(() => toCandles(props.data, props, c.locale), [props.data, props.x, props.open, props.high, props.low, props.close, props.volume, c.locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const dated = all.dated;
  // 확대한 구간 (봉 순서)
  const zoom = useZoom(c.sig);
  const view = zoom.view;
  const visible = useMemo(() => (view ? all.candles.slice(view[0], view[1] + 1) : all.candles), [all, view]);

  const { up, down } = useMemo(() => {
    const color = (v: string | undefined, fb: ColorToken) => ({ fill: p.color(v, fb), text: readableOn(p, p.raw(v, fb)) });
    return { up: color(props.upColor, "accent"), down: color(props.downColor, "neutralStrong") };
  }, [p, props.upColor, props.downColor]);

  // 축과 그림 영역 (가격 축은 오른쪽)
  const top = 10;
  const bottom = 22;
  const plotW0 = Math.max(40, W - 56);
  const maxCandles = Math.max(8, Math.round(props.maxCandles ?? plotW0 / 4));
  // 봉을 합치고 가격, 거래량 범위를 한 번에 재요
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
  const dom: [number, number] = props.yDomain ?? fitDomain(lo, hi, yCount, { zero: false });
  // 가격 축은 금융 화면 관례대로 줄이지 않은 전체 숫자 (format을 주면 그걸 써요)
  const tickFmt = makeTickFormatter(props.format, c.locale, 0);
  const yTicks = scaleLinear(dom, [0, 1]).ticks(yCount);
  // 축 눈금과 종가 가격표 중 넓은 쪽에 맞춰요
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
    // y, vy는 아래 값들로 정해져요
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cs, H, dom[0], dom[1], volH, vmax, sweep],
  );
  const m = useMotion(marks, c.motion);

  // 이동평균은 합치거나 확대하기 전 모든 종가로 구하고, 합친 봉은 그 마지막 원래 봉의 값을 읽어요
  // (합친 봉끼리 평균을 내면 5일선이 5개 묶음 평균이 되고, 확대하면 앞쪽이 비어요)
  const maFull = useMemo(() => {
    const closes = all.candles.map((q) => q.c);
    return maPeriods(props.ma, closes.length).map((d) => ({ d, v: movingAverage(closes, d) }));
  }, [props.ma, all]);
  const mas = useMemo(() => maFull.map((ma) => ({ d: ma.d, v: cs.map((q) => ma.v[q.i + q.span - 1]) })), [maFull, cs]);
  // 이동평균선은 크기와 봉이 바뀔 때만 다시 만들어요 (등장 중에는 투명도만 바뀌어요).
  // geometry의 linePath를 쓰면 곡선 코드까지 묶여 들어와서(약 1KB) 직선만 여기서 이어요
  const maPaths = useMemo(
    () =>
      mas.map((ma) => {
        let d = "";
        ma.v.forEach((v, k) => {
          if (Number.isFinite(v)) d += `${d ? "L" : "M"}${cx(k).toFixed(1)},${y(v).toFixed(1)}`;
        });
        return d;
      }),
    // cx, y는 아래 값들로 정해져요
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
    // 봉의 i는 확대 전 전체 순서라 그대로 돌려줘요
    toXRange: (r) => {
      const a = cs[r.from];
      const b = cs[r.to];
      return { from: a.i, to: b.i + b.span - 1, fromKey: a.key, toKey: b.key, fromLabel: a.label, toLabel: b.label };
    },
  });

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

  // 고른 기간: 첫 시가에서 끝 종가까지 등락, 최고가, 최저가
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

  // 마지막(강조) 봉의 종가 선과 축 위 가격표
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

  // 시간 축 눈금. 날짜면 눈금 시점에 닿은 마지막 봉에 붙여요
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
    // cx는 x1과 봉 수로 정해져요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cs, dated, x1, c.locale]);

  const autoDesc = useMemo(() => {
    if (!n) return `${msg.name}. ${msg.empty}`;
    const ch = changeRatio(cs[0].o, cs[n - 1].c);
    return `${msg.name}. ${msg.desc(cs[0].label, cs[n - 1].label, n, fv(cs[0].o), fv(cs[n - 1].c))}${ch !== null ? ` (${signedPercent(ch, c.locale)})` : ""}${brushText.extremes(fv(hi), fv(lo))}.`;
  }, [cs, n, lo, hi, fv, c.locale, msg, brushText]);
  const maColors = MA_TOKENS.map((t) => p.paint(t));

  // 이동평균 값: 가리킨 봉(없으면 마지막 봉) 기준. 이름은 카드 범례가 알려줘요
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
      description={props.description ?? autoDesc}
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
        {/* 가격표에 가려지는 눈금 글자는 그리지 않아요 (겹치면 둘 다 읽기 어려워요) */}
        {tickLabels(yTicks, tickFmt, c.locale).map((label, i) =>
          tagY !== null && Math.abs(y(yTicks[i]) - tagY) < 14 ? null : (
            <Txt key={yTicks[i]} x={x1 + 6} y={Math.round(y(yTicks[i])) + 0.5} size={AXIS_FONT} fill={p.paint("muted")}>
              {label}
            </Txt>
          ),
        )}
      </g>
      <rect x={x0} y={top} width={Math.max(0, x1 - x0)} height={Math.max(0, H - bottom - top)} fill="transparent" />
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
      {lastTag}
      {c.active !== null && cs[c.active] && !brush.dragging ? (
        <line x1={cx(c.active)} x2={cx(c.active)} y1={top} y2={H - bottom} stroke={p.paint("dim")} strokeWidth={1} pointerEvents="none" />
      ) : null}
      {brushLayer}
      <g aria-hidden="true">
        {xTicks.map((t, i) => (
          <Txt key={i} x={t.x} y={H - bottom + 13} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
            {t.label}
          </Txt>
        ))}
      </g>
    </ChartFrame>
  );
}
