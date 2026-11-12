# ztd charts evaluation and improvements (2026-11)

> **Old record.** This describes the state on 2026-11-03 and has not been updated since. For the current state, see the [README](../README.md) and the [QA report](QA-report.md).

2026-11-03, branch `feat/eval-and-new-charts`. The baseline is the last commit of PR #1, `30b5bea` (31 charts), and after this work there are 33 charts. We measured on an Apple M4 Pro (14 cores) with 48 GB RAM, using Node 24.14 and Chromium 156. The screen checks use the same method as section 1 of [QA-report.md](QA-report.md).

## At a glance

| Area | Baseline `30b5bea` | After this work | What we did |
|---|---|---|---|
| Aesthetics | Clipping, overlap and contrast checks passed. In 3 examples, the item named in the takeaway differed from the item highlighted in color, and the waffle leaned to the left. Visual regression: 58 of 62 failed | 0 clipping, overlap or intrusion across 522 cards. Minimum contrast 4.6:1 across 11,024 text elements. Visual regression: 0 of 66 failed | Matched example takeaways to the highlights, centered the waffle, hid tick labels covered by the candlestick price tag, split baseline images by machine |
| Performance | Replay of 31 charts: minimum 60 fps. 10,000-point first render: maximum 60.0 ms | 33 charts: minimum 60 fps. 10,000 points: maximum 61.3 ms. Chart bundles grew by about 0.49 kB per chart | Stopped rebuilding values on every frame of the entrance. They are now computed only when the data changes |
| Quality | 201 tests passed, 0 lint and type errors. Review found 9 kinds of defects that drew data wrong or ignored input | 206 tests passed, 0 lint warnings, 0 type errors | Reproduced each defect, fixed it, and checked it again the same way |
| Speed | Gallery first paint 204 ms, total long tasks 153 ms (4× CPU slowdown: 696 ms, 723 ms) | 84 ms, 0 ms (244 ms, 333 ms) | Limited drawing to the cards that come near the screen |
| Real-world functionality | Tapping did not show a tooltip, server-rendering a chart with many points gave a warning, charts disappeared and came back on every refresh, per-chart schema paths were blocked | All fixed. Added candlestick, segmented bar, tick gauge, and drag to select a range and zoom | Implemented only the patterns that recurred in the cases we researched |

## 1. Aesthetics

We looked at the gallery and the 5 examples ourselves in dark and light, and ran the QA screen checks (clipping, overlap, intrusion, and contrast measured on actual pixels) on 33 charts × 3 widths × 2 themes.

- We fixed 3 places in the examples where the item named in the takeaway differed from the highlighted item: Feature usage (lollipop) "API", Quarterly goals (radial bar) "Churn prevention", Latency by region (ridgeline) "Frankfurt".
- Waffle: The cell grid and the summary sat against the left edge of the card. We moved them to the center.
- Candlestick: We now hide the price axis tick labels that sat under the last close price tag. The first QA run caught this overlap as 16 contrast failures and 16 overlaps. Now there are 0.
- Visual regression: The only baseline images were made on Linux, so on a Mac 58 of 62 failed because the operating system differs. We split them into `qa/__screenshots__/{linux,darwin}`, and all 66 now pass on this Mac.

## 2. Performance

| Item | Baseline | After |
|---|---|---|
| Replay per chart (1×, 4× CPU) | 31 charts, minimum 60 fps, 0 long tasks | 33 charts, minimum 60 fps, 0 long tasks |
| Replay all in the gallery (2 columns, 3 columns) | 60 fps | 60 fps (59.5 fps at 3 columns and 4×, from one dropped frame) |
| 10,000-point first render, 1× (max of 11 charts) | 60.0 ms (parallel coordinates) | 61.3 ms (parallel coordinates) |
| 10,000-point first render, 4× | Line 146 ms, area 125 ms, parallel coordinates 272 ms, calendar 227 ms | 136 ms, 104 ms, 207 ms, 191 ms |
| 10,000-point replay, 4× | Bubble 54.4 fps, beeswarm 52 fps | 58.1 fps, 55.7 fps |
| Hover response p95 (max of 11 charts, 1×) | 6.3 ms | 6.8 ms |

The 10,000-point baseline values were measured on the same machine 1 hour 40 minutes earlier, so please treat differences of around ±10% as noise.

In the cleanup step, we reviewed the changed code again from four angles (reuse, simplification, efficiency, depth of the fix) and applied the following.

