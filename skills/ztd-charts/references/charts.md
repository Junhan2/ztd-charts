# Reference for all 36 charts

`ztd-charts info <type>` or the MCP tool `get_chart_schema` gives the same content as JSON. `?` marks an optional channel, `[]` a channel that takes several fields (wide tables).

## pie · Pie chart (`<PieChart>`, Basic, Proportion)

- What: Each item's share of the whole
- Use when: 2 to 4 items that add up to 100%
- Avoid when: More than 4 items, or values close to each other (bars are more accurate)
- encoding: label, value
- Chart options: colorMode: categorical|emphasis, sort, startAngle, labelMode: percent|value|label|none, other
- Default highlight: the largest value

```json
{"type":"pie","data":[{"device":"Mobile","sales":72},{"device":"Desktop","sales":23},{"device":"Tablet","sales":5}],"encoding":{"label":"device","value":"sales"},"options":{"highlight":"Mobile"},"card":{"number":"01","title":"Pie chart","subtitle":"Sales share by device","takeaway":"Only 2 to 4 items","level":"basic","legend":"auto"}}
```

## donut · Donut chart (`<DonutChart>`, Basic, Proportion)

- What: A share chart with the total in the center
- Use when: The total matters as much as the shares
- Avoid when: More than 6 items
- encoding: label, value
- Chart options: innerRadius, centerValue, centerLabel, legend: auto|right|bottom|none, sort, other
- Default highlight: the largest value

```json
{"type":"donut","data":[{"type":"Purchase","count":719},{"type":"Sign-up","count":260},{"type":"Inquiry","count":161}],"encoding":{"label":"type","value":"count"},"options":{"centerLabel":"Conversions"},"card":{"number":"02","title":"Donut chart","subtitle":"Share by conversion type","takeaway":"Total in the center","level":"basic"}}
```

## funnel · Funnel chart (`<FunnelChart>`, Basic, Flow)

- What: How much drops at each stage, with conversion rates
- Use when: Ordered steps such as a sign-up or purchase flow
- Avoid when: The steps have no order, or values grow from step to step
- encoding: label, value
- Chart options: showRates, rateBase: previous|first, rateLabel
- Default highlight: the stage with the lowest conversion

```json
{"type":"funnel","data":[{"stage":"Visit","users":10000},{"stage":"Product view","users":6200},{"stage":"Cart","users":1900}],"encoding":{"label":"stage","value":"users"},"card":{"number":"03","title":"Funnel chart","subtitle":"Users by stage","takeaway":"Drop-off by stage","level":"basic"}}
```

## waffle · Waffle chart (`<WaffleChart>`, Intermediate, Proportion)

- What: Proportion on a 100-cell grid
- Use when: A share reads better as a count, like '38 out of 100'
- Avoid when: More than 4 items, or differences under 1% matter
- encoding: label, value
- Chart options: cells, columns, total, summary, summaryLabel, summaryNote
- Default highlight: the first series or item

```json
{"type":"waffle","data":[{"segment":"New","customers":38},{"segment":"Returning","customers":62}],"encoding":{"label":"segment","value":"customers"},"options":{"summaryLabel":"New customers","summaryNote":"62 returning"},"card":{"number":"04","title":"Waffle chart","subtitle":"Out of 100 customers","takeaway":"Percent as 100 cells","level":"intermediate","legend":"auto"}}
```

## treemap · Treemap (`<Treemap>`, Intermediate, Hierarchy)

- What: Shares of a hierarchy shown as area
- Use when: Two levels of share at once, such as products within categories
- Avoid when: Exact size comparison matters
- encoding: label, value, group?
- Chart options: path, labelMode: both|name|value|none, sort
- Default highlight: the largest value

```json
{"type":"treemap","data":[{"category":"Running shoes","product":"Cushion Run","share":22},{"category":"Running shoes","product":"Race X","share":14},{"category":"Running shoes","product":"Daily Run","share":10}],"encoding":{"group":"category","label":"product","value":"share"},"card":{"number":"05","title":"Treemap","subtitle":"Product sales share by category","takeaway":"Shares within a hierarchy","level":"intermediate"}}
```

## sunburst · Sunburst (`<SunburstChart>`, Intermediate, Hierarchy)

