import { useEffect, useId, useMemo, useRef } from "react";
import { GridY, yAxisWidth } from "../core/axis";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { formatDate, makeTickFormatter, toDate } from "../core/format";
import { polyline, r2 } from "../core/geometry";
import { plural, type ChartLang } from "../core/i18n";
import { subscribeTick, type Mark } from "../core/motion";
import { fitDomain, scaleLinear } from "../core/scale";
import { textWidth } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { getter, numGetter } from "../data/accessor";

const TOP = 10;
const BOTTOM = 22;

/** Time span as "30s", "1m" / "30초", "1분" */
const span = (ms: number, ko: boolean) => {
  const [n, u] = ms >= 3600000 ? [ms / 3600000, ko ? "시간" : "h"] : ms >= 60000 ? [ms / 60000, ko ? "분" : "m"] : [ms / 1000, ko ? "초" : "s"];
  return `${Math.round(n * 10) / 10}${u}`;
};

const tr = (x: number, y = 0) => `translate(${r2(x)},${r2(y)})`;

const en = {
  kind: "Live line chart",
  now: "now",
  ago: (s: string) => `${s} ago`,
  desc: (win: string, n: number, last: string, lo: string, hi: string) => `Last ${win}, ${plural(n, "point")}. Latest ${last}, low ${lo}, high ${hi}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "실시간 라인 차트", now: "지금", ago: (s) => `${s} 전`, desc: (win, n, last, lo, hi) => `최근 ${win} ${n}개 지점. 최근 값 ${last}, 최저 ${lo}, 최고 ${hi}` },
};

export interface LiveLineChartProps<T = Row> extends BaseChartProps<T> {
  /** Time field (Date, ms number, ISO string). Default "t" */
  x?: Accessor<T, unknown>;
  /** Value field. Default "v" */
  y?: Accessor<T, number>;
  /** Visible time span (ms). Default 60000 (1 minute) */
  window?: number;
  /** Gradient under the line. Default true */
  area?: boolean;
  /** Fixed y range. Without it, the range smoothly follows the visible points */
  yDomain?: [number, number];
}

interface Pt<T> {
  t: number;
  v: number;
  d: T;
}

/**
 * Advances the screen clock by one frame (dt ms). When data stops and the clock passes the newest point (tA), it keeps running, so the line's end is pushed left,
 * and the next point to arrive attaches right at the right edge. When it falls more than two intervals behind it catches up that much faster (even when a backlog of points arrives at once), and when it gets more than one window ahead it returns to the newest point
 */
export function stepClock(clock: number, dt: number, s: { tA: number; gap: number; win: number; paused: boolean }): number {
  if (s.paused) return clock;
  const lag = s.tA - clock;
  const next = clock + dt * (s.gap && lag > 2 * s.gap ? lag / (2 * s.gap) : 1);
  return next > s.tA + s.win ? s.tA : next;
}

/** Value at time td (linear between two points). NaN when there are no points */
function valueAt<T>(pts: Pt<T>[], td: number): number {
  let k = pts.length - 1;
  while (k > 0 && pts[k].t > td) k--;
  const a = pts[k];
  const b = pts[k + 1];
  if (!a) return NaN;
  return b && td > a.t ? a.v + ((b.v - a.v) * (td - a.t)) / (b.t - a.t || 1) : a.v;
}

/**
 * Live line chart: when a new point comes in, the line slides left, and the dot and value tag at the right end follow the line.
 * Screen time trails data time slightly, so the line's end never runs empty before the next point arrives. When data stops, time keeps flowing, so
 * the line's end is pushed left (the empty space shows the gap), and the next point to arrive attaches right at the right edge.
 * Pointing at a point with the mouse or keyboard pauses it so the value can be read. With reduced motion, it moves only when a point comes in
 */
export function LiveLineChart<T = Row>(props: LiveLineChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(160, Math.min(260, w * 0.42)), duration: 500 });
  const { p, width: W, height: H } = c;
  const gid = useId().replace(/:/g, "");
  const win = Math.max(1000, props.window ?? 60000);
  const msg = MSG[c.lang];
  const ko = c.lang === "ko";

  // Points in time order. Rows whose time or value cannot be read are dropped
  const pts = useMemo(() => {
    const gx = getter(props.x, "t");
    const gy = numGetter(props.y, "v");
    return props.data
      .map((d, i) => ({ t: toDate(gx(d, i))?.getTime() ?? NaN, v: gy(d, i), d }))
      .filter((q) => Number.isFinite(q.t) && Number.isFinite(q.v))
      .sort((a, b) => a.t - b.t);
  }, [props.data, props.x, props.y]);
  const n = pts.length;
  const tA = n ? pts[n - 1].t : 0;
  // Point interval: the median of the last five intervals
  const gaps: number[] = [];
  for (let i = Math.max(1, n - 5); i < n; i++) gaps.push(pts[i].t - pts[i - 1].t);
  gaps.sort((a, b) => a - b);
  const gap = gaps[gaps.length >> 1] ?? 0;
  // Points to draw: up to one point past the window's left edge (so the line does not stop short at the left end). While a point is pointed at, the left end is pinned, so
  // the pointed point keeps its index even when new points arrive
  const cut = useRef(0);
  if (c.active === null || !cut.current) cut.current = tA - win - 2 * gap;
  let s0 = 0;
  while (s0 < n - 1 && pts[s0 + 1].t < cut.current) s0++;
  const vis = useMemo(() => pts.slice(s0), [pts, s0]);

  let lo = Infinity;
  let hi = -Infinity;
  for (const q of vis) {
    lo = Math.min(lo, q.v);
    hi = Math.max(hi, q.v);
  }
  const yCount = Math.max(2, Math.round(H / 60));
  const [g0, g1] = props.yDomain ?? fitDomain(lo, hi, yCount, { zero: false });
  // When the range changes, the axis follows smoothly instead of jumping
  const marks = useMemo<Mark<null>[]>(() => [{ key: "y", to: [g0, g1], data: null }], [g0, g1]);
  const m = useMotion(marks, c.motion);
  const [d0, d1] = m.get("y") ?? [g0, g1];

  const y = scaleLinear([d0, d1], [H - BOTTOM, TOP]);
  const tickFmt = makeTickFormatter(props.format, c.locale, Math.max(Math.abs(d0), Math.abs(d1)));
  const yTicks = y.ticks(yCount);
  const left = yAxisWidth(yTicks, tickFmt, c.locale);
  const tag = n ? c.fv(pts[n - 1].v) : "";
  const tagW = textWidth(tag, 10.5, 700) + 10;
  const x0 = left + 4;
  const x1 = W - tagW - 14;
  const px = (x1 - x0) / win;
  // The path is drawn with the newest point at x1. When screen time is behind that point, the whole group is shifted right
  const line = vis.map((q) => [x1 + (q.t - tA) * px, y(q.v)] as [number, number]);
  const lp = polyline(line);

  // The time at the right edge of the screen (stepClock). When data stops, it keeps flowing past the newest point
  const clock = useRef(0);
  const moving = c.motion.enabled;
  const shown = c.motion.active;
  if (!moving || !clock.current || Math.abs(clock.current - tA) > win) clock.current = tA;
  const shift = (tA - clock.current) * px;

  const groupRef = useRef<SVGGElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const snap = { tA, gap, win, px, x1, vis, y, bottom: H - BOTTOM, paused: c.active !== null };
  const live = useRef(snap);
  live.current = snap;

  // Hooks into the frame loop all charts share only while on screen with motion on (when visible again, it starts from the newest point)
  useEffect(() => {
    if (!moving || !shown) return undefined;
    clock.current = live.current.tA;
    let at = 0;
    return subscribeTick((now) => {
      const L = live.current;
      // Even when a frame comes late (jank), use the full elapsed time. Capping it would let the clock fall behind and then rush to catch up at the next point.
      // For a very long pause, stepClock resets a clock that is more than one window ahead to the newest point
      const dt = at ? now - at : 0;
      at = now;
      clock.current = stepClock(clock.current, dt, L);
      // When the clock passes the newest point (a gap), the end dot and value tag also move left with the line's end
      const s = (L.tA - clock.current) * L.px;
      groupRef.current?.setAttribute("transform", tr(s));
      headRef.current?.setAttribute("transform", headAt(L, s, clock.current));
      return true;
    });
  }, [moving, shown]);

  const timeOf = (t: number) => formatDate(t, { locale: c.locale, hour: "numeric", minute: "2-digit", second: "2-digit" });
  const events = useMemo<ChartEvent<T>[]>(() => vis.map((q, k) => ({ datum: q.d, index: k, key: String(q.t), label: timeOf(q.t), value: q.v, formatted: c.fv(q.v) })), [vis, c.fv, c.locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const k = c.active ?? -1;
  const act = line[k];
  const tip: TooltipData | null = act ? { x: act[0] + shift, y: act[1], title: timeOf(vis[k].t), rows: [{ value: c.fv(vis[k].v) }] } : null;

  const desc = props.description ?? `${msg.kind}. ${msg.desc(span(win, ko), vis.filter((q) => q.t >= tA - win).length, tag || "-", c.fv(lo), c.fv(hi))}.`;
  const accent = p.paint("accent");

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
      // Nearest point: subtract the current shift, convert to time, and search
      onPointerMove={(mx, _my, e) => {
        if (!vis.length) return;
        const t = tA + (mx - shift - x1) / px;
        let best = 0;
        for (let i = 1; i < vis.length; i++) if (Math.abs(vis[i].t - t) < Math.abs(vis[best].t - t)) best = i;
        c.setActive(best, e.pointerType === "touch" ? "touch" : "pointer");
      }}
      defs={
        <>
          <clipPath id={`${gid}c`}>
            <rect x={x0} y={0} width={Math.max(0, x1 - x0)} height={H} />
          </clipPath>
          <linearGradient id={`${gid}g`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.24} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </linearGradient>
        </>
      }
    >
      <GridY p={p} ticks={yTicks} y={y} x0={left} x1={x1} fmt={tickFmt} locale={c.locale} zero={false} />
      <rect x={x0} y={TOP} width={Math.max(0, x1 - x0)} height={Math.max(0, H - BOTTOM - TOP)} fill="transparent" />
      <g clipPath={`url(#${gid}c)`} pointerEvents="none">
        <g ref={groupRef} transform={tr(shift)}>
          {props.area !== false && line.length > 1 ? <path d={`${lp}V${r2(H - BOTTOM)}H${r2(line[0][0])}Z`} fill={`url(#${gid}g)`} /> : null}
          <path d={lp} fill="none" stroke={accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {act ? <circle cx={act[0]} cy={act[1]} r={3.6} fill={p.paint("ink")} stroke={p.paint("panel")} strokeWidth={1.5} /> : null}
        </g>
      </g>
      {n ? (
        <g ref={headRef} transform={headAt(snap, shift, clock.current)} pointerEvents="none" aria-hidden="true">
          {moving ? (
            <circle r={3.5} fill={accent} opacity={0.35}>
              <animate attributeName="r" values="3.5;11" dur="1.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.35;0" dur="1.6s" repeatCount="indefinite" />
            </circle>
          ) : null}
          <circle r={3.5} fill={accent} stroke={p.paint("panel")} strokeWidth={1.5} />
          <rect x={8} y={-9} width={tagW} height={18} rx={5} fill={accent} />
          <Txt x={8 + tagW / 2} y={0} anchor="middle" size={10.5} weight={700} fill={p.paint("onAccent")}>
            {tag}
          </Txt>
        </g>
      ) : null}
      <g aria-hidden="true">
        {(
          [
            [x0, "start", msg.ago(span(win, ko))],
            [(x0 + x1) / 2, "middle", msg.ago(span(win / 2, ko))],
            [x1, "end", msg.now],
          ] as const
        ).map(([xx, a, label]) => (
          <Txt key={a} x={xx} y={H - BOTTOM + 13} anchor={a} size={10.5} fill={p.paint("muted")}>
            {label}
          </Txt>
        ))}
      </g>
    </ChartFrame>
  );
}

/** Height of the head (the dot at the right end): the value at screen time, clamped inside the plot */
function headY<T>(L: { vis: Pt<T>[]; y: (v: number) => number; bottom: number }, t: number): number {
  return Math.max(TOP, Math.min(L.bottom, L.y(valueAt(L.vis, t))));
}

/** Position of the end dot: the line's end (further left by the shift when data stops) and the value at that time. Shared by drawing and the frame loop */
function headAt<T>(L: { vis: Pt<T>[]; y: (v: number) => number; bottom: number; x1: number; tA: number }, shift: number, clock: number): string {
  return tr(L.x1 + Math.min(0, shift), headY(L, Math.min(clock, L.tA)));
}
