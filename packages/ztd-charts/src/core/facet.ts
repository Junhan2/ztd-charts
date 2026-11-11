import type { ReactNode } from "react";
import { FACET_MAX } from "../spec/meta";
import { numGetter, strGetter } from "../data/accessor";
import { dataSignature } from "../data/parse";
import { stack } from "../layout/stack";
import { annotationYs, type Annotation } from "./annotations";
import { AXIS_FONT, yAxisWidth } from "./axis";
import { makeFormatter, makeTickFormatter, withUnit, type FormatSpec } from "./format";
import { argMax } from "./geometry";
import { plural, type ChartLang } from "./i18n";
import { extent, fitDomain, fitLogDomain, scaleLinear, scaleLog, timeTicks } from "./scale";
import { textWidth } from "./text";
import { prepSeries, type SeriesModel, type XType } from "./series";
import type { Highlight, Row } from "./types";

/** 작은 여러 개로 그릴 수 있는 차트 */
export type FacetType = "line" | "area" | "bar" | "scatter";
/** "shared": 모든 패널이 같은 값 축. "free": 패널마다 자기 데이터에 맞춰요 */
export type FacetScale = "shared" | "free";

/** 패널 최소 폭(px). 390px 화면의 카드 안(약 300px)에 두 칸이 들어가요 */
export const FACET_MIN_WIDTH = 140;
/** 칸 사이, 줄 사이(px) */
export const FACET_GAP = 12;
export const FACET_ROW_GAP = 14;
/** 패널 제목 줄 높이(px) */
export const FACET_TITLE_H = 20;
/** 패널 제목 글자 크기 */
export const FACET_TITLE_SIZE = 12.5;

/**
 * by 값마다 행을 모아요. 값이 처음 나오는 순서로 max개까지, 나머지 값의 수는 dropped.
 * 빈 값("", null, 필드 없음)은 모두 "" 한 묶음이에요 (빼지 않아요. 제목은 FacetPanel.label의 "(blank)")
 */
export function facetGroups<T>(data: readonly T[], by: string, max = FACET_MAX): { values: string[]; groups: T[][]; dropped: number } {
  const get = strGetter<T>(by, by);
  const at = new Map<string, T[]>();
  data.forEach((d, i) => {
    const v = get(d, i);
    const list = at.get(v);
    if (list) list.push(d);
    else at.set(v, [d]);
  });
  const values = [...at.keys()].slice(0, max);
  return { values, groups: values.map((v) => at.get(v)!), dropped: Math.max(0, at.size - max) };
}

/**
 * 한 줄 칸 수: 패널이 FACET_MIN_WIDTH 이상으로 들어가는 만큼, columns가 있으면 그 이하로.
 * 마지막 줄이 혼자 남지 않게 줄 수에 맞춰 고르게 나눠요 (8개가 7칸에 들어가면 4칸 두 줄)
 */
export function facetColumns(width: number, n: number, columns?: number): number {
  if (n < 1) return 1;
  const fit = Math.max(1, Math.floor((width + FACET_GAP) / (FACET_MIN_WIDTH + FACET_GAP)));
  // 스펙은 검사 없이 올 수도 있어요(<Chart>). 양의 정수가 아닌 columns는 없는 것으로 봐요
  const cap = Math.max(1, Math.min(fit, Number.isInteger(columns) && columns! >= 1 ? columns! : fit, n));
  return Math.ceil(n / Math.ceil(n / cap));
}

/** 패널 폭과 높이. 높이를 주지 않으면 폭에 맞춰 120~180px */
export function facetPanelSize(width: number, cols: number, height?: number): { pw: number; ph: number } {
  const pw = Math.max(40, Math.floor((width - (cols - 1) * FACET_GAP) / cols));
  // 높이는 서버 SVG 속성에 들어가서 유한한 양수만 써요 (아니면 폭에 맞춘 기본값)
  return { pw, ph: typeof height === "number" && Number.isFinite(height) && height > 0 ? height : Math.max(120, Math.min(180, Math.round(pw * 0.62))) };
}

