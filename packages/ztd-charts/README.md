# ztd charts

Animated, accessible React charts that read like a report. 36 charts in pure SVG with no runtime dependencies, and a JSON spec your AI agent can write.

[Website](https://charts.ztd.app) · [Gallery](https://charts.ztd.app/docs/) · [Docs](https://charts.ztd.app/docs/docs/) · [Example dashboards](https://charts.ztd.app/docs/examples/) · [GitHub](https://github.com/Junhan2/ztd-charts) · [한국어](https://github.com/Junhan2/ztd-charts/blob/main/README.ko.md)

![A dashboard built with ztd charts in the light theme: active users, visit to purchase, conversions, quarterly revenue, viewing hours and share price](https://raw.githubusercontent.com/Junhan2/ztd-charts/main/docs/readme/hero-en.png)

## Why ztd charts

- **Each card says one thing.** One item takes the accent color and the rest stay neutral, with a bold takeaway under the chart, so a reader sees the point before reading the axes.
- **Motion that explains.** Charts draw in as they scroll into view, move on from where they are when the data changes, and let you drag over a range to read its change, high and low.
- **Accessible by default.** Keyboard navigation, a screen reader description and data table for every chart, reduced motion, and every label at WCAG AA contrast.
- **Small, with nothing else to install.** React is the only peer dependency. A chart with the shared core is about 12 to 25 kB Brotli, and very large data switches to canvas on its own.
- **Ready for AI.** Every chart is also a JSON spec with a public JSON Schema, and a CLI, an MCP server and an agent skill validate it and render it to PNG, SVG or HTML.
- **English and Korean.** en-US by default. `locale="ko-KR"` switches number formats (1.2만, 3.4억) and chart text to Korean.

![Two cards drawing in, the bar chart moving to new data from where it is, and a drag over the candlestick chart showing the change, high and low for that range](https://raw.githubusercontent.com/Junhan2/ztd-charts/main/docs/readme/motion-en.gif)

## Quick start

```bash
npm i ztd-charts
```

```tsx
import { ChartCard, PieChart } from "ztd-charts";

const sales = [
  { device: "Mobile", share: 72 },
  { device: "Desktop", share: 23 },
  { device: "Tablet", share: 5 },
];

export function SalesByDevice() {
  return (
    <ChartCard title="Sales by device" subtitle="Share of revenue (%)" takeaway="Mobile brings in most sales">
      <PieChart data={sales} label="device" value="share" highlight="Mobile" />
    </ChartCard>
  );
}
```

Every chart page in the [gallery](https://charts.ztd.app/docs/) has the React code, the JSON spec and the CLI command for that chart.

## What's in the package

- `ztd-charts`: 36 chart components, `LiveLineChart`, `ChartCard`, `ChartGrid`, `StatCard`, `ThemeProvider` and the data helpers.
- `ztd-charts/spec`: the chart registry, JSON Schema, spec validation and chart suggestions, without React.
- `ztd-charts/server`: server rendering to SVG and HTML.
- `ztd-charts/schema.json`: the JSON Schema for chart specs.

Data helpers: `useChartData` loads a URL or an async function and reports loading, error and empty states. `parseCSV`, `fromRows`, `fromObjects` and `melt` reshape tables. `percentiles(rows, { by: "minute", value: "ms" })` turns raw samples into `p50`, `p95` and `p99` rows for a latency chart.

ESM with `sideEffects: false`, so only the charts you import end up in your bundle.

## Related packages

- [ztd-charts-cli](https://www.npmjs.com/package/ztd-charts-cli): validate specs and render them to PNG, SVG or HTML from the terminal.
- [ztd-charts-mcp](https://www.npmjs.com/package/ztd-charts-mcp): an MCP server so an AI agent can pick, check and render charts.

## License

MIT. Renamed from `@junhanlee/chart-kit` in 0.2.0: CSS names moved from `--ck-*`, `.ck-*` and `data-ck-theme` to `--ztd-*`, `.ztd-*` and `data-ztd-theme`.
