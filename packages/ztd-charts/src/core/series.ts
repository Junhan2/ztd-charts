import { DEFAULT_LOCALE, dateParts, dayFirstOf, isDateText, isYear, toDate } from "./format";
import { langOf } from "./i18n";
import { lazyArray } from "./lazy";
import { getter, toNumber, uniq } from "../data/accessor";
import type { Accessor } from "./types";

export type XType = "number" | "date" | "band";

/** 날짜, 숫자 x 값을 숫자로 (날짜는 ms, 못 읽으면 NaN). 데이터와 주석이 같은 규칙으로 읽어요 */
export const xNum = (type: XType, v: unknown, dayFirst?: boolean): number => (type === "date" ? toDate(v, dayFirst)?.getTime() ?? NaN : toNumber(v));

export interface SeriesModel<T> {
  type: XType;
  /** x 순서대로 정렬된 고유 키 */
  keys: string[];
  /** 키의 수치 위치 (band면 인덱스, date면 ms) */
  xnum: number[];
  /** 표시용 라벨 */
  labels: string[];
  series: string[];
  /** values[s][k], 값이 없으면 NaN */
  values: number[][];
  rows: (T | null)[][];
  /** bucketSeries로 줄였을 때만: 구간 평균(values)이 아니라 대표 행(keys, labels, rows와 같은 행)의 실제 값. 툴팁과 이벤트가 읽어요 */
  rowValues?: number[][];
}

/** 숨긴 계열(hidden, 이름을 \u0001로 이은 글자)을 뺀 모델과 남은 계열의 자리. 숨긴 게 없으면 그 모델 그대로예요. x 키는 모두 두어서 날짜가 움직이지 않아요 */
export function visibleSeries<M extends SeriesModel<unknown>>(m: M, hiddenKey: string): [M, number[]] {
  const off = new Set(hiddenKey ? hiddenKey.split("\u0001") : []);
  const keep = m.series.flatMap((s, i) => (off.has(s) ? [] : [i]));
  if (keep.length === m.series.length) return [m, keep];
  const at = <A>(a: A[]) => keep.map((i) => a[i]);
  return [{ ...m, series: at(m.series), values: at(m.values), rows: at(m.rows), ...(m.rowValues && { rowValues: at(m.rowValues) }) }, keep];
}

/** 묶어 보기(syncId)용 키. 날짜처럼 생긴 글자 범주("2025-01", "2025.01.05")는 날짜 x와 같은 꼴(타임스탬프 글자)로 맞춰요 */
export function syncKeyOf(raw: string): string {
  if (!isDateText(raw.trim())) return raw;
  const t = toDate(raw)?.getTime();
  return t === undefined || !Number.isFinite(t) ? raw : String(t);
}

export function detectXType(raw: readonly unknown[]): XType {
  const vals = raw.filter((v) => v !== null && v !== undefined && v !== "");
  if (!vals.length) return "band";
  if (vals.every((v) => v instanceof Date)) return "date";
  if (vals.every((v) => typeof v === "string" && isDateText(v.trim()))) return "date";
  if (vals.every((v) => typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())))) {
    return "number";
  }
  return "band";
}

/** 같은 x, 같은 계열이 여러 행일 때 합치는 방법. "sum"(더하기) | "mean"(평균) | "last"(마지막 행) | "count"(행 수) */
export type Aggregate = "sum" | "mean" | "last" | "count";

export interface PrepOptions {
  xType?: XType;
  locale?: string;
  dateFormat?: Intl.DateTimeFormatOptions;
  /** 같은 x, 같은 계열이 여러 행일 때 합치는 방법. 기본 "sum" */
  aggregate?: Aggregate;
  /** "05/03/2024"처럼 일, 월이 모두 될 수 있는 날짜를 일이 앞으로 읽어요. 없으면 열의 분명한 날짜가 정하고, 그것도 없으면 월이 앞 */
  dayFirst?: boolean;
}

