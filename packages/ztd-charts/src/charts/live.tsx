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

/** 시간 폭을 "30s", "1m" / "30초", "1분"처럼 */
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
  /** 시각 필드(Date, ms 숫자, ISO 문자열). 기본 "t" */
  x?: Accessor<T, unknown>;
  /** 값 필드. 기본 "v" */
  y?: Accessor<T, number>;
  /** 보이는 시간 폭(ms). 기본 60000(1분) */
  window?: number;
  /** 선 아래 그라데이션. 기본 true */
  area?: boolean;
  /** y 범위 고정. 없으면 보이는 점에 맞춰 부드럽게 따라가요 */
  yDomain?: [number, number];
}

interface Pt<T> {
  t: number;
  v: number;
  d: T;
}

/** 시각 td의 값 (두 점 사이는 직선으로). 점이 없으면 NaN */
function valueAt<T>(pts: Pt<T>[], td: number): number {
  let k = pts.length - 1;
  while (k > 0 && pts[k].t > td) k--;
  const a = pts[k];
  const b = pts[k + 1];
  if (!a) return NaN;
  return b && td > a.t ? a.v + ((b.v - a.v) * (td - a.t)) / (b.t - a.t || 1) : a.v;
}

/**
 * 실시간 라인 차트: 새 점이 들어오면 선이 왼쪽으로 미끄러지고, 오른쪽 끝의 점과 값 표가 선을 따라가요.
 * 화면의 시각은 데이터의 시각을 따라가서(벽시계가 아니라) 다음 점이 오기 전에 선 끝이 비지 않아요.
 * 마우스나 키보드로 점을 짚으면 멈춰서 값을 읽게 해요. 동작 줄이기에서는 점이 들어올 때만 옮겨요
 */
export function LiveLineChart<T = Row>(props: LiveLineChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(160, Math.min(260, w * 0.42)), duration: 500 });
  const { p, width: W, height: H } = c;
  const gid = useId().replace(/:/g, "");
  const win = Math.max(1000, props.window ?? 60000);
  const msg = MSG[c.lang];
  const ko = c.lang === "ko";

  // 시각 순 점. 시각이나 값을 읽지 못한 행은 빼요
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
  // 점 간격: 최근 다섯 간격의 가운데 값
  const gaps: number[] = [];
  for (let i = Math.max(1, n - 5); i < n; i++) gaps.push(pts[i].t - pts[i - 1].t);
  gaps.sort((a, b) => a - b);
  const gap = gaps[gaps.length >> 1] ?? 0;
  // 그릴 점: 창 왼쪽 밖 한 점까지 (선이 왼쪽 끝에서 끊기지 않게). 점을 짚는 동안은 왼쪽 끝을 묶어 둬서
  // 새 점이 와도 짚은 점의 순서가 그대로예요
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
  // 범위가 바뀌면 축이 튀지 않고 따라가요
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
  // 경로는 가장 새 점을 x1에 두고 그려요. 화면 시각이 그 점보다 늦으면 묶음 전체를 오른쪽으로 밀어 둬요
  const line = vis.map((q) => [x1 + (q.t - tA) * px, y(q.v)] as [number, number]);
  const lp = polyline(line);

  // 화면 오른쪽 끝의 시각. 가장 새 점을 넘지 않고, 너무 뒤처지면 빨리 따라잡아요
  const clock = useRef(0);
  const moving = c.motion.enabled;
  const shown = c.motion.active;
  if (!moving || !clock.current || clock.current < tA - win) clock.current = tA;
  const shift = (tA - clock.current) * px;

  const groupRef = useRef<SVGGElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const snap = { tA, gap, px, x1, vis, y, bottom: H - BOTTOM, paused: c.active !== null };
  const live = useRef(snap);
  live.current = snap;

  // 화면에 보이고 움직임이 켜졌을 때만 모든 차트가 같이 쓰는 프레임 루프에 붙어요 (다시 보이면 가장 새 점부터)
  useEffect(() => {
    if (!moving || !shown) return undefined;
    clock.current = live.current.tA;
    let at = 0;
    return subscribeTick((now) => {
      const L = live.current;
      const dt = at ? Math.min(250, now - at) : 0;
      at = now;
      // 두 간격 넘게 뒤처지면 그만큼 빨리 가요 (쌓인 점이 한꺼번에 와도 곧 따라잡아요)
      const lag = L.tA - clock.current;
      if (!L.paused) clock.current = Math.min(L.tA, clock.current + dt * (L.gap && lag > 2 * L.gap ? lag / (2 * L.gap) : 1));
      groupRef.current?.setAttribute("transform", tr((L.tA - clock.current) * L.px));
      headRef.current?.setAttribute("transform", tr(L.x1, headY(L, clock.current)));
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
      // 가장 가까운 점: 지금 밀린 만큼 빼고 시각으로 바꿔 찾아요
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
        <g ref={headRef} transform={tr(x1, headY(snap, clock.current))} pointerEvents="none" aria-hidden="true">
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

/** 머리(오른쪽 끝 점)의 높이: 화면 시각의 값, 그림 안으로 */
function headY<T>(L: { vis: Pt<T>[]; y: (v: number) => number; bottom: number }, t: number): number {
  return Math.max(TOP, Math.min(L.bottom, L.y(valueAt(L.vis, t))));
}
