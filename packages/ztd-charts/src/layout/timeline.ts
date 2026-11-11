import { dayFirstOf, isDateText, toDate } from "../core/format";
import { fitDomain } from "../core/scale";
import { getter, strGetter, toNumber, uniq } from "../data/accessor";
import type { Accessor } from "../core/types";

/** 시간 축의 종류: "number"는 분, 초 같은 숫자, "date"는 날짜와 시각(ms) */
export type TimeKind = "number" | "date";

export interface TimelineItem<T = unknown> {
  /** 데이터의 행 번호 */
  i: number;
  label: string;
  /** 시작과 끝 (date면 ms). 끝이 시작보다 앞이면 바꿔 둬요 */
  start: number;
  end: number;
  /** 끝이 비어 있어서 아직 이어지는 항목. end는 now나 데이터의 가장 늦은 시각이에요 */
  open: boolean;
  /** 시작과 끝이 같은 사건 (점으로 그려요) */
  point: boolean;
  group: string;
  status: string;
  datum: T;
}

/** 읽다가 고친 것, 뺀 것의 수. 검사기가 같은 수로 경고해요 */
export interface TimelineIssues {
  /** 끝이 시작보다 앞이라 바꾼 항목 */
  swapped: number;
  /** 끝이 비어 열린 항목 */
  open: number;
  /** 시작이 없거나 읽지 못해 뺀 항목 */
  noStart: number;
  /** 끝이 있지만 읽지 못해 뺀 항목 (빈 칸은 열린 항목이에요) */
  badEnd: number;
  /** 축과 다른 종류(날짜 축의 숫자, 숫자 축의 날짜)라 뺀 칸이 있는 항목 */
  mixed: number;
  /** 이름, 시작, 끝, 묶음이 모두 같은 항목 (둘 다 그려요) */
  duplicate: number;
}

export interface TimelineModel<T = unknown> {
  kind: TimeKind;
  items: TimelineItem<T>[];
  issues: TimelineIssues;
  /** date 축에서 모든 시각이 자정이에요 (날짜만 있는 일정). 걸린 시간을 날 수로 세요 */
  dateOnly: boolean;
  /** date 축에서 초가 0이 아닌 시각이 있어요 (시각 글자에 초까지 적어요) */
  hasSeconds: boolean;
  /** 축 값 하나를 데이터와 같은 규칙으로 (기준선, now). 못 읽으면 NaN */
  read: (v: unknown) => number;
}

export interface TimelineFields<T> {
  label?: Accessor<T, string>;
  start?: Accessor<T, unknown>;
  end?: Accessor<T, unknown>;
  group?: Accessor<T, string>;
  status?: Accessor<T, string>;
}

const blank = (v: unknown) => v === undefined || v === null || v === "";

/** 값의 종류: 날짜("d"), 숫자("n"), 빈 칸(""), 못 읽음("x"). 날짜 글자는 축 x와 같은 규칙(isDateText)으로 봐요 */
function classOf(v: unknown): "d" | "n" | "" | "x" {
  if (blank(v)) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "x" : "d";
  if (typeof v === "number") return Number.isFinite(v) ? "n" : "x";
  if (typeof v === "string") {
    const s = v.trim();
    if (isDateText(s)) return "d";
    return Number.isFinite(toNumber(s)) ? "n" : s ? "x" : "";
  }
  return "x";
}

/**
 * 행을 타임라인 항목으로. 축 종류는 xType이 정하고, 없으면 시작과 끝 칸 중 날짜가 더 많으면 날짜예요.
 * 날짜 축의 숫자처럼 다른 종류의 칸은 읽지 않아요 (xType "date"면 숫자도 타임스탬프, 연도로 읽어요).
 * 끝이 빈 항목은 열린 항목이라 now(축 값), 없으면 데이터의 가장 늦은 시각까지 이어요
 */
