import type { ReactElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chart } from "../src/charts/Chart";
import { FlowMap } from "../src/charts/flowMap";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { MAX_FLOWS } from "../src/geo/places";
import { chooseCenter } from "../src/geo/pointMap";
import { renderSpecToSVG, specMapName } from "../src/server";
import { getChartDef, validateSpec } from "../src/spec";
import { flowMapPlaces, flowMapSample, flowMapUsSample } from "../src/spec/samples";
import { ThemeProvider } from "../src/theme/context";

const state = vi.hoisted(() => ({ frame: null as unknown }));
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
  state.frame = null;
});

const r = (el: ReactElement) => renderToStaticMarkup(el);
const frame = () => state.frame as ChartFrameProps<unknown>;
const places: Record<string, [number, number]> = { Paris: [2.35, 48.86], Madrid: [-3.7, 40.42], Berlin: [13.4, 52.52], Tokyo: [139.69, 35.69], "Los Angeles": [-118.24, 34.05] };
const draw = (data: Record<string, unknown>[], extra: Record<string, unknown> = {}) => r(<FlowMap data={data} source="from" target="to" value="v" places={places} width={720} animate={false} {...extra} />);
/** 흐름 선: d와 굵기 (화살촉, 투명 호버 선은 빼요) */
const links = (h: string) => [...h.matchAll(/<path d="(M[^"]+Q[^"]+)" fill="none" stroke="(?!transparent)([^"]+)" stroke-width="([\d.]+)"([^>]*)>/g)].map((m) => ({ d: m[1], stroke: m[2], w: +m[3], clip: m[4].includes("clip-path") }));
const nums = (d: string) => d.match(/-?[\d.]+/g)!.map(Number);
const codes = (spec: object) => {
  const v = validateSpec(spec);
  return [...v.errors, ...v.warnings].map((i) => i.code);
};
const sample = getChartDef("flowMap")!.example;

