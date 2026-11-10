import { useMemo } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { sum } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { categorical } from "../core/palette";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { cssEntrance, useCssEntrance } from "../core/css";
import { numGetter, strGetter } from "../data/accessor";
import type { ChartLang } from "../core/i18n";

const en = {
  kind: "Waffle chart",
  share: "Share",
  cells: "Cells",
  count: (n: number) => `${n}`,
  of: (cells: number) => `Out of ${cells} cells:`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { kind: "와플 차트", share: "비중", cells: "칸", count: (n) => `${n}칸`, of: (cells) => `${cells}칸 중` },
};

export interface WaffleChartProps<T = Row> extends BaseChartProps<T> {
  label?: Accessor<T, string>;
  value?: Accessor<T, number>;
  /** 칸 수. 기본 100 */
  cells?: number;
  /** 한 줄 칸 수. 기본 10 */
  columns?: number;
  /** 전체 값. 없으면 합계 */
  total?: number;
  /** 오른쪽 요약(큰 숫자). 기본 true */
  summary?: boolean;
  /** 요약 아래 설명. 없으면 강조 항목 이름 */
  summaryLabel?: string;
  /** 요약 둘째 줄. 없으면 나머지 항목 값 */
  summaryNote?: string;
}

/** 가장 큰 나머지 방식으로 칸 나누기: 합이 정확히 cells가 돼요 */
export function allocateCells(values: readonly number[], cells: number, total?: number): number[] {
  // A total below the sum would hand out more cells than there are.
  const t = Math.max(total ?? 0, sum(values));
  if (!(t > 0)) return values.map(() => 0);
  const exact = values.map((v) => (Math.max(0, v) / t) * cells);
  const out = exact.map((x) => Math.floor(x));
  const target = total === undefined ? cells : Math.min(cells, Math.round((sum(values) / t) * cells));
  let left = target - sum(out);
  const order = exact.map((x, i) => ({ r: x - Math.floor(x), i })).sort((a, b) => b.r - a.r);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++;
  return out;
}

