import { useMemo } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { arcPath, polar, TAU } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { textWidth } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Highlight, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter, uniq } from "../data/accessor";
import { chordLayout, ribbonPath, type Chord } from "../layout/chord";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Chord diagram",
  sent: "Sent",
  received: "Received",
  groups: (n: number) => plural(n, "group"),
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "코드 다이어그램", sent: "보냄", received: "받음", groups: (n) => `그룹 ${n}개` },
};

export interface ChordChartProps<T = Row> extends Omit<BaseChartProps<T>, "highlight"> {
  /** 강조할 마디(이름 또는 인덱스). 함수는 마디 이름을 받아요. 기본은 가장 큰 마디 */
  highlight?: Highlight<string>;
  /** 출발 필드. 기본 "source" (없으면 "from") */
  source?: Accessor<T, string>;
  /** 도착 필드. 기본 "target" (없으면 "to") */
  target?: Accessor<T, string>;
  value?: Accessor<T, number>;
  /** 그룹 사이 틈(라디안). 기본 0.05 */
  padAngle?: number;
}

/** 코드 다이어그램: 그룹 사이 주고받는 양 */
export function ChordChart<T = Row>(props: ChordChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(240, Math.min(340, w * 0.7)), duration: 1000 });
  const { p, width: W, height: H } = c;

  const model = useMemo(() => {
    const has = (k: string) => props.data.some((d) => d && typeof d === "object" && k in (d as object));
    const gs = strGetter(props.source ?? (has("source") ? "source" : "from"), "source");
    const gt = strGetter(props.target ?? (has("target") ? "target" : "to"), "target");
    const gv = numGetter(props.value, "value");
    const names = uniq(props.data.flatMap((d, i) => [gs(d, i), gt(d, i)]));
    const idx = new Map(names.map((n, i) => [n, i]));
    const matrix = names.map(() => names.map(() => 0));
    props.data.forEach((d, i) => {
      const a = idx.get(gs(d, i));
      const b = idx.get(gt(d, i));
      if (a === undefined || b === undefined) return;
      matrix[a][b] += Math.max(0, gv(d, i) || 0);
    });
    const lay = chordLayout(matrix, props.padAngle ?? 0.05);
    const totals = lay.groups.map((g) => g.value);
    const hi = resolveHighlight(props.highlight as never, names as never[], names, totals, "max");
    const grand = totals.reduce((a, b) => a + b, 0) || 1;
    return { names, matrix, lay, hi, grand };
  }, [props.data, props.source, props.target, props.value, props.padAngle, props.highlight]);

  const labelW = Math.max(...model.names.map((n) => textWidth(n, 11.5, 700)), 20) + 14;
  const R = Math.max(40, Math.min(H / 2 - 16, W / 2 - labelW));
  const cx = W / 2;
  const cy = H / 2;
  const thick = Math.max(8, Math.min(14, R * 0.09));
  const rr = R - thick - 3;
  const D = c.motion.duration ?? 1000;
  const marks = useMemo<Mark<null>[]>(() => [{ key: "__sweep", to: [TAU], from: [0], data: null }, { key: "__rib", to: [1], from: [0], delay: D * 0.45, data: null }], [D]);
  const m = useMotion(marks, c.motion);
  const sweep = m.get("__sweep")?.[0] ?? TAU;
  const rib = m.get("__rib")?.[0] ?? 1;
  const accent = swatch(p, "accent");
  const msg = MSG[c.lang];
  const n = model.names.length;

  const hot = (ch: Chord) => model.hi.has(ch.source.index) || model.hi.has(ch.target.index);
  const act = c.active;
  const actGroup = act !== null && act < n ? act : null;
  const actChord = act !== null && act >= n ? model.lay.chords[act - n] : null;

  const events: ChartEvent<T>[] = [
    ...model.lay.groups.map((g) => ({ datum: null, index: g.index, key: model.names[g.index], label: model.names[g.index], value: g.value, formatted: `${c.fv(g.value)} (${c.pct((g.value / model.grand) * 100)})` })),
    ...model.lay.chords.map((ch, k) => ({ datum: null, index: n + k, key: `${ch.source.index}-${ch.target.index}`, label: `${model.names[ch.source.index]} ↔ ${model.names[ch.target.index]}`, value: ch.source.value + (ch.source.index === ch.target.index ? 0 : ch.target.value), formatted: `${model.names[ch.source.index]}→${model.names[ch.target.index]} ${c.fv(ch.source.value)}, ${model.names[ch.target.index]}→${model.names[ch.source.index]} ${c.fv(ch.target.value)}` })),
  ];
  let tip: TooltipData | null = null;
  if (actGroup !== null) {
    const g = model.lay.groups[actGroup];
    const [tx, ty] = polar(cx, cy, R, (g.a0 + g.a1) / 2);
    const outs = model.matrix[actGroup].reduce((a, b) => a + b, 0);
    const ins = model.matrix.reduce((a, row) => a + row[actGroup], 0);
    tip = { x: tx, y: ty, title: model.names[actGroup], rows: [{ label: msg.sent, value: c.fv(outs), color: model.hi.has(actGroup) ? accent.fill : p.paint("neutralStrong") }, { label: msg.received, value: c.fv(ins) }] };
  } else if (actChord) {
    const a = (actChord.source.a0 + actChord.source.a1) / 2;
    const [tx, ty] = polar(cx, cy, rr * 0.6, a);
    tip = { x: tx, y: ty, title: `${model.names[actChord.source.index]} ↔ ${model.names[actChord.target.index]}`, rows: [{ label: `${model.names[actChord.source.index]} →`, value: c.fv(actChord.source.value) }, { label: `${model.names[actChord.target.index]} →`, value: c.fv(actChord.target.value) }] };
  }
  const ribOpacity = (ch: Chord) => {
    if (actGroup !== null) return ch.source.index === actGroup || ch.target.index === actGroup ? 0.82 : 0.08;
    if (actChord) return ch === actChord ? 0.88 : 0.08;
    return hot(ch) ? 0.68 : 0.4;
  };
  const desc = props.description ?? `${msg.kind}. ${msg.groups(n)}: ${model.lay.groups.map((g) => `${model.names[g.index]} ${c.fv(g.value)}`).join(", ")}.`;

  return (
    <ChartFrame c={c} kind={msg.kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      <g opacity={Math.min(1, rib * 1.2)}>
        {model.lay.chords.map((ch, k) => (
          <path key={k} className="ztd-mark" d={ribbonPath(cx, cy, rr, ch.source.a0, ch.source.a1, ch.target.a0, ch.target.a1)} fill={hot(ch) ? accent.fill : p.paint("neutralStrong")} opacity={ribOpacity(ch)} stroke={p.paint("panel")} strokeWidth={0.6} onPointerEnter={(e) => c.setActive(n + k, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(n + k)} />
        ))}
      </g>
      {model.lay.groups.map((g) => {
        const a0 = Math.min(g.a0, sweep);
        const a1 = Math.min(g.a1, sweep);
        const isHi = model.hi.has(g.index);
        const d = arcPath(cx, cy, R - thick, R, a0, a1);
        const mid = (g.a0 + g.a1) / 2;
        const [lx, ly] = polar(cx, cy, R + 10, mid);
        const s = Math.sin(mid);
        return (
          <g key={g.index} onPointerEnter={(e) => c.setActive(g.index, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(g.index)}>
            {d ? <path className="ztd-mark" d={d} fill={isHi ? accent.fill : p.paint("ink")} opacity={actGroup === null || actGroup === g.index ? 1 : 0.4} stroke={act === g.index && c.via === "keyboard" ? p.paint("accent") : "none"} strokeWidth={2} /> : null}
            {c.showLabels ? (
              <Txt x={lx} y={ly + (Math.cos(mid) > 0.9 ? -3 : Math.cos(mid) < -0.9 ? 4 : 0)} anchor={s > 0.12 ? "start" : s < -0.12 ? "end" : "middle"} size={11.5} weight={isHi || actGroup === g.index ? 800 : 600} fill={p.paint(isHi ? "ink" : "muted")} opacity={m.fade(D * 0.4, 300)}>
                {model.names[g.index]}
              </Txt>
            ) : null}
          </g>
        );
      })}
    </ChartFrame>
  );
}
