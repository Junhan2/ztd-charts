import { describe, expect, it, vi } from "vitest";
import { fetchChartData, readResponse } from "../src/data/useChartData";
import { dataSignature, fromObjects, fromRows, lttb, melt, normalizeData, parseCSV, pluck, toCSV } from "../src/data/parse";
import { toNumber } from "../src/data/accessor";
import { percentile, percentiles } from "../src/data/percentile";
import { formatCompact, formatCurrency, formatPercent, makeFormatter, toDate } from "../src/core/format";
import { fitDomain, niceStep, robustMax, ticksFor, timeTicks } from "../src/core/scale";
import { dodgeVertical, textWidth, truncate, wrapLines } from "../src/core/text";
import { thinLabels } from "../src/core/axis";
import { prepSeries } from "../src/core/series";
import { resolveHighlight } from "../src/core/highlight";
import { lazyArray } from "../src/core/lazy";

describe("parseCSV", () => {
  it("숫자, 빈 칸, 따옴표를 처리해요", () => {
    const rows = parseCSV('월,매출,메모\n1월,"1,200",\n2월,1350,"쉼표, 있음"\n');
    expect(rows).toEqual([
      { 월: "1월", 매출: 1200, 메모: null },
      { 월: "2월", 매출: 1350, 메모: "쉼표, 있음" },
    ]);
  });
  it("칸 안 줄바꿈과 이스케이프된 따옴표", () => {
    const rows = parseCSV('a,b\n"줄\n바꿈","그는 ""안녕"" 했다"');
    expect(rows[0]).toEqual({ a: "줄\n바꿈", b: '그는 "안녕" 했다' });
  });
  it("BOM, CRLF, 탭과 세미콜론 구분자를 알아봐요", () => {
    expect(parseCSV("\uFEFFx,y\r\n1,2\r\n")).toEqual([{ x: 1, y: 2 }]);
    expect(parseCSV("x\ty\n1\t2")).toEqual([{ x: 1, y: 2 }]);
    expect(parseCSV("x;y\n1;2")).toEqual([{ x: 1, y: 2 }]);
  });
  it("퍼센트, 통화, 단위는 숫자로, 앞자리 0 코드는 문자열로", () => {
    const [r] = parseCSV('rate,price,cnt,zip,neg\n12%,"₩5,000",30명,01234,(42)');
    expect(r).toEqual({ rate: 12, price: 5000, cnt: 30, zip: "01234", neg: -42 });
  });
  it("중복 머리글은 이름을 바꾸고, header:false면 인덱스 키", () => {
    expect(Object.keys(parseCSV("a,a,\n1,2,3")[0])).toEqual(["a", "a_2", "col3"]);
    expect(parseCSV("1,2", { header: false })).toEqual([{ "0": 1, "1": 2 }]);
  });
  it("typed:false면 모두 문자열", () => {
    expect(parseCSV("a\n007", { typed: false })).toEqual([{ a: "007" }]);
  });
  it("toCSV와 왕복해요", () => {
    const rows = [{ 이름: '따옴표 " 쉼표, 있음', 값: 1 }];
    expect(parseCSV(toCSV(rows))).toEqual(rows);
  });
});

