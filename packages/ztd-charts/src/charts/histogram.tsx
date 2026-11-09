import { useMemo, type ReactNode } from "react";
import { AXIS_FONT, GridY, fitTickLabels, yAxisWidth } from "../core/axis";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { formatPercent, makeTickFormatter } from "../core/format";
import { linePath, r2, roundRectPath } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { extent, fitDomain, scaleLinear, ticksFor } from "../core/scale";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData, TooltipRow } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter } from "../data/accessor";
import { markPercentile, percentile } from "../data/percentile";
import { binCounts, binEdges, binIndex, decadeGrid, dotUnit, HISTOGRAM_MAX_GROUPS, isPreBinned, kde } from "../layout/stats";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Histogram",
  count: "Count",
  cum: "Cumulative",
  range: (a: string, b: string) => `${a} to ${b}`,
  inBin: (n: number, share: string) => `${n} · ${share}`,
  row: (n: number, share: string) => `${n} (${share})`,
  rowCum: (cum: string) => `cumulative ${cum}`,
  samples: (n: number) => plural(n, "sample"),
  median: (v: string) => `median ${v}`,
  about: (v: string) => `about ${v}`,
  peak: (range: string, n: number) => `the tallest bin is ${range} (${n})`,
  past: (count: string, above: boolean, value: string, label: string, share: string) => `${count} ${above ? "above" : "below"} ${label ? `the ${label} of ${value}` : value} (${share})`,
  outside: (n: number) => `${n} outside the edges`,
  excluded: (n: number) => `${n} at or below 0 left out`,
  dot: (n: number) => `1 dot = ${plural(n, "sample")}`,
  groups: (n: number) => plural(n, "group"),
  hidden: (drawn: number, all: number) => `Only the first ${drawn} of ${all} groups are drawn`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "히스토그램",
    count: "건수",
    cum: "누적",
    range: (a, b) => `${a} ~ ${b}`,
    inBin: (n, share) => `${n}건 · ${share}`,
    row: (n, share) => `${n}건(${share})`,
    rowCum: (cum) => `누적 ${cum}`,
    samples: (n) => `표본 ${n}개`,
    median: (v) => `중앙값 ${v}`,
    about: (v) => `약 ${v}`,
    peak: (range, n) => `가장 많은 구간 ${range}(${n}건)`,
    past: (count, above, value, label, share) => `${label ? `${label} ` : ""}${value} ${above ? "넘음" : "미만"} ${count}건(${share})`,
    outside: (n) => `범위 밖 ${n}개`,
    excluded: (n) => `0 이하 ${n}개 제외`,
    dot: (n) => `점 하나 = ${n}건`,
    groups: (n) => `그룹 ${n}개`,
    hidden: (drawn, all) => `그룹 ${all}개 중 앞의 ${drawn}개만 그려요`,
  },
};

/** 기준선. side는 나쁜 쪽이에요: "above"면 기준보다 큰 값, "below"면 작은 값 */
export interface HistogramThreshold {
  value: number;
  label?: string;
  /** 기본 "above" */
  side?: "above" | "below";
}

export interface HistogramChartProps<T = Row> extends BaseChartProps<T> {
  /** 표본 값 필드. 기본 "value" */
  value?: Accessor<T, number>;
  /** 그룹 필드. 두 그룹까지 같은 경계로 겹쳐 그려요(강조 그룹은 윤곽, 나머지는 회색 채움) */
  group?: Accessor<T, string>;
  /** 미리 나눈 행의 구간 시작, 끝, 개수 필드. count를 주거나, value 없이 행에 x0, x1, count 필드가 있으면 이 꼴로 읽어요 */
  x0?: Accessor<T, number>;
  x1?: Accessor<T, number>;
  count?: Accessor<T, number>;
  /** "bars" | "dots" | "step". dots는 점 하나가 N건, step은 겹쳐 보기 좋은 윤곽이에요. 기본 "bars" */
  variant?: "bars" | "dots" | "step";
  /** 분위 선. 기본 ["p50", "p95"]. p50은 실선, 나머지는 점선이에요. 미리 나눈 행이면 구간 안을 나눠 어림해요 */
  marks?: readonly string[];
  /** 기준선. 나쁜 쪽 구간이 강조색이고 설명에 넘은 표본 수와 비율을 적어요 */
  threshold?: HistogramThreshold;
  /** 구간 경계(작은 것부터). 밖의 표본은 그리지 않고 세어서 알려요. 정하는 순서는 edges → binWidth → bins → 자동이에요 */
  edges?: readonly number[];
  /** 구간 폭. 경계는 폭의 배수예요(log면 쓰지 않아요) */
  binWidth?: number;
  /** 대략의 구간 수. 폭은 읽기 쉬운 값으로 맞춰요 */
  bins?: number;
  /** 로그 구간과 로그 축. 0 이하 값은 빼고 설명에 적어요. 기본 false */
  log?: boolean;
  /** 밀도 곡선(KDE)을 얹어요. 원시 행에서만 그려요. 기본 false */
  kde?: boolean;
  /**
   * 강조. 그룹이 없으면 구간(인덱스, "max" 등), 있으면 그룹 이름. 판별 함수는 행을 받고 그 행이 든 구간(그룹)을 강조해요.
   * 기본은 가장 높은 구간, 그룹이 있으면 첫 그룹. threshold가 있으면 기준을 넘은 구간이 강조예요
   */
  highlight?: BaseChartProps<T>["highlight"];
}

