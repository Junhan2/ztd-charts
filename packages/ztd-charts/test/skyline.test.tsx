import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEPTH_RANGE, rowAfterKey, SkylineChart, skylineLayout, type SkylineChartProps } from "../src/charts/skyline";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { skylineSample } from "../src/spec/samples";
import { validateSpec } from "../src/spec/validate";

/**
 * 기획서(next-charts SPEC 4.14) 완료 기준 중 브라우저 없이 확인하는 것들이에요.
 * 하네스는 cartesian-fixes.test.tsx와 같아요: state.active로 고른 기간을, spy로 setActive 호출을, frame()으로 마지막 ChartFrame props를 봐요
 */
const state = vi.hoisted(() => ({
  active: null as number | null,
  via: "pointer" as "pointer" | "keyboard" | "touch",
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

afterEach(() => {
  state.active = null;
  state.via = "pointer";
  state.spy = false;
  state.calls = [];
  state.frame = null;
});

const frame = () => state.frame as ChartFrameProps<unknown>;
const keyEvent = (key: string) => ({ key, preventDefault() {} }) as never;
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
const COS = 2 / Math.sqrt(5);
const BACK = ["Input", "Cached", "Output", "Reasoning"];
const FRONT = ["Failed", "Retried"];

type Data = Record<string, string | number>[];
const sky = (data: Data, props: Partial<SkylineChartProps<Record<string, string | number>>> = {}) =>
  renderToStaticMarkup(<SkylineChart data={data} x="day" y={BACK} front={FRONT} format="compact" width={760} height={420} animate={false} {...props} />);
const r = (el: ReactElement) => renderToStaticMarkup(el);
const days = (n: number, row: (i: number) => Record<string, number>): Data => Array.from({ length: n }, (_, i) => ({ day: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), ...row(i) }));

/** 기간(class="ztd-mark" 묶음)마다 마크업 조각 */
const periods = (h: string) => h.split('<g class="ztd-mark"').slice(1);
const xy = (points: string) => points.split(" ").map((p) => p.split(",").map(Number) as [number, number]);
/** 뒷줄 뚜껑: neutralStrong 55% 테두리가 있는 면. 점 순서는 앞 왼쪽, 앞 오른쪽, 뒤 오른쪽, 뒤 왼쪽 */
const backLid = (g: string) => {
  const m = /<polygon points="([^"]+)" fill="([^"]+)" stroke="[^"]+" stroke-opacity="0.55" stroke-linejoin="round"><\/polygon>/.exec(g);
  return m ? { pts: xy(m[1]), fill: m[2] } : null;
};
/** 앞줄 뚜껑: 테두리 없이 바닥색(neutralSoft)으로 녹인 면 */
const frontLid = (g: string) => {
  const m = /<polygon points="([^"]+)" fill="([^"]+)" stroke-linejoin="round"><\/polygon>/.exec(g);
  return m ? { pts: xy(m[1]), fill: m[2] } : null;
};
/** 블록 대신 긋는 가는 선 (y1 = y2, 세로 틈 선과 달리 불투명도가 없어요) */
const hairline = (g: string) => /<line x1="[\d.]+" x2="[\d.]+" y1="([\d.]+)" y2="\1" stroke="[^"]+"><\/line>/.test(g);

