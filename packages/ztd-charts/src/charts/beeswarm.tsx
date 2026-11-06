import { useCallback, useMemo } from "react";
import { AXIS_FONT } from "../core/axis";
import { CanvasLayer } from "../core/CanvasLayer";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { lazyArray } from "../core/lazy";
import { quantileSorted } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { extent, fitDomain, scaleLinear } from "../core/scale";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter, uniq } from "../data/accessor";
import { beeswarm } from "../layout/stats";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Beeswarm",
  group: "Group",
  med: "Median",
  /** 이름 없는 점 */
  nth: (i: number) => `#${i}`,
  median: (g: string, v: string) => `${g} median ${v}`,
  desc: (n: number, groups: number, medians: string) => `${plural(n, "point")}${medians ? `, ${plural(groups, "group")} (${medians})` : ""}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "비스웜",
    group: "그룹",
    med: "중앙값",
    nth: (i) => `${i}번`,
    median: (g, v) => `${g} 중앙값 ${v}`,
    desc: (n, groups, medians) => `점 ${n}개${medians ? `, 그룹 ${groups}개(${medians})` : ""}`,
  },
};

export interface BeeswarmChartProps<T = Row> extends BaseChartProps<T> {
  /** 값 필드. 기본 "value" */
  value?: Accessor<T, number>;
  /** 그룹(행) 필드. 없으면 한 줄 */
  group?: Accessor<T, string>;
  /** 점 이름 */
  label?: Accessor<T, string>;
  /** 점 반지름. 없으면 개수에 맞춰요 */
  radius?: number;
  /** 그룹 중앙값 표시. 기본 true */
  showMedian?: boolean;
  /** 이 개수보다 많으면 캔버스로. 기본 2000 */
  canvasThreshold?: number;
}

interface Bee<T> {
  i: number;
  g: number;
  x: number;
  y: number;
  value: number;
  label: string;
  hi: boolean;
  datum: T;
}

/** 비스웜: 점 하나하나를 겹치지 않게 늘어놓은 분포 */
export function BeeswarmChart<T = Row>(props: BeeswarmChartProps<T>) {
  // 값이 하나도 없는 그룹은 빼요 (중앙값이 NaN이 되어 SVG에 NaN이 남아요)
  const groups0 = useMemo(() => {
    if (!props.group) return [""];
    const gg = strGetter(props.group, "group");
    const gv = numGetter(props.value, "value");
    return uniq(props.data.flatMap((d, i) => (Number.isFinite(gv(d, i)) ? [gg(d, i)] : [])));
  }, [props.data, props.group, props.value]);
  const c = useChart(props, { height: () => Math.max(160, Math.min(380, groups0.length * 78 + 30)), duration: 900 });
  const { p, width: W, height: H } = c;

  const base = useMemo(() => {
    const gv = numGetter(props.value, "value");
    const gg = props.group ? strGetter(props.group, "group") : () => "";
    const gl = strGetter(props.label, "label");
    return props.data.map((d, i) => ({ d, i, v: gv(d, i), g: gg(d, i), label: gl(d, i) })).filter((r) => Number.isFinite(r.v));
  }, [props.data, props.value, props.group, props.label]);
  const groups = groups0;
  const n = base.length;
  const useCanvas = c.hydrated && n > (props.canvasThreshold ?? 2000);
  const byGroup = useMemo(() => {
    const at = new Map(groups.map((g, gi) => [g, gi]));
    const out: number[][] = groups.map(() => []);
    base.forEach((b, k) => out[at.get(b.g) ?? 0].push(k));
    return out;
  }, [groups, base]);
  const [mn, mx] = useMemo(() => extent(base.map((r) => r.v)), [base]);
  const dom = fitDomain(mn, mx, 4, { zero: false, pad: 0.04 });
  const labelW = props.group ? Math.min(W * 0.26, Math.max(...groups.map((g) => textWidth(g, 11.5, 700)), 20) + 10) : 0;
  const bottom = 20;
  const top = 6;
  const x = scaleLinear(dom, [labelW + 10, W - 10]);
  const band = (H - top - bottom) / Math.max(1, groups.length);
  const perGroup = n / Math.max(1, groups.length);
  const r = props.radius ?? Math.max(1.4, Math.min(5.5, Math.sqrt(((W - labelW) * band * 0.5) / Math.max(1, perGroup)) / 2.4));

  const medians = useMemo(() => byGroup.map((ks) => quantileSorted(Float64Array.from(ks, (k) => base[k].v).sort(), 0.5)), [byGroup, base]);
  const hiGroup = useMemo(() => (props.group ? resolveHighlight(props.highlight as never, groups as never[], groups, medians, "max") : new Set<number>()), [props.group, props.highlight, groups, medians]);
  const hiPoint = useMemo(() => (!props.group ? resolveHighlight(props.highlight, base.map((b) => b.d), base.map((b) => b.label), base.map((b) => b.v), "max") : new Set<number>()), [props.group, props.highlight, base]);

  // 폭을 재기 전 렌더는 그려지지 않으니 배치를 건너뛰어요 (1만 점이면 수백 ms)
  const pending = c.pending;
  const bees = useMemo<Bee<T>[]>(() => {
    if (pending) return [];
    const out: Bee<T>[] = new Array(n);
    const strip = props.group && props.showMedian !== false ? 7 : 0;
    byGroup.forEach((ks, gi) => {
      const xs = ks.map((k) => x(base[k].v));
      const ys = beeswarm(xs, r, { maxSpread: Math.max(r, (band - strip) / 2 - r - 1) });
      ks.forEach((k, j) => {
        const b = base[k];
        out[k] = { i: k, g: gi, x: xs[j], y: top + band * gi + strip + (band - strip) / 2 + ys[j], value: b.v, label: b.label, hi: props.group ? hiGroup.has(gi) : hiPoint.has(k), datum: b.d };
      });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, base, byGroup, W, H, r, band, hiGroup, hiPoint, dom[0], dom[1]]);

  const D = c.motion.duration ?? 900;
  const marks = useMemo<Mark<Bee<T> | null>[]>(() => {
    if (useCanvas) return [{ key: "__p", to: [1], from: [0], data: null }];
    return bees.map((b) => ({ key: `b${b.i}`, to: [b.x, b.y, r], from: [b.x, top + band * b.g + band / 2, 0], enter: [b.x, b.y, 0], delay: ((b.x - labelW) / Math.max(1, W - labelW)) * D * 0.6, data: b }));
  }, [bees, useCanvas, r, band, W, labelW, D]);
  const m = useMotion(marks, c.motion);
  const accent = swatch(p, "accent");

  const fv = c.fv;
  const msg = MSG[c.lang];
  const nth = msg.nth;
  const events: ChartEvent<T>[] = useMemo(
    () =>
      lazyArray(bees.length, (k) => {
        const b = bees[k];
        return { datum: b.datum, index: b.i, key: `${b.i}`, label: b.label || `${groups[b.g] ? `${groups[b.g]} ` : ""}${nth(b.i + 1)}`, series: groups[b.g] || undefined, value: b.value, formatted: fv(b.value) };
      }),
    [bees, groups, fv, nth],
  );

  const nearest = (px: number, py: number) => {
    let best = -1;
    let bd = Infinity;
    for (let k = 0; k < bees.length; k++) {
      const b = bees[k];
      const d = (b.x - px) ** 2 + (b.y - py) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return Math.sqrt(bd) <= r + 8 ? best : null;
  };

  let tip: TooltipData | null = null;
  if (c.active !== null && bees[c.active]) {
    const b = bees[c.active];
    tip = { x: b.x, y: b.y - r, title: b.label || nth(b.i + 1), rows: [...(groups[b.g] ? [{ label: msg.group, value: groups[b.g] }] : []), { label: c.t.value, value: c.fv(b.value), color: b.hi ? accent.fill : p.paint("neutralStrong") }] };
  }

  const prog = useCanvas ? m.get("__p")?.[0] ?? 1 : 1;
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, t: number, color: (v: string, fb: string) => string) => {
      const neu = color("--ztd-neutral-strong", p.theme.neutralStrong);
      const acc = color("--ztd-accent", p.theme.accent);
      for (const b of bees) {
        const k = Math.max(0, Math.min(1, (t * 1.5 - (b.x - labelW) / Math.max(1, W - labelW) * 0.5) * 2));
        if (k <= 0) continue;
        ctx.fillStyle = b.hi ? acc : neu;
        ctx.globalAlpha = b.hi ? 0.95 : 0.7;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r * k, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    [bees, r, W, labelW, p.theme.neutralStrong, p.theme.accent],
  );
  const ticks = x.ticks(Math.max(2, Math.round(W / 110)));
  const desc = props.description ?? `${msg.kind}. ${msg.desc(n, groups.length, props.group ? groups.map((g, gi) => msg.median(g, c.fv(medians[gi]))).join(", ") : "")}.`;

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
      underlay={useCanvas ? <CanvasLayer width={W} height={H} draw={draw} progress={prog} version={c.sig} /> : undefined}
    >
      <g aria-hidden="true">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={H - bottom} stroke={p.paint("line")} />
            <Txt x={x(t)} y={H - bottom + 11} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
              {c.fmt(t)}
            </Txt>
          </g>
        ))}
        {props.group
          ? groups.map((g, gi) => (
              <g key={g}>
                {gi > 0 ? <line x1={labelW} x2={W} y1={top + band * gi} y2={top + band * gi} stroke={p.paint("line")} strokeDasharray="2 3" /> : null}
                <Txt x={labelW} y={top + band * gi + band / 2} anchor="end" size={11.5} weight={hiGroup.has(gi) ? 800 : 600} fill={p.paint(hiGroup.has(gi) ? "ink" : "muted")}>
                  {truncate(g, labelW - 4, 11.5, 700)}
                </Txt>
              </g>
            ))
          : null}
      </g>
      {!useCanvas
        ? m.items.map((it) => {
            const b = it.data;
            if (!b) return null;
            const [cx, cy, rr] = it.v;
            const isA = c.active === b.i;
            return <circle key={it.key} cx={cx} cy={cy} r={Math.max(0, rr)} fill={b.hi ? accent.fill : p.paint("neutralStrong")} fillOpacity={b.hi ? 0.95 : 0.72} stroke={isA ? p.paint("ink") : "none"} strokeWidth={1.6} onPointerEnter={(e) => c.setActive(b.i, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(b.i)} />;
          })
        : c.active !== null && bees[c.active]
          ? <circle cx={bees[c.active].x} cy={bees[c.active].y} r={r + 2} fill="none" stroke={p.paint("ink")} strokeWidth={1.6} pointerEvents="none" />
          : null}
      {props.showMedian !== false && props.group
        ? groups.map((g, gi) => {
            const mx0 = x(medians[gi]);
            const y0 = top + band * gi + 2;
            const text = `${msg.med} ${c.fv(medians[gi])}`;
            const tw = textWidth(text, 10, 700) + 10;
            return (
              <g key={g} opacity={m.fade(D * 0.7, 300)} pointerEvents="none">
                <line x1={mx0} x2={mx0} y1={y0 + 10} y2={y0 + band - 6} stroke={p.paint("ink")} strokeWidth={1.6} strokeDasharray="3 2" />
                <rect x={mx0 - tw / 2} y={y0 - 3} width={tw} height={14} rx={5} fill={p.paint("panel")} opacity={0.92} />
                <Txt x={mx0} y={y0 + 4} anchor="middle" size={10} weight={700} fill={p.paint("ink")}>
                  {text}
                </Txt>
              </g>
            );
          })
        : null}
    </ChartFrame>
  );
}
