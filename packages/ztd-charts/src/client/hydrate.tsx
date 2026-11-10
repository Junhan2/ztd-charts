import { createElement as h } from "react";
import { hydrateRoot } from "react-dom/client";
import { useSpecChart, type CHART_COMPONENTS } from "../charts/Chart";
import { useHydrated } from "../core/hooks";
import type { ChartSpec } from "../spec/types";
import { ThemeProvider } from "../theme/context";
import type { ChartTheme } from "../theme/tokens";

/**
 * 대화형 HTML(CLI render --interactive)의 브라우저 시작점. 패키지 입구 어디에도 없고, CLI가 차트마다 React와 함께 묶어요.
 * renderSpecToHTML이 #ztd-chart-config에 적은 설정으로 서버가 그린 #chart를 그대로 이어받아요 (지우고 다시 그리지 않아 깜빡이지 않아요)
 */
interface ClientConfig {
  spec: ChartSpec;
  theme: ChartTheme;
  width?: number;
  height?: number;
  locale?: string;
}
type Components = typeof CHART_COMPONENTS;

/** 첫 그림은 서버와 같게(그 폭, 애니메이션 없이). 이어받은 뒤에는 차트가 자기 폭을 재고, 등장 없이 애니메이션을 켜요(다시 재생, 확대, 데이터 바뀜) */
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