- What: A hierarchy drawn in rings
- Use when: A breakdown of 2 to 3 levels, such as channel > campaign
- Avoid when: 4 or more levels, or more than 20 leaves
- encoding: label, value, group?
- Chart options: path, sort, hole
- Default highlight: the largest value

```json
{"type":"sunburst","data":[{"channel":"Search","campaign":"Brand","spend":18},{"channel":"Search","campaign":"Generic","spend":30},{"channel":"PMax","campaign":"All products","spend":25}],"encoding":{"group":"channel","label":"campaign","value":"spend"},"options":{"highlight":"All products"},"card":{"number":"06","title":"Sunburst","subtitle":"Ad spend share by channel and campaign","takeaway":"A hierarchy in rings","level":"intermediate"}}
```

## waterfall · Waterfall chart (`<WaterfallChart>`, Intermediate, Comparison)

- What: Breaks the change from a start value to an end value into its drivers
- Use when: Explaining why last month's revenue became this month's
- Avoid when: More than 12 drivers
- encoding: label, value, type?
- Chart options: startTotal, endTotal, connectors
- Default highlight: the largest value

```json
{"type":"waterfall","data":[{"item":"Sep","amount":3200,"kind":"total"},{"item":"New","amount":1100},{"item":"Repeat","amount":450}],"encoding":{"label":"item","value":"amount","type":"kind"},"card":{"number":"07","title":"Waterfall chart","subtitle":"Revenue from Sep to Oct (10k KRW)","takeaway":"What drove the change","level":"intermediate","legend":[{"label":"Increase","color":"neutral"},{"label":"Decrease","color":"neutralStrong"}]}}
```

## pareto · Pareto chart (`<ParetoChart>`, Intermediate, Comparison)

- What: Bars sorted largest first with a cumulative share line
- Use when: Seeing how few items make up 80% of the total
- Avoid when: The item order means something (time order, for example)
- encoding: label, value
- Chart options: threshold, sort, rankLabels
- Default highlight: the items before the cumulative line reaches the threshold

```json
{"type":"pareto","data":[{"keyword":"running shoes","spend":54},{"keyword":"marathon shoes","spend":25},{"keyword":"best sneakers","spend":7}],"encoding":{"label":"keyword","value":"spend"},"options":{"rankLabels":true},"card":{"number":"08","title":"Pareto chart","subtitle":"Ad spend share by keyword (%)","takeaway":"Do the top 20% make 80%?","level":"intermediate","legend":[{"label":"Share","color":"neutral"},{"label":"Cumulative","color":"ink","shape":"line"}]}}
```

## marimekko · Marimekko chart (`<MarimekkoChart>`, Advanced, Proportion)

- What: Two shares at once: width (column share) and height (share within the column)
- Use when: Revenue size by channel and device mix in one chart
- Avoid when: More than 6 columns or more than 4 series
- encoding: x, series, value
- Chart options: -
- Default highlight: the first series or item

```json
{"type":"marimekko","data":[{"channel":"Search","device":"Mobile","sales":26.1},{"channel":"Search","device":"Desktop","sales":16.2},{"channel":"Search","device":"Tablet","sales":2.7}],"encoding":{"x":"channel","series":"device","value":"sales"},"card":{"number":"09","title":"Marimekko chart","subtitle":"Channel sales and device mix (%)","takeaway":"Two shares in width and height","level":"advanced","legend":"auto"}}
```

## heatmap · Heatmap (`<Heatmap>`, Intermediate, Relationship)

- What: Values where two categories meet, shown as color depth
- Use when: Finding patterns such as orders by weekday × hour
- Avoid when: Exact value comparison matters
- encoding: x, y, value
- Chart options: showValues, legend, legendLabels, canvasThreshold
- Default highlight: the largest value

```json
{"type":"heatmap","data":[{"day":"Mon","hour":"12am","orders":2},{"day":"Mon","hour":"3am","orders":1},{"day":"Mon","hour":"6am","orders":3}],"encoding":{"x":"hour","y":"day","value":"orders"},"card":{"number":"10","title":"Heatmap","subtitle":"Orders by weekday × hour","takeaway":"Friday nights are the busiest","level":"intermediate"}}
```

## radar · Radar chart (`<RadarChart>`, Intermediate, Comparison)

