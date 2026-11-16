import Ajv2020 from "ajv/dist/2020";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Chart } from "../src/charts/Chart";
import { LineChart } from "../src/charts/line";
import { ChartFacets } from "../src/components/ChartFacets";
import { facetColumns, facetGroups, facetSyncId, planFacets, type FacetInput } from "../src/core/facet";
import { extent, fitDomain } from "../src/core/scale";
import { renderSpecToHTML, renderSpecToSVG } from "../src/server";
import { schemaFor, specSchema, validateSpec, type ChartSpec } from "../src/spec";
import { ThemeProvider } from "../src/theme/context";
import { darkTheme } from "../src/theme/tokens";

const REGIONS = ["North", "South", "East", "West", "Central", "Coast", "Hills", "Lakes"];
/** Orders for 8 regions × 12 weeks. Each region has its own size and slope (North and South go down) */
const orders = REGIONS.flatMap((region, r) => Array.from({ length: 12 }, (_, w) => ({ week: `2025-${String(w + 1).padStart(2, "0")}-01`, region, orders: 100 + r * 40 + (r < 2 ? -w * 6 : w * (r + 1) * 3) })));
const spec = (extra: Partial<ChartSpec> = {}): ChartSpec => ({ type: "line", data: orders, encoding: { x: "week", y: "orders" }, facet: { by: "region" }, card: { title: "Weekly orders" }, ...extra });
const input = (over: Partial<FacetInput> = {}): FacetInput => ({ type: "line", data: orders, by: "region", chartProps: { x: "week", y: "orders" }, width: 632, locale: "en-US", lang: "en", ...over });

describe("facet: splitting and layout", () => {
  it("one panel per by value, in first-seen order", () => {
    const rows = [{ g: "b", v: 1 }, { g: "a", v: 2 }, { g: "b", v: 3 }, { g: "c", v: 4 }];
    const { values, groups, dropped } = facetGroups(rows, "g");
    expect(values).toEqual(["b", "a", "c"]);
    expect(groups.map((g) => g.map((r) => r.v))).toEqual([[1, 3], [2], [4]]);
    expect(dropped).toBe(0);
  });
  it("draws only up to 24 and the validator warns with the count left out", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ x: 1, y: i, k: `k${i}` }));
    const g = facetGroups(rows, "k");
    expect(g.values).toHaveLength(24);
    expect(g.values[23]).toBe("k23");
    expect(g.dropped).toBe(6);
    const v = validateSpec({ type: "bar", data: rows, encoding: { x: "x", y: "y" }, facet: { by: "k" } });
    expect(v.valid).toBe(true);
    const w = v.warnings.find((x) => x.code === "facet_many_panels");
    expect(w?.path).toBe("facet.by");
    expect(w?.message).toContain("Only the first 24 panels are drawn, so 6 values are (6 rows) left out");
    expect(validateSpec({ type: "bar", data: rows, encoding: { x: "x", y: "y" }, facet: { by: "k" } }, { lang: "ko" }).warnings.find((x) => x.code === "facet_many_panels")?.message).toContain("6개 값(6행)은 빠져요");
  });
  it('empty values ("", null, missing field) group into one panel, named "(blank)" in its title, chart name and description. No rows are dropped', () => {
    const rows = [
      { w: "W1", g: "A", v: 1 },
      { w: "W2", g: "A", v: 2 },
      { w: "W1", g: "", v: 3 },
      { w: "W2", g: null, v: 4 },
      { w: "W3", v: 5 },
    ];
    const g = facetGroups(rows, "g");
    expect(g.values).toEqual(["A", ""]);
    expect(g.groups.map((x) => x.length)).toEqual([2, 3]);
    expect(g.groups.flat()).toHaveLength(rows.length);
    const plan = planFacets(input({ data: rows, chartProps: { x: "w", y: "v" }, by: "g", title: "Orders" }));
    expect(plan.panels.map((p) => p.label)).toEqual(["A", "(blank)"]);
    expect(plan.panels[1].props.ariaLabel).toBe("Orders, (blank)");
    expect(plan.description).toContain("(blank)");
    expect(planFacets(input({ data: rows, chartProps: { x: "w", y: "v" }, by: "g", lang: "ko", locale: "ko-KR" })).panels[1].label).toBe("(빈 값)");
    // The title shows in the drawn chart too, and the validator does not warn because no rows are left out
    const s: ChartSpec = { type: "line", data: rows, encoding: { x: "w", y: "v" }, facet: { by: "g" }, card: { title: "Orders" } };
    expect(renderSpecToSVG(s)).toMatch(/<g data-facet="">[^]*?>\(blank\)<\/text>/);
    expect(renderToStaticMarkup(<Chart spec={s} width={632} animate={false} />)).toContain('aria-label="Orders, (blank)"');
    expect(validateSpec(s).warnings.map((x) => x.code)).not.toContain("facet_many_panels");
  });
  it("as many columns as fit at 140px or more per panel, two inside a card on a 390px screen, balanced so the last row is not left alone", () => {
    // Inner card width on a 390px screen: 390 - side margins 32 - stage padding 20 - card 42 = 296
    expect(facetColumns(296, 8)).toBe(2);
    expect(facetColumns(632, 8)).toBe(4);
    // Even when 7 columns fit, 8 panels go in 4 columns, two rows
    expect(facetColumns(1100, 8)).toBe(4);
    expect(facetColumns(632, 8, 3)).toBe(3);
    expect(facetColumns(632, 2)).toBe(2);
  });
});

