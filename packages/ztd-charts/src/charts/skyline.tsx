import { useId, useMemo, useState, type ReactNode } from "react";
import { AXIS_FONT, thinLabels } from "../core/axis";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { formatPercent, makeTickFormatter, type ValueFormatter } from "../core/format";
import { evenIndex } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import { plural, type ChartLang } from "../core/i18n";
import type { Mark, MotionItem } from "../core/motion";
import { emphasis, ramp, swatch, type Swatch } from "../core/palette";
import { fitDomain, niceDomain, ticksFor } from "../core/scale";
import { prepSeries, syncKeyOf } from "../core/series";
import { useSync } from "../core/sync";
import { textWidth } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData, TooltipRow } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { luminance, parseColor } from "../theme/color";
import type { Painter } from "../theme/context";

type RowName = "back" | "front";

const en = {
  kind: "Skyline",
  /** 이벤트의 series와 라이브 영역에 쓰는 줄 이름 */
  row: { back: "back", front: "front" },
  total: { back: "Back total", front: "Front total" },
  sum: "total",
  /** 앞줄이 없을 때 툴팁의 합계 */
  sumLabel: "Total",
  rate: "Front ÷ back",
  peak: (v: string) => `Peak ${v}`,
  frontPeak: (label: string, v: string, rate: string) => `Front peak ${label} · ${v}${rate ? ` (${rate})` : ""}`,
  range: (a: string, b: string) => `${a}–${b}`,
  nothing: "Nothing to draw",
  ofBack: (rate: string) => `${rate} of the back row`,
  /** 숨긴 표 한 칸: 줄 이름, 합계, 계열 목록 */
  cell: (row: string, total: string, list: string) => `${row ? `${row} ` : ""}${total}${list ? ` (${list})` : ""}`,
  desc: (nB: number, names: string, from: string, to: string) => `${plural(nB, "series", "series")} (${names}) stacked from ${from} to ${to}`,
  descPeak: (at: string, v: string) => `Peak period ${at} at ${v}`,
  descFront: (names: string, at: string, v: string, rate: string) => `Front row (${names}) peaks at ${at} with ${v}${rate ? `, ${rate} of the back row` : ""}`,
  descFrontZero: (names: string) => `The front row (${names}) is all zero`,
  merged: (k: number) => `Neighboring periods are summed in groups of ${k}`,
  keys: "Use left and right arrows for periods, up and down to switch rows.",
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "스카이라인",
    row: { back: "뒷줄", front: "앞줄" },
    total: { back: "뒷줄 합계", front: "앞줄 합계" },
    sum: "합계",
    sumLabel: "합계",
    rate: "앞줄 ÷ 뒷줄",
    peak: (v) => `최고 ${v}`,
    frontPeak: (label, v, rate) => `앞줄 최고 ${label} · ${v}${rate ? ` (${rate})` : ""}`,
    range: (a, b) => `${a}~${b}`,
    nothing: "그릴 값이 없어요",
    ofBack: (rate) => `뒷줄의 ${rate}`,
    cell: (row, total, list) => `${row ? `${row} ` : ""}${total}${list ? `(${list})` : ""}`,
    desc: (nB, names, from, to) => `계열 ${nB}개(${names})를 ${from}부터 ${to}까지 쌓았어요`,
    descPeak: (at, v) => `가장 많은 기간 ${at} ${v}`,
    descFront: (names, at, v, rate) => `앞줄(${names})이 가장 많은 기간 ${at} ${v}${rate ? `, 뒷줄의 ${rate}` : ""}`,
    descFrontZero: (names) => `앞줄(${names})은 모두 0이에요`,
    merged: (k) => `이웃 기간을 ${k}개씩 합쳤어요`,
    keys: "←→로 기간을, ↑↓로 앞줄과 뒷줄을 옮겨요.",
  },
};

export interface SkylineChartProps<T = Row> extends BaseChartProps<T> {
  /** 기간 필드. 날짜, 숫자, 범주 모두 돼요. 기본 "x" */
  x?: Accessor<T, unknown>;
  /** 뒷줄에 쌓을 값 필드. 배열이면 넓은 표의 여러 열 */
  y?: Accessor<T, number> | string[];
  /** 계열 필드 (긴 표, 뒷줄만) */
  series?: Accessor<T, string>;
  /** 앞줄에 쌓을 필드 (넓은 표만). 뒷줄과 같은 단위의 작은 결과(실패, 재시도) */
  front?: string | string[];
  /** 칸 폭 대비 뒷줄 깊이. 0.1~0.32, 기본 0.32 */
  depth?: number;
  /** 뒷벽 눈금. 기본 true */
  wall?: boolean;
  /** 빗금을 그릴 줄. 기본 "front" */
  texture?: "front" | "all" | "none";
  /** 앞줄 합계가 뒷줄의 몇 %인지: "label"(라벨과 툴팁), "strip"(바닥 아래 비율 띠), false(숨김). 기본 "label" */
  frontRate?: "label" | "strip" | false;
  /** 강조: 계열이 여럿이면 계열 이름(앞줄 이름도 돼요, 기본 첫 계열), 하나면 기간(기본 가장 큰 기간). 판별 함수는 계열이 하나일 때 기간의 행을 받아요 */
  highlight?: BaseChartProps<T>["highlight"];
}