/** 구간 하나. counts는 그리는 그룹마다 개수예요 */
interface Bin {
  i: number;
  x0: number;
  x1: number;
  counts: number[];
}

/** 그리는 그룹 하나 */
interface Sample {
  name: string;
  /** 분석한 표본 수(구간 안 + 범위 밖). 0 이하라 뺀 값은 들어가지 않아요 */
  n: number;
  /** 원시 행의 값. 미리 나눈 행이면 비어 있어요 */
  values: number[];
  outside: number;
  excluded: number;
}

interface Model {
  bins: Bin[];
  samples: Sample[];
  /** 데이터의 그룹 수. 그리는 건 앞의 HISTOGRAM_MAX_GROUPS개예요 */
  groupCount: number;
  binned: boolean;
  /** 판별 함수 highlight에 걸린 구간(그룹이 하나일 때)과 그룹(없으면 -1) */
  fnBins: Set<number>;
  fnGroup: number;
}

const same = (v: number) => v;
const DEFAULT_MARKS: readonly string[] = ["p50", "p95"];
const TAG_FONT = 10;
const TAG_H = 15;
const HEAD_H = 16;
const KDE_SAMPLES = 96;

/** 분위 선 모양: p50 실선, p99 촘촘한 점선, 나머지 점선 */
const dashOf = (id: string) => (id === "p50" ? undefined : id === "p99" ? "1.5 2.5" : "4 3");

/** 원시 행을 그룹마다 값으로 모아 한 번 정한 경계로 세요 */
function rawModel<T>(data: readonly T[], value: Accessor<T, number> | undefined, group: Accessor<T, string> | undefined, fn: ((d: T, i: number) => boolean) | null, opts: { edges?: readonly number[]; binWidth?: number; bins?: number; log: boolean }): Model {
  const gv = numGetter(value, "value");
  const gg = group ? strGetter(group, "group") : () => "";
  const by = new Map<string, { values: number[]; excluded: number }>();
  const picked: { g: string; v: number }[] = [];
  data.forEach((d, i) => {
    const v = gv(d, i);
    if (!Number.isFinite(v)) return;
    const g = gg(d, i);
    let s = by.get(g);
    if (!s) by.set(g, (s = { values: [], excluded: 0 }));
    if (opts.log && v <= 0) s.excluded++;
    else {
      s.values.push(v);
      if (fn?.(d, i)) picked.push({ g, v });
    }
  });
  const names = [...by.keys()].slice(0, HISTOGRAM_MAX_GROUPS);
  // 두 그룹은 경계를 함께 써요 (그리는 그룹의 값 전체로 한 번 나눠요). 표본이 없으면 edges를 줘도 구간이 없어요(빈 상태)
  const edges = names.length ? binEdges(names.flatMap((g) => by.get(g)!.values), opts) : [];
  const counted = names.map((g) => binCounts(by.get(g)!.values, edges));
  const bins = edges.slice(1).map((x1, i) => ({ i, x0: edges[i], x1, counts: counted.map((c) => c.counts[i]) }));
  const samples = names.map((name, k) => ({ name, n: by.get(name)!.values.length, values: by.get(name)!.values, outside: counted[k].outside, excluded: by.get(name)!.excluded }));
  return {
    bins,
    samples,
    groupCount: by.size,
    binned: false,
    fnBins: new Set(picked.map((p) => binIndex(edges, p.v)).filter((k) => k >= 0)),
    fnGroup: picked.map((p) => names.indexOf(p.g)).find((k) => k >= 0) ?? -1,
  };
}

