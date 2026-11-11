import { useMemo, type MouseEvent, type PointerEvent } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { polar, sum } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { categorical } from "../core/palette";
import { labelBox, overlaps, textWidth, truncate, truncateBeside, type Box } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart, type ChartCtx } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { cssEntrance, useCssEntrance } from "../core/css";
import { numGetter, strGetter } from "../data/accessor";
import type { ChartLang } from "../core/i18n";
import { allocateCells, ARC_INNER, ARC_MAX_DOTS, arcSeats, ownerOf } from "../layout/seats";

const en = {
  kind: "Waffle chart",
  share: "Share",
  cells: "Cells",
  count: (n: number) => `${n}`,
  of: (cells: number) => `Out of ${cells} cells:`,
  arcKind: "Seat chart",
  ofTotal: (n: string, total: string) => `${n} of ${total}`,
  empty: (n: string) => `${n} empty`,
  perDot: (n: string) => `Each dot is about ${n} units.`,
  short: (gap: string, ref: string) => `${gap} short of ${ref}`,
  over: (gap: string, ref: string) => `${gap} past ${ref}`,
  at: (ref: string) => `exactly at ${ref}`,
  total: (n: string) => `${n} in all`,
  refs: (s: string) => `Reference lines: ${s}.`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "와플 차트",
    share: "비중",
    cells: "칸",
    count: (n) => `${n}칸`,
    of: (cells) => `${cells}칸 중`,
    arcKind: "좌석 차트",
    ofTotal: (n, total) => `${total} 중 ${n}`,
    empty: (n) => `빈자리 ${n}`,
    perDot: (n) => `점 하나가 약 ${n}이에요.`,
    short: (gap, ref) => `${ref}까지 ${gap} 모자라요`,
    over: (gap, ref) => `${ref}보다 ${gap} 많아요`,
    at: (ref) => `${ref}에 꼭 맞아요`,
    total: (n) => `모두 ${n}`,
    refs: (s) => `기준선: ${s}.`,
  },
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
  /** "grid"(기본) 격자, "arc"는 점 하나가 한 단위인 반원 여러 줄(의석 차트). arc에서는 cells, columns를 쓰지 않고, 요약은 가운데에 전체, 강조 묶음, summaryNote 순이에요 */
  shape?: "grid" | "arc";
  /** shape "arc": 그 단위 수에 긋는 방사선 (과반 등). [{ value, label }] */
  referenceLines?: { value: number; label?: string }[];
}

export { allocateCells };

/** 칸, 점의 data-k(묶음 번호)를 읽는 포인터 처리. 격자와 반원이 같이 써요 (-1은 빈칸) */
function hits(setActive: ChartCtx<unknown>["setActive"], click: (k: number) => void) {
  const at = (e: { target: EventTarget }) => Number((e.target as Element).getAttribute("data-k"));
  return {
    onPointerOver: (e: PointerEvent<SVGGElement>) => {
      const k = at(e);
      if (k >= 0) setActive(k, e.pointerType === "touch" ? "touch" : "pointer");
    },
    onClick: (e: MouseEvent<SVGGElement>) => {
      const k = at(e);
      if (k >= 0) click(k);
    },
  };
}

/** 와플 차트: 100칸으로 보는 비율. shape "arc"면 점 하나가 한 단위인 반원(의석 차트)이에요 */
export function WaffleChart<T = Row>(props: WaffleChartProps<T>) {
  return props.shape === "arc" ? <WaffleArc {...props} /> : <WaffleGrid {...props} />;
}