export interface FacetDomains {
  /** 값 축 범위 */
  y?: [number, number];
  /** 날짜, 숫자 x 범위 (라인, 영역, 산점도) */
  x?: [number, number];
  /** 모든 패널의 x 범주(막대, 범주 x)가 같은 순서로 같아요. 그래야 아래 줄 패널에만 x 글자를 둬도 돼요 */
  sameKeys: boolean;
}

const finite = (xs: number[]) => xs.filter(Number.isFinite);
/** 필드 이름 하나나 배열의 모든 숫자 */
function fieldValues(rows: readonly Row[], f: unknown): number[] {
  const out: number[] = [];
  for (const k of Array.isArray(f) ? f : f === undefined ? [] : [f]) {
    const get = numGetter<Row>(k as string, String(k));
    rows.forEach((r, i) => out.push(get(r, i)));
  }
  return finite(out);
}

/** 패널 행을 차트와 같은 규칙(막대는 범주 x, 합치는 방법, 날짜 읽기)으로 계열 행렬로. 같은 값 축과 제목 줄 마지막 값이 같이 써요 */
function facetModel(type: FacetType, rows: readonly Row[], props: Record<string, unknown>, y: unknown, series: unknown, aggregate: unknown): SeriesModel<Row> {
  return prepSeries(rows, props.x as string | undefined, y as never, series as string | undefined, { xType: type === "bar" ? "band" : (props.xType as XType | undefined), aggregate: aggregate as never, dayFirst: props.dayFirst as boolean | undefined });
}

/**
 * 같은 값 축: 모든 패널(나눈 행)을 차트와 같은 규칙으로 합치고 쌓은 값, 주석, 기준선까지 넣어 한 번 재요.
 * 차트는 받은 범위를 그대로 써서 패널마다 높이를 견줄 수 있어요. models는 패널마다 facetModel(산점도는 쓰지 않아요), pw, ph는 패널 크기(눈금 수를 차트와 같게 정해요)
 */
