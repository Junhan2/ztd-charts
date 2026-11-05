import { renderToStaticMarkup, renderToString } from "react-dom/server";
import type { KeyboardEvent, ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chart } from "../src/charts/Chart";
import { BarChart } from "../src/charts/bar";
import { Legend } from "../src/components/ChartCard";
import { GridY, tickLabels, yAxisWidth } from "../src/core/axis";
import { ChartFrame, type ChartFrameProps } from "../src/core/ChartFrame";
import { makeFormatter } from "../src/core/format";
import { MotionEngine } from "../src/core/motion";
import { fitDomain, niceStep, scaleLinear, timeTicks } from "../src/core/scale";
import { prepSeries } from "../src/core/series";
import { truncate } from "../src/core/text";
import type { ChartCtx } from "../src/core/useChart";
import type { ChartEvent } from "../src/core/types";
import { CHARTS } from "../src/spec";
import { makePainter } from "../src/theme/context";
import { darkTheme } from "../src/theme/tokens";

const darkPainter = makePainter(darkTheme, false);

afterEach(() => {
  vi.doUnmock("react");
  vi.doUnmock("../src/core/env");
  vi.doUnmock("../src/core/hooks");
  vi.resetModules();
  vi.unstubAllGlobals();
});

type Row = { x: string; y: number };
const ev = (i: number): ChartEvent<Row> => ({ datum: null, index: i, key: `k${i}`, label: `L${i}`, value: i, formatted: String(i) });

/** ChartFrame에 넘길 최소 ctx. setActive, click은 호출을 기록해요 */
function fakeCtx(active: number | null) {
  const calls = { setActive: [] as unknown[][], click: [] as number[] };
  const c = {
    p: darkPainter,
    width: 400,
    height: 200,
    measured: true,
    responsive: false,
    pending: false,
    node: null,
    hydrated: true,
    ref: () => {},
    motion: {} as ChartCtx<Row>["motion"],
    fv: String,
    fmt: String,
    pct: String,
    locale: "en-US",
    lang: "en",
    t: { chart: "chart", table: (l: string) => l, more: String, value: "Value", empty: "No data." },
    active,
    via: null,
    setActive: (...a: unknown[]) => void calls.setActive.push(a),
    click: (i: number) => void calls.click.push(i),
    events: { current: [] },
    showTooltip: true,
    showLabels: true,
    dim: () => 1,
    sig: "",
  } as unknown as ChartCtx<Row>;
  return { c, calls };
}

/** ChartFrame을 서버에서 그리고, 그린 루트 div 요소(onKeyDown 등 props)를 돌려줘요 */
function frameRoot(Frame: typeof ChartFrame, props: Partial<ChartFrameProps<Row>> & { c: ChartCtx<Row> }) {
  let root: ReactElement<Record<string, unknown>> | null = null;
  function Probe() {
    root = Frame({ kind: "Test chart", description: "desc", events: [ev(0), ev(1), ev(2)], tip: null, ...props }) as ReactElement<Record<string, unknown>>;
    return root;
  }
  const html = renderToStaticMarkup(<Probe />);
  return { root: root as unknown as ReactElement<{ onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void }>, html };
}

function key(k: string, onChild = false) {
  const self = {};
  const e = { key: k, target: onChild ? {} : self, currentTarget: self, prevented: false, preventDefault() {
    e.prevented = true;
  } };
  return e as typeof e & KeyboardEvent<HTMLDivElement>;
}

describe("ChartFrame 키보드 (a11y)", () => {
  it("안쪽 버튼에서 누른 Enter는 차트 onClick을 부르지 않고 막지도 않아요", () => {
    const { c, calls } = fakeCtx(1);
    const { root } = frameRoot(ChartFrame, { c });
    const fromButton = key("Enter", true);
    root.props.onKeyDown(fromButton);
    expect(calls.click).toEqual([]);
    expect(fromButton.prevented).toBe(false);
    const onFrame = key("Enter");
    root.props.onKeyDown(onFrame);
    expect(calls.click).toEqual([1]);
    expect(onFrame.prevented).toBe(true);
  });

  it("고른 항목이 없으면 Escape를 삼키지 않아요", () => {
    const idle = fakeCtx(null);
    const esc = key("Escape");
    frameRoot(ChartFrame, { c: idle.c }).root.props.onKeyDown(esc);
    expect(esc.prevented).toBe(false);
    expect(idle.calls.setActive).toEqual([]);

    const busy = fakeCtx(2);
    const esc2 = key("Escape");
    frameRoot(ChartFrame, { c: busy.c }).root.props.onKeyDown(esc2);
    expect(esc2.prevented).toBe(true);
    expect(busy.calls.setActive).toEqual([[null, "keyboard"]]);
  });
});

