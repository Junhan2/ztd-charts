import { readFileSync } from "node:fs";
import type { KeyboardEvent, ReactElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chart } from "../src/charts/Chart";
import { Choropleth } from "../src/charts/choropleth";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { geojsonShapes, mapShapes } from "../src/geo/codec";
import { krSido } from "../src/geo/kr-sido";
import { cutRing, makeProjection, projectPoint } from "../src/geo/projection";
import { BUILTIN_MAPS, chooseMap, getMap, mapExportName, mapMatcher, registeredMaps } from "../src/geo/registry";
import type { GeoJSONFeatureCollection, GeoMap } from "../src/geo/types";
import { usStates } from "../src/geo/us-states";
import { geoFrame, geoLayout } from "../src/geo/view";
import { world } from "../src/geo/world";
import { normName } from "../src/layout/regions";
import { renderSpecToHTML, renderSpecToSVG, specMapName } from "../src/server";
import { CHARTS, validateSpec } from "../src/spec";
import { choroplethKrSample, choroplethSample, choroplethUsSample, choroplethZones, tileMapSample, tileMapSampleKo, tileMapUsSample } from "../src/spec/samples";
import { ThemeProvider } from "../src/theme/context";

/** tileMap.test.tsx와 같은 틀: active를 주면 고른 지역을, spy를 켜면 setActive 호출을 기록해요. frame은 마지막 ChartFrame props예요 */
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
afterEach(() => {
  state.active = null;
  state.via = "pointer";
  state.spy = false;
  state.calls = [];
  state.frame = null;
});

const r = (el: ReactElement) => renderToStaticMarkup(el);
const frame = () => state.frame as ChartFrameProps<unknown>;
const row = (country: unknown, rate: unknown) => ({ country, rate });
const draw = (data: Record<string, unknown>[], extra: Record<string, unknown> = {}) => r(<Choropleth data={data} region="country" value="rate" unit="%" width={720} animate={false} {...extra} />);
/** 지역 길 (채운 길만, 테두리 길은 fill="none") */
const regionPaths = (h: string) => [...h.matchAll(/<path d="([^"]+)" fill="(?!none)[^"]*"[^>]*fill-rule="evenodd"[^>]*class="ztd-mark"/g)].map((m) => m[1]);
const outlines = (h: string) => [...h.matchAll(/<path d="[^"]+" fill="none" stroke="[^"]+" stroke-width="([\d.]+)"/g)].map((m) => +m[1]);
/** 길의 한 부분 경로에서 가로로 크게 건너뛰는 선(지도를 가로지르는 선)이 있는지: 상대 좌표 l 뒤 dx 중 가장 큰 절댓값 */
const maxJump = (d: string) => Math.max(0, ...[...d.matchAll(/l([^MZ]+)/g)].flatMap((m) => m[1].trim().split(/\s+/).filter((_, i) => i % 2 === 0).map((v) => Math.abs(+v))));
/** 등록표를 잠깐 비우고 fn을 돌려요 (등록하지 않은 경우) */
function withoutMaps<T>(fn: () => T): T {
  const key = Symbol.for("ztd-charts.geo.maps");
  const g = globalThis as unknown as Record<symbol, Map<string, unknown>>;
  const saved = g[key];
  g[key] = new Map();
  try {
    return fn();
  } finally {
    g[key] = saved;
  }
}