export function facetDomains(type: FacetType, groups: readonly (readonly Row[])[], models: readonly SeriesModel<Row>[], props: Record<string, unknown>, pw: number, ph: number): FacetDomains {
  const yCount = Math.max(2, Math.round(ph / 70));
  const isLog = props.yScale === "log" && (type === "line" || type === "scatter");
  // 차트와 같은 규칙: 로그 눈금은 양 끝이 0보다 큰 yDomain만 써요
  const fixed = props.yDomain as [number, number] | undefined;
  const fixedY = fixed && (!isLog || (fixed[0] > 0 && fixed[1] > 0)) ? fixed : undefined;
  if (type === "scatter") {
    const all = groups.flat();
    const ref = (props.refLines ?? {}) as { x?: number; y?: number };
    const [x0, x1] = extent([...fieldValues(all, props.x ?? "x"), ...finite([Number(ref.x)])]);
    // 로그 눈금은 0 이하 값과 기준선을 그리지 않아서 범위에도 넣지 않아요
    const [y0, y1] = extent([...fieldValues(all, props.y ?? "y"), ...finite([Number(ref.y)])].filter((v) => !isLog || v > 0));
    const zero = (props.zero as boolean | undefined) ?? false;
    return {
      y: fixedY ?? (isLog ? fitLogDomain(y0, y1, yCount) : fitDomain(y0, y1, yCount, { zero, pad: 0.08 })),
      x: (props.xDomain as [number, number] | undefined) ?? fitDomain(x0, x1, Math.max(2, Math.round(pw / 110)), { zero, pad: 0.06 }),
      sameKeys: true,
    };
  }
  const isBar = type === "bar";
  const horizontal = isBar && props.orientation === "horizontal";
  const keys = models[0]?.keys.join("\u0001");
  const sameKeys = models.every((m) => m.keys.join("\u0001") === keys);
  const xTyped = models.length > 0 && models.every((m) => m.type !== "band" && m.type === models[0].type);
  const x = (props.xDomain as [number, number] | undefined) ?? (!isBar && xTyped ? extent(models.flatMap((m) => finite(m.xnum))) : undefined);
  // 100% 쌓기는 차트가 0~100으로 고정해요
  const mode = isBar ? (props.layout as string | undefined) ?? "grouped" : type === "area" ? (props.stack as string | undefined) ?? "auto" : "none";
  if (mode === "percent") return { x, sameKeys };
  if (fixedY) return { y: fixedY, x, sameKeys };
  const vals: number[] = [];
  groups.forEach((g, gi) => {
    const m = models[gi];
    const stacked = mode === "stacked" || (mode === "auto" && m.series.length > 1);
    if (stacked) {
      const st = stack(m.values, "zero");
      st.y0.forEach((r) => vals.push(...r));
      st.y1.forEach((r) => vals.push(...r));
    } else m.values.forEach((r) => vals.push(...r));
    // 막대 위 선(같은 축)과 범위 띠 경계
    if (isBar && !horizontal && props.line !== undefined) facetModel(type, g, props, ([] as unknown[]).concat(props.line), undefined, props.series === undefined ? props.aggregate : "mean").values.forEach((r) => vals.push(...r));
    if (!isBar) vals.push(...fieldValues(g, props.lower), ...fieldValues(g, props.upper));
  });
  // 막대는 0에서 자라요
  if (isBar) vals.push(0);
  if (!horizontal) vals.push(...annotationYs(props.annotations as Annotation[] | undefined));
  for (const r of (props.referenceLines as { y: number }[] | undefined) ?? []) vals.push(r.y);
  if (props.signColors) vals.push(Number(props.baseline ?? 0));
  const [mn, mx] = extent(finite(vals).filter((v) => !isLog || v > 0));
  const y: [number, number] = isLog
    ? fitLogDomain(mn, mx, yCount)
    : isBar
      ? fitDomain(mn, mx, horizontal ? Math.max(2, Math.round(pw / 120)) : yCount)
      : fitDomain(mn, mx, yCount, { zero: (props.zero as boolean | undefined) ?? type === "area" });
  return { y, x, sameKeys };
}

/**
 * 같은 값 축에서 x 값이 적을 때(라인 차트가 눈금 대신 점마다 이름을 다는 기준: 숫자 12개 이하, 날짜는 눈금 수 이하)의 x 눈금.
 * 모든 패널의 x 값을 모아 첫 값부터, 가장 좁은 패널(값 축 글자가 있는 첫 열)에서 글자가 겹치지 않는 한 간격으로 솎아요.
 * 모든 패널이 이 목록을 그대로 그려서, 그 x가 없는 패널도 같은 글자예요. 값이 많으면 undefined(차트가 같은 범위의 고른 눈금을 써요)
 */
