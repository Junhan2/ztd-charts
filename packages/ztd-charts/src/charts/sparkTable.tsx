import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { AXIS_FONT, HoverLine } from "../core/axis";
import { changeRatio, signedPercent } from "../core/brush";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { makeFormatter, withUnit, type DayFirstProps, type FormatSpec, type ValueFormatter } from "../core/format";
import { evenIndex, polyline, r2 } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import { plural, type ChartLang } from "../core/i18n";
import type { Mark } from "../core/motion";
import { extent, scaleLinear, type LinearScale } from "../core/scale";
import { prepSeries, type Aggregate } from "../core/series";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter } from "../data/accessor";
import { lttb } from "../data/parse";
import { useChartLocale } from "../theme/context";

const en = {
  kind: "KPI table",
  latest: "Latest",
  change: "Change",
  previous: "vs. previous",
  target: "Target",
  range: (a: string, b: string) => `${a} to ${b}`,
  desc: (rows: number, total: number, periods: number) => `${total > rows ? `${rows} of ${total} rows` : plural(rows, "row")} over ${plural(periods, "period")}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "지표 표",
    latest: "최근",
    change: "변화",
    previous: "전 기간 대비",
    target: "목표",
    range: (a, b) => `${a}~${b}`,
    desc: (rows, total, periods) => `${total > rows ? `줄 ${total}개 중 ${rows}개` : `줄 ${rows}개`}, 기간 ${periods}개`,
  },
};

/** Settings for one row of the metrics option */
export interface SparkTableMetric {
  format?: FormatSpec;
  unit?: string;
  /** "up" when a higher value is better, "down" when lower is better */
  better?: "up" | "down";
}

export interface SparkTableProps<T = Row> extends BaseChartProps<T>, DayFirstProps {
  /** Row name field: one row per name. Default "label" */
  label?: Accessor<T, unknown>;
  /** Period field: a date, a number or a category. Every row shares the same period axis. Default "x" */
  x?: Accessor<T, unknown>;
  /** Value field. Default "value" */
  value?: Accessor<T, number>;
  /** Target field. Each row uses its last filled target, in period order */
  target?: Accessor<T, number>;
  /** Format, unit and better per row, keyed by row name. Rows without an entry use format, unit and better */
  metrics?: Record<string, SparkTableMetric>;
  /** "up" when a higher value is better, "down" when lower is better. The change pill takes the accent only for a move in the good direction. Default "up" */
  better?: "up" | "down";
  /** "period": first to last value of the visible periods. "previous": the value before the last to the last. "none" hides the column. Default "period" */
  change?: "period" | "previous" | "none";
  /** Header of the change column. Default "Change" ("vs. previous" with change "previous") */
  changeLabel?: string;
  /** Row order: "none" keeps the data order, "value" puts the largest latest value first, "change" the best change first. Default "none" */
  sort?: "none" | "value" | "change";
  /** A bar beside each value, relative to the largest. Ignored when rows use different formats or units. Default false */
  valueBar?: boolean;
  /** Row height in px, 24 to 56. Default 32. When an explicit height has no room for every row, the rows shrink to fit it, down to 20px, and the rows that still do not fit are left out */
  rowHeight?: number;
  /** Header row with the period range and column names. Default true */
  header?: boolean;
  /** How rows with the same period and name combine. Default "sum" */
  aggregate?: Aggregate;
}

/** Rows drawn at most. The validator warns past it */
const MAX_ROWS = 60;
const HEAD_H = 24;
const PAD = 2;
/** The trend column never gets narrower than this: the target column, then the change column, gives way first */
const MIN_TREND = 64;
const BAR_W = 40;
/** Smallest row an explicit height can shrink rows to: the 18px change pill still fits inside it */
const MIN_FIT = 20;
/** Largest of the list, 0 at least. A missing value (NaN) is skipped, so one empty row keeps the other rows' value bars */
const widest = (list: number[]) => list.reduce((a, b) => Math.max(a, b || 0), 0);

interface SparkRow<T> {
  name: string;
  vals: number[];
  /** Last period with a value, -1 when the row has none */
  li: number;
  /** Value at li, NaN when the row has none */
  last: number;
  /** Change pill text ("" when there is no change to show) */
  pill: string;
  /** Change in the good direction (a fall counts as a gain for better "down"): above 0 takes the accent pill, and sort "change" orders by it */
  gain: number;
  target: number;
  fmt: ValueFormatter;
  /** Format and unit, compared to decide whether value bars share one scale */
  look: string;
  datum: T | null;
}

/**
 * KPI table: one row per metric with its name, a small trend line, the latest value, the change and the target.
 * Every row shares one period axis but has its own scale, so metrics in different units sit together. Up and down move rows, left and right move the period
 */
export function SparkTable<T = Row>(props: SparkTableProps<T>) {
  const locale = useChartLocale(props.locale);
  const model = useMemo(
    () => prepSeries(props.data, props.x, props.value ?? "value", props.label ?? "label", { locale, dayFirst: props.dayFirst, aggregate: props.aggregate }),
    [props.data, props.x, props.value, props.label, locale, props.dayFirst, props.aggregate],
  );
  const headH = props.header === false ? 0 : HEAD_H;
  const rowH0 = Math.max(24, Math.min(56, props.rowHeight ?? 32));
  const total = model.series.length;
  const c = useChart(props, { height: () => headH + Math.max(1, Math.min(MAX_ROWS, total)) * rowH0 + 4, duration: 900 });
  const { p, width: W, height: H } = c;
  // An explicit height keeps every row inside it: rows that do not fit at MIN_FIT are left out (the description says how many), as past MAX_ROWS
  const room = H - headH - 4;
  const fit = props.height === undefined ? MAX_ROWS : Math.max(1, Math.floor(room / MIN_FIT));
  const gid = useId().replace(/:/g, "");
  const msg = MSG[c.lang];
  const n = model.keys.length;
  // Period pointed at or picked with left and right (-1: the latest value of each row). It follows the selected row and resets with it
  const [period, setPeriod] = useState(-1);
  const stale = period >= 0 && (c.active === null || period >= n);
  if (stale) setPeriod(-1);
  const at = stale ? -1 : period;

  const mode = props.change === "previous" || props.change === "none" ? props.change : "period";
  const { metrics, better, format, unit, target, data } = props;
  const base = useMemo(() => {
    // Only a target given as a function needs the original row index
    const index = typeof target === "function" ? new Map(data.map((d, i) => [d, i])) : null;
    const readTarget = target === undefined ? null : numGetter(target, "target");
    return model.series.slice(0, MAX_ROWS).map((name, s): SparkRow<T> => {
      const vals = model.values[s];
      const m: SparkTableMetric = metrics?.[name] ?? {};
      const f = m.format ?? format;
      const u = m.unit ?? unit;
      let li = vals.length - 1;
      while (li >= 0 && !Number.isFinite(vals[li])) li--;
      let fi = 0;
      while (fi < li && !Number.isFinite(vals[fi])) fi++;
      let pi = li - 1;
      while (pi >= 0 && !Number.isFinite(vals[pi])) pi--;
      const ratio = li < 0 || mode === "none" ? null : changeRatio(vals[mode === "previous" ? pi : fi], vals[li]);
      const down = (m.better ?? better) === "down";
      let tv = NaN;
      for (let k = vals.length - 1; readTarget && k >= 0 && !Number.isFinite(tv); k--) {
        const d = model.rows[s][k];
        if (d !== null) tv = readTarget(d, index?.get(d) ?? -1);
      }
      return {
        name,
        vals,
        li,
        last: li >= 0 ? vals[li] : NaN,
        pill: ratio === null ? "" : signedPercent(ratio, locale),
        gain: ratio === null ? -Infinity : down ? -ratio : ratio,
        target: tv,
        fmt: withUnit(makeFormatter(f, locale), u),
        look: JSON.stringify([f, u]),
        datum: li >= 0 ? model.rows[s][li] : null,
      };
    });
  }, [model, metrics, better, format, unit, target, data, mode, locale]);

  const sort = props.sort;
  const rows = useMemo(() => {
    // No value anywhere: nothing to draw, and no events, so the frame describes the chart as empty
    if (!base.some((r) => r.li >= 0)) return [];
    const key = (r: SparkRow<T>) => (sort === "change" ? r.gain : r.li < 0 ? -Infinity : r.last);
    return (sort !== "value" && sort !== "change" ? base : [...base].sort((a, b) => key(b) - key(a) || 0)).slice(0, fit);
  }, [base, sort, fit]);
  // The rows shrink only when the explicit height is short of them; with room to spare they keep rowHeight
  const rowH = props.height === undefined ? rowH0 : Math.max(MIN_FIT, Math.min(rowH0, room / Math.max(1, rows.length)));
  const hi = useMemo(() => resolveHighlight(props.highlight, rows.map((r) => r.datum) as T[], rows.map((r) => r.name), rows.map((r) => r.last), "none"), [props.highlight, rows]);

  const changeLabel = props.changeLabel ?? (mode === "previous" ? msg.previous : msg.change);
  const bars = props.valueBar === true && new Set(rows.map((r) => r.look)).size === 1;
  const lay = useMemo(() => {
    // A column fits its header and every row's cell
    const col = (head: string, cell: (r: SparkRow<T>) => number) => widest([textWidth(head, AXIS_FONT, 600), ...rows.map(cell)]) + 12;
    const nameW = Math.min(W * 0.3, widest(rows.map((r, i) => textWidth(r.name, 12, hi.has(i) ? 700 : 500))) + 12);
    // Wide enough for each row's lowest, highest and last value, so the column does not jump while a period is pointed at
    const valueW = col(msg.latest, (r) => (r.li < 0 ? 0 : widest([...extent(r.vals), r.last].map((v) => textWidth(r.fmt(v), 12, 700))))) + (bars ? BAR_W + 6 : 0);
    let changeW = mode === "none" ? 0 : col(changeLabel, (r) => textWidth(r.pill || "-", 11, 700) + 14);
    let targetW = rows.some((r) => Number.isFinite(r.target)) ? col(msg.target, (r) => (Number.isFinite(r.target) ? textWidth(r.fmt(r.target), 11.5, 500) : 0)) : 0;
    let trendW = W - 2 * PAD - nameW - valueW - changeW - targetW;
    if (trendW < MIN_TREND) {
      trendW += targetW;
      targetW = 0;
    }
    if (trendW < MIN_TREND) {
      trendW += changeW;
      changeW = 0;
    }
    trendW = Math.max(0, trendW);
    const tx0 = PAD + nameW;
    const valueX = tx0 + trendW + valueW;
    const changeX = valueX + changeW;
    return { nameW, tx0, trendW, valueW, valueX, changeW, changeX, targetW, targetX: changeX + targetW };
  }, [rows, hi, W, bars, mode, changeLabel, msg]);

  // Period positions inside the trend column (the end dot stays clear of the value column)
  const ix0 = lay.tx0 + 4;
  const ix1 = Math.max(ix0, lay.tx0 + lay.trendW - 6);
  const xs = (k: number) => (n > 1 ? ix0 + (k / (n - 1)) * (ix1 - ix0) : (ix0 + ix1) / 2);
  // Each row's own scale, from its lowest to its highest value with the target included
  const ys = useMemo<LinearScale[]>(
    () =>
      rows.map((r, i) => {
        const [lo, top] = extent([...r.vals, r.target]);
        const y0 = headH + i * rowH;
        return scaleLinear(lo === top ? [lo - 1, top + 1] : [lo, top], [y0 + rowH - 6, y0 + 6]);
      }),
    [rows, headH, rowH],
  );

  const markers = useMemo<Mark<null>[]>(() => [{ key: "__d", to: [1], from: [0], data: null }], []);
  const m = useMotion(markers, c.motion);
  const t = m.get("__d")?.[0] ?? 1;
  const dotOp = Math.max(0, Math.min(1, (t - 0.85) / 0.15));
  const fade = m.fade(450, 300);
  const ink = p.paint("ink");
  const muted = p.paint("muted");
  const accent = p.paint("accent");

  // Trend paths are built only when the data, size or theme change (60 rows stay cheap on hover and during the entrance)
  const trends = useMemo(() => {
    const limit = Math.max(40, Math.round((ix1 - ix0) * 1.5));
    return rows.map((r, i) => {
      if (r.li < 0 || !lay.trendW) return null;
      const y = ys[i];
      let idx: number[] = [];
      for (let k = 0; k < r.vals.length; k++) if (Number.isFinite(r.vals[k])) idx.push(k);
      if (idx.length > limit) idx = lttb(idx.map((k) => ({ x: k, y: r.vals[k], k })), limit).map((q) => q.k);
      // Straight segments, as in the approved mock (and no curve code in the bundle)
      const d = polyline(idx.map((k) => [xs(k), y(r.vals[k])] as [number, number]));
      const ty = y(r.target);
      return idx.length > 1 || Number.isFinite(ty) ? (
        <g key={i}>
          {idx.length > 1 ? <path d={`${d}V${r2(y.range[0])}H${r2(xs(idx[0]))}Z`} fill={hi.has(i) ? accent : p.paint("neutralSoft")} fillOpacity={hi.has(i) ? 0.14 : undefined} /> : null}
          {Number.isFinite(ty) ? <line x1={r2(ix0 - 2)} x2={r2(ix1 + 2)} y1={r2(ty)} y2={r2(ty)} stroke={muted} strokeWidth={1} strokeDasharray="2 3" /> : null}
          {idx.length > 1 ? <path d={d} fill="none" stroke={hi.has(i) ? accent : p.paint("neutralStrong")} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" /> : null}
        </g>
      ) : null;
    });
    // xs follows ix0, ix1 and n; muted and accent follow p
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, hi, lay, ys, ix0, ix1, n, p]);
  // Row cells follow the entrance (end dots, pills and targets fade in) but not the pointer
  const cells = useMemo(() => {
    return rows.map((r, i) => {
      const y0 = headH + i * rowH;
      const mid = y0 + rowH / 2;
      const weight = hi.has(i) ? 700 : 500;
      const pw = textWidth(r.pill, 11, 700) + 14;
      return (
        <g key={i}>
          {i > 0 || headH ? <line x1={0} x2={W} y1={Math.round(y0) + 0.5} y2={Math.round(y0) + 0.5} stroke={p.paint("line")} strokeWidth={1} /> : null}
          <Txt x={PAD} y={mid} size={12} weight={weight} fill={ink}>
            {truncate(r.name, lay.nameW - 12, 12, weight)}
          </Txt>
          {r.li >= 0 && lay.trendW ? <circle cx={r2(xs(r.li))} cy={r2(ys[i](r.last))} r={3.2} fill={hi.has(i) ? accent : ink} stroke={p.paint("panel")} strokeWidth={1.5} opacity={dotOp < 1 ? dotOp : undefined} /> : null}
          <g opacity={fade < 1 ? fade : undefined}>
            {lay.changeW && r.pill ? (
              <g>
                {/* An opaque 14% accent mix rather than a see-through fill: the text keeps its contrast on the selected row's background too */}
                <rect x={r2(lay.changeX - pw)} y={r2(mid - 9)} width={r2(pw)} height={18} rx={9} fill={r.gain > 0 ? p.mix("accent", "panel", 0.14) : p.paint("line")} />
                <Txt x={lay.changeX - pw / 2} y={mid} size={11} weight={700} anchor="middle" fill={p.paint(r.gain > 0 ? "accentText" : "muted")}>
                  {r.pill}
                </Txt>
              </g>
            ) : lay.changeW ? (
              <Txt x={lay.changeX - 7} y={mid} size={11} weight={700} anchor="end" fill={muted}>
                -
              </Txt>
            ) : null}
            {lay.targetW && Number.isFinite(r.target) ? (
              <Txt x={lay.targetX} y={mid} size={11.5} weight={500} anchor="end" fill={muted}>
                {r.fmt(r.target)}
              </Txt>
            ) : null}
          </g>
        </g>
      );
    });
    // xs follows ix0, ix1 and n; ink, muted and accent follow p
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, hi, lay, ys, ix0, ix1, n, p, W, headH, rowH, dotOp, fade]);

  const ar = c.active !== null ? rows[c.active] : undefined;
  const events: ChartEvent<T>[] = useMemo(
    () => rows.map((r, i) => ({ datum: r.datum, index: i, key: r.name, label: r.name, value: r.li >= 0 ? r.last : null, formatted: [r.fmt(r.last), r.pill, Number.isFinite(r.target) ? `${msg.target} ${r.fmt(r.target)}` : ""].filter(Boolean).join(" · ") })),
    [rows, msg],
  );
  // The tooltip names the row and the period: the pointed period, or the row's last value
  const tk = ar ? (at >= 0 ? at : ar.li) : -1;
  const tip: TooltipData | null = ar && tk >= 0 && Number.isFinite(ar.vals[tk]) ? { x: xs(tk), y: ys[c.active!](ar.vals[tk]), title: `${ar.name} · ${model.labels[tk]}`, rows: [{ value: ar.fmt(ar.vals[tk]) }] } : null;
  const announce = c.via === "keyboard" && ar && at >= 0 ? `${ar.name}, ${model.labels[at]}: ${ar.fmt(ar.vals[at])}` : undefined;

  const shown = (r: SparkRow<T>) => (at >= 0 ? r.vals[at] : r.last);
  const barMax = bars ? widest(rows.map(shown)) : 0;
  const range = n > 1 ? msg.range(model.labels[0], model.labels[n - 1]) : (model.labels[0] ?? "");
  const desc = props.description ?? `${msg.kind}. ${msg.desc(rows.length, total, n)}${range ? `, ${range}` : ""}.`;
  const head = (x: number, s: string, anchor?: "end") => (
    <Txt x={x} y={headH / 2} size={AXIS_FONT} weight={600} anchor={anchor} fill={muted}>
      {s}
    </Txt>
  );

  const onPointerMove = (px: number, py: number, e: PointerEvent<SVGSVGElement>) => {
    const i = Math.floor((py - headH) / rowH);
    if (py < headH || i >= rows.length) {
      if (c.active !== null) c.setActive(null);
      return;
    }
    const k = n && lay.trendW && px >= lay.tx0 && px <= lay.tx0 + lay.trendW ? evenIndex(px, ix0, ix1, n) : -1;
    if (i !== c.active) c.setActive(i, e.pointerType === "touch" ? "touch" : "pointer");
    if (k !== period) setPeriod(k);
  };
  // Left and right move the period (from the latest value, right starts at the first period and left at the last); up and down stay with the default row navigation
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || !n) return false;
    const step = e.key === "ArrowRight" ? 1 : -1;
    if (c.active === null) c.setActive(0, "keyboard");
    const next = at < 0 ? (step > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, at + step));
    if (next !== period) setPeriod(next);
    return true;
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
      onPointerMove={onPointerMove}
      onKey={onKey}
      announce={announce}
      defs={
        <clipPath id={`${gid}c`}>
          <rect x={r2(lay.tx0 - 2)} y={0} width={r2(Math.max(0, (lay.trendW + 4) * t))} height={H} />
        </clipPath>
      }
    >
      <rect x={0} y={0} width={W} height={H} fill="transparent" />
      {ar ? <rect x={0} y={headH + c.active! * rowH + 1} width={W} height={rowH - 1} rx={6} fill={p.paint("lift")} /> : null}
      <g clipPath={`url(#${gid}c)`}>{trends}</g>
      {cells}
      {rows.map((r, i) => {
        const v = shown(r);
        const mid = headH + i * rowH + rowH / 2;
        return (
          <g key={i} opacity={fade < 1 ? fade : undefined}>
            {bars && barMax > 0 ? <rect x={r2(lay.valueX - lay.valueW + 12)} y={r2(mid - 3)} width={r2((BAR_W * Math.max(0, v || 0)) / barMax)} height={6} rx={3} fill={p.paint(hi.has(i) ? "accent" : "neutral")} /> : null}
            <Txt x={lay.valueX} y={mid} size={12} weight={700} anchor="end" fill={ink}>
              {r.fmt(v)}
            </Txt>
          </g>
        );
      })}
      {headH && rows.length ? (
        <g>
          {lay.trendW ? head(ix0, truncate(range, lay.trendW - 8, AXIS_FONT, 600)) : null}
          {head(lay.valueX, truncate(at >= 0 ? model.labels[at] : msg.latest, lay.valueW - 8, AXIS_FONT, 600), "end")}
          {lay.changeW ? head(lay.changeX, changeLabel, "end") : null}
          {lay.targetW ? head(lay.targetX, msg.target, "end") : null}
        </g>
      ) : null}
      {at >= 0 && lay.trendW ? (
        <HoverLine
          p={p}
          x={xs(at)}
          top={headH + 2}
          bottom={headH + rows.length * rowH - 2}
          dots={rows.flatMap((r, i) => (Number.isFinite(r.vals[at]) ? [{ k: i, y: ys[i](r.vals[at]), color: hi.has(i) ? accent : ink, strong: i === c.active }] : []))}
        />
      ) : null}
    </ChartFrame>
  );
}
