import { createHash } from "node:crypto";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarChart, type BarChartProps } from "../src/charts/bar";
import { Chart } from "../src/charts/Chart";
import { CARD_TEXT, ChartCard, ChartGrid, ChartState } from "../src/components/ChartCard";
import { columnsOf, csvText, fileName } from "../src/components/download";
import { downloadFields } from "../src/spec/meta";
import { templateTooltip } from "../src/charts/tooltipTemplate";
import { renderSpecToHTML, renderSpecToSVG } from "../src/server";
import { CHARTS, VARIANTS, variantSpec } from "../src/spec";
import { ThemeProvider } from "../src/theme/context";
import { lightTheme } from "../src/theme/tokens";

function ssr(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

function summarize(svg: string) {
  const count = (re: RegExp) => (svg.match(re) ?? []).length;
  const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).filter(Boolean);
  return {
    paths: count(/<path /g),
    rects: count(/<rect /g),
    circles: count(/<circle /g),
    lines: count(/<line /g),
    texts: texts.slice(0, 16),
    sha1: createHash("sha1").update(svg).digest("hex").slice(0, 12),
  };
}

describe("SSR: all 44 types", () => {
  for (const c of CHARTS) {
    for (const theme of ["dark", "light"] as const) {
      it(`${c.type} (${theme})`, () => {
        const html = ssr(
          <ThemeProvider theme={theme}>
            <Chart spec={c.example} width={640} animate={false} />
          </ThemeProvider>,
        );
        expect(html).toContain('role="img"');
        expect(html).toContain('aria-roledescription="chart"');
        const ids = /aria-labelledby="([^"]+)"/.exec(html)![1].split(" ");
        for (const id of ids) expect(html).toContain(`id="${id}"`);
        expect(html).toMatch(/<desc id="[^"]+">[^<]{10,}<\/desc>/);
        const marks = (html.match(/<(path|rect|circle|line) /g) ?? []).length;
        expect(marks, `${c.type} marks`).toBeGreaterThan(2);
        expect(html).not.toContain("NaN");
        expect(html).not.toContain("Infinity");
      });
    }
  }
});

describe("renderSpecToSVG (standalone SVG for resvg)", () => {
  it("every example draws without var() or color-mix", () => {
    for (const c of CHARTS) {
      const svg = renderSpecToSVG(c.example, { width: 720, theme: "light" });
      expect(svg.startsWith("<svg xmlns")).toBe(true);
      expect(svg).not.toContain("var(--");
      expect(svg).not.toContain("color-mix");
      expect(svg).not.toContain("NaN");
      expect(svg).toContain(c.example.card?.title ?? "");
    }
  });
  it("structure snapshot (geometry regression check)", () => {
    const out: Record<string, ReturnType<typeof summarize>> = {};
    for (const c of CHARTS) out[c.type] = summarize(renderSpecToSVG(c.example, { width: 720, theme: "dark", frame: false }));
    expect(out).toMatchSnapshot();
  });
  it("a wrong spec fails with a reason", () => {
    expect(() => renderSpecToSVG({ type: "pie", data: [{ a: 1 }], encoding: { label: "x", value: "a" } })).toThrow(/x/);
  });
  it("card legend wraps to fit in a narrow card, and donut draws only its own legend", () => {
    const data = ["Very long category name that keeps going on and on", "아주 긴 한국어 범주 이름이 계속 이어지는 경우", "AnotherExtremelyLongSingleWordWithoutSpaces", "Short"].map((label, i) => ({ label, value: 40 - i * 9 }));
    const svg = renderSpecToSVG({ type: "pie", data, card: { title: "Pie", legend: "auto" } }, { width: 390, theme: "light" });
    const legend = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="11.5"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: +m[1], y: +m[2], label: m[3] }));
    expect(legend.map((l) => l.label).sort()).toEqual(data.map((d) => d.label).sort());
    expect(new Set(legend.map((l) => l.y)).size).toBeGreaterThan(1);
    expect(Math.min(...legend.map((l) => l.x))).toBeGreaterThanOrEqual(24 + 20 + 15);
    const donut = renderSpecToSVG({ type: "donut", data, card: { title: "Donut", legend: "auto" } }, { width: 390, theme: "light" });
    expect(donut.match(/font-size="11.5"/g) ?? []).toHaveLength(0);
    expect(renderSpecToSVG({ type: "donut", data, options: { legend: "none" }, card: { title: "Donut", legend: "auto" } }, { width: 390 }).match(/font-size="11.5"/g)).toHaveLength(4);
  });
  it("HTML holds the document and theme variables", () => {
    const html = renderSpecToHTML(CHARTS[0].example, { theme: "light" });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain(`--ztd-accent: ${lightTheme.accent}`);
    expect(html).toContain("ztd-card");
  });
  it("static HTML draws no replay button, since it would not work", () => {
    expect(renderSpecToHTML(CHARTS[0].example)).not.toContain("Replay animation");
    expect(renderSpecToHTML(CHARTS[0].example, { interactive: { libraryUrl: "data:text/javascript,0" } })).toContain("Replay animation");
  });
});