export function readTimeline<T>(data: readonly T[], f: TimelineFields<T>, o: { xType?: TimeKind; dayFirst?: boolean; now?: unknown } = {}): TimelineModel<T> {
  const gl = strGetter(f.label, "label");
  const gs = getter(f.start, "start");
  const ge = getter(f.end, "end");
  const gg = f.group === undefined ? null : strGetter(f.group, "group");
  const gt = f.status === undefined ? null : strGetter(f.status, "status");
  const rawS = data.map((d, i) => gs(d, i));
  const rawE = data.map((d, i) => ge(d, i));
  const raw = rawS.concat(rawE);
  let kind = o.xType;
  let dates = 0;
  let nums = 0;
  if (!kind) {
    for (const v of raw) {
      const k = classOf(v);
      if (k === "d") dates++;
      else if (k === "n") nums++;
    }
    kind = dates > nums ? "date" : "number";
  }
  const auto = !o.xType;
  const dayFirst = kind === "date" ? o.dayFirst ?? dayFirstOf(raw) : undefined;
  const want = kind === "date" ? "d" : "n";
  const read = (v: unknown): number => {
    if (auto && classOf(v) !== want) return NaN;
    return kind === "date" ? toDate(v, dayFirst)?.getTime() ?? NaN : toNumber(v);
  };
  const other = (v: unknown) => auto && classOf(v) === (want === "d" ? "n" : "d");
  const issues: TimelineIssues = { swapped: 0, open: 0, noStart: 0, badEnd: 0, mixed: 0, duplicate: 0 };
  const items: TimelineItem<T>[] = [];
  let hi = -Infinity;
  for (let i = 0; i < data.length; i++) {
    let s = read(rawS[i]);
    let e = read(rawE[i]);
    if (!Number.isFinite(s)) {
      if (other(rawS[i])) issues.mixed++;
      else issues.noStart++;
      continue;
    }
    const open = !Number.isFinite(e) && blank(rawE[i]);
    if (!Number.isFinite(e) && !open) {
      if (other(rawE[i])) issues.mixed++;
      else issues.badEnd++;
      continue;
    }
    if (open) issues.open++;
    else if (e < s) {
      [s, e] = [e, s];
      issues.swapped++;
    }
    hi = Math.max(hi, open ? s : e);
    const d = data[i];
    items.push({ i, label: gl(d, i), start: s, end: e, open, point: !open && e === s, group: gg ? gg(d, i) : "", status: gt ? gt(d, i) : "", datum: d });
  }
  // 열린 항목의 끝: now가 시작 뒤면 now, 아니면 가장 늦은 시각 (그보다 앞에서 시작했으면 점이에요)
  const now = o.now === undefined ? NaN : read(o.now);
  const seen = new Set<string>();
  for (const it of items) {
    if (it.open) {
      it.end = Number.isFinite(now) && now >= it.start ? now : Math.max(hi, it.start);
      it.point = it.end === it.start;
    }
    const key = `${it.label}\u0001${it.start}\u0001${it.end}\u0001${it.group}`;
    if (seen.has(key)) issues.duplicate++;
    else seen.add(key);
  }
  const date = kind === "date";
  const dateOnly = date && items.length > 0 && items.every((it) => isMidnight(it.start) && isMidnight(it.end));
  const hasSeconds = date && !dateOnly && items.some((it) => new Date(it.start).getSeconds() || new Date(it.end).getSeconds());
  return { kind, items, issues, dateOnly, hasSeconds, read };
}

/**
 * 색을 나누는 값들 (빈 값 빼고). 색 자리가 같도록 차트와 카드 범례가 같은 행, 같은 규칙으로 만들어요.
 * 묶음(group)은 처음 나온 순서예요. 상태(rare)는 드문 상태부터(행 수가 적은 순, 같으면 처음 나온 순서)라서 짧게 끼어든 장애 같은 상태가 가장 진한 색을 받아요
 */
