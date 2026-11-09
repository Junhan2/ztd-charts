import { useCallback, useMemo, type KeyboardEvent } from "react";
import { AXIS_FONT, GridY, yAxisWidth } from "../core/axis";
import { CanvasLayer } from "../core/CanvasLayer";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { makeTickFormatter } from "../core/format";
import { resolveHighlight } from "../core/highlight";
import { lazyArray } from "../core/lazy";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { extent, fitDomain, scaleLinear, scaleSqrt } from "../core/scale";
import { labelBox, overlaps, type Box } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Highlight, Row, TooltipData, TooltipRow } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter } from "../data/accessor";
import { plural, type ChartLang } from "../core/i18n";
import { SCATTER_KIT, type CanvasGroup, type PlacedTag, type PlotBox, type ScatterKit, type SeriesLabel } from "./scatter-kit";

const en = {
  bubble: "Bubble chart",
  scatter: "Scatter plot",
  size: "Size",
  sizeWord: "size",
  nth: (i: number) => `#${i}`,
  /** r: x 최소, x 최대, y 최소, y 최대 */
  desc: (sized: boolean, n: number, r: string[]) => `${sized ? "Bubble chart" : "Scatter plot"}. ${plural(n, "point")}. x from ${r[0]} to ${r[1]}, y from ${r[2]} to ${r[3]}.`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    bubble: "버블 차트",
    scatter: "산점도",
    size: "크기",
    sizeWord: "크기",
    nth: (i) => `${i}번`,
    desc: (sized, n, r) => `${sized ? "버블 차트" : "산점도"}. 점 ${n}개. x ${r[0]}~${r[1]}, y ${r[2]}~${r[3]}.`,
  },
};

/** 버블 차트와 산점도가 같이 받는 프롭 */
interface PointChartProps<T> extends BaseChartProps<T> {
  x?: Accessor<T, number>;
  y?: Accessor<T, number>;
  /** 이름 필드 (툴팁, 라벨) */
  label?: Accessor<T, string>;
  xLabel?: string;
  yLabel?: string;
  /** 축에 0을 포함. 기본 false */
  zero?: boolean;
  /** 라벨을 붙일 최대 개수 (강조 + 큰 원 순). 기본 6 */
  maxLabels?: number;
  /** 이 개수보다 많으면 캔버스로 그려요. 기본 1500 */
  canvasThreshold?: number;
  xFormat?: BaseChartProps<T>["format"];
}

export interface BubbleChartProps<T = Row> extends PointChartProps<T> {
  /** 원 크기 필드. 없으면 산점도 */
  size?: Accessor<T, number>;
  /** 원 반지름 범위(px). 기본 [4, 26] */
  sizeRange?: [number, number];
}

export interface ScatterChartProps<T = Row> extends PointChartProps<T> {
  /** 계열 필드. 강조 계열은 accent, 나머지는 회색 단계로 칠하고, 계열이 4개 이하면 이름을 점 옆에 바로 붙여요 */
  series?: Accessor<T, string>;
  /** 숨길 계열 이름. 색은 모든 계열로 정해서 숨겨도 남은 계열 색이 그대로예요 */
  hidden?: readonly string[];
  /** "linear"면 보이는 점에 맞춘 최소제곱 추세선을 그려요. 툴팁에 기울기와 R² */
  fit?: "linear";
  /** 기준선 { x, y }. 둘 다 있으면 그림을 사분면으로 나눠요 */
  refLines?: { x?: number; y?: number };
  /** 사분면 이름: 왼쪽 위, 오른쪽 위, 왼쪽 아래, 오른쪽 아래 순서. refLines에 x와 y가 모두 있을 때 그려요 */
  quadrants?: readonly string[];
  /** x 값이 같은 점을 옆으로 퍼뜨려요. amount는 가장 좁은 x 간격에 곱하는 폭(기본 0.4), seed는 고정 씨앗(기본 1)이에요 */
  jitter?: { amount?: number; seed?: number };
  /** series가 있으면 계열 이름, 인덱스, 배열, "first"(기본)로 계열을 골라요. 판별 함수는 그 계열의 행 하나라도 맞으면 그 계열을 강조해요. series가 없으면 점을 골라요(기본 없음) */
  highlight?: Highlight<T>;
}