/** 칸 폭에 대한 비율. 시안(skyline-mock.mjs)이 폭 4가지 × 기간 3가지 × 깊이 2가지로 잰 값이에요 */
const FACE = 0.52;
const FRONT_DEPTH = 0.14;
const GAP = 0.05;
export const DEPTH_RANGE: readonly [number, number] = [0.1, 0.32];
/** 칸이 이보다 좁으면 이웃 기간을 합쳐요 */
const MIN_SLOT = 20;
/** 합쳐서라도 이보다 많은 기간은 그리지 않아요 (숨긴 표 60행 안) */
const MAX_SHOWN = 40;
/** 깊이 방향: 오른쪽 위로 2:1 (26.57°). 2/√5, 1/√5를 숫자로 적어요 (Math.sqrt 호출은 번들러가 지우지 못해 다른 차트 묶음에도 남아요) */
const COS = 0.8944271909999159;
const SIN = 0.4472135954999579;
/** 첫 기간 앞 여백, 맨 위 눈금 위 최고 라벨 자리, 바닥 판 두께 */
const X0 = 10;
const LABEL_ROOM = 20;
const SLAB = 4;
/** 비율 띠 높이 */
const STRIP_H = 26;
const LEGEND_LINE = 18;

const BOTH_ROWS: readonly RowName[] = ["back", "front"];
const BACK_ROW: readonly RowName[] = ["back"];

const r1 = (v: number) => Math.round(v * 10) / 10;
const pts = (list: [number, number][]) => list.map(([x, y]) => `${r1(x)},${r1(y)}`).join(" ");
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
/** 가운데 정렬 글자의 x를 폭 width 안으로 당겨요 */
const inside = (x: number, text: string, size: number, width: number, weight = 400) => {
  const half = textWidth(text, size, weight) / 2;
  return Math.max(half + 2, Math.min(width - half - 2, x));
};

/** 그림 폭 plotW에 기간 n개를 놓을 때 몇 개씩 합칠지. 칸이 MIN_SLOT 이상이고 보이는 기간이 MAX_SHOWN 이하가 되는 가장 작은 수 */
export function mergeFactor(plotW: number, n: number): number {
  for (let k = 1; k < n; k++) {
    const shown = Math.ceil(n / k);
    if (shown <= MAX_SHOWN && plotW / (shown + 0.55) >= MIN_SLOT) return k;
  }
  return Math.max(1, n);
}

/**
 * 보이는 기간 i가 덮는 원래 기간 [시작, 끝). 묶음은 끝에서부터 세서, 덜 찬 묶음이 생기면 가장 오래된 첫 묶음이에요
 * (가장 최근 블록이 덜 차면 갑자기 줄어든 것처럼 읽혀요)
 */
export function groupRange(i: number, n: number, k: number): [number, number] {
  const first = n - k * (Math.ceil(n / k) - 1);
  return i === 0 ? [0, first] : [first + (i - 1) * k, first + i * k];
}

/** [계열][기간] 값을 k개씩 더해 [보이는 기간][계열]로. 음수와 빈 값은 0이에요 (스카이라인은 0부터 쌓아요) */
function sumGroups(values: readonly number[][], n: number, k: number): number[][] {
  return Array.from({ length: Math.ceil(n / k) }, (_, i) => {
    const [a, b] = groupRange(i, n, k);
    return values.map((row) => sum(row.slice(a, b).map((v) => (Number.isFinite(v) && v > 0 ? v : 0))));
  });
}

export interface SkylineInput {
  width: number;
  height: number;
  /** [계열][기간], 합치기 전 */
  back: readonly number[][];
  front: readonly number[][];
  /** 기간 수 */
  n: number;
  depth: number;
  wall: boolean;
  /** 위쪽 범례 높이 */
  legendH: number;
  /** 바닥 판 아래 자리 (날짜, 앞줄 최고 라벨, 비율 띠) */
  below: number;
  /** 눈금 글자 포맷터. 눈금 맨 위 값을 받아요 */
  tickFmt: (max: number) => ValueFormatter;
}

export interface SkylineLayout {
  /** 몇 기간씩 합쳤는지. 1이면 그대로 */
  merge: number;
  shown: number;
  /** [보이는 기간][계열] (합친 뒤) */
  back: number[][];
  front: number[][];
  backTotal: number[];
  frontTotal: number[];
  ticks: number[];
  fmt: ValueFormatter;
  /** 값 1이 몇 px인지. 두 줄이 같은 눈금이에요 */
  k: number;
  /** 칸 폭, 앞면 폭 */
  s: number;
  w: number;
  /** 앞줄 바닥(앞 모서리), 뒷벽 바닥, 눈금 맨 위의 y */
  floor: number;
  wallBase: number;
  top: number;
  /** 뒷줄이 앞줄에서 물러난 거리 (오른쪽, 위) */
  shift: [number, number];
  depthFront: number;
  depthBack: number;
  /** 뒷벽 x 범위 */
  wallX: [number, number];
  /** 기간 i 앞면의 왼쪽 x */
  slotX: (i: number) => number;
}

