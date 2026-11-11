# Chart catalog: why these 33

English · [한국어](catalog.ko.md)

> Let the chart do the talking. One highlight, a one-line takeaway, everything else quiet.

## How we chose

We kept the forms that read well in reports and dashboards with one highlight, and that stay clear on a dark card too. Every chart uses the same card: number, title, gray subtitle, small square legend, one highlight, bold one-line takeaway and level badge.

There were two criteria.

1. **Does one highlight carry the message?** We left out charts that fall apart with many grays and one accent color (charts that really need many colors).
2. **Does the entrance animation add meaning?** We picked charts whose motion tells the reading order: sweeping in (pie), filling from the baseline (bar, area), flowing from left to right (sankey, line), filling cells (waffle, calendar).

## Final list

<!-- TABLE:START -->
| # | type | Name | Group | Level | Why we chose it | Brotli |
|---|---|---|---|---|---|---|
| 01 | `pie` | Pie chart | Proportion | Basic | Only the highlighted slice (the largest by default) gets the accent color and the rest stay neutral, so one share carries the message. | 13.88 KB |
| 02 | `donut` | Donut chart | Proportion | Basic | The center number counts up as the chart enters, so the total reads first. | 13.9 KB |
| 03 | `funnel` | Funnel chart | Flow | Basic | Highlights the stage with the lowest conversion rate, so you see where users drop off. | 12.3 KB |
| 04 | `waffle` | Waffle chart | Proportion | Intermediate | Cells fill row by row, which gives a feel for the number before you read it. | 15.11 KB |
| 05 | `treemap` | Treemap | Hierarchy | Intermediate | The squarified layout keeps cells close to square, so labels fit. | 12.83 KB |
| 06 | `sunburst` | Sunburst | Hierarchy | Intermediate | Rings open from the inside out as the chart enters, so the hierarchy reads level by level. | 13.21 KB |
| 07 | `waterfall` | Waterfall chart | Comparison | Intermediate | Bars connect one by one from the left, showing where the value rose and fell. | 13.47 KB |
| 08 | `pareto` | Pareto chart | Comparison | Intermediate | After the bars, the cumulative line draws in and marks where it crosses the threshold (80% by default). | 13.75 KB |
| 09 | `marimekko` | Marimekko chart | Proportion | Advanced | Columns fill from the bottom, so both shares read at once. | 13.13 KB |
| 10 | `heatmap` | Heatmap | Relationship | Intermediate | Uses shades of one accent color, so it follows the theme. With many cells it switches to canvas, so even 10k cells stay fast. | 14.24 KB |
| 11 | `radar` | Radar chart | Comparison | Intermediate | Only the highlighted series is filled and the rest are outlines, which keeps overlaps readable. | 13.72 KB |
| 12 | `bubble` | Bubble chart | Relationship | Intermediate | With many dots it switches to canvas and finds the nearest dot through a grid index, so hover stays smooth even at 10k dots. | 16.66 KB |
| 13 | `line` | Line chart | Trend | Basic | Only the highlighted series gets color; the rest stay gray, with name tags on the right. Even 10k points are reduced with LTTB and drawn as one path. | 26.2 KB |
| 14 | `area` | Area chart | Trend | Basic | Areas rise from the baseline as the chart enters, which shows the stacking at a glance. | 26.2 KB |
| 15 | `stream` | Streamgraph | Trend | Advanced | A wiggle baseline and inside-out ordering keep the bands calm. Names go where each band is thickest. | 16.47 KB |
| 16 | `bar` | Bar chart | Comparison | Basic | With one series only the largest bar gets color; with several, only the highlighted series. | 21.9 KB |
| 17 | `radialBar` | Radial bar chart | KPI | Intermediate | For a single progress ring, use the gauge with variant "ring". | 11.88 KB |
| 18 | `gauge` | Gauge | KPI | Basic | The number counts up as the arc fills. The variant option picks an arc, a half circle (semi), a progress ring (ring) or lit tick marks (ticks). | 12.03 KB |
| 19 | `bullet` | Bullet chart | KPI | Intermediate | A compact alternative to gauges. Highlights the KPI with the lowest actual-to-target ratio. | 12.68 KB |
| 20 | `sparkline` | Sparkline | Trend | Basic | A word-sized graphic: no axes, and the last value shows as text. | 14.55 KB |
| 21 | `slope` | Slope chart | Comparison | Intermediate | Each slope shows at a glance whether an item went up or down. The item that rose the most is highlighted. | 12.77 KB |
| 22 | `dumbbell` | Dumbbell chart | Comparison | Intermediate | Less ink than two bars, and the difference itself shows as line length. | 12.28 KB |
| 23 | `lollipop` | Lollipop chart | Comparison | Basic | Sorted largest first by default, so it reads as a ranking. | 13.11 KB |
| 24 | `beeswarm` | Beeswarm | Distribution | Advanced | Shows the individual values an average hides, with each group's median marked. | 14.07 KB |
| 25 | `ridgeline` | Ridgeline | Distribution | Advanced | KDE curves rise one after another from the top as the chart enters. | 12.96 KB |
| 26 | `sankey` | Sankey diagram | Flow | Advanced | A relaxation layout, written with no dependencies, moves nodes step by step to reduce overlaps. Bands flow in from left to right as they enter. | 13.54 KB |
| 27 | `chord` | Chord diagram | Flow | Advanced | The group with the largest total is highlighted by default, so even a dense diagram reads as 'who this team works with'. | 12.54 KB |
| 28 | `calendar` | Calendar heatmap | Trend | Intermediate | One square per day, filled week by week from left to right, with one row per year for multiple years. | 15.1 KB |
| 29 | `bump` | Bump chart | Trend | Intermediate | Keeps only the ranks, so crossings stand out. Highlights the item that climbed the most automatically. | 14.49 KB |
| 30 | `box` | Box / violin plot | Distribution | Advanced | The variant option picks box, violin or both. Shapes spread up and down from the median as the chart enters. | 14.36 KB |
| 31 | `parallel` | Parallel coordinates | Relationship | Advanced | One highlighted line over many gray ones turns a hard-to-read form into a story. With many rows it draws 10k lines on canvas. | 13.64 KB |
| 32 | `candlestick` | Candlestick chart | Trend | Advanced | Rising candles take the accent color and falling ones are gray. Drag over a period to see its change, high and low. | 20.18 KB |
| 33 | `segmented` | Segmented bar | Proportion | Basic | Takes less space than a pie, and the list below gives each value and share. | 12.48 KB |
| 34 | `skyline` | Skyline | Trend | Intermediate | Volume per period as blocks on a level floor, so a taller block always means more. Only the highlighted series gets the accent, and a smaller outcome in the same unit (failures, rework) stands in its own front row on the same scale. | 18.65 KB |
| 35 | `histogram` | Histogram | Distribution | Intermediate | Only the bins on the bad side of the threshold take the accent color, and the p50 and p95 lines carry their values, so the tail reads without a legend. Two groups share one set of bin edges. | 18.35 KB |
| 36 | `scatter` | Scatter plot | Relationship | Basic | Series colors are set once over every series, so hiding one never repaints the rest. Arrow keys move to the nearest dot in that direction, and jitter uses a fixed seed, so the server and the browser draw the same picture. | 22.49 KB |
| 37 | `tileMap` | Tile grid map | Map | Intermediate | Rhode Island and DC read at the same size as Texas, which a geographic map cannot do. No boundary data and no projection, so it adds no dependency. One accent color in steps, and the highest tile gets an outline. | 15.84 KB |
| 38 | `choropleth` | Choropleth map | Map | Intermediate | Shades of one accent color in steps, like the heatmap and tile map, and the highest region gets an outline. Small places hide on a map, so a ranked list of the highest and lowest sits beside it when there is room. Arrow keys move between neighbouring regions. Boundary data ships as separate entry points, so charts that do not draw a map do not carry it. | 19.05 KB |
| 39 | `barRace` | Bar race | Comparison | Intermediate | When the step changes, every bar continues from where it is to its new length and place, so climbs and falls read as motion. Items keep their color across steps and only the highlighted one gets the accent. Images and the first server paint show one step, fully drawn, without the controls. | 17.66 KB |
| 40 | `network` | Network | Relationship | Advanced | Nodes sit on one line in an order that keeps arcs short, so the layout takes one pass: server and browser draw the same picture, and the arrow keys walk the nodes in order. Arc height follows the distance between two nodes and width follows the value. The most connected node is highlighted by default, with its links drawn on top. | 15.87 KB |
| 41 | `timeline` | Timeline | Trend | Intermediate | Items with the same name share a row, and overlapping items split the row into lanes so nothing is hidden. The longest item gets the accent color, and an item whose start equals its end is a point event. | 19.93 KB |
| 42 | `tree` | Tree | Hierarchy | Intermediate | Only the path from each highlighted node to the root takes the accent color, so one route through the structure carries the message. options.highlight takes names or paths such as "Orders/Checkout". Links grow out from the root as the chart enters, and a click or Enter folds a branch. | 16.94 KB |
| 43 | `symbolMap` | Symbol map | Map | Intermediate | Circle area follows the value (square-root radius with a floor and a cap), so a big region does not make a small amount look heavy as on a choropleth. Smaller circles sit above larger ones so none hides, the largest gets the accent color, and a compact size legend gives two or three reference circles. Places come from longitude and latitude, or from a region name of the map (a country, a state) when there are no coordinates. No city list ships, so cities need coordinates. | 20.28 KB |
| 44 | `flowMap` | Flow map | Map | Advanced | The same rows as sankey, chord and network (source, target, value), so one dataset switches between them. Links bend to the right of travel, so opposite flows between the same pair both show, and an arrowhead marks the target. Thinner links sit above thicker ones and the largest flow gets the accent color. Hovering a place keeps only its flows, and a ranked list of the largest flows sits beside the map when there is room. Flows across the antimeridian take the short way round. | 20.96 KB |
<!-- TABLE:END -->