describe("facet: shared and free value axes", () => {
  it("a shared value axis is measured once over all rows and is the same in every panel", () => {
    const plan = planFacets(input());
    const all = extent(orders.map((r) => r.orders));
    const want = fitDomain(all[0], all[1], Math.max(2, Math.round(plan.ph / 70)), { zero: false });
    for (const pn of plan.panels) expect(pn.props.yDomain).toEqual(want);
    // Date x shares one domain too
    const xs = orders.map((r) => Date.parse(`${r.week}T00:00:00`));
    expect(plan.panels[0].props.xDomain).toEqual(extent(xs));
    // Value axis labels only in the left column, x labels only on panels with nothing below (with 8 panels in 4 columns, the 4 in the bottom row)
    expect(plan.panels.map((p) => p.props.showYAxis)).toEqual([true, false, false, false, true, false, false, false]);
    expect(plan.panels.map((p) => p.props.showXAxis)).toEqual([false, false, false, false, true, true, true, true]);
  });
  it("with a shared axis, panels with different date ranges get the same x ticks (position and label form), and a free axis is per panel", () => {
    // One region spans January to December, the other June to August. Both panels are in the bottom row, so both draw x labels
    const months = (from: number, to: number, region: string) => Array.from({ length: to - from + 1 }, (_, i) => ({ m: `2025-${String(from + i).padStart(2, "0")}-01`, region, v: 10 + i }));
    const rows = [...months(1, 12, "Year"), ...months(6, 8, "Summer")];
    const xTicks = (scale: "shared" | "free") =>
      renderToStaticMarkup(<Chart spec={{ type: "line", data: rows, encoding: { x: "m", y: "v" }, facet: { by: "region", scale } }} width={632} animate={false} />)
        .split('data-facet="')
        .slice(1)
        .map((part) => [...part.matchAll(/text-anchor="middle"[^>]*>([^<]+)</g)].map((m) => m[1]).join(","));
    const shared = xTicks("shared");
    expect(shared).toHaveLength(2);
    expect(shared[0]).not.toBe("");
    expect(shared[1]).toBe(shared[0]);
    const free = xTicks("free");
    expect(free[1]).not.toBe(free[0]);
  });
  it("with a shared axis and few x values (weeks 1~12), every panel draws the same ticks thinned at the same step from the first x", () => {
    // 8 regions × x 1~12. Even when one region has only weeks 3~9, the ticks are the same
    const rows = REGIONS.flatMap((region, r) => Array.from({ length: 12 }, (_, w) => ({ w: w + 1, region, v: 100 + r * 10 + w })).filter((d) => r !== 5 || (d.w >= 3 && d.w <= 9)));
    const s: ChartSpec = { type: "line", data: rows, encoding: { x: "w", y: "v" }, facet: { by: "region" } };
    const plan = planFacets(input({ data: rows, chartProps: { x: "w", y: "v" } }));
    const lists = plan.panels.map((p) => (p.props.xTicks as { label: string }[]).map((t) => t.label).join(" "));
    expect(new Set(lists).size).toBe(1);
    expect(lists[0]).toBe("1 3 5 7 9 11");
    // Drawn chart: the four bottom-row panels all have the same x label list (632px inner width of the 720px server render, 4 columns)
    const drawn = renderToStaticMarkup(<Chart spec={s} width={632} animate={false} />)
      .split('data-facet="')
      .slice(1)
      .map((part) => [...part.matchAll(/text-anchor="middle"[^>]*>([^<]+)</g)].map((m) => m[1]).join(" "))
      .filter(Boolean);
    expect(drawn).toEqual(["1 3 5 7 9 11", "1 3 5 7 9 11", "1 3 5 7 9 11", "1 3 5 7 9 11"]);
    expect(renderSpecToSVG(s)).toContain(">1</text>");
  });
  it("a free axis uses each panel's own range and every panel draws value axis labels", () => {
    const plan = planFacets(input({ scale: "free" }));
    for (const pn of plan.panels) {
      expect(pn.props.yDomain).toBeUndefined();
      expect(pn.props.showYAxis).toBe(true);
      expect(pn.props.showXAxis).toBe(true);
    }
    // Each panel draws different y tick labels
    const html = renderToStaticMarkup(<Chart spec={spec({ facet: { by: "region", scale: "free" } })} width={632} animate={false} />);
    const ticks = html
      .split('data-facet="')
      .slice(1)
      .map((part) => [...part.matchAll(/text-anchor="end"[^>]*>([^<]+)</g)].map((m) => m[1]).join(","));
    expect(ticks).toHaveLength(8);
    expect(new Set(ticks).size).toBeGreaterThan(1);
  });
});