describe("ChartFrame 숨김 글자와 설명", () => {
  it("스크린리더 표와 알림 영역은 CSS 없이도(SSR, JS 없음) 인라인 스타일로 숨어요", () => {
    const html = renderToStaticMarkup(<BarChart data={[{ x: "A", y: 1 }, { x: "B", y: 2 }]} x="x" y="y" width={400} animate={false} />);
    const hidden = html.match(/<(span|div) class="ztd-sr"[^>]*>/g) ?? [];
    expect(hidden).toHaveLength(2);
    for (const tag of hidden) {
      expect(tag).toContain("position:absolute");
      expect(tag).toContain("width:1px");
      expect(tag).toContain("height:1px");
      expect(tag).toContain("overflow:hidden");
      expect(tag).toContain("clip:rect(0 0 0 0)");
      expect(tag).toContain("white-space:nowrap");
      expect(tag).toContain("margin:-1px");
    }
  });

  it("데이터가 없으면 extent 기본값 대신 'No data.'를 읽어요 (항목이 하나도 없는 차트 전부)", () => {
    const leaks: string[] = [];
    for (const ch of CHARTS) {
      for (const [locale, text] of [["en-US", "No data."], ["ko", "데이터가 없어요."]] as const) {
        const html = renderToStaticMarkup(<Chart spec={{ ...ch.example, data: [] }} width={400} animate={false} locale={locale} />);
        const desc = /<desc id="[^"]+">([^<]*)<\/desc>/.exec(html)?.[1];
        if (desc !== text) leaks.push(`${ch.type} ${locale}: ${desc}`);
      }
    }
    // 게이지는 데이터가 없어도 값 0인 항목 하나를 만들어서(radial.tsx) ChartFrame이 빈 차트로 알 수 없어요
    expect(leaks.filter((l) => !l.startsWith("gauge "))).toEqual([]);
  });

  it("데이터가 없어도 직접 준 설명은 그대로 써요", () => {
    const html = renderToStaticMarkup(<BarChart data={[]} x="x" y="y" width={400} animate={false} description="Quarterly revenue" />);
    expect(html).toMatch(/<desc id="[^"]+">Quarterly revenue<\/desc>/);
  });
});

describe("ChartFrame 터치 해제 effect (perf)", () => {
  it("렌더마다 새로 만드는 ctx 객체를 effect 의존값으로 쓰지 않아요 (리스너를 매번 다시 달지 않게)", async () => {
    const deps: unknown[][] = [];
    vi.resetModules();
    vi.doMock("react", async (orig) => {
      const R = await orig<typeof import("react")>();
      return { ...R, useEffect: (fn: () => void, d?: unknown[]) => (d && deps.push(d), R.useEffect(fn, d)) };
    });
    const { ChartFrame: Fresh } = await import("../src/core/ChartFrame");
    const a = fakeCtx(null).c;
    const b = { ...a } as ChartCtx<Row>;
    frameRoot(Fresh, { c: a });
    const first = deps.splice(0);
    frameRoot(Fresh, { c: b });
    expect(first.length).toBeGreaterThan(0);
    for (const d of [...first, ...deps]) expect(d.includes(a) || d.includes(b)).toBe(false);
  });
});

