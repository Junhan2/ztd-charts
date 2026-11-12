import { useId, useMemo, useState, type ReactNode } from "react";
import { AXIS_FONT, thinLabels } from "../core/axis";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { formatPercent, makeTickFormatter, type DayFirstProps, type ValueFormatter } from "../core/format";
import { evenIndex } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import { plural, type ChartLang } from "../core/i18n";
import type { Mark, MotionItem } from "../core/motion";
import { categoricalDots, emphasis, ramp, readableOn, swatch, type Swatch } from "../core/palette";
import { fitDomain, niceDomain, ticksFor } from "../core/scale";
import { prepSeries, syncKeyOf } from "../core/series";
import { useSync } from "../core/sync";
import { textWidth } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData, TooltipRow } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { luminance, mixHex, parseColor } from "../theme/color";
import type { Painter } from "../theme/context";

type RowName = "back" | "front";

const en = {
  kind: "Skyline",
  /** Row names used in the event's series and in the live region */
  row: { back: "back", front: "front" },
  total: { back: "Back total", front: "Front total" },
  sum: "total",
  /** Tooltip total when there is no front row */
  sumLabel: "Total",
  rate: "Front ÷ back",
  peak: (v: string) => `Peak ${v}`,
  frontPeak: (label: string, v: string, rate: string) => `Front peak ${label} · ${v}${rate ? ` (${rate})` : ""}`,
  range: (a: string, b: string) => `${a}–${b}`,
  nothing: "Nothing to draw",
  ofBack: (rate: string) => `${rate} of the back row`,
  /** One cell of the hidden table: row name, total, series list */
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

export interface SkylineChartProps<T = Row> extends BaseChartProps<T>, DayFirstProps {
  /** Period field. Dates, numbers and categories all work. Default "x" */
  x?: Accessor<T, unknown>;
  /** Value fields to stack in the back row. An array means several columns of a wide table */
  y?: Accessor<T, number> | string[];
  /** Series field (long table, back row only) */
  series?: Accessor<T, string>;
  /** Fields to stack in the front row (wide table only). Small outcomes in the same unit as the back row (failures, retries) */
  front?: string | string[];
  /** Back row depth relative to the slot width. The high view takes 0.1 to 0.45 (default 0.42), the low view 0.1 to 0.32 (default 0.32). In short charts, high reduces the depth to leave room for the value ticks */
  depth?: number;
  /**
   * View angle. "high" (default) looks down at the floor, so the front row's tops read as tiles on the floor; "low" looks almost straight on, leaving more room for the value ticks.
   * In both views the periods run horizontally, so a taller block always means more
   */
  view?: SkylineView;
  /** Ticks on the back wall. Default true */
  wall?: boolean;
  /** Rows that get hatching. Default "front" */
  texture?: "front" | "all" | "none";
  /** The front row total as a percentage of the back row: "label" (labels and tooltip), "strip" (a ratio strip under the floor), false (hidden). Default "label" */
  frontRate?: "label" | "strip" | false;
  /** Highlight: with several series, a series name (front row names work too; default the first series); with one series, a period (default the largest period). With one series, a predicate receives the period's row */
  highlight?: BaseChartProps<T>["highlight"];
}

export type SkylineView = "high" | "low";

interface ViewGeom {
  /** How far 1px of depth moves right and up on screen */
  cx: number;
  cy: number;
  /** Ratios of the slot width: front face width, front row depth, gap between the two rows */
  face: number;
  front: number;
  gap: number;
  /** Minimum, maximum and default back row depth (relative to the slot width). The maximum stops just before the back row's side face reaches the next slot */
  depth: readonly [number, number, number];
}

/**
 * Geometry per view. 2/√5 and 1/√5 are written as numbers (the bundler cannot drop a Math.sqrt call, so it would stay in other charts' bundles too).
 * low is the look used up to 0.8: depth recedes up and to the right at 2:1 (26.57°), so the front row's tops are only 1 to 5px.
 * high stands the same 2:1 upright (63.43°). It looks down at the floor, so the front row's tops become tiles 0.38 slot widths tall,
 * and the period axis stays horizontal as in low. The back row is offset 0.23 slots to the right, so its front face overlaps the same period's front row by 57%
 */
const VIEWS: Record<SkylineView, ViewGeom> = {
  low: { cx: 0.8944271909999159, cy: 0.4472135954999579, face: 0.52, front: 0.14, gap: 0.05, depth: [0.1, 0.32, 0.32] },
  high: { cx: 0.4472135954999579, cy: 0.8944271909999159, face: 0.54, front: 0.42, gap: 0.1, depth: [0.1, 0.45, 0.42] },
};
/** The view's back row depth [min, max, default] */
export const depthRange = (view: SkylineView = "high") => VIEWS[view].depth;
/** Merge neighboring periods when a slot is narrower than this */
const MIN_SLOT = 20;
/** Never draw more periods than this, even after merging (keeps the hidden table within 60 rows) */
const MAX_SHOWN = 40;
/**
 * Share of the vertical space (from below the legend to the floor) the high view's depth may use. In short charts, or wide charts with few periods,
 * a depth that would take more than this is scaled down proportionally, so over 60% stays for the value ticks. Typical sizes use 10 to 19%, so they are unchanged
 */
const MAX_DEPTH_SHARE = 0.4;
/** Minimum vertical spacing (px) between back wall tick labels. When tighter, ticks are skipped at an even interval starting from 0 */
const MIN_TICK_GAP = 14;
/** Margin before the first period, room above the top tick for the peak label, floor slab thickness */
const X0 = 10;
const LABEL_ROOM = 20;
const SLAB = 4;
/** Ratio strip height */
const STRIP_H = 26;
const LEGEND_LINE = 18;

const BOTH_ROWS: readonly RowName[] = ["back", "front"];
const BACK_ROW: readonly RowName[] = ["back"];

const r1 = (v: number) => Math.round(v * 10) / 10;
const pts = (list: [number, number][]) => list.map(([x, y]) => `${r1(x)},${r1(y)}`).join(" ");
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
/** Pulls the x of centered text in so the text stays within width */
const inside = (x: number, text: string, size: number, width: number, weight = 400) => {
  const half = textWidth(text, size, weight) / 2;
  return Math.max(half + 2, Math.min(width - half - 2, x));
};

/** How many periods to merge when placing n periods in the plot width plotW: the smallest number that makes each slot at least MIN_SLOT wide and leaves at most MAX_SHOWN visible periods */
export function mergeFactor(plotW: number, n: number): number {
  for (let k = 1; k < n; k++) {
    const shown = Math.ceil(n / k);
    if (shown <= MAX_SHOWN && plotW / (shown + 0.55) >= MIN_SLOT) return k;
  }
  return Math.max(1, n);
}

/**
 * Original periods [start, end) covered by visible period i. Groups are counted from the end, so a partial group, if any, is the first and oldest one
 * (a partial most recent block would read as a sudden drop)
 */
export function groupRange(i: number, n: number, k: number): [number, number] {
  const first = n - k * (Math.ceil(n / k) - 1);
  return i === 0 ? [0, first] : [first + (i - 1) * k, first + i * k];
}

/** Sums [series][period] values k at a time into [visible period][series]. Negative and missing values count as 0 (the skyline stacks from 0) */
function sumGroups(values: readonly number[][], n: number, k: number): number[][] {
  return Array.from({ length: Math.ceil(n / k) }, (_, i) => {
    const [a, b] = groupRange(i, n, k);
    return values.map((row) => sum(row.slice(a, b).map((v) => (Number.isFinite(v) && v > 0 ? v : 0))));
  });
}

export interface SkylineInput {
  width: number;
  height: number;
  /** [series][period], before merging */
  back: readonly number[][];
  front: readonly number[][];
  /** Number of periods */
  n: number;
  /** Back row depth relative to the slot width. Defaults to the view's default */
  depth?: number;
  wall: boolean;
  /** Default "high" */
  view?: SkylineView;
  /** Height of the legend on top */
  legendH: number;
  /** Room below the floor slab (dates, front row peak label, ratio strip) */
  below: number;
  /** Tick label formatter. Receives the top tick value */
  tickFmt: (max: number) => ValueFormatter;
}

export interface SkylineLayout {
  /** How many periods were merged into one. 1 means unmerged */
  merge: number;
  shown: number;
  /** [visible period][series] (after merging) */
  back: number[][];
  front: number[][];
  backTotal: number[];
  frontTotal: number[];
  ticks: number[];
  fmt: ValueFormatter;
  /** Pixels per value unit. Both rows share the same scale */
  k: number;
  /** Slot width, front face width */
  s: number;
  w: number;
  /** y of the front row floor (front edge), the back wall floor and the top tick */
  floor: number;
  wallBase: number;
  top: number;
  /** How far 1px of depth moves right and up on screen (per view) */
  cx: number;
  cy: number;
  /** Depth (px) from the floor's front edge to the back row */
  lead: number;
  /** How far the back row is set back from the front row (right, up) */
  shift: [number, number];
  depthFront: number;
  depthBack: number;
  /** Back wall x range */
  wallX: [number, number];
  /** Left x of period i's front face */
  slotX: (i: number) => number;
}

/**
 * Level floor layout: periods run left to right, and only the depth recedes at the view's angle. Slot width s = plot width / (visible periods + 0.55).
 * Without a front row, the high view leaves no empty front row space, only the gap between the two rows
 */
export function skylineLayout(o: SkylineInput): SkylineLayout {
  const v = VIEWS[o.view ?? "high"];
  const frontDepth = o.view === "low" || o.front.length ? v.front : 0;
  const depth = Math.min(v.depth[1], Math.max(v.depth[0], o.depth ?? v.depth[2]));
  const plotWidth = (labelW: number) => o.width - X0 - (o.wall ? labelW + 14 : 8);
  let k = 0;
  let labelW = 0;
  let back: number[][] = [];
  let front: number[][] = [];
  let dom: [number, number] = [0, 1];
  // The tick label width sets the plot width, the plot width sets the merge count, and the merged totals set the ticks. Repeat until the merge count holds (three passes at most)
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
  const w = v.face * s;
  const floor = o.height - o.below;
  const top = o.legendH + LABEL_ROOM;
  // high: when the depth takes more than MAX_DEPTH_SHARE of the vertical space, scale the front row depth, the gap and the back row depth down proportionally. low stays as in 0.8
  const full = (frontDepth + v.gap + depth) * s * v.cy;
  const fit = o.view === "low" ? 1 : Math.min(1, (MAX_DEPTH_SHARE * Math.max(0, floor - top)) / (full || 1));
  const lead = (frontDepth + v.gap) * s * fit;
  const deep = lead + depth * s * fit;
  const wallBase = floor - deep * v.cy;
  const perValue = Math.max(0, wallBase - top) / (dom[1] || 1);
  // When the tick spacing is tighter than MIN_TICK_GAP (short charts), skip ticks at an even interval from 0 so the labels do not overlap
  const all = ticksFor(dom[0], dom[1], 4);
  const gap = all.length > 1 ? (all[1] - all[0]) * perValue : Infinity;
  const every = gap >= MIN_TICK_GAP ? 1 : gap > 0 ? Math.ceil(MIN_TICK_GAP / gap) : all.length;
  const slotX = (i: number) => X0 + i * s;
  return {
    merge: k,
    shown,
    back,
    front,
    backTotal: back.map(sum),
    frontTotal: front.map(sum),
    ticks: all.filter((_, i) => i % every === 0),
    fmt: o.tickFmt(dom[1]),
    k: perValue,
    s,
    w,
    floor,
    wallBase,
    top,
    cx: v.cx,
    cy: v.cy,
    lead,
    shift: [lead * v.cx, lead * v.cy],
    depthFront: frontDepth * s * fit,
    depthBack: depth * s * fit,
    wallX: [X0 + deep * v.cx - 6, slotX(shown - 1) + w + deep * v.cx + 6],
    slotX,
  };
}

/** The row picked by ↑/↓. ↑ is the back row, ↓ the front row; null without a front row or for other keys (the period then moves by the default rule) */
export function rowAfterKey(key: string, hasFront: boolean): RowName | null {
  if (!hasFront) return null;
  return key === "ArrowUp" ? "back" : key === "ArrowDown" ? "front" : null;
}

/** Cumulative stacked heights (px) from the bottom. Lengths are proportional to the values; small segments are not inflated */
function cumulative(values: readonly number[], k: number): number[] {
  let acc = 0;
  return values.map((v) => (acc += v * k));
}

interface BlockGeom {
  /** Front face left x, floor y, front face width */
  x: number;
  base: number;
  w: number;
  /** Screen offset of the depth edge (right +, up -) */
  dx: number;
  dy: number;
}

/** Block silhouette (six points wrapping the front face, side face and top). The outline of the selected block */
function outline(g: BlockGeom, h: number): [number, number][] {
  const { dx, dy } = g;
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

/**
 * high front row colors: accent2 (pink), then accent3 (the other theme's accent color). From the third series on, the two alternate, mixed toward ink in 30% steps.
 * They share the accent color's tone, so even flat tiles on the floor (neutralSoft) stay above 3:1
 */
function frontPair(p: Painter, n: number): Swatch[] {
  return Array.from({ length: n }, (_, j) => {
    const token = j % 2 === 0 ? "accent2" : "accent3";
    const k = Math.max(0.4, 1 - 0.3 * Math.floor(j / 2));
    const raw = k === 1 ? p.theme[token] : mixHex(p.theme[token], p.theme.ink, k);
    return { role: "mix", fill: k === 1 ? p.paint(token) : p.mix(token, "ink", k), text: readableOn(p, raw), raw };
  });
}

/** The top face split from the left by each series' share. Shares come from the values, not the drawn heights, so even tiles under 1px get split. null when the shares cannot be computed */
function lidParts(g: BlockGeom, top: number, split: { fills: readonly string[]; values: readonly number[] } | undefined): ReactNode[] | null {
  if (!split) return null;
  const pos = (v: number) => (v > 0 ? v : 0);
  const sum = split.values.reduce((a, v) => a + pos(v), 0);
  if (!(sum > 0)) return null;
  const out: ReactNode[] = [];
  let acc = 0;
  split.values.forEach((v, j) => {
    const x0 = g.x + (g.w * acc) / sum;
    acc += pos(v);
    const x1 = g.x + (g.w * acc) / sum;
    if (x1 > x0) out.push(<polygon key={`l${j}`} points={pts([[x0, top], [x1, top], [x1 + g.dx, top + g.dy], [x0 + g.dx, top + g.dy]])} fill={split.fills[j] ?? "none"} />);
  });
  return out;
}

/**
 * Stacked block: front and side faces per segment, side shading (light from the top left), hatching, a 1px background-color gap between segments, and the top face that carries the total.
 * With tile, blocks under 1px still get a top (high view: the flat front row reads as tiles on the floor). With lidSplit, the top is painted in each series' share
 */
function Prism(props: { p: Painter; g: BlockGeom; cum: number[]; colors: Swatch[]; hatch: string | null; lid: string; lidSplit?: { fills: readonly string[]; values: readonly number[] }; lidStroke: boolean; lidInk?: boolean; lidHatch?: boolean; shade: number; tile?: boolean }) {
  const { p, g, cum, colors, hatch } = props;
  const { dx, dy } = g;
  const right = g.x + g.w;
  /** Side face: the front face's right edge from yTop to yBottom, extruded along the depth */
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
  if (h < 1 && !props.tile) return <g>{faces}</g>;
  const side = sideFace(top, g.base);
  const lid = pts([[g.x, top], [right, top], [right + dx, top + dy], [g.x + dx, top + dy]]);
  const parts = lidParts(g, top, props.lidSplit);
  return (
    <g>
      {faces}
      {h >= 1 ? (
        <>
          <polygon points={side} fill="#000" fillOpacity={props.shade} />
          {hatch ? (
            <>
              <rect x={r1(g.x)} y={r1(top)} width={r1(g.w)} height={r1(h)} fill={hatch} />
              <polygon points={side} fill={hatch} />
            </>
          ) : null}
          {seams}
          <line x1={r1(right)} x2={r1(right)} y1={r1(top)} y2={r1(g.base)} stroke={p.paint("panel")} strokeOpacity={0.7} />
        </>
      ) : null}
      {parts}
      <polygon points={lid} fill={parts ? "none" : props.lid} stroke={props.lidStroke ? p.paint(props.lidInk ? "ink" : "neutralStrong") : undefined} strokeOpacity={props.lidStroke ? (props.lidInk ? 0.4 : 0.55) : undefined} strokeLinejoin="round" />
      {props.lidHatch && hatch ? <polygon points={lid} fill={hatch} /> : null}
    </g>
  );
}

/** Bold text with a background-color outline (halo) so it stays readable over blocks */
function Halo(props: { p: Painter; x: number; y: number; size?: number; opacity?: number; children: ReactNode }) {
  const { p } = props;
  return (
    <text x={r1(props.x)} y={r1(props.y)} dy="0.35em" fontSize={props.size ?? 11.5} fill={p.paint("ink")} textAnchor="middle" fontWeight={700} opacity={props.opacity === undefined || props.opacity >= 1 ? undefined : Math.max(0, props.opacity)} stroke={p.paint("panel")} strokeWidth={4} strokeLinejoin="round" paintOrder="stroke" style={{ pointerEvents: "none", fontVariantNumeric: "tabular-nums" }}>
      {props.children}
    </text>
  );
}

/** Legend item positions. Leaves room for a vertical divider before the first front row item, and wraps to the next line past the width */
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

/** Ratio strip: front row total ÷ back row total, at the same x as the front faces. It is a separate panel that labels its own scale (0 and the top), so it is not a dual axis */
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

/** Skyline: each period's stacked amount as a block on a level floor, with small outcomes in the same unit in the row in front of it */
export function SkylineChart<T = Row>(props: SkylineChartProps<T>) {
  const strip = props.frontRate === "strip" && props.front !== undefined;
  const c = useChart(props, { height: (w) => Math.max(300, Math.min(440, w * 0.58)) + (strip ? 40 : 0), duration: 800, stagger: 40 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];
  const uid = useId().replace(/:/g, "");
  const [row, setRow] = useState<RowName>("back");

  const frontFields = useMemo(() => (props.front === undefined ? [] : Array.isArray(props.front) ? props.front : [props.front]), [props.front]);
  const backModel = useMemo(() => prepSeries(props.data, props.x, props.y, props.series, { locale: c.locale, dayFirst: props.dayFirst }), [props.data, props.x, props.y, props.series, c.locale, props.dayFirst]);
  // Read the front row with the same x kind as the back row. Period keys depend only on x, so they match the back row
  const frontValues = useMemo(
    () => (frontFields.length ? prepSeries(props.data, props.x, frontFields, undefined, { locale: c.locale, xType: backModel.type, dayFirst: props.dayFirst }).values : []),
    [props.data, props.x, frontFields, c.locale, backModel, props.dayFirst],
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
  const view = props.view ?? "high";
  const high = view === "high";
  const showStrip = strip && hasFront;
  const frontLabel = hasFront && !strip && c.showLabels;

  // Legend: back row series, a vertical divider, front row series. Not drawn when there is only one series
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
        depth: props.depth,
        wall,
        view,
        legendH,
        below,
        tickFmt: (max) => makeTickFormatter(props.format, c.locale, max),
      }),
    [W, H, backModel, frontValues, props.depth, wall, view, legendH, below, props.format, c.locale],
  );
  const { shown, merge } = L;

  // Per visible period: name (a range when merged), key, grouping key, original row (null when merged)
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

  // Highlight: a series when there are several series or a series name is given (default the first series); a period when there is one series (default the largest period). Colors are set once across all series
  const colors = useMemo(() => {
    const h = props.highlight;
    const byName = typeof h === "string" ? all.includes(h) : Array.isArray(h) && h.some((x) => typeof x === "string" && all.includes(x));
    // Front row: high uses accent2 and accent3, so even flat tiles show on the floor (highlighting a front row series gives accent steps, as in 0.9). low uses gray steps, as up to 0.8
    const frontSw = (part: ReadonlySet<number>) => (!high ? ramp(p, nF, part) : part.size ? categoricalDots(p, nF, part) : frontPair(p, nF));
    if (nB === 1 && !byName) {
      const hi = resolveHighlight(h, periods.map((x) => x.datum as T), periods.map((x) => x.label), L.backTotal, "max");
      return { periods: emphasis(p, shown, hi), back: [swatch(p, "neutral")], front: frontSw(new Set()), split: high };
    }
    const totals = [...names.map((_, j) => sum(L.back.map((r) => r[j]))), ...frontFields.map((_, j) => sum(L.front.map((r) => r[j])))];
    // Series highlight uses only names and indexes. A predicate takes rows, so it is not passed series names
    const hi = resolveHighlight(typeof h === "function" ? undefined : h, all, all, totals, "first");
    const part = (from: number, n: number) => new Set([...hi].filter((i) => i >= from && i < from + n).map((i) => i - from));
    const fp = part(nB, nF);
    // Split tops only with accent2 and accent3. Highlighting a front row series gives neutral tops, as in 0.9
    return { periods: null, back: ramp(p, nB, part(0, nB)), front: frontSw(fp), split: high && fp.size === 0 };
  }, [props.highlight, all, nB, nF, periods, L, p, shown, names, frontFields, high]);
  const swatches = (i: number, r: RowName) => (r === "front" ? colors.front : colors.periods ? [colors.periods[i]] : colors.back);

  const shade = luminance(parseColor(p.theme.panel) ?? [0, 0, 0, 1]) < 0.4 ? 0.3 : 0.16;
  const hatchFill = `url(#${uid}h)`;
  const hatched = (r: RowName) => texture === "all" || (texture === "front" && r === "front");
  const backLid = p.mix("panel", "neutralSoft", 0.5);
  /** high view front row tops: split by series share and painted in series colors (this neutral face only when the shares cannot be computed), with hatching (the same pattern as the front row swatch in the legend) and an ink outline */
  const frontLid = p.paint("neutral");

  const geom = (i: number, r: RowName): BlockGeom => {
    const d = r === "back" ? L.depthBack : L.depthFront;
    const at = r === "back" ? L.shift : [0, 0];
    return { x: L.slotX(i) + at[0], base: L.floor - at[1], w: L.w, dx: d * L.cx, dy: -d * L.cy };
  };
  const total = (i: number, r: RowName) => (r === "back" ? L.backTotal[i] : L.frontTotal[i]);
  const values = (i: number, r: RowName) => (r === "back" ? L.back[i] : L.front[i]);
  /** y of the back edge of a block's top */
  const lidBackY = (i: number, r: RowName) => {
    const g = geom(i, r);
    return g.base - total(i, r) * L.k + g.dy;
  };
  const rows = hasFront ? BOTH_ROWS : BACK_ROW;

  // Motion: blocks grow from the floor. Staggered per period (40ms by default, within 600ms overall); the front row starts 120ms after that period's back row
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
  /** A row's series in top-to-bottom order. The tooltip, live region and hidden table use the same order */
  const topDown = (i: number, r: RowName) =>
    (r === "back" ? names : frontFields)
      .map((name, j) => ({ name, v: values(i, r)[j], sw: swatches(i, r)[j] }))
      .reverse();
  const listText = (i: number, r: RowName) => topDown(i, r).map((s) => `${s.name} ${fv(s.v)}`).join(", ");
  const several = (r: RowName) => (r === "back" ? nB : nF) > 1;
  /** Live region: the selected row's series (top → bottom) and total, plus the ratio to the back row for the front row */
  const rowSentence = (i: number, r: RowName) => {
    const parts = several(r) ? [listText(i, r), `${msg.sum} ${fv(total(i, r))}`] : [listText(i, r)];
    if (r === "front" && frontRate !== false && rateOf(i) !== null) parts.push(msg.ofBack(rateText(i)));
    return `${periods[i].label}${hasFront ? ` ${msg.row[r]}` : ""}: ${parts.join(", ")} (${i + 1}/${shown})`;
  };

  const empty = L.backTotal.every((v) => v === 0) && L.frontTotal.every((v) => v === 0);
  // One event per period. The row is state inside the chart, and series and value follow the selected row. Table text lists the back row, then the front row
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
    // empty, total, several and listText derive from the values below
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [L, periods, msg, curRow, fv, names, frontFields],
  );
  const syncKeys = useMemo(() => ({ keys: periods.map((x) => x.sync), labels: periods.map((x) => x.label) }), [periods]);
  useSync(c, props.syncId, syncKeys.keys, syncKeys.labels);
  const active = c.active !== null && c.active < shown && !empty ? c.active : null;

  /** Tooltip position: the empty space above the selected period's block, or beside the block when there is no room (ChartFrame keeps it within the chart width) */
  // Measure the tooltip width from its text. Values are always strings
  const tipAt = (i: number, tipRows: (TooltipRow & { value: string })[], title: string): TooltipData => {
    const b = geom(i, "back");
    const half = (b.w + b.dx) / 2;
    const cx = b.x + half;
    const topY = Math.min(lidBackY(i, "back"), lidBackY(i, "front"));
    // ChartFrame tooltip: 8px padding top and bottom, 22px title, 18px per row, 2px border
    const estH = 40 + tipRows.length * 18;
    if (topY - estH - 14 >= 2) return { x: cx, y: topY, title, rows: tipRows };
    const estW = Math.max(112, textWidth(title, 11.5, 600), ...tipRows.map((r) => (r.color ? 15 : 0) + textWidth(r.label ?? "", 12) + 16 + textWidth(r.value, 12, 700))) + 24;
    const away = half + 12 + estW / 2;
    // Align the card's top edge with the block's peak, kept within the chart height (ChartFrame draws the card its height + 14px above y)
    const cardTop = Math.max(4, Math.min(topY, H - estH - 4));
    return { x: cx + away + estW / 2 <= W - 4 ? cx + away : cx - away, y: cardTop + estH + 14, title, rows: tipRows };
  };

  // Tooltip: back row series top → bottom and total, front row series top → bottom and total, ratio. The selected row's head (its total, or the row itself with one series) is bold
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

  // Automatic description: the back row's peak period, the front row's peak period and its ratio to the back row, and the merge unit when merged
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

  // Dates: centered under the front faces (the two ends pulled inside the chart). When crowded, thin them out by those positions
  const dates = useMemo(() => {
    const xs = periods.map((pd, i) => inside(L.slotX(i) + L.w / 2, pd.label, AXIS_FONT, W));
    return { xs, show: thinLabels(xs, periods.map((x) => x.label), AXIS_FONT, 6) };
  }, [L, periods, W]);
  const stripTop = L.floor + SLAB + 20;
  const dateY = showStrip ? stripTop + STRIP_H + 14 : L.floor + SLAB + 12;

  const pick = (px: number, py: number, touch: boolean) => {
    if (empty) return;
    const i = evenIndex(px, L.slotX(0) + L.s * 0.49, L.slotX(shown - 1) + L.s * 0.49, shown);
    // From slightly above the front row block's peak (the back edge of its top in high) downward is the front row; above that is the back row. Touch picks only the period and starts on the back row
    const reach = high ? L.depthFront * L.cy + 4 : 6;
    const next = !touch && hasFront && py >= L.floor - L.frontTotal[i] * L.k - reach ? "front" : "back";
    if (next !== row) setRow(next);
    if (i !== c.active) c.setActive(i, touch ? "touch" : "pointer");
  };

  const wallTop = L.top - 10;
  const fx0 = L.slotX(0) - 8;
  const fx1 = L.slotX(shown - 1) + L.w + 8;
  const deep = L.lead + L.depthBack + 8;
  const floorTop = pts([
    [fx0, L.floor + SLAB],
    [fx1, L.floor + SLAB],
    [fx1 + deep * L.cx, L.floor + SLAB - deep * L.cy],
    [fx0 + deep * L.cx, L.floor + SLAB - deep * L.cy],
  ]);

  const peakLabel = () => {
    const g = geom(peakB, "back");
    const text = msg.peak(fv(L.backTotal[peakB]));
    // For the rightmost period, pull the label inside the back wall so it does not run into the tick label column
    const x = Math.min(g.x + (g.w + g.dx) / 2, (wall ? L.wallX[1] : W - 2) - textWidth(text, 11.5, 700) / 2);
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
                if (high) {
                  // high: a total of 0 gets a dashed empty spot on the floor; above 0, a top tile is drawn even under 1px. Lengths are not changed
                  // (Zero is judged by value. Even when a very short chart makes the scale factor 0, a block with a value is not an empty spot)
                  if (total(i, r) === 0) return <polygon key={r} points={pts([[g.x, g.base], [g.x + g.w, g.base], [g.x + g.w + g.dx, g.base + g.dy], [g.x + g.dx, g.base + g.dy]])} fill="none" stroke={p.paint("neutralStrong")} strokeOpacity={0.7} strokeDasharray="2 2" />;
                  return <Prism key={r} p={p} g={g} cum={it.v} colors={swatches(i, r)} hatch={hatched(r) ? hatchFill : null} lid={r === "back" ? backLid : frontLid} lidSplit={r === "front" && colors.split ? { fills: swatches(i, r).map((s) => s.fill), values: values(i, r) } : undefined} lidStroke lidInk={r === "front"} lidHatch={r === "front"} shade={shade} tile />;
                }
                // low: a nonzero value under 1px becomes a thin line on the floor instead of a block (in the top series' color). Lengths are not changed
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