- What: Compares several metrics at once
- Use when: Products or candidates scored on 5 to 8 metrics
- Avoid when: More than 3 series (they overlap and get hard to read)
- encoding: axis, value[], series?
- Chart options: max, levels, circular
- Default highlight: the first series or item

```json
{"type":"radar","data":[{"metric":"Speed","product":"Our app","score":86},{"metric":"Stability","product":"Our app","score":78},{"metric":"Design","product":"Our app","score":92}],"encoding":{"axis":"metric","series":"product","value":"score"},"card":{"number":"11","title":"Radar chart","subtitle":"Product ratings (out of 100)","takeaway":"Ahead on design, behind on price","level":"intermediate","legend":[{"label":"Our app","color":"accent"},{"label":"Industry average","color":"neutralStrong"}]}}
```

## bubble · Bubble chart (`<BubbleChart>`, Intermediate, Relationship)

- What: Three values at once: x, y and size. Without size it is a scatter plot
- Use when: How three metrics relate, such as CPC, ROAS and spend by campaign
- Avoid when: Dots overlap and sizes get hard to compare
- encoding: x, y, size?, label?
- Chart options: sizeRange, xLabel, yLabel, zero, maxLabels, canvasThreshold, xFormat
- Default highlight: the largest value

```json
{"type":"bubble","data":[{"campaign":"Brand search","cpc":420,"roas":680,"spend":1800},{"campaign":"Generic search","cpc":780,"roas":310,"spend":4200},{"campaign":"PMax all","cpc":560,"roas":520,"spend":3600}],"encoding":{"x":"cpc","y":"roas","size":"spend","label":"campaign"},"options":{"xLabel":"CPC (KRW)","yLabel":"ROAS (%)"},"card":{"number":"12","title":"Bubble chart","subtitle":"CPC, ROAS and spend by campaign","takeaway":"Are the big circles efficient too?","level":"intermediate"}}
```

## line · Line chart (`<LineChart>`, Basic, Trend)

- What: Change over time
- Use when: A metric over time, such as monthly users, alone or against other series
- Avoid when: x is a category with no order
- encoding: x, y[], series?, lower?[], upper?[]
- Chart options: curve: smooth|linear|step, xType: number|date|band, aggregate: sum|mean|last|count, dots, area, zero, endLabels, colorMode: highlight|categorical, yDomain, maxPoints, referenceLines, yLabel, brush, annotations, signColors, baseline, downColor, bandFrom: start|forecast, outside, connectNulls
- Default highlight: the first series or item

```json
{"type":"line","data":[{"month":"2025-01","app":"Our app","mau":42,"p5":39.4,"p95":44.6},{"month":"2025-01","app":"Rival A","mau":56.8},{"month":"2025-01","app":"Rival B","mau":38}],"encoding":{"x":"month","y":"mau","series":"app"},"options":{"area":true},"card":{"number":"13","title":"Line chart","subtitle":"Monthly active users (10k)","takeaway":"Only our app keeps climbing","level":"basic"}}
```

## area · Area chart (`<AreaChart>`, Basic, Trend)

- What: Running totals and a changing mix (stacked, 100% stacked)
- Use when: Seeing how each channel's traffic changes within the total
- Avoid when: The exact value of each series matters
- encoding: x, y[], series?, lower?[], upper?[]
- Chart options: stack: none|stacked|percent, curve: smooth|linear|step, xType: number|date|band, aggregate: sum|mean|last|count, zero, endLabels, yDomain, maxPoints, brush, annotations, signColors, baseline, downColor, bandFrom: start|forecast, outside, connectNulls
- Default highlight: the first series or item

```json
{"type":"area","data":[{"month":"Jan","channel":"Search","visits":120},{"month":"Jan","channel":"Social","visits":70},{"month":"Jan","channel":"Direct","visits":80}],"encoding":{"x":"month","y":"visits","series":"channel"},"options":{"highlight":"Social"},"card":{"number":"14","title":"Area chart","subtitle":"Monthly visits by channel (thousands)","takeaway":"Social's share grows the fastest","level":"basic","legend":"auto"}}
```

## stream · Streamgraph (`<StreamGraph>`, Advanced, Trend)

- What: Many series as flowing bands that show size and change
- Use when: 5 or more series where the rhythm of the flow matters, such as viewing by genre
- Avoid when: You need to read exact values
- encoding: x, y[], series?
- Chart options: offset: wiggle|silhouette, reorder, curve: smooth|linear|step, xType: number|date|band, aggregate: sum|mean|last|count
- Default highlight: the largest value