describe("geo foundation", () => {
  it("matches a region by any code or name, ignoring case, spaces and leading zeros", () => {
    expect([normName("  South   Korea "), normName("004"), normName(4), normName("0")]).toEqual(["south korea", "4", "4", "0"]);
    const m = mapMatcher(world);
    const kor = m("KOR");
    expect(kor).toBeGreaterThanOrEqual(0);
    for (const name of ["KR", "kor", 410, "410", "South Korea", "south korea", "Korea, Republic of", "Republic of Korea", " Korea "]) expect(m(name), String(name)).toBe(kor);
    const same = (a: unknown[]) => new Set(a.map((n) => m(n))).size;
    expect(same(["USA", "US", "United States", "United States of America", 840, "U.S."])).toBe(1);
    expect(same(["UK", "GB", "GBR", "United Kingdom", "Great Britain"])).toBe(1);
    expect(same(["Czechia", "Czech Republic", "CZ", 203])).toBe(1);
    expect(same(["Türkiye", "Turkey", "TR"])).toBe(1);
    expect(same(["Afghanistan", "004", 4, "AF"])).toBe(1);
    expect(m("Atlantis")).toBe(-1);
    const us = mapMatcher(usStates);
    expect(new Set(["CA", "ca", "California", "06", 6, "US-CA"].map((n) => us(n))).size).toBe(1);
    expect(us("Washington, D.C.")).toBe(us("DC"));
    const kr = mapMatcher(krSido);
    expect(new Set(["서울", "서울특별시", "Seoul", "KR-11"].map((n) => kr(n))).size).toBe(1);
  });

  it("ships 177 countries, 51 US states and 16 Korean regions, each with a shape", () => {
    expect(mapShapes(world)).toHaveLength(177);
    expect(mapShapes(usStates)).toHaveLength(51);
    const kr = mapShapes(krSido);
    expect(kr.map((s) => s.id)).toContain("Jeonnam-Gwangju");
    expect(kr).toHaveLength(16);
    for (const s of [...mapShapes(world), ...mapShapes(usStates), ...kr]) expect(s.polygons.length, s.id).toBeGreaterThan(0);
    // 광주는 전남광주에 들어가서 따로 없어요
    expect(mapMatcher(krSido)("광주")).toBe(-1);
  });

  it("projects north up and east right, and puts Alaska and Hawaii below the lower 48", () => {
    const ee = makeProjection("equalEarth");
    const [x0, y0] = projectPoint(ee, 0, 0);
    expect([x0, y0]).toEqual([0, 0]);
    const [xe, yn] = projectPoint(ee, 90, 45);
    expect(xe).toBeGreaterThan(0);
    expect(yn).toBeLessThan(0);
    const us = makeProjection("albersUsa");
    const [caX] = projectPoint(us, -119.4, 36.8);
    const [maineX, maineY] = projectPoint(us, -69.4, 45.3);
    const [akX, akY] = projectPoint(us, -150, 64);
    const [hiX, hiY] = projectPoint(us, -157.8, 21.3);
    expect(caX).toBeLessThan(maineX);
    // 알래스카와 하와이는 본토 왼쪽 아래 (도법 조각을 지점 자리로 골라요)
    expect(akY).toBeGreaterThan(maineY);
    expect(hiY).toBeGreaterThan(maineY);
    expect(akX).toBeLessThan(hiX);
  });

  it("cuts rings that cross the antimeridian instead of drawing a line across the map", () => {
    // 피지처럼 179°E에서 179°W로 건너는 고리: 두 조각, 경도 차이는 어느 조각에서도 180 미만
    const pieces = cutRing([[178, -17], [179.5, -17], [-179.5, -17], [-179, -16], [179, -16]]);
    expect(pieces).toHaveLength(2);
    for (const p of pieces) expect(Math.max(...p.map((q) => q[0])) - Math.min(...p.map((q) => q[0]))).toBeLessThan(180);
    // 세계 지도의 피지, 러시아: 지도 폭의 절반을 넘게 건너뛰는 선이 없어요
    const g = geoLayout(world);
    const f = geoFrame(g, 720, 320);
    for (const id of ["FJI", "RUS", "USA"]) {
      const i = g.shapes.findIndex((s) => s.id === id);
      expect(f.paths[i].length, id).toBeGreaterThan(20);
      expect(maxJump(f.paths[i]), id).toBeLessThan(360);
    }
    // 남극은 기본으로 빼요
    expect(g.regions.map((i) => g.shapes[i].id)).not.toContain("ATA");
  });

  it("a focus crop keeps only rings that reach the frame (resvg stops on a clipped shape with nothing left)", () => {
    for (const focus of Object.keys(world.focus!))
      for (const [w, h] of [[720, 400], [390, 240], [280, 160]]) {
        const g = geoLayout(world, { focus });
        const f = geoFrame(g, w, h);
        for (const i of [...g.regions, ...g.context])
          for (const ring of f.paths[i].split("Z").filter(Boolean)) {
            // 1px보다 작은 고리는 1.6px 네모(h1.6v1.6h-1.6)예요
            const [, x, y, rest] = /^M([-\d.]+) ([-\d.]+)(?:l(.*)|h1\.6v1\.6h-1\.6)?$/.exec(ring)!;
            const xs = [+x];
            const ys = [+y];
            (rest ?? "").trim().split(/\s+/).filter(Boolean).map(Number).forEach((v, k) => (k % 2 ? ys.push(ys[ys.length - 1] + v) : xs.push(xs[xs.length - 1] + v)));
            const inside = Math.max(...xs) >= 0 && Math.min(...xs) <= w && Math.max(...ys) >= 0 && Math.min(...ys) <= h;
            expect(inside, `${focus} ${w} ${g.shapes[i].id}`).toBe(true);
          }
      }
  });

  it("reads GeoJSON: holes, MultiPolygons, empty features and out-of-range coordinates", () => {
    const fc: GeoJSONFeatureCollection = {
      type: "FeatureCollection",
      features: [
        ...choroplethZones.features,
        { type: "Feature", properties: { zone: "Empty" }, geometry: null },
        { type: "Feature", properties: { zone: "Line" }, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
        { type: "Feature", properties: { zone: "Far" }, geometry: { type: "Polygon", coordinates: [[[10, 95], [10.5, 95], [10.5, 50], [10, 50], [10, 95]]] } },
      ],
    };
    const g = geojsonShapes(fc, "zone", "label");
    expect(g.shapes.map((s) => s.id)).toEqual(["North", "East", "South", "Lakes", "Far"]);
    expect(g.shapes.map((s) => s.name).slice(0, 2)).toEqual(["North zone", "East zone"]);
    expect(g.skipped).toEqual([4, 5]);
    // 위도 95인 점 셋(닫는 점 포함)은 90으로 묶어요
    expect(g.outOfRange).toBe(3);
    // 구멍 하나, 조각 둘
    expect(g.shapes[1].polygons[0]).toHaveLength(2);
    expect(g.shapes[3].polygons).toHaveLength(2);
  });

  it("every built-in map has its entry point, its package export and its server registration", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { exports: Record<string, unknown> };
    expect(Object.keys(pkg.exports).filter((k) => k.startsWith("./geo/"))).toEqual(BUILTIN_MAPS.map((m) => `./geo/${m}`));
    const tsup = readFileSync(new URL("../tsup.config.ts", import.meta.url), "utf8");
    for (const m of BUILTIN_MAPS) {
      expect(tsup, m).toContain(`"geo/${m}": "src/geo/${m}.ts"`);
      const mod = (await import(`../src/geo/${m}.ts`)) as Record<string, unknown>;
      expect(mod[mapExportName(m)], m).toBe(getMap(m));
    }
  });

  it("keeps one registry for every copy of the module (the server entry and the spec entry are separate bundles)", () => {
    expect(registeredMaps()).toEqual(["world", "us-states", "kr-sido"]);
    expect((globalThis as unknown as Record<symbol, Map<string, unknown>>)[Symbol.for("ztd-charts.geo.maps")].get("world")).toBe(world);
    expect(getMap("world")).toBe(world);
  });

  it('"auto" picks the registered map that matches the most region values', () => {
    const pick = (values: unknown[]) => {
      const c = chooseMap(undefined, () => values);
      return c && "name" in c ? c.name : c;
    };
    expect(pick(choroplethSample.map((d) => d.country))).toBe("world");
    expect(pick(tileMapUsSample.map((d) => d.state))).toBe("us-states");
    expect(pick(tileMapSampleKo.map((d) => d.sido))).toBe("kr-sido");
    expect(pick(["Seoul", "Busan"])).toBe("kr-sido");
    // "Georgia" 하나는 나라와 주가 같이 맞아서 먼저 등록한 세계 지도. 아무것도 안 맞으면 처음 지도
    expect(pick(["Georgia"])).toBe("world");
    expect(pick(["Georgia", "Ohio"])).toBe("us-states");
    expect(pick([])).toBe("world");
    expect(withoutMaps(() => chooseMap("auto", () => []))).toEqual({ missing: "auto" });
  });
});

