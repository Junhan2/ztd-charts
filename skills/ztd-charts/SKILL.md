---
name: ztd-charts
description: "Use when building React charts with ztd-charts: picking a chart that fits the data (44 types), writing and validating a JSON spec, connecting real data such as REST, CSV, Supabase or Google Sheets, writing card copy (title, one-line takeaway, level badge), and previewing with the CLI or MCP. Read it when the user wants a chart, dashboard, visualization, graph or report as React code or a JSON spec."
---

# ztd charts skill

44 chart types for React 18+. Pure SVG, zero runtime dependencies, entrance animation when a chart scrolls into view. The design has one rule: **only one highlighted item gets the accent color, everything else stays neutral, with a bold one-line takeaway under the card.**

## Steps

`ztd-charts` below is the CLI. Run it as `npx ztd-charts-cli <command>`, or as `ztd-charts` once `ztd-charts-cli` is installed in the project. Never run `npx ztd-charts`: that is the chart library package, which has no command.

1. **Look at the data.** For each column: number, date or category, how many categories, how many rows.
2. **Pick a chart.** Use the table below. If it is unclear, run `ztd-charts suggest data.csv` or the MCP tool `suggest_chart`.
3. **Write the spec.** Check channels and options with `ztd-charts info <type>` or the MCP tool `get_chart_schema`.
4. **Validate.** `ztd-charts validate spec.json` or the MCP tool `validate_spec`. Follow the "Did you mean …?" suggestions in the messages.
5. **Preview.** `ztd-charts render spec.json --out chart.png` or the MCP tool `render_chart` (PNG + React code). Check in the image that the highlight landed on the right item and that no label is clipped.
6. **Move it into code.** Use the component directly, or `<Chart spec={spec} />`.

## Picking a chart

Decide the question first, then the form.

