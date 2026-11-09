import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Chart } from "../src/charts/Chart";
import { formatCompact, formatNumber, formatPercent, makeFormatter, toDate } from "../src/core/format";
import { getter, strGetter, toNumber } from "../src/data/accessor";
import { parseCSV } from "../src/data/parse";
import { readResponse } from "../src/data/useChartData";
import { renderSpecToHTML, renderSpecToSVG } from "../src/server";
import { suggestCharts, validateSpec } from "../src/spec";
import { specLocale } from "../src/spec/meta";
import { parseColor } from "../src/theme/color";
import { DEFAULT_FONT, darkTheme, themeToCss } from "../src/theme/tokens";

const codes = (spec: unknown) => validateSpec(spec).errors.map((e) => `${e.path}:${e.code}`);
const pie = { type: "pie", data: [{ label: "a", value: 1 }] };

describe("보안: 테마 값과 범례 색 (CLI, MCP의 SVG, HTML)", () => {
  // 리뷰어 evil.json 그대로
  const evil = { type: "pie", data: [{ label: "a", value: 1 }], card: { title: "Sales", legend: [{ label: "L", color: 'x"/><script>alert(document.domain)</script><x y="' }] }, theme: { accent: "red}</style><script>alert(2)</script><style>" } };

  it("evil.json은 검증에서 bad_theme_value, bad_legend_color로 막혀요", () => {
    expect(codes(evil)).toEqual(["card.legend[0].color:bad_legend_color", "theme.accent:bad_theme_value"]);
    expect(() => renderSpecToSVG(evil as never)).toThrow(/theme\.accent/);
    expect(() => renderSpecToHTML(evil as never)).toThrow(/card\.legend\[0\]\.color/);
  });

  it("CSS 주입(; url())과 문자열, 숫자가 아닌 값도 막아요", () => {
    for (const accent of ["red;background:url(https://evil.example/t)", "url(//evil.example/t)", "image(x)", "red}", "a\\62", '"x"']) expect(codes({ ...pie, theme: { accent } })).toEqual(["theme.accent:bad_theme_value"]);
    expect(codes({ ...pie, theme: { radius: '"/><script>' } })).toEqual(["theme.radius:bad_theme_value"]);
    expect(codes({ ...pie, theme: { ink: { a: 1 } } })).toEqual(["theme.ink:bad_theme_value"]);
    expect(codes({ ...pie, card: { legend: [{ label: "L", color: 3 }] } })).toEqual(["card.legend[0].color:bad_legend_color"]);
  });

  it("올바른 CSS 색, 길이, 글꼴은 그대로 받아요", () => {
    const theme = { accent: "#0B8FD8", ink: "rgb(1 2 3 / 50%)", muted: "oklch(70% 0.1 200)", line: "rebeccapurple", panel: "var(--brand, #fff)", tint: "color-mix(in oklab, red 40%, blue)", bg: "hsl(210deg 20% 10%)", radius: 12, fontFamily: DEFAULT_FONT, monoFamily: "'Roboto Mono', monospace", name: "Brand: v2 (아침)" };
    expect(validateSpec({ ...pie, theme, card: { title: "t", legend: [{ label: "a", color: "accent" }, { label: "b", color: "#123" }] } }).errors).toEqual([]);
  });

  it("검사를 거치지 않는 opts.theme도 SVG, HTML에서 이스케이프해요", () => {
    const pay = '"/><script>alert(1)</script><x a="';
    const svg = renderSpecToSVG({ ...pie, card: { title: "t" } } as never, { theme: { ink: pay, panel: pay, line: pay, radius: pay as never } });
    expect(svg).not.toContain("<script");
    const html = renderSpecToHTML(pie as never, { theme: { accent: "red}</style><script>alert(2)</script><style>" } });
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/<\/style><script/);
  });

  it("themeToCss는 <를 CSS 이스케이프로 바꿔 </style>을 만들지 못해요", () => {
    const css = themeToCss({ ...darkTheme, accent: "red}</style><script>" });
    expect(css).not.toContain("<");
    expect(css).toContain("\\3c /style>");
  });

  it('범례 색 "constructor"는 객체 속성(함수 본문)을 꺼내지 않아요', () => {
    const svg = renderSpecToSVG({ ...pie, card: { title: "t", legend: [{ label: "L", color: "constructor" }] } } as never);
    expect(svg).not.toContain("function Object");
  });
});