Size is the Brotli size of a single chart import such as `import { BarChart } from "ztd-charts"`, measured with size-limit (rolldown, react excluded). It includes the shared core (theme, motion engine, frame, formatting, axes) of about 9 KB. With several charts, the core is included only once.

## Left out, merged

| Candidate | Decision | Why |
|---|---|---|
| Polar area (Nightingale) | Left out | It shows values as radius, so area grows with the square. Pretty, but radar (comparing metrics), radial bar (progress) and calendar (seasonality) fill the same role more accurately. |
| Progress ring | Merged into gauge | A single progress ring is `GaugeChart variant="ring"`. Several are a radial bar. |
| Box and violin | Merged into one | The data shape is the same, so you pick with `BoxPlot variant="box" \| "violin" \| "both"`. |
| Grouped, stacked, 100% bars | Merged into one | `BarChart layout="grouped" \| "stacked" \| "percent"`, `orientation="horizontal"`. |
| Scatter plot | Merged into bubble | `BubbleChart` without size is a scatter plot. The spec also accepts the alias `scatter`. |
| 3D, multi-ring donuts, gauge needles | Left out | Hard to read, or closer to decoration. |
| Maps (choropleth) | Left out for now | Needs map data (TopoJSON) and projections, which conflicts with the "zero dependencies" rule. A candidate for later. |