| Question | Data | First choice | Alternatives |
|---|---|---|---|
| What % of the whole? (2 to 4 items) | category + value | `pie` | `donut` (total up front), `waffle` (as people) |
| What % of the whole? (5 or more) | category + value | `bar` (horizontal, sort) | `treemap`, `lollipop` |
| Seats or units out of a fixed total (assembly seats, board votes, seats sold) | group + count (+ total) | `waffle` with `shape: "arc"` (one dot per seat in half-circle rows; `total` draws the rest as empty seats; `referenceLines: [{ "value": 151, "label": "Majority" }]`) | `waffle` grid (shares of 100) |
| Two-level breakdown | parent + child + value | `treemap` | `sunburst`, `marimekko` (when column sizes differ too) |
| Structure, paths (org chart, folders, dependencies, outage reach) | parent + child, nested children, or id + parent rows | `tree` (`highlight` names or paths such as "Orders/Checkout" light the route to the root) | `treemap` (when each part's share matters more) |
| Change over time | date + value (+ series) | `line` | `area` (when the sum means something), `sparkline` (next to a KPI) |
| Mix changing over time | date + series + value | `area` stack | `stream` (5 or more series, flow first) |
| Rank changes | period + item + rank | `bump` | `slope` (two periods only), `barRace` (told as a story in a talk or video, one step at a time) |
| Two points in time | item + before/after | `dumbbell` | `slope` |
| When things ran and what overlapped (schedule, job runs, agent run, incident) | label + start + end (numbers or dates) | `timeline` (same label shares a row; start = end is a point event; empty end is still open, up to `now`; one label with `status` per segment is a status strip, colored by state) | `bar` (only the duration matters) |
| Comparing category sizes | category + value | `bar` | `lollipop` (many items), `pareto` (concentration) |
| Opinion split (Likert, for/against, population pyramid) | item + ordered answers or two sides | `bar` with `layout: "diverging"`: `negative` lists the series drawn left of zero, `neutral` splits one across it, `percent: true` for shares of each row | `bar` `layout: "percent"` (when there is no natural midpoint) |
| Why it went up or down | start + drivers (±) + end | `waterfall` | |
| Drop-off by stage | stage + people (shrinking) | `funnel` | `sankey` (when paths split) |
| Flow, movement | source + target + value | `sankey` | `chord` (two-way relationships) |
| Who is connected, who is central | source + target (+ value) | `network` (arc layout, `groups` for node groups) | `chord` (10 groups or fewer, amounts matter) |
| Distribution | group + many values | `box` | `histogram` (one measure's shape, p95 and a limit), `beeswarm` (up to 2,000 dots), `ridgeline` (5 or more groups), `box` variant violin |
| Finding patterns | category × category + value | `heatmap` | `calendar` (daily, one year) |
| Comparing regions | region (name or code) + value | `tileMap` (`"auto"` picks the grid from the data: `us-states` for the 50 US states and DC, `kr-sido` for Korea's 16 regions from 2026-07-01; `kr-sido-2025` for older data with Gwangju and Jeonnam apart; or your own grid) | `bar` (exact ranking matters more than place) |
| Where it is high and low on a real map | region (name or code) + value | `choropleth` (`"auto"` picks the map from the data: `world` by ISO code or country name, `us-states`, `kr-sido`, or a GeoJSON FeatureCollection; `focus: "europe"` crops the world map. Server, CLI and MCP load the maps; in the browser register the one you draw, for this and the other two map charts: `import { world } from "ztd-charts/geo/world"; registerMap(world)`) | `tileMap` (every region equally visible, small ones included) |
| Amounts at places on a map | lon + lat (or a country or state name) + value | `symbolMap` (circle area is the value; `"auto"` picks the map that holds the points, so US cities land on `us-states`; no city list ships, so cities need coordinates) | `choropleth` (a rate across whole regions) |
| From where to where on a map | source + target + value, places as `options.places: { name: [lon, lat] }` or region names | `flowMap` (same rows as `sankey`, `chord`, `network`; arrows show direction, opposite flows bend apart; `center: "auto"` switches the world map to a Pacific-centred view when that keeps trans-Pacific flows whole) | `sankey` (exact amounts, no geography) |
| Two or three metrics together | 2 or 3 numbers + name | `scatter` (two numbers) | `bubble` (a third number as size), `scatter` with `bin: "hex"` (thousands of overlapping points: hexagons shaded by count) |
| Comparing several metrics | item × metrics (4 to 8) | `radar` (1 or 2 series) | `parallel` (many items) |
| Against a target | value + target | `gauge` (one), `bullet` (several) | `radialBar` (3 to 6 goals) |

Avoid: more than 5 items in a pie, 3 or more series in a radar, bubble size for exact comparison, a line over unordered categories.

Channels, options and an example for every chart are in [references/charts.md](references/charts.md).

## Spec

```json
{
  "$schema": "https://unpkg.com/ztd-charts/schema/chart-spec.schema.json",
  "type": "funnel",
  "data": [{ "stage": "Visit", "users": 10000 }, { "stage": "Purchase", "users": 760 }],
  "encoding": { "label": "stage", "value": "users" },
  "options": { "unit": " users" },
  "card": { "number": "03", "title": "Funnel chart", "subtitle": "Users by stage", "takeaway": "Drop-off by stage", "level": "basic" }
}
```

- `data`: an array of rows, `{ "csv": "..." }`, or `{ "url": "...", "select": "data.items" }`. `<Chart>` and the CLI fetch URLs.
- `encoding`: channel → field name. For wide tables use an array, such as `"y": ["Search", "Social"]`.
- `options.highlight`: sets the one highlight. A name (`"Mobile"`), an index, `"max"`, `"min"`, `"first"`, `"last"` or `"none"`. Without it, each chart picks a smart default (funnel: the stage with the lowest conversion, bump: the item that climbed the most, bullet: the row furthest below target).
- `options.format`: `"number"`, `"integer"`, `"percent"` (values are already %), `"ratio"` (0 to 1), `"compact"` (1.2K, 3.4M), `"currency"` ($, or ₩ in a Korean locale) or Intl options. `unit` is text appended to each value (`"%"`, `" users"`).
- `facet`: `{ "by": "region" }` draws the same chart once per value of that field (up to 24 panels) on a shared scale. Use it when one chart would hold too many series to read, or when the request says "split by region". Only `line`, `area`, `bar` and `scatter` take it, and it does not combine with `layout: "diverging"` or `tileMap` (`validateSpec` returns an error). `"scale": "free"` when the groups differ a lot in size.
- `options.width`, `options.height`: at most 10,000 px each. Above that `validateSpec` returns `out_of_range` and the CLI and MCP refuse the spec.
- `options.locale`: `"ko-KR"` switches number formats (1.2만, 3.4억) and the chart's own text to Korean. The default is `"en-US"`, or the `locale` of the surrounding `ThemeProvider`.

## Card copy

- `title`: **what the reader is looking at**, not the chart name. For example "Sign-up funnel", "MRR by plan".
- `subtitle`: range and unit. For example "June (users)", "Month end (USD M)".
- `takeaway`: the chart's conclusion in one short line, a few words. A number or a comparison helps. For example "Visit to sign-up hurts most", "Top 3 make 74%". Avoid dashes and other long punctuation.
- `level`: `"basic"` (pie, bar, line…), `"intermediate"` (waterfall, heatmap, slope…), `"advanced"` (sankey, marimekko, parallel coordinates…). The badge reads Basic, Intermediate or Advanced, or 기본, 중급, 심화 in a Korean locale. The older Korean values still work.
- `legend`: `"auto"` builds series and colors from the data. The highlighted series is `accent`.
- For example or made-up data, set `"sample": true` to add a "Sample data" tag.

## Connecting real data

```tsx
import { ChartCard, ChartState, LineChart, useChartData } from "ztd-charts";

export function Revenue() {
  const r = useChartData("/api/revenue", { select: "data.items", refreshMs: 60_000 });
  return (
    <ChartCard title="Monthly revenue by channel" subtitle="(USD K)" takeaway="Social grows fast" level="basic" replay>
      <ChartState loading={r.loading && !r.data.length} error={r.error} empty={r.empty} onRetry={r.reload}>
        <LineChart data={r.data} x="month" y="revenue" series="channel" highlight="Social" unit="K" />
      </ChartState>
    </ChartCard>
  );
}
```

- **REST JSON**: `useChartData(url, { select, init: { headers } })`.
- **CSV**: pass the address as is. `.csv`, `format=csv` or `text/csv` is read with `parseCSV`. "1,234", "12%" and "₩5,000" are read as numbers too.
- **Supabase**: pass the `data` from `supabase.from("t").select("day, revenue")` as is, or REST `${url}/rest/v1/t?select=...` with an `apikey` header. Postgres numeric values that arrive as strings are fine.
- **Google Sheets**: `https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<tab>`.
- **2D arrays, SQL rows + fields**: `fromRows(rows, columns)`. Key-value maps: `fromObjects`.
- Accessors can be functions instead of field names: `value={(d) => d.amount / 1000}`.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `field_not_found` | Typo in an encoding field | Pick from the available fields listed in the message |
| `not_numeric` | Text in a value field | Pick a numeric column, or convert with an accessor function |
| Highlight on the wrong item | The default highlight is the maximum | Set `options.highlight` |
| Crowded pie | 5 or more items | `bar` with orientation horizontal + sort |
| Dates plotted as categories | Text such as "Jan" | Use ISO strings such as "2025-01", or check whether you meant `xType: "band"` |
| Clipped labels | The card is narrow | Increase `height`, or use `ChartGrid columns={1}` |

## Theme, language and accessibility

- Dark by default (ink cards, lime accent). `<ThemeProvider theme="light">` gives light (white cards, sky-blue accent). To change only the accent, set the CSS variable `--ztd-accent`.
- English by default. `<ThemeProvider locale="ko-KR">`, or a chart's `locale`, switches number formats and the chart's own text (tooltips, screen reader sentences, badges) to Korean.
- Every chart supports the keyboard (Tab, arrows, Enter), a screen reader description and data table, and the reduced motion setting. Use `ariaLabel` and `description` to be more specific.

## Tools

- CLI: `npx ztd-charts-cli list | info <type> | schema [type] | example <type> | validate <f> | render <f> --out x.png|x.svg|x.html | init [dir] | suggest <csv|json|url>`. Add `--locale ko` for Korean messages, chart text and number formats.
- MCP (stdio): `npx -y ztd-charts-mcp`. Tools `list_charts`, `get_chart_schema`, `validate_spec`, `render_chart`, `suggest_chart`. `render_chart` takes `locale: "ko"` for Korean chart text.
- Without React, `ztd-charts/spec` has the registry in English. Korean names, descriptions and examples: `chartsIn("ko")` or `localizeDef(def, "ko")`. Korean messages: `validateSpec(spec, { lang: "ko" })`, `suggestCharts(rows, { lang: "ko" })`.