describe("Choropleth", () => {
  it("legend step hover: the rest turns no-data grey, the step's regions get a thin outline, and the list shows that step", async () => {
    // 범례 단계 상태(useState(null))만 0(가장 옅은 단계)으로: choropleth.tsx가 바로 부른 useState만 바꿔요
    vi.resetModules();
    vi.doMock("react", async (orig) => {
      const R = await orig<typeof import("react")>();
      return {
        ...R,
        useState: (init: unknown) => {
          const st = R.useState(init);
          return init === null && /choropleth\.tsx/.test(new Error().stack?.split("\n")[2] ?? "") ? [0, () => {}] : st;
        },
      };
    });
    try {
      const mod = await import("../src/charts/choropleth");
      const h = r(<mod.Choropleth data={choroplethSample} region="country" value="rate" unit="%" width={720} animate={false} />);
      const lowest = ["Peru", "Kenya", "Morocco", "Egypt", "Nigeria"];
      // 목록 머리 줄과 그 단계 지역 (가장 높은 곳 목록이 아니에요)
      expect(h).toMatch(/>\d+ regions in this step</);
      for (const name of lowest) expect(h).toContain(`. ${name}<`);
      expect(h).not.toContain(">1. Canada<");
      // 단계 밖 지역은 데이터 없음 색(불투명), 단계 지역은 얇은 테두리
      const fills = [...h.matchAll(/fill="([^"]+)" opacity="([\d.]+)"[^>]*fill-rule="evenodd"/g)];
      expect(fills.filter((m) => m[1].includes("neutral-soft")).length).toBeGreaterThan(150);
      expect(fills.filter((m) => !m[1].includes("neutral-soft"))).toHaveLength(7);
      expect(fills.every((m) => +m[2] !== 0.25)).toBe(true);
      expect(h).toMatch(/<g pointer-events="none" fill="none" stroke="[^"]+" stroke-width="0.75"/);
      // 단계 밖 강조(캐나다)의 굵은 테두리는 숨겨요
      expect(outlines(h)).not.toContain(1.4);
    } finally {
      vi.doUnmock("react");
      vi.resetModules();
    }
  });

  it("legend step hover draws the highlight outline or ring only while the highlighted region is in that step (world, US states, Korea)", async () => {
    // 범례 단계 상태를 at으로: choropleth.tsx가 바로 부른 useState(null)만 바꿔요
    let at = 0;
    vi.resetModules();
    vi.doMock("react", async (orig) => {
      const R = await orig<typeof import("react")>();
      return {
        ...R,
        useState: (init: unknown) => {
          const st = R.useState(init);
          return init === null && /choropleth\.tsx/.test(new Error().stack?.split("\n")[2] ?? "") ? [at, () => {}] : st;
        },
      };
    });
    try {
      const mod = await import("../src/charts/choropleth");
      // 큰 지역은 굵은 테두리(path), 작은 지역은 고리(circle)로 둘러요 (확대한 한국 지도는 세종까지 모두 테두리예요)
      const cases: [string, Record<string, unknown>, string, "outline" | "ring"][] = [
        ["Canada", { data: choroplethSample, region: "country" }, "Canada", "outline"],
        ["South Korea", { data: choroplethSample, region: "country" }, "South Korea", "ring"],
        ["California", { data: choroplethUsSample, region: "state", map: "us-states" }, "California", "outline"],
        ["Seoul", { data: choroplethKrSample, region: "sido", map: "kr-sido" }, "Seoul", "outline"],
      ];
      for (const [hi, props, name, form] of cases) {
        const seen = { inStep: 0, outside: 0 };
        for (at = 0; at < 5; at++) {
          const h = r(<mod.Choropleth {...(props as { data: Record<string, unknown>[] })} value="rate" highlight={hi} width={720} animate={false} />);
          const listed = [...h.matchAll(/>\d+\. ([^<]+)</g)].map((m) => m[1]);
          const count = Number(/>(\d+) regions? in this step</.exec(h)?.[1]);
          const outline = /<path d="[^"]+" fill="none" stroke="[^"]+" stroke-width="1.4"/.test(h);
          const ring = /<circle [^>]*fill="none" stroke="[^"]+" stroke-width="1.4"/.test(h);
          if (listed.includes(name)) {
            seen.inStep++;
            expect(form === "outline" ? outline : ring, `${name} step ${at}`).toBe(true);
          } else if (listed.length === count) {
            seen.outside++;
            expect(outline || ring, `${name} step ${at}`).toBe(false);
          }
        }
        expect(seen.inStep, name).toBe(1);
        expect(seen.outside, name).toBeGreaterThan(0);
      }
    } finally {
      vi.doUnmock("react");
      vi.resetModules();
    }
  });

  it("shades every country with data in steps, outlines the highest, and keeps the SVG clean", () => {
    const h = draw(choroplethSample);
    const paths = regionPaths(h);
    expect(paths.length).toBeGreaterThan(160);
    expect(h).not.toMatch(/NaN|undefined|Infinity/);
    // 가장 높은 곳(캐나다)에만 테두리
    expect(outlines(h)).toEqual([1.4]);
    const ev = frame().events;
    expect(ev.slice(0, 3).map((e) => `${e.label}: ${e.formatted}`)).toEqual(["Canada: 4.8%, 1st of 37", "Netherlands: 4.4%, 2nd of 37", "Sweden: 4.2%, 3rd of 37"]);
    // 같은 값은 같은 순위 (태국과 튀르키예 2.2%는 둘 다 22위)
    expect([ev[21].formatted, ev[22].formatted]).toEqual(["2.2%, 22nd of 37", "2.2%, 22nd of 37"]);
    expect(ev[36].formatted).toBe("0.9%, 37th of 37");
    expect(ev[37]).toMatchObject({ value: null, formatted: "No data" });
    expect(frame().description).toBe("Choropleth map. 37 regions with data. Highest Canada 4.8%, lowest Nigeria 0.9%, mean 2.7%. 139 regions without data.");
    // 범례: 다섯 단계와 데이터 없음 칸
    expect(h).toContain(">No data</text>");
  });

  it("shows the ranked list beside the map when there is room, and drops it by rule when narrow", () => {
    const wide = draw(choroplethSample);
    expect(wide).toContain(">Highest</text>");
    expect(wide).toContain(">1. Canada</text>");
    expect(wide).toContain(">Lowest</text>");
    const narrow = draw(choroplethSample, { width: 390 });
    expect(narrow).not.toContain(">Highest</text>");
    expect(draw(choroplethSample, { ranking: false })).not.toContain(">Highest</text>");
    expect(draw(choroplethSample, { width: 390, ranking: true })).toContain(">Highest</text>");
    // 지역이 적으면 머리 줄 없이 모두
    const few = draw([row("France", 3), row("Spain", 2), row("Italy", 1)]);
    expect(few).not.toContain(">Highest</text>");
    expect(few).toContain(">3. Italy</text>");
  });

  it("finds the map from the data: US states, Korean regions, countries", () => {
    r(<Choropleth data={tileMapUsSample} region="state" value="rate" width={600} animate={false} />);
    expect(frame().events).toHaveLength(51);
    expect(frame().events[0].label).toBe("District of Columbia");
    r(<Choropleth data={tileMapSampleKo} region="sido" value="rate" width={600} animate={false} />);
    expect(frame().events.map((e) => e.label).slice(0, 2)).toEqual(["세종", "서울"]);
    r(<Choropleth data={tileMapSample} region="sido" value="rate" width={600} animate={false} locale="ko-KR" />);
    expect(frame().events[0].formatted).toBe("98, 16곳 중 1위");
    expect(frame().events[0].label).toBe("세종");
  });

  it("takes codes as numbers, mixed case and aliases; unmatched rows are skipped and the last duplicate wins", () => {
    draw([row(410, 5), row("usa", 4), row("  united KINGDOM", 3), row("Atlantis", 99), row("KOR", 1)]);
    const ev = frame().events;
    expect(ev.slice(0, 3).map((e) => `${e.label}=${e.value}`)).toEqual(["United States=4", "United Kingdom=3", "South Korea=1"]);
  });

  it("edge inputs draw without NaN or a thrown error", () => {
    const cases: Record<string, unknown>[][] = [
      [],
      [row("France", 3)],
      ["France", "Spain", "Italy"].map((c) => row(c, 2)),
      [row("France", null), row("Spain", "n/a"), row("Italy", Infinity), row("Peru", -Infinity)],
      [row("France", -5), row("Spain", 0), row("Italy", 5)],
      [row("Atlantis", 1), row("Mordor", 2)],
      [row("<script>alert(1)</script>", 1), row("🇫🇷", 2), row("مصر", 3)],
      [{ nothing: 1 }],
    ];
    for (const data of cases) {
      const h = draw(data);
      expect(h, JSON.stringify(data)).not.toMatch(/NaN|undefined|Infinity|<script>/);
    }
    // 모두 같으면 강조 없음, 같은 값이라고 말해요
    draw(["France", "Spain", "Italy"].map((c) => row(c, 2)));
    expect(frame().description).toMatch(/^Choropleth map\. 3 regions with data, all at the same value, 2%/);
    // 하나만
    draw([row("France", 3)]);
    expect(frame().events[0].formatted).toBe("3%, 1st of 1");
    // 이상한 옵션 값
    for (const extra of [{ colorSteps: 0 }, { colorSteps: 99 }, { colorSteps: "x" }, { width: 0 }, { height: -10 }, { focus: "mars" }, { colorCenter: 0 }, { legendLabels: [] }]) {
      expect(draw(choroplethSample, extra), JSON.stringify(extra)).not.toMatch(/NaN|undefined|Infinity/);
    }
  });

  it("a named map that is not registered, or an unknown one, says how to load it instead of throwing", () => {
    const h = draw(choroplethSample, { map: "mars" });
    expect(h).toContain("Map &quot;mars&quot; is not registered");
    expect(frame().events).toEqual([]);
    const none = withoutMaps(() => draw(choroplethSample));
    expect(none).toContain("No map is registered");
  });

  it("focus crops to a continent: other regions are pale context, rows outside it are left out", () => {
    const h = draw(choroplethSample, { focus: "europe" });
    expect(h).toMatch(/<clipPath id="[^"]+c"><rect width="\d+" height="\d+"><\/rect><\/clipPath>/);
    const labels = frame().events.filter((e) => e.value !== null).map((e) => e.label);
    expect(labels).toContain("Germany");
    expect(labels).not.toContain("Japan");
    expect(labels).not.toContain("Türkiye");
    expect(frame().events[0].formatted).toMatch(/of 11$/);
  });

  it("draws a custom GeoJSON by the property options name", () => {
    const zones = [{ zone: "North", rate: 3 }, { zone: "East", rate: 4 }, { zone: "South", rate: 2 }, { zone: "Lakes", rate: 1 }];
    const h = r(<Choropleth data={zones} region="zone" value="rate" map={choroplethZones} featureId="zone" featureName="label" width={480} animate={false} />);
    expect(regionPaths(h)).toHaveLength(4);
    expect(frame().events.map((e) => e.label)).toEqual(["East zone", "North zone", "South zone", "Lakes zone"]);
  });

  it("Home and End jump to the highest and lowest, arrows move to the nearest region in that direction", async () => {
    const { ChartFrame: RealFrame } = await vi.importActual<typeof import("../src/core/ChartFrame")>("../src/core/ChartFrame");
    state.spy = true;
    state.active = 0;
    state.via = "keyboard";
    draw([row("Germany", 5), row("France", 4), row("Poland", 3), row("Spain", 1)], { focus: "europe" });
    let root: ReactElement<{ onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void }> | null = null;
    function Probe() {
      root = RealFrame(frame());
      return root;
    }
    r(<Probe />);
    const self = {};
    const press = (key: string) => root!.props.onKeyDown({ key, target: self, currentTarget: self, preventDefault() {} } as never);
    // 독일에서: End는 가장 낮은 스페인, 오른쪽은 이웃 폴란드, 왼쪽은 이웃 나라(벨기에, 네덜란드, 룩셈부르크 쪽)
    press("End");
    press("ArrowRight");
    press("ArrowDown");
    const ev = frame().events;
    const names = state.calls.map(([i]) => (i === null ? "-" : ev[i].label));
    expect(names[0]).toBe("Spain");
    expect(["Poland", "Czechia"]).toContain(names[1]);
    expect(["Austria", "Switzerland", "Czechia"]).toContain(names[2]);
    expect(frame().announce).toBe("Germany: 5%, 1st of 4");
  });

  it("the tooltip has the value and the rank, and Korean text in the ko locale", () => {
    state.active = 0;
    draw(choroplethSample);
    expect(frame().tip!.title).toBe("Canada");
    expect(frame().tip!.rows.map((x) => `${x.label}=${x.value}`)).toEqual(["Value=4.8%", "Rank=1st of 37"]);
    draw(choroplethSample, { locale: "ko-KR" });
    expect(frame().tip!.rows.map((x) => `${x.label}=${x.value}`)).toEqual(["값=4.8%", "순위=37곳 중 1위"]);
  });

  it("renders the same geometry on the server, in React SSR and through <Chart spec>", () => {
    const def = CHARTS.find((c) => c.type === "choropleth")!;
    const geometry = (s: string) => [...s.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join("|");
    const server = renderSpecToSVG(def.example, { width: 640 + 48, frame: false, theme: "light" });
    const browser = r(
      <ThemeProvider theme="light">
        <Chart spec={{ ...def.example, card: undefined }} width={640} animate={false} />
      </ThemeProvider>,
    );
    expect(geometry(browser).length).toBeGreaterThan(20_000);
    expect(geometry(server)).toBe(geometry(browser));
    // 이어받는 HTML(renderToString)도 같은 길
    const html = renderSpecToHTML(def.example, { width: 640, frame: false, interactive: { script: "" } });
    expect(geometry(html)).toContain(geometry(browser).slice(0, 2000));
    const ssr = renderToString(<Choropleth data={choroplethSample} region="country" value="rate" map={world} width={640} animate={false} />);
    expect(geometry(ssr)).toBe(geometry(r(<Choropleth data={choroplethSample} region="country" value="rate" map="world" width={640} animate={false} />)));
    expect(specMapName(def.example)).toBe("world");
    expect(specMapName({ ...def.example, options: {} })).toBe("world");
    expect(specMapName({ type: "choropleth", data: tileMapUsSample, encoding: { region: "state", value: "rate" } })).toBe("us-states");
    expect(specMapName({ type: "bar", data: [] })).toBeNull();
  });

  it("10,000 rows and a 5 MB GeoJSON stay fast", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => row(choroplethSample[i % choroplethSample.length].country, i));
    let t0 = performance.now();
    draw(many);
    expect(performance.now() - t0).toBeLessThan(2000);
    // 0.002° 간격 원 1,000개 = 약 5MB
    const features = Array.from({ length: 1000 }, (_, k) => {
      const cx = (k % 40) * 0.5;
      const cy = Math.floor(k / 40) * 0.5;
      const ring = Array.from({ length: 160 }, (_, j) => [cx + 0.2 * Math.cos((j / 160) * 2 * Math.PI), cy + 0.2 * Math.sin((j / 160) * 2 * Math.PI)]);
      return { type: "Feature", properties: { id: `z${k}` }, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } };
    });
    const big: GeoJSONFeatureCollection = { type: "FeatureCollection", features };
    expect(JSON.stringify(big).length).toBeGreaterThan(4_500_000);
    t0 = performance.now();
    const h = r(<Choropleth data={[{ region: "z1", value: 1 }]} map={big} width={720} animate={false} />);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(regionPaths(h)).toHaveLength(1000);
  });
});

