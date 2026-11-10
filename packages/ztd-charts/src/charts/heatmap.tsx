import { useCallback, useMemo } from "react";
import { AXIS_FONT, thinLabels } from "../core/axis";
import { CanvasLayer } from "../core/CanvasLayer";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { roundRectPath } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import { lazyArray } from "../core/lazy";
import type { Mark } from "../core/motion";
import { colorScaleOf, scaleSwatch, scaleT } from "../core/palette";
import { extent, robustMax } from "../core/scale";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter, uniq } from "../data/accessor";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Heatmap",
  legend: ["Less", "More"] as [string, string],
  desc: (rows: number, cols: number, mn: string, mx: string) => `${plural(rows, "row")} × ${plural(cols, "column")}, values from ${mn} to ${mx}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "히트맵", legend: ["적음", "많음"], desc: (rows, cols, mn, mx) => `${rows}행 × ${cols}열, 값 ${mn}에서 ${mx}까지` },
};

export interface HeatmapProps<T = Row> extends BaseChartProps<T> {
  /** 열 필드. 기본 "x" */
  x?: Accessor<T, string>;
  /** 행 필드. 기본 "y" */
  y?: Accessor<T, string>;
  value?: Accessor<T, number>;
  /** 칸 안 숫자. "auto"는 칸이 넉넉할 때만. 기본 "auto" */
  showValues?: boolean | "auto";
  /** 위쪽 색 범례. 기본 true */
  legend?: boolean;
  /** 범례 양끝 이름. 기본 ["Less", "More"] (한국어 로캘은 ["적음", "많음"]) */
  legendLabels?: [string, string];
  /** 이 칸 수보다 많으면 캔버스로 그려요. 기본 2500 */
  canvasThreshold?: number;
  /** 가장 작은 값을 가장 진하게 칠해요 (1위가 진해야 하는 순위). 기본 false */
  colorReverse?: boolean;
  /** 가장 옅은 색이 되는 값. 그보다 크면 강조색, 작으면 회색 (손익의 0) */
  colorCenter?: number;
  /** 부드러운 색 대신 이 수만큼 단계로 나눠 칠해요 (2~12). 범례도 단계마다 */
  colorSteps?: number;
}

interface CellInfo<T> {
  i: number;
  col: number;
  row: number;
  value: number;
  t: number;
  datum: T | null;
}

/** 히트맵: 두 범주가 만나는 칸의 크기를 색 진하기로 */
export function Heatmap<T = Row>(props: HeatmapProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(180, Math.min(300, w * 0.48)), duration: 600, stagger: 0 });
  const { p, width: W, height: H } = c;

  const model = useMemo(() => {
    const gx = strGetter(props.x, "x");
    const gy = strGetter(props.y, "y");
    const gv = numGetter(props.value, "value");
    const xs = uniq(props.data.map((d, i) => gx(d, i)));
    const ys = uniq(props.data.map((d, i) => gy(d, i)));
    const xi = new Map(xs.map((k, i) => [k, i]));
    const yi = new Map(ys.map((k, i) => [k, i]));
    const vals = new Float64Array(xs.length * ys.length).fill(NaN);
    const rows: (T | null)[] = new Array(xs.length * ys.length).fill(null);
    props.data.forEach((d, i) => {
      const cx = xi.get(gx(d, i));
      const cy = yi.get(gy(d, i));
      if (cx === undefined || cy === undefined) return;
      const idx = cy * xs.length + cx;
      const v = gv(d, i);
      // 값이 없는 겹친 행이 앞에 있던 값을 지우지 않게, 숫자일 때만 더해요
      if (Number.isFinite(v)) vals[idx] = Number.isFinite(vals[idx]) ? vals[idx] + v : v;
      rows[idx] = d;
    });
    const [mn, mx] = extent(vals);
    return { xs, ys, vals, rows, mn, mx };
  }, [props.data, props.x, props.y, props.value]);

  const nx = model.xs.length;
  const ny = model.ys.length;
  const nCells = nx * ny;
  const useCanvas = c.hydrated && nCells > (props.canvasThreshold ?? 2500);
  const legendH = props.legend === false ? 0 : 20;
  const leftW = Math.min(W * 0.3, Math.max(...model.ys.map((l) => textWidth(l, AXIS_FONT, 500)), 10) + 8);
  const bottom = 20;
  const x0 = leftW + 4;
  const y0 = legendH;
  const cw = (W - x0) / Math.max(1, nx);
  const ch = (H - y0 - bottom) / Math.max(1, ny);
  const gap = Math.min(cw, ch) > 14 ? 2.5 : Math.min(cw, ch) > 5 ? 1 : 0;
  const rad = Math.min(p.theme.radiusMark, Math.min(cw, ch) / 4);
  const top95 = useMemo(() => robustMax(model.vals), [model.vals]);
  const span = Math.max(1e-9, top95 - model.mn) || 1;
  // 색 척도 옵션. 가운데 값이 있으면 t는 -1~1이고, 그 값에서 먼 쪽(95백분위)이 끝이에요
  const scale = useMemo(() => colorScaleOf(props.colorReverse, props.colorCenter, props.colorSteps), [props.colorReverse, props.colorCenter, props.colorSteps]);
  const center = scale.center;
  const dev = useMemo(() => (center === undefined ? 0 : Math.max(1e-9, robustMax(Array.from(model.vals, (v) => Math.abs(v - center))))), [model.vals, center]);
  const swatch = (t: number) => scaleSwatch(p, t, 0.08, scale);

  const hiSet = useMemo(() => {
    const labels = Array.from({ length: nCells }, (_, i) => `${model.xs[i % nx]}|${model.ys[Math.floor(i / nx)]}`);
    // 색을 뒤집으면 기본 강조도 가장 진한 칸(가장 작은 값)으로
    return resolveHighlight(props.highlight as never, model.rows as never[], labels, Array.from(model.vals), props.colorReverse ? "min" : "max");
  }, [model, nCells, nx, props.highlight, props.colorReverse]);

  const cells = useMemo<CellInfo<T>[]>(() => {
    const out: CellInfo<T>[] = [];
    for (let i = 0; i < nCells; i++) {
      const v = model.vals[i];
      if (!Number.isFinite(v)) continue;
      out.push({ i, col: i % nx, row: Math.floor(i / nx), value: v, t: center === undefined ? Math.min(1, (v - model.mn) / span) : Math.max(-1, Math.min(1, (v - center) / dev)), datum: model.rows[i] });
    }
    return out;
  }, [model, nCells, nx, span, center, dev]);

  // 범례 칸 수: 단계를 정했으면 단계마다
  const nLegend = scale.steps ?? 5;
  const D = c.motion.duration ?? 600;
  const marks = useMemo<Mark<CellInfo<T> | null>[]>(() => {
    if (useCanvas) return [{ key: "__p", to: [1], from: [0], data: null }];
    return cells.map((cl) => ({ key: `h${cl.i}`, to: [1], from: [0], delay: ((cl.col / Math.max(1, nx - 1)) * 0.6 + (cl.row / Math.max(1, ny - 1)) * 0.4) * D * 0.9, data: cl }));
  }, [cells, useCanvas, nx, ny, D]);
  const m = useMotion(marks, c.motion);

  const showValues = props.showValues ?? "auto";
  const sample = c.fmt(model.mx);
  const valuesOn = c.showLabels && (showValues === true || (showValues === "auto" && cw >= textWidth(sample, 10.5, 600) + 8 && ch >= 15));

  const fv = c.fv;
  const events: ChartEvent<T>[] = useMemo(
    () =>
      lazyArray(cells.length, (k) => {
        const cl = cells[k];
        return { datum: cl.datum, index: cl.i, key: `${model.xs[cl.col]}|${model.ys[cl.row]}`, label: `${model.ys[cl.row]} · ${model.xs[cl.col]}`, value: cl.value, formatted: fv(cl.value) };
      }),
    [cells, model, fv],
  );
  const evIndex = useMemo(() => new Map(cells.map((cl, k) => [cl.i, k])), [cells]);

  const pick = (px: number, py: number) => {
    const col = Math.floor((px - x0) / cw);
    const row = Math.floor((py - y0) / ch);
    if (col < 0 || row < 0 || col >= nx || row >= ny) return null;
    const k = evIndex.get(row * nx + col);
    return k === undefined ? null : k;
  };

  let tip: TooltipData | null = null;
  if (c.active !== null && cells[c.active]) {
    const cl = cells[c.active];
    tip = { x: x0 + cl.col * cw + cw / 2, y: y0 + cl.row * ch, title: `${model.ys[cl.row]} · ${model.xs[cl.col]}`, rows: [{ label: c.t.value, value: c.fv(cl.value), color: p.paint("accent") }] };
  }

  const prog = useCanvas ? m.get("__p")?.[0] ?? 1 : 1;
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, t: number, color: (v: string, fb: string) => string) => {
      const acc = color("--ztd-accent", p.theme.accent);
      const neg = color("--ztd-neutral-strong", p.theme.neutralStrong);
      let fill = acc;
      ctx.fillStyle = acc;
      for (const cl of cells) {
        const wave = (cl.col / Math.max(1, nx - 1)) * 0.6 + (cl.row / Math.max(1, ny - 1)) * 0.4;
        const o = Math.max(0, Math.min(1, (t * 1.25 - wave) * 4));
        if (o <= 0) continue;
        // 가운데 값보다 작으면 회색. 칸이 수천 개라 색이 바뀔 때만 다시 정해요
        const k = scaleT(cl.t, scale);
        const col = k < 0 ? neg : acc;
        if (col !== fill) ctx.fillStyle = fill = col;
        ctx.globalAlpha = (0.08 + 0.92 * Math.min(1, Math.abs(k))) * o;
        ctx.fillRect(x0 + cl.col * cw + gap / 2, y0 + cl.row * ch + gap / 2, Math.max(0.5, cw - gap), Math.max(0.5, ch - gap));
      }
      ctx.globalAlpha = 1;
    },
    [cells, nx, ny, x0, y0, cw, ch, gap, p.theme.accent, p.theme.neutralStrong, scale],
  );

  // 호버로 다시 그릴 때마다 글자 폭을 다시 재지 않아요
  const xLabelIdx = useMemo(() => thinLabels(model.xs.map((_, i) => x0 + i * cw + cw / 2), model.xs, AXIS_FONT, 6), [model.xs, x0, cw]);
  const yLabelIdx = ch >= 11 ? model.ys.map((_, i) => i) : model.ys.map((_, i) => i).filter((i) => i % Math.ceil(12 / Math.max(1, ch)) === 0);
  const msg = MSG[c.lang];
  const desc = props.description ?? `${msg.kind}. ${msg.desc(ny, nx, c.fv(model.mn), c.fv(model.mx))}.`;
  const ll = props.legendLabels ?? msg.legend;

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
        const k = pick(px, py);
        if (k !== c.active) c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer");
      }}
      onKey={(e) => {
        // 위아래 화살표는 같은 열의 윗줄, 아랫줄로 (빈 칸은 건너뛰고, 끝에서는 멈춰요)
        const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
        const cl = c.active === null ? null : cells[c.active];
        if (!d || !cl) return false;
        for (let r = cl.row + d; r >= 0 && r < ny; r += d) {
          const k = evIndex.get(r * nx + cl.col);
          if (k !== undefined) {
            c.setActive(k, "keyboard");
            break;
          }
        }
        return true;
      }}
      underlay={useCanvas ? <CanvasLayer width={W} height={H} draw={draw} progress={prog} version={c.sig} /> : undefined}
    >
      {props.legend !== false ? (
        <g aria-hidden="true">
          {Array.from({ length: nLegend }, (_, k) => {
            const s = scaleSwatch(p, center === undefined ? k / (nLegend - 1) : (2 * k) / (nLegend - 1) - 1, 0.08, scale);
            const lx = W - nLegend * 14 - textWidth(ll[1], 10) - 6 + k * 14;
            return <rect key={k} x={lx} y={3} width={12} height={9} rx={2} fill={s.fill} opacity={s.opacity} />;
          })}
          <Txt x={W - nLegend * 14 - textWidth(ll[1], 10) - 10} y={7.5} anchor="end" size={10} fill={p.paint("muted")}>
            {ll[0]}
          </Txt>
          <Txt x={W} y={7.5} anchor="end" size={10} fill={p.paint("muted")}>
            {ll[1]}
          </Txt>
        </g>
      ) : null}
      {!useCanvas
        ? m.items.map((it) => {
            const cl = it.data;
            if (!cl) return null;
            const s = swatch(cl.t);
            const x = x0 + cl.col * cw + gap / 2;
            const y = y0 + cl.row * ch + gap / 2;
            const w = Math.max(0.5, cw - gap);
            const h = Math.max(0.5, ch - gap);
            const k = evIndex.get(cl.i) ?? -1;
            const isHi = hiSet.has(cl.i);
            return (
              <g key={it.key} opacity={it.v[0]}>
                <path d={roundRectPath(x, y, w, h, rad)} fill={s.fill} opacity={s.opacity * (c.active === null || c.active === k ? 1 : 0.55)} className="ztd-mark" onPointerEnter={(e) => c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(k)} />
                {isHi || c.active === k ? <path d={roundRectPath(x - 1, y - 1, w + 2, h + 2, rad + 1)} fill="none" stroke={p.paint("ink")} strokeWidth={isHi && c.active !== k ? 1.5 : 2} pointerEvents="none" /> : null}
                {valuesOn ? (
                  <Txt x={x + w / 2} y={y + h / 2} anchor="middle" size={10.5} weight={isHi ? 800 : 600} fill={s.text}>
                    {c.fmt(cl.value)}
                  </Txt>
                ) : null}
              </g>
            );
          })
        : c.active !== null && cells[c.active]
          ? (() => {
              const cl = cells[c.active];
              return <rect x={x0 + cl.col * cw} y={y0 + cl.row * ch} width={cw} height={ch} fill="none" stroke={p.paint("ink")} strokeWidth={1.5} pointerEvents="none" />;
            })()
          : null}
      <g aria-hidden="true">
        {yLabelIdx.map((i) => (
          <Txt key={i} x={leftW} y={y0 + i * ch + ch / 2} anchor="end" size={AXIS_FONT} weight={500} fill={p.paint("muted")}>
            {truncate(model.ys[i], leftW - 2, AXIS_FONT, 500)}
          </Txt>
        ))}
        {xLabelIdx.map((i) => (
          <Txt key={i} x={x0 + i * cw + cw / 2} y={H - bottom + 12} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
            {model.xs[i]}
          </Txt>
        ))}
      </g>
    </ChartFrame>
  );
}