function sharedXTicks(type: FacetType, groups: readonly (readonly Row[])[], models: readonly SeriesModel<Row>[], cp: Record<string, unknown>, dom: FacetDomains, pw: number, ph: number, locale: string): { value: number; label: string }[] | undefined {
  if ((type !== "line" && type !== "area") || !dom.x || !dom.y) return undefined;
  const all = prepSeries(groups.flat(), cp.x as string | undefined, cp.y as never, undefined, { xType: cp.xType as XType | undefined, locale, dayFirst: cp.dayFirst as boolean | undefined });
  // 가장 좁은 그림: 값 축 글자 폭(차트와 같은 눈금과 꼴)과 오른쪽 끝 계열 이름표 자리를 뺀 폭
  const yTicks = (cp.yScale === "log" && type === "line" ? scaleLog : scaleLinear)(dom.y, [ph - 22, 10]).ticks(Math.max(2, Math.round(ph / 70)));
  const left = yAxisWidth(yTicks, makeTickFormatter(cp.format as FormatSpec | undefined, locale, Math.max(Math.abs(dom.y[0]), Math.abs(dom.y[1]))), locale);
  const names = models.flatMap((m) => m.series);
  const ends = (cp.endLabels as boolean | undefined) ?? models.some((m) => m.series.length > 1);
  const x0 = left + 6;
  const x1 = pw - (ends ? Math.min(pw * 0.28, Math.max(...names.map((s) => textWidth(s, 11, 700)), 20) + 14) : 10);
  const n = all.keys.length;
  const [a, b] = dom.x[1] === dom.x[0] ? [dom.x[0], dom.x[0] + 1] : dom.x;
  const many = all.type === "number" ? n > 12 : n > timeTicks(a, b, Math.max(2, Math.floor((x1 - x0) / 64)), locale).length;
  if (all.type === "band" || !n || many) return undefined;
  const at = (k: number) => x0 + ((all.xnum[k] - a) / (b - a)) * (x1 - x0);
  const w = (k: number) => textWidth(all.labels[k], AXIS_FONT);
  for (let step = 1; ; step++) {
    const idx = Array.from({ length: Math.ceil(n / step) }, (_, i) => i * step);
    if (step >= n || idx.every((k, i) => !i || at(k) - at(idx[i - 1]) >= (w(k) + w(idx[i - 1])) / 2 + 8)) return idx.map((k) => ({ value: all.xnum[k], label: all.labels[k] }));
  }
}

/** 32비트 FNV-1a를 16진수로. 같은 글이면 늘 같은 값이에요 */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 패널을 묶는 syncId. 차트 종류, 나눈 필드, 채널, 데이터로 정해서 같은 스펙이면 서버와 브라우저, 몇 번을 그려도 같아요 (난수, 시각을 쓰지 않아요) */
export function facetSyncId(type: string, by: string, props: Record<string, unknown>, data: readonly unknown[]): string {
  const channels = [props.x, props.y, props.series].map((v) => JSON.stringify(v ?? null)).join("|");
  return `ztd-facet-${hash(`${type}|${by}|${channels}|${dataSignature(data)}`)}`;
}

/** highlight가 패널(by 값)을 고르는지: by 값 하나, 또는 모두 by 값인 배열 */
export function isPanelHighlight(h: unknown, values: readonly string[]): h is string | string[] {
  if (typeof h === "string") return values.includes(h);
  return Array.isArray(h) && h.length > 0 && h.every((v) => typeof v === "string" && values.includes(v));
}

const TEXT = {
  en: {
    intro: (n: number, by: string) => `${plural(n, "panel")} by ${by}.`,
    endHigh: (name: string, v: string) => ` ${name} ends highest at ${v}.`,
    falling: (names: string) => ` Lower at the end than at the start: ${names}.`,
    noneFalling: " None is lower at the end than at the start.",
    total: (name: string, v: string) => ` ${name} has the largest total at ${v}.`,
    points: (name: string, n: number) => ` ${name} has the most points (${n}).`,
    dropped: (shown: number, total: number) => ` Only the first ${shown} of ${total} values are shown.`,
    more: ", …",
    blank: "(blank)",
  },
  ko: {
    intro: (n: number, by: string) => `${by}별 패널 ${n}개.`,
    endHigh: (name: string, v: string) => ` 마지막 값이 가장 큰 곳: ${name}(${v}).`,
    falling: (names: string) => ` 처음보다 끝이 낮은 곳: ${names}.`,
    noneFalling: " 처음보다 끝이 낮은 곳은 없어요.",
    total: (name: string, v: string) => ` 합계가 가장 큰 곳: ${name}(${v}).`,
    points: (name: string, n: number) => ` 점이 가장 많은 곳: ${name}(${n}개).`,
    dropped: (shown: number, total: number) => ` ${total}개 중 앞의 ${shown}개만 보여요.`,
    more: " 등",
    blank: "(빈 값)",
  },
};