describe("useChart setActive (StrictMode)", () => {
  it("setState 갱신 함수를 두 번 돌려도 onHover는 바뀔 때 한 번만 불려요", async () => {
    // StrictMode처럼 갱신 함수를 두 번 불러 보는 useState
    vi.resetModules();
    vi.doMock("react", async (orig) => {
      const R = await orig<typeof import("react")>();
      return {
        ...R,
        useState: <S,>(init: S | (() => S)) => {
          const [v, set] = R.useState(init);
          return [v, (u: S | ((p: S) => S)) => (typeof u === "function" && ((u as (p: S) => S)(v), (u as (p: S) => S)(v)), set(u))];
        },
      };
    });
    const { useChart } = await import("../src/core/useChart");
    const hovered: (string | null)[] = [];
    let ctx: ChartCtx<Row> | null = null;
    function Probe() {
      ctx = useChart<Row>({ data: [], onHover: (e) => hovered.push(e ? e.label : null) }, { height: 100 });
      ctx.events.current = [ev(0), ev(1)];
      return null;
    }
    renderToStaticMarkup(<Probe />);
    const c = ctx as unknown as ChartCtx<Row>;
    c.setActive(1);
    c.setActive(1);
    c.setActive(null);
    await Promise.resolve();
    expect(hovered).toEqual(["L1", null]);
  });
});