```json
{"type":"stream","data":[{"week":"W1","genre":"Drama","hours":21.6},{"week":"W1","genre":"Variety","hours":8.4},{"week":"W1","genre":"Docs","hours":6.3}],"encoding":{"x":"week","y":"hours","series":"genre"},"options":{"highlight":"Variety"},"card":{"number":"15","title":"Streamgraph","subtitle":"Weekly viewing hours by genre (10k hours)","takeaway":"Variety ruled the summer","level":"advanced"}}
```

## bar · Bar chart (`<BarChart>`, Basic, Comparison)

- What: Grouped, stacked, 100% and horizontal bars
- Use when: Comparing sizes across categories precisely
- Avoid when: The flow over time is the point (a line works better)
- encoding: x, y[], series?
- Chart options: layout: grouped|stacked|percent, orientation: vertical|horizontal, sort, aggregate: sum|mean|last|count, annotations
- Default highlight: the first series or item

```json
{"type":"bar","data":[{"quarter":"Q1","team":"Domestic","revenue":42},{"quarter":"Q1","team":"Overseas","revenue":18},{"quarter":"Q2","team":"Domestic","revenue":48}],"encoding":{"x":"quarter","y":"revenue","series":"team"},"options":{"layout":"stacked","highlight":"Overseas"},"card":{"number":"16","title":"Bar chart","subtitle":"Revenue by quarter (100M KRW)","takeaway":"Overseas grows its share every quarter","level":"basic","legend":"auto"}}
```

## radialBar · Radial bar chart (`<RadialBarChart>`, Intermediate, KPI)

- What: Ratios such as progress toward goals, drawn as rings
- Use when: Showing progress on 3 to 6 goals in one view
- Avoid when: Comparing values precisely (outer rings look longer)
- encoding: label, value
- Chart options: max, sweep
- Default highlight: the largest value

```json
{"type":"radialBar","data":[{"goal":"Revenue","rate":82},{"goal":"Sign-ups","rate":64},{"goal":"Repeat buys","rate":91}],"encoding":{"label":"goal","value":"rate"},"options":{"unit":"%","format":"integer"},"card":{"number":"17","title":"Radial bar chart","subtitle":"Progress toward quarterly goals","takeaway":"Only repeat buys are near the goal","level":"intermediate"}}
```

## gauge · Gauge (`<GaugeChart>`, Basic, KPI)

- What: One KPI's current value against its target
- Use when: Showing one value against its target, large
- Avoid when: Comparing several values
- encoding: value, target?
- Chart options: min, max, label, variant: arc|semi|ring|ticks, bands, ticks
- Default highlight: the largest value

```json
{"type":"gauge","data":[{"label":"Goal reached","value":73,"target":85}],"encoding":{"value":"value","target":"target"},"options":{"label":"Goal reached","unit":"%"},"card":{"number":"18","title":"Gauge","subtitle":"Quarterly revenue goal (%)","takeaway":"12 points left to the goal","level":"basic"}}
```

## bullet · Bullet chart (`<BulletChart>`, Intermediate, KPI)

- What: Actual value against a target and bands (poor, fair, good)
- Use when: Several KPIs with their targets in a small space
- Avoid when: There is no target or band
- encoding: label, value, target?
- Chart options: ranges, independent
- Default highlight: the row furthest below its target

```json
{"type":"bullet","data":[{"kpi":"Revenue (100M)","actual":27.4,"target":30,"poor":18,"ok":25,"good":34},{"kpi":"Operating profit (100M)","actual":4.1,"target":3.6,"poor":2,"ok":3,"good":5},{"kpi":"New customers (k)","actual":12.8,"target":15,"poor":8,"ok":12,"good":18}],"encoding":{"label":"kpi","value":"actual","target":"target"},"options":{"ranges":["poor","ok","good"]},"card":{"number":"19","title":"Bullet chart","subtitle":"H1 KPIs (target: vertical tick)","takeaway":"New customers lag the most","level":"intermediate"}}
```

## sparkline · Sparkline (`<Sparkline>`, Basic, Trend)