describe("로캘 검사와 고치기", () => {
  const bar = { type: "bar", data: [{ x: "a", y: 12345 }], encoding: { x: "x", y: "y" } };
  it('틀린 로캘("", "a b")은 bad_locale, "ko_KR"과 "en_US"는 받아요', () => {
    expect(codes({ ...bar, options: { locale: "" } })).toEqual(["options.locale:bad_locale"]);
    expect(codes({ ...bar, options: { locale: "a b" } })).toEqual(["options.locale:bad_locale"]);
    expect(codes({ ...bar, options: { locale: "ko_KR" } })).toEqual([]);
    expect(codes({ ...bar, options: { locale: "en_US" } })).toEqual([]);
  });
  it('"ko_KR"은 ko-KR로 그려요 (RangeError 없이 한국어 글자)', () => {
    expect(specLocale({ options: { locale: "ko_KR" } })).toBe("ko-KR");
    expect(specLocale({ options: { locale: "" } })).toBeUndefined();
    const svg = renderSpecToSVG({ ...bar, options: { locale: "ko_KR" } } as never);
    expect(svg).toContain("<title");
    expect(svg).toContain("막대 차트");
    expect(renderToStaticMarkup(createElement(Chart, { spec: { ...bar, options: { locale: "en_US" } } as never, animate: false }))).toContain("12,345");
  });
});

