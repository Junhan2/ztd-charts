import { useMemo, type KeyboardEvent, type ReactNode } from "react";
import { Tag, tagBox } from "../core/annotations";
import { AXIS_FONT, fitTickLabels } from "../core/axis";
import { BrushBand, useChartBrush, useZoom, type BrushProps } from "../core/brush";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { formatDate, formatDuration, makeTickFormatter, withUnit, type DayFirstProps } from "../core/format";
import { argMax, nearestIndex } from "../core/geometry";
import { HIGHLIGHT_KEYWORDS, resolveHighlight } from "../core/highlight";
import { plural, type ChartLang } from "../core/i18n";
import type { Mark } from "../core/motion";
import { categorical, swatch, type Swatch } from "../core/palette";
import { scaleLinear, timeTicks, type TimeTick } from "../core/scale";
import { overlaps, textWidth, truncate, type Box } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Highlight, Row, TooltipData, TooltipRow } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { DAY, readTimeline, timelineDomain, timelineGroups, timelineRows, type TimeKind, type TimelineItem, type TimelineSort } from "../layout/timeline";

const en = {
  kind: "Timeline",
  start: "Start",
  end: "End",
  at: "At",
  duration: "Duration",
  status: "Status",
  group: "Group",
  open: "open",
  now: "Now",
  range: (a: string, b: string) => `${a} to ${b}`,
  desc: (n: number, rows: number, a: string, b: string) => `${plural(n, "item")} on ${plural(rows, "row")}, from ${a} to ${b}`,
  longest: (label: string, d: string) => `Longest: ${label}, ${d}`,
  lines: "Reference lines",
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "타임라인",
    start: "시작",
    end: "끝",
    at: "시각",
    duration: "걸린 시간",
    status: "상태",
    group: "묶음",
    open: "진행 중",
    now: "지금",
    range: (a, b) => `${a}~${b}`,
    desc: (n, rows, a, b) => `항목 ${n}개, 줄 ${rows}개, ${a}부터 ${b}까지`,
    longest: (label, d) => `가장 긴 항목은 ${label}, ${d}`,
    lines: "기준선",
  },
};

/** 시간 축 위 세로 기준선. x는 축과 같은 꼴(숫자나 날짜) */
export interface TimelineReferenceLine {
  x: unknown;
  label?: string;
}

export interface TimelineProps<T = Row> extends BaseChartProps<T>, BrushProps, DayFirstProps {
  /** 줄 이름 필드. 이름이 같은 항목은 한 줄에 놓여요. 기본 "label" */
  label?: Accessor<T, string>;
  /** 시작 필드 (숫자, 날짜, 날짜와 시각). 기본 "start" */
  start?: Accessor<T, unknown>;
  /** 끝 필드. 시작과 같으면 점으로 그리는 사건이고, 비어 있으면 now(없으면 가장 늦은 시각)까지 열린 항목이에요. 기본 "end" */
  end?: Accessor<T, unknown>;
  /** 묶음 필드. 묶음마다 색이 다르고 범례가 이걸로 만들어져요 */
  group?: Accessor<T, string>;
  /** 상태 필드. 막대 안 글자와 툴팁에 적고, group이 없으면 막대 색과 범례를 정해요 (상태 띠) */
  status?: Accessor<T, string>;
  /** 시간 축 종류. 없으면 시작, 끝 칸 중 날짜가 많으면 "date", 아니면 "number". "date"면 숫자도 타임스탬프(10자리는 초)나 연도로 읽어요 */
  xType?: TimeKind;
  /** 줄 순서. "none" 데이터 순서, "start" 이른 시작부터, "duration" 걸린 시간 합이 긴 줄부터. 기본 "none" */
  sort?: TimelineSort;
  /** 시간 축의 세로 기준선 [{ x, label }]. 축 범위 밖이면 그리지 않아요 */
  referenceLines?: readonly TimelineReferenceLine[];
  /** "지금" 세로선의 시각(축과 같은 꼴). 열린 항목은 여기까지 이어요. 그릴 때 시계를 읽지 않아서 서버와 브라우저 그림이 같아요 */
  now?: unknown;
  /** 숨길 묶음(group 값, group이 없으면 status 값). 색과 줄은 모두 보일 때 그대로예요 */
  hidden?: readonly string[];
}