describe("FlowMap", () => {
  it("draws thicker flows first, so thinner ones sit above, with the largest in the accent and an arrowhead at each target", () => {
    const h = r(<FlowMap data={flowMapSample} source="from" target="to" value="teu" places={flowMapPlaces} width={720} animate={false} />);
    const ls = links(h);
    // 태평양 가운데 지도라 가장 큰 상하이 → 로스앤젤레스는 한 줄이에요. 대서양 가장자리를 건너는 셋(로테르담 → 뉴욕, 산투스 → 로테르담, 상하이 → 산투스)은 조각이 둘이에요
    expect(ls.length).toBe(11 + 3);
    for (let i = 1; i < ls.length; i++) expect(ls[i].w).toBeLessThanOrEqual(ls[i - 1].w);
    expect(ls[0].stroke).toContain("accent");
    expect(ls[0].clip).toBe(false);
    expect(ls.filter((l) => l.stroke.includes("accent"))).toHaveLength(1);
    // 화살촉: 흐름마다 도착지에 하나, 끊긴 흐름은 나가는 끝과 들어오는 끝에도 하나씩
    const heads = [...h.matchAll(/<path d="(M[^"]+Z)" fill="[^"]+" opacity/g)].map((m) => (m[1].match(/M/g) ?? []).length);
    expect(heads.reduce((a, b) => a + b, 0)).toBe(11 + 3 * 2);
    expect(h).not.toMatch(/NaN|Infinity|undefined/);
    // 등장 전 길이 표시(pathLength)는 움직일 때만 붙어요 (서버 그림에는 없어요)
    expect(h).not.toContain("pathLength");
  });
  it("opposite flows between the same pair bend to opposite sides", () => {
    const h = draw([{ from: "Paris", to: "Berlin", v: 5 }, { from: "Berlin", to: "Paris", v: 3 }]);
    const [a, b] = links(h).map((l) => nums(l.d));
    // 곡선 조절점이 파리와 베를린을 잇는 선의 서로 다른 쪽에 있어요
    const [px, py] = a;
    const [bx, by] = b;
    const side = (cx: number, cy: number) => Math.sign((bx - px) * (cy - py) - (by - py) * (cx - px));
    expect(side(a[2], a[3])).not.toBe(0);
    expect(side(b[2], b[3])).toBe(-side(a[2], a[3]));
  });
  it("a trans-Pacific flow is one link on the Pacific-centred view it picks; on the Atlantic view it takes the short way in two marked pieces", () => {
    expect(links(draw([{ from: "Tokyo", to: "Los Angeles", v: 5 }])).map((l) => l.clip)).toEqual([false]);
    const h = draw([{ from: "Tokyo", to: "Los Angeles", v: 5 }], { center: "atlantic" });
    const ls = links(h);
    expect(ls).toHaveLength(2);
    // 나가는 끝, 들어오는 끝, 도착지에 같은 화살촉
    expect([...h.matchAll(/<path d="(M[^"]+Z)" fill="[^"]+" opacity/g)].map((m) => (m[1].match(/M/g) ?? []).length)).toEqual([1, 2]);
    expect(ls.every((l) => l.clip)).toBe(true);
    for (const l of ls) {
      const [x0, , , , x1] = nums(l.d);
      expect(Math.abs(x1 - x0)).toBeLessThan(360);
    }
    // 같은 반구 안의 흐름은 한 조각이고 자르지 않아요
    expect(links(draw([{ from: "Paris", to: "Tokyo", v: 5 }])).map((l) => l.clip)).toEqual([false]);
  });
  it('"auto" centres the world map on the Pacific for trans-Pacific lanes and on the Atlantic for trans-Atlantic ones', () => {
    expect(chooseCenter("auto", [{ a: 121.5, b: -118.2, w: 9 }, { a: 4.5, b: -74, w: 2 }], [])).toBe(150);
    expect(chooseCenter("auto", [{ a: 4.5, b: -74, w: 9 }, { a: 121.5, b: -118.2, w: 2 }], [])).toBe(0);
    expect(chooseCenter("auto", [], [])).toBe(0);
    expect(chooseCenter("pacific", [], [])).toBe(150);
    // 지점: 지도 끝(반대편 경선 20° 안)에 놓이는 수가 적은 쪽
    expect(chooseCenter("auto", [], [178, -175, 170, 10])).toBe(150);
    expect(chooseCenter("auto", [], [-25, -35, 140])).toBe(0);
  });
  it("labels each place once and only the highlighted flow's ends at narrow widths", () => {
    const narrow = draw(flowMapSample.map((f) => ({ from: f.from, to: f.to, v: f.teu })), { places: flowMapPlaces, width: 280 });
    const labels = [...narrow.matchAll(/paint-order="stroke"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(labels.every((l) => l === "Shanghai" || l === "Los Angeles")).toBe(true);
  });
  it("sums duplicate rows per direction, skips self flows, blank names and unknown places, and says so", () => {
    const data = [
      { from: "Paris", to: "Madrid", v: 2 },
      { from: "Paris", to: "Madrid", v: 3 },
      { from: "Paris", to: "Paris", v: 9 },
      { from: "", to: "Madrid", v: 1 },
      { from: "Paris", to: "Atlantis", v: 4 },
      { from: "Madrid", to: "Berlin", v: -1 },
    ];
    draw(data);
    expect(frame().events.map((e) => [e.label, e.value])).toEqual([["Paris to Madrid", 5]]);
    expect(frame().description).toContain("1 flow could not be placed on the map");
    expect(codes({ type: "flowMap", data, encoding: { source: "from", target: "to", value: "v" }, options: { places } })).toEqual(["flow_self_link", "flow_blank_place", "flow_value_not_positive", "region_unmatched"]);
  });
  it("narration and tooltip: source to target, value and share, in the locale", () => {
    r(<FlowMap data={flowMapSample} source="from" target="to" value="teu" places={flowMapPlaces} format="compact" width={720} animate={false} />);
    const e = frame().events[0];
    expect(`${e.label}, ${e.formatted}`).toBe("Shanghai to Los Angeles, 412K, 22% of the total");
    expect(frame().description).toContain("11 flows between 9 places");
    r(<FlowMap data={flowMapSample} source="from" target="to" value="teu" places={flowMapPlaces} format="compact" locale="ko-KR" width={720} animate={false} />);
    expect(`${frame().events[0].label}, ${frame().events[0].formatted}`).toBe("Shanghai에서 Los Angeles, 41.2만, 전체의 22%");
  });
  it("region names are places too, the same region under two spellings is one dot, and US flows reach the insets", () => {
    draw([{ from: "japan", to: "United States", v: 9 }, { from: "Mexico", to: "united states", v: 7 }], { places: {} });
    expect(frame().events.map((e) => e.label)).toEqual(["japan to United States", "Mexico to United States"]);
    expect(specMapName({ type: "flowMap", data: flowMapUsSample, encoding: { source: "from", target: "to", value: "tons" } })).toBe("us-states");
    const h = r(<FlowMap data={flowMapUsSample} source="from" target="to" value="tons" width={720} animate={false} />);
    expect(links(h)).toHaveLength(flowMapUsSample.length);
  });
  it("the ranked list sits beside the map from 600px and is dropped by rule below it", () => {
    expect(draw([{ from: "Paris", to: "Madrid", v: 2 }, { from: "Paris", to: "Berlin", v: 1 }])).toContain("Largest flows");
    expect(draw([{ from: "Paris", to: "Madrid", v: 2 }, { from: "Paris", to: "Berlin", v: 1 }], { width: 390 })).not.toContain("Largest flows");
    expect(draw([{ from: "Paris", to: "Madrid", v: 2 }, { from: "Paris", to: "Berlin", v: 1 }], { ranking: false })).not.toContain("Largest flows");
  });
  it("edge inputs draw without NaN or a thrown error", () => {
    const cases: Record<string, unknown>[][] = [[], [{ from: "Paris", to: "Madrid", v: 1 }], [{ from: "Paris", to: "Madrid", v: 1e308 }, { from: "Madrid", to: "Paris", v: 1e308 }], [{ from: "Paris", to: "Madrid", v: "n/a" }, { from: null, to: undefined, v: 3 }]];
    for (const data of cases)
      for (const extra of [{}, { map: "us-states" }, { focus: "europe" }, { width: 280 }, { places: { Paris: ["x", 1], Madrid: [500, 10] } }, { places: "nope" }, { highlight: "Paris" }])
        expect(draw(data, extra)).not.toMatch(/NaN|Infinity|undefined/);
    expect(draw([{ from: "Paris", to: "Madrid", v: 1 }], { map: "mars" })).toContain("is not registered");
    expect(codes({ type: "flowMap", data: [{ from: "Paris", to: "Madrid", v: 1 }], encoding: { source: "from", target: "to", value: "v" }, options: { places: { Paris: [500, 1], Madrid: [-3.7, 40.42] } } })).toEqual(["bad_place"]);
  });
  it("renders the same drawing through renderSpecToSVG, <Chart spec> and React SSR", () => {
    const spec = { ...sample, type: "flowMap" };
    const svg = renderSpecToSVG(spec, { width: 720, theme: "light", frame: false });
    const a = r(<ThemeProvider theme="light"><Chart spec={{ ...spec, card: undefined }} width={672} animate={false} /></ThemeProvider>);
    const b = renderToString(<ThemeProvider theme="light"><Chart spec={{ ...spec, card: undefined }} width={672} animate={false} /></ThemeProvider>);
    const geo = (h: string) => links(h).map((l) => l.d);
    expect(geo(a).length).toBeGreaterThan(10);
    expect(geo(b)).toEqual(geo(a));
    expect(geo(svg)).toEqual(geo(a));
    expect(codes(spec)).toEqual([]);
  });
  it(`5,000 flows stay fast and draw at most ${MAX_FLOWS}; validateSpec says so`, () => {
    const names = Array.from({ length: 120 }, (_, i) => `P${i}`);
    const pl = Object.fromEntries(names.map((n, i) => [n, [((i * 37) % 340) - 170, ((i * 13) % 120) - 55]]));
    const data = Array.from({ length: 5000 }, (_, i) => ({ from: names[i % 120], to: names[(i * 7 + 1 + Math.floor(i / 120)) % 120], v: 1 + ((i * 7919) % 500) }));
    const t0 = performance.now();
    const h = draw(data, { places: pl });
    const ms = performance.now() - t0;
    expect(frame().events.length).toBe(MAX_FLOWS);
    expect(ms).toBeLessThan(4000);
    expect(h).not.toMatch(/NaN|Infinity|undefined/);
    expect(codes({ type: "flowMap", data, encoding: { source: "from", target: "to", value: "v" }, options: { places: pl } })).toContain("too_many_flows");
  });
});