describe("lead review fixes", () => {
  it("a small highlighted region keeps its colour: thin outline and a ring around it, while a large one gets the outline", () => {
    const circles = (h: string) => [...h.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="none"/g)].map((m) => +m[3]);
    for (const width of [720, 390, 280]) {
      const big = draw(choroplethSample, { width });
      expect(outlines(big), String(width)).toEqual([1.4]);
      expect(circles(big)).toEqual([]);
      const small = draw(choroplethSample, { width, highlight: "South Korea" });
      // 얇은 선(0.75)과 고리 하나. 굵은 선이 칠을 덮지 않아요
      expect(outlines(small), String(width)).toEqual([0.75]);
      expect(circles(small)).toHaveLength(1);
      expect(circles(small)[0]).toBeGreaterThanOrEqual(6);
    }
    // 미국을 강조한 아메리카: 본토와 알래스카만 굵게, 하와이 섬들은 굵은 선에서 빠져요
    const us = draw(choroplethSample, { focus: "americas", highlight: "United States" });
    const d = /<path d="([^"]+)" fill="none" stroke="[^"]+" stroke-width="1.4"/.exec(us)![1];
    const usAll = regionPaths(us).find((p) => p.length > d.length && p.startsWith(d.slice(0, 12)));
    expect(d.split("Z").length).toBeLessThan((usAll ?? d).split("Z").length);
  });

  it("kr-sido has Dokdo as a part of Gyeongsangbuk-do, drawn as a speck", () => {
    const gb = mapShapes(krSido).find((s) => s.id === "Gyeongbuk")!;
    const part = gb.polygons.find((p) => p[0].every(([lon, lat]) => Math.abs(lon - 131.865) < 0.02 && Math.abs(lat - 37.242) < 0.02));
    expect(part, "polygon near 131.86E 37.24N").toBeTruthy();
    expect(mapShapes(krSido).filter((s) => s.id !== "Gyeongbuk").some((s) => s.polygons.some((p) => p[0].some(([lon]) => lon > 131.5)))).toBe(false);
    // 720px 지도에서 독도는 1.6px 네모로 남아요 (울릉도 오른쪽)
    const g = geoLayout(krSido);
    const f = geoFrame(g, 720, 780);
    const i = g.shapes.findIndex((s) => s.id === "Gyeongbuk");
    const [dx, dy] = f.project(131.861, 37.243);
    const specks = [...f.paths[i].matchAll(/M([\d.]+) ([\d.]+)h1\.6v1\.6h-1\.6Z/g)].map((m) => [+m[1] + 0.8, +m[2] + 0.8]);
    expect(specks.some(([x, y]) => Math.abs(x - dx) < 2 && Math.abs(y - dy) < 2)).toBe(true);
  });

  it("suggests a region name only when it is close and in the same script", () => {
    const tile = (data: Record<string, unknown>[]) => validateSpec({ type: "tileMap", data, encoding: { region: "c", value: "v" } }).warnings.map((w) => w.message);
    expect(tile([{ c: "CA", v: 3 }, { c: "서울", v: 4 }, { c: "TX", v: 5 }])).toEqual(['1 region matches no tile and is left out: "서울"']);
    expect(tile([{ c: "CA", v: 3 }, { c: "Texsa", v: 4 }])[0]).toContain('"Texsa" (did you mean "Texas"?)');
    expect(tile([{ c: "서을", v: 3 }])[0]).toContain('"서을" (did you mean "서울"?)');
    expect(validateSpec({ type: "tileMap", data: [{ c: "서을", v: 3 }], encoding: { region: "c", value: "v" } }, { lang: "ko" }).warnings[0].message).toContain('"서을"("서울"인가요?)');
    const choro = (names: string[]) => validateSpec({ type: "choropleth", data: names.map((c) => ({ c, v: 1 })), encoding: { region: "c", value: "v" } }).warnings[0]?.message ?? "";
    expect(choro(["Germny", "France"])).toContain('(did you mean "Germany"?)');
    expect(choro(["Japan", "서울특별시정부"])).not.toContain("did you mean");
    expect(choro(["Japan", "ZZ"])).toBe('1 region matches nothing on the map and is left out: "ZZ"');
  });
});