export interface FacetPanel {
  /** by 값. 빈 값("", null, 필드 없음)은 "" */
  value: string;
  /** 패널 제목, 이름, 설명에 쓰는 글. 빈 값이면 "(blank)", 한국어 "(빈 값)" */
  label: string;
  /** 패널마다 다른 차트 프롭(data, 크기, 이름, 묶음, 강조, 축 범위와 글자). chartProps 뒤에 덮어 넘겨요 */
  props: Record<string, unknown>;
  /** 제목 오른쪽 마지막 값 (계열 하나인 라인, 영역만) */
  last?: string;
  /** highlight가 이 패널을 골랐어요 (강조색 제목) */
  isPicked: boolean;
}

export interface FacetPlan {
  panels: FacetPanel[];
  cols: number;
  pw: number;
  ph: number;
  /** 패널마다 highlight가 패널을 고르는 모드인지 (고르지 않은 패널 제목은 흐리게) */
  isPanelPick: boolean;
  /** 묶음 전체를 읽어 주는 한 문장 */
  description: string;
  /**
   * 모든 패널이 같이 쓰는 범례 (육각 밀도 산점도의 같은 색 척도). 격자 위 오른쪽에 FACET_LEGEND_H 높이로 한 번만 그리고, 패널에는 그리지 않아요.
   * class="ztd-facet-legend"인 svg라 서버 SVG도 같은 자리에 옮겨 놓아요
   */
  legend?: ReactNode;
}

/** 묶음 범례 줄 높이(px) */
export const FACET_LEGEND_H = 18;

export interface FacetInput {
  type: FacetType;
  data: readonly Row[];
  by: string;
  columns?: number;
  scale?: FacetScale;
  /** 패널마다 넘길 차트 프롭 (x, y, series, format …) */
  chartProps: Record<string, unknown>;
  highlight?: Highlight<Row>;
  syncId?: string;
  /** 전체 폭 */
  width: number;
  /** 패널 높이 */
  height?: number;
  /** 패널 이름 앞부분: "<title>, <값>" */
  title?: string;
  locale: string;
  lang: ChartLang;
}

/**
 * 작은 여러 개의 배치와 패널 프롭. <ChartFacets>와 서버 SVG가 같이 써서 두 그림이 같아요.
 * 같은 값 축이면 왼쪽 열에만 값 축 글자, 아래가 비는 패널에만 x 글자를 둬요 (범주가 패널마다 다르면 x 글자는 모두)
 */
