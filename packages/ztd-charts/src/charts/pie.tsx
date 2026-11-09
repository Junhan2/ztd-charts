import { useMemo } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { arcPath, polar, sum, TAU } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { categorical, emphasis, type Swatch } from "../core/palette";
import { dodgeVertical, textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter } from "../data/accessor";
import { langOf, plural, type ChartLang } from "../core/i18n";
import { useChartLocale } from "../theme/context";

const en = {
  pie: "Pie chart",
  donut: "Donut chart",
  share: "Share",
  desc: (n: number, total: string, top: string) => `${plural(n, "item")}, total ${total}. ${top}.`,
  other: (n: number) => `Other (${n})`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: { pie: "파이 차트", donut: "도넛 차트", share: "비중", desc: (n, total, top) => `${n}개 항목, 합계 ${total}. ${top}.`, other: (n) => `기타 ${n}개` },
};

/** "기타" 조각 이름 (스펙 범례도 같은 이름을 써요) */
export const otherLabel = (lang: ChartLang, n: number) => MSG[lang].other(n);

/**
 * 큰 값 n개만 남기고(kept, 원래 순서) 나머지를 "기타" 한 조각(other)으로 묶어요. 기타는 맨 끝에 그리고 강조하지 않아요.
 * 묶을 조각이 둘 이상일 때만 묶어요(아니면 other는 null). make는 묶은 개수와 합으로 기타 조각을 만들어요
 */
export function groupOther<R extends { value: number }>(rows: R[], n: number | undefined, make: (count: number, value: number) => R): { kept: R[]; other: R | null } {
  if (typeof n !== "number" || !(n >= 1) || rows.length <= n + 1) return { kept: rows, other: null };
  const keep = new Set(
    rows
      .map((r, i) => ({ v: r.value, i }))
      .sort((a, b) => b.v - a.v)
      .slice(0, Math.floor(n))
      .map((x) => x.i),
  );
  const rest = rows.filter((_, i) => !keep.has(i));
  return { kept: rows.filter((_, i) => keep.has(i)), other: make(rest.length, sum(rest.map((r) => r.value))) };
}

/** 조각 값: 0보다 큰 유한한 수만. 음수, 0, NaN, Infinity는 0 (Infinity가 합계를 망가뜨려 NaN이 되지 않게) */
export const sliceValue = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

export interface PieChartProps<T = Row> extends BaseChartProps<T> {
  /** 항목 이름. 기본 "label" */
  label?: Accessor<T, string>;
  /** 값. 기본 "value" */
  value?: Accessor<T, number>;
  /** "categorical"이면 항목마다 다른 무채색, "emphasis"면 강조만 색. 기본 "categorical" */
  colorMode?: "categorical" | "emphasis";
  /** 큰 값부터 정렬. 기본 false */
  sort?: boolean;
  /** 시작 각도(도). 0이면 12시. 기본 0 */
  startAngle?: number;
  /** 조각 안 라벨: "percent" | "value" | "label" | "none". 기본 "percent" */
  labelMode?: "percent" | "value" | "label" | "none";
  /** 큰 조각 n개만 두고 나머지를 "기타" 한 조각으로 묶어요. 기타는 강조하지 않아요. 기본 묶지 않음 */
  other?: number;
}

export interface DonutChartProps<T = Row> extends PieChartProps<T> {
  /** 안쪽 반지름 비율(0~0.9). 기본 0.62 */
  innerRadius?: number;
  /** 가운데 숫자. "total"(기본) | "highlight" | 숫자 | null(숨김) */
  centerValue?: "total" | "highlight" | number | null;
  /** 가운데 숫자 아래 설명. 예: "전환(건)" */
  centerLabel?: string;
  /** 오른쪽 범례. "auto"는 폭이 넉넉하면 오른쪽, 좁으면 아래. 기본 "auto" */
  legend?: "auto" | "right" | "bottom" | "none";
}

interface Slice<T> {
  i: number;
  label: string;
  value: number;
  pct: number;
  a0: number;
  a1: number;
  sw: Swatch;
  hi: boolean;
  datum: T;
}