## With a lot of data

| Chart | Approach | Result at 10k points (see the QA report) |
|---|---|---|
| Line, area, sparkline | LTTB down to twice the width in points, one path | Shape kept, hover uses the original x |
| Bubble (scatter) | Canvas above 1,500, plus a grid index for nearest search | Axes and labels stay SVG |
| Heatmap | Canvas above 2,500 cells, diagonal wave entrance | Cell hover by coordinate math |
| Beeswarm | Canvas above 2,000 | Same layout algorithm |
| Parallel coordinates | Canvas above 1,500 lines (drawn together in one path) | Nearest line search is O(n) |
| Calendar | SVG up to 4,000 days (about 11 years), canvas above that. One row per year | Even 27 years (10k days) fit in one view, cell hover by coordinate math |

## Added in November 2026

What we added to the first 31 charts, and what we left out:

| Addition | Decision | Why |
|---|---|---|
| Candlestick `candlestick` | Added (32) | Common on finance and crypto screens. Rising candles take the accent color and falling ones are gray. Volume, moving averages and the last close are shown |
| Segmented bar `segmented` | Added (33) | Composition in one line inside a card. Takes less space than a circle, and the list below shows value and share together |
| Range selection and zoom `brush` | Option on line, area, candlestick | An interaction rather than a chart type, so it is an option. Keyboard: Shift+arrows, Enter |
| Tick gauge | `GaugeChart variant="ticks"` | Same data shape, so a gauge variant |
| Circular bars (radial columns) | Left out | Like Nightingale, outer bars look bigger. Heatmap and calendar are more accurate for cyclic data |
| Node-link tree | Later candidate | Treemap and sunburst cover hierarchy, and org charts deserve their own treatment |