/** PointChart가 받는 프롭. kit은 ScatterChart만 넘기는 산점도 기능 묶음이고, 없으면 버블 차트예요 */
type PointProps<T> = BubbleChartProps<T> & ScatterChartProps<T> & { kit: ScatterKit | undefined };

/** 산점도만 받는 옵션. 버블 차트에서는 비어 있어서 스펙 options에 섞여 와도 그리지 않아요 */
type ScatterOptions<T> = Pick<ScatterChartProps<T>, "series" | "hidden" | "fit" | "refLines" | "quadrants" | "jitter">;

interface Dot<T> {
  i: number;
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  vs: number;
  label: string;
  hi: boolean;
  datum: T;
  /** 계열 순번. 계열이 없으면 -1 */
  si: number;
}

/** 산점도 옵션이 없을 때 쓰는 빈 목록. 렌더마다 새 배열이면 라벨 배치를 매 프레임 다시 해요 */
const NO_BOXES: Box[] = [];
const NO_SERIES_LABELS: SeriesLabel[] = [];
const NO_PLACED_TAGS: PlacedTag[] = [];
const NO_NAMES: string[] = [];

/** x축 이름 자리: 그림 오른쪽 아래 안쪽 */
const xTitleAt = (b: PlotBox) => ({ x: b.x1 - 2, y: b.y1 - 8 });

/** 그리는 순서: 강조가 위, 같으면 작은 원이 위. 0보다 크면 a가 b보다 위에 그려져요 */
function drawOrder<T>(a: Dot<T>, b: Dot<T>): number {
  return Number(a.hi) - Number(b.hi) || b.r - a.r;
}

/** 버블 차트: x, y, 크기 세 값을 한 번에. 크기가 없으면 산점도 */
export function BubbleChart<T = Row>(props: BubbleChartProps<T>) {
  // 스펙 options에 산점도 옵션이 섞여 와도 버블 차트는 산점도 기능을 켜지 않아요
  return <PointChart<T> {...props} kit={undefined} />;
}

/** 산점도: 버블 차트와 같은 그리기에 크기 없이 작은 점. 계열 색, 추세선, 기준선과 사분면, 흔들림, 방향 키 이동을 더해요 */
export function ScatterChart<T = Row>(props: ScatterChartProps<T>) {
  return <PointChart<T> {...props} kit={SCATTER_KIT} />;
}

