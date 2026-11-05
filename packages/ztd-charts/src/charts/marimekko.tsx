import { useMemo } from "react";
import { GridY, yAxisWidth } from "../core/axis";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { roundRectPath, sum } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { categorical, type Swatch } from "../core/palette";
import { scaleLinear } from "../core/scale";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Highlight, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter, uniq } from "../data/accessor";
import type { ChartLang } from "../core/i18n";

const en = {
  kind: "Marimekko chart",
  inCol: "Share in column",
  colShare: "Column share",
  desc: (cols: string, series: string) => `Columns: ${cols}. Series: ${series}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "마리메코 차트", inCol: "열 안 비중", colShare: "열 비중", desc: (cols, series) => `열 ${cols}. 계열 ${series}` },
};

export interface MarimekkoChartProps<T = Row> extends Omit<BaseChartProps<T>, "highlight"> {
  /** 열(가로 구분) 필드. 기본 "x" */
  x?: Accessor<T, string>;
  /** 쌓는 계열 필드. 기본 "series" */
  series?: Accessor<T, string>;
  value?: Accessor<T, number>;
  /** 강조할 계열(이름 또는 인덱스). 함수는 계열 이름을 받아요. 기본 첫 계열 */
  highlight?: Highlight<string>;
}

interface Seg<T> {
  key: string;
  col: number;
  s: number;
  x: string;
  series: string;
  value: number;
  share: number;
  colShare: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  sw: Swatch;
  datum: T | null;
}

/** 마리메코 차트: 폭(열 비중)과 높이(열 안 비중)로 두 비율을 같이 */
export function MarimekkoChart<T = Row>(props: MarimekkoChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(200, Math.min(270, w * 0.58)), duration: 700, stagger: 120 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];

  const model = useMemo(() => {
    const gx = strGetter(props.x, "x");
    const gs = strGetter(props.series, "series");
    const gv = numGetter(props.value, "value");
    const rows = props.data.map((d, i) => ({ d, x: gx(d, i), s: gs(d, i), v: Math.max(0, gv(d, i) || 0) }));
    const cols = uniq(rows.map((r) => r.x));
    const series = uniq(rows.map((r) => r.s));
    const val = new Map<string, { v: number; d: T }>();
    rows.forEach((r) => {
      const k = `${r.x}\u0000${r.s}`;
      const prev = val.get(k);
      val.set(k, { v: (prev?.v ?? 0) + r.v, d: r.d });
    });
    const colTot = cols.map((cx) => sum(series.map((s) => val.get(`${cx}\u0000${s}`)?.v ?? 0)));
    const total = sum(colTot) || 1;
    const hi = resolveHighlight(props.highlight as never, series as never[], series, series.map(() => 0), "first");
    return { cols, series, val, colTot, total, hi };
  }, [props.data, props.x, props.series, props.value, props.highlight]);

  const colors = categorical(p, model.series.length, model.hi);
  const ticks = [0, 50, 100];
  const tf = (v: number) => String(v);
  const left = yAxisWidth(ticks, tf);
  const top = 6;
  const bottom = 34;
  const gap = 3;
  const plotW = W - left - 4;
  const y = scaleLinear([0, 100], [H - bottom, top]);

  const segs = useMemo(() => {
    const out: Seg<T>[] = [];
    let acc = 0;
    const usable = plotW - gap * Math.max(0, model.cols.length - 1);
    model.cols.forEach((cx, ci) => {
      const w = (model.colTot[ci] / model.total) * usable;
      const x0 = left + 4 + acc;
      acc += w + gap;
      let ys = 0;
      model.series.forEach((s, si) => {
        const hit = model.val.get(`${cx}\u0000${s}`);
        const v = hit?.v ?? 0;
        const share = model.colTot[ci] ? (v / model.colTot[ci]) * 100 : 0;
        out.push({ key: `${cx}|${s}`, col: ci, s: si, x: cx, series: s, value: v, share, colShare: (model.colTot[ci] / model.total) * 100, x0, x1: x0 + w, y0: ys, y1: ys + share, sw: colors[si], datum: hit?.d ?? null });
        ys += share;
      });
    });
    return out;
  }, [model, plotW, left, colors]);

  const stg = c.motion.stagger ?? 120;
  const marks = useMemo<Mark<Seg<T>>[]>(
    () => segs.map((sg) => ({ key: sg.key, to: [sg.x0, sg.x1, y(sg.y0), y(sg.y1)], from: [sg.x0, sg.x1, y(0), y(0)], enter: [sg.x0, sg.x1, y(sg.y0), y(sg.y0)], delay: sg.col * stg + sg.s * 40, data: sg })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segs, H, stg],
  );
  const m = useMotion(marks, c.motion);

  const events: ChartEvent<T>[] = segs.map((sg, k) => ({ datum: sg.datum, index: k, key: sg.key, label: sg.x, series: sg.series, value: sg.value, formatted: `${c.pct(sg.share)} · ${c.fv(sg.value)}` }));
  const r = p.theme.radiusMark;

  let tip: TooltipData | null = null;
  if (c.active !== null && segs[c.active]) {
    const sg = segs[c.active];
    tip = { x: (sg.x0 + sg.x1) / 2, y: y(sg.y1), title: `${sg.x} · ${sg.series}`, rows: [{ label: msg.inCol, value: c.pct(sg.share), color: sg.sw.fill }, { label: c.t.value, value: c.fv(sg.value) }, { label: msg.colShare, value: c.pct(sg.colShare) }] };
  }

  const desc = props.description ?? `${msg.kind}. ${msg.desc(model.cols.map((cx, ci) => `${cx} ${c.pct((model.colTot[ci] / model.total) * 100)}`).join(", "), model.series.join(", "))}.`;

  return (
    <ChartFrame c={c} kind={msg.kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      <GridY p={p} ticks={ticks} y={y} x0={left} x1={W} fmt={tf} />
      {m.items.map((it) => {
        const sg = it.data;
        const [x0, x1, ya, yb] = it.v;
        const k = segs.indexOf(sg);
        const w = Math.max(0, x1 - x0);
        const h = Math.max(0, ya - yb);
        const isTop = sg.s === model.series.length - 1;
        const isBottom = sg.s === 0;
        const corners = { tl: isTop ? r : 0, tr: isTop ? r : 0, bl: isBottom ? r : 0, br: isBottom ? r : 0 };
        const text = c.pct(sg.share);
        const fits = h >= 18 && w >= textWidth(text, 12, 700) + 10;
        return (
          <g key={it.key} className="ztd-mark" opacity={it.exiting ? 0.5 : c.dim(k)} onPointerEnter={(e) => c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(k)}>
            <path d={roundRectPath(x0, yb, w, h, corners)} fill={sg.sw.fill} stroke={p.paint("panel")} strokeWidth={h > 2 ? 1.5 : 0} />
            {c.active === k && c.via === "keyboard" ? <path d={roundRectPath(x0 + 1, yb + 1, w - 2, h - 2, 3)} fill="none" stroke={sg.sw.text} strokeWidth={2} /> : null}
            {c.showLabels && fits ? (
              <Txt x={x0 + w / 2} y={yb + h / 2} anchor="middle" size={12} weight={700} fill={sg.sw.text} opacity={m.fade(sg.col * stg + 380, 260)}>
                {text}
              </Txt>
            ) : null}
          </g>
        );
      })}
      <g aria-hidden="true">
        {model.cols.map((cx, ci) => {
          const sg = segs.find((s) => s.col === ci);
          if (!sg) return null;
          const mid = (sg.x0 + sg.x1) / 2;
          const w = sg.x1 - sg.x0;
          return (
            <g key={cx}>
              <Txt x={mid} y={H - bottom + 12} anchor="middle" size={11} weight={700} fill={p.paint("ink")}>
                {truncate(cx, w + 4, 11, 700)}
              </Txt>
              <Txt x={mid} y={H - bottom + 26} anchor="middle" size={10} fill={p.paint("muted")}>
                {c.pct(sg.colShare)}
              </Txt>
            </g>
          );
        })}
      </g>
    </ChartFrame>
  );
}
