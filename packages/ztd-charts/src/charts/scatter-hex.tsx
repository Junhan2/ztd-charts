import { useId } from "react";
import { yAxisWidth } from "../core/axis";
import { cssEntrance, useCssEntrance } from "../core/css";
import type { FacetPlan } from "../core/facet";
import { formatNumber, makeTickFormatter, type FormatSpec, type ValueFormatter } from "../core/format";
import type { ChartLang } from "../core/i18n";
import { lazyArray } from "../core/lazy";
import { clamp } from "../core/geometry";
import { colorScaleOf, scaleSwatch, scaleT, type ColorScaleOptions } from "../core/palette";
import { scaleLinear, scaleLog, type LinearScale } from "../core/scale";
import { ScaleLegend, scaleLegendWidth } from "../core/scaleLegend";
import { textWidth, truncate } from "../core/text";
import type { ChartEvent, TooltipData } from "../core/types";
import { numGetter } from "../data/accessor";
import { DOT_PAD, HEX_TOP, PLOT_BOTTOM, hexBins, hexGap, hexGrid, hexNeighbor, hexOf, hexPath, type HexCell, type HexGrid } from "../layout/hexbin";
import { useChartTheme, type Painter } from "../theme/context";

/*
 * 산점도 육각 밀도(options.bin "hex"). bubble.tsx의 PointChart가 점 대신 이 칸을 그려요.
 * SCATTER_KIT.hex와 ScatterChart.facetPlan으로만 넘겨서 버블 차트와 다른 차트의 번들에는 들어가지 않아요
 */

const en = {
  /** 칸의 점 수. count는 로캘 숫자예요 */
  points: (n: number, count: string) => `${count} ${n === 1 ? "point" : "points"}`,
  range: (lo: string, hi: string) => `${lo} to ${hi}`,
  /** 설명 뒤에 붙는 문장: 칸 수와 가장 촘촘한 칸 */
  desc: (cells: number, top: string) => ` Binned into ${cells} ${cells === 1 ? "hexagon" : "hexagons"}. Densest: ${top}.`,
};
const TEXT: Record<ChartLang, typeof en> = {
  en,
  ko: {
    points: (_n, count) => `점 ${count}개`,
    range: (lo, hi) => `${lo}~${hi}`,
    desc: (cells, top) => ` 육각 칸 ${cells}개로 묶었어요. 가장 촘촘한 칸: ${top}.`,
  },
};

/** 가장 옅은 단계의 불투명도. 타일 격자 지도와 같아서 점 하나짜리 칸도 바탕과 구분돼요 */
const MIN_OPACITY = 0.14;

type Box = { x0: number; x1: number; y0: number; y1: number };

/** 칸 하나와 그 색 위치 t(0~1, scaleSwatch에 넘겨요) */
interface HexInfo extends HexCell {
  t: number;
}

interface HexModel {
  grid: HexGrid;
  /** 점이 많은 칸부터 (Home은 가장 촘촘한 칸, End는 가장 성긴 칸) */
  cells: HexInfo[];
  /** 색 척도의 양 끝 점 수 */
  lo: number;
  hi: number;
  /** "열,줄" → cells 순번 */
  at: Map<string, number>;
  /** 색 척도 (단계 수가 늘 있어요) */
  scale: ColorScaleOptions & { steps: number };
  /** 같은 색 칸 묶음 (옅은 단계부터). d는 경로 하나 */
  groups: { t: number; d: string }[];
}

/** 축 범위 안의 점을 화면 좌표로. 범위 밖(확대, 고정 범위)과 로그 축의 0 이하는 NaN이라 세지 않아요 */
function plotted(n: number, vx: (k: number) => number, vy: (k: number) => number, x: LinearScale, y: LinearScale): [Float64Array, Float64Array] {
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const [xa, xb] = x.domain;
  const [ya, yb] = y.domain;
  for (let k = 0; k < n; k++) {
    const a = vx(k);
    const b = vy(k);
    const inside = a >= xa && a <= xb && b >= ya && b <= yb;
    xs[k] = inside ? x(a) : NaN;
    ys[k] = inside ? y(b) : NaN;
  }
  return [xs, ys];
}

/** 칸들의 [가장 적은, 가장 많은] 점 수. 칸이 없으면 [Infinity, -Infinity]예요 */
function countRange(cells: readonly HexCell[], lo = Infinity, hi = -Infinity): [number, number] {
  for (const c of cells) {
    lo = Math.min(lo, c.count);
    hi = Math.max(hi, c.count);
  }
  return [lo, hi];
}