/** 미리 나눈 행 { x0, x1, count }. 같은 구간은 더하고, 행 사이가 비면 빈 구간으로 채워요(빈 곳도 키보드와 표가 읽어요) */
function binnedModel<T>(data: readonly T[], acc: { x0?: Accessor<T, number>; x1?: Accessor<T, number>; count?: Accessor<T, number>; group?: Accessor<T, string> }, fn: ((d: T, i: number) => boolean) | null, log: boolean): Model {
  const g0 = numGetter(acc.x0, "x0");
  const g1 = numGetter(acc.x1, "x1");
  const gc = numGetter(acc.count, "count");
  const gg = acc.group ? strGetter(acc.group, "group") : () => "";
  const excluded = new Map<string, number>();
  // picked: 판별 함수 highlight에 걸린 행의 그룹
  const cells = new Map<string, { x0: number; x1: number; by: Map<string, number>; picked: Set<string> }>();
  data.forEach((d, i) => {
    const x0 = g0(d, i);
    const x1 = g1(d, i);
    const n = gc(d, i);
    // 무한대 개수나 끝은 그릴 수 없는 행이라 빼요 (점 그림이 끝없이 늘어나지 않게)
    if (!(Number.isFinite(x0) && Number.isFinite(x1) && x1 > x0 && Number.isFinite(n) && n >= 0)) return;
    const g = gg(d, i);
    excluded.set(g, excluded.get(g) ?? 0);
    if (log && x0 <= 0) {
      excluded.set(g, excluded.get(g)! + n);
      return;
    }
    const key = `${x0}|${x1}`;
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { x0, x1, by: new Map(), picked: new Set() }));
    cell.by.set(g, (cell.by.get(g) ?? 0) + n);
    if (fn?.(d, i)) cell.picked.add(g);
  });
  const names = [...excluded.keys()].slice(0, HISTOGRAM_MAX_GROUPS);
  const bins: Bin[] = [];
  const fnBins = new Set<number>();
  for (const cell of [...cells.values()].sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1)) {
    const last = bins[bins.length - 1];
    if (last && cell.x0 > last.x1) bins.push({ i: bins.length, x0: last.x1, x1: cell.x0, counts: names.map(() => 0) });
    if (cell.picked.size) fnBins.add(bins.length);
    bins.push({ i: bins.length, x0: cell.x0, x1: cell.x1, counts: names.map((g) => cell.by.get(g) ?? 0) });
  }
  const samples = names.map((name, k) => ({ name, n: bins.reduce((s, b) => s + b.counts[k], 0), values: [], outside: 0, excluded: excluded.get(name)! }));
  const fnGroup = names.findIndex((g) => [...cells.values()].some((c) => c.picked.has(g)));
  return { bins, samples, groupCount: excluded.size, binned: true, fnBins, fnGroup };
}

/** 분위(0~100). 원시 행은 percentile과 같은 값이고, 미리 나눈 행은 구간 안을 선형(log면 로그)으로 나눠 어림해요 */
function quantileOf(model: Model, k: number, p: number, log: boolean): number {
  const s = model.samples[k];
  if (!model.binned) return percentile(s.values, p);
  const target = (p / 100) * s.n;
  let acc = 0;
  for (const b of model.bins) {
    const c = b.counts[k];
    if (c > 0 && acc + c >= target) {
      const f = (target - acc) / c;
      return log ? 10 ** (Math.log10(b.x0) + f * (Math.log10(b.x1) - Math.log10(b.x0))) : b.x0 + f * (b.x1 - b.x0);
    }
    acc += c;
  }
  return NaN;
}

/** 구간 폭 가운데 기준을 넘은 몫(0~1, 축 단위) */
function pastShare(b: Bin, t: HistogramThreshold, log: boolean): number {
  const f = log ? Math.log10 : same;
  if (log && t.value <= 0) return t.side === "below" ? 0 : 1;
  const k = (f(t.value) - f(b.x0)) / (f(b.x1) - f(b.x0));
  return Math.max(0, Math.min(1, t.side === "below" ? k : 1 - k));
}

/** 기준을 넘은 표본 수. 원시 행은 정확히 세고, 미리 나눈 행은 기준이 걸친 구간을 비율로 나눠 어림해요(est) */
function pastCount(model: Model, k: number, t: HistogramThreshold, log: boolean): { n: number; est: boolean } {
  const above = t.side !== "below";
  const s = model.samples[k];
  if (!model.binned) return { n: s.values.filter((v) => (above ? v > t.value : v < t.value)).length, est: false };
  let n = 0;
  let est = false;
  for (const b of model.bins) {
    const share = pastShare(b, t, log);
    n += b.counts[k] * share;
    if (share > 0 && share < 1 && b.counts[k] > 0) est = true;
  }
  return { n: Math.round(n), est };
}

/**
 * 구간 윗변을 잇는 계단 윤곽(ex는 경계 픽셀, tops는 구간마다 윗변 픽셀). [a, b] 밖은 잘라요(강조 구간만 다시 그릴 때).
 * 끝에서는 이웃이 더 낮을 때만 내려가요. 그래서 다시 그린 강조 구간이 이웃 구간의 옆선을 칠하지 않아요
 */
function stepPath(ex: readonly number[], tops: readonly number[], base: number, a = -Infinity, b = Infinity): string {
  const n = tops.length;
  const inside = (i: number) => Math.min(ex[i + 1], b) > Math.max(ex[i], a);
  let d = "";
  for (let i = 0; i < n; i++) {
    if (!inside(i)) continue;
    let j = i;
    while (j + 1 < n && inside(j + 1)) j++;
    const l = Math.max(ex[i], a);
    const r = Math.min(ex[j + 1], b);
    d += `M${r2(l)},${r2(l === ex[i] ? Math.max(i ? tops[i - 1] : base, tops[i]) : tops[i])}V${r2(tops[i])}`;
    for (let k = i; k < j; k++) d += `H${r2(ex[k + 1])}V${r2(tops[k + 1])}`;
    d += `H${r2(r)}`;
    if (r === ex[j + 1]) d += `V${r2(Math.max(j + 1 < n ? tops[j + 1] : base, tops[j]))}`;
    i = j;
  }
  return d;
}

/** 이어진 인덱스를 [첫, 끝] 묶음으로 */
function runs(idx: ReadonlySet<number>, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (!idx.has(i)) continue;
    let j = i;
    while (idx.has(j + 1)) j++;
    out.push([i, j]);
    i = j;
  }
  return out;
}

