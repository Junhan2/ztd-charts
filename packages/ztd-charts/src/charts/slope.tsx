import { useMemo } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { extent, fitDomain, scaleLinear } from "../core/scale";
import { dodgeVertical, textWidth, truncateBeside } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter, uniq } from "../data/accessor";
import type { ChartLang } from "../core/i18n";

const en = {
  kind: "Slope chart",
  change: "Change",
  span: (a: string, b: string) => `${a} to ${b}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "슬로프 차트", change: "변화", span: (a, b) => `${a}~${b}` },
};

export interface SlopeChartProps<T = Row> extends BaseChartProps<T> {
  /** 항목 이름. 기본 "label" */
  label?: Accessor<T, string>;
  /** 시점 필드 (긴 표). 첫 시점과 마지막 시점을 써요. 기본 "x" */
  x?: Accessor<T, string>;
  value?: Accessor<T, number>;
  /** 넓은 표: 시작 값 필드 */
  start?: string;
  /** 넓은 표: 끝 값 필드 */
  end?: string;
  /** 양쪽 제목. 기본 시점 이름 */
  periodLabels?: [string, string];
}

interface SlopeItem<T> {
  i: number;
  label: string;
  a: number;
  b: number;
  hi: boolean;
  datum: T | null;
}

/** 슬로프 차트: 두 시점 사이 순위와 크기 변화 */
export function SlopeChart<T = Row>(props: SlopeChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(200, Math.min(300, w * 0.6)), duration: 900, stagger: 90 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];

  const model = useMemo(() => {
    const gl = strGetter(props.label, "label");
    let items: SlopeItem<T>[];
    let periods: [string, string];
    if (props.start && props.end) {
      const ga = numGetter<T>(props.start, props.start);
      const gb = numGetter<T>(props.end, props.end);
      items = props.data.map((d, i) => ({ i, label: gl(d, i), a: ga(d, i), b: gb(d, i), hi: false, datum: d }));
      periods = props.periodLabels ?? [props.start, props.end];
    } else {
      const gx = strGetter(props.x, "x");
      const gv = numGetter(props.value, "value");
      const xs = uniq(props.data.map((d, i) => gx(d, i)));
      const first = xs[0];
      const last = xs[xs.length - 1];
      periods = props.periodLabels ?? [first ?? "", last ?? ""];
      const map = new Map<string, SlopeItem<T>>();
      props.data.forEach((d, i) => {
        const l = gl(d, i);
        const xv = gx(d, i);
        let it = map.get(l);
        if (!it) {
          it = { i: map.size, label: l, a: NaN, b: NaN, hi: false, datum: d };
          map.set(l, it);
        }
        if (xv === first) it.a = gv(d, i);
        if (xv === last) it.b = gv(d, i);
      });
      items = [...map.values()];
    }
    items = items.filter((it) => Number.isFinite(it.a) && Number.isFinite(it.b));
    items.forEach((it, k) => (it.i = k));
    const hi = resolveHighlight(props.highlight, items.map((it) => it.datum as T), items.map((it) => it.label), items.map((it) => it.b - it.a), "max");
    items.forEach((it) => (it.hi = hi.has(it.i)));
    return { items, periods };
  }, [props.data, props.label, props.x, props.value, props.start, props.end, props.periodLabels, props.highlight]);

  const items = model.items;
  const [mn, mx] = extent(items.flatMap((it) => [it.a, it.b]));
  const dom = fitDomain(mn, mx, 4, { zero: false, pad: 0.04 });
  const lw = Math.min(W * 0.34, Math.max(...items.map((it) => textWidth(`${it.label} ${c.fv(it.a)}`, 11.5, 800)), 30) + 16);
  const rw = Math.min(W * 0.34, Math.max(...items.map((it) => textWidth(`${c.fv(it.b)} ${it.label}`, 11.5, 800)), 30) + 16);
  const xa = lw;
  const xb = W - rw;
  const top = 26;
  const bottom = 10;
  const y = scaleLinear(dom, [H - bottom, top]);
  const ysL = dodgeVertical(items.map((it) => y(it.a)), 15, top, H - bottom);
  const ysR = dodgeVertical(items.map((it) => y(it.b)), 15, top, H - bottom);

  const stg = c.motion.stagger ?? 90;
  const order = useMemo(() => [...items].sort((a, b) => Number(a.hi) - Number(b.hi)), [items]);
  const marks = useMemo<Mark<SlopeItem<T>>[]>(() => order.map((it, k) => ({ key: `s:${it.label}`, to: [1, y(it.a), y(it.b)], from: [0, y(it.a), y(it.b)], enter: [0, y(it.a), y(it.b)], delay: k * stg, data: it })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, stg, H, dom[0], dom[1]]);
  const m = useMotion(marks, c.motion);
  const accent = swatch(p, "accent");

  const events: ChartEvent<T>[] = items.map((it) => ({ datum: it.datum, index: it.i, key: it.label, label: it.label, value: it.b, formatted: `${model.periods[0]} ${c.fv(it.a)} → ${model.periods[1]} ${c.fv(it.b)}` }));
  let tip: TooltipData | null = null;
  if (c.active !== null && items[c.active]) {
    const it = items[c.active];
    tip = { x: (xa + xb) / 2, y: (y(it.a) + y(it.b)) / 2, title: it.label, rows: [{ label: model.periods[0], value: c.fv(it.a) }, { label: model.periods[1], value: c.fv(it.b), color: it.hi ? accent.fill : p.paint("dim") }, { label: msg.change, value: `${it.b - it.a >= 0 ? "+" : "\u2212"}${c.fv(Math.abs(it.b - it.a))}` }] };
  }
  const D = c.motion.duration ?? 900;
  const desc = props.description ?? `${msg.kind}. ${msg.span(model.periods[0], model.periods[1])}: ${items.map((it) => `${it.label} ${c.fv(it.a)}→${c.fv(it.b)}`).join(", ")}.`;

  return (
    <ChartFrame c={c} kind={msg.kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      <g aria-hidden="true">
        <line x1={xa} x2={xa} y1={top - 4} y2={H - bottom} stroke={p.paint("line")} />
        <line x1={xb} x2={xb} y1={top - 4} y2={H - bottom} stroke={p.paint("line")} />
        <Txt x={xa} y={9} anchor="middle" size={11.5} weight={800} fill={p.paint("muted")}>
          {model.periods[0]}
        </Txt>
        <Txt x={xb} y={9} anchor="middle" size={11.5} weight={800} fill={p.paint("muted")}>
          {model.periods[1]}
        </Txt>
      </g>
      {m.items.map((it) => {
        const s = it.data;
        const [draw, ya, yb] = it.v;
        const col = s.hi ? accent.fill : p.paint("dim");
        const dash = draw < 0.999;
        const isA = c.active === s.i;
        return (
          <g key={it.key} className="ztd-mark" opacity={it.exiting ? 0.4 : c.dim(s.i)} onPointerEnter={(e) => c.setActive(s.i, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(s.i)}>
            <line x1={xa} y1={ya} x2={xb} y2={yb} stroke="transparent" strokeWidth={12} />
            <line x1={xa} y1={ya} x2={xb} y2={yb} stroke={isA && !s.hi ? p.paint("ink") : col} strokeWidth={s.hi ? 2.8 : 1.6} strokeLinecap="round" pathLength={dash ? 1 : undefined} strokeDasharray={dash ? "1 1" : undefined} strokeDashoffset={dash ? 1 - draw : undefined} />
            <circle cx={xa} cy={ya} r={s.hi ? 4 : 3} fill={col} />
            <circle cx={xb} cy={yb} r={s.hi ? 4 : 3} fill={col} opacity={draw >= 0.98 ? 1 : 0} />
          </g>
        );
      })}
      {c.showLabels
        ? items.map((it, k) => {
            const strong = it.hi || c.active === it.i;
            const fill = p.paint(strong ? "ink" : "muted");
            const o = m.fade(D * 0.5, 300) * c.dim(it.i);
            const wt = strong ? 800 : 500;
            const va = c.fv(it.a);
            const vb = c.fv(it.b);
            // 값은 그대로 두고 이름만 줄여요
            const name = (v: string, room: number) => truncateBeside(it.label, v, room, 11.5, wt);
            return (
              <g key={it.label} opacity={o}>
                <Txt x={xa - 9} y={ysL[k]} anchor="end" size={11.5} weight={wt} fill={fill}>
                  {[name(va, lw - 10), va].filter(Boolean).join(" ")}
                </Txt>
                <Txt x={xb + 9} y={ysR[k]} anchor="start" size={11.5} weight={wt} fill={fill}>
                  {[vb, name(vb, rw - 10)].filter(Boolean).join(" ")}
                </Txt>
              </g>
            );
          })
        : null}
    </ChartFrame>
  );
}