export function planFacets(o: FacetInput): FacetPlan {
  const { type, chartProps: cp } = o;
  const { values, groups, dropped } = facetGroups(o.data, o.by);
  const n = values.length;
  // 폭도 스펙(options.width)에서 검사 없이 올 수 있어서 유한한 양수만 써요
  const width = typeof o.width === "number" && Number.isFinite(o.width) && o.width > 0 ? o.width : 480;
  const cols = facetColumns(width, n, o.columns);
  const { pw, ph } = facetPanelSize(width, cols, o.height);
  const shared = o.scale !== "free";
  // 패널마다 계열 행렬은 한 번만 만들어요 (같은 값 축과 제목 줄 마지막 값, 설명이 같이 써요)
  const models = type === "scatter" ? [] : groups.map((g) => facetModel(type, g, cp, cp.y, cp.series, cp.aggregate));
  const dom = shared ? facetDomains(type, groups, models, cp, pw, ph) : { sameKeys: false };
  const xTicks = shared ? sharedXTicks(type, groups, models, cp, dom, pw, ph, o.locale) : undefined;
  const horizontal = type === "bar" && cp.orientation === "horizontal";
  // 왼쪽, 아래 글자가 모든 패널에서 같을 때만 가장자리 패널에 몰아요 (같은 값 축 산점도는 x 범위가 늘 있어요)
  const leftShared = shared && (!horizontal || dom.sameKeys);
  const bottomShared = shared && (horizontal || dom.x !== undefined || dom.sameKeys);
  const picked = new Set(isPanelHighlight(o.highlight, values) ? [o.highlight].flat() : []);
  const isPick = picked.size > 0;
  // 고른 패널을 통째로 강조색으로: 계열 하나인 막대(기본은 가장 큰 막대만)와 계열 없는 산점도(기본은 강조 없음). 라인, 영역은 기본(첫 계열)이 강조색이에요
  const whole = (type === "bar" && !Array.isArray(cp.y) && cp.series === undefined) || (type === "scatter" && cp.series === undefined);
  const syncId = o.syncId ?? facetSyncId(type, o.by, cp, o.data);
  const fmt = withUnit(makeFormatter(cp.format as FormatSpec | undefined, o.locale), cp.unit as string | undefined);
  const t = TEXT[o.lang];
  // 설명 문장용 패널 요약: 처음과 끝 값(라인, 영역, 계열 합), 합계(막대), 점 수(산점도)
  const sums: { first: number; last: number; total: number }[] = [];
  // 빈 값 묶음은 보이는 이름으로 (제목, 차트 이름, 설명이 같은 글)
  const labels = values.map((v) => (v === "" ? t.blank : v));
  const panels = values.map((value, i): FacetPanel => {
    const rows = groups[i];
    const label = labels[i];
    const col = i % cols;
    let last: string | undefined;
    if (type !== "scatter") {
      const m = models[i];
      const at = (k: number) => m.values.reduce((s, r) => s + (Number.isFinite(r[k]) ? r[k] : 0), 0);
      const ks = m.keys.map((_, k) => k).filter((k) => m.values.some((r) => Number.isFinite(r[k])));
      const lastK = ks[ks.length - 1];
      sums.push({ first: ks.length ? at(ks[0]) : NaN, last: ks.length ? at(lastK) : NaN, total: ks.reduce((s, k) => s + at(k), 0) });
      if (type !== "bar" && m.series.length === 1 && lastK !== undefined) last = fmt(m.values[0][lastK]);
    } else sums.push({ first: NaN, last: NaN, total: rows.length });
    const props: Record<string, unknown> = {
      data: rows,
      width: pw,
      height: ph,
      ariaLabel: o.title ? `${o.title}, ${label}` : label,
      syncId,
      highlight: isPick ? (picked.has(value) ? (whole ? () => true : undefined) : "none") : o.highlight,
      showYAxis: !leftShared || col === 0,
      showXAxis: !bottomShared || i + cols >= n,
    };
    if (dom.y) props.yDomain = dom.y;
    if (dom.x) props.xDomain = dom.x;
    if (xTicks) props.xTicks = xTicks;
    return { value, label, props, last, isPicked: picked.has(value) };
  });
  return { panels, cols, pw, ph, isPanelPick: isPick, description: describeFacets(type, o.by, labels, sums, dropped, fmt, t) };
}

/** 묶음 설명: 패널 수, 가장 큰 곳(끝 값, 합계, 점 수), 처음보다 끝이 낮은 곳(라인, 영역), 뺀 값 */
function describeFacets(type: FacetType, by: string, values: string[], sums: { first: number; last: number; total: number }[], dropped: number, fmt: (v: number) => string, t: (typeof TEXT)["en"]): string {
  let out = t.intro(values.length, by);
  const top = (key: "last" | "total") => argMax(sums.map((s) => s[key]));
  if (type === "line" || type === "area") {
    const k = top("last");
    if (k >= 0) out += t.endHigh(values[k], fmt(sums[k].last));
    const falling = values.filter((_, i) => sums[i].last < sums[i].first);
    out += falling.length ? t.falling(`${falling.slice(0, 5).join(", ")}${falling.length > 5 ? t.more : ""}`) : t.noneFalling;
  } else {
    const k = top("total");
    if (k >= 0) out += type === "bar" ? t.total(values[k], fmt(sums[k].total)) : t.points(values[k], sums[k].total);
  }
  if (dropped) out += t.dropped(values.length, values.length + dropped);
  return out;
}
