import { useCallback, useMemo } from "react";
import { CanvasLayer } from "../core/CanvasLayer";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { makeFormatter, type FormatSpec } from "../core/format";
import { resolveHighlight } from "../core/highlight";
import { lazyArray } from "../core/lazy";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { extent, fitDomain, scaleLinear } from "../core/scale";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { strGetter, toNumber } from "../data/accessor";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Parallel coordinates",
  nth: (i: number) => `#${i}`,
  desc: (rows: number, axes: number, names: string) => `${plural(rows, "row")}, ${plural(axes, "axis", "axes")} (${names})`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "평행 좌표", nth: (i) => `${i}번`, desc: (rows, axes, names) => `행 ${rows}개, 축 ${axes}개(${names})` },
};

export interface ParallelCoordinatesProps<T = Row> extends BaseChartProps<T> {
  /** 축으로 쓸 숫자 필드들. 없으면 숫자 필드를 모두 */
  dimensions?: string[];
  /** 축 이름 바꾸기. 예: { price: "가격(만 원)" } */
  dimensionLabels?: Record<string, string>;
  /** 축마다 포맷 */
  formats?: Record<string, FormatSpec>;
  /** 값이 작을수록 좋은 축 (위아래 뒤집기) */
  invert?: string[];
  /** 행 이름 필드. 기본 "label" */
  label?: Accessor<T, string>;
  /** 이 행 수보다 많으면 캔버스로. 기본 1500 */
  canvasThreshold?: number;
}

interface PLine<T> {
  i: number;
  label: string;
  vals: number[];
  ys: number[];
  hi: boolean;
  datum: T;
}

/** 값이 없는 축(NaN)에서 선을 끊어 가며 이어요. 캔버스와 svg 경로가 같이 써요 */
function traceGapped(ys: readonly number[], xAt: (j: number) => number, move: (x: number, y: number) => void, line: (x: number, y: number) => void): void {
  let pen = false;
  ys.forEach((yy, j) => {
    if (!Number.isFinite(yy)) {
      pen = false;
      return;
    }
    (pen ? line : move)(xAt(j), yy);
    pen = true;
  });
}

