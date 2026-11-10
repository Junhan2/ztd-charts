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
/** 지역 8곳 × 12주 주문. 지역마다 크기와 기울기가 달라요 (North, South는 내려가요) */
const orders = REGIONS.flatMap((region, r) => Array.from({ length: 12 }, (_, w) => ({ week: `2025-${String(w + 1).padStart(2, "0")}-01`, region, orders: 100 + r * 40 + (r < 2 ? -w * 6 : w * (r + 1) * 3) })));
const spec = (extra: Partial<ChartSpec> = {}): ChartSpec => ({ type: "line", data: orders, encoding: { x: "week", y: "orders" }, facet: { by: "region" }, card: { title: "Weekly orders" }, ...extra });
const input = (over: Partial<FacetInput> = {}): FacetInput => ({ type: "line", data: orders, by: "region", chartProps: { x: "week", y: "orders" }, width: 632, locale: "en-US", lang: "en", ...over });

describe("facet: 나누기와 배치", () => {
  it("by 값마다 패널 하나, 값이 처음 나오는 순서", () => {
    const rows = [{ g: "b", v: 1 }, { g: "a", v: 2 }, { g: "b", v: 3 }, { g: "c", v: 4 }];
    const { values, groups, dropped } = facetGroups(rows, "g");
    expect(values).toEqual(["b", "a", "c"]);
    expect(groups.map((g) => g.map((r) => r.v))).toEqual([[1, 3], [2], [4]]);
    expect(dropped).toBe(0);
  });
  it("24개까지만 그리고, 검사기가 뺀 수를 경고해요", () => {
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
  it('빈 값("", null, 필드 없음)은 한 패널로 묶고 "(blank)" 이름을 제목, 차트 이름, 설명에 써요. 행은 빠지지 않아요', () => {
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
    // 그린 그림에도 보이는 제목, 검사기는 빠지는 행이 없어서 경고하지 않아요
    const s: ChartSpec = { type: "line", data: rows, encoding: { x: "w", y: "v" }, facet: { by: "g" }, card: { title: "Orders" } };
    expect(renderSpecToSVG(s)).toMatch(/<g data-facet="">[^]*?>\(blank\)<\/text>/);
    expect(renderToStaticMarkup(<Chart spec={s} width={632} animate={false} />)).toContain('aria-label="Orders, (blank)"');
    expect(validateSpec(s).warnings.map((x) => x.code)).not.toContain("facet_many_panels");
  });
  it("패널 140px 이상으로 들어가는 만큼, 390px 화면 카드 안은 두 칸, 마지막 줄이 혼자 남지 않게 고르게", () => {
    // 390px 화면의 카드 안 폭: 390 - 좌우 여백 32 - 판 여백 20 - 카드 42 = 296
    expect(facetColumns(296, 8)).toBe(2);
    expect(facetColumns(632, 8)).toBe(4);
    // 7칸이 들어가도 8개는 4칸 두 줄
    expect(facetColumns(1100, 8)).toBe(4);
    expect(facetColumns(632, 8, 3)).toBe(3);
    expect(facetColumns(632, 2)).toBe(2);
  });
});

describe("facet: 같은 값 축과 자유 축", () => {
  it("같은 값 축은 모든 행의 범위로 한 번 재서 모든 패널에 같아요", () => {
    const plan = planFacets(input());
    const all = extent(orders.map((r) => r.orders));
    const want = fitDomain(all[0], all[1], Math.max(2, Math.round(plan.ph / 70)), { zero: false });
    for (const pn of plan.panels) expect(pn.props.yDomain).toEqual(want);
    // 날짜 x도 한 범위
    const xs = orders.map((r) => Date.parse(`${r.week}T00:00:00`));
    expect(plan.panels[0].props.xDomain).toEqual(extent(xs));
    // 값 축 글자는 왼쪽 열에만, x 글자는 아래가 빈 패널에만 (8개 4칸이면 아래 줄 4개)
    expect(plan.panels.map((p) => p.props.showYAxis)).toEqual([true, false, false, false, true, false, false, false]);
    expect(plan.panels.map((p) => p.props.showXAxis)).toEqual([false, false, false, false, true, true, true, true]);
  });
  it("같은 값 축이면 날짜 범위가 다른 패널도 x 눈금(자리와 글자 꼴)이 같고, 자유 축은 패널마다예요", () => {
    // 한 지역은 1~12월, 다른 지역은 6~8월. 두 패널 모두 아래 줄이라 x 글자를 그려요
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
  it("같은 값 축에서 x 값이 적으면(1~12주) 모든 패널이 첫 x부터 같은 간격으로 솎은 같은 눈금을 그려요", () => {
    // 지역 8곳 × x 1~12. 한 지역은 3~9주만 있어도 같은 눈금이에요
    const rows = REGIONS.flatMap((region, r) => Array.from({ length: 12 }, (_, w) => ({ w: w + 1, region, v: 100 + r * 10 + w })).filter((d) => r !== 5 || (d.w >= 3 && d.w <= 9)));
    const s: ChartSpec = { type: "line", data: rows, encoding: { x: "w", y: "v" }, facet: { by: "region" } };
    const plan = planFacets(input({ data: rows, chartProps: { x: "w", y: "v" } }));
    const lists = plan.panels.map((p) => (p.props.xTicks as { label: string }[]).map((t) => t.label).join(" "));
    expect(new Set(lists).size).toBe(1);
    expect(lists[0]).toBe("1 3 5 7 9 11");
    // 그린 그림: 아래 줄 네 패널의 x 글자가 모두 같은 목록 (720px 서버 그림의 안쪽 폭 632px, 4칸)
    const drawn = renderToStaticMarkup(<Chart spec={s} width={632} animate={false} />)
      .split('data-facet="')
      .slice(1)
      .map((part) => [...part.matchAll(/text-anchor="middle"[^>]*>([^<]+)</g)].map((m) => m[1]).join(" "))
      .filter(Boolean);
    expect(drawn).toEqual(["1 3 5 7 9 11", "1 3 5 7 9 11", "1 3 5 7 9 11", "1 3 5 7 9 11"]);
    expect(renderSpecToSVG(s)).toContain(">1</text>");
  });
  it("자유 축은 패널마다 자기 범위이고 모든 패널이 값 축 글자를 그려요", () => {
    const plan = planFacets(input({ scale: "free" }));
    for (const pn of plan.panels) {
      expect(pn.props.yDomain).toBeUndefined();
      expect(pn.props.showYAxis).toBe(true);
      expect(pn.props.showXAxis).toBe(true);
    }
    // 패널마다 그린 y 눈금 글자가 달라요
    const html = renderToStaticMarkup(<Chart spec={spec({ facet: { by: "region", scale: "free" } })} width={632} animate={false} />);
    const ticks = html
      .split('data-facet="')
      .slice(1)
      .map((part) => [...part.matchAll(/text-anchor="end"[^>]*>([^<]+)</g)].map((m) => m[1]).join(","));
    expect(ticks).toHaveLength(8);
    expect(new Set(ticks).size).toBeGreaterThan(1);
  });
});

describe("facet: 묶음, 강조, 접근성", () => {
  it("syncId는 스펙으로 정해져서 몇 번을 만들어도 같고, 데이터가 다르면 달라요. options.syncId가 있으면 그것", () => {
    const a = facetSyncId("line", "region", { x: "week", y: "orders" }, orders);
    expect(facetSyncId("line", "region", { x: "week", y: "orders" }, orders.map((r) => ({ ...r })))).toBe(a);
    expect(facetSyncId("line", "region", { x: "week", y: "orders" }, orders.slice(1))).not.toBe(a);
    expect(new Set(planFacets(input()).panels.map((p) => p.props.syncId))).toEqual(new Set([a]));
    expect(planFacets(input({ syncId: "mine" })).panels.every((p) => p.props.syncId === "mine")).toBe(true);
  });
  it("highlight가 by 값이면 그 패널만 강조색, 나머지는 무채색. 다른 값은 패널마다 그대로", () => {
    const plan = planFacets(input({ highlight: "West" }));
    expect(plan.panels.filter((p) => p.isPicked).map((p) => p.value)).toEqual(["West"]);
    expect(plan.panels.find((p) => p.value === "West")?.props.highlight).toBeUndefined();
    expect(plan.panels.filter((p) => p.value !== "West").every((p) => p.props.highlight === "none")).toBe(true);
    expect(planFacets(input({ highlight: "last" })).panels.every((p) => p.props.highlight === "last" && !p.isPicked)).toBe(true);
    // 그린 그림: 강조색 선은 West 패널에만
    const accent = darkTheme.accent.toLowerCase();
    const svg = renderSpecToSVG(spec({ options: { highlight: "West" } }), { theme: "dark" });
    const panels = svg.split("<g data-facet=").slice(1);
    const withAccent = panels.filter((p) => p.toLowerCase().includes(`stroke="${accent}"`)).map((p) => p.slice(1, p.indexOf('"', 1)));
    expect(withAccent).toEqual(["West"]);
  });
  it("패널마다 온전한 차트: 이름 \"<카드 제목>, <값>\", 키보드 포커스, 숨긴 표. 묶음은 한 문장 설명", () => {
    const html = renderToStaticMarkup(<Chart spec={spec()} width={632} animate={false} />);
    for (const r of REGIONS) expect(html).toContain(`aria-label="Weekly orders, ${r}"`);
    expect(html.match(/class="ztd-root[^"]*" role="group"[^>]*tabindex="0"/g)).toHaveLength(8);
    expect(html.match(/<table>/g)).toHaveLength(8);
    const desc = /<p id="[^"]*fd"[^>]*>([^<]+)<\/p>/.exec(html)?.[1];
    expect(desc).toContain("8 panels by region.");
    expect(desc).toMatch(/Lakes ends highest at /);
    expect(desc).toContain("Lower at the end than at the start: North, South.");
  });
  it("ChartFacets는 스펙 없이도 써요 (계열 하나인 라인은 제목 오른쪽에 마지막 값)", () => {
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

describe("facet: 검사와 스키마", () => {
  it("line, area, bar, scatter가 아니면 오류에 쓸 수 있는 차트를 적어요", () => {
    const v = validateSpec({ type: "pie", data: [{ label: "a", value: 1, g: "x" }], encoding: { label: "label", value: "value" }, facet: { by: "g" } });
    expect(v.valid).toBe(false);
    expect(v.errors.find((e) => e.code === "facet_unsupported")?.message).toBe("facet works on line, area, bar, scatter charts, not on pie");
    expect(validateSpec({ type: "pie", data: [{ label: "a", value: 1, g: "x" }], facet: { by: "g" } }, { lang: "ko" }).errors.find((e) => e.code === "facet_unsupported")?.message).toContain("line, area, bar, scatter 차트에서만");
  });
  it('양쪽 막대(layout "diverging")와 tileMap에는 facet을 쓰지 않아요: 검사기 오류, <Chart>는 차트 하나', () => {
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
  it("by가 데이터에 없으면 가까운 필드 이름을 권해요 (영어, 한국어)", () => {
    const bad = spec({ facet: { by: "regoin" } });
    const en = validateSpec(bad).errors.find((e) => e.path === "facet.by");
    expect(en?.code).toBe("field_not_found");
    expect(en?.message).toContain('Did you mean "region"?');
    expect(validateSpec(bad, { lang: "ko" }).errors.find((e) => e.path === "facet.by")?.message).toContain('"region"인가요?');
  });
  it("columns가 양의 정수가 아니거나 scale이 두 값이 아니면 오류 (영어, 한국어)", () => {
    for (const columns of ["2} onLoad={alert(1)", 0, 1.5, -2]) {
      const bad = spec({ facet: { by: "region", columns: columns as number } });
      expect(validateSpec(bad).errors.find((e) => e.path === "facet.columns")?.message).toBe("facet.columns must be a whole number of 1 or more");
      expect(validateSpec(bad, { lang: "ko" }).errors.find((e) => e.path === "facet.columns")?.message).toBe("facet.columns 값은 1 이상의 정수여야 해요");
    }
    const scale = spec({ facet: { by: "region", scale: "both" as "free" } });
    expect(validateSpec(scale).errors.find((e) => e.path === "facet.scale")?.message).toBe('facet.scale must be "shared" or "free"');
    expect(validateSpec(scale, { lang: "ko" }).errors.find((e) => e.path === "facet.scale")?.message).toBe('facet.scale 값은 "shared"나 "free"여야 해요');
    expect(validateSpec(spec({ facet: { by: "region", columns: 3, scale: "free" } })).valid).toBe(true);
    // 검사를 거치지 않는 <Chart>에서도 틀린 columns는 없는 것으로 봐요
    expect(facetColumns(632, 8, "2} onLoad" as unknown as number)).toBe(facetColumns(632, 8));
  });
  it("지역마다 같은 주는 더한 것으로 보지 않아요 (중복 x 경고는 패널마다)", () => {
    expect(validateSpec(spec()).warnings.map((w) => w.code)).not.toContain("duplicate_x");
    expect(validateSpec(spec({ facet: undefined })).warnings.map((w) => w.code)).toContain("duplicate_x");
  });
  it("스키마는 네 차트에만 facet을 적어요", () => {
    expect(schemaFor("line")?.properties).toHaveProperty("facet");
    expect(schemaFor("scatter")?.properties).toHaveProperty("facet");
    expect(schemaFor("pie")?.properties).not.toHaveProperty("facet");
    const ajv = new Ajv2020({ strict: false });
    const check = ajv.compile(specSchema());
    expect(check(spec())).toBe(true);
    expect(check({ type: "pie", data: [], facet: { by: "g" } })).toBe(false);
  });
});

describe("facet: 서버 SVG", () => {
  it("독립 SVG 하나에 카드 틀과 by 값마다 패널 하나, 두 번 그려도 같아요", () => {
    const s = spec({ card: { title: "Weekly orders", takeaway: "Lakes grows fastest", source: "Sample" } });
    const a = renderSpecToSVG(s);
    expect(a.match(/<svg xmlns=/g)).toHaveLength(1);
    expect([...a.matchAll(/<g data-facet="([^"]+)">/g)].map((m) => m[1])).toEqual(REGIONS);
    expect(a).toContain("Weekly orders");
    expect(a).toContain("Lakes grows fastest");
    expect(a).not.toMatch(/var\(|color-mix/);
    expect(renderSpecToSVG(s)).toBe(a);
  });
  it('facet 값의 <, ", &는 서버 SVG와 HTML에서 이스케이프돼요 (패널 제목, data-facet, 이름)', () => {
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