interface Tag {
  key: string;
  /** 선 자리 */
  at: number;
  /** 이름표 가운데 (차트 안에 가둔 자리) */
  x: number;
  w: number;
  row: number;
  text: string;
  fill: string;
  stroke: string;
  dash?: string;
}

/**
 * 선 이름표가 겹치지 않게 놓아요. 이름표마다 자리 후보(선 가운데, 선 오른쪽, 선 왼쪽)를 순서대로 놓아 보고 안 되면 다음 줄이에요.
 * 가운데 먼저, 왼쪽 먼저 두 순서로 놓아 보고 줄이 적은 쪽을 써요(같으면 가운데 먼저). 이름표는 [lo, hi] 안에 가둬요
 */
function placeTags(tags: Omit<Tag, "x" | "w" | "row">[], lo: number, hi: number): Tag[] {
  const sorted = [...tags].sort((a, b) => a.at - b.at);
  const place = (order: number[]) => {
    const rows: [number, number][][] = [];
    return sorted.map((t) => {
      const w = textWidth(t.text, TAG_FONT, 700) + 10;
      const spots = [t.at, t.at + w / 2 - 4, t.at - w / 2 + 4].map((x) => Math.max(lo + w / 2, Math.min(hi - w / 2, x)));
      for (let row = 0; ; row++) {
        const used = (rows[row] ??= []);
        const x = order.map((k) => spots[k]).find((s) => used.every(([a, b]) => s + w / 2 + 4 <= a || s - w / 2 - 4 >= b));
        if (x === undefined) continue;
        used.push([x - w / 2, x + w / 2]);
        return { ...t, x, w, row };
      }
    });
  };
  const rowsOf = (list: Tag[]) => Math.max(0, ...list.map((t) => t.row));
  const centered = place([0, 1, 2]);
  const leftFirst = place([2, 0, 1]);
  return rowsOf(leftFirst) < rowsOf(centered) ? leftFirst : centered;
}

/** 값 축 눈금: 폭에 맞춘 개수로 시작해서 구간 안에 눈금이 셋 이상 들어갈 때까지 늘려요 */
function linearTicks(lo: number, hi: number, count: number): number[] {
  let out: number[] = [];
  for (let k = Math.max(2, count); k <= Math.max(2, count) + 4 && out.length < 3; k++) out = ticksFor(lo, hi, k).filter((t) => t >= lo - 1e-9 && t <= hi + 1e-9);
  return out;
}

/** 로그 축 눈금: 한 자리(10배)가 110px 이상이면 1·2·5, 좁으면 10배마다. 눈금이 둘이 안 되면 1~9 */
function logTicks(lo: number, hi: number, pxPerDecade: number): number[] {
  const pick = (steps: number[]) => decadeGrid(lo, hi, steps).filter((v) => v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9));
  const ticks = pick(pxPerDecade >= 110 ? [1, 2, 5] : [1]);
  return ticks.length >= 2 ? ticks : pick([1, 2, 3, 4, 5, 6, 7, 8, 9]);
}