function WaffleGrid<T = Row>(props: WaffleChartProps<T>) {
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

  const owner = useMemo(() => ownerOf(model.counts), [model.counts]);

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
      <g key={mn.generation} {...hits(setActive, click)}>
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

/** 반원 점 반지름(px)의 하한과 상한 */
const DOT_MIN = 1;
const DOT_MAX = 14;
/** 반원 가운데 이름 줄이 두 줄일 때 줄 간격(px) */
const CAP_LINE = 12.5;

/**
 * 낱말(대소문자 무시)로 견줘서 글에 이름과 값이 다 들어 있는지: "62 returning"은 "Returning"과 "62"를, "재구매 62명"은 "재구매"와 "62"를 다 말해요.
 * 낱말 뒤에 붙은 글(명, s)은 괜찮지만 숫자가 이어지면 다른 값이에요 ("620"은 "62"가 아니에요)
 */
function sameWords(text: string, name: string, value: string): boolean {
  const words = text.toLocaleLowerCase().split(/[\s,;:()]+/);
  const has = (s: string) => s.toLocaleLowerCase().split(/\s+/).every((w) => words.some((x) => x.startsWith(w) && !/^[\d.,]/.test(x.slice(w.length))));
  return name.trim() !== "" && value !== "" && has(name) && has(value);
}

/**
 * 이름을 낱말 사이에서 두 줄로 나눠요. 윗줄은 upRoom, 값을 붙인 아랫줄은 room 안에 들어가야 하고, 윗줄이 가장 긴 나눔을 골라요. 안 되면 null
 */
function splitName(name: string, value: string, upRoom: number, room: number, size: number): string[] | null {
  for (let i = name.lastIndexOf(" "); i > 0; i = name.lastIndexOf(" ", i - 1)) {
    const top = name.slice(0, i).trimEnd();
    const bottom = `${name.slice(i + 1).trimStart()} ${value}`.trim();
    if (textWidth(top, size, 700) <= upRoom && textWidth(bottom, size, 700) <= room) return [top, bottom];
  }
  return null;
}

/** 의석 차트: 점 하나가 한 단위인 반원. 묶음은 왼쪽부터 각도 순서로 채워 부채꼴이 되고, 전체가 합보다 크면 남는 자리는 빈 점이에요 */
function WaffleArc<T = Row>(props: WaffleChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(150, Math.min(340, w * 0.5 + 30)), duration: 520, stagger: 7 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];

  const model = useMemo(() => {
    const gl = strGetter(props.label, "label");
    const gv = numGetter(props.value, "value");
    const rows = props.data.map((d, i) => {
      const v = gv(d, i);
      return { d, label: gl(d, i), value: Number.isFinite(v) ? Math.max(0, v) : 0 };
    });
    const hi = resolveHighlight(props.highlight, rows.map((r) => r.d), rows.map((r) => r.label), rows.map((r) => r.value), "first");
    const s = sum(rows.map((r) => r.value));
    // 전체가 합보다 작거나 0 이하, 숫자가 아니면 합을 써요 (validateSpec이 알려요)
    const given = typeof props.total === "number" && Number.isFinite(props.total) && props.total > 0 && props.total >= s ? props.total : undefined;
    const total = given ?? s;
    const units = total > 0 ? Math.max(1, Math.round(total)) : 0;
    const dots = Math.min(units, ARC_MAX_DOTS);
    // 격자와 같은 칸 나누기라 같은 데이터면 단위 수가 같아요
    const counts = allocateCells(rows.map((r) => r.value), dots, given);
    const refs = total > 0 && Array.isArray(props.referenceLines) ? props.referenceLines.filter((r) => typeof r?.value === "number" && r.value >= 0 && r.value <= total) : [];
    return { rows, hi, counts, owner: ownerOf(counts), total, empty: total - s, units, dots, refs };
  }, [props.data, props.label, props.value, props.highlight, props.total, props.referenceLines]);

  const { dots, refs, owner, counts } = model;
  // 배치는 점 수만 따라요 (강조나 기준선이 바뀌어도 다시 놓지 않아요)
  const layout = useMemo(() => arcSeats(dots), [dots]);
  const colors = useMemo(() => categorical(p, model.rows.length, model.hi), [p, model]);
  const k = 0.4 * layout.gap;
  const labelRoom = refs.length ? 20 : 2;
  // 점이 너무 커지지 않게 적은 수는 작은 반원으로 (점 사이를 띄우고 가운데 글자가 들어갈 만큼은 남겨요)
  const R = Math.max(8, Math.min((W - 4) / 2 / (1 + k), (H - labelRoom - 4) / (1 + 2 * k), Math.max(90, (1.5 * DOT_MAX) / k)));
  const dotR = Math.max(DOT_MIN, Math.min(DOT_MAX, k * R));
  const cx = W / 2;
  const cy = (H + labelRoom + R) / 2;
  const pos = useMemo(() => layout.seats.map((s) => polar(cx, cy, s.r * R, s.a)), [layout, cx, cy, R]);
  const inner = (layout.rows === 1 ? 1 : ARC_INNER) * R;

  const stagger = Math.min(c.motion.stagger ?? 7, 700 / Math.max(1, dots));
  const cellMs = c.motion.duration ?? 520;
  const numMarks = useMemo<Mark<null>[]>(() => [{ key: "__n", to: [model.total], from: [0], delay: 100, data: null }], [model.total]);
  const mn = useMotion(numMarks, { ...c.motion, duration: cellMs + dots * stagger * 0.8 });
  const { active, via, setActive, click } = c;
  const enabled = useCssEntrance(c, mn);
  const ring = Math.min(1.5, dotR * 0.5);
  // 점은 묶음마다 <g>에 담아요. 흐리게, 초점 고리는 묶음 <g>에 걸어서 올릴 때 점 3,000개를 다시 만들지 않아요. 빈자리는 속이 빈 고리예요
  const dotNodes = useMemo(() => {
    const dot = (idx: number, g: number) => {
      const [x, y] = pos[idx];
      return <circle key={idx} className="ztd-mark ztd-pop" data-k={g} cx={x} cy={y} r={g < 0 ? Math.max(0.5, dotR - ring / 2) : dotR} fill={g < 0 ? "none" : colors[g].fill} stroke={g < 0 ? p.paint("line2") : undefined} strokeWidth={g < 0 ? ring : undefined} style={cssEntrance(enabled, mn.waiting, "pop", idx * stagger, cellMs)} />;
    };
    let at = 0;
    const groups = counts.map((n, g) => Array.from({ length: n }, () => dot(at++, g)));
    return { groups, rest: pos.slice(at).map((_, j) => dot(at + j, -1)) };
    // mn.waiting과 세대가 바뀔 때만 다시 만들어요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, counts, dotR, ring, colors, p, enabled, mn.waiting, mn.generation, stagger, cellMs]);
  const dotLayer = useMemo(
    () => (
      <g key={mn.generation} {...hits(setActive, click)}>
        {dotNodes.groups.map((els, g) => (
          <g key={g} opacity={active !== null && active !== g ? 0.38 : undefined} stroke={active === g && via === "keyboard" ? p.paint("ink") : undefined} strokeWidth={active === g && via === "keyboard" ? ring : undefined}>
            {els}
          </g>
        ))}
        {dotNodes.rest}
      </g>
    ),
    [dotNodes, mn.generation, setActive, click, active, via, p, ring],
  );

  const refName = (r: { value: number; label?: string }) => r.label ?? c.fv(r.value);
  const lead = refs[0];
  const gapText = (v: number) => {
    if (!lead) return "";
    const d = lead.value - v;
    return d > 0 ? msg.short(c.fv(d), refName(lead)) : d < 0 ? msg.over(c.fv(-d), refName(lead)) : msg.at(refName(lead));
  };
  const share = (v: number) => (model.total > 0 ? (v / model.total) * 100 : 0);

  const events: ChartEvent<T>[] = model.rows.map((r, i) => ({
    datum: r.d,
    index: i,
    key: r.label,
    label: r.label,
    value: r.value,
    formatted: `${msg.ofTotal(c.fv(r.value), c.fv(model.total))} · ${c.pct(share(r.value))}`,
  }));

  let tip: TooltipData | null = null;
  const ar = model.rows[active ?? -1];
  if (active !== null && ar) {
    const start = owner.indexOf(active);
    const [tx, ty] = start >= 0 ? pos[start + Math.floor(counts[active] / 2)] : [cx, cy - R];
    tip = { x: tx, y: ty - dotR, title: ar.label, rows: [{ label: c.t.value, value: c.fv(ar.value), color: colors[active].fill }, { label: msg.share, value: c.pct(share(ar.value)) }, ...(lead ? [{ label: gapText(ar.value), value: "" }] : [])] };
  }
  // 낭독: "Party A, 128 of 300, 43%" 뒤에 첫 기준선까지 거리
  const announce = via === "keyboard" && ar ? [ar.label, msg.ofTotal(c.fv(ar.value), c.fv(model.total)), c.pct(share(ar.value)), gapText(ar.value)].filter(Boolean).join(", ") : "";
  const desc =
    props.description ??
    `${msg.arcKind}. ${msg.total(c.fv(model.total))}: ${model.rows.map((r) => `${r.label} ${c.fv(r.value)}`).join(", ")}${model.empty > 0 ? `, ${msg.empty(c.fv(model.empty))}` : ""}.${refs.length ? ` ${msg.refs(refs.map(refName).join(", "))}` : ""}${model.units > dots ? ` ${msg.perDot(c.fmt(model.units / dots))}` : ""}`;

  // 가운데 글자: 큰 숫자는 전체, 아래는 고른(없으면 강조한) 묶음과 그 값. 격자처럼 summaryLabel은 강조한 묶음의 이름을 바꿔요
  const focus = active ?? [...model.hi][0] ?? -1;
  const fr = model.rows[focus];
  const hole = inner - dotR - 4;
  const capNum = fr ? c.fmt(fr.value) : "";
  const capName = fr ? (active === null ? (props.summaryLabel ?? fr.label) : fr.label) : "";
  let note = props.summaryNote ?? "";
  // 고른 묶음 줄이 아래 글과 같은 말이면(아래 글에 그 이름과 값이 다 있으면) 한 번만 적어요: "Returning 62"와 "62 returning"
  if (active !== null && fr && note && sameWords(note, fr.label, capNum)) note = "";
  const totalText = c.fmt(model.total);
  // 올라가는 동안은 정수로, 끝나면 전체 그대로
  const shownTotal = mn.get("__n")?.[0] ?? model.total;
  // 맨 아랫줄 글자가 반원 바닥(cy) 위에 오게 아래에서부터 쌓아요. 구멍에 큰 숫자가 12px도 안 들어가면 둘째 줄, 그다음 아래 글을 빼고, 그래도 안 되면 가운데 글자를 모두 빼요
  const capY = () => (note ? cy - 23 : cy - 11);
  // 이름과 값 줄: 한 줄(12.5px), 한 단계 작은 한 줄(11.5px), 이름을 낱말에서 나눈 두 줄(값은 둘째 줄 끝) 순서로 맞추고, 그래도 안 되면 마지막에 이름을 줄여요
  let capSize = 12.5;
  let caption: string[] = [];
  let noteBelow = "";
  const capTop = () => capY() - (caption.length - 1) * CAP_LINE;
  const fit = (): [number, number] => {
    const lowest = caption.length ? capTop() : note ? cy - 8 : cy + 2;
    const m = Math.min(40, hole * 0.5, hole * 0.92 - (cy - lowest) - 9);
    return [lowest, Math.round(Math.min(m, (m * hole * 1.6) / Math.max(1, textWidth(totalText, m, 800))) * 10) / 10];
  };
  if (fr) {
    const room = hole * 1.8;
    const full = capName ? `${capName} ${capNum}` : capNum;
    const one = [12.5, 11.5].find((s) => textWidth(full, s, 700) <= room);
    if (one !== undefined) [caption, capSize] = [[full], one];
    else {
      capSize = 11.5;
      const keptNote = note;
      // 두 줄이면 아래 글은 반원 바닥 밑 빈칸(맨 아랫줄 두 점 사이)으로 내려요. 그 자리가 없으면 구멍에 둔 채로 맞춰 봐요
      if (note && H - cy >= 14 && textWidth(note, 11) <= 2 * (inner - dotR) - 8) [noteBelow, note] = [note, ""];
      // 윗줄은 구멍이 좁아지는 높이라 그 높이의 현 길이까지만 써요
      const upDy = cy - (capY() - CAP_LINE) + capSize * 0.8;
      const upRoom = Math.min(room, 2 * Math.sqrt(Math.max(0, hole * hole - upDy * upDy)));
      const split = splitName(capName, capNum, upRoom, room, capSize);
      if (split) caption = split;
      if (!split || fit()[1] < 12) {
        [note, noteBelow] = [keptNote, ""];
        // summaryLabel이 안 들어가면 범례와 같은 묶음 이름으로 ("New customers 38" 대신 "New 38"), 그것도 안 되면 줄여요
        const own = [fr.label, capNum].filter(Boolean).join(" ");
        caption = [capName !== fr.label && textWidth(own, capSize, 700) <= room ? own : [truncateBeside(capName, capNum, room, capSize, 700), capNum].filter(Boolean).join(" ")];
      }
    }
  }
  if (fit()[1] < 12) note = "";
  if (fit()[1] < 12) caption = [];
  const [lowest, big] = fit();
  const summary = props.summary !== false && dots > 0 && big >= 12;

  // 기준선: 앞에서 value 단위째 점과 다음 점 사이의 각도 (점 하나가 여러 단위면 점 수로 바꿔요). 0과 전체에 놓인 선은 맨 아랫줄 바로 밑에 가로로 그어요.
  // 글자는 선 바깥 끝에, 옆자리가 모자라면 반원 위 띠로 옮기고, 앞 기준선 글자와 겹치면 빼요
  const boxes: Box[] = [];
  const refMarks = refs.map((r) => {
    const at = Math.round((r.value * dots) / Math.max(1, model.units));
    const edge = at <= 0 ? -1 : at >= dots ? 1 : 0;
    const a = edge ? (edge * Math.PI) / 2 : (layout.seats[at - 1].a + layout.seats[at].a) / 2;
    const dy = edge ? dotR + 1.5 : 0;
    const [x0, y0] = polar(cx, cy, Math.max(0, inner - dotR - 1), a);
    const [x1, y1] = polar(cx, cy, R + dotR + 4, a);
    const [lx, ly] = polar(cx, cy, R + dotR + 7, a);
    const full = refName(r);
    const s = Math.sin(a);
    let anchor: "start" | "end" | "middle" = s > 0.4 ? "start" : s < -0.4 ? "end" : "middle";
    let x = lx + (anchor === "start" ? 2 : anchor === "end" ? -2 : 0);
    let y = anchor === "middle" ? ly - 6 : ly + dy;
    let room = anchor === "start" ? W - x - 2 : anchor === "end" ? x - 2 : 2 * Math.min(x, W - x) - 4;
    const tw = textWidth(full, 11.5, 700);
    if (tw > room && !edge) {
      anchor = "middle";
      x = Math.max(tw / 2 + 2, Math.min(W - tw / 2 - 2, lx));
      y = cy - R - dotR - 11;
      room = W - 4;
    }
    const text = truncate(full, room, 11.5, 700);
    const box = labelBox(text, x, y, 11.5, anchor, 700);
    const free = text !== "" && !boxes.some((b) => overlaps(box, b, 3));
    if (free) boxes.push(box);
    return { line: [x0, y0 + dy, x1, y1 + dy], text: free ? text : "", x, y, anchor };
  });

  return (
    <ChartFrame c={c} kind={msg.arcKind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} announce={announce} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      {dotLayer}
      {refMarks.map((m, i) => (
        <g key={i} opacity={mn.fade(250, 300)}>
          <line x1={m.line[0]} y1={m.line[1]} x2={m.line[2]} y2={m.line[3]} stroke={p.paint("ink")} strokeWidth={1.25} strokeDasharray="3 3" />
          {m.text ? (
            <Txt x={m.x} y={m.y} anchor={m.anchor} size={11.5} weight={700} fill={p.paint("ink")}>
              {m.text}
            </Txt>
          ) : null}
        </g>
      ))}
      {summary ? (
        <g opacity={mn.fade(250, 300)}>
          <Txt x={cx} y={lowest - 9 - big * 0.5} anchor="middle" size={big} weight={800} fill={p.paint("ink")} letterSpacing={-0.4}>
            {shownTotal === model.total ? totalText : c.fmt(Math.round(shownTotal))}
          </Txt>
          {caption.map((line, i) => (
            <Txt key={i} x={cx} y={capTop() + i * CAP_LINE} anchor="middle" size={capSize} weight={700} fill={p.paint(colors[focus]?.role === "accent" ? "accentText" : "ink")}>
              {line}
            </Txt>
          ))}
          {note ? (
            <Txt x={cx} y={cy - 8} anchor="middle" size={11} fill={p.paint("muted")}>
              {truncate(note, hole * 1.9, 11)}
            </Txt>
          ) : null}
          {noteBelow ? (
            <Txt x={cx} y={cy + 12} anchor="middle" size={11} fill={p.paint("muted")}>
              {noteBelow}
            </Txt>
          ) : null}
        </g>
      ) : null}
    </ChartFrame>
  );
}