- What: A small trend line next to a table cell or KPI
- Use when: The trend matters more than exact values
- Avoid when: You need to read axis values
- encoding: x?, y
- Chart options: variant: line|area|bar, showValue, showExtremes, mark: last|max|min|none
- Default highlight: the largest value

```json
{"type":"sparkline","data":[{"day":"2025-06-01","revenue":1200},{"day":"2025-06-02","revenue":1304},{"day":"2025-06-03","revenue":1356}],"encoding":{"x":"day","y":"revenue"},"options":{"height":120,"showExtremes":true},"card":{"number":"20","title":"Sparkline","subtitle":"Daily revenue in June (10k KRW)","takeaway":"Spikes every weekend","level":"basic"}}
```

## slope · Slope chart (`<SlopeChart>`, Intermediate, Comparison)

- What: Change in size and rank between two points in time
- Use when: Comparing just two points in time, such as last year's and this year's share
- Avoid when: 3 or more points in time (use a line or bump chart)
- encoding: label, x?, value?
- Chart options: start, end, periodLabels
- Default highlight: the largest value

```json
{"type":"slope","data":[{"brand":"Our brand","period":"2024","share":18},{"brand":"Our brand","period":"2025","share":27},{"brand":"Brand A","period":"2024","share":31}],"encoding":{"label":"brand","x":"period","value":"share"},"options":{"unit":"%"},"card":{"number":"21","title":"Slope chart","subtitle":"Market share by brand (%)","takeaway":"Only we rose sharply","level":"intermediate"}}
```

## dumbbell · Dumbbell chart (`<DumbbellChart>`, Intermediate, Comparison)

- What: The gap between two values per item (before and after, target and actual)
- Use when: The gap is the story, such as before and after an improvement by region
- Avoid when: There is only one value
- encoding: label, start, end
- Chart options: labels, sort, zero
- Default highlight: the largest value

```json
{"type":"dumbbell","data":[{"region":"Seoul","before":3.2,"after":4.6},{"region":"Gyeonggi","before":2.8,"after":3.9},{"region":"Busan","before":2.1,"after":2.6}],"encoding":{"label":"region","start":"before","end":"after"},"options":{"labels":["2024","2025"],"unit":"%"},"card":{"number":"22","title":"Dumbbell chart","subtitle":"Purchase conversion rate by region (%)","takeaway":"Seoul rose the most","level":"intermediate"}}
```

## lollipop · Lollipop chart (`<LollipopChart>`, Basic, Comparison)

- What: A line and a dot instead of a bar. Stays light with many items
- Use when: Rankings of 7 to 20 items, such as usage by feature
- Avoid when: The differences between values are very small
- encoding: label, value
- Chart options: orientation: horizontal|vertical, sort
- Default highlight: the largest value

```json
{"type":"lollipop","data":[{"feature":"Search","usage":82},{"feature":"Cart","usage":74},{"feature":"Wishlist","usage":61}],"encoding":{"label":"feature","value":"usage"},"options":{"unit":"%"},"card":{"number":"23","title":"Lollipop chart","subtitle":"Weekly usage by feature (%)","takeaway":"Search dominates","level":"basic"}}
```

## beeswarm · Beeswarm (`<BeeswarmChart>`, Advanced, Distribution)

- What: A distribution with every dot laid out without overlap
- Use when: Seeing each user's value, group by group
- Avoid when: Thousands of dots that overlap (use violin or ridgeline)
- encoding: value, group?, label?
- Chart options: radius, showMedian, canvasThreshold
- Default highlight: the largest value

```json
{"type":"beeswarm","data":[{"id":"Free-1","plan":"Free","minutes":14.8},{"id":"Free-2","plan":"Free","minutes":12.6},{"id":"Free-3","plan":"Free","minutes":15.1}],"encoding":{"value":"minutes","group":"plan","label":"id"},"options":{"unit":" min"},"card":{"number":"24","title":"Beeswarm","subtitle":"Daily usage time by plan (min)","takeaway":"The Pro plan also spreads the widest","level":"advanced"}}
```

## ridgeline · Ridgeline (`<RidgelineChart>`, Advanced, Distribution)

- What: Group distributions as overlapping, stacked curves
- Use when: Comparing distributions across 5 to 12 groups, such as delivery time by region
- Avoid when: 3 or fewer groups (a box plot is simpler)
- encoding: group, value
- Chart options: overlap, bandwidth, sort: none|median
- Default highlight: the largest value