- Candlestick: The event list, moving average paths, time ticks, description and price range were rebuilt on every frame of the entrance animation. Now they are built only when the data or size changes. The segmented bar and the tick gauge work the same way.
- While you drag to select, moving over the same point no longer redraws.
- The comparison text for the table (for screen readers) is built only when the event array changes, and only when the table is shown.
- Line and candlestick each had their own range selection, zoom and keyboard handling. We merged them into `useZoom` and `useChartBrush` in `core/brush.tsx`. Zoom now resets in the same render where the data changes, so there is no extra pass with the old range.

Before and after the cleanup, the server-rendered SVG hashes (structure snapshots) of all 33 charts are the same, and all 66 visual regression images are within 0.3% of the baseline images.

### Bundle size (size-limit, brotli)

| Bundle | Baseline | After | Budget |
|---|---|---|---|
| PieChart (representing a single chart) | 12.21 kB | 12.68 kB | 13.5 kB |
| LineChart, AreaChart | 15.98 kB | 18.50, 18.51 kB | 16.5 → 18.7 kB |
| CandlestickChart (new) | - | 15.60 kB | 16 kB |
| SegmentedBar (new) | - | 11.73 kB | 13.5 kB |
| Chart spec renderer | 53.18 kB (31 charts) | 59.79 kB (33 charts) | 56 → 61 kB |
| Full bundle (index.js) | 67.84 kB | 75.34 kB | 72 → 77 kB |

- Every chart grew by about 0.49 kB (3.8%). This is the cost of the defect fixes in the shared parts. Before compression, the additions are `motion.ts` +561 B (empty value handling, stretching each segment separately), `ChartFrame.tsx` +336 B (touch, drag and keyboard handling), `useMotion.ts` +254 B (telling apart items with the same name) and `format.ts` +240 B (-0, rolling up to the next unit).
- Line and area grew by another 2.5 kB for range selection and zoom.
- Drawing the candlestick moving average lines with the shared `linePath` also pulls in the curve code, which makes the bundle 15.94 kB. So the candlestick joins its straight lines itself (15.60 kB).

## 3. Quality: fixed defects

Of the issues that the code review agent and the real-use check agent found, we fixed only the ones we could reproduce. After each fix, we checked again with the same reproduction steps.

| Symptom | Reproduction | Before → after |
|---|---|---|
| Items with the same name merged into one | A, B, A in a pie | Slices 2 → 3. Waterfall 3 → 4, Sankey links 2 → 3, lollipop 2 → 3 |
| A change from an empty value to a number was not drawn | NaN in the animation target comparison | "same" → "different". In parallel coordinates, an update that adds a value to an empty axis is now drawn |
| Stacking with negative values | Negative series in area and stream | Negative layers drawn overlapping the layers above → positive values above 0, negative values below 0 |
| Daylight saving time dates | Calendar in the New York time zone | Duplicate and missing dates → none |
| Tapping does not show a tooltip | Line, calendar, parallel coordinates | Not shown → shown |
| Screen changes after server rendering | Chart with 2,000 points (the size where it switches to canvas) | Hydration errors 1 → 0 |
| Chart disappears on every refresh | `<Chart spec>` with `refreshMs` set | Blank while loading, then the chart enters again from the start → the chart stays |
| Hover picks the wrong shape | Small circle inside a large circle (bubble), overlapping ridges (ridgeline) | Could not pick the small circle or the lower ridge → picks the shape on top in drawing order |
| Area transition when the length changes | Changing the number of data points in an area chart | Bottom edge wobbles → fixed at 278 px |
| Empty values drawn at the axis minimum | NaN in parallel coordinates | Confused with a real minimum → the line breaks at that axis |
| Number formatting | -0.03, 9,999.96 (Korean ten-thousand units) | "-0" → "0", "10,000" → "1만" |
| Per-chart schema path blocked | `ztd-charts/schema/charts/line.schema.json` | `ERR_PACKAGE_PATH_NOT_EXPORTED` → found (test added) |

We first fixed the refresh defect by changing what `loading` means in `useChartData`. In the cleanup step, we moved the fix to the cause, a condition in `Chart.tsx`. So the public function `useChartData` is the same as in the baseline, and the fix also prevents the chart from going blank while it reloads after its source changes.

## 4. Speed: docs first load

These are medians of opening the builds before the cleanup (`30b5bea`) and after it, 3 times each in a row on the same machine. We turned the cache off.