describe("날짜 (YYYYMMDD, 없는 날)", () => {
  it("8자리 19000101~21001231은 날짜, 실제 ms 타임스탬프는 그대로", () => {
    expect(toDate(20240315)?.toDateString()).toBe(new Date(2024, 2, 15).toDateString());
    expect(toDate("20240315")?.getDate()).toBe(15);
    expect(toDate(1_700_000_000_000)?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(toDate(30_000_101)?.getTime()).toBe(30_000_101);
    expect(toDate(2024)?.getFullYear()).toBe(2024);
  });
  it('없는 날("2024-02-30", "2024-13-45", 20240230)은 다음 달로 넘기지 않고 null', () => {
    for (const v of ["2024-02-30", "2024-13-45", "2024-13", "2024.02.30", 20240230, "20241301"]) expect(toDate(v)).toBeNull();
    expect(toDate("2024-02-29")?.getDate()).toBe(29);
  });
  it("CSV의 YYYYMMDD 열로 캘린더를 그리면 1970년이 아니라 그 달이에요", () => {
    const svg = renderSpecToSVG({ type: "calendar", data: { csv: "date,value\n20240301,1\n20240302,2\n20240303,3" } } as never);
    const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(texts).toContain("Mar");
    expect(texts).not.toContain("Jan");
  });
});

describe("숫자 포맷", () => {
  it("minimumFractionDigits가 1보다 커도 던지지 않아요", () => {
    expect(formatNumber(1.5, { minimumFractionDigits: 2 })).toBe("1.50");
    expect(formatCompact(12345, { minimumFractionDigits: 2 })).toBe("12.35K");
    expect(formatCompact(12345, { locale: "ko", minimumFractionDigits: 2 })).toBe("1.23만");
    expect(makeFormatter({ minimumFractionDigits: 3 })(1)).toBe("1.000");
  });
  it("통화 코드가 있으면 그 통화의 자릿수, 없으면 검증 오류", () => {
    expect(makeFormatter({ style: "currency", currency: "USD" })(1.5)).toBe("$1.50");
    expect(formatNumber(1.5, { style: "currency", currency: "USD" })).toBe("$1.50");
    expect(codes({ type: "bar", data: [{ x: "a", y: 1 }], encoding: { x: "x", y: "y" }, options: { format: { style: "currency" } } })).toEqual(["options.format:bad_format"]);
    expect(codes({ type: "bar", data: [{ x: "a", y: 1 }], encoding: { x: "x", y: "y" }, options: { format: { style: "currency", currency: "EUR", suffix: "!" } } })).toEqual([]);
  });
  it('formatPercent(NaN)은 "-"', () => {
    expect(formatPercent(NaN)).toBe("-");
    expect(makeFormatter("ratio")(NaN)).toBe("-");
  });
});

describe("accessor", () => {
  it("Date 범주 이름은 로컬 날짜예요 (UTC로 하루 밀리지 않아요)", () => {
    const g = strGetter<{ d: Date }>("d", "d");
    expect(g({ d: new Date(2024, 2, 15) }, 0)).toBe("2024-03-15");
    expect(g({ d: new Date(2024, 2, 15, 23, 59) }, 0)).toBe("2024-03-15");
  });
  it("Object.prototype의 이름은 필드가 아니고, 클래스 getter와 직접 넣은 constructor는 필드예요", () => {
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
  it.each([["$"], ["%"], ["원"], [","], ["()"], ["1,2,3"], ["12,34"], ["1.234,56"]])("toNumber(%j)은 NaN", (s) => expect(toNumber(s)).toBeNaN());
  it("올바른 천 단위 쉼표와 기호는 그대로 읽어요", () => {
    expect(toNumber("1,234,567.5")).toBe(1234567.5);
    expect(toNumber("(1,234)")).toBe(-1234);
    expect(toNumber("-1,234원")).toBe(-1234);
    expect(toNumber("$0")).toBe(0);
  });
});

describe("CSV", () => {
  it("머리글 a,a,a_2가 겹쳐도 열을 잃지 않아요", () => {
    expect(parseCSV("a,a,a_2\n1,2,3")).toEqual([{ a: 1, a_2: 2, a_2_2: 3 }]);
    expect(parseCSV(",col1\n1,2")).toEqual([{ col1: 1, col1_2: 2 }]);
  });
  it('따옴표 앞 공백(a, "b, c")도 따옴표 칸이에요', () => {
    expect(parseCSV('name,desc\na, "b, c"')).toEqual([{ name: "a", desc: "b, c" }]);
    expect(parseCSV('a,b\n"x" , "y"', { typed: false })).toEqual([{ a: "x ", b: "y" }]);
  });
});

describe("validateSpec 행 모양", () => {
  it("data:[null]과 highlight가 있어도 던지지 않고 bad_row", () => {
    expect(codes({ type: "bar", data: [null], options: { highlight: "x" } })).toEqual(["data[0]:bad_row"]);
  });
  it("data.values 행도 검사해서 경로 data.values[i]로 알려 줘요", () => {
    expect(codes({ type: "pie", data: { values: [{ label: "a", value: 1 }, 2] } })).toEqual(["data.values[1]:bad_row"]);
    expect(() => validateSpec({ type: "bar", data: { values: [null] }, encoding: { x: "a", y: "b" }, options: { highlight: "x" } })).not.toThrow();
  });
});

describe("응답 읽기", () => {
  it("JSON content-type이면 주소에 csv가 있어도 JSON이에요", async () => {
    const json = () => new Response('{"rows":[{"a":1}]}', { headers: { "content-type": "application/json; charset=utf-8" } });
    expect(await readResponse(json(), "auto", "https://x.com/q?format=csv")).toEqual({ rows: [{ a: 1 }] });
    expect(await readResponse(json(), "auto", "https://x.com/api/csv")).toEqual({ rows: [{ a: 1 }] });
    expect(await readResponse(new Response("a,b\n1,2"), "auto", "https://x.com/a.csv")).toEqual([{ a: 1, b: 2 }]);
  });
});

describe("Chart, 서버 렌더", () => {
  it("renderSpecToSVG에 { url } 데이터를 주면 resolveSpecData를 먼저 부르라고 알려 줘요", () => {
    expect(() => renderSpecToSVG({ type: "pie", data: { url: "https://x.com/a.csv" } } as never)).toThrow(/resolveSpecData/);
  });
  it("다시 불러오기가 한 번 실패해도 이전 데이터가 있으면 차트를 그대로 보여 줘요", async () => {
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
      // 데이터가 없을 때만 오류 화면
      st = state({ data: [] });
      expect(html()).toContain("HTTP 500");
    } finally {
      vi.doUnmock("../src/data/useChartData");
    }
  });
});

describe("추천: 연도, YYYYMMDD, 1월~12월은 시간", () => {
  const top = (csv: string) => {
    const r = suggestCharts(parseCSV(csv));
    return { kinds: r.profile.columns.map((c) => c.kind), first: r.suggestions[0] };
  };
  it("연도 열(2019…)은 date, 첫 추천은 라인", () => {
    const r = top("year,sales\n2019,90\n2020,100\n2021,120\n2022,130\n2023,150");
    expect(r.kinds).toEqual(["date", "number"]);
    expect(r.first.type).toBe("line");
  });
  it("YYYYMMDD 열은 date이고 라인 스펙은 xType date", () => {
    const r = top("date,sales\n20240301,90\n20240302,100\n20240303,120");
    expect(r.kinds).toEqual(["date", "number"]);
    expect(r.first).toMatchObject({ type: "line", spec: { options: { xType: "date" } } });
    expect(validateSpec(r.first.spec).valid).toBe(true);
  });
  it('"1월"~"12월"은 파이가 아니라 라인', () => {
    const r = top("월,매출\n1월,90\n2월,100\n3월,120\n4월,110");
    expect(r.kinds[0]).toBe("date");
    expect(r.first.type).toBe("line");
  });
  it("이름이 연도가 아닌 4자리 숫자(가격)는 그대로 숫자", () => {
    expect(top("item,price\na,1500\nb,2300\nc,1800").kinds).toEqual(["category", "number"]);
  });
});

describe("parseColor", () => {
  it('"#12345g"처럼 16진수가 아닌 글자는 못 읽어요', () => {
    expect(parseColor("#12345g")).toBeNull();
    expect(parseColor("#1234567g")).toBeNull();
    expect(parseColor("#12345f")).toEqual([0x12, 0x34, 0x5f, 1]);
  });
});

/**
 * useChartData는 효과(useEffect)가 돌아야 해서, 이 블록만 작은 가짜 React로 불러요.
 * 위의 SSR 테스트는 진짜 React를 그대로 써요 (vi.doMock은 이 뒤 동적 import에만 걸려요)
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
  /** 가짜 React로 모듈을 새로 불러요. before에서 다른 모듈도 바꿀 수 있어요 */
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
  /** "slow" 주소는 50ms 뒤, 나머지는 5ms 뒤 응답해요. 취소되면 AbortError */
  const fakeFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((res, rej) => {
      const url = input instanceof Request ? input.url : String(input);
      const t = setTimeout(() => res(new Response(JSON.stringify([{ src: url }]), { headers: { "content-type": "application/json" } })), url.includes("slow") ? 50 : 5);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(t);
        rej(new DOMException("aborted", "AbortError"));
      });
    });

  it("가져오는 중에 enabled가 false가 되거나 소스가 null이 되면 loading에 머물지 않고 idle", async () => {
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

  it("Chart는 { csv } 스펙을 data 객체가 같으면 다시 읽지 않아요 (inlineRows를 useMemo)", async () => {
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

  it("응답이 refreshMs보다 느려도 새로 고침이 앞 요청을 취소하지 않아 데이터가 와요", async () => {
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
      // 새로 고침이 이어서 돌아 status는 loading일 수 있어요. 데이터가 왔는지와 요청이 겹치지 않았는지를 봐요
      expect(h.get().data).toHaveLength(1);
      expect(h.get().error).toBeNull();
      expect(most).toBe(1);
    } finally {
      h.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("빠른 응답은 refreshMs마다 다시 불러와요", async () => {
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

  it("본문이 있는 Request도 다시 불러올 수 있어요 (매번 clone)", async () => {
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
