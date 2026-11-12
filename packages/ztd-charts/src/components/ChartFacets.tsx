import { useContext, useId, useMemo, type ComponentType, type CSSProperties } from "react";
import { CardTitleContext } from "../core/cardTitle";
// Panels are always charts that use ChartFrame, so reusing its hidden style adds nothing to the bundle
import { SR_ONLY } from "../core/ChartFrame";
import { cssEntrance, useCssEntrance } from "../core/css";
import { isBrowser } from "../core/env";
import { FACET_GAP, FACET_LEGEND_H, FACET_ROW_GAP, FACET_TITLE_H, FACET_TITLE_SIZE, planFacets, type FacetPlan, type FacetScale, type FacetType } from "../core/facet";
import { useHydrated, useMeasuredNode, useReducedMotion } from "../core/hooks";
import { langOf } from "../core/i18n";
import type { Highlight, Row } from "../core/types";
import { useChartLocale, useChartTheme } from "../theme/context";

/** Interval and duration (ms) of the panels appearing in turn */
const STAGGER = 60;
const FADE_MS = 420;

export interface ChartFacetsProps<T = Row> {
  /**
   * Chart component to draw in each panel: LineChart, AreaChart, BarChart, ScatterChart.
   * The component is passed directly, so charts you do not use stay out of the bundle
   */
  chart: ComponentType<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** The kind of chart. Used to compute the shared value axis with the same rules as the chart (stacking, including 0) */
  type: FacetType;
  /** Rows for all panels. Split by the by value */
  data: readonly T[];
  /** Field that splits the panels. One panel per value in order of first appearance, up to 24 */
  by: string;
  /** Maximum panels per row. When omitted, as many as fit at a panel width of 140px or more. Spread evenly so the last row is not left with a lone panel */
  columns?: number;
  /** "shared" (default): every panel uses the same value axis (and the same date or numeric x), with value-axis labels only in the left column and x labels only in the bottom row. "free": each panel fits its own data and draws all axis labels */
  scale?: FacetScale;
  /** Chart props passed to every panel (x, y, series, format, unit, curve …). data, width, height, highlight, syncId and ariaLabel are set per panel */
  chartProps?: Record<string, unknown>;
  /** A by value (or an array of by values) gives only those panels the accent color and the rest neutral gray. Other values are passed to every panel as is */
  highlight?: Highlight<T>;
  /** Name that links the panels. When omitted, a stable name derived from the data and channels (every panel shows the hovered x together) */
  syncId?: string;
  /** Total width (px). Fits the parent width when omitted */
  width?: number;
  /** Height of one panel (px). When omitted, 120~180px based on the panel width */
  height?: number;
  /** First part of each panel's name: "<title>, <value>". When omitted, the title of the enclosing ChartCard */
  title?: string;
  /** Description of the group (screen readers). When omitted, one sentence is built from the panels */
  description?: string;
  /** Locale of the title row values and the description. When omitted, chartProps.locale, then ThemeProvider */
  locale?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Small multiples: draws the same chart once per by value, one cell each, in a grid. Shared value axis, one linked hovered x, highlight per panel.
 * Each panel is a full chart with keyboard navigation, a live region and a hidden table, and Tab moves in reading order (left to right, top to bottom).
 * Example: <ChartCard title="Weekly orders"><ChartFacets chart={LineChart} type="line" data={rows} by="region" chartProps={{ x: "week", y: "orders" }} highlight="West" /></ChartCard>
 */
export function ChartFacets<T = Row>(props: ChartFacetsProps<T>) {
  const p = useChartTheme();
  const cp = props.chartProps ?? {};
  const [, ref, measured] = useMeasuredNode<HTMLDivElement>(props.width);
  const width = props.width ?? (measured || 480);
  const locale = useChartLocale(props.locale ?? (cp.locale as string | undefined));
  const lang = langOf(locale);
  const cardTitle = useContext(CardTitleContext);
  const title = props.title ?? cardTitle;
  // The chart can set more panel props (the shared color scale of the hexbin density scatter: ScatterChart.facetPlan)
  const more = (props.chart as { facetPlan?: (plan: FacetPlan, cp: Record<string, unknown>, locale: string) => FacetPlan }).facetPlan;
  const plan = useMemo(
    () => {
      const base = planFacets({ type: props.type, data: props.data as readonly Row[], by: props.by, columns: props.columns, scale: props.scale, chartProps: cp, highlight: props.highlight as Highlight<Row> | undefined, syncId: props.syncId, width, height: props.height, title, locale, lang });
      return more ? more(base, cp, locale) : base;
    },
    // chartProps can be a new object on every render. The chart receives these values, so the plan is rebuilt when they change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.type, props.data, props.by, props.columns, props.scale, JSON.stringify(cp, (_, v) => (typeof v === "function" ? String(v) : v)), props.highlight, props.syncId, width, props.height, title, locale, lang, more],
  );
  const descId = `${useId().replace(/:/g, "")}fd`;
  // Panels appear in turn with the shared entrance (cssEntrance). With reduced motion, and on the first paint that hydrates the server render, they show their final state
  const reduced = useReducedMotion((cp.reducedMotion as "auto" | boolean | undefined) ?? "auto");
  const hydrated = useHydrated();
  const entrance = useCssEntrance({ motion: { enabled: cp.animate !== false && !reduced && isBrowser }, hydrated }, { waiting: false, generation: 0 });
  const Chart = props.chart;
  return (
    <div ref={ref} role="group" aria-label={title} aria-describedby={descId} className={props.className} style={{ position: "relative", width: "100%", ...props.style }}>
      <p id={descId} style={SR_ONLY}>
        {props.description ?? plan.description}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${plan.cols}, minmax(0, 1fr))`, columnGap: FACET_GAP, rowGap: FACET_ROW_GAP, ...(plan.legend ? { marginTop: FACET_LEGEND_H } : null) }}>
        {plan.panels.map((pn, i) => {
          const ink = p.paint(pn.isPicked ? "accentText" : plan.isPanelPick ? "muted" : "ink");
          return (
            <div key={pn.value} data-facet={pn.value} style={{ minWidth: 0, ...cssEntrance(entrance, false, "fade", i * STAGGER, FADE_MS) }}>
              {/* The panel name is part of the chart's name ("<title>, <value>"), so screen readers skip it */}
              <div aria-hidden="true" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, height: FACET_TITLE_H, fontSize: FACET_TITLE_SIZE, fontWeight: 700, lineHeight: `${FACET_TITLE_H}px`, color: ink }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pn.label}</span>
                {pn.last !== undefined ? <span style={{ flex: "none", fontVariantNumeric: "tabular-nums" }}>{pn.last}</span> : null}
              </div>
              <Chart {...cp} {...pn.props} />
            </div>
          );
        })}
      </div>
      {/* Legend shared by all panels: top right of the grid. Placed after the grid so the useId values of the panel charts (which match the server render) do not change */}
      {plan.legend ? (
        <div aria-hidden="true" style={{ position: "absolute", top: 0, right: 0, height: FACET_LEGEND_H }}>
          {plan.legend}
        </div>
      ) : null}
    </div>
  );
}