| Page | First paint (FCP) | First chart | Total long tasks (longest) |
|---|---|---|---|
| Gallery, 1× | 204 → 84 ms | 113 → 129 ms | 153 (78) → 0 ms |
| Gallery, 4× CPU | 696 → 244 ms | 382 → 458 ms | 723 (300) → 333 (96) ms |
| Examples, 1× | 184 → 116 ms | 113 → 82 ms | 134 (74) → 0 ms |
| Examples, 4× CPU | 664 → 360 ms | 391 → 260 ms | 686 (296) → 383 (163) ms |
| Line chart docs, 1× | 116 → 116 ms | 79 → 82 ms | 0 → 0 ms |
| Line chart docs, 4× CPU | 376 → 392 ms | 256 → 263 ms | 336 (159) → 351 (164) ms |

The gallery and the examples now draw only the cards that come within 800 px of the screen, so first paint got faster and long tasks went down. In exchange, the gallery's first chart waits once for the observer signal, so it is 16 ms later (76 ms at 4×). Docs pages with a single chart show no difference.

## 5. Real-world functionality

- What we checked on a copy of the baseline commit: importing the bundled package as ESM and CJS, types under the `bundler` and `NodeNext` settings, the API on React 18, and whether every example spec passes the public JSON schema. All of them worked.
- What was blocked: the per-chart schema paths that the README points to. We fixed it by adding `./schema/*` to `exports`.
- Interactions checked by hand (Ego Lite, build after the cleanup):
  - While you drag across the candlestick (Investment portfolio example), a "+14.5% Sep 23 to Oct 24" chip and "High 81,100 won" and "Low 65,700 won" tags appear. Releasing zooms in, and Escape goes back.
  - Dragging on the p95 latency line (Operations example) zooms in, and "Show all" goes back.
  - With the keyboard, widening the range with Shift+Arrow reads out "… range +0.8%, high 244ms, low 217ms. Press Enter to zoom in". Enter zooms in and Escape goes back.
  - There were 0 console errors during these checks.

## 6. What we added

What we added and why we chose it are in [catalog.md](catalog.md#added-in-november-2026).

| Addition | Where it is used |
|---|---|
| Candlestick `candlestick`: open, high, low, close, volume, moving averages (up to 3), last close price tag. Up candles in the accent color, down candles in gray | Example "Investment portfolio" |
| Segmented bar `segmented`: composition in a single row, 28 px (shares inside) or 8 px, with a list of values and shares below | Example "Investment portfolio" |
| Drag to select a range and zoom `brush`: line, area, candlestick. `true` shows the range change, high and low, and `"zoom"` zooms in | Example "Operations and infrastructure monitoring" |
| Tick gauge `GaugeChart variant="ticks"` | Example "Operations and infrastructure monitoring" |

## 7. Remaining work

- Font for CLI PNG rendering: `pretendard` is a dev dependency, so the CLI installed from npm renders with system fonts. In Linux CI without a Korean font, text can break. This Mac has Pretendard installed, so the tests did not reveal it.
- With `moduleResolution: node10` (the old TypeScript default), the `/spec` and `/server` types are not found. We need to decide whether to add `typesVersions`.
- In the HTML export opened without scripts, the card's replay button does not work.
- Drag to select and zoom are not in the Playwright QA suite yet (for now there are only the hand checks above).
- The gallery's first chart is a little late because it waits for the observer signal. We need to decide whether to draw the few cards on the first screen right away.
- Defect fixes in the shared parts made every chart 0.49 kB larger. It is worth looking for places to cut.
- In the "Investment portfolio" example, the segmented bar card stretches to the height of the candlestick card next to it, which leaves a lot of empty space.
- The bundle size columns in `catalog.md`, `llms.txt` and the QA report are labeled gzip, but the values are brotli as measured by size-limit.
- Skipped in the cleanup step because they change behavior: matching the candlestick hover dimming (0.55) to the shared dimming (0.38), the fallback labels used when tick labels overlap losing their format and locale, the ridgeline height counting groups with no values, and moving the canvas switch decision into `useChart`.
- Found in review but not fixed this time: the staggered delay stopping during the entrance, the stacking order of highlighted shapes when the series change, what a numeric highlight means after sorting or filtering, table arrow keys moving in 1 dimension only, cyclic Sankey data, redrawing the canvas when color variables or the screen scale change, and stutter in the 50×50 heatmap SVG.
