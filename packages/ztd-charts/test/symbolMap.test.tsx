import type { ReactElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chart, autoLegend } from "../src/charts/Chart";
import { SymbolMap } from "../src/charts/symbolMap";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { MAX_POINTS, choosePlaceMap, placeDomain, placeIn } from "../src/geo/places";
import { getMap } from "../src/geo/registry";
import { geoFrame, geoLayout } from "../src/geo/view";
import { renderSpecToSVG, specMapName } from "../src/server";
import { getChartDef, validateSpec } from "../src/spec";
import { symbolMapSample, symbolMapUsSample } from "../src/spec/samples";
import { ThemeProvider } from "../src/theme/context";

/** 마지막 ChartFrame props (이벤트, 설명) */
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
const draw = (data: Record<string, unknown>[], extra: Record<string, unknown> = {}) => r(<SymbolMap data={data} size="v" label="n" width={720} animate={false} {...extra} />);
/** 원 (등장 띠 안의 원만, 고리는 fill="none") */
const circles = (h: string) => [...h.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)" fill="(?!none)([^"]+)"/g)].map((m) => ({ x: +m[1], y: +m[2], r: +m[3], fill: m[4] }));
const codes = (spec: object) => {
  const v = validateSpec(spec);
  return [...v.errors, ...v.warnings].map((i) => i.code);
};
const sample = getChartDef("symbolMap")!.example;

describe("place resolution (geo/places)", () => {
  it('"auto" takes the map that holds the most places, and the narrower map on a tie', () => {
    const pick = (items: { lon: number; lat: number }[]) => {
      const c = choosePlaceMap(undefined, () => items);
      return c && "name" in c ? c.name : null;
    };
    expect(pick([{ lon: -74, lat: 40.7 }, { lon: -118.2, lat: 34 }, { lon: -149.9, lat: 61.2 }])).toBe("us-states");
    expect(pick([{ lon: 126.98, lat: 37.57 }, { lon: 129.08, lat: 35.18 }])).toBe("kr-sido");
    expect(pick([{ lon: -74, lat: 40.7 }, { lon: 2.35, lat: 48.86 }])).toBe("world");
    expect(pick([])).toBe("world");
    // 나라 이름도 세요
    const c = choosePlaceMap("auto", () => [{ name: "France" }, { name: "Japan" }]);
    expect(c && "name" in c && c.name).toBe("world");
  });
  it("Alaska and Hawaii points take their inset pieces of the US composite", () => {
    const d = placeDomain(getMap("us-states")!);
    expect(placeIn(d, { lon: -149.9, lat: 61.2 })).toMatchObject({ id: "AK" });
    expect(placeIn(d, { lon: -176.66, lat: 51.88 })).toMatchObject({ id: "AK" });
    expect(placeIn(d, { lon: -157.86, lat: 21.31 })).toMatchObject({ id: "HI" });
    expect(placeIn(d, { lon: 2.35, lat: 48.86 })).toEqual({ miss: "outside" });
    expect(placeIn(d, { lon: 10, lat: 95 })).toEqual({ miss: "invalid" });
    expect(placeIn(d, { name: "Atlantis" })).toEqual({ miss: "unmatched" });
  });
});

describe("world map centre (geoLayout lon0)", () => {
  it("rotates before the cut: rings crossing the new seam at 30°W are cut, points land on the right side of it", () => {
    const world = getMap("world")!;
    const atl = geoLayout(world);
    const pac = geoLayout(world, { lon0: 150 });
    const greenland = atl.shapes.findIndex((s) => s.id === "GRL");
    // 그린란드(서경 73~12°)는 새 반대편 경선(서경 30°)에서 잘려 조각이 늘어요
    expect(pac.projected[greenland].rings.length).toBeGreaterThan(atl.projected[greenland].rings.length);
    // 서경 29°는 지도 왼쪽 끝, 서경 31°는 오른쪽 끝
    const fr = geoFrame(pac, 720, 360);
    expect(fr.project(-29, 0)[0]).toBeLessThan(30);
    expect(fr.project(-31, 0)[0]).toBeGreaterThan(690);
    // 도쿄는 가운데 가까이
    expect(Math.abs(fr.project(139.7, 35.7)[0] - 360)).toBeLessThan(40);
    // 기본(0)은 예전 배치 그대로예요 (같은 객체)
    expect(geoLayout(world, { lon0: 0 })).toBe(atl);
  });
});