/**
 * 긴 표(x, y, series)나 넓은 표(x + 값 열 여러 개)를 계열 행렬로.
 * y에 배열을 주면 그 열들이 계열이 돼요.
 */
export function prepSeries<T>(data: readonly T[], x: Accessor<T, unknown> | undefined, y: Accessor<T, unknown> | readonly string[] | undefined, series: Accessor<T, unknown> | undefined, opts: PrepOptions = {}): SeriesModel<T> {
  const getX = getter(x, "x");
  const wide = Array.isArray(y);
  const yKeys = wide ? (y as readonly string[]) : null;
  const getY = wide ? null : getter(y as Accessor<T, unknown> | undefined, "y");
  const getS = !wide && series !== undefined ? getter(series, "series") : null;
  const rawX = data.map((d, i) => getX(d, i));
  const type = opts.xType ?? detectXType(rawX);
  const locale = opts.locale ?? DEFAULT_LOCALE;
  // x는 한 번만 읽어요 (1만 행에서 날짜 파싱이 두 번이면 눈에 띄게 느려요). 달, 분기 라벨을 고르는 아래 검사만 첫 값이 달이나 분기일 때 5,000행 아래에서 한 번 더 봐요
  let keys: string[];
  let xnum: number[];
  let rowKey: Int32Array;
  if (type === "band") {
    const strs = rawX.map((v) => String(v ?? ""));
    keys = uniq(strs);
    const kIndex = new Map(keys.map((k, i) => [k, i]));
    xnum = keys.map((_, i) => i);
    rowKey = Int32Array.from(strs, (k) => kIndex.get(k) ?? -1);
  } else {
    const dayFirst = type === "date" ? opts.dayFirst ?? dayFirstOf(rawX) : undefined;
    const nums = rawX.map((v) => xNum(type, v, dayFirst));
    const uniqNums = Array.from(new Set(nums.filter((n) => Number.isFinite(n)))).sort((a, b) => a - b);
    const kIndex = new Map(uniqNums.map((n, i) => [n, i]));
    xnum = uniqNums;
    keys = uniqNums.map(String);
    rowKey = Int32Array.from(nums, (n) => kIndex.get(n) ?? -1);
  }
  let dfmt = opts.dateFormat;
  // 달("2024-03", "2024년 3월", "Mar 2024")이나 분기("2024Q1")만 있는 열인지 (라벨 꼴을 정해요)
  const kindOf = (v: unknown) => (typeof v === "string" ? dateParts(v.trim())?.[3] : undefined);
  const k0 = type === "date" && rawX.length < 5000 ? kindOf(rawX[0]) : undefined;
  const same = (k0 === 2 || k0 === 3) && rawX.every((v) => kindOf(v) === k0);
  const quarterly = same && k0 === 3;
  if (type === "date" && !dfmt) {
    const span = xnum.length > 1 ? xnum[xnum.length - 1] - xnum[0] : 0;
    const monthly = same && k0 === 2;
    dfmt = monthly || span > 86400000 * 120 ? { month: "short" } : span < 86400000 * 2 ? { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" } : { month: "numeric", day: "numeric" };
    if (span > 86400000 * 800) dfmt = { year: "numeric", month: "short" };
  }
  let labels: string[];
  if (type === "band") labels = keys;
  else if (quarterly && !opts.dateFormat) {
    const ko = langOf(locale) === "ko";
    labels = xnum.map((n) => {
      const d = new Date(n);
      const q = Math.floor(d.getMonth() / 3) + 1;
      return ko ? `${d.getFullYear()}년 ${q}분기` : `Q${q} ${d.getFullYear()}`;
    });
  } else {
    // 숫자 x는 소수 6자리까지 (0.001과 0.002가 같은 "0"이 되지 않게), 네 자리 정수만이면 연도라 자릿점 없이 ("2,019" 아니고 "2019")
    const year = xnum.every(isYear);
    const fmt = type === "date" ? new Intl.DateTimeFormat(locale, dfmt) : new Intl.NumberFormat(locale, year ? { useGrouping: false } : { maximumFractionDigits: 6 });
    labels = xnum.length > 1000 ? lazyArray(xnum.length, (i) => fmt.format(xnum[i])) : xnum.map((n) => fmt.format(n));
  }
  const seriesNames = yKeys ? [...yKeys] : getS ? uniq(data.map((d, i) => String(getS(d, i) ?? ""))) : [""];
  const sIndex = new Map(seriesNames.map((s, i) => [s, i]));
  const values = seriesNames.map(() => new Array<number>(keys.length).fill(NaN));
  const rows = seriesNames.map(() => new Array<T | null>(keys.length).fill(null));
  const agg: Aggregate = opts.aggregate ?? "sum";
  // 평균은 숫자인 값만 세요 (빈 값은 평균을 끌어내리지 않아요)
  const counts = agg === "mean" ? seriesNames.map(() => new Uint32Array(keys.length)) : null;
  const add = (s: number, k: number, v: number, d: T) => {
    const prev = values[s][k];
    if (agg === "last") values[s][k] = v;
    else if (agg === "count") values[s][k] = (Number.isFinite(prev) ? prev : 0) + 1;
    else if (agg === "mean") {
      if (Number.isFinite(v)) {
        values[s][k] = (Number.isFinite(prev) ? prev : 0) + v;
        counts![s][k]++;
      }
    } else values[s][k] = Number.isFinite(prev) ? prev + (Number.isFinite(v) ? v : 0) : v;
    rows[s][k] = d;
  };
  for (let i = 0; i < data.length; i++) {
    const k = rowKey[i];
    if (k < 0) continue;
    const d = data[i];
    if (yKeys) {
      for (let s = 0; s < yKeys.length; s++) add(s, k, toNumber((d as Record<string, unknown>)[yKeys[s]]), d);
    } else {
      const s = getS ? sIndex.get(String(getS(d, i) ?? "")) ?? 0 : 0;
      add(s, k, toNumber(getY!(d, i)), d);
    }
  }
  if (counts) for (let s = 0; s < values.length; s++) for (let k = 0; k < keys.length; k++) if (counts[s][k] > 1) values[s][k] /= counts[s][k];
  return { type, keys, xnum, labels, series: seriesNames, values, rows };
}

/**
 * x를 구간 평균으로 줄여요. 모든 계열이 같은 x를 쓰니 쌓은 차트(영역, 스트림)에서 층이 어긋나지 않아요.
 * 대표 키와 라벨은 구간 가운데 것을 써요. 그 행의 실제 값은 rowValues에 남겨요 (평균은 그리기용).
 */
export function bucketSeries<T>(m: SeriesModel<T>, maxPoints: number): SeriesModel<T> {
  const n = m.keys.length;
  if (n <= maxPoints || maxPoints < 2) return m;
  const size = n / maxPoints;
  const pick: number[] = [];
  const ranges: [number, number][] = [];
  for (let b = 0; b < maxPoints; b++) {
    const a = Math.floor(b * size);
    const e = Math.min(n, Math.floor((b + 1) * size));
    if (e <= a) continue;
    ranges.push([a, e]);
    pick.push(b === 0 ? 0 : b === maxPoints - 1 ? n - 1 : Math.floor((a + e - 1) / 2));
  }
  const values = m.values.map((row) =>
    ranges.map(([a, e]) => {
      let s = 0;
      let c = 0;
      for (let k = a; k < e; k++)
        if (Number.isFinite(row[k])) {
          s += row[k];
          c++;
        }
      return c ? s / c : NaN;
    }),
  );
  return {
    type: m.type,
    keys: pick.map((k) => m.keys[k]),
    xnum: m.type === "band" ? pick.map((_, i) => i) : pick.map((k) => m.xnum[k]),
    labels: lazyArray(pick.length, (i) => m.labels[pick[i]]),
    series: m.series,
    values,
    rows: m.rows.map((r) => pick.map((k) => r[k])),
    rowValues: m.values.map((r) => pick.map((k) => r[k])),
  };
}