/** 히스토그램: 원시 표본이 어디에 몰렸는지와 꼬리, 분위 선, 기준 초과 */
export function HistogramChart<T = Row>(props: HistogramChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(230, Math.min(310, w * 0.55)), duration: 800 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];
  const fv = c.fv;
  const log = props.log === true;
  const variant = props.variant ?? "bars";
  const th = props.threshold && Number.isFinite(props.threshold.value) ? props.threshold : undefined;
  const thValue = th?.value;
  const thSide = th?.side;
  const above = thSide !== "below";
  // 배열을 그때그때 새로 넘겨도 값이 같으면 다시 계산하지 않게 글자로 비교해요
  const edgesKey = props.edges?.join(",");
  const marksKey = (props.marks ?? DEFAULT_MARKS).filter((id) => Number.isFinite(markPercentile(id))).join(",");
  const fn = typeof props.highlight === "function" ? props.highlight : null;
  const hl = typeof props.highlight === "function" ? undefined : props.highlight;

  const { data, value, group, x0, x1, count, binWidth, bins: binCount } = props;
  const model = useMemo(() => {
    const first = data.find((d): d is T & object => d !== null && typeof d === "object");
    if (isPreBinned(first, value, count)) return binnedModel(data, { x0, x1, count, group }, fn, log);
    const edges = edgesKey ? edgesKey.split(",").map(Number) : undefined;
    return rawModel(data, value, group, fn, { edges, binWidth, bins: binCount, log });
  }, [data, value, group, x0, x1, count, edgesKey, binWidth, binCount, log, fn]);
  const { bins, samples } = model;
  const n = bins.length;
  const grouped = samples.length > 1;

  // 분위는 데이터가 바뀔 때만, 기준을 넘은 수는 기준이 바뀔 때도 다시 세요 (분위마다 정렬하니 기준만 바꿀 때 다시 정렬하지 않게)
  const quantiles = useMemo(
    () =>
      model.samples.map((_, k) => {
        const marks = marksKey ? marksKey.split(",").map((id) => ({ id, v: quantileOf(model, k, markPercentile(id), log) })) : [];
        return { median: marks.find((mk) => mk.id === "p50")?.v ?? quantileOf(model, k, 50, log), marks };
      }),
    [model, marksKey, log],
  );
  const past = useMemo(() => (thValue === undefined ? [] : model.samples.map((_, k) => pastCount(model, k, { value: thValue, side: thSide }, log))), [model, thValue, thSide, log]);

  // 값 축 범위: 첫 구간 시작부터 마지막 구간 끝까지 (구간이 없으면 [0, 1])
  const [lo, hi] = useMemo(() => extent(model.bins.flatMap((b) => [b.x0, b.x1])), [model]);
  // 밀도 곡선을 개수 단위로: 밀도 × 표본 수 × 평균 구간 폭(축 단위). 구간 폭이 같으면 막대 높이와 맞아요
  const showKde = props.kde === true && !model.binned;
  const density = useMemo(() => {
    if (!showKde || !model.bins.length) return null;
    const tf = log ? Math.log10 : same;
    const [a, z] = [tf(lo), tf(hi)];
    const xs = Array.from({ length: KDE_SAMPLES }, (_, k) => a + ((z - a) * k) / (KDE_SAMPLES - 1));
    const w = (z - a) / model.bins.length;
    return { xs, curves: model.samples.map((s) => kde(s.values.map(tf), xs).map((d) => d * s.n * w)) };
  }, [showKde, model, log, lo, hi]);

  // 강조: 그룹이 있으면 그룹 하나(기본 첫 그룹), 없으면 구간(기본 가장 높은 구간). 기준선이 있으면 기준을 넘은 쪽이 강조예요
  const names = samples.map((s) => s.name);
  const hiGroup = !grouped ? -1 : fn ? model.fnGroup : ([...resolveHighlight(hl, names, names, samples.map((s) => s.n), "first")][0] ?? -1);
  const counts0 = bins.map((b) => b.counts[0]);
  const range = (b: Bin) => msg.range(fv(b.x0), fv(b.x1));
  const hiBins = grouped || th ? new Set<number>() : fn ? model.fnBins : resolveHighlight(hl, bins, bins.map(range), counts0, "max");
  // 회색으로 채우는 그룹과 윤곽으로 그리는 그룹 (그룹이 없으면 step만 윤곽)
  const fillK = grouped && hiGroup === 0 ? 1 : 0;
  const lineK = grouped ? 1 - fillK : 0;
  const dots = variant === "dots" && !grouped;
  const step = variant === "step";

  // 축
  const T = log ? Math.log10 : same;
  const maxCount = Math.max(0, ...bins.flatMap((b) => b.counts));
  const tickCount = Math.max(2, Math.round(H / 70));
  const dom = fitDomain(0, Math.max(1, maxCount, ...(density?.curves.flat() ?? [])), tickCount);
  const yTicks = scaleLinear(dom, [0, 1])
    .ticks(tickCount)
    .filter((t) => Number.isInteger(t));
  const yFmt = makeTickFormatter(undefined, c.locale, dom[1]);
  const left = dots ? 8 : yAxisWidth(yTicks, yFmt, c.locale);
  const xl = left + 2;
  const xr = W - 10;
  const sx = scaleLinear([T(lo), T(hi)], [xl, xr]);
  const X = (v: number) => sx(T(v));
  const inDomain = (v: number) => Number.isFinite(v) && v >= lo && v <= hi && (!log || v > 0);

  // 위쪽: 알림 줄(범위 밖, 제외, 점 범례)과 선 이름표 줄
  const outside = samples.reduce((s, x) => s + x.outside, 0);
  const excluded = samples.reduce((s, x) => s + x.excluded, 0);
  const note = [outside ? msg.outside(outside) : "", excluded ? msg.excluded(excluded) : ""].filter(Boolean).join(" · ");
  const tagK = Math.max(0, hiGroup);
  const tags = c.pending || !n
    ? []
    : placeTags(
        [
          ...(quantiles[tagK]?.marks ?? []).filter((mk) => inDomain(mk.v)).map((mk) => ({ key: mk.id, at: X(mk.v), text: `${mk.id} ${fv(mk.v)}`, fill: p.paint(grouped ? "accentText" : "ink"), stroke: p.paint(grouped ? "accent" : "ink"), dash: dashOf(mk.id) })),
          ...(th && inDomain(th.value) ? [{ key: "threshold", at: X(th.value), text: th.label ? `${th.label} ${fv(th.value)}` : fv(th.value), fill: p.paint(grouped ? "ink" : "accentText"), stroke: p.paint(grouped ? "ink" : "accent") }] : []),
        ],
        // 이름표 줄은 그림 위라 축 글자가 없어요. 차트 폭을 다 써요
        4,
        W - 4,
      );
  const rows = c.showLabels ? Math.max(0, ...tags.map((t) => t.row + 1)) : 0;
  const head = note || dots ? HEAD_H : 0;
  const tagY = (row: number) => 6 + head + row * (TAG_H + 3);
  // 맨 위 눈금 글자가 마지막 이름표 줄에 닿지 않게 4px 띄워요
  const top = tagY(rows) + (rows ? 4 : 0);
  const base = H - 22;

  // 점 그림: 묶음 크기 N은 읽을 수 있는 가장 작은 점(반지름 2.5)으로도 가장 높은 열이 들어가는 1, 2, 5, 10 … 가운데 가장 작은 값.
  // 점은 그 높이를 채우도록 키우되 가장 좁은 구간 폭을 넘지 않아요
  const minPx = n ? Math.min(...bins.map((b) => X(b.x1) - X(b.x0))) : 10;
  const rMax = Math.max(1.5, Math.min(6, minPx / 2 - 1));
  const rMin = Math.min(rMax, 2.5);
  const unit = dots ? dotUnit(maxCount, (base - top) / (rMin * 2 + 1.5)) : 1;
  const rad = Math.max(rMin, Math.min(rMax, ((base - top) / Math.max(1, Math.ceil(maxCount / unit)) - 1.5) / 2));
  const pitch = rad * 2 + 1.5;
  const y = dots ? (v: number) => base - (v / unit) * pitch : scaleLinear(dom, [base, top]);

  const stg = props.stagger ?? Math.min(28, 520 / Math.max(1, n));
  const marks = useMemo<Mark<{ k: number; i: number }>[]>(() => {
    const out: Mark<{ k: number; i: number }>[] = [];
    // 막대(그룹이 있으면 회색으로 채우는 그룹)나 점 기둥. 점 기둥은 0에서 1로 차오르는 진행률이에요
    if (!step) for (const b of bins) out.push({ key: `${dots ? "d" : "b"}${b.i}`, to: [dots ? 1 : y(b.counts[fillK])], from: [dots ? 0 : base], enter: [dots ? 0 : base], delay: b.i * stg, data: { k: fillK, i: b.i } });
    const outlines = grouped ? (step ? [fillK, lineK] : [lineK]) : step ? [0] : [];
    for (const k of outlines) out.push({ key: `s${k}`, to: bins.map((b) => y(b.counts[k])), from: bins.map(() => base), enter: bins.map(() => base), delay: k === lineK ? 120 : 0, data: { k, i: -1 } });
    return out;
    // y와 bins는 아래 값들로 정해져요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, W, H, top, unit, dots, step, grouped, fillK, lineK, stg, dom[1]]);
  const m = useMotion(marks, c.motion);

  // 접근성: 구간마다 이벤트 하나 (빈 구간도). 툴팁, 라이브 영역, 표가 같은 순서로 그룹을 읽어요
  const share = (v: number) => formatPercent(v, { locale: c.locale, maximumFractionDigits: 1 });
  const ofN = (k: number, v: number) => (samples[k].n ? (v / samples[k].n) * 100 : 0);
  // 그룹마다 구간까지의 누적 개수
  const cums = samples.map((_, k) => {
    let acc = 0;
    return bins.map((b) => (acc += b.counts[k]));
  });
  const events: ChartEvent<T>[] = bins.map((b) => {
    const parts = samples.map((s, k) => {
      const r = msg.row(b.counts[k], share(ofN(k, b.counts[k])));
      return grouped ? `${s.name} ${r}` : `${r}, ${msg.rowCum(share(ofN(k, cums[k][b.i])))}`;
    });
    return { datum: null, index: b.i, key: `b${b.i}`, label: range(b), value: b.counts.reduce((a, v) => a + v, 0), formatted: parts.join(", ") };
  });

  const accent = p.paint("accent");
  /** 그룹이 없을 때 구간의 칠: 강조 구간, 또는 기준을 절반 넘게 넘은 구간이 accent */
  const isHot = (b: Bin) => hiBins.has(b.i) || (th !== undefined && pastShare(b, th, log) >= 0.5);
  const groupColor = (k: number) => (k === hiGroup ? accent : p.paint(k === fillK && !step ? "neutral" : "neutralStrong"));
  let tip: TooltipData | null = null;
  if (c.active !== null && bins[c.active]) {
    const b = bins[c.active];
    const tallest = Math.max(...b.counts);
    const rowsOf = (k: number): TooltipRow[] => {
      const v = msg.inBin(b.counts[k], share(ofN(k, b.counts[k])));
      const cum = { label: msg.cum, value: share(ofN(k, cums[k][b.i])), strong: false };
      if (grouped) return [{ label: samples[k].name, value: v, color: groupColor(k), strong: k === hiGroup }, cum];
      return [{ label: msg.count, value: v, color: isHot(b) ? accent : p.paint(dots || step ? "neutralStrong" : "neutral"), strong: true }, cum];
    };
    tip = { x: (X(b.x0) + X(b.x1)) / 2, y: dots ? base - Math.ceil(tallest / unit) * pitch : y(tallest), title: range(b), rows: samples.flatMap((_, k) => rowsOf(k)) };
  }

  /** 그룹 하나의 설명 조각: 표본 수, 중앙값, 분위, 기준을 넘은 수 */
  const sampleText = (k: number): string[] => {
    const s = samples[k];
    const qs = quantiles[k];
    const pk = past[k];
    const q = (v: number) => (model.binned ? msg.about(fv(v)) : fv(v));
    const out = [msg.samples(s.n), msg.median(q(qs.median)), ...qs.marks.filter((mk) => mk.id !== "p50").map((mk) => `${mk.id} ${q(mk.v)}`)];
    if (!grouped && maxCount) out.push(msg.peak(range(bins[counts0.indexOf(maxCount)]), maxCount));
    if (pk && th) out.push(msg.past(pk.est ? msg.about(`${pk.n}`) : `${pk.n}`, above, fv(th.value), th.label ?? "", share(ofN(k, pk.n))));
    return out;
  };
  const extra = [note, dots ? msg.dot(unit) : ""].filter(Boolean);
  const hidden = model.groupCount > samples.length ? ` ${msg.hidden(samples.length, model.groupCount)}.` : "";
  // 구간이 없으면 이벤트도 없어서 ChartFrame이 빈 상태 문장으로 바꿔 읽어요. 그래서 설명을 만들지 않아요
  const auto = !n
    ? ""
    : grouped
      ? `${msg.kind}, ${msg.groups(samples.length)}. ${samples.map((s, k) => `${s.name}: ${sampleText(k).join(", ")}`).join("; ")}${extra.length ? `. ${extra.join(", ")}` : ""}.${hidden}`
      : `${msg.kind}. ${[...sampleText(0), ...extra].join(", ")}.`;
  const desc = props.description ?? auto;

  const tpx = th && inDomain(th.value) ? X(th.value) : null;
  const ex = n ? [X(bins[0].x0), ...bins.map((b) => X(b.x1))] : [];
  /** 0이 아닌데 1px이 안 되는 막대는 가는 선으로 표시만 해요(길이를 부풀리지 않아요) */
  const yTop = (cnt: number, at: number) => (cnt > 0 && base - at < 1 ? base - 1 : at);

  /** 막대 하나. 기준선이 걸치면 그 자리에서 두 색으로 나눠요 */
  const bar = (b: Bin, at0: number, k: number): ReactNode => {
    const xa = X(b.x0) + 0.5;
    const xb = X(b.x1) - 0.5;
    const w = xb - xa;
    if (w <= 0 || b.counts[k] <= 0) return null;
    const at = yTop(b.counts[k], at0);
    const r = Math.min(2, w / 4);
    const gray = p.paint("neutral");
    const sh = th && !grouped ? pastShare(b, th, log) : 0;
    if (sh <= 0 || sh >= 1 || tpx === null) return <path d={roundRectPath(xa, at, w, base - at, { tl: r, tr: r })} fill={sh >= 1 || hiBins.has(b.i) ? accent : gray} />;
    const cut = Math.max(xa, Math.min(xb, tpx));
    const [lc, rc] = above ? [gray, accent] : [accent, gray];
    return (
      <>
        <path d={roundRectPath(xa, at, cut - xa, base - at, { tl: r })} fill={lc} />
        <path d={roundRectPath(cut, at, xb - cut, base - at, { tr: r })} fill={rc} />
      </>
    );
  };

  /** 윤곽 하나. 하나뿐인 윤곽은 강조 구간(또는 기준을 넘은 쪽)만 accent로 다시 그려요 */
  const outline = (k: number, v: number[]): ReactNode => {
    const tops = v.map((at, j) => yTop(bins[j]?.counts[k] ?? 0, at));
    const strong = grouped && k === lineK && hiGroup >= 0;
    const ranges: [number, number][] = grouped ? [] : th ? (tpx === null ? [] : [above ? [tpx, Infinity] : [-Infinity, tpx]]) : runs(hiBins, n).map(([a, z]) => [ex[a], ex[z + 1]]);
    return (
      <>
        <path d={stepPath(ex, tops, base)} fill="none" stroke={strong ? accent : p.paint("neutralStrong")} strokeWidth={strong ? 2 : 1.6} strokeLinejoin="round" />
        {ranges.map(([a, z], j) => (
          <path key={j} d={stepPath(ex, tops, base, a, z)} fill="none" stroke={accent} strokeWidth={2} strokeLinejoin="round" />
        ))}
      </>
    );
  };

  /** 점 기둥 하나: 채운 점 floor(개수 / N)개와, 나머지가 있으면 빈 원 하나. progress만큼 아래부터 나타나요 */
  const dotColumn = (b: Bin, progress: number): ReactNode => {
    const cnt = b.counts[0];
    const full = Math.floor(cnt / unit);
    const ring = cnt % unit > 0;
    const shown = Math.round(progress * (full + (ring ? 1 : 0)));
    const cx = r2((X(b.x0) + X(b.x1)) / 2);
    const col = isHot(b) ? accent : p.paint("neutralStrong");
    return (
      <>
        {Array.from({ length: Math.min(shown, full) }, (_, j) => (
          <circle key={j} cx={cx} cy={r2(base - pitch * (j + 0.5))} r={r2(rad)} fill={col} />
        ))}
        {ring && shown > full ? <circle cx={cx} cy={r2(base - pitch * (full + 0.5))} r={r2(rad - 0.65)} fill="none" stroke={col} strokeWidth={1.3} /> : null}
      </>
    );
  };

  const xTicks = !n ? [] : log ? logTicks(lo, hi, (xr - xl) / Math.max(1e-9, Math.log10(hi / lo))) : linearTicks(lo, hi, Math.round((xr - xl) / 70));
  const xFmt = makeTickFormatter(props.format, c.locale, Math.max(Math.abs(lo), Math.abs(hi)));
  const shownTicks = fitTickLabels(
    xTicks.map((t) => ({ t, x: X(t), label: xFmt(t) })),
    0,
    W,
  );
  const activeBin = c.active !== null ? bins[c.active] : undefined;
  // 고른 구간: 막대는 다른 구간을 흐리고, 점과 윤곽은 칸 전체를 옅게 칠해요. 키보드로 고르면 칸에 테두리를 둘러요
  const band = activeBin && (dots || step || grouped);
  const fade = m.fade(Math.min(700, n * stg) + 200, 320);

  return (
    <ChartFrame c={c} kind={msg.kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      {!dots && n ? <GridY p={p} ticks={yTicks} y={y} x0={left} x1={W} fmt={yFmt} locale={c.locale} /> : null}
      {band ? <rect x={r2(X(activeBin.x0))} y={r2(top)} width={r2(X(activeBin.x1) - X(activeBin.x0))} height={r2(base - top)} fill={p.paint("line")} opacity={0.6} pointerEvents="none" /> : null}
      {bins.map((b) => (
        <rect key={`h${b.i}`} x={r2(X(b.x0))} y={r2(top)} width={r2(Math.max(0, X(b.x1) - X(b.x0)))} height={r2(Math.max(0, base - top))} fill="transparent" onPointerEnter={(e) => c.setActive(b.i, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(b.i)} style={{ cursor: props.onClick ? "pointer" : undefined }} />
      ))}
      {m.items.map((it) => {
        const { k, i } = it.data;
        const b = bins[i];
        return (
          <g key={it.key} className="ztd-mark" pointerEvents="none" opacity={it.exiting ? 0.4 : i < 0 ? 1 : c.dim(i)}>
            {i < 0 ? outline(k, it.v) : !b ? null : dots ? dotColumn(b, it.v[0]) : bar(b, it.v[0], k)}
          </g>
        );
      })}
      {activeBin && c.via === "keyboard" ? <rect x={r2(X(activeBin.x0) - 1)} y={r2(top - 2)} width={r2(X(activeBin.x1) - X(activeBin.x0) + 2)} height={r2(base - top + 4)} rx={3} fill="none" stroke={p.paint("ink")} strokeWidth={2} pointerEvents="none" /> : null}
      {density?.curves.map((cv, k) => (
        <path key={`k${k}`} d={linePath(cv.map((v, j) => [sx(density.xs[j]), Math.max(top, y(v))] as [number, number]))} fill="none" stroke={grouped ? groupColor(k) : p.paint("ink")} strokeWidth={1.6} opacity={fade} pointerEvents="none" />
      ))}
      <g opacity={fade} pointerEvents="none" aria-hidden="true">
        {/* 선을 먼저 모두 그리고 이름표를 위에 얹어요 (윗줄 선이 아랫줄 이름표를 가로지르지 않게) */}
        {tags.map((t) => (
          <line key={t.key} x1={r2(t.at)} x2={r2(t.at)} y1={c.showLabels ? tagY(t.row) + TAG_H : top} y2={base} stroke={t.stroke} strokeWidth={t.key === "threshold" ? 1.5 : 1.4} strokeDasharray={t.dash} />
        ))}
        {c.showLabels
          ? tags.map((t) => (
              <g key={t.key}>
                <rect x={r2(t.x - t.w / 2)} y={tagY(t.row)} width={r2(t.w)} height={TAG_H} rx={5} fill={p.paint("panel")} opacity={0.92} />
                <Txt x={t.x} y={tagY(t.row) + TAG_H / 2} anchor="middle" size={TAG_FONT} weight={700} fill={t.fill}>
                  {t.text}
                </Txt>
              </g>
            ))
          : null}
      </g>
      <g aria-hidden="true">
        {shownTicks.map((t) => (
          <Txt key={t.t} x={t.x} y={base + 11} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
            {t.label}
          </Txt>
        ))}
        {dots && n ? <line x1={xl} x2={xr} y1={r2(base) + 0.5} y2={r2(base) + 0.5} stroke={p.paint("dim")} shapeRendering="crispEdges" /> : null}
        {note ? (
          <Txt x={xl} y={6 + HEAD_H / 2} size={10.5} fill={p.paint("muted")}>
            {truncate(note, Math.max(40, xr - xl - (dots ? 110 : 0)), 10.5)}
          </Txt>
        ) : null}
        {dots ? (
          <>
            <circle cx={r2(xr - textWidth(msg.dot(unit), 10.5, 600) - 8)} cy={6 + HEAD_H / 2} r={3.5} fill={p.paint("neutralStrong")} />
            <Txt x={xr} y={6 + HEAD_H / 2} anchor="end" size={10.5} weight={600} fill={p.paint("muted")}>
              {msg.dot(unit)}
            </Txt>
          </>
        ) : null}
        {!n ? (
          <Txt x={W / 2} y={H / 2} anchor="middle" size={12} fill={p.paint("muted")}>
            {c.t.empty}
          </Txt>
        ) : null}
      </g>
    </ChartFrame>
  );
}