/** 칸(겹친 항목 한 줄) 높이: 기본, 그림 높이 상한, 바닥. 칸이 아주 많으면 바닥(2px)으로 그리고 그만큼 높아져요 */
const LANE_H = 26;
const MAX_PLOT_H = 520;
const MIN_LANE_H = 2;
const AXIS_H = 22;
/** 줄 이름 글자 크기와 한 줄에 필요한 높이. 줄이 이보다 낮으면 몇 줄 건너 하나씩 적어요 */
const ROW_FONT = 11.5;
const ROW_TEXT_H = 13;
/** 막대 위 글자(걸린 시간, 상태): 칸이 이만큼 높을 때만 */
const BAR_TEXT_MIN_LANE = 14;
const BAR_FONT = 11;
/** 시간 축 양끝 안쪽 여백(px): 끝의 점 표시가 그림 밖으로 나가지 않아요 */
const EDGE = 7;
/** 열린 항목(끝이 빈 항목) 채움의 불투명도. 점선 테두리는 진하게, 안 글자는 ink예요 */
const OPEN_TINT = 0.28;
/** 막대의 최소 폭(px). 긴 축의 짧은 항목도 보이고 짚을 수 있어요 (툴팁과 낭독은 실제 걸린 시간이에요) */
const MIN_BAR_W = 3;
/** 등장 지연의 상한(ms). 항목이 많아도 등장이 끝없이 늘어지지 않아요 */
const MAX_DELAY = 600;

/**
 * 시간 눈금. 분, 초 단위가 필요한 짧은 범위(눈금 간격 30분 이하)와 해 단위 범위는 여기서 고르고, 그 사이(시, 일, 주, 월, 분기)는 라인 차트와 같은 timeTicks예요.
 * 해 단위는 1, 2, 5, 10, 20, 50년 간격의 배수 해 1월 1일에 놓아요(2000, 2005, 2010)
 */
function clockTicks(t0: number, t1: number, max: number, locale: string): TimeTick[] {
  const want = (t1 - t0) / Math.max(1, max);
  // timeTicks가 해 단위를 고르는 범위(눈금 간격이 여섯 달 넘게)와 같아요
  if (t1 > t0 && want > DAY * 30.44 * 6) {
    const y0 = new Date(t0).getFullYear();
    const years = new Date(t1).getFullYear() - y0;
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((k) => years / k <= max) ?? 1000;
    const out: TimeTick[] = [];
    for (let y = Math.ceil(y0 / step) * step, n = 0; n < 500; y += step, n++) {
      const t = new Date(y, 0, 1).getTime();
      if (t > t1) break;
      if (t >= t0) out.push({ t, label: formatDate(t, { locale, year: "numeric" }) });
    }
    if (out.length >= 2) return out;
  }
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800].map((s) => s * 1000).find((s) => s >= want);
  if (!(t1 > t0) || step === undefined) return timeTicks(t0, t1, max, locale);
  const fmt: Intl.DateTimeFormatOptions = step < 60000 ? { hour: "numeric", minute: "2-digit", second: "2-digit" } : { hour: "numeric", minute: "2-digit" };
  // 로컬 시각으로 맞춰요 (+5:30 같은 시간대도 정각, 30분에 눈금)
  const off = new Date(t0).getTimezoneOffset() * 60000;
  const out: TimeTick[] = [];
  for (let t = Math.ceil((t0 - off) / step) * step + off, n = 0; t <= t1 && n < 500; t += step, n++) out.push({ t, label: formatDate(t, { locale, ...fmt }) });
  return out;
}

/** 강조 목록에서 묶음 이름을 골라 그 묶음의 자리로. 색(categorical의 강조)과 카드 범례가 같이 써요 */
export function timelineGroupHighlight(h: Highlight<never> | undefined, groups: readonly string[]): Set<number> {
  const list = typeof h === "string" ? [h] : Array.isArray(h) ? h : [];
  const out = new Set<number>();
  for (const x of list) if (typeof x === "string" && !HIGHLIGHT_KEYWORDS.includes(x)) groups.forEach((g, i) => g === x && out.add(i));
  return out;
}