describe("card source line and title accent", () => {
  const base = { type: "bar", data: [{ x: "A", y: 1 }, { x: "B", y: 2 }], encoding: { x: "x", y: "y" } };
  const strip = (h: string) => h.replace(/<!-- -->/g, "");
  it("source and note go in one line below the chart, and the server card grows by one line (27px)", () => {
    const spec = { ...base, card: { title: "T", source: "통계청", note: "2025-10 기준" } };
    expect(strip(ssr(<Chart spec={spec} animate={false} />))).toContain("Source: 통계청 · 2025-10 기준");
    expect(strip(ssr(<Chart spec={{ ...spec, options: { locale: "ko" } }} animate={false} />))).toContain("출처: 통계청 · 2025-10 기준");
    const height = (svg: string) => Number(/height="([\d.]+)"/.exec(svg)![1]);
    const withLine = renderSpecToSVG(spec, { width: 560 });
    expect(withLine).toContain("Source: 통계청 · 2025-10 기준");
    expect(height(withLine) - height(renderSpecToSVG({ ...base, card: { title: "T" } }, { width: 560 }))).toBe(27);
  });
  it("only the accent word in the title is accent colored, and the chart name is the title as is", () => {
    const spec = { ...base, card: { title: "올해 매출이 가장 커요", accent: "올해" } };
    const html = ssr(<Chart spec={spec} animate={false} />);
    expect(html).toMatch(/<span style="color:var\(--ztd-accent-text[^"]*">올해<\/span>/);
    expect(html).toContain('aria-label="올해 매출이 가장 커요"');
    expect(renderSpecToSVG(spec, { width: 560, theme: "light" })).toContain(`<tspan fill="${lightTheme.accentText}">올해</tspan>`);
  });
  it("download: true gives three buttons, an array gives only the chosen ones (in CSV, SVG, PNG order), and static HTML and SVG have none", () => {
    const labels = (h: string) => [...h.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]).filter((l) => /CSV|SVG|PNG/.test(l));
    const card = (download?: unknown, locale?: string) => ssr(<Chart spec={{ ...base, card: { title: "T", download }, ...(locale ? { options: { locale } } : {}) } as never} animate={false} />);
    expect(labels(card(true))).toEqual(["Download CSV", "Download SVG", "Download PNG"]);
    expect(labels(card(["png", "csv"]))).toEqual(["Download CSV", "Download PNG"]);
    expect(labels(card(true, "ko"))).toEqual(["CSV 내려받기", "SVG 내려받기", "PNG 내려받기"]);
    expect(labels(card(undefined))).toEqual([]);
    expect(labels(card(false))).toEqual([]);
    const spec = { ...base, card: { title: "T", download: true as const } };
    expect(labels(renderSpecToHTML(spec))).toEqual([]);
    expect(labels(renderSpecToHTML(spec, { interactive: { libraryUrl: "https://example.test/ztd-charts.js" } }))).toHaveLength(3);
    expect(renderSpecToSVG(spec, { width: 560 })).not.toMatch(/Download|<button/);
  });
  it("CSV: BOM, CRLF, every text cell quoted, and text that starts like a formula gets a leading '", () => {
    // Text that toNumber reads as a number, like "+1 234", cannot be a formula, so it is left as is
    const row = { a: "=1+1", b: -5, c: "-5", d: "＝cmd", e: "x;y", f: 'say "hi"', g: null, h: new Date(2024, 2, 5), i: "+82-10-1234", j: Number.NaN, k: "+1 234" };
    const text = csvText([row], Object.keys(row));
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toBe(`"a","b","c","d","e","f","g","h","i","j","k"\r\n"'=1+1",-5,"-5","'＝cmd","x;y","say ""hi""",,"2024-03-05","'+82-10-1234",,"+1 234"\r\n`);
  });
  it("CSV columns are only those the chart draws: channel order, arrays spread out, column name options too. Without them the button writes every column", () => {
    expect(downloadFields({ type: "line", encoding: { series: "s", y: "v", x: "d" } })).toEqual(["d", "v", "s"]);
    expect(downloadFields({ type: "line", encoding: { x: "d", y: ["a", "b"], lower: ["la", "lb"], upper: ["ua", "ub"] } })).toEqual(["d", "a", "b", "la", "lb", "ua", "ub"]);
    expect(downloadFields({ type: "parallel", encoding: { label: "name" }, options: { dimensions: ["p", "q"] } })).toEqual(["name", "p", "q"]);
    expect(downloadFields({ type: "bar", encoding: { x: "a", y: ["b", "a"] } })).toEqual(["a", "b"]);
    expect(downloadFields({ type: "parallel" })).toEqual([]);
    expect(columnsOf([{ a: 1 }, { b: 2, a: 3 }])).toEqual(["a", "b"]);
    expect(fileName('매출 / 2025: "상반기"\n')).toBe("매출 - 2025- -상반기-");
    expect(fileName("   ")).toBe("chart");
  });
});