/** 와플 차트: 100칸으로 보는 비율 */
export function WaffleChart<T = Row>(props: WaffleChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(160, Math.min(230, w * 0.5)), duration: 520, stagger: 7 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];
  const cells = Math.max(1, Math.round(props.cells ?? 100));
  const cols = Math.max(1, Math.round(props.columns ?? 10));
  const rowsN = Math.ceil(cells / cols);

  const model = useMemo(() => {
    const gl = strGetter(props.label, "label");
    const gv = numGetter(props.value, "value");
    const rows = props.data.map((d, i) => ({ d, i, label: gl(d, i), value: Math.max(0, gv(d, i) || 0) }));
    const hi = resolveHighlight(props.highlight, rows.map((r) => r.d), rows.map((r) => r.label), rows.map((r) => r.value), "first");
    const counts = allocateCells(rows.map((r) => r.value), cells, props.total);
    const total = props.total ?? sum(rows.map((r) => r.value));
    return { rows, hi, counts, total };
  }, [props.data, props.label, props.value, props.highlight, cells, props.total]);

  const colors = useMemo(() => categorical(p, model.rows.length, model.hi), [p, model]);
  const summary = props.summary !== false && W >= 260;
  const gap = W < 360 ? 2.5 : 3.5;
  const gridMaxW = summary ? W * 0.58 : W;
  const cell = Math.max(3, Math.min((gridMaxW - (cols - 1) * gap) / cols, (H - (rowsN - 1) * gap) / rowsN));
  const gridW = cols * cell + (cols - 1) * gap;
  const gridH = rowsN * cell + (rowsN - 1) * gap;
  const gy = (H - gridH) / 2;

  const owner = useMemo(() => {
    const out: number[] = [];
    model.counts.forEach((n, k) => {
      for (let j = 0; j < n; j++) out.push(k);
    });
    return out;
  }, [model.counts]);

  const stagger = c.motion.stagger ?? 7;
  // With highlight="none" nothing is featured, so the big figure (which reads as the highlighted share) is left out.
  const hiIdx = [...model.hi][0] ?? -1;
  const hiRow = model.rows[hiIdx];
  const pct = model.total > 0 && hiRow ? (hiRow.value / model.total) * 100 : 0;
  // 격자와 요약을 한 묶음으로 가운데에 놓아요. 격자를 왼쪽에 붙이면 넓은 카드에서 오른쪽 절반이 비어요
  const others = model.rows.filter((_, k) => !model.hi.has(k));
  const note = props.summaryNote ?? others.map((r) => `${r.label} ${c.fv(r.value)}`).join(" · ");
  const gapS = Math.max(14, (W - gridW) * 0.12);
  const room = W - gridW - gapS;
  const big = Math.max(24, Math.min(46, room * 0.32, H * 0.24));
  const sumW = summary && hiRow ? Math.min(room, Math.max(textWidth(c.pct(pct), big, 800), textWidth(props.summaryLabel ?? hiRow.label, 12.5, 700), note ? textWidth(note, 11) : 0)) : 0;
  const gx = summary ? Math.max(0, (W - (gridW + gapS + sumW)) / 2) : (W - gridW) / 2;
  const sx = gx + gridW + gapS;
  const sw = W - sx;
  // 칸 등장은 CSS로, 숫자 올라가기만 엔진으로 (프레임마다 칸 100개를 다시 그리지 않아요)
  const numMarks = useMemo<Mark<null>[]>(() => [{ key: "__n", to: [pct], from: [0], delay: 100, data: null }], [pct]);
  const cellMs = c.motion.duration ?? 520;
  const mn = useMotion(numMarks, { ...c.motion, duration: cellMs + cells * stagger * 0.8 });
  const shown = mn.get("__n")?.[0] ?? pct;
  const { active, via, setActive, click } = c;
  const enabled = useCssEntrance(c, mn);
  const cellNodes = useMemo(
    () =>
      Array.from({ length: cells }, (_, idx) => {
        const k = owner[idx] ?? -1;
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const sw0 = k >= 0 ? colors[k] : null;
        return (
          <rect
            key={idx}
            className="ztd-mark ztd-pop"
            data-k={k}
            x={gx + col * (cell + gap)}
            y={gy + row * (cell + gap)}
            width={cell}
            height={cell}
            rx={Math.min(cell * 0.22, 4)}
            fill={sw0 ? sw0.fill : p.paint("neutralSoft")}
            opacity={k >= 0 && active !== null && active !== k ? 0.38 : undefined}
            stroke={k >= 0 && active === k && via === "keyboard" ? p.paint("ink") : undefined}
            strokeWidth={1.5}
            style={cssEntrance(enabled, mn.waiting, "pop", idx * stagger, cellMs)}
          />
        );
      }),
    // mn.waiting과 세대가 바뀔 때만 다시 만들어요
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cells, owner, cols, gx, gy, cell, gap, colors, p, active, via, enabled, mn.waiting, mn.generation, stagger, cellMs],
  );

  const events: ChartEvent<T>[] = model.rows.map((r, k) => ({
    datum: r.d,
    index: k,
    key: r.label,
    label: r.label,
    value: r.value,
    formatted: `${c.fv(r.value)} · ${c.pct(model.total ? (r.value / model.total) * 100 : 0)}`,
  }));

  let tip: TooltipData | null = null;
  if (c.active !== null && model.rows[c.active]) {
    const r = model.rows[c.active];
    const firstCell = owner.indexOf(c.active);
    const cx = gx + ((firstCell >= 0 ? firstCell : 0) % cols) * (cell + gap) + cell / 2;
    const cy = gy + Math.floor((firstCell >= 0 ? firstCell : 0) / cols) * (cell + gap);
    tip = { x: cx, y: cy, title: r.label, rows: [{ label: c.t.value, value: c.fv(r.value), color: colors[c.active].fill }, { label: msg.share, value: c.pct(model.total ? (r.value / model.total) * 100 : 0) }, { label: msg.cells, value: msg.count(model.counts[c.active]) }] };
  }

  const desc = props.description ?? `${msg.kind}. ${msg.of(cells)} ${model.rows.map((r, k) => `${r.label} ${msg.count(model.counts[k])}`).join(", ")}.`;

  return (
    <ChartFrame c={c} kind={msg.kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      <g
        key={mn.generation}
        onPointerOver={(e) => {
          const k = Number((e.target as Element).getAttribute("data-k"));
          if (k >= 0) setActive(k, e.pointerType === "touch" ? "touch" : "pointer");
        }}
        onClick={(e) => {
          const k = Number((e.target as Element).getAttribute("data-k"));
          if (k >= 0) click(k);
        }}
      >
        {cellNodes}
      </g>
      {summary && hiRow ? (
        <g opacity={mn.fade(250, 300)}>
          <Txt x={sx} y={H / 2 - big * 0.32} size={big} weight={800} fill={p.paint("ink")} letterSpacing={-1}>
            {c.pct(shown)}
          </Txt>
          <Txt x={sx} y={H / 2 + big * 0.42} size={12.5} weight={700} fill={p.paint("ink")}>
            {truncate(props.summaryLabel ?? hiRow.label, sw - 2, 12.5, 700)}
          </Txt>
          {note ? (
            <Txt x={sx} y={H / 2 + big * 0.42 + 17} size={11} fill={p.paint("muted")}>
              {truncate(note, sw - 2, 11)}
            </Txt>
          ) : null}
        </g>
      ) : null}
    </ChartFrame>
  );
}
