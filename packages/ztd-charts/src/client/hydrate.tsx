import { createElement as h } from "react";
import { hydrateRoot } from "react-dom/client";
import { useSpecChart, type CHART_COMPONENTS } from "../charts/Chart";
import { useHydrated } from "../core/hooks";
import type { ChartSpec } from "../spec/types";
import { ThemeProvider } from "../theme/context";
import type { ChartTheme } from "../theme/tokens";

/**
 * Browser entry point for interactive HTML (CLI render --interactive). It is in no package entry point; the CLI bundles it with React for each chart.
 * Hydrates the server-drawn #chart in place with the config renderSpecToHTML wrote to #ztd-chart-config (no clear and redraw, so no flicker)
 */
interface ClientConfig {
  spec: ChartSpec;
  theme: ChartTheme;
  width?: number;
  height?: number;
  locale?: string;
}
type Components = typeof CHART_COMPONENTS;

/** The first paint matches the server (that width, no animation). After hydration the chart measures its own width and turns on animation without the entrance (replay, zoom, data changes) */
function Live({ cfg, components }: { cfg: ClientConfig; components: Components }) {
  const hydrated = useHydrated();
  return useSpecChart({ spec: cfg.spec, height: cfg.height, locale: cfg.locale, width: hydrated ? undefined : cfg.width, animate: hydrated ? undefined : false }, components);
}

export function hydrateChart(type: string, Comp: Components[string]): void {
  const text = document.getElementById("ztd-chart-config")?.textContent;
  const el = document.getElementById("chart");
  if (!text || !el) return;
  const cfg = JSON.parse(text) as ClientConfig;
  hydrateRoot(el, h(ThemeProvider, { theme: cfg.theme, cssVars: true }, h(Live, { cfg, components: { [type]: Comp } })));
}