/** 수평 바닥 배치: 기간은 왼쪽에서 오른쪽, 깊이만 2:1로 물러나요. 칸 폭 s = 그림 폭 / (보이는 기간 + 0.55) */
export function skylineLayout(o: SkylineInput): SkylineLayout {
  const depth = Math.min(DEPTH_RANGE[1], Math.max(DEPTH_RANGE[0], o.depth));
  const plotWidth = (labelW: number) => o.width - X0 - (o.wall ? labelW + 14 : 8);
  let k = 0;
  let labelW = 0;
  let back: number[][] = [];
  let front: number[][] = [];
  let dom: [number, number] = [0, 1];
  // 눈금 글자 폭이 그림 폭을, 그림 폭이 합칠 수를, 합친 합계가 눈금을 정해요. 합칠 수가 그대로일 때까지 (많아야 세 번)
  for (let pass = 0; pass < 3; pass++) {
    const next = mergeFactor(plotWidth(labelW), o.n);
    if (next === k) break;
    k = next;
    back = sumGroups(o.back, o.n, k);
    front = sumGroups(o.front, o.n, k);
    dom = fitDomain(0, Math.max(0, ...back.map(sum), ...front.map(sum)), 4);
    const f = o.tickFmt(dom[1]);
    labelW = o.wall ? Math.max(...ticksFor(dom[0], dom[1], 4).map((t) => textWidth(f(t), AXIS_FONT))) : 0;
  }
  const shown = back.length;
  const s = Math.max(1, plotWidth(labelW) / (shown + 0.55));
  const w = FACE * s;
  const lead = (FRONT_DEPTH + GAP) * s;
  const deep = lead + depth * s;
  const floor = o.height - o.below;
  const wallBase = floor - deep * SIN;
  const top = o.legendH + LABEL_ROOM;
  const slotX = (i: number) => X0 + i * s;
  return {
    merge: k,
    shown,
    back,
    front,
    backTotal: back.map(sum),
    frontTotal: front.map(sum),
    ticks: ticksFor(dom[0], dom[1], 4),
    fmt: o.tickFmt(dom[1]),
    k: Math.max(0, wallBase - top) / (dom[1] || 1),
    s,
    w,
    floor,
    wallBase,
    top,
    shift: [lead * COS, lead * SIN],
    depthFront: FRONT_DEPTH * s,
    depthBack: depth * s,
    wallX: [X0 + deep * COS - 6, slotX(shown - 1) + w + deep * COS + 6],
    slotX,
  };
}

/** ↑/↓가 고르는 줄. ↑는 뒷줄, ↓는 앞줄이고, 앞줄이 없거나 다른 키면 null(기본 규칙대로 기간을 옮겨요) */
export function rowAfterKey(key: string, hasFront: boolean): RowName | null {
  if (!hasFront) return null;
  return key === "ArrowUp" ? "back" : key === "ArrowDown" ? "front" : null;
}

/** 쌓은 높이(px)를 아래부터 누적. 길이는 값에 비례하고 작은 조각을 부풀리지 않아요 */
function cumulative(values: readonly number[], k: number): number[] {
  let acc = 0;
  return values.map((v) => (acc += v * k));
}

interface BlockGeom {
  /** 앞면 왼쪽 x, 바닥 y, 앞면 폭, 깊이(px) */
  x: number;
  base: number;
  w: number;
  d: number;
}

/** 블록 실루엣 (앞면, 옆면, 뚜껑을 감싼 여섯 점). 고른 블록의 테두리예요 */
function outline(g: BlockGeom, h: number): [number, number][] {
  const dx = g.d * COS;
  const dy = -g.d * SIN;
  const top = g.base - h;
  return [
    [g.x, top],
    [g.x + dx, top + dy],
    [g.x + g.w + dx, top + dy],
    [g.x + g.w + dx, g.base + dy],
    [g.x + g.w, g.base],
    [g.x, g.base],
  ];
}

/** 쌓은 블록: 조각마다 앞면과 옆면, 옆면 그늘(빛은 왼쪽 위), 빗금, 조각 사이 1px 바탕색 틈, 합계 면인 뚜껑 */
function Prism(props: { p: Painter; g: BlockGeom; cum: number[]; colors: Swatch[]; hatch: string | null; lid: string; lidStroke: boolean; shade: number }) {
  const { p, g, cum, colors, hatch } = props;
  const dx = g.d * COS;
  const dy = -g.d * SIN;
  const right = g.x + g.w;
  /** 앞면 오른쪽 모서리 yTop~yBottom을 깊이 방향으로 민 옆면 */
  const sideFace = (yTop: number, yBottom: number) => pts([[right, yTop], [right + dx, yTop + dy], [right + dx, yBottom + dy], [right, yBottom]]);
  const h = cum[cum.length - 1] ?? 0;
  const top = g.base - h;
  const faces: ReactNode[] = [];
  const seams: ReactNode[] = [];
  let prev = 0;
  cum.forEach((c, j) => {
    const y0 = g.base - prev;
    const y1 = g.base - c;
    if (c > prev) {
      faces.push(<rect key={`f${j}`} x={r1(g.x)} y={r1(y1)} width={r1(g.w)} height={r1(c - prev)} fill={colors[j].fill} />);
      faces.push(<polygon key={`s${j}`} points={sideFace(y1, y0)} fill={colors[j].fill} />);
      if (prev > 0) seams.push(<polyline key={`g${j}`} points={pts([[g.x, y0], [right, y0], [right + dx, y0 + dy]])} fill="none" stroke={p.paint("panel")} strokeWidth={1.2} />);
    }
    prev = c;
  });
  if (h < 1) return <g>{faces}</g>;
  const side = sideFace(top, g.base);
  return (
    <g>
      {faces}
      <polygon points={side} fill="#000" fillOpacity={props.shade} />
      {hatch ? (
        <>
          <rect x={r1(g.x)} y={r1(top)} width={r1(g.w)} height={r1(h)} fill={hatch} />
          <polygon points={side} fill={hatch} />
        </>
      ) : null}
      {seams}
      <line x1={r1(right)} x2={r1(right)} y1={r1(top)} y2={r1(g.base)} stroke={p.paint("panel")} strokeOpacity={0.7} />
      <polygon points={pts([[g.x, top], [right, top], [right + dx, top + dy], [g.x + dx, top + dy]])} fill={props.lid} stroke={props.lidStroke ? p.paint("neutralStrong") : undefined} strokeOpacity={props.lidStroke ? 0.55 : undefined} strokeLinejoin="round" />
    </g>
  );
}

