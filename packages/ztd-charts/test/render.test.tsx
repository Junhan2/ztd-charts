import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarChart, type BarChartProps } from "../src/charts/bar";
import { Chart } from "../src/charts/Chart";
import { ChartCard, ChartGrid, ChartState } from "../src/components/ChartCard";
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

describe("SSR: 33종 모두", () => {
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

describe("renderSpecToSVG (resvg용 독립 SVG)", () => {
  it("모든 예시가 var(), color-mix 없이 그려져요", () => {
    for (const c of CHARTS) {
      const svg = renderSpecToSVG(c.example, { width: 720, theme: "light" });
      expect(svg.startsWith("<svg xmlns")).toBe(true);
      expect(svg).not.toContain("var(--");
      expect(svg).not.toContain("color-mix");
      expect(svg).not.toContain("NaN");
      expect(svg).toContain(c.example.card?.title ?? "");
    }
  });
  it("구조 스냅샷 (기하 회귀 감지)", () => {
    const out: Record<string, ReturnType<typeof summarize>> = {};
    for (const c of CHARTS) out[c.type] = summarize(renderSpecToSVG(c.example, { width: 720, theme: "dark", frame: false }));
    expect(out).toMatchSnapshot();
  });
  it("틀린 스펙은 이유와 함께 실패", () => {
    expect(() => renderSpecToSVG({ type: "pie", data: [{ a: 1 }], encoding: { label: "x", value: "a" } })).toThrow(/x/);
  });
  it("HTML은 문서와 테마 변수를 담아요", () => {
    const html = renderSpecToHTML(CHARTS[0].example, { theme: "light" });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain(`--ztd-accent: ${lightTheme.accent}`);
    expect(html).toContain("ztd-card");
  });
  it("정적 HTML에는 동작하지 않는 다시 재생 버튼을 그리지 않아요", () => {
    expect(renderSpecToHTML(CHARTS[0].example)).not.toContain("Replay animation");
    expect(renderSpecToHTML(CHARTS[0].example, { interactive: { libraryUrl: "data:text/javascript,0" } })).toContain("Replay animation");
  });
});

describe("컴포넌트", () => {
  it("모르는 타입은 오류 상태", () => {
    expect(ssr(<Chart spec={{ type: "nope", data: [] }} />)).toContain("Unknown chart type: nope");
  });
  it("ChartCard는 번호, 제목, 범례, 요약, 배지를", () => {
    const html = ssr(
      <ChartCard number="01" title="Pie chart" subtitle="By device" legend={[{ label: "Mobile", color: "accent" }]} takeaway="Two to four items" level="intermediate" replay sample>
        <div />
      </ChartCard>,
    );
    for (const s of ["01", "Pie chart", "By device", "Mobile", "Two to four items", ">Intermediate<", "Sample data", 'aria-label="Replay animation"', 'aria-label="Legend"']) expect(html).toContain(s);
  });
  it("ChartGrid는 칸 수를 지키고 좁으면 접혀요", () => {
    expect(ssr(<ChartGrid columns={3} />)).toContain("repeat(auto-fill, minmax(min(100%, max(320px, calc((100% - 32px) / 3 - 0.5px))), 1fr))");
  });
  it("ChartState 세 상태", () => {
    expect(ssr(<ChartState loading />)).toContain('aria-busy="true"');
    expect(ssr(<ChartState error="HTTP 500" onRetry={() => {}} />)).toContain("Try again");
    expect(ssr(<ChartState empty />)).toContain("No data to show");
  });
  it("빈 데이터도 깨지지 않아요", () => {
    for (const c of CHARTS) {
      const html = ssr(<Chart spec={{ ...c.example, data: [] }} width={400} animate={false} />);
      expect(html, c.type).toContain("ztd-root");
      expect(html, c.type).not.toContain("NaN");
    }
  });
});

describe("로캘", () => {
  const data = [
    { x: "A", y: 120_000 },
    { x: "B", y: 340_000 },
  ];
  const bar = (props: Partial<BarChartProps> = {}) => <BarChart data={data} x="x" y="y" width={400} animate={false} {...props} />;

  it("기본은 영어: 차트 글자와 120K 같은 짧은 숫자", () => {
    const html = ssr(bar());
    expect(html).toContain('aria-roledescription="chart"');
    expect(html).toContain("Bar chart. 2 categories. A 120,000, B 340,000");
    expect(html).toContain("<caption>Bar chart data</caption>");
    expect(html).toMatch(/>[1-9]00K</);
  });
  it("ThemeProvider locale로 한국어", () => {
    const html = ssr(<ThemeProvider locale="ko-KR">{bar()}</ThemeProvider>);
    expect(html).toContain('lang="ko-KR"');
    expect(html).toContain('aria-roledescription="차트"');
    expect(html).toContain("막대 차트. 2개 범주.");
    expect(html).toMatch(/>[1-9]0만</);
  });
  it("차트의 locale 프롭이 ThemeProvider보다 우선", () => {
    expect(ssr(bar({ locale: "ko" }))).toContain("막대 차트. 2개 범주.");
    expect(ssr(<ThemeProvider locale="ko">{bar({ locale: "en-US" })}</ThemeProvider>)).toContain("Bar chart. 2 categories.");
  });
  it("카드, 상태, 배지도 로캘을 따르고 예전 한글 수준 값도 받아요", () => {
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
  it("서버 렌더도 locale을 받아요 (카드 제목, 배지, 문서 언어)", () => {
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