describe("skyline: 생김새 (4.14)", () => {
  it("1: 합계가 같은 기간은 뚜껑 앞 모서리 y가 같아요 (1px 미만 조각이 섞여도, 320·1200px × 7·40기간 × 깊이 0.1·0.32)", () => {
    // 모든 기간의 합계가 1000이고 구성만 달라요. 짝수 기간은 0.3짜리(1px 미만) 조각을 끼워 쌓아요
    const data = (n: number) => days(n, (i) => (i % 2 ? { Input: 400, Cached: 300, Output: 200, Reasoning: 100 } : { Input: 999.4, Cached: 0.3, Output: 0.3, Reasoning: 0 }));
    for (const width of [320, 1200])
      for (const n of [7, 40])
        for (const depth of DEPTH_RANGE) {
          const groups = periods(sky(data(n).map((d) => ({ ...d, Failed: 10, Retried: 5 })), { width, depth }));
          // 합친 경우 덜 찬 첫 묶음은 합계가 달라서 빼요
          const full = n % Math.ceil(n / groups.length) === 0 || groups.length === n ? groups : groups.slice(1);
          const tops = full.map((g) => backLid(g)!.pts[0][1]);
          expect(Math.max(...tops) - Math.min(...tops), `${width}px ${n} periods depth ${depth}`).toBeLessThanOrEqual(0.5);
        }
  });

  it("2: 뒷줄 뚜껑 뒤 모서리는 그 값의 뒷벽 눈금선 위에 있어요 (390·1200px, 14기간)", () => {
    // 합계가 50만, 100만, 150만인 기간: 눈금 0, 50만, 100만, 150만과 맞아떨어져요
    const totals = [500_000, 1_000_000, 1_500_000];
    const data = days(14, (i) => {
      const t = totals[i % 3];
      return { Input: t * 0.4, Cached: t * 0.3, Output: t * 0.2, Reasoning: t * 0.1, Failed: t * 0.01, Retried: t * 0.01 };
    });
    for (const width of [390, 1200]) {
      const h = sky(data, { width });
      const grid = new Map([...h.matchAll(/<line x1="[\d.]+" x2="[\d.]+" y1="([\d.]+)" y2="\1" stroke="[^"]+"><\/line><text x="[\d.]+" y="[\d.]+"[^>]*>([^<]+)<\/text>/g)].map((m) => [m[2], +m[1]]));
      expect([...grid.keys()], `${width}px`).toEqual(["0", "500K", "1M", "1.5M"]);
      periods(h).forEach((g, i) => {
        const rear = backLid(g)!.pts[2][1];
        const label = ["500K", "1M", "1.5M"][i % 3];
        expect(Math.abs(rear - grid.get(label)!), `${width}px period ${i}`).toBeLessThanOrEqual(0.5);
      });
    }
  });

  it("3: 뒷줄 옆면은 다음 칸에 들어가지 않고, 앞줄 앞면은 같은 기간 뒷줄과 50% 넘게, 이웃 기간과 0% 겹치며, 두 줄 바닥 차가 1.5px 넘어요", () => {
    for (const width of [320, 390, 768, 1200])
      for (const n of [7, 14, 40])
        for (const depth of DEPTH_RANGE) {
          const L = skylineLayout({ width, height: 400, back: [Array(n).fill(10)], front: [Array(n).fill(1)], n, depth, wall: true, legendH: 24, below: 52, tickFmt: () => (v) => String(v) });
          const at = `${width}px ${n} periods depth ${depth}`;
          expect(L.s, at).toBeGreaterThanOrEqual(20);
          expect(L.shown, at).toBeLessThanOrEqual(40);
          for (let i = 0; i < L.shown; i++) {
            const front: [number, number] = [L.slotX(i), L.slotX(i) + L.w];
            const back = (k: number): [number, number] => [L.slotX(k) + L.shift[0], L.slotX(k) + L.shift[0] + L.w];
            const overlap = (a: [number, number], b: [number, number]) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0])) / L.w;
            if (i < L.shown - 1) expect(back(i)[1] + L.depthBack * COS, at).toBeLessThan(L.slotX(i + 1));
            expect(overlap(front, back(i)), at).toBeGreaterThanOrEqual(0.5);
            if (i > 0) expect(overlap(front, back(i - 1)), at).toBe(0);
          }
          expect(L.shift[1], at).toBeGreaterThanOrEqual(1.5);
        }
  });

  it("4: 앞줄 높이 순서가 앞줄 합계 순서와 같아요 (760px, 1.5px 미만 조각이 섞인 예시 데이터)", () => {
    const h = sky(skylineSample, { width: 760 });
    const groups = periods(h);
    expect(groups).toHaveLength(14);
    // 1.5px 안 되는 앞줄 조각이 실제로 그려졌는지 (부풀리면 순서가 뒤집혀요)
    const thin = groups.flatMap((g) => [...g.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="([\d.]+)" fill="var\(--ztd-neutral/g)].map((m) => +m[1])).filter((v) => v > 0 && v < 1.5);
    expect(thin.length).toBeGreaterThan(0);
    const heights = groups.map((g) => -frontLid(g)!.pts[0][1]);
    const totals = skylineSample.map((d) => d.Failed + d.Retried);
    const order = (xs: number[]) => xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
    expect(order(heights)).toEqual(order(totals));
  });

  it("5: 0이 아닌 합계가 1px이 안 되면 가는 선, 0이면 아무것도 없어요 (390px, 14기간)", () => {
    const data = days(14, (i) => ({ Input: 600, Cached: 300, Output: 80, Reasoning: 20, Failed: i === 3 ? 0.001 : i === 5 ? 0 : 40, Retried: 0 }));
    const groups = periods(sky(data, { width: 390 }));
    expect(hairline(groups[3])).toBe(true);
    expect(frontLid(groups[3])).toBeNull();
    expect(hairline(groups[5])).toBe(false);
    expect(frontLid(groups[5])).toBeNull();
    // 뒷줄 뚜껑 하나와 앞줄 뚜껑 하나뿐인 평범한 기간
    expect(hairline(groups[4])).toBe(false);
    expect(frontLid(groups[4])).not.toBeNull();
  });

  it("6: 뚜껑은 모든 기간에서 같은 중립 색이고 계열 색을 쓰지 않아요 (앞줄 있음, 없음)", () => {
    for (const front of [FRONT, undefined]) {
      const h = sky(skylineSample, { width: 390, front });
      const groups = periods(h);
      const fills = new Set(groups.map((g) => backLid(g)!.fill));
      expect(fills.size).toBe(1);
      const [lid] = fills;
      expect(lid).toContain("--ztd-panel");
      expect(lid).toContain("--ztd-neutral-soft");
      for (const token of ["accent", "neutral-strong", "ink"]) expect(lid).not.toContain(`--ztd-${token}`);
      if (front) expect(new Set(groups.map((g) => frontLid(g)?.fill)).size).toBe(1);
    }
  });
});

describe("skyline: 읽기와 키보드 (4.14)", () => {
  it("7: 툴팁 행, 라이브 영역 문장, 숨긴 표가 계열을 같은 순서(위→아래)로 읽어요", () => {
    state.active = 8;
    state.via = "keyboard";
    sky(skylineSample, { width: 390 });
    const f = frame();
    const rows = f.tip!.rows.map((row) => row.label ?? "");
    // 뒷줄 위→아래, 뒷줄 합계, 앞줄 위→아래, 앞줄 합계, 비율
    expect(rows).toEqual(["Reasoning", "Output", "Cached", "Input", "Back total", "Retried", "Failed", "Front total", "Front ÷ back"]);
    /** 글 안에서 이름들이 이 순서로 나오는지 */
    const inOrder = (text: string, names: string[]) => names.map((n) => text.indexOf(`${n} `)).every((at, i, all) => at >= 0 && (i === 0 || at > all[i - 1]));
    const tipBack = rows.slice(0, 4);
    const tipFront = rows.slice(5, 7);
    expect(f.announce).toMatch(/^10\/31 back: Reasoning /);
    expect(inOrder(f.announce!, tipBack)).toBe(true);
    // 숨긴 표 글은 뒷줄 다음 앞줄, 두 줄 모두 툴팁과 같은 순서예요
    expect(inOrder(f.events[8].formatted!, ["back", ...tipBack, "front", ...tipFront])).toBe(true);
  });

  it("8: 자동 설명에 두 줄의 최고 기간과 비율이, 합쳤으면 합친 단위가 들어가요 (320px, 14·40기간, 앞줄 있음·없음)", () => {
    const desc = () => frame().description;
    sky(skylineSample, { width: 760 });
    expect(desc()).toContain("Peak period 11/5 at 1.5M");
    expect(desc()).toContain("Front row (Failed, Retried) peaks at 10/31 with 216K, 16.4% of the back row");
    expect(desc()).not.toContain("summed");
    sky(skylineSample, { width: 320 });
    expect(desc()).toContain("Peak period 11/4–11/5");
    expect(desc()).toContain("Front row (Failed, Retried) peaks at 10/31–11/1");
    expect(desc()).toContain("Neighboring periods are summed in groups of 2");
    sky(skylineSample, { width: 320, front: undefined });
    expect(desc()).not.toContain("Front row");
    const forty = days(40, (i) => ({ Input: 100 + i, Cached: 50, Output: 30, Reasoning: 10, Failed: i === 20 ? 40 : 2, Retried: 1 }));
    sky(forty, { width: 320 });
    expect(desc()).toMatch(/summed in groups of \d/);
    sky(skylineSample, { width: 320, locale: "ko-KR" });
    expect(desc()).toContain("앞줄(Failed, Retried)이 가장 많은 기간");
    expect(desc()).toContain("이웃 기간을 2개씩 합쳤어요");
  });

  it("9: ←/→/Home/End는 줄을 두고 기간만, ↑/↓는 같은 기간의 다른 줄로, 앞줄이 없으면 ↑/↓도 기간을 옮겨요. 40기간도 숨긴 표가 잘리지 않아요", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End", "Escape", "Enter"]) expect(rowAfterKey(key, true), key).toBeNull();
    expect(rowAfterKey("ArrowDown", true)).toBe("front");
    expect(rowAfterKey("ArrowUp", true)).toBe("back");
    expect(rowAfterKey("ArrowDown", false)).toBeNull();
    // 앞줄이 있으면 ↑/↓를 차트가 받고 기간은 그대로예요
    state.active = 4;
    state.via = "keyboard";
    state.spy = true;
    sky(skylineSample, { width: 390 });
    expect(frame().onKey!(keyEvent("ArrowDown"))).toBe(true);
    expect(frame().onKey!(keyEvent("ArrowUp"))).toBe(true);
    expect(state.calls).toEqual([]);
    expect(frame().onKey!(keyEvent("ArrowRight"))).toBe(false);
    // 앞줄이 없으면 ChartFrame 기본 규칙(기간 이동)으로 넘겨요
    sky(skylineSample, { width: 390, front: undefined });
    expect(frame().onKey!(keyEvent("ArrowDown"))).toBe(false);
    // 기간마다 이벤트 하나: 40기간이 그대로 보여도(넓은 폭) 숨긴 표 60행 안이에요
    state.active = null;
    const forty = days(40, (i) => ({ Input: 100 + i, Cached: 50, Output: 30, Reasoning: 10, Failed: 3, Retried: 1 }));
    for (const width of [390, 2400]) {
      const h = sky(forty, { width });
      const n = frame().events.length;
      expect(n, `${width}px`).toBeLessThanOrEqual(40);
      expect([...h.matchAll(/<th scope="row">/g)]).toHaveLength(n);
      expect(decode(h)).not.toMatch(/and \d+ more/);
    }
    expect(frame().events).toHaveLength(40);
  });

  it("13: 비율 띠의 막대 높이 비가 비율 비와 같고, 뒷줄 합계 0인 기간은 막대가 없고, 띠에 눈금 글자가 있어요 (768px)", () => {
    const data = days(14, (i) => ({ Input: i === 6 ? 0 : 500 + 10 * i, Cached: i === 6 ? 0 : 300, Output: i === 6 ? 0 : 150, Reasoning: i === 6 ? 0 : 50, Failed: 5 + (i % 5) * 9, Retried: i === 9 ? 160 : 4 }));
    const h = sky(data, { width: 768, frontRate: "strip" });
    const bars = [...h.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="[\d.]+" height="([\d.]+)" rx="[\d.]+" fill="([^"]+)"><\/rect>/g)].filter((m) => !m[0].includes('width="10"'));
    const total = (d: Data[number]) => BACK.reduce((a, k) => a + Number(d[k]), 0);
    const rates = data.map((d) => (total(d) > 0 ? (Number(d.Failed) + Number(d.Retried)) / total(d) : null));
    // 뒷줄 합계 0인 7번째 기간은 막대가 없어요
    expect(bars).toHaveLength(13);
    const heights = bars.map((m) => +m[3]);
    const valid = rates.filter((x): x is number => x !== null);
    const hiK = heights.indexOf(Math.max(...heights));
    heights.forEach((ht, k) => expect(ht / heights[hiK]).toBeCloseTo(valid[k] / valid[hiK], 2));
    // 가장 큰 비율만 강조색
    expect(bars.filter((m) => m[4].includes("--ztd-accent"))).toHaveLength(1);
    const text = decode(h);
    expect(text).toContain(">Front ÷ back<");
    expect(text).toMatch(/>0<\/text>/);
    expect(text).toMatch(/>\d+%<\/text>/);
  });
});