/** 점(화면 좌표)을 칸에 세고 색 단계로 묶어요. domain을 주면(작은 여러 개의 같은 색 척도) 그 점 수 범위로 칠해요 */
function hexModel(xs: Float64Array, ys: Float64Array, box: Box, size: unknown, colorSteps: number | undefined, domain: readonly [number, number] | undefined): HexModel {
  const grid = hexGrid(size, box);
  const raw = hexBins(grid, xs, ys, box);
  let [lo, hi] = countRange(raw);
  if (domain && Number.isFinite(domain[0]) && Number.isFinite(domain[1]) && domain[1] >= domain[0]) [lo, hi] = domain;
  const scale = colorScaleOf(undefined, undefined, colorSteps ?? 5) as HexModel["scale"];
  const tOf = (n: number) => (hi > lo ? clamp((n - lo) / (hi - lo), 0, 1) : 1);
  // raw는 줄, 칸 순서라 색 단계 경로의 글이 같은 데이터면 늘 같아요
  const byStep = new Map<number, HexInfo[]>();
  const cells: HexInfo[] = raw.map((c) => {
    const cell = { ...c, t: tOf(c.count) };
    const k = scaleT(cell.t, scale);
    const list = byStep.get(k);
    if (list) list.push(cell);
    else byStep.set(k, [cell]);
    return cell;
  });
  cells.sort((a, b) => b.count - a.count || a.row - b.row || a.col - b.col);
  const gap = hexGap(grid.w);
  const groups = [...byStep.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => ({ t: list[0].t, d: hexPath(grid, list, gap) }));
  return { grid, cells, lo: Number.isFinite(lo) ? lo : 0, hi: Number.isFinite(hi) ? hi : 0, at: new Map(cells.map((c, k) => [`${c.col},${c.row}`, k])), scale, groups };
}

/** 칸이 덮는 [작은 값, 큰 값]: 화면 구간 [a, b]를 눈금의 화면 범위(축 범위) 안으로 자르고 눈금으로 되돌려요. 가장자리 칸도 축 밖 값(0 아래 등)을 말하지 않아요 */
function covered(s: LinearScale, a: number, b: number): [number, number] {
  const min = Math.min(s.range[0], s.range[1]);
  const max = Math.max(s.range[0], s.range[1]);
  const u = s.invert(clamp(a, min, max));
  const v = s.invert(clamp(b, min, max));
  return u <= v ? [u, v] : [v, u];
}

/** 범위 글자. 포맷을 정하지 않았으면 범위 폭에 맞는 소수 자리(유효 숫자 두세 자리)로 적고, 단위는 뒤 값에만 붙여요 */
function rangeText(text: typeof en, [lo, hi]: [number, number], locale: string, fmt: ValueFormatter | null, unit = ""): string {
  const span = hi - lo;
  const dec = span > 0 ? Math.max(0, Math.min(6, 1 - Math.floor(Math.log10(span)))) : 2;
  const f = fmt ?? ((v: number) => formatNumber(v, { locale, maximumFractionDigits: dec }));
  return text.range(f(lo), `${f(hi)}${unit}`);
}

/** y축 이름을 범례와 겹치지 않게 줄여요. 들어갈 자리가 없으면 빈 글자예요 */
function fitTitle(title: string, left: number, legendW: number, W: number): string {
  const room = W - legendW - 12 - left;
  return textWidth(title, 10.5) <= room ? title : room > 24 ? truncate(title, room, 10.5) : "";
}

/** 육각 밀도가 읽는 차트 프롭 */
interface HexProps {
  binSize?: number;
  colorSteps?: number;
  binDomain?: [number, number];
  binLegend?: boolean;
  xFormat?: unknown;
  format?: unknown;
  unit?: string;
  xLabel?: string;
  yLabel?: string;
}

/** PointChart의 그림 상태: 걸러 낸 행, 눈금, 그림 영역, 값 축 글자 폭, 차트 문맥(글, 포맷), x 포맷 */
interface HexFrame {
  raw: readonly { x: number; y: number }[];
  x: LinearScale;
  y: LinearScale;
  box: Box;
  left: number;
  c: { lang: ChartLang; locale: string; fmt: ValueFormatter; width: number };
  xFmt: ValueFormatter;
}

/**
 * 육각 밀도 한 그림의 모든 것: 칸 모형, 항목(점이 많은 칸부터), 툴팁, 낭독, 설명, 범례, y축 이름, 키보드와 포인터.
 * PointChart는 이것을 한 번 만들어 쓰기만 해서 버블 차트 번들이 거의 커지지 않아요
 */