/** 정렬된 배열에서 v 이상(after면 v 초과)인 첫 자리. 없으면 길이 */
function bound(sorted: readonly number[], v: number, after = false): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (after ? sorted[mid] <= v : sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 타임라인: 시작과 끝이 있는 일(일정, 배포와 작업 실행, 에이전트 실행 기록, 장애 경과)을 시간 축 위 막대로.
 * 이름이 같은 항목은 한 줄에 놓고, 겹치면 칸을 나눠 가리지 않아요. 시작과 끝이 같으면 점이에요
 */
export function Timeline<T = Row>(props: TimelineProps<T>) {
  const model = useMemo(
    () => readTimeline(props.data, { label: props.label, start: props.start, end: props.end, group: props.group, status: props.status }, { xType: props.xType, dayFirst: props.dayFirst, now: props.now }),
    [props.data, props.label, props.start, props.end, props.group, props.status, props.xType, props.dayFirst, props.now],
  );
  const { items, kind, dateOnly } = model;
  const sort: TimelineSort = props.sort === "start" || props.sort === "duration" ? props.sort : "none";
  const { rows, lane } = useMemo(() => timelineRows(items, sort), [items, sort]);
  const lanes = rows.reduce((s, r) => s + r.lanes, 0);
  // 스펙에서 오면 배열이 아닐 수도 있어요 (검사기가 알려요)
  const refLines = Array.isArray(props.referenceLines) ? props.referenceLines : [];
  const top = refLines.length > 0 || props.now !== undefined ? 24 : 6;
  const c = useChart(props, { height: () => top + AXIS_H + Math.max(40, Math.min(lanes * LANE_H, MAX_PLOT_H), lanes * MIN_LANE_H), duration: 700, stagger: 40 });
  const { p, width: W, height: H, locale, fv } = c;
  const msg = MSG[c.lang];
  const zoom = useZoom(c.sig);

  // 키보드, 표, 강조의 순서: 줄 순서, 줄 안에서는 시간 순서. order[e]는 items의 위치
  const order = useMemo(() => rows.flatMap((r) => r.items), [rows]);
  // 색을 나누는 값: group, 없으면 status(상태 띠). 카드 범례와 같은 행, 같은 규칙으로 (못 읽어 뺀 행의 값도 색 자리를 지켜요)
  const byStatus = props.group === undefined;
  const colorField = byStatus ? props.status : props.group;
  const keyOf = (it: TimelineItem) => (byStatus ? it.status : it.group);
  const groups = useMemo(() => (colorField === undefined ? [] : timelineGroups(props.data, colorField, byStatus)), [props.data, colorField, byStatus]);
  const groupOf = useMemo(() => new Map(groups.map((g, i) => [g, i])), [groups]);
  const hl = props.highlight;
  // 묶음 이름으로 강조한 묶음은 강조색이 곧 강조예요. 그 밖의 강조 항목(가장 긴 항목, 줄 이름)은 묶음 색 위에 테두리를 둘러요
  const namedGroups = useMemo(() => timelineGroupHighlight(hl as Highlight<never>, groups), [hl, groups]);
  const hiItems = useMemo(() => {
    const dur = order.map((k) => items[k].end - items[k].start);
    const at = resolveHighlight(hl, order.map((k) => items[k].datum), order.map((k) => items[k].label), dur, groups.length ? "none" : "max");
    const out = new Set([...at].map((e) => order[e]));
    // 묶음 이름으로 강조하면 그 묶음의 항목 모두
    if (namedGroups.size) items.forEach((it, k) => namedGroups.has(groupOf.get(keyOf(it)) ?? -1) && out.add(k));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hl, order, items, groups.length, groupOf, namedGroups, byStatus]);
  const colors = useMemo<Swatch[] | null>(() => (groups.length ? categorical(p, groups.length, namedGroups) : null), [p, groups, namedGroups]);
  const hiddenKey = Array.isArray(props.hidden) ? props.hidden.join("\u0001") : "";
  const off = useMemo(() => new Set(groups.length && hiddenKey ? hiddenKey.split("\u0001") : []), [groups.length, hiddenKey]);

  // 항목의 시작, 끝 시각 (끌어서 확대가 여기에 붙어요)
  const bounds = useMemo(() => Array.from(new Set(items.flatMap((it) => [it.start, it.end]))).sort((a, b) => a - b), [items]);
  const lo = bounds.length ? bounds[0] : 0;
  const hi = bounds.length ? bounds[bounds.length - 1] : 1;
  const full = useMemo(() => timelineDomain(model), [model]);
  const zv = zoom.view && bounds[zoom.view[1]] > bounds[zoom.view[0]] ? zoom.view : null;
  const v0 = zv ? bounds[zv[0]] : full[0];
  const v1 = zv ? bounds[zv[1]] : full[1];

  // 시각 글자: 숫자는 값 + 단위, 날짜만 있으면 월 일(여러 해에 걸치면 연도까지), 하루 안이면 시각, 그 밖은 날짜와 시각
  const timeFmt = useMemo((): Intl.DateTimeFormatOptions => {
    if (dateOnly) return new Date(lo).getFullYear() === new Date(hi).getFullYear() ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" };
    const clock: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", ...(model.hasSeconds ? { second: "2-digit" } : {}) };
    return hi - lo < DAY * 1.5 ? clock : { month: "short", day: "numeric", ...clock };
  }, [dateOnly, model.hasSeconds, lo, hi]);
  const tText = (t: number) => (kind === "number" ? fv(t) : formatDate(t, { locale, ...timeFmt }));
  // 걸린 시간: 숫자 축은 값 + 단위, 날짜만 있으면 날 수(서머타임이 낀 날도 하루), 그 밖은 "2d 4h" 꼴. 툴팁, 막대 글자, 구간 고르기가 같이 써요
  const spanText = (ms: number) => (kind === "number" ? fv(ms) : formatDuration(dateOnly ? Math.round(ms / DAY) * DAY : ms, locale));
  // 항목마다 바뀌지 않는 글자: 걸린 시간과 그 폭(보통, 강조 굵기). 등장 중 매 프레임 다시 만들지 않아요
  const durs = useMemo(() => {
    const text = items.map((it) => spanText(it.end - it.start));
    return { text, w: text.map((s) => textWidth(s, BAR_FONT, 600)), wHi: text.map((s) => textWidth(s, BAR_FONT, 800)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, kind, dateOnly, fv, locale]);

  // 줄 이름 칸, 그림 영역
  const longestLabel = useMemo(() => rows.reduce((w, r) => Math.max(w, textWidth(r.label, ROW_FONT, 700)), 24), [rows]);
  const labelW = Math.min(W * 0.32, longestLabel + 10);
  const x0 = labelW + 10;
  const x1 = Math.max(x0 + 10, W - 16);
  const plotBottom = H - AXIS_H;
  const laneH = (plotBottom - top) / Math.max(1, lanes);
  const bh = laneH >= 6 ? Math.min(18, Math.max(4, laneH * 0.62)) : Math.max(1, laneH * 0.8);
  // 양끝 안쪽으로 점 표시 반폭만큼 (축 끝의 점이 줄 이름에 붙지 않게)
  const xs = scaleLinear([v0, v1], [x0 + EDGE, x1 - EDGE]);
  const rowOf = useMemo(() => {
    const m = new Int32Array(items.length);
    rows.forEach((r, ri) => r.items.forEach((k) => (m[k] = ri)));
    return m;
  }, [rows, items.length]);
  const yOf = (k: number) => top + (rows[rowOf[k]].lane0 + lane[k] + 0.5) * laneH;

  // 보이는 항목: 숨긴 묶음이 아니고 지금 범위에 걸쳐요. events는 이 순서예요
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shown = useMemo(() => order.filter((k) => !off.has(keyOf(items[k])) && items[k].end >= v0 && items[k].start <= v1), [order, off, items, v0, v1, byStatus]);
  const eventOf = useMemo(() => new Map(shown.map((k, e) => [k, e])), [shown]);

  const stg = c.motion.stagger ?? 40;
  const textOn = c.showLabels && laneH >= BAR_TEXT_MIN_LANE;
  const marks = useMemo<Mark<number>[]>(() => {
    const seen = new Map<string, number>();
    return shown.map((k, e) => {
      const it = items[k];
      const n = (seen.get(it.label) ?? 0) + 1;
      seen.set(it.label, n);
      const xa = Math.max(x0, Math.min(x1, xs(it.start)));
      const xb = it.point ? xa : Math.max(xa + MIN_BAR_W, Math.min(x1, xs(it.end)));
      const y = yOf(k);
      return { key: `${it.label}\u0001${n}`, to: [xa, xb, 1, y], from: [xa, xa, 0, y], delay: Math.min(e * stg, MAX_DELAY), data: k };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, items, rows, rowOf, lane, x0, x1, v0, v1, top, laneH, stg]);
  const m = useMotion(marks, c.motion);

  // 막대 안 상태 글자: 도착한 폭으로 한 번만 줄여요 (등장 중 매 프레임 줄이지 않아요). 점은 줄이지 않고 폭만 재요
  const statusFit = useMemo(() => {
    const out = new Map<number, { text: string; w: number }>();
    if (!textOn) return out;
    for (const mk of marks) {
      const it = items[mk.data];
      if (!it.status) continue;
      const text = it.point ? it.status : truncate(it.status, Math.max(1, mk.to[1] - mk.to[0]) - 12, BAR_FONT, 600);
      out.set(mk.data, { text, w: textWidth(text, BAR_FONT, 600) });
    }
    return out;
  }, [marks, items, textOn]);

  // 묶음이 빈 항목은 묶음 색 없이 회색이에요 (범례에도 없어요)
  const swOf = (k: number): Swatch => {
    const g = groupOf.get(keyOf(items[k]));
    return colors && g !== undefined ? colors[g] : swatch(p, !colors && hiItems.has(k) ? "accent" : "neutral");
  };

  // 같은 칸 다음 항목의 시작(px): 걸린 시간 글자를 막대 뒤에 쓸 자리
  const nextX = useMemo(() => {
    const out = new Float64Array(items.length).fill(W - 2);
    for (const r of rows) {
      const last = new Map<number, number>();
      for (const k of r.items) {
        if (off.has(keyOf(items[k]))) continue;
        const prev = last.get(lane[k]);
        if (prev !== undefined) out[prev] = xs(items[k].start);
        last.set(lane[k], k);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, items, lane, off, W, x0, x1, v0, v1, byStatus]);

  const events: ChartEvent<T>[] = useMemo(
    () =>
      shown.map((k, e) => {
        const it = items[k];
        const when = it.point ? tText(it.start) : `${msg.range(tText(it.start), tText(it.end))}, ${durs.text[k]}`;
        return { datum: it.datum, index: e, key: `${it.label}#${it.i}`, label: it.label, value: it.end - it.start, ...(it.group && { series: it.group }), formatted: `${when}${it.status ? `, ${it.status}` : ""}` };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, items, msg, durs, fv, locale, timeFmt, kind],
  );

  // 끌어서 확대 (라인 차트의 brush). 구간은 지금 범위 안 항목의 시작, 끝 시각에 붙어요
  const { b0, visB, visX } = useMemo(() => {
    const a = bound(bounds, v0);
    const vis = bounds.slice(a, Math.max(a, bound(bounds, v1, true)));
    return { b0: a, visB: vis, visX: vis.map((t) => xs(t)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, v0, v1, x0, x1]);
  const activeK = c.active !== null ? shown[c.active] : undefined;
  const { brush, frame: brushFrame, hint } = useChartBrush({ brush: props.brush ? "zoom" : false, onBrush: props.onBrush }, zoom, {
    p,
    active: activeK === undefined ? null : Math.max(0, nearestIndex(visB, items[activeK].start)),
    lang: c.lang,
    count: visB.length,
    indexAt: (px) => nearestIndex(visX, px),
    inPlot: (px, py) => px >= x0 - 4 && px <= x1 + 4 && py >= top && py <= plotBottom,
    toXRange: (r) => ({ from: b0 + r.from, to: b0 + r.to, fromKey: String(visB[r.from]), toKey: String(visB[r.to]), fromLabel: tText(visB[r.from]), toLabel: tText(visB[r.to]) }),
  });

  // 포인터: 그 높이의 칸에서 x를 품은 항목, 없으면 10px 안에서 가장 가까운 항목
  const pick = (px: number, py: number): number | null => {
    const g = Math.floor((py - top) / laneH);
    if (g < 0 || g >= lanes) return null;
    let lo2 = 0;
    let hi2 = rows.length - 1;
    while (lo2 < hi2) {
      const mid = (lo2 + hi2 + 1) >> 1;
      if (rows[mid].lane0 <= g) lo2 = mid;
      else hi2 = mid - 1;
    }
    const r = rows[lo2];
    let best: number | null = null;
    let bd = 10;
    for (const k of r.items) {
      const e = eventOf.get(k);
      if (e === undefined || lane[k] !== g - r.lane0) continue;
      const a = xs(items[k].start);
      const d = Math.max(0, a - px, px - Math.max(xs(items[k].end), items[k].point ? a : a + MIN_BAR_W));
      if (d < bd || (d === 0 && bd === 0)) {
        bd = d;
        best = e;
      }
    }
    return best;
  };

  // 키보드: 위아래는 줄, 좌우는 같은 줄의 시간 순서. 다른 줄로 갈 때는 시작이 가장 가까운 항목으로
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (brushFrame.onKey?.(e)) return true;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "ArrowLeft" && e.key !== "ArrowRight") return false;
    if (!shown.length) return true;
    if (activeK === undefined) {
      c.setActive(e.key === "ArrowUp" || e.key === "ArrowLeft" ? shown.length - 1 : 0, "keyboard");
      return true;
    }
    const ri = rowOf[activeK];
    const inRow = (r: number) => rows[r].items.filter((k) => eventOf.has(k));
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const list = inRow(ri);
      const next = list[list.indexOf(activeK) + (e.key === "ArrowRight" ? 1 : -1)];
      if (next !== undefined) c.setActive(eventOf.get(next)!, "keyboard");
      return true;
    }
    const step = e.key === "ArrowDown" ? 1 : -1;
    for (let r = ri + step; r >= 0 && r < rows.length; r += step) {
      const list = inRow(r);
      if (!list.length) continue;
      const t = items[activeK].start;
      const near = list.reduce((a, k) => (Math.abs(items[k].start - t) < Math.abs(items[a].start - t) ? k : a), list[0]);
      c.setActive(eventOf.get(near)!, "keyboard");
      break;
    }
    return true;
  };

  let tip: TooltipData | null = null;
  let announce = "";
  if (activeK !== undefined && !brush.dragging) {
    const it = items[activeK];
    const sw = swOf(activeK);
    const tr: TooltipRow[] = it.point
      ? [{ label: msg.at, value: tText(it.start), color: sw.fill }]
      : [
          { label: msg.start, value: tText(it.start), strong: false },
          { label: msg.end, value: it.open ? `${tText(it.end)} (${msg.open})` : tText(it.end), strong: false },
          { label: msg.duration, value: durs.text[activeK], color: sw.fill },
        ];
    if (it.group) tr.push({ label: msg.group, value: it.group, strong: false });
    if (it.status) tr.push({ label: msg.status, value: it.status, strong: false });
    const xa = Math.max(x0, xs(it.start));
    const xb = Math.max(xa + (it.point ? 0 : MIN_BAR_W), Math.min(x1, xs(it.end)));
    tip = { x: (xa + xb) / 2, y: yOf(activeK) - bh / 2, title: it.label, rows: tr };
    if (c.via === "keyboard") announce = `${it.label}, ${events[c.active!].formatted}`;
  }

  // 끄는 중인 구간
  let brushLayer: ReactNode = null;
  if (brush.range && brush.range.to < visB.length) {
    const a = visB[brush.range.from];
    const b = visB[brush.range.to];
    const span = spanText(b - a);
    brushLayer = <BrushBand p={p} x0={xs(a)} x1={xs(b)} top={top} bottom={plotBottom} width={W} main={span} sub={msg.range(tText(a), tText(b))} dragging={brush.dragging} />;
    if (!brush.dragging) announce = `${msg.range(tText(a), tText(b))}, ${span}.${hint}`;
  }

  // 눈금: 숫자는 값 + 단위, 날짜는 범위에 맞는 단위(초부터 연까지)
  const maxTicks = Math.max(2, Math.floor((x1 - x0) / (kind === "number" ? 70 : 64)));
  // 숫자 눈금은 다른 숫자 축과 같은 꼴: 큰 수는 짧게(2T), format을 정했으면 그 꼴. 툴팁과 낭독은 전체 숫자예요
  const userFormat = props.format;
  const unit = props.unit;
  const ticks = useMemo(
    () => {
      const tf = withUnit(makeTickFormatter(userFormat, locale, Math.max(Math.abs(v0), Math.abs(v1))), unit);
      return fitTickLabels(kind === "number" ? xs.ticks(maxTicks).map((t) => ({ x: xs(t), label: tf(t) })) : clockTicks(v0, v1, maxTicks, locale).map((t) => ({ x: xs(t.t), label: t.label })), -2, W + 2);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, maxTicks, v0, v1, x0, x1, W, userFormat, unit, locale],
  );

  // 기준선: 범위 안의 것만. 이름표는 위 띠에 두고, 앞 이름표와 겹치면 선만 그려요
  const lines = [
    ...refLines.map((r) => ({ t: model.read(r?.x), label: typeof r?.label === "string" ? r.label : "", now: false })),
    ...(props.now !== undefined ? [{ t: model.read(props.now), label: msg.now, now: true }] : []),
  ].filter((l) => Number.isFinite(l.t) && l.t >= v0 && l.t <= v1);
  const taken: Box[] = [];
  const lineNodes = lines.map((l, i) => {
    const x = xs(l.t);
    const text = l.label ? truncate(l.label, 140, 10.5, l.now ? 700 : 500) : "";
    const left = x + tagBox(text, 0, 0, "start", l.now).w + 2 > W;
    const box = text ? tagBox(text, left ? x - 3 : x + 3, top - 14, left ? "end" : "start", l.now) : null;
    const fits = box !== null && box.x >= 0 && !taken.some((o) => overlaps(box, o, 4));
    if (fits) taken.push(box);
    return (
      <g key={i}>
        <line x1={x} x2={x} y1={top - (fits ? 14 : 2)} y2={plotBottom} stroke={p.paint(l.now ? "ink" : "dim")} strokeOpacity={l.now ? 0.55 : 1} strokeDasharray={l.now ? "2 3" : "4 3"} />
        {fits ? <Tag p={p} x={left ? x - 3 : x + 3} y={top - 14} text={text} anchor={left ? "end" : "start"} strong={l.now} /> : null}
      </g>
    );
  });

  // 줄 이름: 줄이 낮으면 k줄마다 하나 (겹치지 않게). 등장 중에는 바뀌지 않고, 짚은 줄이 바뀔 때만 다시 만들어요
  const activeRow = activeK === undefined ? -1 : rowOf[activeK];
  const rowNodes = useMemo(() => {
    const minLanes = rows.reduce((mn, r) => Math.min(mn, r.lanes), Infinity);
    const every = Math.max(1, Math.ceil(ROW_TEXT_H / Math.max(0.01, Math.min(minLanes * laneH, LANE_H))));
    const split = rows.some((r) => r.lanes > 1);
    let lastY = -Infinity;
    return rows.map((r, ri) => {
      const y = top + (r.lane0 + r.lanes / 2) * laneH;
      const show = ri % every === 0 && y - lastY >= ROW_TEXT_H;
      if (show) lastY = y;
      const strong = ri === activeRow || r.items.some((k) => hiItems.has(k));
      return (
        <g key={ri}>
          {split && ri ? <line x1={0} x2={W} y1={top + r.lane0 * laneH} y2={top + r.lane0 * laneH} stroke={p.paint("line")} opacity={0.7} /> : null}
          {show ? (
            <Txt x={labelW} y={y} anchor="end" size={ROW_FONT} weight={strong ? 700 : 600} fill={p.paint(strong ? "ink" : "muted")}>
              {truncate(r.label, labelW - 4, ROW_FONT, 700)}
            </Txt>
          ) : null}
        </g>
      );
    });
  }, [rows, laneH, top, labelW, W, p, hiItems, activeRow]);

  const D = c.motion.duration ?? 700;
  const rad = Math.min(p.theme.radiusMark, bh / 2);
  const longest = useMemo(() => (shown.length ? shown[argMax(shown.map((k) => items[k].end - items[k].start))] : -1), [shown, items]);
  const linesText = lines.length ? ` ${msg.lines}: ${lines.map((l) => `${l.label ? `${l.label} ` : ""}${tText(l.t)}`).join(", ")}.` : "";
  const desc = props.description ?? (shown.length ? `${msg.kind}. ${msg.desc(shown.length, rows.length, tText(v0 > lo ? v0 : lo), tText(v1 < hi ? v1 : hi))}. ${longest >= 0 && !items[longest].point ? `${msg.longest(items[longest].label, durs.text[longest])}.` : ""}${linesText}`.trim() : "");

  return (
    <ChartFrame
      c={c}
      kind={msg.kind}
      ariaLabel={props.ariaLabel}
      description={desc}
      events={events}
      tip={tip}
      renderTip={props.tooltip}
      announce={announce || undefined}
      className={props.className}
      style={props.style}
      theme={props.theme}
      onPointerDown={brushFrame.onPointerDown}
      onPointerUp={brushFrame.onPointerUp}
      overlay={brushFrame.overlay}
      onPointerMove={(px, py, e) => {
        if (brush.move(px)) return;
        const k = pick(px, py);
        if (k !== c.active) c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer");
      }}
      onKey={onKey}
    >
      <g aria-hidden="true">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={t.x} x2={t.x} y1={top} y2={plotBottom} stroke={p.paint("line")} />
            <Txt x={t.x} y={plotBottom + 12} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
              {t.label}
            </Txt>
          </g>
        ))}
        {rowNodes}
      </g>
      {m.items.map((mi) => {
        if (mi.exiting) return null;
        const k = mi.data;
        const e = eventOf.get(k);
        if (e === undefined) return null;
        const it = items[k];
        const [xa, xb, o, y] = mi.v;
        const sw = swOf(k);
        const isHi = hiItems.has(k);
        const ringed = (c.active === e && c.via === "keyboard") || (colors !== null && isHi && !namedGroups.has(groupOf.get(keyOf(it)) ?? -1));
        const op = c.dim(e) * Math.min(1, o * 1.5);
        const fade = m.fade(Math.min(e * stg, MAX_DELAY) + D * 0.4, 260);
        const status = statusFit.get(k);
        if (it.point) {
          const s = Math.max(3, Math.min(bh, 12) / 2 + 1);
          return (
            <g key={mi.key} opacity={op}>
              <path d={`M${xa} ${y - s}L${xa + s} ${y}L${xa} ${y + s}L${xa - s} ${y}Z`} fill={sw.fill} stroke={p.paint(ringed ? "ink" : "panel")} strokeWidth={ringed ? 2 : 1} className="ztd-mark" onClick={() => c.click(e)} />
              {status && xa + s + 6 + status.w < nextX[k] - 4 ? (
                <Txt x={xa + s + 6} y={y} size={BAR_FONT} weight={600} fill={p.paint("muted")} opacity={fade}>
                  {status.text}
                </Txt>
              ) : null}
            </g>
          );
        }
        const w = Math.max(1, xb - xa);
        const dur = textOn ? durs.text[k] : "";
        const dw = isHi ? durs.wHi[k] : durs.w[k];
        const durOut = dur && xa + w + 6 + dw < nextX[k] - 4;
        // 상태가 있는 항목은 막대 안이 상태 자리예요. 상태가 안 들어가도 걸린 시간으로 바꿔 쓰지 않아요 (상태 띠에 상태와 시간이 섞이지 않게)
        const durIn = dur && !durOut && !it.status && dw + 12 <= w;
        return (
          <g key={mi.key} opacity={op}>
            <rect
              x={xa}
              y={y - bh / 2}
              width={w}
              height={bh}
              rx={rad}
              fill={sw.fill}
              fillOpacity={it.open ? OPEN_TINT : 1}
              stroke={ringed ? p.paint("ink") : it.open ? sw.fill : "none"}
              strokeWidth={ringed ? 2 : 1}
              strokeDasharray={it.open ? "3 2" : undefined}
              className="ztd-mark"
              onClick={() => c.click(e)}
            />
            {status?.text ? (
              <Txt x={xa + 6} y={y} size={BAR_FONT} weight={600} fill={it.open ? p.paint("ink") : sw.text} opacity={fade}>
                {status.text}
              </Txt>
            ) : null}
            {durOut || durIn ? (
              <Txt x={durOut ? xa + w + 6 : xa + w - 6} y={y} anchor={durOut ? "start" : "end"} size={BAR_FONT} weight={isHi ? 800 : 600} fill={durIn ? (it.open ? p.paint("ink") : sw.text) : p.paint(isHi ? "ink" : "muted")} opacity={fade}>
                {dur}
              </Txt>
            ) : null}
          </g>
        );
      })}
      <g aria-hidden="true" pointerEvents="none">
        {lineNodes}
      </g>
      {brushLayer}
    </ChartFrame>
  );
}