```json
{"type":"ridgeline","data":[{"region":"Seoul","hours":16.6},{"region":"Seoul","hours":24.4},{"region":"Seoul","hours":20.3}],"encoding":{"group":"region","value":"hours"},"options":{"unit":"h"},"card":{"number":"25","title":"Ridgeline","subtitle":"Delivery time by region","takeaway":"Only Jeju has a long tail","level":"advanced"}}
```

## sankey · Sankey diagram (`<SankeyChart>`, Advanced, Flow)

- What: How much flows between stages
- Use when: User flow from traffic source to purchase or drop-off
- Avoid when: The flow loops back, or there are more than 30 nodes
- encoding: source, target, value
- Chart options: nodeWidth, nodePadding
- Default highlight: the largest value

```json
{"type":"sankey","data":[{"source":"Search","target":"Product page","value":4200},{"source":"Social","target":"Product page","value":2600},{"source":"Social","target":"Promo page","value":1400}],"encoding":{"source":"source","target":"target","value":"value"},"options":{"highlight":"Purchase"},"card":{"number":"26","title":"Sankey diagram","subtitle":"From visit to purchase (users)","takeaway":"Half leave at the product page","level":"advanced"}}
```

## chord · Chord diagram (`<ChordChart>`, Advanced, Flow)

- What: How much groups send to and receive from each other
- Use when: Two-way relationships, such as requests between teams
- Avoid when: More than 10 groups
- encoding: source, target, value
- Chart options: padAngle
- Default highlight: the largest value

```json
{"type":"chord","data":[{"from":"Design","to":"Engineering","value":42},{"from":"Engineering","to":"Design","value":28},{"from":"Product","to":"Design","value":36}],"encoding":{"source":"from","target":"to","value":"value"},"options":{"highlight":"Product"},"card":{"number":"27","title":"Chord diagram","subtitle":"Requests between teams","takeaway":"Product is the hub","level":"advanced"}}
```

## calendar · Calendar heatmap (`<CalendarHeatmap>`, Intermediate, Trend)

- What: Daily amounts on a weekly grid
- Use when: The rhythm of daily activity, such as commits or orders
- Avoid when: The period is shorter than a month
- encoding: date, value
- Chart options: weekStart, gap, canvasThreshold
- Default highlight: the largest value

```json
{"type":"calendar","data":[{"date":"2025-01-01","commits":4},{"date":"2025-01-02","commits":4},{"date":"2025-01-03","commits":5}],"encoding":{"date":"date","value":"commits"},"card":{"number":"28","title":"Calendar heatmap","subtitle":"Daily commits in 2025","takeaway":"Weekends are quiet","level":"intermediate"}}
```

## bump · Bump chart (`<BumpChart>`, Intermediate, Trend)

- What: Rank changes over time
- Use when: What matters is the rank, as in App Store rankings
- Avoid when: The value gaps between ranks matter
- encoding: x, series, rank?, value?
- Chart options: -
- Default highlight: the item whose rank rose the most

```json
{"type":"bump","data":[{"month":"Jan","app":"Our app","rank":5},{"month":"Feb","app":"Our app","rank":4},{"month":"Mar","app":"Our app","rank":4}],"encoding":{"x":"month","series":"app","rank":"rank"},"card":{"number":"29","title":"Bump chart","subtitle":"Monthly App Store rank","takeaway":"From 5th to 1st","level":"intermediate"}}
```

## box · Box / violin plot (`<BoxPlot>`, Advanced, Distribution)

- What: Distribution summary by group (quartiles, median, outliers)
- Use when: Distribution and outliers together, such as response time by API
- Avoid when: The audience is not used to quartiles (a beeswarm is easier)
- encoding: group, value
- Chart options: variant: box|violin|both, outliers, zero, whiskers
- Default highlight: the largest value

```json
{"type":"box","data":[{"api":"/login","ms":210},{"api":"/login","ms":150},{"api":"/login","ms":104}],"encoding":{"group":"api","value":"ms"},"options":{"unit":"ms","variant":"box"},"card":{"number":"30","title":"Box / violin plot","subtitle":"Response time by API (ms)","takeaway":"The payment API is the slowest","level":"advanced"}}
```