describe("SSR 하이드레이션: CSS 등장 스타일 (와플, 캘린더)", () => {
  async function renderInBrowser(hydrated: boolean) {
    vi.resetModules();
    vi.stubGlobal("window", {});
    vi.doMock("../src/core/env", async (orig) => ({ ...(await orig<typeof import("../src/core/env")>()), isBrowser: true }));
    vi.doMock("../src/core/hooks", async (orig) => ({ ...(await orig<typeof import("../src/core/hooks")>()), useHydrated: () => hydrated }));
    const { WaffleChart } = await import("../src/charts/waffle");
    const { CalendarHeatmap } = await import("../src/charts/calendar");
    const days = Array.from({ length: 40 }, (_, i) => ({ date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`, value: i }));
    return [
      renderToString(<WaffleChart data={[{ label: "A", value: 40 }, { label: "B", value: 60 }]} label="label" value="value" width={400} />),
      renderToString(<CalendarHeatmap data={days} date="date" value="value" width={600} />),
    ];
  }

  it("하이드레이트 전 첫 렌더는 서버처럼 등장 스타일이 없어요", async () => {
    for (const html of await renderInBrowser(false)) {
      expect(html).not.toMatch(/style="(opacity:0|animation:ztd-)/);
    }
  });

  it("하이드레이트 뒤에는 등장 스타일이 그대로 붙어요", async () => {
    const [waffle, calendar] = await renderInBrowser(true);
    expect(waffle).toMatch(/style="(opacity:0|animation:ztd-pop)/);
    expect(calendar).toMatch(/style="(opacity:0|animation:ztd-fade)/);
  });
});

describe("축 눈금 글자 (axis)", () => {
  const fmt = makeFormatter({ maximumFractionDigits: 0 }, "de-DE");
  it("겹쳐서 전체 숫자로 바꿀 때 받은 로캘을 써요", () => {
    expect(tickLabels([0, 0.1, 0.2, 0.3], fmt, "de-DE")).toEqual(["0", "0,1", "0,2", "0,3"]);
    expect(yAxisWidth([0, 1000.5, 2000.5], makeFormatter({ maximumFractionDigits: 0, notation: "compact" }, "de-DE"), "de-DE")).toBeGreaterThan(18);
    const svg = renderToStaticMarkup(
      <svg>
        <GridY p={darkPainter} ticks={[0, 0.1, 0.2]} y={(v) => v * 100} x0={40} x1={200} fmt={fmt} locale="de-DE" />
      </svg>,
    );
    expect(svg).toContain(">0,1<");
  });
  it("로캘을 안 주면 예전처럼 en-US", () => {
    expect(tickLabels([0, 0.1], fmt)).toEqual(["0", "0.1"]);
  });
});

describe("숫자 x 라벨 (series)", () => {
  it("작은 소수가 같은 글자로 뭉개지지 않아요", () => {
    const m = prepSeries([{ x: 0.001, y: 1 }, { x: 0.002, y: 2 }, { x: 0.25, y: 3 }], "x", "y", undefined);
    expect(m.labels).toEqual(["0.001", "0.002", "0.25"]);
  });
  it("네 자리 정수만 있으면 연도라 자릿점이 없어요", () => {
    expect(prepSeries([{ x: 2019, y: 1 }, { x: 2020, y: 2 }], "x", "y", undefined).labels).toEqual(["2019", "2020"]);
    expect(prepSeries([{ x: 2019, y: 1 }, { x: 12000, y: 2 }], "x", "y", undefined).labels).toEqual(["2,019", "12,000"]);
  });
});

describe("truncate (text)", () => {
  it("서로게이트 쌍 가운데서 자르지 않아요", () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (const s of ["Ab😀😀😀😀😀", "😀😀😀😀😀😀abc", "abc😀😀😀😀"]) {
      for (let w = 10; w <= 80; w += 1) expect(lone.test(truncate(s, w, 11)), `${s} @${w}`).toBe(false);
    }
  });
});

describe("fitDomain (scale)", () => {
  it("범위를 정한 간격과 눈금 간격이 같아요: fitDomain(0, 5.5)", () => {
    const d = fitDomain(0, 5.5);
    expect(d).toEqual([0, 6]);
    expect(scaleLinear(d, [0, 1]).ticks(4)).toEqual([0, 2, 4, 6]);
  });
  it("위 끝은 눈금이거나, 눈금 간격의 30%보다 먼 값 + 여유예요 (0~1000 훑기)", () => {
    for (let hi = 1; hi <= 1000; hi += 0.5) {
      const [a, b] = fitDomain(0, hi, 4);
      const s = niceStep(b - a, 4);
      const nHi = Math.ceil(hi / s - 1e-9) * s;
      expect(b === nHi || nHi - hi > s * 0.3, `hi=${hi} → [${a}, ${b}], step ${s}`).toBe(true);
    }
  });
});

describe("timeTicks (scale)", () => {
  it("해가 바뀌는 월 눈금은 연도를 네 자리로 써요", () => {
    const labels = timeTicks(new Date(2023, 9, 1).getTime(), new Date(2024, 5, 1).getTime(), 6).map((t) => t.label);
    expect(labels).toContain("Jan 2024");
    expect(labels.some((l) => /\b\d{2}$/.test(l) && !/\d{4}$/.test(l))).toBe(false);
  });
});

describe("MotionEngine", () => {
  it("items()는 처음 들어온 순서를 지켜요", () => {
    const e = new MotionEngine<null>();
    e.snap(["b", "a", "c"].map((key) => ({ key, to: [1], data: null })));
    e.update(["c", "a", "b", "d"].map((key) => ({ key, to: [2], data: null })), 0);
    expect(e.items().map((i) => i.key)).toEqual(["b", "a", "c", "d"]);
  });
  it("spring은 먼 거리도 마지막에 눈에 띄게 건너뛰지 않아요", () => {
    const e = new MotionEngine<null>();
    e.configure("spring", 900);
    e.snap([{ key: "a", to: [0], data: null }]);
    e.update([{ key: "a", to: [500], data: null }], 0);
    let prev = 0;
    let t = 0;
    for (; t <= 5000 && e.animating; t += 1000 / 60) {
      prev = e.get("a")![0];
      e.step(t);
    }
    expect(e.animating).toBe(false);
    expect(e.get("a")![0]).toBe(500);
    expect(500 - prev).toBeLessThan(0.2);
    expect(t).toBeLessThan(900 * 2);
  });
});

describe("Legend", () => {
  it("이름이 같은 항목도 key가 겹치지 않아요", () => {
    let el: ReactElement<{ children: ReactElement[] }> | null = null;
    function Probe() {
      el = Legend({ items: [{ label: "A" }, { label: "A" }, { label: "B" }] }) as ReactElement<{ children: ReactElement[] }>;
      return el;
    }
    renderToStaticMarkup(<Probe />);
    const keys = (el as unknown as ReactElement<{ children: ReactElement[] }>).props.children.map((li) => li.key);
    expect(new Set(keys).size).toBe(3);
  });
});
