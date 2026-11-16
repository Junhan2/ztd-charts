import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Chart } from "../src/charts/Chart";
import { formatCompact, formatNumber, formatPercent, makeFormatter, toDate } from "../src/core/format";
import { detectXType, prepSeries } from "../src/core/series";
import { getter, strGetter, toNumber } from "../src/data/accessor";
import { parseCSV } from "../src/data/parse";
import { readResponse } from "../src/data/useChartData";
import { renderSpecToHTML, renderSpecToSVG } from "../src/server";
import { CHARTS, suggestCharts, validateSpec } from "../src/spec";
import { specLocale } from "../src/spec/meta";
import { parseColor } from "../src/theme/color";
import { DEFAULT_FONT, darkTheme, themeToCss } from "../src/theme/tokens";

const codes = (spec: unknown) => validateSpec(spec).errors.map((e) => `${e.path}:${e.code}`);
const pie = { type: "pie", data: [{ label: "a", value: 1 }] };

describe("security: theme values and legend colors (CLI, MCP SVG, HTML)", () => {
  // The reviewer's evil.json, verbatim
  const evil = { type: "pie", data: [{ label: "a", value: 1 }], card: { title: "Sales", legend: [{ label: "L", color: 'x"/><script>alert(document.domain)</script><x y="' }] }, theme: { accent: "red}</style><script>alert(2)</script><style>" } };

  it("evil.json is blocked in validation with bad_theme_value, bad_legend_color", () => {
    expect(codes(evil)).toEqual(["card.legend[0].color:bad_legend_color", "theme.accent:bad_theme_value"]);
    expect(() => renderSpecToSVG(evil as never)).toThrow(/theme\.accent/);
    expect(() => renderSpecToHTML(evil as never)).toThrow(/card\.legend\[0\]\.color/);
  });

  it("also blocks CSS injection (; url()) and values that are neither strings nor numbers", () => {
    for (const accent of ["red;background:url(https://evil.example/t)", "url(//evil.example/t)", "image(x)", "red}", "a\\62", '"x"']) expect(codes({ ...pie, theme: { accent } })).toEqual(["theme.accent:bad_theme_value"]);
    expect(codes({ ...pie, theme: { radius: '"/><script>' } })).toEqual(["theme.radius:bad_theme_value"]);
    expect(codes({ ...pie, theme: { ink: { a: 1 } } })).toEqual(["theme.ink:bad_theme_value"]);
    expect(codes({ ...pie, card: { legend: [{ label: "L", color: 3 }] } })).toEqual(["card.legend[0].color:bad_legend_color"]);
  });

  it("accepts valid CSS colors, lengths and fonts as is", () => {
    const theme = { accent: "#0B8FD8", ink: "rgb(1 2 3 / 50%)", muted: "oklch(70% 0.1 200)", line: "rebeccapurple", panel: "var(--brand, #fff)", tint: "color-mix(in oklab, red 40%, blue)", bg: "hsl(210deg 20% 10%)", radius: 12, fontFamily: DEFAULT_FONT, monoFamily: "'Roboto Mono', monospace", name: "Brand: v2 (아침)" };
    expect(validateSpec({ ...pie, theme, card: { title: "t", legend: [{ label: "a", color: "accent" }, { label: "b", color: "#123" }] } }).errors).toEqual([]);
  });

  it("opts.theme, which skips validation, is also escaped in SVG and HTML", () => {
    const pay = '"/><script>alert(1)</script><x a="';
    const svg = renderSpecToSVG({ ...pie, card: { title: "t" } } as never, { theme: { ink: pay, panel: pay, line: pay, radius: pay as never } });
    expect(svg).not.toContain("<script");
    const html = renderSpecToHTML(pie as never, { theme: { accent: "red}</style><script>alert(2)</script><style>" } });
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/<\/style><script/);
  });

  it("themeToCss turns < into a CSS escape so it cannot form </style>", () => {
    const css = themeToCss({ ...darkTheme, accent: "red}</style><script>" });
    expect(css).not.toContain("<");
    expect(css).toContain("\\3c /style>");
  });

  it('legend color "constructor" does not read an object property (function body)', () => {
    const svg = renderSpecToSVG({ ...pie, card: { title: "t", legend: [{ label: "L", color: "constructor" }] } } as never);
    expect(svg).not.toContain("function Object");
  });
});

