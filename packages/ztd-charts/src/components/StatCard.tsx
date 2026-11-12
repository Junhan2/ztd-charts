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
  /** Metric name. Example: "MRR". Also used for the card name and the sparkline name */
  label: string;
  /** Trend data. The last value becomes the big number */
  data: readonly T[];
  /** x field. Default "x" */
  x?: Accessor<T, unknown>;
  /** Value field. Default "y" */
  y?: Accessor<T, number>;
  /** Sets the big number directly (for example "$482K"). When omitted, the last value with format and unit */
  value?: ReactNode;
  /** Change badge. When omitted, the change rate from the first value to the last (for example "+6.2%"); null hides the badge */
  delta?: ReactNode;
  /** "up" (default) for a metric where higher is better, "down" where lower is better (churn rate and the like). The badge gets the accent color only when the move is in the good direction */
  better?: "up" | "down";
  /** Small text under the number. While the sparkline is hovered, it changes to the x label of the hovered point */
  note?: ReactNode;
  format?: FormatSpec;
  unit?: string;
  locale?: string;
  theme?: BaseChartProps<T>["theme"];
  /** Sparkline style. Default "area" */
  variant?: SparklineProps<T>["variant"];
  /** Sparkline height (px). Default 40 */
  sparkHeight?: number;
  reducedMotion?: "auto" | boolean;
  /** When it changes, the sparkline redraws from the start */
  replayKey?: string | number;
  className?: string;
  style?: CSSProperties;
}

const TREND = { en: (label: string) => `${label}, trend`, ko: (label: string) => `${label} 추이` };

/**
 * Metric card: big number, change badge, sparkline. Hovering the sparkline, or tabbing into it and moving with the arrow keys,
 * changes the big number to that point's value and the text below to that point's date (the sparkline reads point values to screen readers)
 */
export function StatCard<T = Row>(props: StatCardProps<T>) {
  const p = useChartTheme(props.theme);
  const locale = useChartLocale(props.locale);
  const id = useId();
  const reduced = useReducedMotion(props.reducedMotion);
  const [at, setAt] = useState<ChartEvent<T> | null>(null);

  // Only points with a value (same x order as the sparkline). Built only when the data changes, so hover rerenders do not filter again
  const fin = useMemo(() => (prepSeries(props.data, props.x, props.y, undefined, { locale }).values[0] ?? []).filter(Number.isFinite), [props.data, props.x, props.y, locale]);
  const last = fin[fin.length - 1];
  const ratio = changeRatio(fin[0], last);
  const good = ratio !== null && (props.better === "down" ? ratio < 0 : ratio > 0);
  const delta = props.delta === undefined ? (ratio === null ? null : signedPercent(ratio, locale)) : props.delta;
  const shown = at && at.value !== null ? at.formatted : (props.value ?? withUnit(makeFormatter(props.format, locale), props.unit)(last));

  // A changed number slides up slightly as it appears. On first render and while scrubbing quickly (another change within 120ms), it swaps instantly
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
        // Keeps Korean text below from breaking mid-word (same as ChartCard)
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
      {/* The text line below always keeps its space (the card height stays the same when a date appears on hover) */}
      <span style={{ fontSize: 12.5, color: muted, lineHeight: 1.4, minHeight: 17 }}>{at ? at.label : props.note}</span>
    </section>
  );
}