/** 블록 위에 놓여도 읽히게 바탕색 테두리(halo)를 두른 굵은 글자 */
function Halo(props: { p: Painter; x: number; y: number; size?: number; opacity?: number; children: ReactNode }) {
  const { p } = props;
  return (
    <text x={r1(props.x)} y={r1(props.y)} dy="0.35em" fontSize={props.size ?? 11.5} fill={p.paint("ink")} textAnchor="middle" fontWeight={700} opacity={props.opacity === undefined || props.opacity >= 1 ? undefined : Math.max(0, props.opacity)} stroke={p.paint("panel")} strokeWidth={4} strokeLinejoin="round" paintOrder="stroke" style={{ pointerEvents: "none", fontVariantNumeric: "tabular-nums" }}>
      {props.children}
    </text>
  );
}

/** 범례 항목 자리. 앞줄 첫 항목 앞에는 세로 구분선 자리를 두고, 폭을 넘으면 다음 줄로 */
function legendPlaces(items: readonly { name: string; divider: boolean }[], width: number): { x: number; line: number }[] {
  const out: { x: number; line: number }[] = [];
  let x = 0;
  let line = 0;
  for (const it of items) {
    const w = 15 + textWidth(it.name, 11.5);
    if (x > 0) {
      const lead = it.divider ? 28 : 14;
      if (x + lead + w > width) {
        x = 0;
        line++;
      } else x += lead;
    }
    out.push({ x, line });
    x += w;
  }
  return out;
}

/** 비율 띠: 앞줄 합계 ÷ 뒷줄 합계를 앞면과 같은 x에. 자기 눈금(0과 위 끝)을 따로 적는 별도 판이라 이중 축이 아니에요 */
function RateStrip(props: { p: Painter; rates: (number | null)[]; x: (i: number) => number; w: number; from: number; to: number; top: number; right: number; title: string; pct: (v: number) => string; fade: (i: number) => number }) {
  const { p, rates } = props;
  const max = Math.max(0, ...rates.map((r) => r ?? 0));
  const top = niceDomain(0, max, 2)[1];
  const hi = max > 0 ? rates.indexOf(max) : -1;
  const bottom = props.top + STRIP_H;
  return (
    <g aria-hidden="true">
      <Txt x={props.from} y={props.top - 8} size={11} fill={p.paint("muted")}>
        {props.title}
      </Txt>
      <line x1={r1(props.from)} x2={r1(props.to)} y1={r1(props.top)} y2={r1(props.top)} stroke={p.paint("line2")} />
      <line x1={r1(props.from)} x2={r1(props.to)} y1={r1(bottom)} y2={r1(bottom)} stroke={p.paint("line")} />
      {rates.map((r, i) => {
        if (r === null || r <= 0) return null;
        const h = (r / top) * STRIP_H;
        return <rect key={i} x={r1(props.x(i))} y={r1(bottom - h)} width={r1(props.w)} height={r1(h)} rx={Math.min(1.5, h / 2)} fill={p.paint(i === hi ? "accent" : "neutralStrong")} />;
      })}
      <Txt x={props.right} y={bottom} size={AXIS_FONT} fill={p.paint("muted")}>
        0
      </Txt>
      <Txt x={props.right} y={props.top} size={AXIS_FONT} fill={p.paint("muted")}>
        {props.pct(top)}
      </Txt>
      {hi >= 0 ? (
        <Halo p={p} x={props.x(hi) + props.w / 2} y={bottom - (max / top) * STRIP_H - 8} size={11} opacity={props.fade(hi)}>
          {props.pct(max)}
        </Halo>
      ) : null}
    </g>
  );
}