function hexView<T>(props: HexProps, f: HexFrame) {
  const { raw, c } = f;
  const [xs, ys] = plotted(raw.length, (k) => raw[k].x, (k) => raw[k].y, f.x, f.y);
  const m = hexModel(xs, ys, f.box, props.binSize, props.colorSteps, props.binDomain);
  const t = TEXT[c.lang];
  const { locale } = c;
  // 포맷을 정했으면 그 포맷, 아니면 범위 폭에 맞춘 자릿수
  const xFmt = props.xFormat !== undefined ? f.xFmt : null;
  const yFmt = props.format !== undefined ? c.fmt : null;
  const texts = (k: number) => {
    const cell = m.cells[k];
    const { w, r } = m.grid;
    return {
      count: t.points(cell.count, formatNumber(cell.count, { locale, maximumFractionDigits: 0 })),
      x: rangeText(t, covered(f.x, cell.cx - w / 2, cell.cx + w / 2), locale, xFmt),
      y: rangeText(t, covered(f.y, cell.cy - r, cell.cy + r), locale, yFmt, props.unit),
    };
  };
  /** "658 points, Request size (KB) 270 to 280, Latency (ms) 520 to 545 ms": 툴팁처럼 축 이름(없으면 x, y)을 붙여요 */
  const say = (k: number | null) => {
    if (k === null || !m.cells[k]) return "";
    const tx = texts(k);
    return `${tx.count}, ${props.xLabel ?? "x"} ${tx.x}, ${props.yLabel ?? "y"} ${tx.y}`;
  };
  const events: ChartEvent<T>[] = lazyArray(m.cells.length, (k) => {
    const tx = texts(k);
    const cell = m.cells[k];
    return { datum: null as T, index: k, key: `${cell.col},${cell.row}`, label: `x ${tx.x}, y ${tx.y}`, value: cell.count, formatted: tx.count };
  });
  // 색 범례: 칸이 있고 점 수가 칸마다 다를 때만. y축 이름은 범례와 겹치지 않게 줄여요
  const labels: [string, string] = [formatNumber(m.lo, { locale }), formatNumber(m.hi, { locale })];
  const legend = props.binLegend !== false && m.cells.length && m.hi > m.lo ? { right: c.width, labels } : null;
  return {
    m,
    events,
    say,
    desc: m.cells.length ? t.desc(m.cells.length, say(0)) : "",
    legend,
    yTitle: props.yLabel && legend ? fitTitle(props.yLabel, f.left, scaleLegendWidth(m.scale.steps, labels), c.width) : props.yLabel,
    tip: (k: number | null): TooltipData | null => {
      if (k === null || !m.cells[k]) return null;
      const tx = texts(k);
      return { x: m.cells[k].cx, y: m.cells[k].cy - m.grid.r, title: tx.count, rows: [{ label: props.xLabel ?? "x", value: tx.x }, { label: props.yLabel ?? "y", value: tx.y }] };
    },
    /** 포인터 자리의 칸 (그림 영역 밖이나 빈 칸이면 null) */
    at: (px: number, py: number): number | null => {
      const { box } = f;
      if (!(px >= box.x0 && px <= box.x1 && py >= box.y0 && py <= box.y1)) return null;
      const [i, j] = hexOf(m.grid, px, py);
      return m.at.get(`${i},${j}`) ?? null;
    },
    /** 화살표 방향(arrowStep)이 갈 칸: 처음은 가장 촘촘한 칸, 그다음은 그 방향 이웃 칸(빈 칸은 건너뛰어요). 화살표가 아니면 null, 갈 곳이 없으면 -1 */
    step: (dir: readonly [number, number] | null, active: number | null): number | null => {
      if (!dir || !m.cells.length) return null;
      return active === null || !m.cells[active] ? 0 : hexNeighbor(m.cells, active, dir);
    },
  };
}

export type HexView = ReturnType<typeof hexView>;

/**
 * 칸 그림: 그림 영역으로 자른 색 단계 경로들, 고른 칸 테두리, 위쪽 색 범례. 등장은 옅은 단계부터 차례로 나타나요(CSS).
 * 동작 줄이기와 서버 그림을 이어받은 첫 그림은 끝 모습이에요
 */
function HexLayer(props: { p: Painter; v: HexView; box: Box; active: number | null; c: { motion: { enabled: boolean }; hydrated: boolean }; m: { waiting: boolean; generation: number }; onPick: (k: number) => void }) {
  const { p, box, active } = props;
  const { m, legend } = props.v;
  const id = `${useId().replace(/:/g, "")}hx`;
  const enabled = useCssEntrance(props.c, props.m);
  const { scale } = m;
  const a = active !== null ? m.cells[active] : undefined;
  const aSw = a ? scaleSwatch(p, a.t, MIN_OPACITY, scale) : null;
  return (
    <>
      <defs>
        <clipPath id={id}>
          <rect x={box.x0} y={box.y0} width={Math.max(0, box.x1 - box.x0)} height={Math.max(0, box.y1 - box.y0)} />
        </clipPath>
      </defs>
      <g key={props.m.generation} clipPath={`url(#${id})`} onClick={() => active !== null && props.onPick(active)}>
        {m.groups.map((g, gi) => {
          const s = scaleSwatch(p, g.t, MIN_OPACITY, scale);
          return <path key={gi} className="ztd-mark" d={g.d} fill={s.fill} opacity={s.opacity * (a ? 0.55 : 1)} style={cssEntrance(enabled, props.m.waiting, "fade", gi * 70, 360)} />;
        })}
        {a && aSw ? <path d={hexPath(m.grid, [a], hexGap(m.grid.w))} fill={aSw.fill} fillOpacity={aSw.opacity} stroke={p.paint("ink")} strokeWidth={2} strokeLinejoin="round" pointerEvents="none" /> : null}
      </g>
      {legend ? <ScaleLegend p={p} right={legend.right} steps={scale.steps} scale={scale} labels={legend.labels} min={MIN_OPACITY} /> : null}
    </>
  );
}

