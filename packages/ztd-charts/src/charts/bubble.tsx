import { useCallback, useMemo } from "react";
import { AXIS_FONT, GridY, yAxisWidth } from "../core/axis";
import { CanvasLayer } from "../core/CanvasLayer";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { makeTickFormatter } from "../core/format";
import { resolveHighlight } from "../core/highlight";
import { lazyArray } from "../core/lazy";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { extent, fitDomain, scaleLinear, scaleSqrt } from "../core/scale";
import { labelBox, overlaps, type Box } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter } from "../data/accessor";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  bubble: "Bubble chart",
  scatter: "Scatter plot",
  size: "Size",
  sizeWord: "size",
  nth: (i: number) => `#${i}`,
  /** r: x 최소, x 최대, y 최소, y 최대 */
  desc: (sized: boolean, n: number, r: string[]) => `${sized ? "Bubble chart" : "Scatter plot"}. ${plural(n, "point")}. x from ${r[0]} to ${r[1]}, y from ${r[2]} to ${r[3]}.`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    bubble: "버블 차트",
    scatter: "산점도",
    size: "크기",
    sizeWord: "크기",
    nth: (i) => `${i}번`,
    desc: (sized, n, r) => `${sized ? "버블 차트" : "산점도"}. 점 ${n}개. x ${r[0]}~${r[1]}, y ${r[2]}~${r[3]}.`,
  },
};

export interface BubbleChartProps<T = Row> extends BaseChartProps<T> {
  x?: Accessor<T, number>;
  y?: Accessor<T, number>;
  /** 원 크기 필드. 없으면 산점도 */
  size?: Accessor<T, number>;
  /** 이름 필드 (툴팁, 라벨) */
  label?: Accessor<T, string>;
  /** 원 반지름 범위(px). 기본 [4, 26] */
  sizeRange?: [number, number];
  xLabel?: string;
  yLabel?: string;
  /** 축에 0을 포함. 기본 false */
  zero?: boolean;
  /** 라벨을 붙일 최대 개수 (강조 + 큰 원 순). 기본 6 */
  maxLabels?: number;
  /** 이 개수보다 많으면 캔버스로 그려요. 기본 1500 */
  canvasThreshold?: number;
  xFormat?: BaseChartProps<T>["format"];
}

interface Dot<T> {
  i: number;
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  vs: number;
  label: string;
  hi: boolean;
  datum: T;
}

/** 그리는 순서: 강조가 위, 같으면 작은 원이 위. 0보다 크면 a가 b보다 위에 그려져요 */
function drawOrder<T>(a: Dot<T>, b: Dot<T>): number {
  return Number(a.hi) - Number(b.hi) || b.r - a.r;
}

