import type { KeyboardEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { autoLegend } from "../src/charts/Chart";
import { WaffleChart } from "../src/charts/waffle";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { allocateCells, ARC_MAX_DOTS, arcSeats } from "../src/layout/seats";
import { renderSpecToSVG } from "../src/server";
import { validateSpec, type ChartSpec } from "../src/spec";
import { seatSample, seatSampleKo } from "../src/spec/samples";

/** tileMap.test.tsx와 같은 틀: active를 주면 고른 묶음을, spy를 켜면 setActive 호출을 기록해요. frame은 마지막 ChartFrame props예요 */
const state = vi.hoisted(() => ({
  active: null as number | null,
  via: "pointer" as "pointer" | "keyboard",
  spy: false,
  calls: [] as [number | null, string | undefined][],
  frame: null as unknown,
}));

vi.mock("../src/core/useChart", async (orig) => {
  const actual = await orig<typeof import("../src/core/useChart")>();
  return {
    ...actual,
    useChart: (props: never, d: never) => {
      const c = actual.useChart(props, d);
      const out = state.spy ? { ...c, setActive: (i: number | null, via?: string) => void state.calls.push([i, via]) } : c;
      return state.active === null ? out : { ...out, active: state.active, via: state.via };
    },
  };
});
vi.mock("../src/core/ChartFrame", async (orig) => {
  const actual = await orig<typeof import("../src/core/ChartFrame")>();
  return {
    ...actual,
    ChartFrame: (p: ChartFrameProps<unknown>) => {
      state.frame = p;
      return actual.ChartFrame(p);
    },
  };
});
const { ChartFrame: RealFrame } = await vi.importActual<typeof import("../src/core/ChartFrame")>("../src/core/ChartFrame");

afterEach(() => {
  state.active = null;
  state.via = "pointer";
  state.spy = false;
  state.calls = [];
  state.frame = null;
});

const frame = () => state.frame as ChartFrameProps<unknown>;
const assembly = [
  { party: "Party A", seats: 128 },
  { party: "Party B", seats: 109 },
  { party: "Party C", seats: 34 },
  { party: "Party D", seats: 17 },
  { party: "Independent", seats: 12 },
];
const MAJORITY = [{ value: 151, label: "Majority 151" }];
const arc = (data: Record<string, unknown>[], extra: Record<string, unknown> = {}) => renderToStaticMarkup(<WaffleChart data={data} label="party" value="seats" shape="arc" width={640} animate={false} {...extra} />);
const circles = (h: string) => [...h.matchAll(/<circle [^>]*>/g)].map((m) => m[0]);
/** 묶음마다 점 수 (빈자리는 -1) */
const perGroup = (h: string, tag = "circle") => {
  const out: Record<string, number> = {};
  for (const m of h.matchAll(new RegExp(`<${tag} [^>]*data-k="(-?\\d+)"`, "g"))) out[m[1]] = (out[m[1]] ?? 0) + 1;
  return out;
};
const refLines = (h: string) => [...h.matchAll(/<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"[^>]*stroke-dasharray/g)].map((m) => m.slice(1).map(Number));
const texts = (h: string) => [...h.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

describe("arc layout (arcSeats)", () => {
  it("returns n seats from left to right, on the fewest rows that hold them", () => {
    for (const n of [0, 1, 2, 5, 6, 7, 300, 3000]) {
      const { seats } = arcSeats(n);
      expect(seats, `n=${n}`).toHaveLength(n);
      expect(seats.every((s, i) => i === 0 || s.a >= seats[i - 1].a), `n=${n}`).toBe(true);
    }
    expect(arcSeats(1).seats).toEqual([{ r: 1, a: 0 }]);
    expect(arcSeats(2).seats.map((s) => s.a)).toEqual([-Math.PI / 2, Math.PI / 2]);
    expect(arcSeats(5).rows).toBe(1);
    expect(arcSeats(300).rows).toBe(10);
    // 점 3000개도 줄 수가 많아지지 않아요 (줄 수는 점 수의 제곱근을 따라 늘어요)
    expect(arcSeats(ARC_MAX_DOTS).rows).toBeLessThan(40);
    // 줄 간격이 같아요
    const radii = [...new Set(arcSeats(300).seats.map((s) => s.r))].sort((a, b) => a - b);
    const steps = radii.slice(1).map((r, i) => r - radii[i]);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(1e-9);
  });
});

describe("waffle shape arc", () => {
  it("draws one dot per unit and fills each group as a wedge from the left", () => {
    const h = arc(assembly, { referenceLines: MAJORITY });
    expect(circles(h)).toHaveLength(300);
    expect(perGroup(h)).toEqual({ 0: 128, 1: 109, 2: 34, 3: 17, 4: 12 });
    // 그린 순서(왼쪽부터 각도 순서)로 묶음 번호가 줄지 않아요
    const order = [...h.matchAll(/<circle [^>]*data-k="(-?\d+)"/g)].map((m) => Number(m[1]));
    expect(order.every((k, i) => i === 0 || k >= order[i - 1])).toBe(true);
    // 격자는 그대로예요
    expect(renderToStaticMarkup(<WaffleChart data={assembly} label="party" value="seats" width={640} animate={false} />)).not.toContain("<circle");
  });

  it("hands out the same unit counts as the grid for the same data", () => {
    const data = [{ party: "A", seats: 38.4 }, { party: "B", seats: 41.3 }, { party: "C", seats: 20.3 }];
    for (const total of [undefined, 100, 137]) {
      const cells = total === undefined ? 100 : total;
      const grid = renderToStaticMarkup(<WaffleChart data={data} label="party" value="seats" cells={cells} total={total} width={640} animate={false} />);
      const g = perGroup(grid, "rect");
      delete g["-1"];
      const a = perGroup(arc(data, { total: total ?? 100 }));
      delete a["-1"];
      expect(a, `total ${total}`).toEqual(g);
      expect(Object.values(a)).toEqual(allocateCells([38.4, 41.3, 20.3], cells, total ?? 100));
    }
  });

  it("draws the rest of the total as empty seats, and falls back to the sum for a total that is too small or not usable", () => {
    const empty = (h: string) => circles(h).filter((c) => c.includes('fill="none"')).length;
    const h = arc(assembly, { total: 400 });
    expect(circles(h)).toHaveLength(400);
    expect(empty(h)).toBe(100);
    for (const total of [200, 0, -5, Number.NaN, Infinity, "300" as never]) {
      const t = arc(assembly, { total });
      expect(circles(t), String(total)).toHaveLength(300);
      expect(empty(t), String(total)).toBe(0);
    }
  });

  it("caps huge totals at the dot limit and says what one dot stands for", () => {
    for (const [data, total] of [[[{ party: "A", seats: 2100 }, { party: "B", seats: 2900 }], undefined], [[{ party: "A", seats: 52000 }, { party: "B", seats: 48000 }], 100000]] as const) {
      const h = arc(data as never, { total, width: 280, referenceLines: [{ value: 50001 }] });
      expect(circles(h)).toHaveLength(ARC_MAX_DOTS);
      expect(h).not.toMatch(/NaN|Infinity/);
      expect(frame().description).toMatch(/Each dot is about [\d.]+ units\./);
      expect(Number(/<circle [^>]* r="([\d.]+)"/.exec(h)?.[1])).toBeGreaterThanOrEqual(1);
    }
  });

  it("draws a radial line per usable reference line and skips the rest", () => {
    const at = (refs: unknown[]) => refLines(arc(assembly, { referenceLines: refs }));
    expect(at(MAJORITY)).toHaveLength(1);
    expect(at([{ y: 151 }, { value: "151" }, { value: -1 }, { value: 301 }, { value: Number.NaN }, null])).toHaveLength(0);
    // 과반선(151)은 가운데에서 위로 뻗어요 (점 300개는 150석째 다음이 가운데 줄이에요). 100석 선은 왼쪽이에요
    const [[x0, y0, x1, y1]] = at(MAJORITY);
    expect(x1).toBeGreaterThanOrEqual(320);
    expect(x1 - 320).toBeLessThan(8);
    expect(at([{ value: 100 }])[0][2]).toBeLessThan(250);
    expect(y1).toBeLessThan(y0);
    // 0과 전체에 놓인 선은 맨 아랫줄 밑에 가로로 그어요
    const [left, right] = at([{ value: 0 }, { value: 300 }]);
    expect(left[1]).toBe(left[3]);
    expect(right[1]).toBe(right[3]);
    expect(left[2]).toBeLessThan(320);
    expect(right[2]).toBeGreaterThan(320);
    expect(x0).toBeGreaterThan(0);
    expect(texts(arc(assembly, { referenceLines: MAJORITY }))).toContain("Majority 151");
  });

  it("reads count, share and the distance to the first reference line", () => {
    state.active = 0;
    state.via = "keyboard";
    arc(assembly, { referenceLines: MAJORITY });
    expect(frame().announce).toBe("Party A, 128 of 300, 43%, 23 short of Majority 151");
    expect(frame().events[1].formatted).toBe("109 of 300 · 36%");
    expect(frame().tip!.rows.map((row) => `${row.label}=${row.value}`)).toEqual(["Value=128", "Share=43%", "23 short of Majority 151="]);
    expect(frame().description).toBe("Seat chart. 300 in all: Party A 128, Party B 109, Party C 34, Party D 17, Independent 12. Reference lines: Majority 151.");
    arc([{ party: "Party A", seats: 160 }, { party: "Party B", seats: 140 }], { referenceLines: MAJORITY });
    expect(frame().announce).toBe("Party A, 160 of 300, 53%, 9 past Majority 151");
    arc([{ party: "Party A", seats: 151 }, { party: "Party B", seats: 149 }], { referenceLines: MAJORITY, total: 320 });
    expect(frame().announce).toBe("Party A, 151 of 320, 47%, exactly at Majority 151");
    expect(frame().description).toContain("Party B 149, 20 empty.");
    arc(seatSampleKo, { label: "ticket", value: "seats", total: 400, locale: "ko-KR", referenceLines: [{ value: 260, label: "손익분기" }] });
    expect(frame().announce).toBe("얼리버드, 400 중 118, 30%, 손익분기까지 142 모자라요");
    // 기준선이 없으면 거리는 말하지 않아요
    arc(assembly);
    expect(frame().announce).toBe("Party A, 128 of 300, 43%");
  });

  it("moves between groups with the arrow keys in left to right order", () => {
    state.spy = true;
    arc(assembly);
    let root: ReactElement<{ onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void }> | null = null;
    function Probe() {
      root = RealFrame(frame());
      return root;
    }
    renderToStaticMarkup(<Probe />);
    const self = {};
    const press = (key: string) => root!.props.onKeyDown({ key, target: self, currentTarget: self, preventDefault() {} } as never);
    press("ArrowRight");
    press("ArrowLeft");
    press("End");
    expect(state.calls).toEqual([[0, "keyboard"], [4, "keyboard"], [4, "keyboard"]]);
  });

  it("shows the total in the middle with the highlighted group, or the chosen one", () => {
    const h = arc(assembly);
    expect(texts(h)).toEqual(expect.arrayContaining(["300", "Party A 128"]));
    expect(texts(arc(assembly, { highlight: "Party C" }))).toContain("Party C 34");
    expect(texts(arc(assembly, { highlight: "none" }))).toEqual(["300"]);
    expect(texts(arc(assembly, { summary: false }))).toEqual([]);
    expect(texts(arc(assembly, { summaryLabel: "Largest", summaryNote: "Five groups" }))).toEqual(["300", "Largest 128", "Five groups"]);
    state.active = 1;
    expect(texts(arc(assembly))).toContain("Party B 109");
    // 키보드로 고른 묶음은 그 묶음 <g>에 테두리를 걸어 점마다 그려요 (초점 고리). 나머지 묶음은 흐려요
    state.via = "keyboard";
    const focused = arc(assembly);
    const ringed = /<g stroke="[^"]+" stroke-width="[\d.]+">((?:<circle [^>]*><\/circle>)+)<\/g>/.exec(focused);
    expect(circles(ringed?.[1] ?? "")).toHaveLength(109);
    expect([...focused.matchAll(/<g opacity="0.38">/g)]).toHaveLength(4);
  });

  it("fits a long centre name by a smaller size, then two lines, and shortens it only when neither fits", () => {
    const customers = [{ party: "New", seats: 38 }, { party: "Returning", seats: 62 }];
    const at = (width: number) => texts(arc(customers, { width, summaryLabel: "New customers", summaryNote: "62 returning" }));
    // 문서 변형 카드 폭(480)에서는 한 줄 그대로, 390에서는 이름을 두 줄로 나누고 아래 글은 반원 바닥 밑으로 (예전에는 "New cust… 38")
    expect(at(480)).toEqual(["100", "New customers 38", "62 returning"]);
    expect(at(342)).toEqual(["100", "New", "customers 38", "62 returning"]);
    // 두 줄을 놓으면 전체 숫자가 12px보다 작아지는 폭(390 화면의 카드)에서는 범례의 묶음 이름으로 바꿔요
    expect(at(300)[1]).toBe("New 38");
    // 묶음 이름도 길면 그때 줄여요
    const long = [{ party: "Newly registered members", seats: 38 }, { party: "Returning", seats: 62 }];
    expect(texts(arc(long, { width: 300, summaryLabel: "New customers this quarter" }))[1]).toMatch(/^New.*… 38$/);
  });

  it("does not repeat the focused group in the note under it", () => {
    const customers = [{ party: "New", seats: 38 }, { party: "Returning", seats: 62 }];
    const draw = () => texts(arc(customers, { width: 480, summaryLabel: "New customers", summaryNote: "62 returning" }));
    state.active = 1;
    state.via = "keyboard";
    // "Returning 62" 아래 "62 returning"을 또 적지 않아요
    expect(draw()).toEqual(["100", "Returning 62"]);
    // 다른 묶음을 고르면 아래 글은 그대로예요 (다른 말이라서)
    state.active = 0;
    expect(draw()).toEqual(["100", "New 38", "62 returning"]);
    // 값이 겹치기만 하는 글은 같은 말이 아니에요 ("620 returning"은 62가 아니에요)
    state.active = 1;
    expect(texts(arc(customers, { width: 480, summaryNote: "620 returning" }))).toEqual(["100", "Returning 62", "620 returning"]);
    // 한국어 글에 붙은 단위(명)는 같은 말로 봐요
    const ko = [{ party: "신규", seats: 38 }, { party: "재구매", seats: 62 }];
    expect(texts(arc(ko, { width: 480, summaryNote: "재구매 62명" }))).toEqual(["100", "재구매 62"]);
  });

  it("never prints NaN or Infinity for edge inputs at 280 and 390 px", () => {
    const big = Array.from({ length: 20 }, (_, i) => ({ party: `Group ${i + 1}`, seats: 40 - i }));
    const cases: [Record<string, unknown>[], Record<string, unknown>][] = [
      [[], {}],
      [[{ party: "Chair", seats: 1 }], {}],
      [[{ party: "A", seats: 1 }, { party: "B", seats: 1 }], {}],
      [[{ party: "A", seats: 3 }, { party: "B", seats: 2 }], { referenceLines: [{ value: 3 }] }],
      [[{ party: "All", seats: 300 }, { party: "None", seats: 0 }], { referenceLines: [{ value: 0 }, { value: 300 }, { value: 900 }] }],
      [[{ party: "A", seats: 0 }, { party: "B", seats: 0 }], {}],
      [[{ party: "A", seats: 0 }], { total: 10 }],
      [[{ party: "A", seats: 0.3 }], {}],
      [[{ party: "A", seats: -40 }, { party: "B", seats: 12.6 }, { party: "C", seats: null }, { party: "D", seats: "n/a" }, { party: "E", seats: Infinity }], {}],
      [big, { referenceLines: [{ value: 300, label: "x".repeat(80) }, { value: 302, label: "close" }] }],
      [[{ party: "<script>alert(1)</script>", seats: 5 }, { party: "🚀 שלום 日本語 ".repeat(6), seats: 7 }], { total: 30, summaryNote: "Ελληνικά ".repeat(10) }],
    ];
    for (const [data, extra] of cases)
      for (const width of [280, 390]) {
        const h = arc(data, { width, ...extra });
        expect(h, JSON.stringify(data).slice(0, 60)).not.toMatch(/NaN|Infinity|undefined/);
        expect(h).not.toContain("<script>");
        const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(h)!;
        for (const m of h.matchAll(/<circle [^>]*cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/g)) {
          const [x, y, r] = m.slice(1).map(Number);
          expect(x - r, `${width} left`).toBeGreaterThanOrEqual(0);
          expect(x + r, `${width} right`).toBeLessThanOrEqual(Number(vb[1]));
          expect(y - r).toBeGreaterThanOrEqual(0);
          expect(y + r).toBeLessThanOrEqual(Number(vb[2]));
        }
      }
  });

  it("legend swatches are circles in the arc and stay squares in the grid", () => {
    const spec: ChartSpec = { type: "waffle", data: seatSample, encoding: { label: "ticket", value: "seats" }, options: { shape: "arc" } };
    expect(autoLegend(spec, seatSample, "en-US").map((x) => x.shape)).toEqual(["circle", "circle", "circle", "circle"]);
    expect(autoLegend({ ...spec, options: {} }, seatSample, "en-US").map((x) => x.shape)).toEqual([undefined, undefined, undefined, undefined]);
    expect(renderSpecToSVG({ ...spec, card: { title: "t", legend: "auto" } }, { width: 390, theme: "dark" })).toMatch(/rx="4.5"/);
  });
});

describe("validateSpec for shape arc", () => {
  const base = { type: "waffle", data: assembly, encoding: { label: "party", value: "seats" } };
  const codes = (options: Record<string, unknown>, data: unknown[] = assembly) => {
    const r = validateSpec({ ...base, data, options });
    return [...r.errors.map((i) => `E:${i.code}@${i.path}`), ...r.warnings.map((i) => `W:${i.code}@${i.path}`)];
  };
  it("checks the reference line key, the total, the dot cap and options the arc does not use", () => {
    expect(codes({ shape: "arc", total: 300, referenceLines: MAJORITY })).toEqual([]);
    expect(codes({ shape: "arc", referenceLines: [{ y: 151 }] })).toEqual(["E:bad_reference_line@options.referenceLines[0]"]);
    expect(codes({ shape: "arc", referenceLines: [{ value: 0 }, { value: 300 }, { value: 301 }, { value: -1 }] })).toEqual(["W:reference_out_of_range@options.referenceLines[2]", "W:reference_out_of_range@options.referenceLines[3]"]);
    expect(codes({ shape: "arc", total: 200 })).toEqual(["W:total_below_sum@options.total"]);
    expect(codes({ shape: "arc", total: 0 })).toEqual(["W:bad_total@options.total"]);
    expect(codes({ shape: "arc", total: -3 })).toEqual(["W:bad_total@options.total"]);
    expect(codes({ shape: "arc", total: "300" })).toEqual(["E:bad_option_type@options.total"]);
    expect(codes({ shape: "arc", total: 100000 })).toEqual(["W:too_many_units@options.total"]);
    expect(codes({ shape: "arc" }, [{ party: "A", seats: 4000 }])).toEqual(["W:too_many_units@data"]);
    expect(codes({ shape: "arc" }, [{ party: "A", seats: -4 }, { party: "B", seats: 3 }])).toEqual(["W:negative_value@encoding.value"]);
    expect(codes({ shape: "arc", cells: 50, columns: 5 })).toEqual(["W:ignored_option@options.cells", "W:ignored_option@options.columns"]);
    expect(codes({ referenceLines: MAJORITY })).toEqual(["W:ignored_option@options.referenceLines"]);
    expect(codes({ shape: "ring" })).toEqual(["E:bad_enum@options.shape"]);
    // 격자는 예전 그대로예요
    expect(codes({ cells: 50, columns: 5, total: 200 })).toEqual([]);
  });
});