describe("forged input", () => {
  /** build-geo.mjs의 pack과 같은 꼴: 지그재그, 한 글자에 5비트, 6번째 비트는 이어짐 */
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const pack = (ints: number[]) =>
    ints
      .map((n) => {
        let z = n >= 0 ? n * 2 : -n * 2 - 1;
        let s = "";
        while (z >= 32) {
          s += B64[32 + (z % 32)];
          z = Math.floor(z / 32);
        }
        return s + B64[z];
      })
      .join("");
  const forged = (topo: Record<string, unknown>, regions: unknown = [["A", "A"]]) => ({ name: "forged", projection: "equalEarth", regions, topo: { t: [1, 0, 0], arcs: "", shapes: "", ...topo }, source: "" }) as unknown as GeoMap;
  const quick = <R,>(fn: () => R): R => {
    const t0 = performance.now();
    const out = fn();
    expect(performance.now() - t0).toBeLessThan(500);
    return out;
  };
  // 세모 하나 (선 하나, 점 4개: 처음, 오른쪽, 위, 처음)
  const tri = [4, 0, 0, 1, 0, -1, 1, 0, -1];

  it("counts larger than the input left stop the decoder instead of looping", () => {
    // 다각형 10억 개라고 적고 그 뒤가 비었어요
    expect(quick(() => mapShapes(forged({ arcs: pack(tri), shapes: pack([1e9]) })))[0].polygons).toEqual([]);
    // 선 하나가 점 10억 개라고 적었어요
    expect(quick(() => mapShapes(forged({ arcs: pack([1e9, 0, 0, 1, 1]), shapes: pack([1, 1, 1, 0]) })))[0].polygons).toEqual([]);
    // 고리 하나가 선 10억 개라고 적었어요
    expect(quick(() => mapShapes(forged({ arcs: pack(tri), shapes: pack([1, 1, 1e9, 0]) })))[0].polygons).toEqual([]);
    // 없는 선 번호, 음수 개수, 정수가 아닌 눈금
    expect(quick(() => mapShapes(forged({ arcs: pack(tri), shapes: pack([1, 1, 2, 99, -50]) })))[0].polygons).toEqual([]);
    expect(mapShapes(forged({ t: [NaN, 0, 0], arcs: pack(tri), shapes: pack([1, 1, 1, 0]) }))[0].polygons).toEqual([]);
    // 제대로 된 세모는 그대로 풀려요
    expect(mapShapes(forged({ arcs: pack(tri), shapes: pack([1, 1, 1, 0]) }))[0].polygons[0][0]).toEqual([[0, 0], [1, 0], [0, 1]]);
  });

  it("one big arc reused many times stops at the point budget", () => {
    const n = 20_000;
    const arcs = pack([n, ...Array.from({ length: n * 2 }, (_, i) => (i % 2 ? 1 : 0))]);
    const shapes = pack([1, 1, 30_000, ...new Array(30_000).fill(0)]);
    const ring = quick(() => mapShapes(forged({ arcs, shapes })))[0].polygons[0]?.[0] ?? [];
    expect(ring.length).toBeLessThanOrEqual(n * 4);
  });

  it("a varint that never ends, a non-string arc field and non-array region rows do not throw", () => {
    expect(quick(() => mapShapes(forged({ arcs: "_".repeat(200_000), shapes: "_".repeat(200_000) })))).toHaveLength(1);
    expect(mapShapes(forged({ arcs: 42 as unknown as string }))).toHaveLength(1);
    const m = forged({}, [5, null, ["B", "Bee"], { 0: "x" }]);
    expect(mapShapes(m).map((s) => s.id)).toEqual(["", "", "B", ""]);
    expect(mapMatcher(m)("bee")).toBe(2);
  });

  it("a JSON spec cannot carry a packed map object, and the renderers refuse it", () => {
    const spec = { type: "choropleth", data: [{ country: "France", rate: 1 }], encoding: { region: "country", value: "rate" }, options: { map: world } };
    const v = validateSpec(JSON.parse(JSON.stringify(spec)));
    expect(v.errors.map((e) => e.code)).toEqual(["map_object_in_spec"]);
    expect(v.errors[0].message).toContain('Name a registered map (for example "world")');
    expect(() => renderSpecToSVG(JSON.parse(JSON.stringify(spec)))).toThrow(/packed map object/);
    expect(validateSpec(JSON.parse(JSON.stringify(spec)), { lang: "ko" }).errors[0].message).toContain("압축한 지도 객체");
  });

  it("GeoJSON in a spec is capped by feature count and by coordinate count", () => {
    const sq = (k: number) => ({ type: "Feature", properties: { id: `f${k}` }, geometry: { type: "Polygon", coordinates: [[[k % 100, 0], [(k % 100) + 0.5, 0], [(k % 100) + 0.5, 0.5], [k % 100, 0]]] } });
    const spec = (features: unknown[]) => ({ type: "choropleth", data: [{ region: "f1", value: 1 }], encoding: { region: "region", value: "value" }, options: { map: { type: "FeatureCollection", features } } });
    const many = Array.from({ length: 20_001 }, (_, k) => sq(k));
    expect(quick(() => validateSpec(spec(many))).errors.map((e) => `${e.code}: ${e.message}`)).toEqual(["map_too_large: The GeoJSON is too large for a spec: 20001 features (the limit is 20000). Simplify it first (for example with mapshaper), or pass it from code through the map prop"]);
    const ring = Array.from({ length: 1_000_001 }, (_, k) => [Math.cos(k), Math.sin(k)]);
    const big = [{ type: "Feature", properties: { id: "f1" }, geometry: { type: "Polygon", coordinates: [ring] } }];
    expect(quick(() => validateSpec(spec(big))).errors.map((e) => e.code)).toEqual(["map_too_large"]);
    expect(() => renderSpecToSVG(spec(big) as never)).toThrow(/too large/);
    // 상한 안의 GeoJSON은 그대로 그려요
    expect(validateSpec(spec(many.slice(0, 200))).valid).toBe(true);
  });
});