describe("locale check and fix", () => {
  const bar = { type: "bar", data: [{ x: "a", y: 12345 }], encoding: { x: "x", y: "y" } };
  it('bad locales ("", "a b") give bad_locale, "ko_KR" and "en_US" are accepted', () => {
    expect(codes({ ...bar, options: { locale: "" } })).toEqual(["options.locale:bad_locale"]);
    expect(codes({ ...bar, options: { locale: "a b" } })).toEqual(["options.locale:bad_locale"]);
    expect(codes({ ...bar, options: { locale: "ko_KR" } })).toEqual([]);
    expect(codes({ ...bar, options: { locale: "en_US" } })).toEqual([]);
  });
  it('"ko_KR" draws as ko-KR (Korean text, no RangeError)', () => {
    expect(specLocale({ options: { locale: "ko_KR" } })).toBe("ko-KR");
    expect(specLocale({ options: { locale: "" } })).toBeUndefined();
    const svg = renderSpecToSVG({ ...bar, options: { locale: "ko_KR" } } as never);
    expect(svg).toContain("<title");
    expect(svg).toContain("막대 차트");
    expect(renderToStaticMarkup(createElement(Chart, { spec: { ...bar, options: { locale: "en_US" } } as never, animate: false }))).toContain("12,345");
  });
});

