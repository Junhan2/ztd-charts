import { useCallback, useMemo } from "react";
import { CanvasLayer } from "../core/CanvasLayer";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { cssEntrance, useCssEntrance } from "../core/css";
import { dayFirstOf, formatDate, isoDay, toDate, type DayFirstProps } from "../core/format";
import { resolveHighlight } from "../core/highlight";
import { lazyArray } from "../core/lazy";
import type { Mark } from "../core/motion";
import { colorScaleOf, scaleSwatch, scaleT } from "../core/palette";
import { extent, robustMax } from "../core/scale";
import { textWidth } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { getter, numGetter } from "../data/accessor";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Calendar heatmap",
  desc: (days: number, max: string) => `${plural(days, "day")}, max ${max}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "캘린더 히트맵", desc: (days, max) => `${days}일, 최대 ${max}` },
};

export interface CalendarHeatmapProps<T = Row> extends BaseChartProps<T>, DayFirstProps {
  /** 날짜 필드. 기본 "date" */
  date?: Accessor<T, unknown>;
  value?: Accessor<T, number>;
  /** 주 시작 요일. 0 일요일(기본), 1 월요일 */
  weekStart?: 0 | 1;
  /** 칸 사이 간격(px). 기본 2.5 */
  gap?: number;
  /** 이 일 수보다 많으면 캔버스로 그려요. 기본 4000 (약 11년) */
  canvasThreshold?: number;
  /** 가장 작은 값을 가장 진하게 칠해요 (1위가 진해야 하는 순위). 기본 false */
  colorReverse?: boolean;
  /** 가장 옅은 색이 되는 값. 그보다 크면 강조색, 작으면 회색 (손익의 0). 0인 날은 그대로 빈 칸 색 */
  colorCenter?: number;
  /** 부드러운 색 대신 이 수만큼 단계로 나눠 칠해요 (2~12) */
  colorSteps?: number;
}

interface Day<T> {
  i: number;
  t: number;
  week: number;
  wd: number;
  year: number;
  value: number;
  datum: T | null;
}

const DAY = 86400000;
const MIN_OPACITY = 0.18;

/** 캘린더 히트맵: 하루하루의 양을 주 단위 격자로 (1년이 넘으면 연도별로 줄을 나눠요) */
export function CalendarHeatmap<T = Row>(props: CalendarHeatmapProps<T>) {
  const model = useMemo(() => {
    const gd = getter(props.date, "date");
    const gv = numGetter(props.value, "value");
    const byDay = new Map<number, { v: number; d: T }>();
    const df = props.dayFirst ?? dayFirstOf(props.data.map((d, i) => gd(d, i)));
    props.data.forEach((d, i) => {
      const dt = toDate(gd(d, i), df);
      if (!dt) return;
      const key = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
      const prev = byDay.get(key);
      // A missing value stays missing (no colour, "-" in the table) unless the day also has a real one.
      const v = gv(d, i);
      const pv = prev?.v ?? NaN;
      byDay.set(key, { v: Number.isFinite(v) ? (Number.isFinite(pv) ? pv : 0) + v : pv, d });
    });
    const keys = [...byDay.keys()].sort((a, b) => a - b);
    const years = keys.length ? [...new Set(keys.map((k) => new Date(k).getFullYear()))].sort() : [];
    return { byDay, keys, years };
  }, [props.data, props.date, props.value, props.dayFirst]);

  const nYears = Math.max(1, model.years.length);
  const multi = nYears > 1;
  const c = useChart(props, { height: (w) => (multi ? nYears * Math.max(70, Math.min(110, w / 8)) + 18 : Math.max(120, Math.min(190, w / 4.6 + 24))), duration: 700 });
  const { p, width: W, height: H } = c;
  const ws = props.weekStart ?? 0;
  // 요일 이름은 로캘대로 (2024-01-07은 일요일). 왼쪽 칸은 1, 3, 5번째 줄 이름이 들어가게 넓혀요
  const wd = useMemo(() => {
    const f = new Intl.DateTimeFormat(c.locale, { weekday: "short" });
    return Array.from({ length: 7 }, (_, d) => f.format(new Date(2024, 0, 7 + d)));
  }, [c.locale]);
  const leftW = Math.max(22, Math.ceil(Math.max(...[1, 3, 5].map((r) => textWidth(wd[(r + ws) % 7], 9.5)))) + 10);
  const topH = 16;
  const maxGap = props.gap ?? 2.5;

  const days = useMemo<Day<T>[]>(() => {
    const out: Day<T>[] = [];
    if (!model.keys.length) return out;
    const first = new Date(model.keys[0]);
    const last = new Date(model.keys[model.keys.length - 1]);
    const ranges = multi ? model.years.map((y) => [new Date(y, 0, 1), new Date(y, 11, 31)] as const) : [[first, last] as const];
    ranges.forEach(([a, b], yi) => {
      const start = new Date(a);
      start.setDate(start.getDate() - ((start.getDay() - ws + 7) % 7));
      // 하루씩 날짜로 넘겨요. 24시간씩 더하면 서머타임이 있는 시간대에서 하루가 빠지거나 겹쳐요
      const end = b.getTime();
      for (const d = new Date(a.getFullYear(), a.getMonth(), a.getDate()); d.getTime() <= end; d.setDate(d.getDate() + 1)) {
        const tt = d.getTime();
        const week = Math.floor((tt - start.getTime() + 3600000) / (7 * DAY));
        const hit = model.byDay.get(tt);
        out.push({ i: out.length, t: tt, week, wd: (d.getDay() - ws + 7) % 7, year: yi, value: hit ? hit.v : 0, datum: hit?.d ?? null });
      }
    });
    return out;
  }, [model, multi, ws]);

  const stats = useMemo(() => {
    let weeks = 1;
    for (const d of days) if (d.week + 1 > weeks) weeks = d.week + 1;
    const vals = days.map((d) => d.value);
    return { weeks, ext: extent(vals), top95: robustMax(vals.filter((v) => v > 0)) };
  }, [days]);
  const { weeks, top95 } = stats;
  const [mn, mx] = stats.ext;
  const useCanvas = c.hydrated && days.length > (props.canvasThreshold ?? 4000);
  const blockH = (H - (multi ? 4 : 0)) / nYears;
  // 한 칸과 간격이 쓸 수 있는 자리. 칸이 2px보다 작아질 만큼 좁으면 간격도 같은 비율로 줄여서 격자가 폭을 넘지 않아요
  const room = Math.max(0, Math.min((W - leftW - 2) / weeks, (blockH - topH - 4) / 7));
  const gap = room - maxGap >= 2 ? maxGap : (room * maxGap) / (maxGap + 2);
  const cell = room - gap;
  const step = cell + gap;
  const gridW = weeks * step;
  const x0 = leftW + Math.max(0, (W - leftW - gridW) / 2);
  const span = Math.max(1e-9, top95 - Math.min(0, mn)) || 1;
  // 색 척도 옵션. 가운데 값이 있으면 그 값에서 먼 쪽(95백분위)이 끝이에요
  const scale = useMemo(() => colorScaleOf(props.colorReverse, props.colorCenter, props.colorSteps), [props.colorReverse, props.colorCenter, props.colorSteps]);
  const center = scale.center;
  const dev = useMemo(() => (center === undefined ? 0 : Math.max(1e-9, robustMax(days.filter((d) => d.value).map((d) => Math.abs(d.value - center))))), [days, center]);
  /** 칸 색의 위치: 0~1(음수 날도 이어지는 눈금), 가운데 값이 있으면 -1~1. SVG 칸과 캔버스가 함께 써요 */
  const tOf = useCallback((v: number) => (center === undefined ? Math.min(1, (v - Math.min(0, mn)) / span) : Math.max(-1, Math.min(1, (v - center) / dev))), [center, dev, mn, span]);
  const hi = useMemo(
    () =>
      resolveHighlight(
        props.highlight as never,
        days.map((d) => d.datum) as never[],
        lazyArray(days.length, (k) => isoDay(days[k].t)),
        // 색을 뒤집으면 기본 강조도 가장 진한 날(가장 작은 값)로. 데이터가 없는 날(0)은 빼요
        props.colorReverse ? days.map((d) => (d.datum ? d.value : NaN)) : days.map((d) => d.value),
        props.colorReverse ? "min" : "max",
      ),
    [days, props.highlight, props.colorReverse],
  );

  const D = c.motion.duration ?? 700;
  // SVG는 주 단위 등장을 CSS로 하고 엔진은 시작 시점과 화면 대기만 맡아요. 캔버스는 진행도를 받아 그려요
  const marks = useMemo<Mark<number>[]>(() => [{ key: "__clock", to: [1], from: [0], delay: useCanvas ? 0 : D * 0.9, data: 0 }], [D, useCanvas]);
  const m = useMotion(marks, c.motion);

  const dayFmt = useMemo(() => new Intl.DateTimeFormat(c.locale, { month: "long", day: "numeric", weekday: "short", ...(multi ? { year: "numeric" } : {}) }), [c.locale, multi]);
  const fv = c.fv;
  const events: ChartEvent<T>[] = useMemo(
    () =>
      lazyArray(days.length, (k) => {
        const d = days[k];
        const known = Number.isFinite(d.value);
        return { datum: d.datum, index: d.i, key: String(d.t), label: dayFmt.format(d.t), value: known ? d.value : null, formatted: known ? fv(d.value) : "-" };
      }),
    [days, dayFmt, fv],
  );
  const pos = (d: Day<T>) => ({ x: x0 + d.week * step, y: d.year * blockH + topH + d.wd * step });

  let tip: TooltipData | null = null;
  if (c.active !== null && days[c.active]) {
    const d = days[c.active];
    const q = pos(d);
    tip = { x: q.x + cell / 2, y: q.y, title: events[c.active].label, rows: [{ label: c.t.value, value: Number.isFinite(d.value) ? c.fv(d.value) : "-", color: p.paint("accent") }] };
  }

  const pending = c.pending;
  const months = useMemo(() => {
    const out: { x: number; y: number; label: string }[] = [];
    // 폭을 재기 전에는 그리지 않으니 자리도 계산하지 않아요
    if (pending) return out;
    let last = "";
    for (const d of days) {
      const dt = new Date(d.t);
      const key = `${d.year}-${dt.getMonth()}`;
      if (key !== last && dt.getDate() <= 7) {
        const x = x0 + d.week * step;
        const y = d.year * blockH + 7;
        // 마지막으로 남긴 라벨과 26px 안이면 건너뛰어요. 좁은 칸에서는 두세 달마다 하나씩 남아요
        const prev = out[out.length - 1];
        if (!prev || prev.y !== y || x - prev.x >= 26) out.push({ x, y, label: formatDate(dt, { month: "short", locale: c.locale }) });
        last = key;
      }
    }
    return out;
  }, [pending, days, x0, step, blockH, c.locale]);

  const msg = MSG[c.lang];
  const desc = props.description ?? `${msg.kind}. ${msg.desc(days.length, c.fv(mx))}.`;
  const enabled = useCssEntrance(c, m);
  // (연도, 주, 요일) 칸 → 날짜 번호. 문자열 키 1만 개를 만들지 않고 평평한 배열로 (-1은 빈 칸)
  const dayIndex = useMemo(() => {
    const idx = new Int32Array(nYears * weeks * 7).fill(-1);
    for (const d of days) idx[(d.year * weeks + d.week) * 7 + d.wd] = d.i;
    return idx;
  }, [days, nYears, weeks]);
  const weekNodes = useMemo(() => {
    if (useCanvas || pending) return null;
    const byWeek = new Map<string, Day<T>[]>();
    for (const d of days) {
      const k = `${d.year}:${d.week}`;
      const arr = byWeek.get(k);
      if (arr) arr.push(d);
      else byWeek.set(k, [d]);
    }
    return [...byWeek.entries()].map(([k, list]) => {
      const w = list[0].week;
      return (
        <g key={k} style={cssEntrance(enabled, m.waiting, "fade", (w / Math.max(1, weeks - 1)) * D * 0.9, 320)}>
          {list.map((d) => {
            const q = { x: x0 + d.week * step, y: d.year * blockH + topH + d.wd * step };
            // 음수도 색으로 (tOf는 음수까지 이어지는 눈금). 0만 빈 칸 색
            const s = d.value ? scaleSwatch(p, tOf(d.value), MIN_OPACITY, scale) : null;
            const isHi = hi.has(d.i);
            return <rect key={d.i} x={q.x} y={q.y} width={cell} height={cell} rx={Math.min(2.5, cell / 3)} fill={s ? s.fill : p.paint("neutralSoft")} opacity={s ? s.opacity : undefined} stroke={isHi ? p.paint("ink") : "none"} strokeWidth={1.2} />;
          })}
        </g>
      );
    });
    // 호버는 아래 덧그림으로 해서 1만 칸을 다시 그리지 않아요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCanvas, pending, days, enabled, m.waiting, m.generation, weeks, D, x0, step, blockH, topH, cell, p, scale, tOf, hi]);

  // 라벨은 등장 중 프레임마다 다시 만들지 않아요 (27년이면 400개가 넘어요)
  const labels = useMemo(
    () => (
      <g aria-hidden="true">
        {months.map((mm, k) => (
          <Txt key={k} x={mm.x} y={mm.y} size={10} fill={p.paint("muted")}>
            {mm.label}
          </Txt>
        ))}
        {Array.from({ length: nYears }, (_, yi) =>
          [1, 3, 5].map((r) => (
            <Txt key={`${yi}-${r}`} x={x0 - 6} y={yi * blockH + topH + r * step + cell / 2} anchor="end" size={9.5} fill={p.paint("muted")}>
              {wd[(r + ws) % 7]}
            </Txt>
          )),
        )}
        {multi
          ? model.years.map((y, yi) => (
              <Txt key={y} x={2} y={yi * blockH + 7} size={10} weight={700} fill={p.paint("ink")}>
                {String(y)}
              </Txt>
            ))
          : null}
      </g>
    ),
    [months, nYears, x0, blockH, topH, step, cell, ws, multi, model.years, p, wd],
  );

  const prog = useCanvas ? m.get("__clock")?.[0] ?? 1 : 1;
  const draw = useMemo(() => {
    // 다 그린 격자를 한 번만 그려 두고, 등장은 주(열) 단위로 잘라 투명도만 바꿔 옮겨요
    let bitmap: HTMLCanvasElement | null = null;
    let bitmapKey = "";
    const paintAll = (ctx: CanvasRenderingContext2D, acc: string, soft: string, ink: string, neg: string) => {
      const rad = Math.min(2.5, cell / 3);
      const rounded = cell >= 5 && typeof ctx.roundRect === "function";
      // 칸은 겹치지 않으니 투명도를 32단계로 묶어 단계마다 한 번만 칠해요
      const LEVELS = 32;
      const accBins: number[][] = Array.from({ length: LEVELS + 1 }, () => []);
      // 가운데 값보다 작은 날(색 척도 옵션)은 회색으로 따로 묶어요
      const negBins: number[][] = Array.from({ length: LEVELS + 1 }, () => []);
      const softBins: number[] = [];
      const marked: number[] = [];
      for (let k = 0; k < days.length; k++) {
        const d = days[k];
        if (d.value) {
          const pos = scaleT(tOf(d.value), scale);
          (pos < 0 ? negBins : accBins)[Math.round((MIN_OPACITY + (1 - MIN_OPACITY) * Math.min(1, Math.abs(pos))) * LEVELS)].push(k);
        } else softBins.push(k);
        if (hi.has(d.i)) marked.push(k);
      }
      const shapes = (list: number[]) => {
        ctx.beginPath();
        for (const k of list) {
          const d = days[k];
          const x = x0 + d.week * step;
          const y = d.year * blockH + topH + d.wd * step;
          if (rounded) ctx.roundRect(x, y, cell, cell, rad);
          else ctx.rect(x, y, cell, cell);
        }
      };
      ctx.fillStyle = soft;
      shapes(softBins);
      ctx.fill();
      for (const [bins, col] of [[accBins, acc], [negBins, neg]] as const) {
        ctx.fillStyle = col;
        for (let b = 1; b <= LEVELS; b++) {
          if (!bins[b].length) continue;
          ctx.globalAlpha = b / LEVELS;
          shapes(bins[b]);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (marked.length) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.2;
        shapes(marked);
        ctx.stroke();
      }
    };
    // 열마다 마지막으로 그린 투명도. 바뀐 열만 지우고 다시 옮겨요 (캔버스 전체를 매 프레임 지우지 않아요)
    let drawn: Float32Array | null = null;
    return (ctx: CanvasRenderingContext2D, t: number, color: (v: string, fb: string) => string) => {
      const acc = color("--ztd-accent", p.theme.accent);
      const soft = color("--ztd-neutral-soft", p.theme.neutralSoft);
      const ink = color("--ztd-ink", p.theme.ink);
      const neg = color("--ztd-neutral-strong", p.theme.neutralStrong);
      const pw = ctx.canvas.width;
      const ph = ctx.canvas.height;
      const k = pw / Math.max(1, W);
      const key = `${acc}|${soft}|${ink}|${neg}|${pw}x${ph}`;
      if (!bitmap || bitmapKey !== key || !drawn) {
        bitmap = bitmap ?? document.createElement("canvas");
        bitmap.width = pw;
        bitmap.height = ph;
        const b = bitmap.getContext("2d");
        if (!b) return;
        b.setTransform(k, 0, 0, k, 0, 0);
        b.clearRect(0, 0, W, H);
        paintAll(b, acc, soft, ink, neg);
        bitmapKey = key;
        ctx.clearRect(0, 0, W, H);
        drawn = new Float32Array(weeks);
      }
      // 주 단위로 왼쪽에서 오른쪽으로 (SVG의 CSS 등장과 같은 순서). 마지막 주는 t=1에서 다 드러나요
      const last = Math.max(1, weeks - 1);
      // 열 경계는 기기 픽셀에 맞춰 이웃 열을 건드리지 않아요
      const edge = (w: number) => Math.round(Math.min(pw, Math.max(0, (x0 + w * step - gap / 2) * k)));
      for (let w = 0; w < weeks; w++) {
        const o = Math.max(0, Math.min(1, (t - (w / last) * 0.75) / 0.25));
        if (o === drawn[w]) continue;
        const a = edge(w);
        const b = w === weeks - 1 ? pw : edge(w + 1);
        if (b > a) {
          ctx.clearRect(a / k, 0, (b - a) / k, H);
          if (o > 0) {
            ctx.globalAlpha = o;
            ctx.drawImage(bitmap, a, 0, b - a, ph, a / k, 0, (b - a) / k, H);
          }
        }
        drawn[w] = o;
      }
      ctx.globalAlpha = 1;
    };
  }, [days, weeks, x0, step, gap, blockH, cell, hi, W, H, p.theme.accent, p.theme.neutralSoft, p.theme.ink, p.theme.neutralStrong, scale, tOf]);

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
        const w = Math.floor((px - x0) / step);
        const yi = Math.floor(py / blockH);
        const wd = Math.floor((py - yi * blockH - topH) / step);
        const hit = yi >= 0 && yi < nYears && w >= 0 && w < weeks && wd >= 0 && wd < 7 ? dayIndex[(yi * weeks + w) * 7 + wd] : -1;
        const k = hit >= 0 ? hit : null;
        if (k !== c.active) c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer");
      }}
      onKey={(e) => {
        // 열이 주라서 좌우 화살표는 한 주씩 (위아래는 기본대로 하루씩). 끝에서는 멈춰요
        const d = e.key === "ArrowRight" ? 7 : e.key === "ArrowLeft" ? -7 : 0;
        if (!d || c.active === null) return false;
        if (days[c.active + d]) c.setActive(c.active + d, "keyboard");
        return true;
      }}
      underlay={useCanvas ? <CanvasLayer width={W} height={H} draw={draw} progress={prog} version={c.sig} manualClear /> : undefined}
    >
      {labels}
      {weekNodes ? <g key={m.generation}>{weekNodes}</g> : null}
      {c.active !== null && days[c.active] ? <rect x={pos(days[c.active]).x - 0.5} y={pos(days[c.active]).y - 0.5} width={cell + 1} height={cell + 1} rx={Math.min(3, cell / 3)} fill="none" stroke={p.paint("ink")} strokeWidth={1.6} pointerEvents="none" /> : null}
    </ChartFrame>
  );
}