/** 스카이라인: 기간마다 쌓은 양을 수평 바닥 위 블록으로, 같은 단위의 작은 결과를 그 앞줄에 */
export function SkylineChart<T = Row>(props: SkylineChartProps<T>) {
  const strip = props.frontRate === "strip" && props.front !== undefined;
  const c = useChart(props, { height: (w) => Math.max(300, Math.min(440, w * 0.58)) + (strip ? 40 : 0), duration: 800, stagger: 40 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];
  const uid = useId().replace(/:/g, "");
  const [row, setRow] = useState<RowName>("back");

  const frontFields = useMemo(() => (props.front === undefined ? [] : Array.isArray(props.front) ? props.front : [props.front]), [props.front]);
  const backModel = useMemo(() => prepSeries(props.data, props.x, props.y, props.series, { locale: c.locale }), [props.data, props.x, props.y, props.series, c.locale]);
  // 앞줄은 뒷줄과 같은 x 종류로 읽어요. 기간 키는 x로만 정해져서 뒷줄과 같아요
  const frontValues = useMemo(
    () => (frontFields.length ? prepSeries(props.data, props.x, frontFields, undefined, { locale: c.locale, xType: backModel.type }).values : []),
    [props.data, props.x, frontFields, c.locale, backModel],
  );
  const valueName = typeof props.y === "string" ? props.y : c.t.value;
  const names = useMemo(() => backModel.series.map((s) => s || valueName), [backModel, valueName]);
  const all = useMemo(() => [...names, ...frontFields], [names, frontFields]);
  const nB = names.length;
  const nF = frontFields.length;
  const hasFront = nF > 0;
  const curRow = hasFront ? row : "back";
  const frontRate = props.frontRate ?? "label";
  const texture = props.texture ?? "front";
  const wall = props.wall !== false;
  const showStrip = strip && hasFront;
  const frontLabel = hasFront && !strip && c.showLabels;

  // 범례: 뒷줄 계열, 세로 구분선, 앞줄 계열. 계열이 하나뿐이면 그리지 않아요
  const legendItems = useMemo(() => (nB > 1 || hasFront ? all.map((name, j) => ({ name, divider: j === nB && nB > 0 })) : []), [all, nB, hasFront]);
  const legendAt = useMemo(() => legendPlaces(legendItems, W), [legendItems, W]);
  const legendH = legendAt.length ? (legendAt[legendAt.length - 1].line + 1) * LEGEND_LINE + 6 : 0;
  const below = SLAB + (showStrip ? 70 : frontLabel ? 48 : 22);

  const L = useMemo(
    () =>
      skylineLayout({
        width: W,
        height: H,
        back: backModel.values,
        front: frontValues,
        n: backModel.keys.length,
        depth: props.depth ?? DEPTH_RANGE[1],
        wall,
        legendH,
        below,
        tickFmt: (max) => makeTickFormatter(props.format, c.locale, max),
      }),
    [W, H, backModel, frontValues, props.depth, wall, legendH, below, props.format, c.locale],
  );
  const { shown, merge } = L;

  // 보이는 기간마다 이름(합쳤으면 범위), 키, 묶기 키, 원래 행(합쳤으면 null)
  const periods = useMemo(() => {
    const n = backModel.keys.length;
    return Array.from({ length: shown }, (_, i) => {
      const [a, end] = groupRange(i, n, merge);
      const b = end - 1;
      const one = a === b;
      return {
        label: one ? backModel.labels[a] : msg.range(backModel.labels[a], backModel.labels[b]),
        key: one ? backModel.keys[a] : `${backModel.keys[a]}~${backModel.keys[b]}`,
        sync: syncKeyOf(backModel.keys[a]),
        datum: one ? backModel.rows[0]?.[a] ?? null : null,
      };
    });
  }, [shown, merge, backModel, msg]);

  // 강조: 계열이 여럿이거나 계열 이름을 주면 계열(기본 첫 계열), 계열이 하나면 기간(기본 가장 큰 기간). 색은 전체 계열로 한 번 정해요
  const colors = useMemo(() => {
    const h = props.highlight;
    const byName = typeof h === "string" ? all.includes(h) : Array.isArray(h) && h.some((x) => typeof x === "string" && all.includes(x));
    if (nB === 1 && !byName) {
      const hi = resolveHighlight(h, periods.map((x) => x.datum as T), periods.map((x) => x.label), L.backTotal, "max");
      return { periods: emphasis(p, shown, hi), back: [swatch(p, "neutral")], front: ramp(p, nF, new Set()) };
    }
    const totals = [...names.map((_, j) => sum(L.back.map((r) => r[j]))), ...frontFields.map((_, j) => sum(L.front.map((r) => r[j])))];
    // 계열 강조에는 이름과 인덱스만 써요. 판별 함수는 행을 받는 함수라서 계열 이름에 넘기지 않아요
    const hi = resolveHighlight(typeof h === "function" ? undefined : h, all, all, totals, "first");
    const part = (from: number, n: number) => new Set([...hi].filter((i) => i >= from && i < from + n).map((i) => i - from));
    return { periods: null, back: ramp(p, nB, part(0, nB)), front: ramp(p, nF, part(nB, nF)) };
  }, [props.highlight, all, nB, nF, periods, L, p, shown, names, frontFields]);
  const swatches = (i: number, r: RowName) => (r === "front" ? colors.front : colors.periods ? [colors.periods[i]] : colors.back);

  const shade = luminance(parseColor(p.theme.panel) ?? [0, 0, 0, 1]) < 0.4 ? 0.3 : 0.16;
  const hatchFill = `url(#${uid}h)`;
  const hatched = (r: RowName) => texture === "all" || (texture === "front" && r === "front");
  const backLid = p.mix("panel", "neutralSoft", 0.5);

  const geom = (i: number, r: RowName): BlockGeom =>
    r === "back" ? { x: L.slotX(i) + L.shift[0], base: L.floor - L.shift[1], w: L.w, d: L.depthBack } : { x: L.slotX(i), base: L.floor, w: L.w, d: L.depthFront };
  const total = (i: number, r: RowName) => (r === "back" ? L.backTotal[i] : L.frontTotal[i]);
  const values = (i: number, r: RowName) => (r === "back" ? L.back[i] : L.front[i]);
  /** 블록 뚜껑 뒤 모서리의 y */
  const lidBackY = (i: number, r: RowName) => {
    const g = geom(i, r);
    return g.base - total(i, r) * L.k - g.d * SIN;
  };
  const rows = hasFront ? BOTH_ROWS : BACK_ROW;

  // 움직임: 바닥에서 자라요. 기간마다 stagger(기본 40ms, 전체 600ms 안), 앞줄은 그 기간 뒷줄보다 120ms 늦게
  const D = c.motion.duration ?? 800;
  const stg = Math.min(c.motion.stagger ?? 40, 600 / Math.max(1, shown - 1));
  const marks = useMemo<Mark<{ i: number; r: RowName }>[]>(
    () =>
      periods.flatMap((pd, i) =>
        rows.map((r) => {
          const to = cumulative(r === "back" ? L.back[i] : L.front[i], L.k);
          const zero = to.map(() => 0);
          return { key: `${pd.key}|${r}`, to, from: zero, enter: zero, delay: i * stg + (r === "front" ? 120 : 0), data: { i, r } };
        }),
      ),
    [L, periods, rows, stg],
  );
  const m = useMotion(marks, c.motion);
  const byBlock = new Map<string, MotionItem<{ i: number; r: RowName }>>();
  for (const it of m.items) if (!it.exiting) byBlock.set(`${it.data.i}|${it.data.r}`, it);
  const fade = (i: number) => m.fade(i * stg + D * 0.7, 260);

  const fv = c.fv;
  const pct = (v: number) => formatPercent(v * 100, { locale: c.locale, maximumFractionDigits: 1 });
  const rateOf = (i: number) => (L.backTotal[i] > 0 ? L.frontTotal[i] / L.backTotal[i] : null);
  const rateText = (i: number) => {
    const rate = rateOf(i);
    return rate === null ? "" : pct(rate);
  };
  /** 한 줄의 계열을 위에서 아래 순서로. 툴팁, 라이브 영역, 숨긴 표가 같은 순서예요 */
  const topDown = (i: number, r: RowName) =>
    (r === "back" ? names : frontFields)
      .map((name, j) => ({ name, v: values(i, r)[j], sw: swatches(i, r)[j] }))
      .reverse();
  const listText = (i: number, r: RowName) => topDown(i, r).map((s) => `${s.name} ${fv(s.v)}`).join(", ");
  const several = (r: RowName) => (r === "back" ? nB : nF) > 1;
  /** 라이브 영역: 고른 줄의 계열(위→아래)과 합계, 앞줄이면 뒷줄 대비 비율 */
  const rowSentence = (i: number, r: RowName) => {
    const parts = several(r) ? [listText(i, r), `${msg.sum} ${fv(total(i, r))}`] : [listText(i, r)];
    if (r === "front" && frontRate !== false && rateOf(i) !== null) parts.push(msg.ofBack(rateText(i)));
    return `${periods[i].label}${hasFront ? ` ${msg.row[r]}` : ""}: ${parts.join(", ")} (${i + 1}/${shown})`;
  };

  const empty = L.backTotal.every((v) => v === 0) && L.frontTotal.every((v) => v === 0);
  // 이벤트는 기간마다 하나예요. 줄은 차트 안 상태이고, series와 value가 고른 줄을 따라가요. 표 글은 뒷줄 다음 앞줄
  const events = useMemo<ChartEvent<T>[]>(
    () =>
      empty
        ? []
        : periods.map((pd, i) => ({
            datum: pd.datum,
            index: i,
            key: pd.key,
            label: pd.label,
            series: hasFront ? msg.row[curRow] : undefined,
            value: total(i, curRow),
            formatted: rows.map((r) => msg.cell(hasFront ? msg.row[r] : "", fv(total(i, r)), several(r) ? listText(i, r) : "")).join(", "),
          })),
    // empty, total, several, listText는 아래 값들로 정해져요
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [L, periods, msg, curRow, fv, names, frontFields],
  );
  const syncKeys = useMemo(() => ({ keys: periods.map((x) => x.sync), labels: periods.map((x) => x.label) }), [periods]);
  useSync(c, props.syncId, syncKeys.keys, syncKeys.labels);
  const active = c.active !== null && c.active < shown && !empty ? c.active : null;

  /** 툴팁 자리: 고른 기간 블록 위 빈 곳. 자리가 없으면 블록 옆 (ChartFrame이 차트 폭 안에 가둬요) */
  // 툴팁 폭을 글자로 재요. 값은 늘 글자예요
  const tipAt = (i: number, tipRows: (TooltipRow & { value: string })[], title: string): TooltipData => {
    const b = geom(i, "back");
    const half = (b.w + b.d * COS) / 2;
    const cx = b.x + half;
    const topY = Math.min(lidBackY(i, "back"), lidBackY(i, "front"));
    // ChartFrame 툴팁: 위아래 여백 8px씩, 제목 22px, 행마다 18px, 테두리 2px
    const estH = 40 + tipRows.length * 18;
    if (topY - estH - 14 >= 2) return { x: cx, y: topY, title, rows: tipRows };
    const estW = Math.max(112, textWidth(title, 11.5, 600), ...tipRows.map((r) => (r.color ? 15 : 0) + textWidth(r.label ?? "", 12) + 16 + textWidth(r.value, 12, 700))) + 24;
    const away = half + 12 + estW / 2;
    // 카드 위 끝을 블록 꼭대기에 맞추되 차트 높이 안에 가둬요 (ChartFrame은 y 위로 카드 높이 + 14px만큼 올려 그려요)
    const cardTop = Math.max(4, Math.min(topY, H - estH - 4));
    return { x: cx + away + estW / 2 <= W - 4 ? cx + away : cx - away, y: cardTop + estH + 14, title, rows: tipRows };
  };

  // 툴팁: 뒷줄 계열 위→아래와 합계, 앞줄 계열 위→아래와 합계, 비율. 고른 줄의 머리(합계, 계열 하나면 그 줄)를 굵게
  let tip: TooltipData | null = null;
  if (active !== null) {
    const tipRows: (TooltipRow & { value: string })[] = [];
    for (const r of rows) {
      const picked = r === curRow;
      for (const s of topDown(active, r)) tipRows.push({ label: s.name, value: fv(s.v), color: s.sw.fill, strong: several(r) ? (picked ? undefined : false) : picked });
      if (several(r)) tipRows.push({ label: hasFront ? msg.total[r] : msg.sumLabel, value: fv(total(active, r)), strong: picked });
    }
    if (hasFront && frontRate !== false) tipRows.push({ label: msg.rate, value: rateText(active) || "-", strong: false });
    tip = tipAt(active, tipRows, periods[active].label);
  }
  const announce = active !== null && c.via === "keyboard" ? rowSentence(active, curRow) : undefined;

  // 자동 설명: 뒷줄 최고 기간, 앞줄 최고 기간과 뒷줄 대비 비율, 합쳤으면 합친 단위
  const peakB = L.backTotal.indexOf(Math.max(...L.backTotal));
  const peakF = hasFront ? L.frontTotal.indexOf(Math.max(...L.frontTotal)) : -1;
  let auto = msg.kind;
  if (shown) {
    const parts = [msg.kind, msg.desc(nB, names.join(", "), periods[0].label, periods[shown - 1].label), msg.descPeak(periods[peakB].label, fv(L.backTotal[peakB]))];
    if (hasFront) parts.push(L.frontTotal[peakF] > 0 ? msg.descFront(frontFields.join(", "), periods[peakF].label, fv(L.frontTotal[peakF]), rateText(peakF)) : msg.descFrontZero(frontFields.join(", ")));
    if (merge > 1) parts.push(msg.merged(merge));
    auto = parts.join(". ");
  }
  const desc = `${props.description ?? `${auto}.`}${hasFront ? ` ${msg.keys}` : ""}`;

  // 날짜: 앞면 가운데 아래(양끝은 차트 안으로 당긴 자리). 좁으면 그 자리로 솎아요
  const dates = useMemo(() => {
    const xs = periods.map((pd, i) => inside(L.slotX(i) + L.w / 2, pd.label, AXIS_FONT, W));
    return { xs, show: thinLabels(xs, periods.map((x) => x.label), AXIS_FONT, 6) };
  }, [L, periods, W]);
  const stripTop = L.floor + SLAB + 20;
  const dateY = showStrip ? stripTop + STRIP_H + 14 : L.floor + SLAB + 12;

  const pick = (px: number, py: number, touch: boolean) => {
    if (empty) return;
    const i = evenIndex(px, L.slotX(0) + L.s * 0.49, L.slotX(shown - 1) + L.s * 0.49, shown);
    // 앞줄 블록 꼭대기에서 6px 위까지와 그 아래는 앞줄, 그 위는 뒷줄. 터치는 기간만 고르고 뒷줄로 시작해요
    const next = !touch && hasFront && py >= L.floor - L.frontTotal[i] * L.k - 6 ? "front" : "back";
    if (next !== row) setRow(next);
    if (i !== c.active) c.setActive(i, touch ? "touch" : "pointer");
  };

  const wallTop = L.top - 10;
  const fx0 = L.slotX(0) - 8;
  const fx1 = L.slotX(shown - 1) + L.w + 8;
  const deep = (FRONT_DEPTH + GAP) * L.s + L.depthBack + 8;
  const floorTop = pts([
    [fx0, L.floor + SLAB],
    [fx1, L.floor + SLAB],
    [fx1 + deep * COS, L.floor + SLAB - deep * SIN],
    [fx0 + deep * COS, L.floor + SLAB - deep * SIN],
  ]);

  const peakLabel = () => {
    const g = geom(peakB, "back");
    const text = msg.peak(fv(L.backTotal[peakB]));
    // 오른쪽 끝 기간이면 눈금 글자 열을 침범하지 않게 뒷벽 안으로 당겨요
    const x = Math.min(g.x + (g.w + g.d * COS) / 2, (wall ? L.wallX[1] : W - 2) - textWidth(text, 11.5, 700) / 2);
    return (
      <Halo p={p} x={x} y={lidBackY(peakB, "back") - 11} opacity={fade(peakB)}>
        {text}
      </Halo>
    );
  };
  const frontPeakLabel = () => {
    const rate = frontRate === "label" ? rateText(peakF) : "";
    const text = msg.frontPeak(periods[peakF].label, fv(L.frontTotal[peakF]), rate);
    const cx = L.slotX(peakF) + L.w / 2;
    return (
      <g opacity={fade(peakF)}>
        <line x1={r1(cx)} x2={r1(cx)} y1={r1(dateY + 8)} y2={r1(dateY + 14)} stroke={p.paint("muted")} />
        <Halo p={p} x={inside(cx, text, 11, W, 700)} y={dateY + 25} size={11}>
          {text}
        </Halo>
      </g>
    );
  };

  return (
    <ChartFrame
      c={c}
      kind={msg.kind}
      ariaLabel={props.ariaLabel}
      description={desc}
      events={events}
      tip={tip}
      renderTip={props.tooltip}
      className={props.className}
      style={props.style}
      theme={props.theme}
      announce={announce}
      onPointerMove={(px, py, e) => pick(px, py, e.pointerType === "touch")}
      onKey={(e) => {
        const next = rowAfterKey(e.key, hasFront);
        if (next === null) return false;
        if (next !== row) setRow(next);
        if (active === null && !empty) c.setActive(0, "keyboard");
        return true;
      }}
      defs={
        texture !== "none" ? (
          <pattern id={`${uid}h`} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={1.6} height={4} fill={p.paint("panel")} fillOpacity={0.55} />
          </pattern>
        ) : undefined
      }
    >
      <g aria-hidden="true">
        {legendItems.map((it, j) => {
          const { x, line } = legendAt[j];
          const y = line * LEGEND_LINE + 9;
          const front = j >= nB;
          return (
            <g key={j}>
              {it.divider && x > 0 ? <line x1={x - 14} x2={x - 14} y1={y - 7} y2={y + 7} stroke={p.paint("line")} /> : null}
              <rect x={x} y={y - 5} width={10} height={10} rx={2} fill={front ? colors.front[j - nB].fill : colors.back[j].fill} />
              {hatched(front ? "front" : "back") ? <rect x={x} y={y - 5} width={10} height={10} rx={2} fill={hatchFill} /> : null}
              <Txt x={x + 15} y={y} size={11.5} fill={p.paint("muted")}>
                {it.name}
              </Txt>
            </g>
          );
        })}
      </g>
      {empty ? (
        <Txt x={W / 2} y={(L.top + L.floor) / 2} anchor="middle" size={13} fill={p.paint("muted")}>
          {msg.nothing}
        </Txt>
      ) : (
        <>
          <g aria-hidden="true">
            {wall ? (
              <>
                <rect x={r1(L.wallX[0])} y={r1(wallTop)} width={r1(Math.max(0, L.wallX[1] - L.wallX[0]))} height={r1(Math.max(0, L.wallBase - wallTop))} fill={p.paint("line2")} fillOpacity={0.6} />
                {L.ticks.map((t) => {
                  const y = L.wallBase - t * L.k;
                  return (
                    <g key={t}>
                      <line x1={r1(L.wallX[0])} x2={r1(L.wallX[1])} y1={r1(y)} y2={r1(y)} stroke={p.paint("line")} />
                      <Txt x={L.wallX[1] + 6} y={y} size={AXIS_FONT} fill={p.paint("muted")}>
                        {L.fmt(t)}
                      </Txt>
                    </g>
                  );
                })}
              </>
            ) : null}
            <polygon points={floorTop} fill={p.paint("neutralSoft")} />
            <rect x={r1(fx0)} y={r1(L.floor + SLAB)} width={r1(Math.max(0, fx1 - fx0))} height={SLAB} fill={p.paint("line")} />
          </g>
          {periods.map((pd, i) => (
            <g key={pd.key} className="ztd-mark" opacity={active === null || active === i ? 1 : 0.38} onClick={() => c.click(i)} style={{ cursor: props.onClick ? "pointer" : undefined }}>
              <rect x={r1(L.slotX(i))} y={r1(wallTop)} width={r1(L.s)} height={r1(Math.max(0, H - wallTop))} fill="transparent" />
              {rows.map((r) => {
                const it = byBlock.get(`${i}|${r}`);
                if (!it) return null;
                const g = geom(i, r);
                const target = total(i, r) * L.k;
                // 0이 아닌데 1px이 안 되면 블록 대신 바닥에 가는 선 (맨 위 계열 색). 길이는 바꾸지 않아요
                if (target > 0 && target < 1) {
                  const vals = values(i, r);
                  let topJ = vals.length - 1;
                  while (topJ > 0 && !(vals[topJ] > 0)) topJ--;
                  return <line key={r} x1={r1(g.x)} x2={r1(g.x + g.w)} y1={r1(g.base - 0.5)} y2={r1(g.base - 0.5)} stroke={swatches(i, r)[topJ].fill} />;
                }
                return <Prism key={r} p={p} g={g} cum={it.v} colors={swatches(i, r)} hatch={hatched(r) ? hatchFill : null} lid={r === "back" ? backLid : p.paint("neutralSoft")} lidStroke={r === "back"} shade={shade} />;
              })}
              {active === i && c.via !== "sync" ? <polygon points={pts(outline(geom(i, curRow), total(i, curRow) * L.k))} fill="none" stroke={p.paint("ink")} strokeWidth={2} strokeLinejoin="round" pointerEvents="none" /> : null}
            </g>
          ))}
          {c.showLabels && L.backTotal[peakB] > 0 ? peakLabel() : null}
          {showStrip ? <RateStrip p={p} rates={periods.map((_, i) => rateOf(i))} x={L.slotX} w={L.w} from={fx0} to={fx1} top={stripTop} right={wall ? L.wallX[1] + 6 : fx1 + 6} title={msg.rate} pct={pct} fade={fade} /> : null}
          <g aria-hidden="true">
            {dates.show.map((i) => (
              <Txt key={i} x={dates.xs[i]} y={dateY} anchor="middle" size={AXIS_FONT} fill={p.paint(active === i ? "ink" : "muted")} weight={active === i ? 700 : 400}>
                {periods[i].label}
              </Txt>
            ))}
          </g>
          {frontLabel && L.frontTotal[peakF] > 0 ? frontPeakLabel() : null}
        </>
      )}
    </ChartFrame>
  );
}