/** 작은 여러 개 전체의 색 범례 하나 (FacetPlan.legend). 서버 SVG가 class로 찾아 옮겨요 */
function FacetLegend({ steps, labels }: { steps: number; labels: [string, string] }) {
  const p = useChartTheme();
  const w = Math.ceil(scaleLegendWidth(steps, labels)) + 8;
  return (
    <svg className="ztd-facet-legend" width={w} height={16} viewBox={`0 0 ${w} 16`} overflow="visible">
      <ScaleLegend p={p} right={w} steps={steps} scale={colorScaleOf(undefined, undefined, steps)} labels={labels} min={MIN_OPACITY} />
    </svg>
  );
}

/**
 * 작은 여러 개(ChartFacets)의 같은 색 척도: 같은 값 축이면 패널마다 차트와 같은 그림 영역에서 칸을 세어 모든 패널의 [가장 적은, 가장 많은] 점 수를
 * 패널 프롭 binDomain으로 넘기고, 색 범례는 패널마다가 아니라 묶음 위에 한 번(FacetPlan.legend) 그려요. 그래서 같은 색이 어느 패널에서나 같은 점 수예요.
 * 육각 밀도가 아니거나 패널마다 축이 다르면(scale "free") 그대로 돌려줘서 패널마다 자기 범례예요
 */
export function hexFacetPlan(plan: FacetPlan, cp: Record<string, unknown>, locale: string): FacetPlan {
  const first = plan.panels[0]?.props;
  const dx = first?.xDomain as [number, number] | undefined;
  const dy = first?.yDomain as [number, number] | undefined;
  if (cp.bin !== "hex" || !dx || !dy) return plan;
  const isLog = cp.yScale === "log";
  const { pw, ph } = plan;
  // PointChart와 같은 자리: 범례가 패널 밖이라 위는 보통 산점도(y축 이름이 있으면 20, 없으면 10), 아래 x축 글자 줄, 축 범위 안쪽 여유, 왼쪽은 값 축 글자 폭(그 글자가 있는 패널만)
  const top = cp.yLabel ? HEX_TOP : 10;
  const y = (isLog ? scaleLog : scaleLinear)(dy, [ph - PLOT_BOTTOM - DOT_PAD, top + DOT_PAD]);
  const axisW = yAxisWidth(y.ticks(Math.max(2, Math.round(ph / 70))), makeTickFormatter(cp.format as FormatSpec | undefined, locale, Math.max(Math.abs(dy[0]), Math.abs(dy[1]))), locale);
  const gx = numGetter<Record<string, unknown>>(cp.x as string | undefined, "x");
  const gy = numGetter<Record<string, unknown>>(cp.y as string | undefined, "y");
  let lo = Infinity;
  let hi = -Infinity;
  for (const pn of plan.panels) {
    const rows = pn.props.data as Record<string, unknown>[];
    const left = pn.props.showYAxis === false ? 0 : axisW;
    const x = scaleLinear(dx, [left + 6 + DOT_PAD, pw - 8 - DOT_PAD]);
    const [xs, ys] = plotted(rows.length, (k) => gx(rows[k], k), (k) => gy(rows[k], k), x, y);
    const box = { x0: left, x1: pw, y0: top, y1: ph - PLOT_BOTTOM };
    [lo, hi] = countRange(hexBins(hexGrid(cp.binSize, box), xs, ys, box), lo, hi);
  }
  const panels = plan.panels.map((pn) => ({ ...pn, props: { ...pn.props, binLegend: false, ...(hi >= lo && { binDomain: [lo, hi] }) } }));
  const steps = colorScaleOf(undefined, undefined, (cp.colorSteps as number | undefined) ?? 5).steps ?? 5;
  const legend = hi > lo ? <FacetLegend steps={steps} labels={[formatNumber(lo, { locale }), formatNumber(hi, { locale })]} /> : undefined;
  return { ...plan, panels, legend };
}

/** PointChart가 받는 육각 밀도 묶음 */
export const HEX_KIT = { view: hexView, Layer: HexLayer };