describe("SymbolMap", () => {
  it("draws one circle per place: area follows the value, smaller circles above larger ones, the largest in the accent", () => {
    const h = r(<SymbolMap data={symbolMapSample} size="users" label="city" width={720} animate={false} />);
    const cs = circles(h);
    expect(cs).toHaveLength(15);
    // 넓이 비 = 값 비 (반지름은 0.1px로 반올림)
    const tokyo = cs[0];
    const jakarta = cs[2];
    expect((jakarta.r / tokyo.r) ** 2).toBeCloseTo(710 / 1180, 1);
    // SVG 순서가 큰 원부터라 작은 원이 위에 와요
    for (let i = 1; i < cs.length; i++) expect(cs[i].r).toBeLessThanOrEqual(cs[i - 1].r);
    expect(cs[0].fill).toContain("accent");
    expect(cs.slice(1).every((c) => !c.fill.includes("accent"))).toBe(true);
    expect(h).not.toMatch(/NaN|Infinity|undefined/);
  });
  it("puts circles in the right place: east of London is Tokyo, Sydney is south and east, São Paulo is south and west", () => {
    draw([]);
    const cs = circles(r(<SymbolMap data={symbolMapSample} size="users" label="city" width={720} animate={false} />));
    const at = (k: number) => cs[symbolMapSample.slice().sort((a, b) => b.users - a.users).findIndex((s) => s === symbolMapSample[k])];
    const [tokyo, sao, london, sydney] = [at(0), at(1), at(5), at(13)];
    expect(tokyo.x).toBeGreaterThan(london.x);
    expect(sydney.y).toBeGreaterThan(tokyo.y);
    expect(sao.x).toBeLessThan(london.x);
    expect(sao.y).toBeGreaterThan(london.y);
  });
  it("tooltip, table and narration: name, value, share of the total and rank, in the locale", () => {
    r(<SymbolMap data={symbolMapSample} size="users" label="city" format="compact" width={720} animate={false} />);
    const ev = frame().events;
    expect(ev.map((e) => e.label).slice(0, 3)).toEqual(["Tokyo", "São Paulo", "Jakarta"]);
    expect(`${ev[2].label}, ${ev[2].formatted}`).toBe("Jakarta, 710K, 9.3% of the total, 3rd of 15");
    expect(frame().description).toContain("15 places, 7.7M in total. Largest: Tokyo 1.2M");
    r(<SymbolMap data={symbolMapSample} size="users" label="city" format="compact" locale="ko-KR" width={720} animate={false} />);
    expect(frame().events[2].formatted).toBe("71만, 전체의 9.3%, 15곳 중 3위");
  });
  it("a region channel puts circles at the region centre; unknown names and Antarctica are left out", () => {
    const h = draw([{ r: "japan", v: 5 }, { r: "  FRANCE ", v: 4 }, { r: "Atlantis", v: 1 }, { r: "Antarctica", v: 1 }], { region: "r" });
    expect(circles(h)).toHaveLength(2);
    expect(frame().events.map((e) => e.label)).toEqual(["Japan", "France"]);
    expect(codes({ type: "symbolMap", data: [{ r: "Atlantis", v: 1 }, { r: "Antarctica", v: 1 }, { r: "Japan", v: 1 }], encoding: { region: "r", size: "v" } })).toEqual(["region_unmatched", "region_outside_map"]);
  });
  it("Alaska and Hawaii stores land in the insets below the lower 48", () => {
    const sorted = [...symbolMapUsSample].sort((a, b) => b.revenue - a.revenue);
    const cs = circles(r(<SymbolMap data={symbolMapUsSample} size="revenue" label="store" map="us-states" width={720} animate={false} />));
    const at = (name: string) => cs[sorted.findIndex((s) => s.store === name)];
    expect(at("Anchorage").y).toBeGreaterThan(at("Seattle").y);
    expect(at("Anchorage").x).toBeLessThan(at("Houston").x);
    expect(at("Honolulu").y).toBeGreaterThan(at("Los Angeles").y);
    expect(specMapName({ type: "symbolMap", data: symbolMapUsSample, encoding: { size: "revenue" } })).toBe("us-states");
  });
  it("focus crops to a continent and leaves out places outside it", () => {
    const h = draw([{ n: "Paris", lon: 2.35, lat: 48.86, v: 5 }, { n: "Tokyo", lon: 139.69, lat: 35.69, v: 9 }], { focus: "europe" });
    expect(circles(h)).toHaveLength(1);
    expect(h).toContain("clipPath");
    expect(codes({ type: "symbolMap", data: [{ n: "Tokyo", lon: 139.69, lat: 35.69, v: 9 }], encoding: { size: "v", label: "n" }, options: { focus: "europe" } })).toEqual(["point_outside_map"]);
  });
  it("labels the largest places by rule and never overlaps two labels", () => {
    for (const width of [720, 390, 280]) {
      const h = r(<SymbolMap data={symbolMapSample} size="users" label="city" width={width} animate={false} />);
      const boxes = [...h.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)" dy="0.35em" font-size="11" font-weight="(\d+)" text-anchor="(\w+)"[^>]*>([^<]+)</g)].map((m) => {
        const w = m[5].length * 6.2;
        const x0 = m[4] === "start" ? +m[1] : m[4] === "end" ? +m[1] - w : +m[1] - w / 2;
        return [x0, +m[2] - 6, x0 + w, +m[2] + 6];
      });
      expect(boxes.length).toBeGreaterThan(0);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(boxes[i][0] < boxes[j][2] && boxes[i][2] > boxes[j][0] && boxes[i][1] < boxes[j][3] && boxes[i][3] > boxes[j][1], `${width}`).toBe(false);
      for (const c of circles(h)) expect(c.x - c.r >= -0.5 && c.x + c.r <= width + 0.5).toBe(true);
    }
  });
  it("edge inputs draw without NaN or a thrown error", () => {
    const cases: Record<string, unknown>[][] = [
      [],
      [{ n: "One", lon: 36.8, lat: -1.3, v: 5 }],
      [1, 2, 3].map((i) => ({ n: `P${i}`, lon: 2.35, lat: 48.86, v: 10 })),
      [{ n: "z", lon: 0, lat: 0, v: 0 }, { n: "neg", lon: 1, lat: 1, v: -5 }, { n: "nan", lon: 2, lat: 2, v: "n/a" }, { n: "huge", lon: 3, lat: 3, v: 1.7e308 }, { n: "huge2", lon: 4, lat: 4, v: 1.7e308 }],
      [{ n: "str", lon: "-77.04", lat: "-12.05", v: "1,200" }, { n: null, lon: null, lat: undefined, v: 3 }],
      [{ n: "E", lon: 180, lat: -17, v: 1 }, { n: "W", lon: -180, lat: -17, v: 1 }, { n: "N", lon: 0, lat: 90, v: 1 }, { n: "S", lon: 0, lat: -90, v: 1 }, { n: "bad", lon: 200, lat: 10, v: 1 }],
    ];
    for (const data of cases)
      for (const extra of [{}, { theme: { accent: "#ff0000" } }, { map: "us-states" }, { focus: "europe" }, { width: 280 }, { sizeRange: [-5, 1e9] }, { highlight: () => true }])
        expect(draw(data, extra)).not.toMatch(/NaN|Infinity|undefined/);
    // 등록하지 않은 지도는 안내 글을 그려요
    expect(draw([{ n: "x", lon: 1, lat: 1, v: 1 }], { map: "mars" })).toContain("is not registered");
    // GeoJSON 위 지점 (밖의 지점은 빼요)
    const zones = { type: "FeatureCollection" as const, features: [{ type: "Feature", properties: { zone: "A" }, geometry: { type: "Polygon", coordinates: [[[10, 50], [11, 50], [11, 51], [10, 51], [10, 50]]] } }] };
    expect(circles(draw([{ n: "in", lon: 10.5, lat: 50.5, v: 2 }, { n: "out", lon: 40, lat: 10, v: 3 }], { map: zones }))).toHaveLength(1);
  });
  it("sizeRange is checked and clamped: a junk range never draws circles larger than an eighth of the chart", () => {
    const h = r(<SymbolMap data={symbolMapSample} size="users" label="city" sizeRange={[-5, 9999]} width={720} animate={false} />);
    const top = Math.max(...circles(h).map((c) => c.r));
    expect(top).toBeLessThanOrEqual(720 / 8 + 0.1);
    for (const c of circles(h)) expect(c.x - c.r >= -0.5 && c.x + c.r <= 720.5).toBe(true);
    expect(codes({ ...sample, type: "symbolMap", options: { ...sample.options, sizeRange: [-5, 9999] } })).toEqual(["bad_size_range"]);
    expect(codes({ ...sample, type: "symbolMap", options: { ...sample.options, sizeRange: [3, 24] } })).toEqual([]);
  });
  it("labels coinciding places once, and only the highlighted place at narrow widths", () => {
    const same = draw(Array.from({ length: 30 }, () => ({ n: "Same", lon: 10, lat: 50, v: 100 })), { highlight: 0 });
    expect(same.match(/paint-order="stroke"[^>]*>Same</g) ?? []).toHaveLength(1);
    const narrow = r(<SymbolMap data={symbolMapSample} size="users" label="city" width={280} animate={false} />);
    expect([...narrow.matchAll(/paint-order="stroke"[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(["Tokyo"]);
  });
  it("validateSpec names invalid, swapped and outside coordinates, sizes of 0 or less, and missing places", () => {
    const spec = (data: object[], options = {}) => ({ type: "symbolMap", data, encoding: { size: "v", label: "n" }, options });
    expect(codes(spec([{ n: "Seoul", lon: 37.57, lat: 126.98, v: 1 }]))).toEqual(["point_invalid"]);
    expect(validateSpec(spec([{ n: "Seoul", lon: 37.57, lat: 126.98, v: 1 }])).warnings[0].message).toContain("look swapped");
    expect(codes(spec([{ n: "a", lon: 0, lat: 10, v: 0 }, { n: "b", lon: 10, lat: 10, v: 2 }]))).toEqual(["size_not_positive"]);
    expect(codes({ type: "symbolMap", data: [{ city: "Paris", v: 1 }], encoding: { size: "v" } })).toEqual(["no_location"]);
    expect(codes(spec([{ n: "a", lon: 1, lat: 1, v: 1 }], { map: "mars" }))).toEqual(["unknown_map"]);
    expect(codes(spec([{ n: "a", lon: 1, lat: 1, v: 1 }], { highlight: "Nope" }))).toEqual(["highlight_not_found"]);
    expect(codes(sample)).toEqual([]);
  });
  it("group colors the circles with the same swatches as the card legend", () => {
    const data = symbolMapSample;
    const h = r(
      <ThemeProvider theme="light">
        <SymbolMap data={data} size="users" label="city" group="continent" width={720} animate={false} />
      </ThemeProvider>,
    );
    const legend = autoLegend({ type: "symbolMap", data, encoding: { size: "users", group: "continent" } }, data, "en-US");
    expect(legend.map((l) => l.label)).toEqual(["Asia", "Americas", "Europe", "Africa", "Oceania"]);
    expect(new Set(circles(h).map((c) => c.fill)).size).toBe(5);
  });
  it("renders the same drawing through renderSpecToSVG, <Chart spec> and React SSR", () => {
    const spec = { ...sample, type: "symbolMap" };
    const svg = renderSpecToSVG(spec, { width: 720, theme: "light", frame: false });
    const a = r(<ThemeProvider theme="light"><Chart spec={{ ...spec, card: undefined }} width={672} animate={false} /></ThemeProvider>);
    const b = renderToString(<ThemeProvider theme="light"><Chart spec={{ ...spec, card: undefined }} width={672} animate={false} /></ThemeProvider>);
    const geo = (h: string) => circles(h).map((c) => `${c.x} ${c.y} ${c.r}`);
    expect(geo(a)).toHaveLength(15);
    expect(geo(b)).toEqual(geo(a));
    expect(geo(svg)).toEqual(geo(a));
  });
  it(`10,000 places stay fast and draw at most ${MAX_POINTS} circles; validateSpec says so`, () => {
    const data = Array.from({ length: 10_000 }, (_, i) => ({ n: `P${i}`, lon: ((i * 37) % 360) - 180, lat: ((i * 17) % 120) - 60, v: 1 + ((i * 7919) % 1000) }));
    const t0 = performance.now();
    const h = draw(data);
    const ms = performance.now() - t0;
    expect(circles(h)).toHaveLength(MAX_POINTS);
    expect(ms).toBeLessThan(4000);
    expect(codes({ type: "symbolMap", data, encoding: { size: "v", label: "n" } })).toEqual(["too_many_points"]);
  });
});
