import { useMemo, type ReactNode } from "react";
import { AXIS_FONT, AxisXBand, GridY, thinLabels, yAxisWidth } from "../core/axis";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { makeTickFormatter } from "../core/format";
import { roundRectPath } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { categorical, emphasis, type Swatch } from "../core/palette";
import { extent, fitDomain, scaleBand, scaleLinear } from "../core/scale";
import { prepSeries } from "../core/series";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { stack } from "../layout/stack";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Bar chart",
  desc: (cats: number, nS: number, names: string) => `${plural(cats, "category", "categories")}${nS > 1 ? `, ${nS} series (${names})` : ""}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "막대 차트", desc: (cats, nS, names) => `${cats}개 범주${nS > 1 ? `, 계열 ${nS}개(${names})` : ""}` },
};

export interface BarChartProps<T = Row> extends BaseChartProps<T> {
  /** 범주 필드. 기본 "x" (가로 막대도 범주는 x로 넘겨요) */
  x?: Accessor<T, string>;
  /** 값 필드. 배열이면 넓은 표의 여러 열 */
  y?: Accessor<T, number> | string[];
  /** 계열 필드 (긴 표) */
  series?: Accessor<T, string>;
  /** "grouped" | "stacked" | "percent". 기본 "grouped" */
  layout?: "grouped" | "stacked" | "percent";
  /** "vertical" | "horizontal". 기본 "vertical" */
  orientation?: "vertical" | "horizontal";
  /** 값 순 정렬 (계열 하나일 때). 기본 false */
  sort?: boolean;
  /** 강조 대상: 계열 하나면 범주, 여러 개면 계열. 기본 "max" / 첫 계열. 계열이 여러 개일 때 판별 함수는 행이 아니라 계열 이름을 받아요: (name, index) => boolean */
  highlight?: BaseChartProps<T>["highlight"];
}

interface BarSeg {
  key: string;
  k: number;
  s: number;
  cat: string;
  series: string;
  value: number;
  v0: number;
  v1: number;
  sw: Swatch;
  hi: boolean;
}

/** 막대 차트: 묶은, 쌓은, 100% 막대와 가로 막대 */
export function BarChart<T = Row>(props: BarChartProps<T>) {
  const horizontal = props.orientation === "horizontal";
  const c = useChart(props, { height: (w) => (horizontal ? Math.max(180, Math.min(320, w * 0.5)) : Math.max(200, Math.min(290, w * 0.52))), duration: 750, stagger: 60 });
  const { p, width: W, height: H } = c;
  const layout = props.layout ?? "grouped";

  const model0 = useMemo(() => prepSeries(props.data, props.x, props.y as never, props.series, { xType: "band", locale: c.locale }), [props.data, props.x, props.y, props.series, c.locale]);
  const model = useMemo(() => {
    if (!props.sort || model0.series.length !== 1) return model0;
    const idx = model0.keys.map((_, k) => k).sort((a, b) => (model0.values[0][b] || 0) - (model0.values[0][a] || 0));
    return { ...model0, keys: idx.map((k) => model0.keys[k]), labels: idx.map((k) => model0.labels[k]), xnum: idx.map((_, i) => i), values: [idx.map((k) => model0.values[0][k])], rows: [idx.map((k) => model0.rows[0][k])] };
  }, [model0, props.sort]);
  const nS = model.series.length;
  const single = nS === 1;

  const hi = useMemo(() => {
    if (single) return resolveHighlight(props.highlight, model.rows[0] as T[], model.labels, model.values[0], "max");
    const totals = model.values.map((r) => r.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0));
    return resolveHighlight(props.highlight as never, model.series as never[], model.series, totals, "first");
  }, [model, single, props.highlight]);
  const colors = useMemo(() => (single ? emphasis(p, model.keys.length, hi) : categorical(p, nS, hi)), [single, p, model.keys.length, hi, nS]);

  const segs = useMemo(() => {
    const out: BarSeg[] = [];
    const st = layout === "grouped" ? null : stack(model.values, layout === "percent" ? "expand" : "zero");
    model.keys.forEach((cat, k) => {
      model.series.forEach((s, si) => {
        const v = model.values[si][k];
        if (!Number.isFinite(v)) return;
        const v0 = st ? st.y0[si][k] : 0;
        const v1 = st ? st.y1[si][k] : v;
        out.push({ key: `${cat}|${s}`, k, s: si, cat: model.labels[k], series: s, value: v, v0, v1, sw: single ? colors[k] : colors[si], hi: single ? hi.has(k) : hi.has(si) });
      });
    });
    return out;
  }, [model, layout, colors, single, hi]);

  const vals = segs.flatMap((s) => [s.v0, s.v1]);
  const [mn, mx] = extent(vals.length ? vals : [0, 1]);
  const dom: [number, number] = layout === "percent" ? [0, 100] : fitDomain(mn, mx, horizontal ? Math.max(2, Math.round(W / 120)) : Math.max(2, Math.round(H / 70)));
  const tickFmt = layout === "percent" ? (v: number) => `${v}%` : makeTickFormatter(props.format, c.locale, Math.max(Math.abs(dom[0]), Math.abs(dom[1])));
  const showValues = c.showLabels && (single || layout !== "grouped" || nS <= 3);
  const valueText = (sg: BarSeg) => (layout === "percent" ? c.pct(sg.v1 - sg.v0) : c.fmt(sg.value));

  // 축 배치
  const catW = horizontal ? Math.min(W * 0.32, Math.max(...model.labels.map((l) => textWidth(l, 11.5, 600)), 24) + 10) : 0;
  const valPad = horizontal && showValues && layout !== "percent" ? Math.max(...segs.map((s) => textWidth(valueText(s), 11, 700)), 0) + 10 : 0;
  const ticks = scaleLinear(dom, [0, 1]).ticks(horizontal ? Math.max(2, Math.round(W / 130)) : Math.max(2, Math.round(H / 70)));
  const left = horizontal ? catW + 6 : yAxisWidth(ticks, tickFmt, c.locale);
  const top = horizontal ? 4 : showValues ? 16 : 8;
  const bottom = horizontal ? 18 : 22;
  // 세로 막대의 음수 값 글자는 막대 끝 아래에 써요. 가장 낮은 막대 아래 글자 자리를 남겨요
  const negPad = !horizontal && showValues && mn < 0 && (single || layout === "grouped") ? 16 : 0;
  const x0 = horizontal ? left : left + 4;
  const x1 = horizontal ? W - Math.max(8, valPad) : W - 2;
  const band = horizontal ? scaleBand(model.keys, [top, H - bottom], 0.3, 0.12) : scaleBand(model.keys, [x0, x1], nS > 1 && layout === "grouped" ? 0.24 : 0.32, 0.12);
  const v = horizontal ? scaleLinear(dom, [x0, x1]) : scaleLinear(dom, [H - bottom - negPad, top]);
  const inner = layout === "grouped" && nS > 1 ? scaleBand(model.series, [0, band.bandwidth], 0.12, 0) : null;
  const r = Math.min(p.theme.radiusMark, (inner ? inner.bandwidth : band.bandwidth) / 4);

  const geom = (sg: BarSeg) => {
    const pos = band(model.keys[sg.k]) + (inner ? inner(sg.series) : 0);
    const th = inner ? inner.bandwidth : band.bandwidth;
    const a = v(sg.v0);
    const b = v(sg.v1);
    return { pos, th, a, b };
  };

  // 계열 하나인 세로 막대의 값 글자: 칸 폭보다 넓으면 겹치지 않게 솎아요 (강조 막대 글자는 남겨요)
  const shownValues = useMemo(
    () => (single && !horizontal && showValues ? new Set(thinLabels(segs.map((sg) => band(model.keys[sg.k]) + band.bandwidth / 2), segs.map(valueText), band.bandwidth < 26 ? 10 : 11, 4, 500, new Set(segs.flatMap((sg, j) => (sg.hi ? [j] : []))))) : null),
    // band, valueText는 아래 값들로 정해져요
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segs, single, horizontal, showValues, layout, W, H, c.fmt],
  );

  const stg = c.motion.stagger ?? 60;
  const marks = useMemo<Mark<BarSeg>[]>(
    () =>
      segs.map((sg) => {
        const g = geom(sg);
        const base = v(Math.max(dom[0], Math.min(0, dom[1])));
        return { key: sg.key, to: [g.pos, g.th, g.a, g.b], from: [g.pos, g.th, layout === "grouped" ? base : g.a, layout === "grouped" ? base : g.a], enter: [g.pos, g.th, g.a, g.a], delay: sg.k * stg + sg.s * (layout === "grouped" ? 30 : 70), data: sg };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segs, W, H, dom[0], dom[1], stg, layout, horizontal],
  );
  const m = useMotion(marks, c.motion);

  const events: ChartEvent<T>[] = segs.map((sg, i) => ({ datum: (model.rows[sg.s]?.[sg.k] as T) ?? null, index: i, key: sg.key, label: sg.cat, series: sg.series || undefined, value: sg.value, formatted: `${c.fv(sg.value)}${layout === "percent" ? ` (${c.pct(sg.v1 - sg.v0)})` : ""}` }));
  const segIndex = new Map(segs.map((sg, i) => [sg.key, i]));

  let tip: TooltipData | null = null;
  if (c.active !== null && segs[c.active]) {
    const sg = segs[c.active];
    const g = geom(sg);
    const rows = nS > 1 ? model.series.map((s, si) => ({ label: s, value: Number.isFinite(model.values[si][sg.k]) ? c.fv(model.values[si][sg.k]) : "-", color: colors[si].fill, strong: si === sg.s })) : [{ label: c.t.value, value: c.fv(sg.value), color: sg.sw.fill }];
    tip = horizontal ? { x: Math.max(g.a, g.b), y: g.pos, title: sg.cat, rows } : { x: g.pos + g.th / 2, y: Math.min(g.a, g.b), title: sg.cat, rows };
  }

  const msg = MSG[c.lang];
  const desc = props.description ?? `${msg.kind}. ${msg.desc(model.keys.length, nS, model.series.join(", "))}. ${single ? model.labels.map((l, k) => `${l} ${c.fv(model.values[0][k])}`).slice(0, 8).join(", ") : ""}`;

  return (
    <ChartFrame c={c} kind={msg.kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      {horizontal ? (
        <g aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={Math.round(v(t)) + 0.5} x2={Math.round(v(t)) + 0.5} y1={top} y2={H - bottom} stroke={p.paint(t === 0 ? "dim" : "line")} />
              <Txt x={v(t)} y={H - bottom + 11} anchor="middle" size={AXIS_FONT} fill={p.paint("muted")}>
                {tickFmt(t)}
              </Txt>
            </g>
          ))}
        </g>
      ) : (
        <GridY p={p} ticks={ticks} y={v} x0={left} x1={W} fmt={tickFmt} locale={c.locale} />
      )}
      {m.items.map((it) => {
        const sg = it.data;
        const [pos, th, a, b] = it.v;
        const i = segIndex.get(sg.key) ?? 0;
        const neg = sg.v1 < sg.v0 || sg.value < 0;
        const stackedTop = layout === "grouped" || sg.s === nS - 1;
        const corners = horizontal ? (stackedTop ? (neg ? { tl: r, bl: r } : { tr: r, br: r }) : {}) : stackedTop ? (neg ? { bl: r, br: r } : { tl: r, tr: r }) : {};
        const d = horizontal ? roundRectPath(Math.min(a, b), pos, Math.abs(b - a), th, corners) : roundRectPath(pos, Math.min(a, b), th, Math.abs(b - a), corners);
        const lo = m.fade(sg.k * stg + 320, 260);
        let label: ReactNode = null;
        if (showValues) {
          const text = valueText(sg);
          const tw = textWidth(text, 11, 700);
          const len = Math.abs(b - a);
          if (layout === "grouped" || nS === 1) {
            label = horizontal ? (
              <Txt x={Math.max(a, b) + 6} y={pos + th / 2} size={11} weight={sg.hi ? 800 : 500} fill={p.paint(sg.hi ? "ink" : "muted")} opacity={lo}>
                {text}
              </Txt>
            ) : (nS === 1 ? !shownValues || shownValues.has(i) : th >= tw * 0.8) ? (
              <Txt x={pos + th / 2} y={neg ? Math.max(a, b) + 8 : Math.min(a, b) - 8} anchor="middle" size={th < 26 ? 10 : 11} weight={sg.hi ? 800 : 500} fill={p.paint(sg.hi ? "ink" : "muted")} opacity={lo}>
                {text}
              </Txt>
            ) : null;
          } else if (len >= (horizontal ? tw + 10 : 16) && (horizontal ? th >= 14 : th >= tw + 6)) {
            label = (
              <Txt x={horizontal ? (a + b) / 2 : pos + th / 2} y={horizontal ? pos + th / 2 : (a + b) / 2} anchor="middle" size={11} weight={700} fill={sg.sw.text} opacity={lo}>
                {text}
              </Txt>
            );
          }
        }
        return (
          <g key={it.key} className="ztd-mark" opacity={it.exiting ? 0.4 : c.dim(i)} onPointerEnter={(e) => c.setActive(i, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(i)} style={{ cursor: props.onClick ? "pointer" : undefined }}>
            {layout === "grouped" || nS === 1 ? (
              // 막대가 0이거나 아주 짧아도 칸 전체를 호버 영역으로 (칠한 부분만 받으면 0 막대는 잡을 수 없어요)
              horizontal ? <rect x={x0} y={pos} width={Math.max(0, x1 - x0)} height={th} fill="transparent" /> : <rect x={pos} y={top} width={th} height={Math.max(0, H - bottom - top)} fill="transparent" />
            ) : null}
            <path d={d} fill={sg.sw.fill} stroke={layout !== "grouped" && nS > 1 ? p.paint("panel") : "none"} strokeWidth={1} />
            {c.active === i && c.via === "keyboard" ? <path d={horizontal ? roundRectPath(Math.min(a, b) - 2, pos - 2, Math.abs(b - a) + 4, th + 4, 4) : roundRectPath(pos - 2, Math.min(a, b) - 2, th + 4, Math.abs(b - a) + 4, 4)} fill="none" stroke={p.paint("ink")} strokeWidth={2} /> : null}
            {label}
          </g>
        );
      })}
      {horizontal ? (
        <g aria-hidden="true">
          {model.keys.map((key, k) => {
            const strong = single && hi.has(k);
            return (
              <Txt key={key} x={catW} y={band(key) + band.bandwidth / 2} anchor="end" size={11.5} weight={strong ? 800 : 500} fill={p.paint(strong ? "ink" : "muted")}>
                {truncate(model.labels[k], catW - 4, 11.5, strong ? 800 : 500)}
              </Txt>
            );
          })}
        </g>
      ) : (
        <AxisXBand p={p} labels={model.labels} centers={model.keys.map((key) => band(key) + band.bandwidth / 2)} y={H - bottom + 13} strong={single ? hi : undefined} />
      )}
    </ChartFrame>
  );
}