/** 버블 차트: x, y, 크기 세 값을 한 번에. 크기가 없으면 산점도 */
export function BubbleChart<T = Row>(props: BubbleChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(220, Math.min(320, w * 0.6)), duration: 800, stagger: 0 });
  const { p, width: W, height: H } = c;
  const hasSize = props.size !== undefined;

  const raw = useMemo(() => {
    const gx = numGetter(props.x, "x");
    const gy = numGetter(props.y, "y");
    const gs = hasSize ? numGetter(props.size, "size") : null;
    const gl = strGetter(props.label, "label");
    return props.data.map((d, i) => ({ d, i, x: gx(d, i), y: gy(d, i), s: gs ? Math.max(0, gs(d, i) || 0) : 1, label: gl(d, i) })).filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y));
  }, [props.data, props.x, props.y, props.size, props.label, hasSize]);

  const n = raw.length;
  const useCanvas = c.hydrated && n > (props.canvasThreshold ?? 1500);
  const ext = useMemo(() => ({ x: extent(raw.map((r) => r.x)), y: extent(raw.map((r) => r.y)), s: extent(raw.map((r) => r.s)) }), [raw]);
  const [xmn, xmx] = ext.x;
  const [ymn, ymx] = ext.y;
  const yDom = fitDomain(ymn, ymx, Math.max(2, Math.round(H / 70)), { zero: props.zero ?? false, pad: 0.08 });
  const xDom = fitDomain(xmn, xmx, Math.max(2, Math.round(W / 110)), { zero: props.zero ?? false, pad: 0.06 });
  const yMaxAbs = Math.max(Math.abs(yDom[0]), Math.abs(yDom[1]));
  const xMaxAbs = Math.max(Math.abs(xDom[0]), Math.abs(xDom[1]));
  const yFmt = useMemo(() => makeTickFormatter(props.format, c.locale, yMaxAbs), [props.format, c.locale, yMaxAbs]);
  const xFmt = useMemo(() => makeTickFormatter(props.xFormat, c.locale, xMaxAbs), [props.xFormat, c.locale, xMaxAbs]);
  const yTicks = scaleLinear(yDom, [0, 1]).ticks(Math.max(2, Math.round(H / 70)));
  const left = yAxisWidth(yTicks, yFmt, c.locale);
  const top = props.yLabel ? 20 : 10;
  const bottom = 24;
  const [rMin, rMax] = props.sizeRange ?? (hasSize ? [4, Math.max(10, Math.min(28, W / 22))] : [n > 2000 ? 1.6 : n > 300 ? 2.6 : 4, 0]);
  const pad = hasSize ? rMax * 0.6 : 4;
  const x = scaleLinear(xDom, [left + 6 + pad, W - 8 - pad]);
  const y = scaleLinear(yDom, [H - bottom - pad, top + pad]);
  const [smn, smx] = ext.s;
  const rs = hasSize ? scaleSqrt([Math.min(0, smn), smx || 1], [rMin, rMax]) : () => rMin;

  const hi = useMemo(() => resolveHighlight(props.highlight, raw.map((r) => r.d), raw.map((r) => r.label), raw.map((r) => (hasSize ? r.s : r.y)), hasSize ? "max" : "none"), [raw, props.highlight, hasSize]);

  const dots = useMemo<Dot<T>[]>(() => raw.map((r, k) => ({ i: k, x: x(r.x), y: y(r.y), r: rs(r.s), vx: r.x, vy: r.y, vs: r.s, label: r.label, hi: hi.has(k), datum: r.d })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, hi, W, H, xDom[0], xDom[1], yDom[0], yDom[1], rMin, rMax]);

  const order = useMemo(() => [...dots].sort(drawOrder), [dots]);
  const D = c.motion.duration ?? 800;
  const marks = useMemo<Mark<Dot<T> | null>[]>(() => {
    if (useCanvas) return [{ key: "__p", to: [1], from: [0], data: null }];
    const xr = W || 1;
    return order.map((d) => ({ key: `b${d.i}:${d.label}`, to: [d.x, d.y, d.r], from: [d.x, d.y, 0], enter: [d.x, d.y, 0], delay: (d.x / xr) * D * 0.55, data: d }));
  }, [order, useCanvas, W, D]);
  const m = useMotion(marks, c.motion);

  // 빠른 근접 검색용 격자
  const grid = useMemo(() => {
    const cell = 24;
    const g = new Map<string, number[]>();
    dots.forEach((d, k) => {
      const key = `${Math.floor(d.x / cell)},${Math.floor(d.y / cell)}`;
      const arr = g.get(key);
      if (arr) arr.push(k);
      else g.set(key, [k]);
    });
    return { g, cell };
  }, [dots]);
  const nearest = (px: number, py: number) => {
    const { g, cell } = grid;
    const cx0 = Math.floor(px / cell);
    const cy0 = Math.floor(py / cell);
    let best = -1;
    let bd = Infinity;
    // 포인터가 여러 원 안에 있으면 맨 위에 그려진 원을 골라요. 큰 원 안의 작은 원도 잡히게
    let hit = -1;
    const reach = hasSize ? Math.ceil(rMax / cell) + 1 : 1;
    for (let dx = -reach; dx <= reach; dx++)
      for (let dy = -reach; dy <= reach; dy++) {
        const arr = g.get(`${cx0 + dx},${cy0 + dy}`);
        if (!arr) continue;
        for (const k of arr) {
          const d = dots[k];
          const dist = Math.hypot(d.x - px, d.y - py) - d.r;
          if (dist <= 0 && (hit < 0 || drawOrder(d, dots[hit]) > 0)) hit = k;
          if (dist < bd) {
            bd = dist;
            best = k;
          }
        }
      }
    if (hit >= 0) return hit;
    return bd <= 10 ? best : null;
  };

  // 라벨: 강조 먼저, 그다음 큰 원. 겹치면 건너뛰어요
  const labels = useMemo(() => {
    if (!c.showLabels || n > 400) return [];
    const max = props.maxLabels ?? 6;
    const cands = [...dots].sort((a, b) => Number(b.hi) - Number(a.hi) || b.r - a.r).filter((d) => d.label);
    const placed: Box[] = dots.map((d) => ({ x: d.x - d.r * 0.7, y: d.y - d.r * 0.7, w: d.r * 1.4, h: d.r * 1.4 }));
    const out: { d: Dot<T>; x: number; y: number; anchor: "start" | "end" | "middle" }[] = [];
    for (const d of cands) {
      if (out.length >= max) break;
      const tries: { x: number; y: number; anchor: "start" | "end" | "middle" }[] = [
        { x: d.x + d.r + 5, y: d.y, anchor: "start" },
        { x: d.x - d.r - 5, y: d.y, anchor: "end" },
        { x: d.x, y: d.y - d.r - 9, anchor: "middle" },
        { x: d.x, y: d.y + d.r + 10, anchor: "middle" },
      ];
      for (const t of tries) {
        const b = labelBox(d.label, t.x, t.y, 11, t.anchor, d.hi ? 800 : 500);
        if (b.x < left || b.x + b.w > W - 2 || b.y < 0 || b.y + b.h > H - bottom) continue;
        if (placed.some((q) => overlaps(q, b, 1))) continue;
        placed.push(b);
        out.push({ d, ...t });
        break;
      }
    }
    return out;
  }, [dots, c.showLabels, n, props.maxLabels, left, W, H, bottom]);

  const accent = swatch(p, "accent");
  const fmt = c.fmt;
  const fv = c.fv;
  const msg = MSG[c.lang];
  const events: ChartEvent<T>[] = useMemo(
    () =>
      lazyArray(dots.length, (k) => {
        const d = dots[k];
        return { datum: d.datum, index: d.i, key: `${d.i}`, label: d.label || msg.nth(d.i + 1), value: hasSize ? d.vs : d.vy, formatted: `x ${xFmt(d.vx)}, y ${fv(d.vy)}${hasSize ? `, ${msg.sizeWord} ${fmt(d.vs)}` : ""}` };
      }),
    // 표는 툴팁과 같은 포맷: y는 단위까지 (축 눈금처럼 줄이지 않아요)
    [dots, hasSize, xFmt, fv, fmt, msg],
  );

  let tip: TooltipData | null = null;
  if (c.active !== null && dots[c.active]) {
    const d = dots[c.active];
    tip = { x: d.x, y: d.y - d.r, title: d.label || msg.nth(d.i + 1), rows: [{ label: props.xLabel ?? "x", value: xFmt(d.vx) }, { label: props.yLabel ?? "y", value: c.fv(d.vy) }, ...(hasSize ? [{ label: msg.size, value: c.fmt(d.vs), color: d.hi ? accent.fill : p.paint("neutral") }] : [])] };
  }

  const prog = useCanvas ? m.get("__p")?.[0] ?? 1 : 1;
  const drawCanvas = useCallback(
    (ctx: CanvasRenderingContext2D, t: number, color: (v: string, fb: string) => string) => {
      const neu = color("--ztd-neutral-strong", p.theme.neutralStrong);
      const acc = color("--ztd-accent", p.theme.accent);
      const xr = W || 1;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = neu;
      for (const d of dots) {
        if (d.hi) continue;
        const k = Math.max(0, Math.min(1, (t * 1.4 - (d.x / xr) * 0.4) * 2.5));
        if (k <= 0) continue;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r * k, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = acc;
      for (const d of dots) {
        if (!d.hi) continue;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r * Math.min(1, t * 1.2), 0, Math.PI * 2);
        ctx.fill();
      }
    },
    [dots, W, p.theme.neutralStrong, p.theme.accent],
  );

  const xTicks = x.ticks(Math.max(2, Math.round(W / 110)));
  const desc = props.description ?? msg.desc(hasSize, n, [xFmt(xmn), xFmt(xmx), yFmt(ymn), yFmt(ymx)]);

  return (
    <ChartFrame
      c={c}
      kind={hasSize ? msg.bubble : msg.scatter}
      ariaLabel={props.ariaLabel}
      description={desc}
      events={events}
      tip={tip}
      renderTip={props.tooltip}
      className={props.className}
      style={props.style}
      theme={props.theme}
      onPointerMove={(px, py, e) => {
        const k = nearest(px, py);
        if (k !== c.active) c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer");
      }}
      underlay={useCanvas ? <CanvasLayer width={W} height={H} draw={drawCanvas} progress={prog} version={c.sig} /> : undefined}
    >
      {props.yLabel ? (
        <Txt x={left} y={6} size={10.5} fill={p.paint("muted")}>
          {props.yLabel}
        </Txt>
      ) : null}
      <GridY p={p} ticks={yTicks} y={y} x0={left} x1={W} fmt={yFmt} locale={c.locale} zero={false} />
      <g aria-hidden="true">
        {xTicks.map((t) => (
          <Txt key={t} x={x(t)} y={H - bottom + 13} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
            {xFmt(t)}
          </Txt>
        ))}
        {props.xLabel ? (
          <Txt x={W - 2} y={H - bottom - 8} anchor="end" size={10.5} fill={p.paint("muted")}>
            {props.xLabel}
          </Txt>
        ) : null}
      </g>
      {!useCanvas
        ? m.items.map((it) => {
            const d = it.data;
            if (!d) return null;
            const [cx, cy, r] = it.v;
            const isA = c.active === d.i;
            return (
              <circle
                key={it.key}
                className="ztd-mark"
                cx={cx}
                cy={cy}
                r={Math.max(0, r)}
                fill={d.hi ? accent.fill : p.paint(hasSize ? "neutral" : "neutralStrong")}
                fillOpacity={d.hi ? 0.92 : hasSize ? 0.85 : 0.7}
                stroke={isA ? p.paint("ink") : p.paint("panel")}
                strokeWidth={isA ? 2 : hasSize ? 1.2 : 0.6}
                opacity={it.exiting ? 0.3 : c.active === null || isA ? 1 : 0.55}
                onPointerEnter={(e) => c.setActive(d.i, e.pointerType === "touch" ? "touch" : "pointer")}
                onClick={() => c.click(d.i)}
              />
            );
          })
        : c.active !== null && dots[c.active]
          ? <circle cx={dots[c.active].x} cy={dots[c.active].y} r={dots[c.active].r + 2} fill="none" stroke={p.paint("ink")} strokeWidth={1.6} pointerEvents="none" />
          : null}
      {labels.map((l) => (
        <Txt key={l.d.i} x={l.x} y={l.y} anchor={l.anchor} size={11} weight={l.d.hi ? 800 : 500} fill={p.paint(l.d.hi ? "ink" : "muted")} opacity={m.fade(D * 0.6, 300)}>
          {l.d.label}
        </Txt>
      ))}
    </ChartFrame>
  );
}
