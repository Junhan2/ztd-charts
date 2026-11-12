import type { CSSProperties, ReactNode } from "react";
import type { ChartTheme } from "../theme/tokens";
import type { FormatSpec } from "./format";
import type { EasingName } from "./motion";

/** A field name (dot notation allowed) or a function */
export type Accessor<T, R = unknown> = string | ((d: T, i: number) => R);

/**
 * Items to highlight.
 * A number (index), a string (label), an array, "max" | "min" | "first" | "last" | "none", or a predicate function
 */
export type Highlight<T = unknown> = number | string | ReadonlyArray<number | string> | ((d: T, i: number) => boolean);

export interface ChartEvent<T = unknown> {
  /** The original data item. null for totals or computed items */
  datum: T | null;
  /** Position in the order the chart lays items out. In charts that sort by value (lollipop, Pareto, bar with sort on), it differs from the row number in data. Read the original row from datum */
  index: number;
  key: string;
  label: string;
  value: number | null;
  series?: string;
  /** Display value */
  formatted?: string;
}

export interface TooltipRow {
  label?: string;
  /** Value shown in bold. A range band passes the value followed by faint range text */
  value: ReactNode;
  /** Fill color (a CSS color) */
  color?: string;
  strong?: boolean;
}

export interface TooltipData {
  x: number;
  y: number;
  title: string;
  rows: TooltipRow[];
}

export interface AnimationProps {
  /** Entrance and transition animation. Default true */
  animate?: boolean;
  /** Duration (ms). Default 900 */
  duration?: number;
  /** Default "spring" */
  easing?: EasingName;
  /** Delay between items (ms). The default differs per chart */
  stagger?: number;
  /** Replays from the start when this changes */
  replayKey?: string | number;
  /** "auto" follows the OS reduced-motion setting. true always turns motion off, false always keeps it on. Default "auto" */
  reducedMotion?: "auto" | boolean;
  /** Plays when the chart enters the screen. false plays right on mount. Default true */
  animateOnView?: boolean;
}

export interface BaseChartProps<T = Record<string, unknown>> extends AnimationProps {
  /** Array of objects */
  data: readonly T[];
  /** Fixed width (px). Without it, the chart fits its parent's width */
  width?: number;
  /** Height (px) */
  height?: number;
  /** Items to highlight. The default differs per chart (usually the largest value) */
  highlight?: Highlight<T>;
  /** Called when the hover or keyboard focus changes */
  onHover?: (e: ChartEvent<T> | null) => void;
  /** Click, Enter, Space */
  onClick?: (e: ChartEvent<T>) => void;
  /** Tooltip. false turns it off; a function renders its content. Default true */
  tooltip?: boolean | ((e: ChartEvent<T>) => ReactNode);
  /** Shows value labels. Default true */
  showLabels?: boolean;
  /** Name for screen readers */
  ariaLabel?: string;
  /** Description for screen readers. Generated from the data when absent */
  description?: string;
  /** Value format: "number" | "integer" | "percent" | "ratio" | "compact" | "currency" | Intl options | a function */
  format?: FormatSpec;
  /** Unit appended to values, e.g. "%", "K", "명" (people) */
  unit?: string;
  /**
   * Locale for number and date formats and for chart text (tooltips, screen reader sentences). "ko" or "ko-*" gives Korean (1.2만), anything else English (1.2K).
   * Without it, the ThemeProvider's locale; without that, "en-US"
   */
  locale?: string;
  /** Overrides theme tokens for this chart only */
  theme?: Partial<ChartTheme>;
  /** Charts with the same name show the pointed x together (comparing the same date across a dashboard). ChartGrid's sync links charts too */
  syncId?: string;
  className?: string;
  style?: CSSProperties;
}

export type Row = Record<string, unknown>;