export function timelineGroups<T>(data: readonly T[], field: Accessor<T, string>, rare = false): string[] {
  const g = strGetter(field, "group");
  const vals = data.map((d, i) => g(d, i)).filter(Boolean);
  const keys = uniq(vals);
  if (!rare) return keys;
  const count = new Map<string, number>();
  for (const v of vals) count.set(v, (count.get(v) ?? 0) + 1);
  return keys.map((k, i) => [k, i] as const).sort((a, b) => count.get(a[0])! - count.get(b[0])! || a[1] - b[1]).map(([k]) => k);
}

export const DAY = 86400000;

/**
 * 시간 축 범위: 숫자는 눈금에 맞춰 넓히고, 날짜는 데이터 끝 그대로예요. 모두 같은 시각이면 앞뒤로 반나절(날짜만 있으면 하루).
 * 차트와 검사기(범위 밖 기준선)가 같이 써요. 항목이 없으면 [0, 1]
 */
export function timelineDomain(m: Pick<TimelineModel, "kind" | "items" | "dateOnly">): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const it of m.items) {
    if (it.start < lo) lo = it.start;
    if (it.end > hi) hi = it.end;
  }
  if (lo === Infinity) return [0, 1];
  if (m.kind === "number") return fitDomain(lo, hi, 5, { zero: false });
  const pad = m.dateOnly ? DAY : DAY / 2;
  return lo === hi ? [lo - pad, hi + pad] : [lo, hi];
}

const isMidnight = (t: number) => {
  const d = new Date(t);
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
};

/** 줄 순서: "none"은 처음 나온 순서, "start"는 가장 이른 시작 순, "duration"은 걸린 시간 합이 긴 순 */
export type TimelineSort = "none" | "start" | "duration";

export interface TimelineRow {
  label: string;
  /** 줄 안 항목 (items의 위치), 시간 순서 */
  items: number[];
  /** 겹치는 항목을 나눠 놓은 칸 수 (1 이상) */
  lanes: number;
  /** 앞 줄들의 칸 수 합 (이 줄의 첫 칸 번호) */
  lane0: number;
}

/**
 * 같은 이름의 항목을 한 줄에 모으고, 겹치면 칸을 나눠요. 칸은 앞 칸부터 채워요(먼저 시작한 항목이 위).
 * 맞닿은 항목(끝 = 다음 시작)은 한 칸에 이어 놓아요(상태 띠, 막대 끝의 점). 같은 시각의 점 둘만 칸을 나눠요. lane[k]는 items[k]의 칸 번호(줄 안)예요
 */
export function timelineRows(items: readonly TimelineItem[], sort: TimelineSort = "none"): { rows: TimelineRow[]; lane: Int32Array } {
  const byLabel = new Map<string, number[]>();
  items.forEach((it, k) => {
    const list = byLabel.get(it.label);
    if (list) list.push(k);
    else byLabel.set(it.label, [k]);
  });
  const lane = new Int32Array(items.length);
  const rows: TimelineRow[] = [];
  for (const [label, list] of byLabel) {
    list.sort((a, b) => items[a].start - items[b].start || items[a].end - items[b].end || a - b);
    const ends: number[] = [];
    const points: boolean[] = [];
    for (const k of list) {
      const it = items[k];
      let l = 0;
      while (l < ends.length && !(ends[l] < it.start || (ends[l] === it.start && !(points[l] && it.point)))) l++;
      ends[l] = it.end;
      points[l] = it.point;
      lane[k] = l;
    }
    rows.push({ label, items: list, lanes: ends.length, lane0: 0 });
  }
  if (sort === "start") rows.sort((a, b) => items[a.items[0]].start - items[b.items[0]].start);
  else if (sort === "duration") {
    const total = (r: TimelineRow) => r.items.reduce((s, k) => s + items[k].end - items[k].start, 0);
    const t = new Map(rows.map((r) => [r, total(r)]));
    rows.sort((a, b) => t.get(b)! - t.get(a)!);
  }
  let acc = 0;
  for (const r of rows) {
    r.lane0 = acc;
    acc += r.lanes;
  }
  return { rows, lane };
}