describe("dates (YYYYMMDD, nonexistent days)", () => {
  it("8 digits 19000101~21001231 are dates, real ms timestamps stay as is", () => {
    expect(toDate(20240315)?.toDateString()).toBe(new Date(2024, 2, 15).toDateString());
    expect(toDate("20240315")?.getDate()).toBe(15);
    expect(toDate(1_700_000_000_000)?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(toDate(30_000_101)?.getTime()).toBe(30_000_101);
    expect(toDate(2024)?.getFullYear()).toBe(2024);
  });
  it('nonexistent days ("2024-02-30", "2024-13-45", 20240230) are null, not rolled into the next month', () => {
    for (const v of ["2024-02-30", "2024-13-45", "2024-13", "2024.02.30", 20240230, "20241301"]) expect(toDate(v)).toBeNull();
    expect(toDate("2024-02-29")?.getDate()).toBe(29);
  });
  it("a calendar drawn from a CSV YYYYMMDD column shows that month, not 1970", () => {
    const svg = renderSpecToSVG({ type: "calendar", data: { csv: "date,value\n20240301,1\n20240302,2\n20240303,3" } } as never);
    const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(texts).toContain("Mar");
    expect(texts).not.toContain("Jan");
  });
});

describe("date formats: dots, Korean style, quarters, English month names, Unix seconds", () => {
  const days = (...ds: number[]) => ds.map((d) => new Date(2024, 2, d).getTime());
  const xs = (vals: string[]) => vals.map((d, i) => ({ d, v: i + 1 }));
  const warn = (spec: unknown, lang?: "ko") => validateSpec(spec, lang ? { lang } : {}).warnings;
  it.each([
    ["2024.03.05", ["2024.03.05", "2024.03.06", "2024.03.10"], days(5, 6, 10)],
    ["24.03.05", ["24.03.05", "24.03.06", "24.03.10"], days(5, 6, 10)],
    ["2024. 3. 5.", ["2024. 3. 5.", "2024. 3. 6.", "2024. 3. 10."], days(5, 6, 10)],
    ["2024년 3월 5일", ["2024년 3월 5일", "2024년 3월 6일", "2024년 3월 10일"], days(5, 6, 10)],
    ["2024/03/05", ["2024/03/05", "2024/03/06", "2024/03/10"], days(5, 6, 10)],
    ["Mar 5, 2024", ["Mar 5, 2024", "Mar 6, 2024", "Mar 10, 2024"], days(5, 6, 10)],
    ["5 Mar 2024", ["5 Mar 2024", "6 Mar 2024", "10 Mar 2024"], days(5, 6, 10)],
    ["2024Q1", ["2024Q1", "2024Q2", "2024Q4"], [0, 3, 9].map((m) => new Date(2024, m, 1).getTime())],
    ["2024-03", ["2024-01", "2024-02", "2024-06"], [0, 1, 5].map((m) => new Date(2024, m, 1).getTime())],
    ["2024-03-05 14:00", ["2024-03-05 14:00", "2024-03-05 15:00", "2024-03-05 19:00"], [14, 15, 19].map((h) => new Date(2024, 2, 5, h).getTime())],
  ])("%s form is a time axis spaced by date", (_, vals, want) => {
    const m = prepSeries(xs(vals as string[]), "d", "v", undefined);
    expect(m.type).toBe("date");
    expect(m.xnum).toEqual(want);
  });
  it('text without a year or month name ("Marketing 2024", "Jan", "Q1", "1월") stays a text axis', () => {
    for (const vals of [["Marketing 2024", "Sales 2024"], ["Jan", "Feb"], ["Q1", "Q2"], ["1월", "2월"]]) expect(detectXType(vals)).toBe("band");
    expect(detectXType(["Mar 2024", "Apr 2024"])).toBe("date");
  });
  it('10-digit numbers with xType "date" are Unix seconds (13-digit ms stay as is)', () => {
    expect(prepSeries([{ t: 1704067200, v: 1 }, { t: 1704153600, v: 2 }], "t", "v", undefined, { xType: "date" }).xnum[0]).toBe(1704067200000);
    expect(toDate(1704067200)!.getTime()).toBe(1704067200000);
    expect(toDate(1704067200000)!.getTime()).toBe(1704067200000);
  });
  it('"05/03/2024", which reads as day or month first, is read month first and reported with row numbers. dayFirst or an unambiguous date sets the order', () => {
    const spec = (d: string[], options = {}) => ({ type: "line", data: xs(d), encoding: { x: "d", y: "v" }, options });
    expect(prepSeries(xs(["05/03/2024", "06/03/2024"]), "d", "v", undefined).xnum).toEqual([new Date(2024, 4, 3).getTime(), new Date(2024, 5, 3).getTime()]);
    const amb = warn(spec(["05/03/2024", "06/03/2024"])).find((w) => w.code === "date_order_ambiguous");
    expect(amb?.message).toContain("rows 1, 2");
    expect(warn(spec(["05/03/2024", "06/03/2024"]), "ko").find((w) => w.code === "date_order_ambiguous")?.message).toContain("1, 2행");
    expect(prepSeries(xs(["05/03/2024", "06/03/2024"]), "d", "v", undefined, { dayFirst: true }).xnum).toEqual(days(5, 6));
    expect(warn(spec(["05/03/2024", "06/03/2024"], { dayFirst: true })).map((w) => w.code)).not.toContain("date_order_ambiguous");
    expect(prepSeries(xs(["05/03/2024", "25/03/2024"]), "d", "v", undefined).xnum).toEqual(days(5, 25));
    expect(warn(spec(["05/03/2024", "25/03/2024"])).map((w) => w.code)).not.toContain("date_order_ambiguous");
  });
  it("warns when an x read as text becomes a date (quiet with xType set, ISO dates and bars)", () => {
    const rows = xs(["2025.03.01", "2025.03.02", "2025.03.10"]);
    expect(warn({ type: "line", data: rows, encoding: { x: "d", y: "v" } }).map((w) => w.code)).toContain("x_read_as_date");
    expect(warn({ type: "line", data: rows, encoding: { x: "d", y: "v" }, options: { xType: "date" } }).map((w) => w.code)).not.toContain("x_read_as_date");
    expect(warn({ type: "line", data: xs(["2025-03-01", "2025-03-02"]), encoding: { x: "d", y: "v" } }).map((w) => w.code)).not.toContain("x_read_as_date");
    expect(warn({ type: "bar", data: rows, encoding: { x: "d", y: "v" } }).map((w) => w.code)).not.toContain("x_read_as_date");
  });
  it('"2025.03.01" style line charts leave gaps for missing dates (spec path)', () => {
    const data = ["2025.03.01", "2025.03.02", "2025.03.03", "2025.03.10", "2025.03.11", "2025.03.31", "2025.04.01"].map((d, i) => ({ d, v: [120, 132, 128, 90, 95, 160, 170][i] }));
    const svg = renderSpecToSVG({ type: "line", data, encoding: { x: "d", y: "v" }, options: { dots: true, curve: "linear" } }, { width: 720 });
    const cx = [...svg.matchAll(/<circle cx="([\d.]+)" cy="[\d.]+" r="3"/g)].map((m) => +m[1]);
    expect(cx).toHaveLength(7);
    expect((cx[3] - cx[2]) / (cx[1] - cx[0])).toBeCloseTo(7, 1);
  });
  it('calendar also accepts the "2024년 3월 5일" form as a date', () => {
    const spec = { type: "calendar", data: ["5", "6", "7"].map((d, i) => ({ day: `2024년 3월 ${d}일`, n: i + 1 })), encoding: { date: "day", value: "n" } };
    expect(validateSpec(spec).valid).toBe(true);
    const texts = [...renderSpecToSVG(spec as never).matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(texts).toContain("Mar");
  });
  it('quarter columns read "Q1 2024", and "2024년 1분기" in Korean', () => {
    expect(prepSeries(xs(["2024Q1", "2024Q2", "2024Q4"]), "d", "v", undefined).labels).toEqual(["Q1 2024", "Q2 2024", "Q4 2024"]);
    expect(prepSeries(xs(["2024Q1", "2024Q2", "2024Q4"]), "d", "v", undefined, { locale: "ko-KR" }).labels).toEqual(["2024년 1분기", "2024년 2분기", "2024년 4분기"]);
  });
});

describe("number format", () => {
  it("does not throw when minimumFractionDigits is above 1", () => {
    expect(formatNumber(1.5, { minimumFractionDigits: 2 })).toBe("1.50");
    expect(formatCompact(12345, { minimumFractionDigits: 2 })).toBe("12.35K");
    expect(formatCompact(12345, { locale: "ko", minimumFractionDigits: 2 })).toBe("1.23만");
    expect(makeFormatter({ minimumFractionDigits: 3 })(1)).toBe("1.000");
  });
  it("a currency code gives that currency's digits, a missing one is a validation error", () => {
    expect(makeFormatter({ style: "currency", currency: "USD" })(1.5)).toBe("$1.50");
    expect(formatNumber(1.5, { style: "currency", currency: "USD" })).toBe("$1.50");
    expect(codes({ type: "bar", data: [{ x: "a", y: 1 }], encoding: { x: "x", y: "y" }, options: { format: { style: "currency" } } })).toEqual(["options.format:bad_format"]);
    expect(codes({ type: "bar", data: [{ x: "a", y: 1 }], encoding: { x: "x", y: "y" }, options: { format: { style: "currency", currency: "EUR", suffix: "!" } } })).toEqual([]);
  });
  it('formatPercent(NaN) is "-"', () => {
    expect(formatPercent(NaN)).toBe("-");
    expect(makeFormatter("ratio")(NaN)).toBe("-");
  });
});

describe("accessor", () => {
  it("Date category names are local dates (not shifted a day by UTC)", () => {
    const g = strGetter<{ d: Date }>("d", "d");
    expect(g({ d: new Date(2024, 2, 15) }, 0)).toBe("2024-03-15");
    expect(g({ d: new Date(2024, 2, 15, 23, 59) }, 0)).toBe("2024-03-15");
  });
  it("Object.prototype names are not fields, class getters and an own constructor are", () => {
    class Row {
      constructor(private readonly v: number) {}
      get value() {
        return this.v;
      }
    }
    expect(getter(undefined, "constructor")({ a: 1 }, 0)).toBeUndefined();
    expect(getter(undefined, "toString")({ a: 1 }, 0)).toBeUndefined();
    expect(getter(undefined, "a.constructor")({ a: { b: 1 } }, 0)).toBeUndefined();
    expect(getter(undefined, "value")(new Row(7), 0)).toBe(7);
    expect(getter(undefined, "constructor")({ constructor: "x" }, 0)).toBe("x");
    expect(codes({ type: "bar", data: [{ a: "x", b: 1 }], encoding: { x: "constructor", y: "b" } })).toEqual(["encoding.x:field_not_found"]);
    expect(codes({ type: "bar", data: [{ a: "x", b: 1 }], encoding: { x: "a", y: "valueOf" } })).toEqual(["encoding.y:field_not_found"]);
  });
  it.each([["$"], ["%"], ["원"], [","], ["()"], ["1,2,3"], ["12,34"], ["1.234,56"]])("toNumber(%j) is NaN", (s) => expect(toNumber(s)).toBeNaN());
  it("reads valid thousands commas and symbols as is", () => {
    expect(toNumber("1,234,567.5")).toBe(1234567.5);
    expect(toNumber("(1,234)")).toBe(-1234);
    expect(toNumber("-1,234원")).toBe(-1234);
    expect(toNumber("$0")).toBe(0);
  });
});

describe("CSV", () => {
  it("headers a,a,a_2 lose no column when they clash", () => {
    expect(parseCSV("a,a,a_2\n1,2,3")).toEqual([{ a: 1, a_2: 2, a_2_2: 3 }]);
    expect(parseCSV(",col1\n1,2")).toEqual([{ col1: 1, col1_2: 2 }]);
  });
  it('a quote after a space (a, "b, c") is still a quoted cell', () => {
    expect(parseCSV('name,desc\na, "b, c"')).toEqual([{ name: "a", desc: "b, c" }]);
    expect(parseCSV('a,b\n"x" , "y"', { typed: false })).toEqual([{ a: "x ", b: "y" }]);
  });
});

describe("validateSpec row shape", () => {
  it("data:[null] with highlight gives bad_row without throwing", () => {
    expect(codes({ type: "bar", data: [null], options: { highlight: "x" } })).toEqual(["data[0]:bad_row"]);
  });
  it("checks data.values rows too and reports the path data.values[i]", () => {
    expect(codes({ type: "pie", data: { values: [{ label: "a", value: 1 }, 2] } })).toEqual(["data.values[1]:bad_row"]);
    expect(() => validateSpec({ type: "bar", data: { values: [null] }, encoding: { x: "a", y: "b" }, options: { highlight: "x" } })).not.toThrow();
  });
});

describe("reading responses", () => {
  it("a JSON content-type is JSON even with csv in the URL", async () => {
    const json = () => new Response('{"rows":[{"a":1}]}', { headers: { "content-type": "application/json; charset=utf-8" } });
    expect(await readResponse(json(), "auto", "https://x.com/q?format=csv")).toEqual({ rows: [{ a: 1 }] });
    expect(await readResponse(json(), "auto", "https://x.com/api/csv")).toEqual({ rows: [{ a: 1 }] });
    expect(await readResponse(new Response("a,b\n1,2"), "auto", "https://x.com/a.csv")).toEqual([{ a: 1, b: 2 }]);
  });
});

describe("Chart, server render", () => {
  it("renderSpecToSVG given { url } data says to call resolveSpecData first", () => {
    expect(() => renderSpecToSVG({ type: "pie", data: { url: "https://x.com/a.csv" } } as never)).toThrow(/resolveSpecData/);
  });
  it("keeps showing the chart with previous data when one reload fails", async () => {
    const state = (over: object) => ({ data: [{ label: "a", value: 1 }], status: "error", loading: false, error: new Error("HTTP 500"), empty: false, updatedAt: 1, reload: () => {}, ...over });
    let st = state({});
    vi.resetModules();
    vi.doMock("../src/data/useChartData", () => ({ useChartData: () => st }));
    try {
      const { Chart: C } = await import("../src/charts/Chart");
      const R = await import("react");
      const S = await import("react-dom/server");
      const html = () => S.renderToStaticMarkup(R.createElement(C, { spec: { type: "pie", data: { url: "https://x/a.json" } } as never, animate: false }));
      expect(html()).toContain("<svg");
      expect(html()).not.toContain("HTTP 500");
      // The error screen only when there is no data
      st = state({ data: [] });
      expect(html()).toContain("HTTP 500");
    } finally {
      vi.doUnmock("../src/data/useChartData");
    }
  });
});

describe("suggest: years, YYYYMMDD and '1월' to '12월' are time", () => {
  const top = (csv: string) => {
    const r = suggestCharts(parseCSV(csv));
    return { kinds: r.profile.columns.map((c) => c.kind), first: r.suggestions[0] };
  };
  it("a year column (2019…) is date, and the first suggestion is a line", () => {
    const r = top("year,sales\n2019,90\n2020,100\n2021,120\n2022,130\n2023,150");
    expect(r.kinds).toEqual(["date", "number"]);
    expect(r.first.type).toBe("line");
  });
  it("a YYYYMMDD column is date and the line spec has xType date", () => {
    const r = top("date,sales\n20240301,90\n20240302,100\n20240303,120");
    expect(r.kinds).toEqual(["date", "number"]);
    expect(r.first).toMatchObject({ type: "line", spec: { options: { xType: "date" } } });
    expect(validateSpec(r.first.spec).valid).toBe(true);
  });
  it('"1월" to "12월" make a line, not a pie', () => {
    const r = top("월,매출\n1월,90\n2월,100\n3월,120\n4월,110");
    expect(r.kinds[0]).toBe("date");
    expect(r.first.type).toBe("line");
  });
  it("4-digit numbers whose name is not a year (price) stay numbers", () => {
    expect(top("item,price\na,1500\nb,2300\nc,1800").kinds).toEqual(["category", "number"]);
  });
});

describe("suggest: column roles", () => {
  const FIX = new URL("./fixtures/suggest/", import.meta.url);
  const rowsOf = (f: string) => parseCSV(readFileSync(new URL(f, FIX), "utf8"));
  // Same shape as round 1 cases 08 and 09 (50k and 200k rows): an index t and random-walk values a, b, c, 200 rows
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const walk = () => {
    let v = 100;
    return () => Math.round((v += rnd() * 4 - 2) * 1000) / 1000;
  };
  const [wa, wb, wc] = [walk(), walk(), walk()];
  const big = Array.from({ length: 200 }, (_, t) => ({ t, a: wa(), b: wb(), c: wc() }));
  type Want = { types: string[]; x?: string; y?: string[]; yAnyOf?: string[]; series?: string | null; none?: boolean };
  // Axis, values and series picked by a person (round 1 csv_cases.mjs). Chart types are widened to the acceptable set
  // (the pies for 5 and 6 and the bar for 12 were picked as stress tests)
  const cases: [string, () => Record<string, unknown>[], Want][] = [
    ["01 line gaps", () => rowsOf("01-line-gaps.csv"), { types: ["line", "area"], x: "month", y: ["Alpha", "Beta"] }],
    ["02 formatted numbers", () => rowsOf("02-formatted-numbers.csv"), { types: ["bar", "lollipop"], x: "item", yAnyOf: ["plain", "thousands", "percent", "currency", "spaced"] }],
    ["03 mixed dates", () => rowsOf("03-dates-mixed.csv"), { types: ["line", "area"], x: "date", y: ["value"] }],
    ["04 300 long labels", () => rowsOf("04-long-labels-300.csv"), { types: ["bar", "lollipop"], x: "category", y: ["value"] }],
    ["05 pie negative and zero", () => rowsOf("05-pie-neg-zero.csv"), { types: ["bar", "pie", "donut", "lollipop"], x: "slice", y: ["value"] }],
    ["06 pie 40", () => rowsOf("06-pie-40.csv"), { types: ["bar", "pie", "donut", "lollipop", "pareto", "treemap"], x: "slice", y: ["value"] }],
    ["07 scatter zero and negative", () => rowsOf("07-log-zero-neg.csv"), { types: ["scatter"], x: "x", y: ["y"] }],
    ["08 big walk", () => big, { types: ["line"], x: "t", yAnyOf: ["a", "b", "c"] }],
    ["09 big walk (as 08)", () => big.slice(0, 120), { types: ["line"], x: "t", yAnyOf: ["a", "b", "c"] }],
    ["10 Korean won", () => rowsOf("10-korean-krw.csv"), { types: ["bar", "lollipop", "pie", "donut"], x: "지역", y: ["매출"] }],
    ["11 duplicate unsorted", () => rowsOf("11-dup-unsorted.csv"), { types: ["line", "area"], x: "date", y: ["value"], series: "team" }],
    ["12 single row", () => rowsOf("12-single-row.csv"), { types: ["gauge", "bar"], y: ["value"] }],
    ["13 empty", () => rowsOf("13-empty.csv"), { types: [], none: true }],
    ["14 huge and tiny", () => rowsOf("14-huge-tiny.csv"), { types: ["bar", "pie", "donut", "lollipop"], x: "label", yAnyOf: ["huge", "tiny"] }],
    ["15 text in number", () => rowsOf("15-text-in-number.csv"), { types: ["bar", "lollipop"], x: "label", y: ["value"] }],
  ];
  it.each(cases)("%s: the first suggestion matches the human pick", (_, rows, want) => {
    const s = suggestCharts(rows()).suggestions[0];
    if (want.none) return expect(s).toBeUndefined();
    expect(want.types).toContain(s?.type);
    const enc = s.spec.encoding as Record<string, unknown>;
    if (want.x && s.type !== "gauge") expect(["x", "label", "date", "axis", "group"].map((k) => enc[k]).find((v) => v !== undefined)).toBe(want.x);
    const ys = [enc.y, enc.value].flat().filter((v) => v !== undefined);
    if (want.y) expect([...ys].sort()).toEqual([...want.y].sort());
    if (want.yAnyOf) expect(ys.length && ys.every((f) => want.yAnyOf!.includes(f as string))).toBe(true);
    if (want.series !== undefined) expect(enc.series ?? null).toBe(want.series);
    expect(validateSpec(s.spec).errors).toEqual([]);
  });
  it("a table with one channel per month (swd): one line by date, then total bars by channel", () => {
    const [line, bar] = suggestCharts(rowsOf("swd.csv")).suggestions;
    expect(line).toMatchObject({ type: "line", spec: { encoding: { x: "날짜", y: "가입" } } });
    expect((line.spec.encoding as Record<string, unknown>).series).toBeUndefined();
    expect(bar).toMatchObject({ type: "bar", spec: { encoding: { x: "유입 채널", y: "가입" }, options: { aggregate: "sum", sort: true } } });
    const svg = renderSpecToSVG(bar.spec, { width: 560 });
    for (const total of ["1,296", "1,176", "982"]) expect(svg).toContain(total);
  });
  it('many items give the 7 largest as horizontal bars plus "Other", or only the 8 largest when the rest is large', () => {
    const many = suggestCharts(rowsOf("04-long-labels-300.csv")).suggestions[0];
    expect(many).toMatchObject({ type: "bar", spec: { options: { orientation: "horizontal" } } });
    expect(many.spec.data).toHaveLength(8);
    const tail = [100, 90, 80, 70, 60, 50, 40, ...Array<number>(13).fill(1)].map((v, i) => ({ item: `item ${i + 1}`, v }));
    const rows = (lang?: "ko") => suggestCharts(tail, lang ? { lang } : {}).suggestions[0].spec.data as Record<string, unknown>[];
    expect(rows().at(-1)).toEqual({ item: "Other (13)", v: 13 });
    expect(rows("ko").at(-1)).toEqual({ item: "기타 13개", v: 13 });
  });
  it("shrinking regional sales are not a funnel, and negative pieces without a start and end do not suggest a waterfall first", () => {
    expect(suggestCharts(rowsOf("10-korean-krw.csv")).suggestions.map((s) => s.type)).not.toContain("funnel");
    expect(suggestCharts(rowsOf("05-pie-neg-zero.csv")).suggestions[0].type).not.toBe("waterfall");
    const wf = CHARTS.find((c) => c.type === "waterfall")!.example.data as Record<string, unknown>[];
    expect(suggestCharts(wf).suggestions[0].type).toBe("waterfall");
  });
});

describe("parseColor", () => {
  it('cannot read non-hex text like "#12345g"', () => {
    expect(parseColor("#12345g")).toBeNull();
    expect(parseColor("#1234567g")).toBeNull();
    expect(parseColor("#12345f")).toEqual([0x12, 0x34, 0x5f, 1]);
  });
});

/**
 * useChartData needs its effects (useEffect) to run, so only this block loads it with a small fake React.
 * The SSR tests above use the real React as is (vi.doMock applies only to the dynamic imports after it)
 */
describe("useChartData", () => {
  type Hook = { status: string; loading: boolean; data: unknown[]; error: Error | null; reload: () => void };
  function fakeReact() {
    let slots: { v?: unknown; deps?: unknown[]; cleanup?: unknown; set?: (u: unknown) => void; current?: unknown }[] = [];
    let idx = 0;
    let pending: (() => void)[] = [];
    let comp: (p: unknown) => Hook = () => ({}) as Hook;
    let props: unknown;
    let out: Hook;
    let dirty = false;
    const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
    const render = () => {
      idx = 0;
      out = comp(props);
      const e = pending;
      pending = [];
      e.forEach((f) => f());
    };
    const fake = {
      createContext: (v: unknown) => ({ _v: v, Provider: () => null }),
      useContext: (c: { _v: unknown }) => c._v,
      useRef: (v: unknown) => (slots[idx] ??= { current: v }, slots[idx++]),
      useState: (init: unknown) => {
        const i = idx++;
        if (!slots[i]) {
          const s: (typeof slots)[number] = { v: typeof init === "function" ? (init as () => unknown)() : init };
          s.set = (u) => {
            s.v = typeof u === "function" ? (u as (p: unknown) => unknown)(s.v) : u;
            dirty = true;
            queueMicrotask(() => dirty && ((dirty = false), render()));
          };
          slots[i] = s;
        }
        return [slots[i].v, slots[i].set];
      },
      useMemo: (f: () => unknown, deps: unknown[]) => {
        const i = idx++;
        if (slots[i] && same(slots[i].deps, deps)) return slots[i].v;
        slots[i] = { v: f(), deps };
        return slots[i].v;
      },
      useCallback: (f: unknown, deps: unknown[]) => fake.useMemo(() => f, deps),
      useEffect: (f: () => unknown, deps: unknown[]) => {
        const i = idx++;
        const s = slots[i];
        if (s && same(s.deps, deps)) return;
        pending.push(() => {
          (s?.cleanup as (() => void) | undefined)?.();
          slots[i] = { deps, cleanup: f() };
        });
        if (!s) slots[i] = {};
      },
    };
    const mount = (c: (p: never) => Hook, p: unknown) => {
      comp = c as (p: unknown) => Hook;
      props = p;
      slots = [];
      render();
      return { get: () => out, rerender: (p2: unknown) => ((props = p2), render()), unmount: () => slots.forEach((s) => (s?.cleanup as (() => void) | undefined)?.()) };
    };
    return { fake, mount };
  }
  /** Loads the module fresh with the fake React. before can swap other modules too */
  async function withFakeReact<M>(load: () => Promise<M>, before?: () => void) {
    const { fake, mount } = fakeReact();
    vi.resetModules();
    vi.doMock("react", () => ({ ...fake, default: fake }));
    vi.doMock("react/jsx-runtime", () => ({ jsx: () => null, jsxs: () => null, Fragment: null }));
    before?.();
    try {
      return { mod: await load(), mount };
    } finally {
      vi.doUnmock("react");
      vi.doUnmock("react/jsx-runtime");
    }
  }
  const loadHook = async () => {
    const { mod, mount } = await withFakeReact(() => import("../src/data/useChartData"));
    return { useChartData: mod.useChartData, mount };
  };
  const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  /** A "slow" URL responds after 50ms, any other after 5ms. AbortError when aborted */
  const fakeFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((res, rej) => {
      const url = input instanceof Request ? input.url : String(input);
      const t = setTimeout(() => res(new Response(JSON.stringify([{ src: url }]), { headers: { "content-type": "application/json" } })), url.includes("slow") ? 50 : 5);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(t);
        rej(new DOMException("aborted", "AbortError"));
      });
    });

  it("goes idle instead of staying loading when enabled turns false or the source becomes null mid-fetch", async () => {
    const { useChartData, mount } = await loadHook();
    vi.stubGlobal("fetch", fakeFetch);
    try {
      const a = mount((p: { url: string; on: boolean }) => useChartData(p.url, { enabled: p.on }) as Hook, { url: "https://x/slow.json", on: true });
      await tick(1);
      a.rerender({ url: "https://x/slow.json", on: false });
      await tick(80);
      expect(a.get().status).toBe("idle");
      a.unmount();
      const b = mount((p: { url: string | null }) => useChartData(p.url) as Hook, { url: "https://x/slow.json" });
      await tick(1);
      b.rerender({ url: null });
      await tick(80);
      expect(b.get()).toMatchObject({ status: "idle", loading: false });
      b.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Chart does not reparse a { csv } spec when the data object is the same (inlineRows in useMemo)", async () => {
    let parsed = 0;
    const { mod, mount } = await withFakeReact(
      () => import("../src/charts/Chart"),
      () =>
        vi.doMock("../src/data/parse", async (orig) => {
          const m = await orig<typeof import("../src/data/parse")>();
          return { ...m, parseCSV: (...a: Parameters<typeof m.parseCSV>) => (parsed++, m.parseCSV(...a)) };
        }),
    );
    try {
      const spec = { type: "pie", data: { csv: "label,value\na,1\nb,2" } };
      const h = mount((p: { spec: never }) => mod.Chart(p) as never, { spec });
      h.rerender({ spec: { ...spec } });
      h.rerender({ spec: { ...spec } });
      expect(parsed).toBe(1);
      h.unmount();
    } finally {
      vi.doUnmock("../src/data/parse");
    }
  });

  it("data arrives even when responses are slower than refreshMs, since a refresh does not cancel the previous request", async () => {
    const { useChartData, mount } = await loadHook();
    let open = 0;
    let most = 0;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      most = Math.max(most, ++open);
      return fakeFetch(input, init).finally(() => open--);
    });
    const h = mount((p: { url: string }) => useChartData(p.url, { refreshMs: 20 }) as Hook, { url: "https://x/slow.json" });
    try {
      await tick(200);
      // A refresh keeps running, so status may be loading. Check that the data arrived and that requests did not overlap
      expect(h.get().data).toHaveLength(1);
      expect(h.get().error).toBeNull();
      expect(most).toBe(1);
    } finally {
      h.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("fast responses reload every refreshMs", async () => {
    const { useChartData, mount } = await loadHook();
    let calls = 0;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => (calls++, fakeFetch(input, init)));
    const h = mount((p: { url: string }) => useChartData(p.url, { refreshMs: 20 }) as Hook, { url: "https://x/fast.json" });
    try {
      await tick(130);
      expect(h.get().data).toHaveLength(1);
      expect(calls).toBeGreaterThanOrEqual(4);
    } finally {
      h.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("a Request with a body can reload too (cloned each time)", async () => {
    const { useChartData, mount } = await loadHook();
    let calls = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      if (!(input instanceof Request) || input.bodyUsed) throw new TypeError("body used");
      expect(await input.text()).toBe("q");
      return fakeFetch(input.url, init);
    });
    try {
      const req = new Request("https://x/fast.json", { method: "POST", body: "q" });
      const h = mount((p: { src: Request }) => useChartData(p.src) as Hook, { src: req });
      await tick(30);
      expect(h.get().status).toBe("success");
      h.get().reload();
      await tick(30);
      expect(h.get()).toMatchObject({ status: "success", error: null });
      expect(calls).toBe(2);
      h.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("color options", () => {
  it("rejects a candle color that would break out of the legend style", async () => {
    const { validateSpec } = await import("../src/spec/validate");
    const base = { type: "candlestick", data: [{ date: "2024-01-01", open: 1, high: 2, low: 0.5, close: 1.5 }], encoding: { x: "date", open: "open", high: "high", low: "low", close: "close" } };
    const bad = validateSpec({ ...base, options: { upColor: "red;background:url(https://x.test/a)" } });
    expect(bad.errors.map((e) => e.code)).toContain("bad_option_color");
    const ok = validateSpec({ ...base, options: { upColor: "accent", downColor: "#d33" } });
    expect(ok.errors.map((e) => e.code)).not.toContain("bad_option_color");
  });
});