describe("interactive HTML that takes over the server image", () => {
  const bar = CHARTS.find((c) => c.type === "bar")!.example;
  const cfgOf = (html: string) => JSON.parse(/<script type="application\/json" id="ztd-chart-config">([^<]*)<\/script>/.exec(html)![1]);
  it("carries the config and code, and draws the chart at the .wrap content width so it can take over", () => {
    const html = renderSpecToHTML(bar, { interactive: { script: "/*x*/" }, theme: "light" });
    const cfg = cfgOf(html);
    expect(cfg.width).toBe(678);
    expect(cfg.spec.type).toBe("bar");
    expect(cfg.theme).toEqual(JSON.parse(JSON.stringify(lightTheme)));
    expect(/<div id="chart">([\s\S]*?)<\/div><\/main>/.exec(html)![1]).toBe(
      renderToString(
        <ThemeProvider theme={lightTheme} cssVars>
          <Chart spec={bar} width={678} animate={false} />
        </ThemeProvider>,
      ),
    );
    expect(html).toContain("<script type=\"module\">/*x*/</script>");
    expect(html).not.toMatch(/esm\.sh|importmap/);
    expect(cfgOf(renderSpecToHTML(bar, { interactive: { script: "" }, frame: false })).width).toBe(720);
    expect(cfgOf(renderSpecToHTML({ ...bar, options: { ...bar.options, width: 500 } }, { interactive: { script: "" } }))).not.toHaveProperty("width");
  });
  it("blocks code containing </script or <!--", () => {
    expect(() => renderSpecToHTML(bar, { interactive: { script: "a</script>b" } })).toThrow("interactive.script must not contain </script or <!--");
    expect(() => renderSpecToHTML({ ...bar, options: { ...bar.options, locale: "ko" } }, { interactive: { script: "<!-- x" } })).toThrow("interactive.script에는 </script나 <!--가 들어갈 수 없어요");
  });
});

describe("tooltip template", () => {
  const ev = (over: Record<string, unknown> = {}) => ({ datum: { rate: 2.94, owner: "준호" }, index: 0, key: "8월", label: "8월", value: 605, formatted: "605", ...over }) as never;
  const html = (template: string, e: never, locale = "ko-KR") => ssr(<>{templateTooltip(template, locale)(e)}</>);
  it("writes one row each from the pointed item and other columns of its row", () => {
    expect(html("{label} · 가입 {value}명 · 전환율 {rate}% · 담당 {owner}", ev())).toBe("<div>8월 · 가입 605명 · 전환율 2.9% · 담당 준호</div>");
    expect(html("{series} {value}", ev({ series: "올해" }))).toBe("<div>올해 605</div>");
  });
  it("drops rows with empty cells, and is null (default tooltip) when all are dropped", () => {
    expect(templateTooltip("담당 {owner}")(ev({ datum: { owner: "" } }))).toBeNull();
    expect(html("{label}\n담당 {owner}", ev({ datum: { owner: null } }))).toBe("<div>8월</div>");
    expect(html("{label}\n전환율 {rate}", ev({ datum: null }))).toBe("<div>8월</div>");
  });
  it("numbers use the chart's default number format", () => {
    expect(html("{n}", ev({ datum: { n: 12345 } }), "en-US")).toBe("<div>12,345</div>");
    expect(html("{n}", ev({ datum: { n: 0.000012 } }), "en-US")).toBe("<div>0.000012</div>");
  });
});