const finiteOrUndefined = (v: number | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function PointChart<T>(props: PointProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(220, Math.min(320, w * 0.6)), duration: 800, stagger: 0 });
  const { p, width: W, height: H } = c;
  const kit = props.kit;
  const so: ScatterOptions<T> = kit ? props : {};
  const hasSize = !kit && props.size !== undefined;
  // 행마다 계열 이름 (계열 필드를 한 번만 읽어요)
  const rowSeries = useMemo(() => {
    if (so.series === undefined) return null;
    const g = strGetter(so.series, "series");
    return props.data.map((d, i) => g(d, i));
  }, [props.data, so.series]);
  // 색은 숨긴 계열까지 모든 계열로 한 번 정해요. 그래야 계열 하나를 숨겨도 나머지 색이 그대로예요. 그래서 계열 목록도 모든 행으로 만들어요
  const seriesNames = useMemo(() => (kit && rowSeries ? kit.uniq(rowSeries) : NO_NAMES), [kit, rowSeries]);
  // 배열 옵션은 렌더마다 새로 올 수 있어서 글자로 비교해요
  const hiddenKey = so.hidden?.join("\u0001") ?? "";
  const quadrantKey = so.quadrants?.join("\u0001") ?? "";
  const jitterAmount = so.jitter ? Math.max(0, so.jitter.amount ?? 0.4) : 0;
  const jitterSeed = so.jitter?.seed ?? 1;
  const refX = finiteOrUndefined(so.refLines?.x);
  const refY = finiteOrUndefined(so.refLines?.y);
  const fitOn = so.fit === "linear";
  // 산점도 옵션이 그림을 바꿀 때만 계열, 추세, 기준선 설명을 더해요. 옵션이 없거나 효과가 없으면(빈 hidden, 폭 0 흔들림) 버블 차트의 산점도와 같은 그림과 설명이에요
  const hasScatterOptions = rowSeries !== null || fitOn || refX !== undefined || refY !== undefined || jitterAmount > 0;

  const raw = useMemo(() => {
    const gx = numGetter(props.x, "x");
    const gy = numGetter(props.y, "y");
    const gs = hasSize ? numGetter(props.size, "size") : null;
    const gl = strGetter(props.label, "label");
    // px는 그리는 x예요. 흔들림이 없으면 x 그대로라 처음부터 같은 값으로 둬요
    const rows = props.data
      .map((d, i) => {
        const vx = gx(d, i);
        return { d, i, x: vx, y: gy(d, i), s: gs ? Math.max(0, gs(d, i) || 0) : 1, label: gl(d, i), si: -1, px: vx };
      })
      .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y));
    // 버블 차트와 흔들림, 계열이 없는 산점도는 여기서 끝나요. 점이 많을 때 행을 한 번 더 돌지 않게요
    if (!kit || (jitterAmount <= 0 && !rowSeries)) return rows;
    // 흔들림 폭은 숨긴 계열까지 넣은 x 간격으로 재요. 계열을 숨겨도 남은 점이 제자리예요
    const gap = jitterAmount > 0 ? kit.smallestGap(rows.map((r) => r.x)) : 0;
    const index = new Map(seriesNames.map((s, k) => [s, k]));
    const hidden = new Set(hiddenKey ? hiddenKey.split("\u0001") : []);
    const out: typeof rows = [];
    for (const r of rows) {
      if (gap) r.px = r.x + (kit.seededUnit(jitterSeed, r.i) * 2 - 1) * jitterAmount * gap;
      if (rowSeries) {
        const name = rowSeries[r.i];
        if (hidden.has(name)) continue;
        r.si = index.get(name) ?? -1;
      }
      out.push(r);
    }
    return out;
  }, [props.data, props.x, props.y, props.size, props.label, hasSize, kit, rowSeries, seriesNames, hiddenKey, jitterAmount, jitterSeed]);

  const n = raw.length;
  const useCanvas = c.hydrated && n > (props.canvasThreshold ?? 1500);
  const ext = useMemo(() => ({ x: extent(raw.map((r) => r.x)), y: extent(raw.map((r) => r.y)), s: extent(raw.map((r) => r.s)) }), [raw]);
  // 축 범위는 흔들린 자리와 기준선까지 넣어요. 둘 다 없으면 데이터 범위 그대로예요
  const plotExt = useMemo(() => {
    if (!jitterAmount && refX === undefined && refY === undefined) return ext;
    return { ...ext, x: extent(refX === undefined ? raw.map((r) => r.px) : [...raw.map((r) => r.px), refX]), y: refY === undefined ? ext.y : extent([ext.y[0], ext.y[1], refY]) };
  }, [ext, raw, jitterAmount, refX, refY]);
  const [xmn, xmx] = ext.x;
  const [ymn, ymx] = ext.y;
  const yDom = fitDomain(plotExt.y[0], plotExt.y[1], Math.max(2, Math.round(H / 70)), { zero: props.zero ?? false, pad: 0.08 });
  const xDom = fitDomain(plotExt.x[0], plotExt.x[1], Math.max(2, Math.round(W / 110)), { zero: props.zero ?? false, pad: 0.06 });
  const yMaxAbs = Math.max(Math.abs(yDom[0]), Math.abs(yDom[1]));
  const xMaxAbs = Math.max(Math.abs(xDom[0]), Math.abs(xDom[1]));
  const yFmt = useMemo(() => makeTickFormatter(props.format, c.locale, yMaxAbs), [props.format, c.locale, yMaxAbs]);
  const xFmt = useMemo(() => makeTickFormatter(props.xFormat, c.locale, xMaxAbs), [props.xFormat, c.locale, xMaxAbs]);
  const yTicks = scaleLinear(yDom, [0, 1]).ticks(Math.max(2, Math.round(H / 70)));
  const left = yAxisWidth(yTicks, yFmt, c.locale);
  const top = props.yLabel ? 20 : 10;
  const bottom = 24;
  const [rMin, rMax] = props.sizeRange ?? (hasSize ? [4, Math.max(10, Math.min(28, W / 22))] : [n > 2000 ? 1.6 : n > 300 ? 2.6 : 4, 0]);
  const pad = hasSize ? rMax * 0.6 : 4;
  const x = scaleLinear(xDom, [left + 6 + pad, W - 8 - pad]);
  const y = scaleLinear(yDom, [H - bottom - pad, top + pad]);
  const [smn, smx] = ext.s;
  const rs = hasSize ? scaleSqrt([Math.min(0, smn), smx || 1], [rMin, rMax]) : () => rMin;
  const box = useMemo<PlotBox>(() => ({ x0: left, x1: W, y0: top, y1: H - bottom }), [left, W, top, H, bottom]);

  const hiSeries = useMemo(
    () => (kit && rowSeries ? kit.seriesHighlight(props.highlight, props.data, seriesNames, (_, i) => rowSeries[i]) : null),
    [kit, rowSeries, props.highlight, props.data, seriesNames],
  );
  const colors = useMemo(() => (kit && hiSeries ? kit.colors(p, seriesNames.length, hiSeries) : null), [kit, p, seriesNames.length, hiSeries]);
  const hi = useMemo(() => {
    if (hiSeries) {
      const out = new Set<number>();
      raw.forEach((r, k) => {
        if (hiSeries.has(r.si)) out.add(k);
      });
      return out;
    }
    return resolveHighlight(props.highlight, raw.map((r) => r.d), raw.map((r) => r.label), raw.map((r) => (hasSize ? r.s : r.y)), hasSize ? "max" : "none");
  }, [raw, props.highlight, hasSize, hiSeries]);

  const dots = useMemo<Dot<T>[]>(() => raw.map((r, k) => ({ i: k, x: x(r.px), y: y(r.y), r: rs(r.s), vx: r.x, vy: r.y, vs: r.s, label: r.label, hi: hi.has(k), datum: r.d, si: r.si })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, hi, W, H, xDom[0], xDom[1], yDom[0], yDom[1], rMin, rMax]);

  const order = useMemo(() => [...dots].sort(drawOrder), [dots]);
  const D = c.motion.duration ?? 800;
  const marks = useMemo<Mark<Dot<T> | null>[]>(() => {
    if (useCanvas) return [{ key: "__p", to: [1], from: [0], data: null }];
    const xr = W || 1;
    return order.map((d) => ({ key: `b${d.i}:${d.label}`, to: [d.x, d.y, d.r], from: [d.x, d.y, 0], enter: [d.x, d.y, 0], delay: (d.x / xr) * D * 0.55, data: d }));
  }, [order, useCanvas, W, D]);
  const m = useMotion(marks, c.motion);

  // 빠른 근접 검색용 격자
  const grid = useMemo(() => {
    const cell = 24;
    const g = new Map<string, number[]>();
    dots.forEach((d, k) => {
      const key = `${Math.floor(d.x / cell)},${Math.floor(d.y / cell)}`;
      const arr = g.get(key);
      if (arr) arr.push(k);
      else g.set(key, [k]);
    });
    return { g, cell };
  }, [dots]);
  const nearest = (px: number, py: number) => {
    const { g, cell } = grid;
    const cx0 = Math.floor(px / cell);
    const cy0 = Math.floor(py / cell);
    let best = -1;
    let bd = Infinity;
    // 포인터가 여러 원 안에 있으면 맨 위에 그려진 원을 골라요. 큰 원 안의 작은 원도 잡히게
    let hit = -1;
    const reach = hasSize ? Math.ceil(rMax / cell) + 1 : 1;
    for (let dx = -reach; dx <= reach; dx++)
      for (let dy = -reach; dy <= reach; dy++) {
        const arr = g.get(`${cx0 + dx},${cy0 + dy}`);
        if (!arr) continue;
        for (const k of arr) {
          const d = dots[k];
          const dist = Math.hypot(d.x - px, d.y - py) - d.r;
          if (dist <= 0 && (hit < 0 || drawOrder(d, dots[hit]) > 0)) hit = k;
          if (dist < bd) {
            bd = dist;
            best = k;
          }
        }
      }
    if (hit >= 0) return hit;
    return bd <= 10 ? best : null;
  };

  const msg = MSG[c.lang];
  const st = kit?.text[c.lang];
  const fit = useMemo(() => (kit && hasScatterOptions && raw.length >= 2 ? kit.linearFit(raw) : null), [kit, hasScatterOptions, raw]);
  const fitEnds = kit && fit && fitOn ? kit.fitSegment(fit, xmn, xmx, yDom) : null;
  const fitLine = fitEnds ? { x1: x(fitEnds[0]), y1: y(fitEnds[1]), x2: x(fitEnds[2]), y2: y(fitEnds[3]) } : null;
  const quadrantNames = useMemo(() => (quadrantKey ? quadrantKey.split("\u0001").map((q) => q.trim()) : NO_NAMES), [quadrantKey]);
  const refPx = refX === undefined ? null : x(refX);
  const refPy = refY === undefined ? null : y(refY);
  const quads = useMemo(
    () => (kit && quadrantNames.length && refPx !== null && refPy !== null ? kit.quadrantTags(quadrantNames, refPx, refPy, box) : NO_PLACED_TAGS),
    [kit, quadrantNames, refPx, refPy, box],
  );
  const fitTag = kit && st && fitLine ? kit.fitTagSpot(fitLine, st.trendTag, quads.map((q) => q.box), box) : null;
  const fitTagX = fitTag?.x;
  const fitTagY = fitTag?.y;
  const fitTagAnchor = fitTag?.anchor;

  // 산점도 옵션의 이름표가 서로, 그리고 x축 이름과 겹치지 않게 미리 자리를 잡아 둬요. 옵션이 없으면 비어 있어요
  const trendTag = st?.trendTag;
  const reserved = useMemo(() => {
    if (!kit || !hasScatterOptions) return NO_BOXES;
    const out = quads.map((q) => q.box);
    if (props.xLabel) {
      const t = xTitleAt(box);
      out.push(labelBox(props.xLabel, t.x, t.y, 10.5, "end"));
    }
    if (trendTag && fitTagX !== undefined && fitTagY !== undefined && fitTagAnchor) out.push(kit.tagBox(trendTag, fitTagX, fitTagY, fitTagAnchor));
    return out;
  }, [kit, hasScatterOptions, quads, props.xLabel, box, fitTagX, fitTagY, fitTagAnchor, trendTag]);

  const seriesLabels = useMemo(
    () => (kit && c.showLabels && hiSeries ? kit.placeSeriesLabels(dots, seriesNames, hiSeries, { box, reserved, grid }) : NO_SERIES_LABELS),
    [kit, c.showLabels, hiSeries, dots, seriesNames, grid, reserved, box],
  );

  // 라벨: 강조 먼저, 그다음 큰 원. 겹치면 건너뛰어요
  const labels = useMemo(() => {
    // 계열이 있으면 점 대신 계열 이름을 붙여서 점 라벨은 기본 0개예요
    const max = props.maxLabels ?? (rowSeries ? 0 : 6);
    if (!c.showLabels || n > 400 || max <= 0) return [];
    const cands = [...dots].sort((a, b) => Number(b.hi) - Number(a.hi) || b.r - a.r).filter((d) => d.label);
    const placed: Box[] = [...dots.map((d) => ({ x: d.x - d.r * 0.7, y: d.y - d.r * 0.7, w: d.r * 1.4, h: d.r * 1.4 })), ...reserved, ...seriesLabels.map((l) => l.box)];
    const out: { d: Dot<T>; x: number; y: number; anchor: "start" | "end" | "middle" }[] = [];
    for (const d of cands) {
      if (out.length >= max) break;
      const tries: { x: number; y: number; anchor: "start" | "end" | "middle" }[] = [
        { x: d.x + d.r + 5, y: d.y, anchor: "start" },
        { x: d.x - d.r - 5, y: d.y, anchor: "end" },
        { x: d.x, y: d.y - d.r - 9, anchor: "middle" },
        { x: d.x, y: d.y + d.r + 10, anchor: "middle" },
      ];
      for (const t of tries) {
        const b = labelBox(d.label, t.x, t.y, 11, t.anchor, d.hi ? 800 : 500);
        if (b.x < left || b.x + b.w > W - 2 || b.y < 0 || b.y + b.h > H - bottom) continue;
        if (placed.some((q) => overlaps(q, b, 1))) continue;
        placed.push(b);
        out.push({ d, ...t });
        break;
      }
    }
    return out;
  }, [dots, c.showLabels, n, props.maxLabels, rowSeries, reserved, seriesLabels, left, W, H, bottom]);

  const accent = swatch(p, "accent");
  const fmt = c.fmt;
  const fv = c.fv;
  const events: ChartEvent<T>[] = useMemo(
    () =>
      lazyArray(dots.length, (k) => {
        const d = dots[k];
        const e: ChartEvent<T> = { datum: d.datum, index: d.i, key: `${d.i}`, label: d.label || msg.nth(d.i + 1), value: hasSize ? d.vs : d.vy, formatted: `x ${xFmt(d.vx)}, y ${fv(d.vy)}${hasSize ? `, ${msg.sizeWord} ${fmt(d.vs)}` : ""}` };
        if (d.si >= 0) e.series = seriesNames[d.si];
        return e;
      }),
    // 표는 툴팁과 같은 포맷: y는 단위까지 (축 눈금처럼 줄이지 않아요)
    [dots, hasSize, xFmt, fv, fmt, msg, seriesNames],
  );

  let tip: TooltipData | null = null;
  if (c.active !== null && dots[c.active]) {
    const d = dots[c.active];
    const rows: TooltipRow[] = [{ label: props.xLabel ?? "x", value: xFmt(d.vx) }, { label: props.yLabel ?? "y", value: c.fv(d.vy) }, ...(hasSize ? [{ label: msg.size, value: c.fmt(d.vs), color: d.hi ? accent.fill : p.paint("neutral") }] : [])];
    if (colors && d.si >= 0) rows.unshift({ label: seriesNames[d.si], value: "", color: colors[d.si].fill, strong: true });
    if (st && fit && fitLine) rows.push({ label: st.slope, value: `${fit.slope > 0 ? "+" : ""}${c.fv(fit.slope)}`, strong: false }, { label: "R²", value: fit.r2.toFixed(2), strong: false });
    tip = { x: d.x, y: d.y - d.r, title: d.label || msg.nth(d.i + 1), rows };
  }

  const prog = useCanvas ? m.get("__p")?.[0] ?? 1 : 1;
  const neutralRaw = p.theme.neutralStrong;
  const accentRaw = p.theme.accent;
  // 캔버스 칠하기 묶음: 강조 아닌 점을 먼저 옅게, 강조를 나중에. 계열이 있으면 계열마다, 없으면 회색과 강조 둘이에요.
  // 계열이 없으면 색을 테마 색 글자로만 정해서 theme 프롭 객체가 렌더마다 새로 와도 점을 다시 칠하지 않아요
  const canvasGroups = useMemo<CanvasGroup[]>(() => {
    if (kit && colors && hiSeries) return kit.canvasGroups(dots, colors, hiSeries);
    const rest: number[] = [];
    const his: number[] = [];
    dots.forEach((d, k) => (d.hi ? his : rest).push(k));
    return [
      { ks: rest, isHi: false, fill: (read) => read("--ztd-neutral-strong", neutralRaw) },
      { ks: his, isHi: true, fill: (read) => read("--ztd-accent", accentRaw) },
    ];
  }, [kit, dots, colors, hiSeries, neutralRaw, accentRaw]);
  const drawCanvas = useCallback(
    (ctx: CanvasRenderingContext2D, t: number, color: (v: string, fb: string) => string) => {
      const xr = W || 1;
      for (const g of canvasGroups) {
        ctx.globalAlpha = g.isHi ? 1 : 0.55;
        ctx.fillStyle = g.fill(color);
        for (const k of g.ks) {
          const d = dots[k];
          // 강조는 함께 커지고, 나머지는 왼쪽부터 차례로 커져요
          const grow = g.isHi ? Math.min(1, t * 1.2) : Math.max(0, Math.min(1, (t * 1.4 - (d.x / xr) * 0.4) * 2.5));
          if (grow <= 0) continue;
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.r * grow, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    },
    [canvasGroups, dots, W],
  );

  // 방향 키(산점도): 화살표 방향의 가장 가까운 점으로. 첫 키는 강조 점으로 가요. 나머지 키(Home, End, Escape, Enter)는 ChartFrame이 맡아요
  const onKey = kit
    ? (e: KeyboardEvent<HTMLDivElement>) => {
        const step = kit.arrowStep(e.key);
        if (!step || !dots.length) return false;
        const cur = c.active !== null && dots[c.active] ? c.active : null;
        const next = cur === null ? kit.entryPoint(dots, step) : kit.nearestInDirection(dots, cur, step);
        if (next !== null) c.setActive(next, "keyboard");
        return true;
      }
    : undefined;

  const xTicks = x.ticks(Math.max(2, Math.round(W / 110)));
  const xTitle = xTitleAt(box);
  const baseDesc = msg.desc(hasSize, n, [xFmt(xmn), xFmt(xmx), yFmt(ymn), yFmt(ymx)]);
  // 산점도 문장은 점을 모두 세어서 만들어요. 렌더(애니메이션 프레임)마다 다시 세지 않게 묶어 둬요
  const scatterDesc = useMemo(() => {
    if (!kit || !st || !hasScatterOptions) return "";
    const refs = [...(refX === undefined ? [] : [`x ${xFmt(refX)}`]), ...(refY === undefined ? [] : [`y ${fv(refY)}`])];
    return kit.describe(st, { points: raw, seriesNames, fit, xName: props.xLabel ?? "x", yName: props.yLabel ?? "y", refs, refX, refY, quadrants: quadrantNames });
  }, [kit, st, hasScatterOptions, refX, refY, xFmt, fv, raw, seriesNames, fit, props.xLabel, props.yLabel, quadrantNames]);
  const desc = props.description ?? baseDesc + scatterDesc;

  return (
    <ChartFrame
      c={c}
      kind={hasSize ? msg.bubble : msg.scatter}
      ariaLabel={props.ariaLabel}
      description={desc}
      events={events}
      tip={tip}
      renderTip={props.tooltip}
      className={props.className}
      style={props.style}
      theme={props.theme}
      onPointerMove={(px, py, e) => {
        const k = nearest(px, py);
        if (k !== c.active) c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer");
      }}
      onKey={onKey}
      underlay={useCanvas ? <CanvasLayer width={W} height={H} draw={drawCanvas} progress={prog} version={c.sig} /> : undefined}
    >
      {props.yLabel ? (
        <Txt x={left} y={6} size={10.5} fill={p.paint("muted")}>
          {props.yLabel}
        </Txt>
      ) : null}
      <GridY p={p} ticks={yTicks} y={y} x0={left} x1={W} fmt={yFmt} locale={c.locale} zero={false} />
      <g aria-hidden="true">
        {xTicks.map((t) => (
          <Txt key={t} x={x(t)} y={H - bottom + 13} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
            {xFmt(t)}
          </Txt>
        ))}
        {props.xLabel ? (
          <Txt x={xTitle.x} y={xTitle.y} anchor="end" size={10.5} fill={p.paint("muted")}>
            {props.xLabel}
          </Txt>
        ) : null}
      </g>
      {kit && (refPx !== null || refPy !== null) ? <kit.RefLines p={p} x={refPx} y={refPy} box={box} /> : null}
      {!useCanvas
        ? m.items.map((it) => {
            const d = it.data;
            if (!d) return null;
            const [cx, cy, r] = it.v;
            const isA = c.active === d.i;
            const fill = colors && d.si >= 0 ? colors[d.si].fill : d.hi ? accent.fill : p.paint(hasSize ? "neutral" : "neutralStrong");
            return (
              <circle
                key={it.key}
                className="ztd-mark"
                cx={cx}
                cy={cy}
                r={Math.max(0, r)}
                fill={fill}
                fillOpacity={d.hi ? 0.92 : hasSize ? 0.85 : 0.7}
                stroke={isA ? p.paint("ink") : p.paint("panel")}
                strokeWidth={isA ? 2 : hasSize ? 1.2 : 0.6}
                opacity={it.exiting ? 0.3 : c.active === null || isA ? 1 : 0.55}
                onPointerEnter={(e) => c.setActive(d.i, e.pointerType === "touch" ? "touch" : "pointer")}
                onClick={() => c.click(d.i)}
              />
            );
          })
        : c.active !== null && dots[c.active]
          ? <circle cx={dots[c.active].x} cy={dots[c.active].y} r={dots[c.active].r + 2} fill="none" stroke={p.paint("ink")} strokeWidth={1.6} pointerEvents="none" />
          : null}
      {kit && st ? (
        <kit.Overlay
          p={p}
          fade={m.fade(D * 0.6, 300)}
          trendTag={st.trendTag}
          fitLine={fitLine}
          fitTag={fitTag}
          quads={quads}
          seriesLabels={seriesLabels}
          seriesNames={seriesNames}
          colors={colors}
          hiSeries={hiSeries}
        />
      ) : null}
      {labels.map((l) => (
        <Txt key={l.d.i} x={l.x} y={l.y} anchor={l.anchor} size={11} weight={l.d.hi ? 800 : 500} fill={p.paint(l.d.hi ? "ink" : "muted")} opacity={m.fade(D * 0.6, 300)}>
          {l.d.label}
        </Txt>
      ))}
    </ChartFrame>
  );
}