describe("validateSpec: choropleth", () => {
  const spec = (data: Record<string, unknown>[], options: Record<string, unknown> = {}) => ({ type: "choropleth", data, encoding: { region: "country", value: "rate" }, options });
  const issues = (s: unknown, lang: "en" | "ko" = "en") => {
    const v = validateSpec(s, { lang });
    return [...v.errors.map((e) => `E ${e.code}: ${e.message}`), ...v.warnings.map((w) => `W ${w.code}: ${w.message}`)];
  };

  it("names rows that match no region, with the closest name, and the last duplicate", () => {
    expect(issues(spec([row("Germny", 1), row("France", 2), row("Atlantis", 3), row("France", 4)]))).toEqual([
      'W region_unmatched: 2 regions match nothing on the map and are left out: "Germny" (did you mean "Germany"?), "Atlantis"',
      'W region_duplicate: More than one row matches "France". The last row is drawn',
    ]);
  });

  it("says when a map is not registered, unknown, or not a map", () => {
    expect(issues(spec(choroplethSample, { map: "wrld" }))).toEqual(['E unknown_map: There is no map "wrld". Did you mean "world"? Maps: "world", "us-states", "kr-sido", or pass a GeoJSON FeatureCollection']);
    expect(withoutMaps(() => issues(spec(choroplethSample, { map: "us-states" })))).toEqual(['E map_not_loaded: The "us-states" map is not registered. Register it before drawing: import { usStates } from "ztd-charts/geo/us-states"; registerMap(usStates)']);
    expect(withoutMaps(() => issues(spec(choroplethSample)))[0]).toMatch(/^E map_not_loaded: No map is registered/);
    expect(issues(spec(choroplethSample, { map: 42 }))[0]).toMatch(/^E bad_map:/);
  });

  it("checks a custom GeoJSON: no shapes, skipped features, coordinates out of range, duplicate ids", () => {
    const fc = (features: unknown[]) => ({ type: "FeatureCollection", features });
    const poly = (id: string, lat = 50) => ({ type: "Feature", properties: { zone: id }, geometry: { type: "Polygon", coordinates: [[[0, lat], [1, lat], [1, lat + 1], [0, lat]]] } });
    const zs = (options: Record<string, unknown>) => ({ type: "choropleth", data: [{ zone: "a", v: 1 }], encoding: { region: "zone", value: "v" }, options: { featureId: "zone", ...options } });
    expect(issues(zs({ map: fc([]) }))).toEqual(["E map_empty: The GeoJSON has no Polygon or MultiPolygon feature with coordinates to draw"]);
    const wide = { type: "Feature", properties: { zone: "b" }, geometry: { type: "Polygon", coordinates: [[[178, 10], [190, 10], [190, 11], [178, 10]]] } };
    expect(issues(zs({ map: fc([poly("a"), { type: "Feature", geometry: null }, poly("a"), wide]) }))).toEqual([
      "W map_feature_skipped: 1 feature has no Polygon or MultiPolygon to draw and is left out (features[1])",
      "W map_out_of_range: 2 coordinates are outside longitude -180 to 180 or latitude -90 to 90. GeoJSON must be in longitude and latitude degrees (EPSG:4326), not projected meters. Latitudes are clamped and longitudes wrapped",
      'W map_duplicate_id: More than one feature has the id "a". Rows match the first one. Set options.featureId to a property that is unique',
    ]);
  });

  it("warns about rows outside the focus, Antarctica, merged Korean regions and a highlight that is not on the map", () => {
    expect(issues(spec([row("Germany", 1), row("Japan", 2)], { focus: "europe" }))).toEqual(['W region_outside_map: "Japan" is not drawn on this map (outside options.focus "europe"), so it is left out']);
    expect(issues(spec([row("Antarctica", 1)]))[0]).toMatch(/^W region_outside_map: "Antarctica" is not drawn on this map \(Antarctica is left out/);
    expect(issues({ type: "choropleth", data: [{ s: "광주", v: 1 }, { s: "서울", v: 2 }], encoding: { region: "s", value: "v" } })[0]).toMatch(/^W region_merged: "광주" is left out: Gwangju and Jeollanam-do merged/);
    expect(issues(spec(choroplethSample, { highlight: "Narnia" }))).toEqual(['W highlight_not_found: Could not find a region named "Narnia" to highlight']);
    expect(issues(spec(choroplethSample, { map: "us-states", focus: "europe" }))).toContain("W focus_unsupported: options.focus works on the world map only, so it is not used here");
  });

  it("the example and the Korean example are clean, and the tile map's Korean variant too", () => {
    const def = CHARTS.find((c) => c.type === "choropleth")!;
    expect(issues(def.example)).toEqual([]);
    expect(issues({ type: "choropleth", data: tileMapSample, encoding: { region: "sido", value: "rate" } }, "ko")).toEqual([]);
  });
});
