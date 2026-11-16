import { useEffect, useMemo, useState } from "react";
import { AXIS_FONT, thinLabels } from "../core/axis";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { cssEntrance, useCssEntrance } from "../core/css";
import { clamp, r2, roundRectPath } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import { plural, type ChartLang } from "../core/i18n";
import { lazyArray } from "../core/lazy";
import { colorScaleOf, readableOn, scaleSwatch } from "../core/palette";
import { robustMax } from "../core/scale";
import { ScaleLegend } from "../core/scaleLegend";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import type { UseMotionOptions } from "../core/useMotion";
import { baseColumn, cohortAverages, readCohort, type CohortValueType } from "../layout/cohort";

const en = {
  kind: "Cohort chart",
  legend: ["Lower", "Higher"] as [string, string],
  average: "Average",
  retained: "Retained",
  people: "People",
  of: (part: string, whole: string) => `${part} of ${whole}`,
  desc: (cohorts: number, periods: number) => `${plural(cohorts, "cohort")} × ${plural(periods, "period")}`,
  avg: (list: string) => `Average retention: ${list}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "코호트 차트",
    legend: ["낮음", "높음"],
    average: "평균",
    retained: "남은 비율",
    people: "사람 수",
    of: (part, whole) => `${whole} 중 ${part}`,
    desc: (cohorts, periods) => `코호트 ${cohorts}개 × 기간 ${periods}개`,
    avg: (list) => `평균 잔존율: ${list}`,
  },
};

export interface CohortChartProps<T = Row> extends BaseChartProps<T> {
  /** Cohort field: a name or a start date, one row per cohort. Default "cohort" */
  cohort?: Accessor<T, unknown>;
  /** Periods since the cohort started (0, 1, 2 ...), one column per period. Default "period" */
  period?: Accessor<T, unknown>;
  /** People still active, or the share still active. Default "value" */
  value?: Accessor<T, number>;
  /** Cohort size. The first value of each cohort counts */
  size?: Accessor<T, number>;
  /**
   * How values are read. "auto" (default): counts with a size field, ratios (0 to 1) when every value is at most 1,
   * percents when every value is at most 100, otherwise counts with each cohort's first period as its size
   */
  valueType?: "auto" | CohortValueType;
  /** Text in cells: the share ("rate", default) or the people still active ("count", only when counts are known). Colors always follow the share */
  show?: "rate" | "count";
  /** Average row on top, weighted by cohort size when counts are known. Default true */
  average?: boolean;
  /** Number of color steps (2~12). Default 5 */
  colorSteps?: number;
  /** Values inside cells. "auto" shows them only when every cell has room. Default "auto" */
  showValues?: boolean | "auto";
  /** Color legend on top. Default true */
  legend?: boolean;
  /** Labels at both ends of the legend. Default ["Lower", "Higher"] (["낮음", "높음"] in the Korean locale) */
  legendLabels?: [string, string];
}

/** Opacity of the lightest step. Keeps it apart from the light gray base column (as in the tile grid map) */
const MIN_OPACITY = 0.14;
/** Heights (px): the legend, the period names, a row by default, and the gap under the average row */
const LEGEND_H = 20;
const HEAD_H = 18;
const ROW_H = 26;
const AVG_GAP = 6;
/** Size and weight of the values in cells (as in the heatmap) */
const VALUE_FONT = 10.5;
const VALUE_WEIGHT = 600;
/** The size column goes first when cells would get narrower than this (px) */
const MIN_CELL_W = 20;

/**
 * Entrance clock without the motion engine: waiting until the chart comes into view, again after each replay, and a count of entrances started.
 * The cells run the entrance as a CSS animation, so the engine has nothing else to do and stays out of the bundle.
 * As in useMotion, a chart drawn without motion counts as entered, so turning motion on later (interactive HTML taking over a server drawing) runs no entrance until a replay
 */
function useEntrance(motion: UseMotionOptions): { waiting: boolean; generation: number } {
  // key: the replay the entrance last ran for
  const [ran, setRan] = useState<{ key: unknown; n: number }>(() => ({ key: motion.enabled ? {} : motion.replayKey, n: 0 }));
  const waiting = motion.enabled && !Object.is(ran.key, motion.replayKey);
  useEffect(() => {
    if (!motion.enabled) {
      setRan((r) => (Object.is(r.key, motion.replayKey) ? r : { key: motion.replayKey, n: r.n }));
      return undefined;
    }
    if (!waiting || !motion.active) return undefined;
    // Starts on the next frame, so the hidden first state is painted before the CSS animation is set
    const id = requestAnimationFrame(() => setRan((r) => ({ key: motion.replayKey, n: r.n + 1 })));
    return () => cancelAnimationFrame(id);
  }, [waiting, motion.enabled, motion.active, motion.replayKey]);
  return { waiting, generation: ran.n };
}

/** A drawn cell. row -1 is the average row */
interface Spot<T> {
  row: number;
  col: number;
  rate: number;
  count: number;
  size: number;
  datum: T | null;
}

/** "524 of 1,310" when the people still active and the cohort size are known, otherwise "" (for the table, the announcement and the tooltip) */
function peopleOf(s: { count: number; size: number }, msg: typeof en, fmt: (v: number) => string): string {
  return Number.isFinite(s.count) && s.size > 0 ? msg.of(fmt(s.count), fmt(s.size)) : "";
}

/** Cohort chart (retention table): one row per cohort, one column per period since it started, each cell colored by the share still active */
export function CohortChart<T = Row>(props: CohortChartProps<T>) {
  // Reading, the base column and the color range depend only on the data
  const { model, base, scaled, lo, hi, avgs } = useMemo(() => {
    const model = readCohort(props.data, { cohort: props.cohort, period: props.period, value: props.value, size: props.size }, props.valueType);
    // The base column (everyone at 99.5% or more, usually period 0) is gray and left out of the color scale, so it does not take the whole scale
    const base = baseColumn(model.cells);
    const scaled = model.cells.filter((cl) => cl.col !== base).map((cl) => cl.rate);
    // reduce, as spreading a very long list into Math.min overflows the call stack
    return { model, base, scaled, lo: scaled.reduce((a, v) => Math.min(a, v), Infinity), hi: robustMax(scaled), avgs: cohortAverages(model) };
  }, [props.data, props.cohort, props.period, props.value, props.size, props.valueType]);
  const nC = model.cohorts.length;
  const nP = model.periods.length;
  const avgOn = props.average !== false && model.cells.length > 0;
  const nRows = nC + (avgOn ? 1 : 0);
  const legendH = props.legend !== false && scaled.length ? LEGEND_H : 0;
  const avgY = legendH + HEAD_H;
  const top = avgY + (avgOn ? AVG_GAP : 0);
  const c = useChart(props, { height: () => Math.max(120, Math.min(520, top + nRows * ROW_H)), duration: 600, stagger: 0 });
  const { p, width: W, height: H, fmt, pct } = c;
  const msg = MSG[c.lang];

  const rowH = Math.max(1, (H - top) / Math.max(1, nRows));
  const bodyY = avgY + (avgOn ? rowH + AVG_GAP : 0);
  // Name column, wide enough for the bold names of hover and highlight, and the size column (header "n"), only when sizes are known.
  // room is the width names may take; names are cut at room itself, as adding and then taking away the 10px gap can lose a hair to rounding and cut the widest name
  const side = useMemo(() => {
    const sizes = model.counted ? model.sizes.map((s) => (s > 0 ? fmt(s) : "")) : [];
    const widest = (list: string[], weight: number) => Math.max(0, ...list.map((s) => textWidth(s, AXIS_FONT, weight)));
    const room = Math.min(W * 0.3 - 10, Math.max(10, widest(avgOn ? [msg.average, ...model.cohorts] : model.cohorts, 700)));
    // Names are cut once here, not on every hover redraw
    const cut = (s: string) => truncate(s, room, AXIS_FONT, 700);
    return { sizes, room, average: cut(msg.average), names: model.cohorts.map(cut), sizeW: sizes.some(Boolean) ? widest(["n", ...sizes], 500) + 12 : 0 };
  }, [model, fmt, W, avgOn, msg.average]);
  const nameW = side.room + 10;
  // The size column goes first when cells would get narrower than MIN_CELL_W
  const sizeW = side.sizeW && (W - nameW - side.sizeW) / Math.max(1, nP) >= MIN_CELL_W ? side.sizeW : 0;
  const x0 = nameW + sizeW;
  const cw = (W - x0) / Math.max(1, nP);
  // Cell gaps and corners as in the heatmap
  const gap = Math.min(cw, rowH) > 14 ? 2.5 : Math.min(cw, rowH) > 5 ? 1 : 0;
  const rad = Math.min(p.theme.radiusMark, Math.min(cw, rowH) / 4);
  const w = Math.max(0.5, cw - gap);
  const h = Math.max(0.5, rowH - gap);
  // Colors: from the lowest share to the 95th percentile of the cells outside the base column, in colorSteps steps
  const scale = useMemo(() => colorScaleOf(undefined, undefined, props.colorSteps ?? 5), [props.colorSteps]);

  // Items in reading order: the average row first, then each cohort row. at finds an item by row and column
  const { spots, at } = useMemo(() => {
    const head: Spot<T>[] = avgOn ? avgs.flatMap((a, col) => (Number.isFinite(a.rate) ? [{ row: -1, col, ...a, datum: null }] : [])) : [];
    const list = head.concat(model.cells.map((cl) => ({ ...cl, size: model.sizes[cl.row] })));
    return { spots: list, at: new Map(list.map((s, k) => [(s.row + 1) * nP + s.col, k])) };
  }, [model, avgs, avgOn, nP]);
  // Highlighted cohorts (names, as other charts take labels): the name turns bold and the row gets an outline. None by default
  const hiRows = useMemo(() => resolveHighlight(props.highlight, model.firsts, model.cohorts, model.sizes, "none"), [props.highlight, model]);

  // Color and text of each cell. Neither hover nor a new width changes them, so they are not rebuilt then
  const showCount = props.show === "count" && model.counted;
  const looks = useMemo(() => {
    const span = Math.max(1e-9, hi - lo);
    const soft = { fill: p.paint("neutralSoft"), opacity: 1, ink: readableOn(p, p.theme.neutralSoft) };
    let widest = 0;
    const cells = spots.map((s) => {
      const sw = s.col === base ? null : scaleSwatch(p, clamp((s.rate - lo) / span, 0, 1), MIN_OPACITY, scale);
      // The average row always shows shares
      const label = showCount && s.row >= 0 && Number.isFinite(s.count) ? fmt(s.count) : pct(s.rate * 100);
      widest = Math.max(widest, textWidth(label, VALUE_FONT, VALUE_WEIGHT));
      return { label, ...(sw ? { fill: sw.fill, opacity: sw.opacity, ink: sw.text } : soft) };
    });
    return { cells, widest };
  }, [spots, base, p, lo, hi, scale, showCount, fmt, pct]);

  const showValues = props.showValues ?? "auto";
  const valuesOn = c.showLabels && (showValues === true || (showValues === "auto" && cw >= looks.widest + 8 && rowH >= 15));

  // The cells enter as a CSS animation in a wave from the top left corner, so React does no work per frame for a thousand cells (as the calendar)
  const D = c.motion.duration ?? 600;
  const m = useEntrance(c.motion);
  const enabled = useCssEntrance(c, m);

  const layer = useMemo(() => {
    // First and last column of each highlighted cohort (cells are row by row, in column order)
    const ends = new Map<number, [number, number]>();
    for (const cl of model.cells) {
      if (!hiRows.has(cl.row)) continue;
      const e = ends.get(cl.row);
      if (e) e[1] = cl.col;
      else ends.set(cl.row, [cl.col, cl.col]);
    }
    return (
      <g>
        {spots.map((s, k) => {
          const l = looks.cells[k];
          const x = x0 + s.col * cw + gap / 2;
          const y = (s.row < 0 ? avgY : bodyY + s.row * rowH) + gap / 2;
          const wave = (s.col / Math.max(1, nP - 1)) * 0.6 + ((s.row + (avgOn ? 1 : 0)) / Math.max(1, nRows - 1)) * 0.4;
          return (
            <g key={`${s.row}|${s.col}`} style={cssEntrance(enabled, m.waiting, "fade", wave * D * 0.9, 320)}>
              <path d={roundRectPath(x, y, w, h, rad)} fill={l.fill} opacity={l.opacity} className="ztd-mark" />
              {valuesOn ? (
                <Txt x={x + w / 2} y={y + h / 2} anchor="middle" size={VALUE_FONT} weight={VALUE_WEIGHT} fill={l.ink}>
                  {l.label}
                </Txt>
              ) : null}
            </g>
          );
        })}
        {[...hiRows].map((row) => {
          // A highlighted cohort gets an outline around its row
          const e = ends.get(row);
          return e ? <path key={`o${row}`} d={roundRectPath(x0 + e[0] * cw + gap / 2 - 1.5, bodyY + row * rowH + gap / 2 - 1.5, (e[1] - e[0]) * cw + w + 3, h + 3, rad + 1.5)} fill="none" stroke={p.paint("ink")} strokeWidth={1.5} pointerEvents="none" /> : null;
        })}
      </g>
    );
  }, [spots, looks, valuesOn, enabled, m.waiting, D, hiRows, model.cells, nP, nRows, avgOn, x0, cw, avgY, bodyY, rowH, gap, w, h, rad, p]);

  const events: ChartEvent<T>[] = useMemo(
    () =>
      lazyArray(spots.length, (k) => {
        const s = spots[k];
        const name = s.row < 0 ? msg.average : model.cohorts[s.row];
        const who = peopleOf(s, msg, fmt);
        return { datum: s.datum, index: k, key: `${name}|${model.periods[s.col]}`, label: `${name} · ${model.periods[s.col]}`, value: s.rate * 100, formatted: `${pct(s.rate * 100)}${who ? `, ${who}` : ""}` };
      }),
    [spots, model, msg, pct, fmt],
  );

  const k0 = c.active;
  const act = k0 !== null ? spots[k0] : undefined;
  let tip: TooltipData | null = null;
  let shade = "";
  let ring = "";
  if (act) {
    const cx = x0 + act.col * cw;
    const ry = act.row < 0 ? avgY : bodyY + act.row * rowH;
    // Top left corner of the active cell, as the layer draws it
    const ax = cx + gap / 2;
    const ay = ry + gap / 2;
    const who = peopleOf(act, msg, fmt);
    tip = { x: ax + w / 2, y: ay, title: events[k0!].label, rows: [{ label: msg.retained, value: pct(act.rate * 100), color: p.paint("accent") }, ...(who ? [{ label: msg.people, value: who, strong: false }] : [])] };
    ring = roundRectPath(ax - 1, ay - 1, w + 2, h + 2, rad + 1);
    // The active row and column stay; the rest of the grid (from the top row down) is shaded with the card color, the same as 0.55 opacity
    const rect = (xa: number, ya: number, xb: number, yb: number) => (xb - xa > 0.01 && yb - ya > 0.01 ? `M${r2(xa)},${r2(ya)}H${r2(xb)}V${r2(yb)}H${r2(xa)}Z` : "");
    shade = rect(x0, avgY, cx, ry) + rect(cx + cw, avgY, W, ry) + rect(x0, ry + rowH, cx, H) + rect(cx + cw, ry + rowH, W, H);
  }

  // Text widths are not remeasured on every hover redraw. Period names are measured bold, as the active one is drawn
  const colLabels = useMemo(() => thinLabels(model.periods.map((_, i) => x0 + i * cw + cw / 2), model.periods, AXIS_FONT, 6, 700), [model.periods, x0, cw]);
  const step = rowH >= 11 ? 1 : Math.ceil(12 / rowH);
  // The averages of the first 6 periods after the base column (only those 6 are formatted, as this runs on every hover redraw)
  const list = avgs
    .flatMap((a, j) => (j !== base && Number.isFinite(a.rate) ? [j] : []))
    .slice(0, 6)
    .map((j) => `${model.periods[j]} ${pct(avgs[j].rate * 100)}`)
    .join(", ");
  const desc = props.description ?? (model.cells.length ? `${msg.kind}. ${msg.desc(nC, nP)}.${list ? ` ${msg.avg(list)}.` : ""}` : "");
  const muted = p.paint("muted");
  const ink = p.paint("ink");
  const headY = legendH + HEAD_H / 2;
  const name = (text: string, y: number, on: boolean, weight: number) => (
    <Txt x={0} y={y} size={AXIS_FONT} weight={on ? 700 : weight} fill={on ? ink : muted}>
      {text}
    </Txt>
  );
  const size = (text: string, y: number) => (
    <Txt x={x0 - 8} y={y} anchor="end" size={AXIS_FONT} weight={500} fill={muted}>
      {text}
    </Txt>
  );

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
      onPointerMove={(px, py, e) => {
        const col = Math.floor((px - x0) / cw);
        const row = avgOn && py >= avgY && py < avgY + rowH ? -1 : py >= bodyY ? Math.floor((py - bodyY) / rowH) : -2;
        const k = col >= 0 && col < nP && row > -2 && row < nC ? at.get((row + 1) * nP + col) ?? null : null;
        if (k !== c.active) c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer");
      }}
      onKey={(e) => {
        // Up and down arrows move to the row above or below in the same column, through the average row (skipping empty cells and stopping at the ends)
        const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
        if (!d || !act) return false;
        for (let row = act.row + d; row >= (avgOn ? -1 : 0) && row < nC; row += d) {
          const k = at.get((row + 1) * nP + act.col);
          if (k !== undefined) {
            c.setActive(k, "keyboard");
            break;
          }
        }
        return true;
      }}
    >
      {legendH ? <ScaleLegend p={p} right={W} steps={scale.steps ?? 5} scale={scale} labels={props.legendLabels ?? msg.legend} min={MIN_OPACITY} /> : null}
      <g onClick={() => c.active !== null && c.click(c.active)}>{layer}</g>
      {shade ? <path d={shade} fill={p.paint("panel")} opacity={0.45} pointerEvents="none" /> : null}
      {ring ? <path d={ring} fill="none" stroke={ink} strokeWidth={2} pointerEvents="none" /> : null}
      <g aria-hidden="true">
        {sizeW ? size("n", headY) : null}
        {colLabels.map((i) => (
          <Txt key={`p${i}`} x={x0 + i * cw + cw / 2} y={headY} anchor="middle" size={AXIS_FONT} weight={act?.col === i ? 700 : 400} fill={act?.col === i ? ink : muted}>
            {model.periods[i]}
          </Txt>
        ))}
        {avgOn ? name(side.average, avgY + rowH / 2, act?.row === -1, 600) : null}
        {side.names.map((text, row) => {
          const y = bodyY + row * rowH + rowH / 2;
          return row % step ? null : (
            <g key={`c${row}`}>
              {name(text, y, act?.row === row || hiRows.has(row), 500)}
              {sizeW && side.sizes[row] ? size(side.sizes[row], y) : null}
            </g>
          );
        })}
      </g>
    </ChartFrame>
  );
}