## parallel · Parallel coordinates (`<ParallelCoordinates>`, Advanced, Relationship)

- What: Several numeric metrics, each on its own axis, compared as one line per row
- Use when: Comparing 4 to 8 metrics at once, such as product specs
- Avoid when: The audience sees it for the first time (it needs explaining)
- encoding: label?
- Chart options: dimensions, dimensionLabels, invert, canvasThreshold
- Default highlight: the first series or item

```json
{"type":"parallel","data":[{"model":"Air 13","price":159,"weight":1.24,"battery":18,"perf":72,"screen":13.6},{"model":"Pro 14","price":299,"weight":1.55,"battery":17,"perf":91,"screen":14.2},{"model":"Ultra 16","price":389,"weight":2.14,"battery":14,"perf":97,"screen":16.2}],"encoding":{"label":"model"},"options":{"dimensions":["price","weight","battery","perf","screen"],"dimensionLabels":{"price":"Price (10k KRW)","weight":"Weight (kg)","battery":"Battery (h)","perf":"Performance","screen":"Screen (in)"},"invert":["price","weight"],"highlight":"Air 13"},"card":{"number":"31","title":"Parallel coordinates","subtitle":"Laptop models compared","takeaway":"The Air 13 is light and cheap","level":"advanced"}}
```

## candlestick · Candlestick chart (`<CandlestickChart>`, Advanced, Trend)

- What: Open, high, low and close for each period in one candle
- Use when: Stocks, exchange rates or coins, where the swing within each period matters
- Avoid when: A trend with only one value (a line chart is cleaner)
- encoding: x, open, high, low, close, volume?
- Chart options: ma, upColor, downColor, maxCandles, brush, yDomain, annotations
- Default highlight: the largest value

```json
{"type":"candlestick","data":[{"date":"2025-09-01","open":60800,"high":60900,"low":59500,"close":59700,"volume":1079936},{"date":"2025-09-02","open":59700,"high":60300,"low":59600,"close":60300,"volume":1326769},{"date":"2025-09-03","open":60900,"high":61100,"low":59200,"close":59500,"volume":1430849}],"encoding":{"x":"date","open":"open","high":"high","low":"low","close":"close","volume":"volume"},"options":{"ma":[5,20],"brush":true},"card":{"number":"32","title":"Candlestick chart","subtitle":"Daily candles of a sample stock (KRW)","takeaway":"Higher highs since mid-October","level":"advanced","legend":"auto"}}
```

## segmented · Segmented bar (`<SegmentedBar>`, Basic, Proportion)

- What: One whole split into a bar by share, with a list
- Use when: Showing the mix in one line inside a card (2 to 6 items)
- Avoid when: Comparing similar values, or many items (a bar chart is more accurate)
- encoding: label, value
- Chart options: variant: tall|thin, sort, list
- Default highlight: the largest value

```json
{"type":"segmented","data":[{"method":"Card","amount":412},{"method":"Mobile pay","amount":278},{"method":"Bank transfer","amount":134}],"encoding":{"label":"method","value":"amount"},"options":{"highlight":"Mobile pay"},"card":{"number":"33","title":"Segmented bar","subtitle":"Payment volume by method (100M KRW)","takeaway":"Mobile pay is one in three","level":"basic"}}
```

## skyline · Skyline (`<SkylineChart>`, Intermediate, Trend)

- What: Stacked volume per period as blocks, with a smaller outcome in the same unit standing in front
- Use when: 7 to 40 periods of stacked volume and a smaller outcome in the same unit (failures, retries), as the lead card of a dashboard
- Avoid when: Negative values, precise value comparison (bars are more accurate), or two values in different units (split the chart and link it with syncId)
- encoding: x, y[], series?, front?[]
- Chart options: depth, wall, texture: front|all|none, frontRate
- Default highlight: the largest value

```json
{"type":"skyline","data":[{"day":"2026-10-23","Input":410000,"Cached":317223,"Output":186999,"Reasoning":79534,"Failed":11000,"Retried":10000},{"day":"2026-10-24","Input":446030,"Cached":337921,"Output":202044,"Reasoning":87942,"Failed":15314,"Retried":9190},{"day":"2026-10-25","Input":440886,"Cached":336150,"Output":202507,"Reasoning":87489,"Failed":15398,"Retried":6051}],"encoding":{"x":"day","y":["Input","Cached","Output","Reasoning"],"front":["Failed","Retried"]},"options":{"format":"compact"},"card":{"number":"34","title":"Skyline","subtitle":"Daily tokens, last 14 days","takeaway":"Nov 5 was the busiest day","level":"intermediate"}}
```