describe("facet: group, highlight, accessibility", () => {
  it("syncId comes from the spec, so it is the same on every build and differs for different data. options.syncId wins when set", () => {
    const a = facetSyncId("line", "region", { x: "week", y: "orders" }, orders);
    expect(facetSyncId("line", "region", { x: "week", y: "orders" }, orders.map((r) => ({ ...r })))).toBe(a);
    expect(facetSyncId("line", "region", { x: "week", y: "orders" }, orders.slice(1))).not.toBe(a);
    expect(new Set(planFacets(input()).panels.map((p) => p.props.syncId))).toEqual(new Set([a]));
    expect(planFacets(input({ syncId: "mine" })).panels.every((p) => p.props.syncId === "mine")).toBe(true);
  });
  it("a highlight that is a by value accents only that panel and leaves the rest neutral. Other values pass through to each panel", () => {
    const plan = planFacets(input({ highlight: "West" }));
    expect(plan.panels.filter((p) => p.isPicked).map((p) => p.value)).toEqual(["West"]);
    expect(plan.panels.find((p) => p.value === "West")?.props.highlight).toBeUndefined();
    expect(plan.panels.filter((p) => p.value !== "West").every((p) => p.props.highlight === "none")).toBe(true);
    expect(planFacets(input({ highlight: "last" })).panels.every((p) => p.props.highlight === "last" && !p.isPicked)).toBe(true);
    // Drawn chart: the accent line is only in the West panel
    const accent = darkTheme.accent.toLowerCase();
    const svg = renderSpecToSVG(spec({ options: { highlight: "West" } }), { theme: "dark" });
    const panels = svg.split("<g data-facet=").slice(1);
    const withAccent = panels.filter((p) => p.toLowerCase().includes(`stroke="${accent}"`)).map((p) => p.slice(1, p.indexOf('"', 1)));
    expect(withAccent).toEqual(["West"]);
  });
  it("each panel is a full chart: name \"<card title>, <value>\", keyboard focus, hidden table. The group gets a one-sentence description", () => {
    const html = renderToStaticMarkup(<Chart spec={spec()} width={632} animate={false} />);
    for (const r of REGIONS) expect(html).toContain(`aria-label="Weekly orders, ${r}"`);
    expect(html.match(/class="ztd-root[^"]*" role="group"[^>]*tabindex="0"/g)).toHaveLength(8);
    expect(html.match(/<table>/g)).toHaveLength(8);
    const desc = /<p id="[^"]*fd"[^>]*>([^<]+)<\/p>/.exec(html)?.[1];
    expect(desc).toContain("8 panels by region.");
    expect(desc).toMatch(/Lakes ends highest at /);
    expect(desc).toContain("Lower at the end than at the start: North, South.");
  });
  it("ChartFacets works without a spec (a single-series line shows the last value right of the title)", () => {
    const html = renderToStaticMarkup(
      <ThemeProvider theme="light">
        <ChartFacets chart={LineChart} type="line" data={orders} by="region" chartProps={{ x: "week", y: "orders", animate: false }} width={632} title="Orders" />
      </ThemeProvider>,
    );
    expect(html.match(/data-facet="/g)).toHaveLength(8);
    expect(html).toContain('aria-label="Orders, West"');
    const north = orders.filter((r) => r.region === "North");
    expect(html).toContain(`>${north[north.length - 1].orders}</span>`);
  });
});

describe("facet: validation and schema", () => {
  it("for charts other than line, area, bar, scatter, the error lists the charts that can be used", () => {
    const v = validateSpec({ type: "pie", data: [{ label: "a", value: 1, g: "x" }], encoding: { label: "label", value: "value" }, facet: { by: "g" } });
    expect(v.valid).toBe(false);
    expect(v.errors.find((e) => e.code === "facet_unsupported")?.message).toBe("facet works on line, area, bar, scatter charts, not on pie");
    expect(validateSpec({ type: "pie", data: [{ label: "a", value: 1, g: "x" }], facet: { by: "g" } }, { lang: "ko" }).errors.find((e) => e.code === "facet_unsupported")?.message).toContain("line, area, bar, scatter 차트에서만");
  });
  it('diverging bars (layout "diverging") and tileMap take no facet: a validator error, and <Chart> draws one chart', () => {
    const rows = [{ q: "A", g: "x", no: 3, yes: 5 }, { q: "B", g: "y", no: 2, yes: 4 }];
    const div: ChartSpec = { type: "bar", data: rows, encoding: { x: "q", y: ["no", "yes"] }, options: { layout: "diverging", negative: ["no"], orientation: "horizontal" }, facet: { by: "g" } };
    const err = validateSpec(div).errors.find((e) => e.path === "facet");
    expect(err?.code).toBe("facet_unsupported");
    expect(err?.message).toContain('layout "diverging"');
    expect(validateSpec(div, { lang: "ko" }).errors.find((e) => e.path === "facet")?.message).toContain('layout "diverging"과 함께 쓰지 않아요');
    expect(renderToStaticMarkup(<Chart spec={div} width={480} animate={false} />)).not.toContain("data-facet=");
    const tile = validateSpec({ type: "tileMap", data: [{ id: "x", v: 1, g: "a" }], facet: { by: "g" } });
    expect(tile.errors.find((e) => e.code === "facet_unsupported")?.message).toContain("facet works on line, area, bar, scatter charts, not on tileMap");
  });
  it("suggests a close field name when by is not in the data (English, Korean)", () => {
    const bad = spec({ facet: { by: "regoin" } });
    const en = validateSpec(bad).errors.find((e) => e.path === "facet.by");
    expect(en?.code).toBe("field_not_found");
    expect(en?.message).toContain('Did you mean "region"?');
    expect(validateSpec(bad, { lang: "ko" }).errors.find((e) => e.path === "facet.by")?.message).toContain('"region"인가요?');
  });
  it("errors when columns is not a positive integer or scale is not one of the two values (English, Korean)", () => {
    for (const columns of ["2} onLoad={alert(1)", 0, 1.5, -2]) {
      const bad = spec({ facet: { by: "region", columns: columns as number } });
      expect(validateSpec(bad).errors.find((e) => e.path === "facet.columns")?.message).toBe("facet.columns must be a whole number of 1 or more");
      expect(validateSpec(bad, { lang: "ko" }).errors.find((e) => e.path === "facet.columns")?.message).toBe("facet.columns 값은 1 이상의 정수여야 해요");
    }
    const scale = spec({ facet: { by: "region", scale: "both" as "free" } });
    expect(validateSpec(scale).errors.find((e) => e.path === "facet.scale")?.message).toBe('facet.scale must be "shared" or "free"');
    expect(validateSpec(scale, { lang: "ko" }).errors.find((e) => e.path === "facet.scale")?.message).toBe('facet.scale 값은 "shared"나 "free"여야 해요');
    expect(validateSpec(spec({ facet: { by: "region", columns: 3, scale: "free" } })).valid).toBe(true);
    // Even in <Chart>, which skips validation, an invalid columns value is treated as absent
    expect(facetColumns(632, 8, "2} onLoad" as unknown as number)).toBe(facetColumns(632, 8));
  });
  it("does not treat the same week in different regions as added (the duplicate x warning is per panel)", () => {
    expect(validateSpec(spec()).warnings.map((w) => w.code)).not.toContain("duplicate_x");
    expect(validateSpec(spec({ facet: undefined })).warnings.map((w) => w.code)).toContain("duplicate_x");
  });
  it("the schema lists facet only for the four charts", () => {
    expect(schemaFor("line")?.properties).toHaveProperty("facet");
    expect(schemaFor("scatter")?.properties).toHaveProperty("facet");
    expect(schemaFor("pie")?.properties).not.toHaveProperty("facet");
    const ajv = new Ajv2020({ strict: false });
    const check = ajv.compile(specSchema());
    expect(check(spec())).toBe(true);
    expect(check({ type: "pie", data: [], facet: { by: "g" } })).toBe(false);
  });
});

describe("facet: server SVG", () => {
  it("one standalone SVG with the card frame and one panel per by value, the same when drawn twice", () => {
    const s = spec({ card: { title: "Weekly orders", takeaway: "Lakes grows fastest", source: "Sample" } });
    const a = renderSpecToSVG(s);
    expect(a.match(/<svg xmlns=/g)).toHaveLength(1);
    expect([...a.matchAll(/<g data-facet="([^"]+)">/g)].map((m) => m[1])).toEqual(REGIONS);
    expect(a).toContain("Weekly orders");
    expect(a).toContain("Lakes grows fastest");
    expect(a).not.toMatch(/var\(|color-mix/);
    expect(renderSpecToSVG(s)).toBe(a);
  });
  it('<, ", & in facet values are escaped in server SVG and HTML (panel title, data-facet, name)', () => {
    const hostile = '<b onload="x">R&D</b>';
    const rows = orders.map((r) => (r.region === "West" ? { ...r, region: hostile } : r));
    const s = spec({ data: rows, options: { highlight: hostile } });
    const svg = renderSpecToSVG(s);
    const html = renderSpecToHTML(s);
    for (const out of [svg, html]) {
      expect(out).not.toContain(hostile);
      expect(out).not.toContain("<b onload");
      expect(out).toContain("&lt;b onload=&quot;x&quot;&gt;R&amp;D&lt;/b&gt;");
    }
    expect(svg).toContain('<g data-facet="&lt;b onload=&quot;x&quot;&gt;R&amp;D&lt;/b&gt;">');
    expect(html).toContain('aria-label="Weekly orders, &lt;b onload=&quot;x&quot;&gt;R&amp;D&lt;/b&gt;"');
  });
});