describe("행 모양 바꾸기", () => {
  it("fromRows: 머리글 행, 열 이름 따로", () => {
    expect(fromRows([["월", "매출"], ["1월", "1200"]])).toEqual([{ 월: "1월", 매출: 1200 }]);
    expect(fromRows([["1월", 10]], ["월", "매출"])).toEqual([{ 월: "1월", 매출: 10 }]);
  });
  it("fromObjects: 키-값 맵과 열 모음", () => {
    expect(fromObjects({ 모바일: 72, PC: 23 })).toEqual([
      { label: "모바일", value: 72 },
      { label: "PC", value: 23 },
    ]);
    expect(fromObjects({ 월: ["1월", "2월"], 매출: [1, 2] })).toEqual([
      { 월: "1월", 매출: 1 },
      { 월: "2월", 매출: 2 },
    ]);
  });
  it("melt: 넓은 표를 긴 표로", () => {
    expect(melt([{ 월: "1월", 검색: 1, SNS: 2 }], ["월"])).toEqual([
      { 월: "1월", series: "검색", value: 1 },
      { 월: "1월", series: "SNS", value: 2 },
    ]);
  });
  it("normalizeData: 여러 응답 모양", () => {
    expect(normalizeData({ data: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(normalizeData({ rows: [[1]], columns: [{ name: "a" }] })).toEqual([{ a: 1 }]);
    expect(normalizeData({ values: [["a"], ["2"]] })).toEqual([{ a: 2 }]);
    expect(normalizeData("a,b\n1,2")).toEqual([{ a: 1, b: 2 }]);
    expect(normalizeData('[{"a":1}]')).toEqual([{ a: 1 }]);
    expect(normalizeData([3, 4])).toEqual([
      { label: "1", value: 3 },
      { label: "2", value: 4 },
    ]);
    expect(normalizeData(null)).toEqual([]);
  });
  it("pluck와 dataSignature", () => {
    expect(pluck({ a: { b: [1] } }, "a.b")).toEqual([1]);
    const big = Array.from({ length: 5000 }, (_, i) => ({ i }));
    expect(dataSignature(big)).toBe(dataSignature(big.slice()));
    expect(dataSignature([{ a: 1 }])).not.toBe(dataSignature([{ a: 2 }]));
  });
});

describe("toNumber", () => {
  it.each([
    ["1,234", 1234],
    [" 3.5 ", 3.5],
    ["12%", 12],
    ["₩5,000", 5000],
    ["+7", 7],
    ["(12)", -12],
    ["1234.50", 1234.5],
    [true, 1],
  ])("%s → %s", (input, out) => expect(toNumber(input)).toBe(out));
  it("못 읽으면 NaN", () => {
    expect(toNumber("abc")).toBeNaN();
    expect(toNumber("")).toBeNaN();
    expect(toNumber(undefined)).toBeNaN();
  });
});

describe("LTTB", () => {
  it("끝점을 지키고 개수를 맞춰요", () => {
    const pts = Array.from({ length: 10_000 }, (_, i) => ({ x: i, y: Math.sin(i / 50) + (i === 5000 ? 10 : 0) }));
    const out = lttb(pts, 500);
    expect(out).toHaveLength(500);
    expect(out[0]).toBe(pts[0]);
    expect(out[out.length - 1]).toBe(pts[pts.length - 1]);
    expect(out.some((p) => p.x === 5000)).toBe(true);
  });
});

describe("숫자 포맷 (기본 en-US, ko는 만, 억)", () => {
  it("영어 짧은 숫자는 K, M, B", () => {
    expect(formatCompact(12345)).toBe("12.3K");
    expect(formatCompact(3_400_000)).toBe("3.4M");
    expect(formatCompact(1_200_000_000)).toBe("1.2B");
    expect(formatCompact(-0.03)).toBe("0");
    expect(makeFormatter("compact")(1234)).toBe("1.2K");
  });
  it("한국어 짧은 숫자는 만, 억, 조", () => {
    const ko = { locale: "ko-KR" };
    expect(formatCompact(12345, ko)).toBe("1.2만");
    expect(formatCompact(340_000_000, { locale: "ko" })).toBe("3.4억");
    expect(formatCompact(-2_500_000_000_000, ko)).toBe("-2.5조");
    expect(formatCompact(950, ko)).toBe("950");
    expect(makeFormatter("compact", "ko-KR")(12345)).toBe("1.2만");
  });
  it("퍼센트는 1% 미만만 소수", () => {
    expect(formatPercent(8.06)).toBe("8%");
    expect(formatPercent(0.42)).toBe("0.4%");
  });
  it("통화와 포맷 이름", () => {
    expect(formatCurrency(5000)).toBe("$5,000.00");
    expect(formatCurrency(5000, { locale: "ko-KR" })).toBe("₩5,000");
    expect(makeFormatter("currency", "ko-KR")(5000)).toBe("₩5,000");
    expect(makeFormatter("integer")(1234.6)).toBe("1,235");
    expect(makeFormatter("ratio")(0.25)).toBe("25%");
    expect(makeFormatter({ suffix: "명", maximumFractionDigits: 0 })(1234)).toBe("1,234명");
  });
  it("날짜 문자열", () => {
    expect(toDate("2025-03")?.getMonth()).toBe(2);
    expect(toDate("2025-03-15")?.getDate()).toBe(15);
    expect(toDate("2025.03.15")?.getDate()).toBe(15);
    expect(toDate(2024)?.getFullYear()).toBe(2024);
    expect(toDate("모름")).toBeNull();
  });
});

describe("스케일과 눈금", () => {
  it("niceStep은 1, 2, 5 단위", () => {
    expect(niceStep(100, 4)).toBe(20);
    expect(niceStep(4346, 3)).toBe(2000);
    expect(niceStep(0.9, 4)).toBe(0.2);
  });
  it("fitDomain은 빈 눈금 칸을 만들지 않아요", () => {
    expect(fitDomain(0, 4100, 3)).toEqual([0, 4100 + 4100 * 0.07]);
    expect(fitDomain(0, 98, 4)).toEqual([0, 100]);
    expect(fitDomain(12, 30, 4, { zero: false })[0]).toBeLessThanOrEqual(12);
  });
  it("ticksFor", () => {
    expect(ticksFor(0, 100, 4)).toEqual([0, 20, 40, 60, 80, 100]);
  });
  it("timeTicks는 기간에 맞는 단위", () => {
    const t0 = new Date(2025, 0, 1).getTime();
    const t1 = new Date(2025, 11, 1).getTime();
    const ticks = timeTicks(t0, t1, 6);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks[0].label).toBe("Jan");
    expect(timeTicks(t0, t1, 6, "ko-KR")[0].label).toBe("1월");
  });
  it("robustMax는 튀는 값을 무시해요", () => {
    const v = Array.from({ length: 100 }, (_, i) => (i === 99 ? 1000 : i));
    expect(robustMax(v)).toBeLessThan(100);
  });
});

describe("글자 폭 추정", () => {
  it("Pretendard 실측과 10% 안", () => {
    // 크롬에서 잰 실제 폭(em)
    const real: [string, number, number][] = [
      ["모바일", 400, 2.58],
      ["전환 유형별 비중", 400, 6.52],
      ["10,000", 700, 3.34],
      ["PMax", 400, 2.5],
      ["−380", 400, 2.384],
    ];
    for (const [s, w, em] of real) {
      const est = textWidth(s, 100, w) / 100;
      expect(Math.abs(est - em) / em).toBeLessThan(0.1);
    }
  });
  it("truncate는 폭 안에 들어가요", () => {
    const t = truncate("아주 긴 캠페인 이름입니다", 60, 12);
    expect(t.endsWith("…")).toBe(true);
    expect(textWidth(t, 12)).toBeLessThanOrEqual(60);
  });
  it("truncate는 알아볼 수 없는 토막 대신 빈 글자를 돌려주고, 끝 빈칸은 떼고 재요", () => {
    expect(truncate("T-shirt", textWidth("T…", 11), 11)).toBe("");
    expect(truncate("티셔츠", textWidth("티…", 11), 11)).toBe("");
    expect(truncate("데일리 런", textWidth("데일…", 11), 11)).toBe("데일…");
    expect(truncate("Daily Run", textWidth("Dai…", 11) + 0.1, 11)).toBe("Dai…");
    expect(truncate("Drop-off ", textWidth("Drop-off", 11), 11)).toBe("Drop-off");
  });
  it("wrapLines는 빈칸에서 나누고 마지막 줄만 말줄임해요", () => {
    const w = textWidth("profit (100M)", 11, 700) + 1;
    expect(wrapLines("Operating profit (100M)", w, 11, 2, 700)).toEqual(["Operating", "profit (100M)"]);
    expect(wrapLines("매출(억)", w, 11, 2, 700)).toEqual(["매출(억)"]);
    const one = wrapLines("Operating profit (100M)", w, 11, 1, 700);
    expect(one).toHaveLength(1);
    expect(one[0].endsWith("…")).toBe(true);
  });
  it("thinLabels는 keep(폭포 차트의 시작, 끝 합계)을 남기고 그 둘레를 솎아요", () => {
    const labels = ["Sep", "New", "Repeat", "Discounts", "Refunds", "Oct"];
    const centers = labels.map((_, i) => 20 + i * 42);
    expect(thinLabels(centers, labels, 10.5, 6, 600)).toEqual([0, 2, 4]);
    expect(thinLabels(centers, labels, 10.5, 6, 600, new Set([0, 5]))).toEqual([0, 2, 4, 5]);
  });
  it("thinLabels는 keep끼리 겹치면 앞의 것만 남기고 나머지를 솎아요", () => {
    const labels = ["Revenue", "Margin", "Profit", "Costs", "Taxes", "Total"];
    const centers = labels.map((_, i) => 20 + i * 30);
    const show = thinLabels(centers, labels, 10.5, 6, 600, new Set([1, 2]));
    expect(show).toContain(1);
    expect(show).not.toContain(2);
    expect(show).not.toEqual([0, labels.length - 1]);
  });
  it("dodgeVertical은 최소 간격을 지켜요", () => {
    const ys = dodgeVertical([10, 11, 12, 50], 14, 0, 200);
    const sorted = [...ys].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(13.99);
  });
});

describe("계열 준비와 강조", () => {
  it("긴 표, 넓은 표, 날짜 x", () => {
    const long = prepSeries([{ m: "2025-01", s: "a", v: 1 }, { m: "2025-02", s: "a", v: 2 }, { m: "2025-01", s: "b", v: 3 }], "m", "v", "s");
    expect(long.type).toBe("date");
    expect(long.series).toEqual(["a", "b"]);
    expect(long.values[1][1]).toBeNaN();
    const wide = prepSeries([{ m: "1월", a: 1, b: 2 }], "m", ["a", "b"], undefined);
    expect(wide.series).toEqual(["a", "b"]);
    expect(wide.values[1][0]).toBe(2);
  });
  it("resolveHighlight", () => {
    const labels = ["a", "b", "c"];
    const values = [3, 9, 1];
    expect([...resolveHighlight(undefined, labels, labels, values)]).toEqual([1]);
    expect([...resolveHighlight("c", labels, labels, values)]).toEqual([2]);
    expect([...resolveHighlight(["a", 2], labels, labels, values)].sort()).toEqual([0, 2]);
    expect([...resolveHighlight("none", labels, labels, values)]).toEqual([]);
    expect([...resolveHighlight((d: string) => d !== "b", labels, labels, values)]).toEqual([0, 2]);
  });
});

describe("응답 읽기", () => {
  it("JSON, CSV를 알아서 읽어요", async () => {
    expect(await readResponse(new Response('[{"a":1}]'))).toEqual([{ a: 1 }]);
    expect(await readResponse(new Response("a,b\n1,2", { headers: { "content-type": "text/csv" } }))).toEqual([{ a: 1, b: 2 }]);
  });
  it("HTML을 받으면 표로 읽지 않고 알려줘요 (없는 파일에 index.html을 주는 정적 호스팅)", async () => {
    await expect(readResponse(new Response("<!doctype html><html><body>앱</body></html>", { headers: { "content-type": "text/html; charset=utf-8" } }), "auto", "/data/x.json")).rejects.toThrow(/HTML page instead of data.*\/data\/x\.json/);
    await expect(readResponse(new Response("<!doctype html>"), "auto", "/data/x.json", "ko")).rejects.toThrow(/HTML 페이지.*\/data\/x\.json/);
    await expect(readResponse(new Response("\n<!DOCTYPE html>\n<html lang=ko>"), "csv")).rejects.toThrow(/HTML/);
    expect(await readResponse(new Response("<b>x</b>"), "text")).toBe("<b>x</b>");
  });
  it("fetchChartData는 HTTP 오류를 상태 코드와 함께 던져요", async () => {
    vi.stubGlobal("fetch", async () => new Response("없음", { status: 404, statusText: "Not Found" }));
    try {
      await expect(fetchChartData("/data/없는-파일.json")).rejects.toThrow("HTTP 404 Not Found");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("lazyArray", () => {
  it("읽은 칸만 만들고, 배열 메서드도 빈 칸 없이 돌아요", () => {
    const made: number[] = [];
    const a = lazyArray(5, (i) => (made.push(i), i * 10));
    expect(a.length).toBe(5);
    expect(a[3]).toBe(30);
    expect(made).toEqual([3]);
    expect(a.slice(0, 2)).toEqual([0, 10]);
    expect(a.map((v) => v + 1)).toEqual([1, 11, 21, 31, 41]);
    expect(a.indexOf(40)).toBe(4);
    expect(1 in a).toBe(true);
    expect(5 in a).toBe(false);
    expect((a as unknown as Record<string, unknown>)[""]).toBeUndefined();
    expect(made.sort()).toEqual([0, 1, 2, 3, 4]);
  });
  it("지연 라벨로도 문자열 강조가 돼요", () => {
    const labels = lazyArray(3, (i) => ["a", "b", "c"][i]);
    expect([...resolveHighlight("b", labels, labels, [1, 2, 3])]).toEqual([1]);
  });
});

describe("percentile, percentiles", () => {
  it("percentile은 두 값 사이를 선형 보간하고, 숫자가 아닌 값은 빼요", () => {
    const xs = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(percentile(xs, 95)).toBeCloseTo(9.55, 10);
    expect(percentile(xs, 50)).toBe(5.5);
    expect(percentile([3, "x", null, "2", 1], 50)).toBe(2);
    expect(percentile([], 50)).toBeNaN();
    expect(percentile(xs, 101)).toBeNaN();
  });
  it("percentiles는 묶음이 처음 나온 순서대로 p50, p95, p99 행을 돌려줘요", () => {
    const rows = [
      ...Array.from({ length: 100 }, (_, i) => ({ minute: "10:01", api: "pay", ms: i + 1 })),
      ...Array.from({ length: 10 }, (_, i) => ({ minute: "10:00", api: "pay", ms: (i + 1) * 10 })),
      { minute: "10:00", api: "search", ms: "7" },
    ];
    const byMinute = percentiles(rows, { by: "minute", value: "ms" });
    expect(byMinute.map((r) => r.minute)).toEqual(["10:01", "10:00"]);
    expect(byMinute[0]).toEqual({ minute: "10:01", p50: 50.5, p95: expect.closeTo(95.05, 10), p99: expect.closeTo(99.01, 10) });
    const both = percentiles(rows, { by: ["minute", "api"], value: "ms", p: [90] });
    expect(both).toEqual([
      { minute: "10:01", api: "pay", p90: expect.closeTo(90.1, 10) },
      { minute: "10:00", api: "pay", p90: expect.closeTo(91, 10) },
      { minute: "10:00", api: "search", p90: 7 },
    ]);
  });
});