function useSlices<T>(props: PieChartProps<T>) {
  const { data } = props;
  const lang = langOf(useChartLocale(props.locale));
  return useMemo(() => {
    const gl = strGetter(props.label, "label");
    const gv = numGetter(props.value, "value");
    let rows = data.map((d, i) => ({ d, i, label: gl(d, i), value: sliceValue(gv(d, i)) }));
    if (props.sort) rows = [...rows].sort((a, b) => b.value - a.value);
    const lk = typeof props.label === "string" ? props.label : "label";
    const vk = typeof props.value === "string" ? props.value : "value";
    const { kept, other } = groupOther(rows, props.other, (n, value) => {
      const label = otherLabel(lang, n);
      return { d: { [lk]: label, [vk]: value } as T, i: -1, label, value };
    });
    const grouped = other ? [...kept, other] : kept;
    const total = sum(grouped.map((r) => r.value));
    // 기타 조각은 강조 후보에서 빼요 (가장 커도 강조색을 받지 않게)
    const hi = resolveHighlight(props.highlight, kept.map((r) => r.d), kept.map((r) => r.label), kept.map((r) => r.value), "max");
    return { rows: grouped, total, hi };
  }, [data, props.label, props.value, props.sort, props.highlight, props.other, lang]);
}

function PieBase<T>(props: DonutChartProps<T> & { inner: number }) {
  const isDonut = props.inner > 0;
  const { rows, total, hi } = useSlices(props);
  const modeAt = (w: number) => (isDonut ? (props.legend === undefined || props.legend === "auto" ? (w >= 300 ? "right" : "bottom") : props.legend) : "none");
  const bottomH = Math.ceil(rows.length / 2) * 20 + 8;
  // The default height grows by the bottom legend, so many slices do not squeeze the donut.
  const c = useChart(props, {
    height: (w) => (isDonut ? Math.max(170, Math.min(240, w * 0.5)) + (modeAt(w) === "bottom" ? bottomH : 0) : Math.max(180, Math.min(260, w * 0.62))),
    duration: 1000,
  });
  const { p, width: W, height: H } = c;
  const legendMode = modeAt(W);
  const legendH = legendMode === "bottom" ? bottomH : 0;
  const plotH = H - legendH;
  // Right-hand legend rows shrink to fit, so a long legend is not cut at the top and bottom.
  const legendRowH = Math.min(26, (plotH - 8) / Math.max(1, rows.length));
  const legendW = legendMode === "right" ? Math.min(220, Math.max(140, W * 0.44)) : 0;
  const plotW = W - legendW;
  const outsidePad = isDonut ? 4 : 20;
  const R = Math.max(10, Math.min(plotW, plotH) / 2 - outsidePad);
  const r0 = R * props.inner;
  // 가운데 설명이 구멍보다 넓으면 글자를 9.5px까지 줄여 보고, 그래도 넘치면 말줄임 ("Conversi…" 대신 "Conversions")
  const capSize = props.centerLabel ? Math.max(9.5, Math.min(11, (11 * r0 * 1.6) / textWidth(props.centerLabel, 11))) : 11;
  const cx = legendMode === "right" ? Math.max(R + outsidePad, plotW / 2 + 6) : W / 2;
  const cy = plotH / 2;
  const start = ((props.startAngle ?? 0) * Math.PI) / 180;

  const slices = useMemo(() => {
    const colors = props.colorMode === "emphasis" ? emphasis(p, rows.length, new Set(rows.map((r, k) => (hi.has(k) ? k : -1)).filter((k) => k >= 0))) : categorical(p, rows.length, hi);
    let acc = 0;
    return rows.map((r, k): Slice<T> => {
      const a = total > 0 ? (r.value / total) * TAU : 0;
      const s: Slice<T> = { i: k, label: r.label, value: r.value, pct: total > 0 ? (r.value / total) * 100 : 0, a0: acc, a1: acc + a, sw: colors[k], hi: hi.has(k), datum: r.d };
      acc += a;
      return s;
    });
  }, [rows, total, hi, p, props.colorMode]);

  const centerVal = isDonut ? centerNumber(props, slices, total) : 0;
  const marks = useMemo(() => {
    const ms: Mark<Slice<T> | null>[] = slices.map((s) => {
      const mid = (s.a0 + s.a1) / 2;
      return { key: `s:${s.label}`, to: [s.a0, s.a1], enter: [s.a0, s.a0], exit: [mid, mid], data: s };
    });
    ms.push({ key: "__sweep", to: [TAU], from: [0], data: null });
    if (isDonut) ms.push({ key: "__center", to: [centerVal], from: [0], data: null });
    return ms;
  }, [slices, isDonut, centerVal]);

  const m = useMotion(marks, { ...c.motion, stagger: 0 });
  const sweep = m.get("__sweep")?.[0] ?? TAU;
  const D = c.motion.duration ?? 1000;

  const items = m.items.filter((it) => it.data) as { key: string; v: number[]; data: Slice<T>; exiting: boolean }[];
  const events: ChartEvent<T>[] = slices.map((s) => ({
    datum: s.datum,
    index: s.i,
    key: s.label,
    label: s.label,
    value: s.value,
    formatted: `${c.pct(s.pct)} · ${c.fv(s.value)}`,
  }));

  const labelMode = props.labelMode ?? (isDonut ? "none" : "percent");
  const labelR = isDonut ? (r0 + R) / 2 : R * 0.62;

  // 바깥 라벨: 작은 조각은 원 밖으로. null이면 자리가 없어 라벨을 그리지 않아요
  const outside = useMemo(() => {
    const out = new Map<number, { x: number; y: number; anchor: "start" | "end" | "middle" } | null>();
    if (labelMode === "none" || !c.showLabels) return out;
    const list: { i: number; x: number; y: number; side: number }[] = [];
    slices.forEach((s) => {
      const text = sliceText(s, labelMode, c.fv, c.pct);
      const ang = s.a1 - s.a0;
      const fits = ang * labelR >= textWidth(text, 12.5, 700) + 10 && ang > 0.32;
      if (!fits && s.value > 0) {
        const mid = start + (s.a0 + s.a1) / 2;
        const [x, y] = polar(cx, cy, R + 12, mid);
        list.push({ i: s.i, x, y, side: Math.sin(mid) >= 0 ? 1 : -1 });
      }
    });
    // 한쪽에 15px 간격으로 들어가는 만큼만 큰 조각부터 남겨요. 넘치면 라벨이 위로 쌓여 카드 밖으로 나가 제목을 덮어요
    const gap = 15;
    const pad = 8;
    const room = Math.max(0, Math.floor((plotH - 2 * pad) / gap) + 1);
    for (const side of [1, -1]) {
      let group = list.filter((l) => l.side === side);
      if (group.length > room) {
        const keep = new Set([...group].sort((a, b) => slices[b.i].value - slices[a.i].value).slice(0, room).map((g) => g.i));
        for (const g of group) if (!keep.has(g.i)) out.set(g.i, null);
        group = group.filter((g) => keep.has(g.i));
      }
      const ys = dodgeVertical(
        group.map((g) => g.y),
        gap,
        pad,
        plotH - pad,
      );
      group.forEach((g, k) => {
        const nearTop = Math.abs(g.x - cx) < 14;
        out.set(g.i, { x: g.x, y: ys[k], anchor: nearTop ? "middle" : side > 0 ? "start" : "end" });
      });
    }
    return out;
  }, [slices, labelMode, c.showLabels, labelR, start, cx, cy, R, plotH, c.fv, c.pct]);

  const msg = MSG[c.lang];
  let tip: TooltipData | null = null;
  if (c.active !== null && slices[c.active]) {
    const s = slices[c.active];
    const [tx, ty] = polar(cx, cy, R * 0.9, start + (s.a0 + s.a1) / 2);
    tip = {
      x: tx,
      y: ty,
      title: s.label,
      rows: [
        { label: c.t.value, value: c.fv(s.value), color: s.sw.fill },
        { label: msg.share, value: c.pct(s.pct) },
      ],
    };
  }

  const center = m.get("__center")?.[0] ?? 0;
  const top = [...slices].sort((a, b) => b.value - a.value);
  const kind = isDonut ? msg.donut : msg.pie;
  const desc =
    props.description ??
    `${kind}. ${msg.desc(
      slices.length,
      c.fv(total),
      top
        .slice(0, 4)
        .map((s) => `${s.label} ${c.pct(s.pct)}`)
        .join(", "),
    )}`;

  return (
    <ChartFrame c={c} kind={kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      <g>
        {items.map((it) => {
          const s = it.data;
          const a0 = start + Math.min(it.v[0], sweep);
          const a1 = start + Math.min(it.v[1], sweep);
          const isActive = c.active === s.i;
          const mid = (a0 + a1) / 2;
          const off = isActive ? 5 : 0;
          const dx = Math.sin(mid) * off;
          const dy = -Math.cos(mid) * off;
          const d = arcPath(cx, cy, r0, R, a0, a1);
          if (!d) return null;
          return (
            <path
              key={it.key}
              className="ztd-mark"
              d={d}
              fill={s.sw.fill}
              stroke={p.paint("panel")}
              strokeWidth={slices.length > 1 ? 2 : 0}
              strokeLinejoin="round"
              opacity={it.exiting ? 0.6 : c.dim(s.i)}
              style={{ transform: `translate(${dx}px, ${dy}px)`, transition: "transform .2s ease, opacity .18s ease", cursor: props.onClick ? "pointer" : undefined }}
              onPointerEnter={(e) => c.setActive(s.i, e.pointerType === "touch" ? "touch" : "pointer")}
              onClick={() => c.click(s.i)}
            />
          );
        })}
        {c.active !== null && c.via === "keyboard" && slices[c.active] ? (
          <path d={arcPath(cx, cy, Math.max(0, r0 - 2), R + 3, start + slices[c.active].a0, start + slices[c.active].a1)} fill="none" stroke={p.paint("ink")} strokeWidth={2} pointerEvents="none" />
        ) : null}
      </g>
      {labelMode !== "none" && c.showLabels ? (
        <g>
          {slices.map((s) => {
            if (s.value <= 0) return null;
            const text = sliceText(s, labelMode, c.fv, c.pct);
            const mid = start + (s.a0 + s.a1) / 2;
            const o = m.fade(D * 0.35 + (s.a0 / TAU) * D * 0.5, 260) * c.dim(s.i);
            const out = outside.get(s.i);
            if (out === null) return null;
            if (out) {
              return (
                <Txt key={s.i} x={out.x} y={out.y} anchor={out.anchor} size={12} weight={700} fill={p.paint("ink")} opacity={o}>
                  {truncate(text, out.anchor === "start" ? W - out.x - 4 : out.anchor === "end" ? out.x - 4 : W, 12, 700)}
                </Txt>
              );
            }
            const [x, y] = polar(cx, cy, labelR, mid);
            return (
              <Txt key={s.i} x={x} y={y} anchor="middle" size={13} weight={700} fill={s.sw.text} opacity={o}>
                {text}
              </Txt>
            );
          })}
        </g>
      ) : null}
      {isDonut && props.centerValue !== null ? (
        <g opacity={m.fade(0, 200)}>
          <Txt x={cx} y={cy - (props.centerLabel ? 7 : 0)} anchor="middle" size={Math.max(15, Math.min(26, r0 * 0.42))} weight={800} fill={p.paint("ink")} letterSpacing={-0.4}>
            {c.fmt(Math.round(center))}
          </Txt>
          {props.centerLabel ? (
            <Txt x={cx} y={cy + Math.max(11, Math.min(17, r0 * 0.3))} anchor="middle" size={capSize} fill={p.paint("muted")}>
              {truncate(props.centerLabel, r0 * 1.6, capSize)}
            </Txt>
          ) : null}
        </g>
      ) : null}
      {legendMode === "right" || legendMode === "bottom" ? (
        <g>
          {slices.map((s, k) => {
            const right = legendMode === "right";
            // 아래 범례는 두 칸 사이를 20px 띄워요. 붙이면 왼쪽 칸 비중이 오른쪽 칸 색 상자에 닿아요
            const colW = right ? legendW - 12 : (W - 36) / 2;
            const lx = right ? plotW + 8 : 8 + (k % 2) * (colW + 20);
            const ly = right ? cy - ((slices.length - 1) * legendRowH) / 2 + k * legendRowH : plotH + 12 + Math.floor(k / 2) * 20;
            const o = m.fade(D * 0.25 + k * 90, 260) * c.dim(s.i);
            const pct = c.pct(s.pct);
            const nameMax = colW - 14 - textWidth(pct, 12, 700) - 10;
            return (
              <g key={s.i} opacity={o} onPointerEnter={() => c.setActive(s.i)} style={{ cursor: "default" }}>
                <rect x={lx} y={ly - 5} width={10} height={10} rx={2.5} fill={s.sw.fill} stroke={s.sw.role === "soft" || s.sw.role === "neutral" ? p.paint("line2") : "none"} />
                <Txt x={lx + 16} y={ly} size={12} weight={s.hi ? 700 : 500} fill={p.paint(s.hi ? "ink" : "muted")}>
                  {truncate(s.label, nameMax, 12, s.hi ? 700 : 500)}
                </Txt>
                <Txt x={lx + colW} y={ly} anchor="end" size={12} weight={s.hi ? 800 : 500} fill={p.paint(s.hi ? "ink" : "muted")}>
                  {pct}
                </Txt>
              </g>
            );
          })}
        </g>
      ) : null}
    </ChartFrame>
  );
}

function centerNumber<T>(props: DonutChartProps<T>, slices: Slice<T>[], total: number): number {
  const v = props.centerValue;
  if (typeof v === "number") return v;
  if (v === "highlight") return slices.find((s) => s.hi)?.value ?? total;
  return total;
}

function sliceText<T>(s: Slice<T>, mode: string, fv: (v: number) => string, pct: (v: number) => string): string {
  if (mode === "value") return fv(s.value);
  if (mode === "label") return s.label;
  return pct(s.pct);
}

/** 파이 차트: 2~4개 항목의 비중 */
export function PieChart<T = Row>(props: PieChartProps<T>) {
  return <PieBase {...props} inner={0} />;
}

/** 도넛 차트: 가운데에 합계를 보여주는 비중 차트 */
export function DonutChart<T = Row>(props: DonutChartProps<T>) {
  const inner = Math.max(0.2, Math.min(0.9, props.innerRadius ?? 0.62));
  return <PieBase {...props} inner={inner} />;
}