describe("skyline: 검사 규칙과 빈 상태 (4.13)", () => {
  const spec = (data: Data, encoding: Record<string, string | string[]> = { x: "day", y: BACK, front: FRONT }, options: Record<string, unknown> = {}) => ({ type: "skyline", data, encoding, options });
  const codes = (s: unknown) => {
    const res = validateSpec(s);
    return [...res.errors.map((e) => e.code), ...res.warnings.map((w) => `!${w.code}`)];
  };
  it("음수, 기간 40·120개 초과, y 없는 front, 모두 0, 앞줄 4개, depth 범위 밖을 영어와 한글로 알려 줘요", () => {
    const ok = days(14, () => ({ Input: 4, Cached: 3, Output: 2, Reasoning: 1, Failed: 1, Retried: 1 }));
    expect(codes(spec(ok))).toEqual([]);
    expect(codes(spec(ok.map((d, i) => (i === 3 ? { ...d, Failed: -1 } : d))))).toEqual(["skyline_negative"]);
    expect(codes(spec(days(41, () => ({ Input: 1, Cached: 1, Output: 1, Reasoning: 1, Failed: 0, Retried: 0 }))))).toEqual(["!skyline_many_periods"]);
    expect(codes(spec(days(121, () => ({ Input: 1, Cached: 1, Output: 1, Reasoning: 1, Failed: 0, Retried: 0 }))))).toEqual(["skyline_too_many_periods"]);
    expect(codes(spec(ok, { x: "day", front: FRONT }))).toContain("missing_channel");
    expect(codes({ type: "skyline", data: { url: "https://x.test/a.json" }, encoding: { x: "day", front: FRONT } })).toContain("skyline_front_without_y");
    expect(codes(spec(days(7, () => ({ Input: 0, Cached: 0, Output: 0, Reasoning: 0, Failed: 0, Retried: 0 }))))).toEqual(["!skyline_all_zero"]);
    expect(codes(spec(ok.map((d) => ({ ...d, A: 1, B: 1 })), { x: "day", y: BACK, front: [...FRONT, "A", "B"] }))).toEqual(["!skyline_front_many"]);
    expect(codes(spec(ok, undefined, { depth: 0.5 }))).toEqual(["!skyline_depth_range"]);
    const ko = validateSpec(spec(ok.map((d, i) => (i === 3 ? { ...d, Input: -1 } : d))), { lang: "ko" });
    expect(ko.errors[0]).toMatchObject({ path: "encoding.y", message: "스카이라인은 0부터 쌓아요. 음수가 있으면 bar를 쓰세요" });
    expect(validateSpec(spec(ok, undefined, { depth: 0.05 }), { lang: "ko" }).warnings[0].message).toContain("depth는 0.1~0.32예요");
  });

  it("값이 모두 0이면 블록 대신 빈 상태 글을 그리고, depth는 범위 안으로 묶어요", () => {
    const zero = days(7, () => ({ Input: 0, Cached: 0, Output: 0, Reasoning: 0, Failed: 0, Retried: 0 }));
    const h = sky(zero, { width: 390 });
    expect(h).toContain(">Nothing to draw<");
    expect(periods(h)).toHaveLength(0);
    expect(r(<SkylineChart data={zero} x="day" y={BACK} width={390} locale="ko-KR" animate={false} />)).toContain(">그릴 값이 없어요<");
    const deep = skylineLayout({ width: 760, height: 400, back: [[1, 2, 3]], front: [], n: 3, depth: 0.9, wall: true, legendH: 0, below: 26, tickFmt: () => String });
    expect(deep.depthBack / deep.s).toBeCloseTo(0.32, 6);
  });
});