describe("legend toggle", () => {
  const CH = ["Search", "Social", "Ads", "Referral", "Direct"];
  const data = ["Jan", "Feb", "Mar", "Apr"].flatMap((m, k) => CH.map((ch, s) => ({ m, ch, v: 40 + s * 10 + k * 3 })));
  const spec = (legend: "toggle" | "auto", hidden: string[]) => ({ type: "line", data, encoding: { x: "m", y: "v", series: "ch" }, options: { highlight: "Social", hidden }, card: { title: "Visits", legend } }) as const;
  const pressed = (h: string) => [...h.matchAll(/<button type="button" class="ztd-btn" aria-pressed="(true|false)"( aria-disabled="true")?/g)].map((m) => m[1] + (m[2] ? "!" : ""));
  const strokes = (h: string) => (h.match(/<path d="M[^"]*" fill="none" stroke="/g) ?? []).length;
  it("viewers pick the series to see: pressed state per button, an empty live region at first, only visible lines", () => {
    const h = renderToString(<Chart spec={spec("toggle", ["Search", "Ads", "Direct"])} width={560} animate={false} />);
    expect(pressed(h)).toEqual(["false", "true", "false", "true", "false"]);
    expect(h.match(/<span aria-live="polite" aria-atomic="true" style="[^"]*"><\/span>/g)).toHaveLength(1);
    expect(strokes(h)).toBe(2);
    expect(pressed(renderToString(<Chart spec={spec("toggle", ["Search", "Ads", "Referral", "Direct"])} width={560} animate={false} />))).toEqual(["false", "true!", "false", "false", "false"]);
  });
  it('images and static HTML draw it like "auto", interactive HTML draws buttons', () => {
    expect(renderSpecToSVG(spec("toggle", ["Ads"]), { width: 560 })).toBe(renderSpecToSVG(spec("auto", ["Ads"]), { width: 560 }));
    expect(renderSpecToHTML(spec("toggle", ["Ads"]))).not.toContain("aria-pressed");
    expect(renderSpecToHTML(spec("toggle", ["Ads"]), { interactive: { script: "/*x*/" } })).toContain('aria-pressed="true"');
  });
  it("the sentence a screen reader reads after a press (English, Korean)", () => {
    expect(CARD_TEXT.en.shown(2, 5)).toBe("2 of 5 series shown");
    expect(CARD_TEXT.ko.shown(2, 5)).toBe("5개 중 2개 보임");
  });
});

describe("components", () => {
  it("an unknown type gives the error state", () => {
    expect(ssr(<Chart spec={{ type: "nope", data: [] }} />)).toContain("Unknown chart type: nope");
  });
  it("ChartCard renders number, title, legend, summary and badge", () => {
    const html = ssr(
      <ChartCard number="01" title="Pie chart" subtitle="By device" legend={[{ label: "Mobile", color: "accent" }]} takeaway="Two to four items" level="intermediate" replay sample>
        <div />
      </ChartCard>,
    );
    for (const s of ["01", "Pie chart", "By device", "Mobile", "Two to four items", ">Intermediate<", "Sample data", 'aria-label="Replay animation"', 'aria-label="Legend"']) expect(html).toContain(s);
  });
  it("ChartGrid keeps its column count and collapses when narrow", () => {
    expect(ssr(<ChartGrid columns={3} />)).toContain("repeat(auto-fill, minmax(min(100%, max(320px, calc((100% - 32px) / 3 - 0.5px))), 1fr))");
  });
  it("ChartState three states", () => {
    expect(ssr(<ChartState loading />)).toContain('aria-busy="true"');
    expect(ssr(<ChartState error="HTTP 500" onRetry={() => {}} />)).toContain("Try again");
    expect(ssr(<ChartState empty />)).toContain("No data to show");
  });
  it("empty data does not break", () => {
    for (const c of CHARTS) {
      const html = ssr(<Chart spec={{ ...c.example, data: [] }} width={400} animate={false} />);
      expect(html, c.type).toContain("ztd-root");
      expect(html, c.type).not.toContain("NaN");
    }
  });
  it("NaN and Infinity in number cells draw as empty values (so totals, ratios and array lengths do not break)", () => {
    for (const c of CHARTS) {
      const rows = c.example.data as Record<string, unknown>[];
      const num = Object.keys(rows[0]).filter((k) => rows.every((r) => typeof r[k] === "number"));
      const data = rows.map((r, i) => (i % 4 === 1 ? { ...r, ...Object.fromEntries(num.map((k) => [k, i % 8 === 1 ? NaN : Infinity])) } : r));
      const html = ssr(<Chart spec={{ ...c.example, data }} width={640} animate={false} />);
      expect(html, c.type).toContain("ztd-root");
      expect(html, c.type).not.toMatch(/NaN|Infinity/);
    }
  });
});