/** 평행 좌표: 여러 숫자 지표를 축마다 세워 한 줄로 비교 */
export function ParallelCoordinates<T = Row>(props: ParallelCoordinatesProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(220, Math.min(320, w * 0.55)), duration: 1000 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];

  const dims = useMemo(() => {
    if (props.dimensions?.length) return props.dimensions;
    const first = props.data[0] as Record<string, unknown> | undefined;
    if (!first) return [];
    return Object.keys(first).filter((k) => props.data.slice(0, 20).every((d) => Number.isFinite(toNumber((d as Record<string, unknown>)[k]))));
  }, [props.data, props.dimensions]);

  const rows = useMemo(() => {
    const gl = strGetter(props.label, "label");
    return props.data.map((d, i) => ({ d, i, label: gl(d, i), vals: dims.map((k) => toNumber((d as Record<string, unknown>)[k])) }));
  }, [props.data, dims, props.label]);
  const n = rows.length;
  const useCanvas = c.hydrated && n > (props.canvasThreshold ?? 1500);
  const doms = useMemo(() => dims.map((_, j) => fitDomain(...extent(rows.map((r) => r.vals[j])), 4, { zero: false, pad: 0.02 })), [dims, rows]);
  const fmts = useMemo(() => dims.map((k) => makeFormatter(props.formats?.[k], c.locale)), [dims, props.formats, c.locale]);
  const hi = useMemo(() => resolveHighlight(props.highlight, rows.map((r) => r.d), rows.map((r) => r.label), rows.map((r) => r.vals[0] ?? 0), "first"), [rows, props.highlight]);
  const labelR = Math.min(W * 0.18, Math.max(...rows.filter((r) => hi.has(r.i)).map((r) => textWidth(r.label, 11, 800)), 0) + 14);
  const bottom = 18;
  const dimName = (k: string) => props.dimensionLabels?.[k] ?? k;
  const nameW = dims.map((k) => textWidth(dimName(k), 11, 700));
  const firstW = nameW[0] ?? 0;
  const lastW = nameW[nameW.length - 1] ?? 0;
  const x0 = Math.max(24, Math.min(W * 0.15, firstW / 2 + 4));
  const x1 = W - Math.max(24, labelR, Math.min(W * 0.15, lastW / 2 + 4));
  const gapX = dims.length > 1 ? (x1 - x0) / (dims.length - 1) : 128;
  // 축 이름이 축 사이보다 길면 두 줄로 엇갈려 놓아 이름마다 두 칸 폭을 줘요. 좁은 화면에서 "Pric…" 같은 토막이 남지 않아요
  const stagger = dims.length > 2 && nameW.some((w) => w > gapX - 8);
  const top = stagger ? 44 : 30;
  const axX = (j: number) => (dims.length > 1 ? x0 + (j * (x1 - x0)) / (dims.length - 1) : (x0 + x1) / 2);
  const scales = useMemo(() => doms.map((dm, j) => scaleLinear(dm, props.invert?.includes(dims[j]) ? [top, H - bottom] : [H - bottom, top])), [doms, H, dims, props.invert, top]);

  const lines = useMemo<PLine<T>[]>(() => rows.map((r) => ({ i: r.i, label: r.label, vals: r.vals, ys: r.vals.map((v, j) => (Number.isFinite(v) ? scales[j](v) : NaN)), hi: hi.has(r.i), datum: r.d })), [rows, scales, hi]);
  const order = useMemo(() => [...lines].sort((a, b) => Number(a.hi) - Number(b.hi)), [lines]);

  const D = c.motion.duration ?? 1000;
  const marks = useMemo<Mark<PLine<T> | null>[]>(() => {
    if (useCanvas) return [{ key: "__p", to: [1], from: [0], data: null }];
    return order.map((l, k) => ({ key: `p:${l.i}`, to: [1, ...l.ys], from: [0, ...l.ys], enter: [0, ...l.ys], parts: [1, l.ys.length], delay: l.hi ? D * 0.35 : (k / Math.max(1, order.length)) * D * 0.3, data: l }));
  }, [order, useCanvas, D]);
  const m = useMotion(marks, c.motion);
  const accent = swatch(p, "accent");

  const nearest = (px: number, py: number) => {
    if (dims.length < 2) return null;
    let j = 0;
    while (j < dims.length - 2 && px > axX(j + 1)) j++;
    const t = Math.max(0, Math.min(1, (px - axX(j)) / (axX(j + 1) - axX(j) || 1)));
    let best = -1;
    let bd = Infinity;
    for (const l of lines) {
      const a = l.ys[j];
      const b = l.ys[j + 1];
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const d = Math.abs(a + (b - a) * t - py);
      if (d < bd) {
        bd = d;
        best = l.i;
      }
    }
    return bd < 10 ? best : null;
  };

  const dimLabels = props.dimensionLabels;
  const events: ChartEvent<T>[] = useMemo(
    () =>
      lazyArray(lines.length, (k) => {
        const l = lines[k];
        return { datum: l.datum, index: l.i, key: `${l.i}`, label: l.label || msg.nth(l.i + 1), value: l.vals[0] ?? null, formatted: dims.map((d, j) => `${dimLabels?.[d] ?? d} ${fmts[j](l.vals[j])}`).join(", ") };
      }),
    [lines, dims, dimLabels, fmts, msg],
  );
  let tip: TooltipData | null = null;
  if (c.active !== null && lines[c.active]) {
    const l = lines[c.active];
    tip = { x: axX(Math.floor((dims.length - 1) / 2)), y: Math.min(...l.ys.filter(Number.isFinite)), title: l.label || msg.nth(l.i + 1), rows: dims.map((k, j) => ({ label: props.dimensionLabels?.[k] ?? k, value: fmts[j](l.vals[j]) })) };
  }

  const prog = useCanvas ? m.get("__p")?.[0] ?? 1 : 1;
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, _t: number, color: (v: string, fb: string) => string) => {
      const neu = color("--ztd-neutral-strong", p.theme.neutralStrong);
      const acc = color("--ztd-accent", p.theme.accent);
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = neu;
      ctx.globalAlpha = Math.max(0.04, Math.min(0.35, 60 / Math.max(1, lines.length)));
      ctx.beginPath();
      for (const l of lines) {
        if (l.hi) continue;
        traceGapped(l.ys, axX, (x, y) => ctx.moveTo(x, y), (x, y) => ctx.lineTo(x, y));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = acc;
      for (const l of lines) {
        if (!l.hi) continue;
        ctx.beginPath();
        traceGapped(l.ys, axX, (x, y) => ctx.moveTo(x, y), (x, y) => ctx.lineTo(x, y));
        ctx.stroke();
      }
      ctx.restore();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, x0, x1, H, p.theme.neutralStrong, p.theme.accent, dims.length],
  );

  const desc = props.description ?? `${msg.kind}. ${msg.desc(n, dims.length, dims.map((k) => props.dimensionLabels?.[k] ?? k).join(", "))}.`;
  // 값이 없는 축에서는 선을 끊어요 (축 최솟값 자리에 그리면 진짜 최솟값과 헷갈려요)
  const path = (ys: number[]) => {
    let d = "";
    traceGapped(ys, axX, (x, y) => (d += `M${x.toFixed(1)},${y.toFixed(1)}`), (x, y) => (d += `L${x.toFixed(1)},${y.toFixed(1)}`));
    return d;
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
      onPointerMove={(px, py, e) => {
        const k = nearest(px, py);
        if (k !== c.active) c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer");
      }}
      underlay={useCanvas ? <CanvasLayer width={W} height={H} draw={draw} progress={1} version={c.sig} clipRight={prog >= 1 ? 0 : Math.max(0, W - (x0 + (x1 - x0 + 2) * prog))} /> : undefined}
    >
      <rect x={x0} y={top} width={Math.max(0, x1 - x0)} height={H - top - bottom} fill="transparent" />
      {!useCanvas
        ? m.items.map((it) => {
            const l = it.data;
            if (!l) return null;
            const t = it.v[0];
            const ys = it.v.slice(1);
            const isA = c.active === l.i;
            const dash = t < 0.999;
            return (
              <path
                key={it.key}
                d={path(ys)}
                fill="none"
                stroke={l.hi ? accent.fill : isA ? p.paint("ink") : p.paint("neutralStrong")}
                strokeOpacity={l.hi || isA ? 1 : c.active === null ? 0.55 : 0.25}
                strokeWidth={l.hi ? 2.6 : isA ? 2 : 1.3}
                strokeLinejoin="round"
                pathLength={dash ? 1 : undefined}
                strokeDasharray={dash ? "1 1" : undefined}
                strokeDashoffset={dash ? 1 - t : undefined}
                pointerEvents="none"
              />
            );
          })
        : c.active !== null && lines[c.active]
          ? <path d={path(lines[c.active].ys)} fill="none" stroke={p.paint("ink")} strokeWidth={2} pointerEvents="none" />
          : null}
      <g aria-hidden="true">
        {dims.map((k, j) => {
          const xx = axX(j);
          const [lo, hiV] = doms[j];
          const inv = props.invert?.includes(k);
          const name = dimName(k);
          // 엇갈리면 같은 줄 이웃이 두 칸 떨어져 있어요. 양끝 축은 차트 밖으로 나가지 않게
          const room = stagger ? Math.min(2 * gapX, 2 * Math.min(xx, W - xx)) - 8 : gapX - 8;
          return (
            <g key={k}>
              <line x1={xx} x2={xx} y1={top} y2={H - bottom} stroke={p.paint("dim")} strokeWidth={1} />
              <Txt x={xx} y={stagger && j % 2 ? 23 : 9} anchor="middle" size={11} weight={700} fill={p.paint("ink")}>
                {truncate(name, room, 11, 700)}
              </Txt>
              {/* 위 끝 값은 그림 영역(top) 위에 둬요. 선은 top 위로 못 올라가서, 끝값을 지나는 강조 선이 글자를 덮지 않아요 */}
              <Txt x={xx + 4} y={top - 9} anchor="start" size={9.5} fill={p.paint("muted")}>
                {fmts[j](inv ? lo : hiV)}
              </Txt>
              <Txt x={xx + 4} y={H - bottom + 9} anchor="start" size={9.5} fill={p.paint("muted")}>
                {fmts[j](inv ? hiV : lo)}
              </Txt>
            </g>
          );
        })}
      </g>
      {c.showLabels && n <= 60
        ? lines
            // 마지막 축 값이 비면(모두 빈 값 등) 이름표 자리를 모르니 그리지 않아요 (y="NaN" 방지)
            .filter((l) => (l.hi || c.active === l.i) && Number.isFinite(l.ys[l.ys.length - 1]))
            .map((l) => (
              <Txt key={l.i} x={x1 + 8} y={l.ys[l.ys.length - 1]} size={11} weight={800} fill={p.paint("ink")} opacity={m.fade(D * 0.8, 300)}>
                {truncate(l.label, labelR - 10, 11, 800)}
              </Txt>
            ))
        : null}
    </ChartFrame>
  );
}
