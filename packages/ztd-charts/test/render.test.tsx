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

describe("SSR: 36종 모두", () => {
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
  it("카드 범례는 좁으면 줄을 바꿔 카드 안에 들어가고, 도넛은 자기 범례만 그려요", () => {
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

describe("카드 출처 줄과 제목 강조 (차례 2 ⑭)", () => {
  const base = { type: "bar", data: [{ x: "A", y: 1 }, { x: "B", y: 2 }], encoding: { x: "x", y: "y" } };
  const strip = (h: string) => h.replace(/<!-- -->/g, "");
  it("출처와 메모는 차트 아래 한 줄, 서버 카드는 한 줄만큼(27px) 길어져요", () => {
    const spec = { ...base, card: { title: "T", source: "통계청", note: "2025-10 기준" } };
    expect(strip(ssr(<Chart spec={spec} animate={false} />))).toContain("Source: 통계청 · 2025-10 기준");
    expect(strip(ssr(<Chart spec={{ ...spec, options: { locale: "ko" } }} animate={false} />))).toContain("출처: 통계청 · 2025-10 기준");
    const height = (svg: string) => Number(/height="([\d.]+)"/.exec(svg)![1]);
    const withLine = renderSpecToSVG(spec, { width: 560 });
    expect(withLine).toContain("Source: 통계청 · 2025-10 기준");
    expect(height(withLine) - height(renderSpecToSVG({ ...base, card: { title: "T" } }, { width: 560 }))).toBe(27);
  });
  it("제목 속 accent 낱말만 강조색이고, 차트 이름은 제목 그대로", () => {
    const spec = { ...base, card: { title: "올해 매출이 가장 커요", accent: "올해" } };
    const html = ssr(<Chart spec={spec} animate={false} />);
    expect(html).toMatch(/<span style="color:var\(--ztd-accent-text[^"]*">올해<\/span>/);
    expect(html).toContain('aria-label="올해 매출이 가장 커요"');
    expect(renderSpecToSVG(spec, { width: 560, theme: "light" })).toContain(`<tspan fill="${lightTheme.accentText}">올해</tspan>`);
  });
  it("download: true면 단추 셋, 배열이면 고른 것만(순서는 CSV, SVG, PNG), 정적 HTML과 SVG에는 없어요", () => {
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
  it("CSV: BOM, CRLF, 글자 칸은 모두 따옴표, 수식처럼 시작하는 글자는 앞에 '", () => {
    // "+1 234"처럼 toNumber가 수로 읽는 글자는 수식이 될 수 없어 그대로 둬요
    const row = { a: "=1+1", b: -5, c: "-5", d: "＝cmd", e: "x;y", f: 'say "hi"', g: null, h: new Date(2024, 2, 5), i: "+82-10-1234", j: Number.NaN, k: "+1 234" };
    const text = csvText([row], Object.keys(row));
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toBe(`"a","b","c","d","e","f","g","h","i","j","k"\r\n"'=1+1",-5,"-5","'＝cmd","x;y","say ""hi""",,"2024-03-05","'+82-10-1234",,"+1 234"\r\n`);
  });
  it("CSV 열은 차트가 그리는 열만: 채널 순서, 배열은 펼치고, 열 이름 옵션도. 없으면 단추가 모든 열을 써요", () => {
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

describe("서버 그림을 이어받는 대화형 HTML (차례 3 ⑨)", () => {
  const bar = CHARTS.find((c) => c.type === "bar")!.example;
  const cfgOf = (html: string) => JSON.parse(/<script type="application\/json" id="ztd-chart-config">([^<]*)<\/script>/.exec(html)![1]);
  it("설정과 코드를 싣고, 차트는 .wrap 내용 폭으로 이어받을 수 있게 그려요", () => {
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
  it("코드에 </script나 <!--가 있으면 막아요", () => {
    expect(() => renderSpecToHTML(bar, { interactive: { script: "a</script>b" } })).toThrow("interactive.script must not contain </script or <!--");
    expect(() => renderSpecToHTML({ ...bar, options: { ...bar.options, locale: "ko" } }, { interactive: { script: "<!-- x" } })).toThrow("interactive.script에는 </script나 <!--가 들어갈 수 없어요");
  });
});

describe("툴팁 틀 (차례 3 ⑩)", () => {
  const ev = (over: Record<string, unknown> = {}) => ({ datum: { rate: 2.94, owner: "준호" }, index: 0, key: "8월", label: "8월", value: 605, formatted: "605", ...over }) as never;
  const html = (template: string, e: never, locale = "ko-KR") => ssr(<>{templateTooltip(template, locale)(e)}</>);
  it("짚은 항목과 그 행의 다른 열로 한 줄씩 써요", () => {
    expect(html("{label} · 가입 {value}명 · 전환율 {rate}% · 담당 {owner}", ev())).toBe("<div>8월 · 가입 605명 · 전환율 2.9% · 담당 준호</div>");
    expect(html("{series} {value}", ev({ series: "올해" }))).toBe("<div>올해 605</div>");
  });
  it("빈 칸이 든 줄은 빼고, 모두 빠지면 null(기본 툴팁)이에요", () => {
    expect(templateTooltip("담당 {owner}")(ev({ datum: { owner: "" } }))).toBeNull();
    expect(html("{label}\n담당 {owner}", ev({ datum: { owner: null } }))).toBe("<div>8월</div>");
    expect(html("{label}\n전환율 {rate}", ev({ datum: null }))).toBe("<div>8월</div>");
  });
  it("수는 차트의 기본 수 표기로 써요", () => {
    expect(html("{n}", ev({ datum: { n: 12345 } }), "en-US")).toBe("<div>12,345</div>");
    expect(html("{n}", ev({ datum: { n: 0.000012 } }), "en-US")).toBe("<div>0.000012</div>");
  });
});

describe("범례 켜고 끄기 (차례 4 ⑫)", () => {
  const CH = ["Search", "Social", "Ads", "Referral", "Direct"];
  const data = ["Jan", "Feb", "Mar", "Apr"].flatMap((m, k) => CH.map((ch, s) => ({ m, ch, v: 40 + s * 10 + k * 3 })));
  const spec = (legend: "toggle" | "auto", hidden: string[]) => ({ type: "line", data, encoding: { x: "m", y: "v", series: "ch" }, options: { highlight: "Social", hidden }, card: { title: "Visits", legend } }) as const;
  const pressed = (h: string) => [...h.matchAll(/<button type="button" class="ztd-btn" aria-pressed="(true|false)"( aria-disabled="true")?/g)].map((m) => m[1] + (m[2] ? "!" : ""));
  const strokes = (h: string) => (h.match(/<path d="M[^"]*" fill="none" stroke="/g) ?? []).length;
  it("보는 사람이 계열을 골라 봐요: 단추마다 눌림 상태, 처음엔 빈 알림 자리, 보이는 선만", () => {
    const h = renderToString(<Chart spec={spec("toggle", ["Search", "Ads", "Direct"])} width={560} animate={false} />);
    expect(pressed(h)).toEqual(["false", "true", "false", "true", "false"]);
    expect(h.match(/<span aria-live="polite" aria-atomic="true" style="[^"]*"><\/span>/g)).toHaveLength(1);
    expect(strokes(h)).toBe(2);
    expect(pressed(renderToString(<Chart spec={spec("toggle", ["Search", "Ads", "Referral", "Direct"])} width={560} animate={false} />))).toEqual(["false", "true!", "false", "false", "false"]);
  });
  it('이미지와 정적 HTML은 "auto"처럼, 대화형 HTML은 단추로 그려요', () => {
    expect(renderSpecToSVG(spec("toggle", ["Ads"]), { width: 560 })).toBe(renderSpecToSVG(spec("auto", ["Ads"]), { width: 560 }));
    expect(renderSpecToHTML(spec("toggle", ["Ads"]))).not.toContain("aria-pressed");
    expect(renderSpecToHTML(spec("toggle", ["Ads"]), { interactive: { script: "/*x*/" } })).toContain('aria-pressed="true"');
  });
  it("누른 뒤 화면 낭독기가 읽는 문장 (영어, 한국어)", () => {
    expect(CARD_TEXT.en.shown(2, 5)).toBe("2 of 5 series shown");
    expect(CARD_TEXT.ko.shown(2, 5)).toBe("5개 중 2개 보임");
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
  it("숫자 칸의 NaN, Infinity는 빈 값으로 그려요 (합계, 비율, 배열 길이가 망가지지 않게)", () => {
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