describe("locale", () => {
  const data = [
    { x: "A", y: 120_000 },
    { x: "B", y: 340_000 },
  ];
  const bar = (props: Partial<BarChartProps> = {}) => <BarChart data={data} x="x" y="y" width={400} animate={false} {...props} />;

  it("English by default: chart text and short numbers like 120K", () => {
    const html = ssr(bar());
    expect(html).toContain('aria-roledescription="chart"');
    expect(html).toContain("Bar chart. 2 categories. A 120,000, B 340,000");
    expect(html).toContain("<caption>Bar chart data</caption>");
    expect(html).toMatch(/>[1-9]00K</);
  });
  it("Korean through ThemeProvider locale", () => {
    const html = ssr(<ThemeProvider locale="ko-KR">{bar()}</ThemeProvider>);
    expect(html).toContain('lang="ko-KR"');
    expect(html).toContain('aria-roledescription="차트"');
    expect(html).toContain("막대 차트. 2개 범주.");
    expect(html).toMatch(/>[1-9]0만</);
  });
  it("a chart's locale prop wins over ThemeProvider", () => {
    expect(ssr(bar({ locale: "ko" }))).toContain("막대 차트. 2개 범주.");
    expect(ssr(<ThemeProvider locale="ko">{bar({ locale: "en-US" })}</ThemeProvider>)).toContain("Bar chart. 2 categories.");
  });
  it("card, state and badge follow the locale and still accept the old Korean level values", () => {
    const card = (level: string) => (
      <ChartCard title="t" level={level} replay sample>
        <div />
      </ChartCard>
    );
    expect(ssr(card("중급"))).toContain(">Intermediate<");
    const ko = ssr(
      <ThemeProvider locale="ko">
        {card("advanced")}
        <ChartState error="x" onRetry={() => {}} />
      </ThemeProvider>,
    );
    for (const s of [">심화<", "예시 데이터", 'aria-label="애니메이션 다시 재생"', "다시 시도", "데이터를 불러오지 못했어요"]) expect(ko).toContain(s);
  });
  it("server render takes locale too (card title, badge, document language)", () => {
    const spec = { type: "bar", data, encoding: { x: "x", y: "y" }, card: { level: "basic" } };
    const en = renderSpecToSVG(spec);
    for (const s of [">Bar chart<", ">Basic<"]) expect(en).toContain(s);
    const ko = renderSpecToSVG(spec, { locale: "ko" });
    for (const s of [">막대 차트<", ">기본<"]) expect(ko).toContain(s);
    expect(ko).toMatch(/>[1-9]0만</);
    expect(renderSpecToHTML(spec, { locale: "ko" })).toContain('<html lang="ko">');
  });
});

describe("variants render", () => {
  it("every variant draws without NaN", () => {
    for (const [type, list] of Object.entries(VARIANTS)) {
      const def = CHARTS.find((d) => d.type === type)!;
      for (const x of list) {
        const h = ssr(<Chart spec={variantSpec(def, x.id)!} width={480} animate={false} />);
        expect(h, `${type}/${x.id}`).toContain("<svg");
        expect(h, `${type}/${x.id}`).not.toMatch(/NaN|Infinity/);
      }
    }
  });
});