## histogram · Histogram (`<HistogramChart>`, Intermediate, Distribution)

- What: Distribution of raw samples with its tail and the share past a limit
- Use when: 30 or more raw samples, such as request latency, where the tail and the share past a limit matter
- Avoid when: Comparing categories (use bars), or fewer than 10 samples (a beeswarm fits better)
- encoding: value?, group?, x0?, x1?, count?
- Chart options: variant: bars|dots|step, marks, threshold, edges, binWidth, bins, log, kde
- Default highlight: the largest value

```json
{"type":"histogram","data":[{"ms":844},{"ms":132},{"ms":147}],"encoding":{"value":"ms"},"options":{"unit":"ms","marks":["p50","p95"],"threshold":{"value":400,"label":"SLO","side":"above"}},"card":{"number":"35","title":"Histogram","subtitle":"API request latency (ms)","takeaway":"1 in 16 requests misses the SLO","level":"intermediate","legend":[{"label":"Over the SLO","color":"accent"},{"label":"Within","color":"neutral"}]}}
```

## scatter · Scatter plot (`<ScatterChart>`, Basic, Relationship)

- What: How two numbers relate, one dot per item, colored by series
- Use when: How two numeric values relate, such as cost and latency per request, with up to 4 series
- Avoid when: x is time (a line works better), or there are more than 50,000 dots
- encoding: x, y, series?, label?
- Chart options: xLabel, yLabel, zero, maxLabels, canvasThreshold, xFormat, hidden, fit: linear, refLines, quadrants, jitter
- Default highlight: none, or the first series when a series channel is set

```json
{"type":"scatter","data":[{"id":"Request 1","model":"Large","cost":7,"ms":2400},{"id":"Request 2","model":"Medium","cost":6,"ms":1500},{"id":"Request 3","model":"Small","cost":3,"ms":660}],"encoding":{"x":"cost","y":"ms","series":"model","label":"id"},"options":{"highlight":"Large","xLabel":"Cost (¢)","yLabel":"Latency (ms)","unit":"ms","refLines":{"y":2000},"quadrants":["Slow and cheap","Slow and costly","Fast and cheap","Fast and costly"]},"card":{"number":"36","title":"Scatter plot","subtitle":"Cost and latency per request by model","takeaway":"Only the large model goes over 2 s","level":"basic","legend":"auto"}}
```

## Common options

- `height` (number): Height in px. Without it, each chart picks a default that fits its width
- `width` (number): Fixed width in px. Without it, the chart fits its parent
- `highlight` (highlight): Item to highlight. An index, a name, an array, or "max" | "min" | "first" | "last" | "none"
- `format` (format): Value format. "number" | "integer" | "percent" (values are already percents: 42 → "42%") | "ratio" (0.42 → "42%") | "compact" | "currency" (KRW for Korean locales, otherwise USD; for another currency pass Intl options with currency) | "decimal" or Intl.NumberFormat options
- `unit` (string): Unit appended to values. For example "%" or "ms"
- `locale` (string, default "en-US"): Locale for numbers, dates and the text a chart writes itself (tooltips, screen reader sentences). "ko" or "ko-*" switches to Korean. Falls back to the ThemeProvider locale
- `animate` (boolean, default true): Entry and update animation
- `duration` (number): Animation length (ms)
- `easing` (spring | easeOut | easeInOut | linear, default "spring"): Motion curve
- `stagger` (number): Delay between items as they enter (ms)
- `reducedMotion` (any, default "auto"): "auto" follows the OS setting. true always turns motion off
- `animateOnView` (boolean, default true): Play when the chart scrolls into view
- `showLabels` (boolean, default true): Labels drawn on the chart (values and names)
- `tooltip` (boolean, default true): Show tooltips
- `syncId` (string): Charts with the same syncId show the hovered x together (line, area, bar, candlestick). <ChartGrid sync> sets one for every chart inside it
- `ariaLabel` (string): Name for screen readers
- `description` (string): Description for screen readers. Built from the data when omitted
