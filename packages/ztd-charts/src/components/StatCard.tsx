import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Sparkline, type SparklineProps } from "../charts/sparkline";
import { changeRatio, signedPercent } from "../core/brush";
import { makeFormatter, withUnit, type FormatSpec } from "../core/format";
import { useReducedMotion } from "../core/hooks";
import { langOf } from "../core/i18n";
import { prepSeries } from "../core/series";
import type { Accessor, BaseChartProps, ChartEvent, Row } from "../core/types";
import { useChartLocale, useChartTheme } from "../theme/context";

export interface StatCardProps<T = Row> {
  /** 지표 이름. 예: "MRR". 카드 이름과 추세선 이름에도 써요 */
  label: string;
  /** 추이 데이터. 마지막 값이 큰 숫자가 돼요 */
  data: readonly T[];
  /** x 필드. 기본 "x" */
  x?: Accessor<T, unknown>;
  /** 값 필드. 기본 "y" */
  y?: Accessor<T, number>;
  /** 큰 숫자를 직접 적어요(예: "$482K"). 없으면 마지막 값을 format, unit으로 */
  value?: ReactNode;
  /** 변화 배지. 없으면 첫 값 대비 마지막 값의 변화율(예: "+6.2%"), null이면 배지를 숨겨요 */
  delta?: ReactNode;
  /** 늘수록 좋은 지표면 "up"(기본), 줄수록 좋으면 "down"(이탈률 등). 좋은 쪽으로 움직였을 때만 배지를 강조색으로 칠해요 */
  better?: "up" | "down";
  /** 숫자 아래 작은 글. 추세선을 짚는 동안에는 짚은 점의 x 이름표로 바뀌어요 */
  note?: ReactNode;
  format?: FormatSpec;
  unit?: string;
  locale?: string;
  theme?: BaseChartProps<T>["theme"];
  /** 추세선 모양. 기본 "area" */
  variant?: SparklineProps<T>["variant"];
  /** 추세선 높이(px). 기본 40 */
  sparkHeight?: number;
  reducedMotion?: "auto" | boolean;
  /** 바뀌면 추세선이 처음부터 다시 그려져요 */
  replayKey?: string | number;
  className?: string;
  style?: CSSProperties;
}

const TREND = { en: (label: string) => `${label}, trend`, ko: (label: string) => `${label} 추이` };

/**
 * 지표 카드: 큰 숫자, 변화 배지, 추세선. 추세선에 마우스를 올리거나 Tab으로 들어가 화살표로 옮기면
 * 큰 숫자가 그 점의 값으로, 아래 글이 그 점의 날짜로 바뀌어요 (점 값은 추세선이 화면 낭독기에 읽어 줘요)
 */
export function StatCard<T = Row>(props: StatCardProps<T>) {
  const p = useChartTheme(props.theme);
  const locale = useChartLocale(props.locale);
  const id = useId();
  const reduced = useReducedMotion(props.reducedMotion);
  const [at, setAt] = useState<ChartEvent<T> | null>(null);

  // 값이 있는 점만 (추세선과 같은 x 순서). 호버로 다시 그릴 때마다 거르지 않게 데이터가 바뀔 때만 만들어요
  const fin = useMemo(() => (prepSeries(props.data, props.x, props.y, undefined, { locale }).values[0] ?? []).filter(Number.isFinite), [props.data, props.x, props.y, locale]);
  const last = fin[fin.length - 1];
  const ratio = changeRatio(fin[0], last);
  const good = ratio !== null && (props.better === "down" ? ratio < 0 : ratio > 0);
  const delta = props.delta === undefined ? (ratio === null ? null : signedPercent(ratio, locale)) : props.delta;
  const shown = at && at.value !== null ? at.formatted : (props.value ?? withUnit(makeFormatter(props.format, locale), props.unit)(last));

  // 숫자가 바뀌면 살짝 올라오며 나타나요. 처음 그릴 때와 빠르게 훑는 동안(120ms 안에 다시 바뀌면)은 바로 바꿔요
  const numRef = useRef<HTMLSpanElement>(null);
  const lastSwap = useRef(Infinity);
  useEffect(() => {
    const t = performance.now();
    if (!reduced && t - lastSwap.current >= 120) numRef.current?.animate?.([{ opacity: 0.4, transform: "translateY(3px)" }, { opacity: 1, transform: "none" }], { duration: 180, easing: "cubic-bezier(.22,1,.36,1)" });
    lastSwap.current = t;
  }, [shown, reduced]);

  const muted = p.paint("muted");
  return (
    <section
      aria-labelledby={id}
      className={`ztd-card${props.className ? ` ${props.className}` : ""}`}
      style={{
        background: p.paint("panel"),
        color: p.paint("ink"),
        border: `1px solid ${p.paint("line")}`,
        borderRadius: `var(--ztd-radius, ${p.theme.radius}px)`,
        padding: "18px 20px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0,
        boxSizing: "border-box",
        fontFamily: p.cssVars ? `var(--ztd-font, ${p.theme.fontFamily})` : p.theme.fontFamily,
        // 한국어 아래 글이 낱말 가운데서 줄을 바꾸지 않게 (ChartCard와 같아요)
        wordBreak: "keep-all",
        ...props.style,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
        <h3 id={id} style={{ margin: 0, fontSize: 14, fontWeight: 600, color: muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {props.label}
        </h3>
        {delta !== null ? (
          <span style={{ flex: "none", borderRadius: 999, padding: "2px 8px", fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums", background: p.paint(good ? "tint" : "line"), color: p.paint(good ? "accentText" : "muted") }}>{delta}</span>
        ) : null}
      </header>
      <span ref={numRef} style={{ display: "block", fontSize: 28, fontWeight: 700, letterSpacing: -0.8, lineHeight: 1.15, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {shown}
      </span>
      <Sparkline data={props.data} x={props.x} y={props.y} variant={props.variant} height={props.sparkHeight ?? 40} showValue={false} tooltip={false} format={props.format} unit={props.unit} locale={props.locale} theme={props.theme} reducedMotion={props.reducedMotion} replayKey={props.replayKey} ariaLabel={TREND[langOf(locale)](props.label)} onHover={setAt} />
      {/* 아래 글 줄은 늘 자리를 잡아 둬요 (짚을 때 날짜가 들어와도 카드 높이가 그대로) */}
      <span style={{ fontSize: 12.5, color: muted, lineHeight: 1.4, minHeight: 17 }}>{at ? at.label : props.note}</span>
    </section>
  );
}
