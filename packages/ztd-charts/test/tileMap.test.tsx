import type { KeyboardEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chart } from "../src/charts/Chart";
import { TileMap } from "../src/charts/tileMap";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { textWidth } from "../src/core/text";
import { resolveGrid, tileMatcher, tileNeighbor } from "../src/layout/tileGrid";
import { renderSpecToSVG } from "../src/server";
import { CHARTS, validateSpec } from "../src/spec";
import { tileMapSample, tileMapSampleKo, tileMapUsSample } from "../src/spec/samples";
import { ThemeProvider } from "../src/theme/context";

/** Same harness as histogram.test.tsx: active sets the picked tile, spy records setActive calls. frame is the last ChartFrame props */
const state = vi.hoisted(() => ({
  active: null as number | null,
  via: "pointer" as "pointer" | "keyboard",
  spy: false,
  calls: [] as [number | null, string | undefined][],
  frame: null as unknown,
  delays: [] as number[],
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

vi.mock("../src/core/useMotion", async (orig) => {
  const actual = await orig<typeof import("../src/core/useMotion")>();
  return {
    ...actual,
    useMotion: (marks: { delay?: number }[], o: never) => {
      state.delays = marks.map((m) => m.delay ?? 0);
      return actual.useMotion(marks as never, o);
    },
  };
});

afterEach(() => {
  state.active = null;
  state.via = "pointer";
  state.spy = false;
  state.calls = [];
  state.frame = null;
  state.delays = [];
});

const r = (el: ReactElement) => renderToStaticMarkup(el);
const frame = () => state.frame as ChartFrameProps<unknown>;
/** Tile text (weight 500 or more). The names at both legend ends have weight 400, so they are left out */
const texts = (h: string) => [...h.matchAll(/<text [^>]*font-weight="(\d+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ weight: +m[1], text: m[2] })).filter((t) => t.weight >= 500);
const sido = (name: string, rate: number) => ({ sido: name, rate });
const draw = (data: Record<string, unknown>[], extra: Record<string, unknown> = {}) => r(<TileMap data={data} region="sido" value="rate" unit="%" width={480} animate={false} {...extra} />);

describe("tile grids", () => {
  it("kr-sido has 16 tiles and kr-sido-2025 has 17, never two on one cell", () => {
    for (const [name, count] of [["kr-sido", 16], ["kr-sido-2025", 17]] as const) {
      const grid = resolveGrid(name)!;
      expect(grid, name).toHaveLength(count);
      expect(new Set(grid.map((t) => `${t.row},${t.col}`)).size, name).toBe(count);
    }
    const at = (name: string, id: string) => resolveGrid(name)!.find((t) => t.id === id);
    expect(at("kr-sido", "Jeonnam-Gwangju")).toMatchObject({ row: 3, col: 0, labelKo: "전남광주" });
    expect(at("kr-sido", "Jeju")).toMatchObject({ row: 4, col: 0 });
    expect(at("kr-sido", "Gwangju")).toBeUndefined();
    expect(at("kr-sido-2025", "Gwangju")).toMatchObject({ row: 3, col: 0 });
    expect(at("kr-sido-2025", "Busan")).toMatchObject({ row: 3, col: 3 });
    expect(at("kr-sido-2025", "Jeju")).toMatchObject({ row: 4, col: 1 });
    expect(at("kr-sido-2025", "Jeonnam-Gwangju")).toBeUndefined();
  });

  it("names match by short and full Korean name, older name, English name and ISO code, ignoring case and spaces", () => {
    const grid = resolveGrid("kr-sido")!;
    const match = tileMatcher(grid);
    const id = (name: string) => grid[match(name)]?.id;
    expect(["서울", "서울특별시", "Seoul", " seoul ", "KR-11", "kr-11"].map(id)).toEqual(Array(6).fill("Seoul"));
    expect(["강원", "강원특별자치도", "강원도", "Gangwon", "KR-51", "KR-42"].map(id)).toEqual(Array(6).fill("Gangwon"));
    expect(["전북", "전북특별자치도", "전라북도", "Jeollabuk-do", "KR-52", "KR-45"].map(id)).toEqual(Array(6).fill("Jeonbuk"));
    expect(["전남광주", "전남광주통합특별시", "jeonnam-gwangju"].map(id)).toEqual(Array(3).fill("Jeonnam-Gwangju"));
    // After the merge the grid has no separate Gwangju or Jeonnam tile. "광주시", which clashes with Gwangju-si in Gyeonggi-do, is not accepted
    expect(["광주", "전남", "Atlantis"].map(match)).toEqual([-1, -1, -1]);
    expect(tileMatcher(resolveGrid("kr-sido-2025")!)("광주시")).toBe(-1);
  });

  it("arrow keys go to the nearest tile in that direction, skipping empty cells", () => {
    const custom = resolveGrid([
      { id: "A", row: 0, col: 0 },
      { id: "B", row: 0, col: 2 },
      { id: "C", row: 1, col: 1 },
    ])!;
    // Right from A: skips the empty cell (0, 1) to B
    expect(custom[tileNeighbor(custom, 0, "ArrowRight")].id).toBe("B");
    expect(tileNeighbor(custom, 1, "ArrowRight")).toBe(-1);
    const grid = resolveGrid("kr-sido")!;
    const go = (from: string, key: string) => grid[tileNeighbor(grid, grid.findIndex((t) => t.id === from), key)]?.id;
    // Right of Busan is an empty cell, so Ulsan one row up; right of Jeju is Gyeongnam; below Busan (only empty cells) there is nothing
    expect([go("Busan", "ArrowRight"), go("Jeju", "ArrowRight"), go("Jeju", "ArrowUp"), go("Busan", "ArrowDown")]).toEqual(["Ulsan", "Gyeongnam", "Jeonnam-Gwangju", undefined]);
  });
});

describe("TileMap", () => {
  it("highlights the highest tile by default, with a strong outline and bold name", () => {
    const h = draw(tileMapSample);
    const outlines = h.match(/fill="none" stroke="var\(--ztd-ink[^"]*\)" stroke-width="2"/g) ?? [];
    expect(outlines).toHaveLength(1);
    // Names are normally 600, only the highlighted tile's name is 700 (values are 700, the highlighted tile's value 800)
    const boldNames = (html: string) => texts(html).filter((t) => t.weight === 700 && !/\d/.test(t.text)).map((t) => t.text);
    expect(boldNames(h)).toEqual(["Sejong"]);
    expect(texts(h).filter((t) => t.weight === 800).map((t) => t.text)).toEqual(["98"]);
    expect(boldNames(draw(tileMapSample, { highlight: "제주" }))).toEqual(["Jeju"]);
    expect(draw(tileMapSample, { highlight: "none" })).not.toMatch(/stroke-width="2"/);
  });

  it("rank text is the same in the table, the live sentence and the tooltip, ordered by value", () => {
    state.active = 0;
    state.via = "keyboard";
    const h = draw(tileMapSample);
    const ev = frame().events;
    expect(ev.slice(0, 2).map((e) => `${e.label}: ${e.formatted}`)).toEqual(["Sejong: 98%, 1 of 16", "Seoul: 96%, 2 of 16"]);
    expect(ev.at(-1)!.formatted).toBe("64%, 16 of 16");
    expect(frame().announce).toBe("Sejong: 98%, 1 of 16");
    expect(h).toContain("<th scope=\"row\">Sejong</th><td>98%, 1 of 16</td>");
    expect(frame().tip!.rows.map((row) => `${row.label}=${row.value}`)).toEqual(["Value=98%", "Rank=1 of 16"]);
    expect(frame().description).toBe("Tile map. 16 regions with data. Highest Sejong 98%, lowest Jeju 64%, mean 83.4%.");
    r(<TileMap data={tileMapSampleKo} region="sido" value="rate" unit="%" width={480} animate={false} locale="ko" />);
    expect(frame().events[0].formatted).toBe("98%, 16곳 중 1위");
  });

  it("region names follow the language of the data, unless labels sets one", () => {
    const ko = [sido("서울", 5), sido("부산광역시", 3), sido("전남광주", 1)];
    const names = (extra: Record<string, unknown> = {}, data: Record<string, unknown>[] = ko) => (draw(data, extra), frame().events.slice(0, 3).map((e) => e.label));
    // Even without a locale (en-US), Korean data gets Korean names. Numbers and the rest of the text follow the locale (English)
    expect(names()).toEqual(["서울", "부산", "전남광주"]);
    expect(frame().description).toMatch(/^Tile map\. 3 regions with data\. Highest 서울 5%/);
    expect(frame().events[0].formatted).toBe("5%, 1 of 3");
    expect(names({ labels: "en" })).toEqual(["Seoul", "Busan", "Jeonnam-Gwangju"]);
    const en = [sido("Seoul", 5), sido("Busan", 3), sido("Jeju", 1)];
    expect([names({}, en), names({ locale: "ko" }, en), names({ labels: "ko" }, en)]).toEqual([["Seoul", "Busan", "Jeju"], ["서울", "부산", "제주"], ["서울", "부산", "제주"]]);
    // A custom grid uses its own label
    expect(names({ labels: "ko", map: [{ id: "CA", label: "California", row: 0, col: 0 }] }, [sido("CA", 1)])[0]).toBe("California");
  });

  it("with no spread, max and min highlight nothing and the description says every value is the same", () => {
    const flat = ["Seoul", "Busan", "Jeju"].map((s) => sido(s, 0));
    expect(draw(flat)).not.toMatch(/stroke-width="2"/);
    expect(frame().description).toBe("Tile map. 3 regions with data, all at the same value, 0%. 13 regions without data.");
    expect(draw(flat, { highlight: "min" })).not.toMatch(/stroke-width="2"/);
    // A highlight set by name still applies
    expect(texts(draw(flat, { highlight: "Busan" })).filter((t) => t.weight === 700 && !/\d/.test(t.text)).map((t) => t.text)).toEqual(["Busan"]);
  });

  it("long values step down to the locale's short form, then drop, and never pass the tile's inner width", () => {
    const big = tileMapSample.map((d, i) => sido(d.sido, i % 2 ? 3_400_000_000 : 1_200_000_000));
    const values = (h: string) => [...h.matchAll(/<text [^>]*font-size="([\d.]+)"[^>]*font-weight="(?:700|800)"[^>]*>([^<]*\d[^<]*)<\/text>/g)].map((m) => ({ size: +m[1], text: m[2] }));
    const at = (width: number, extra: Record<string, unknown> = {}) => values(r(<TileMap data={big} region="sido" value="rate" width={width} animate={false} {...extra} />));
    // 720px: tile width 98.4 (102.4 across minus a 4 gap). Chrome draws numbers wider than the estimate, so 1.1 times the estimate must fit with 4px on each side
    const wide = at(720);
    expect(wide).toHaveLength(16);
    for (const v of wide) expect(textWidth(v.text, v.size, 700) * 1.1, v.text).toBeLessThanOrEqual(98.4 - 8);
    // 400px: the full number does not fit, so the short form (English "1.2B", Korean "12억").
    // With format set, values are dropped instead of shortened. The table always has the full number
    expect(new Set(at(400).map((v) => v.text))).toEqual(new Set(["1.2B", "3.4B"]));
    expect(new Set(at(400, { locale: "ko" }).map((v) => v.text))).toEqual(new Set(["12억", "34억"]));
    expect(at(400, { format: "number" })).toEqual([]);
    expect(frame().events[0].formatted).toBe("3,400,000,000, 1 of 16");
  });

  it("tiles without a row are empty, named only and announced as no data", () => {
    const h = draw([sido("Seoul", 10), sido("Busan", 5)]);
    const ev = frame().events;
    expect(ev).toHaveLength(16);
    expect(ev.slice(0, 2).map((e) => e.formatted)).toEqual(["10%, 1 of 2", "5%, 2 of 2"]);
    expect(ev[2]).toMatchObject({ label: "Incheon", value: null, formatted: "No data" });
    expect(frame().description).toContain("14 regions without data");
    // Empty tiles show only the name: the text is 16 names and 2 values
    expect(texts(h)).toHaveLength(16 + 2);
  });

  it("Home and End jump to the highest and lowest tile, arrows move on the map", async () => {
    const { ChartFrame: RealFrame } = await vi.importActual<typeof import("../src/core/ChartFrame")>("../src/core/ChartFrame");
    state.spy = true;
    state.active = 0;
    state.via = "keyboard";
    draw([sido("Seoul", 10), sido("Busan", 5), sido("Ulsan", 1)]);
    let root: ReactElement<{ onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void }> | null = null;
    function Probe() {
      root = RealFrame(frame());
      return root;
    }
    r(<Probe />);
    const self = {};
    const press = (key: string) => root!.props.onKeyDown({ key, target: self, currentTarget: self, preventDefault() {} } as never);
    press("End");
    press("Home");
    // Right of Seoul (row 0, column 1) is Gyeonggi. Gyeonggi has no data, so its place in the reading order comes after the 3 tiles with values
    press("ArrowRight");
    const ev = frame().events;
    expect(state.calls.map(([i, via]) => `${i === null ? "-" : ev[i].label}/${via}`)).toEqual(["Ulsan/keyboard", "Seoul/keyboard", "Gyeonggi/keyboard"]);
  });

  it("at a 390px card the names still fit, and a narrow card drops values before names", () => {
    const names = (h: string) => texts(h).filter((t) => !/\d/.test(t.text));
    const values = (h: string) => texts(h).filter((t) => /\d/.test(t.text));
    for (const [data, locale] of [[tileMapSample, "en"], [tileMapSampleKo, "ko"]] as const) {
      const card = r(<TileMap data={data} region="sido" value="rate" width={326} animate={false} locale={locale} />);
      expect(names(card).every((t) => !t.text.includes("…") && t.text !== ""), locale).toBe(true);
      expect(values(card), locale).toHaveLength(16);
    }
    // When narrow, one decision for the whole chart: if not all names fit, neither names nor values are written (so it never ends with just a few tiles labeled)
    const narrow = r(<TileMap data={tileMapSampleKo} region="sido" value="rate" width={150} animate={false} locale="ko" />);
    expect(values(narrow)).toHaveLength(0);
    expect([0, 16]).toContain(names(narrow).length);
    for (const width of [280, 330, 390, 480, 720]) {
      const us = r(<TileMap data={tileMapUsSample} region="state" value="rate" width={width} animate={false} />);
      expect([0, 51], String(width)).toContain(names(us).length);
      expect([0, 51], String(width)).toContain(values(us).length);
    }
  });

  it('"auto" picks the grid from the data: US states by postal code, FIPS or name, Korean regions as before', () => {
    const us = [{ s: "CA", v: 3 }, { s: 36, v: 2 }, { s: "texas", v: 1 }];
    const h = r(<TileMap data={us} region="s" value="v" width={720} animate={false} />);
    expect(frame().events).toHaveLength(51);
    expect(frame().events.slice(0, 3).map((e) => e.label)).toEqual(["California", "New York", "Texas"]);
    // Tiles show the postal abbreviation; the tooltip and the table use the name
    expect(texts(h).map((t) => t.text)).toContain("CA");
    expect(h).toContain('<th scope="row">California</th>');
    // Korean province data still gets the old default, kr-sido, and data with only a misspelled Korean name still gets the Korean grid
    r(<TileMap data={tileMapSampleKo} region="sido" value="rate" width={480} animate={false} />);
    expect(frame().events).toHaveLength(16);
    r(<TileMap data={[sido("부산광역", 1)]} region="sido" value="rate" width={480} animate={false} />);
    expect(frame().events).toEqual([]);
    expect(resolveGrid("us-states")).toHaveLength(51);
  });

  it("the entrance spread is bounded for the 51-tile US grid and unchanged for the 16-tile Korean grid", () => {
    r(<TileMap data={tileMapUsSample} region="state" value="rate" width={480} />);
    expect(state.delays).toHaveLength(51);
    expect(Math.max(...state.delays)).toBeLessThanOrEqual(480);
    expect(Math.max(...state.delays)).toBeGreaterThan(400);
    draw(tileMapSample);
    // On the 4-column grid it is still cell order × 28ms (Jeju is last: row 4, column 0 → 16 × 28)
    expect(Math.max(...state.delays)).toBe(448);
    expect(state.delays.every((d) => Number.isInteger(d / 28))).toBe(true);
  });

  it("the server SVG and the browser chart draw the same geometry", () => {
    const def = CHARTS.find((c) => c.type === "tileMap")!;
    const geometry = (s: string) => [...s.matchAll(/ (d|x|y|width|height)="([-\d.,MLHVACZ ]+)"/g)].map((m) => `${m[1]}=${m[2]}`).join(" ");
    const server = renderSpecToSVG(def.example, { width: 640 + 48, frame: false, theme: "light" });
    const browser = r(
      <ThemeProvider theme="light">
        <Chart spec={{ ...def.example, card: undefined }} width={640} animate={false} />
      </ThemeProvider>,
    );
    const body = /<svg[^>]*class="ztd-svg"[^>]*>([\s\S]*?)<\/svg>/.exec(browser)![1];
    expect(geometry(body).length).toBeGreaterThan(500);
    const inner = server.slice(server.indexOf('<svg x="'));
    expect(geometry(inner).replace(/^x=\S+ y=\S+ width=\S+ height=\S+ /, "")).toBe(geometry(body));
  });
});

describe("validateSpec: tileMap", () => {
  const spec = (data: Record<string, unknown>[], options: Record<string, unknown> = {}) => ({ type: "tileMap", data, encoding: { region: "sido", value: "rate" }, options });
  const issues = (s: unknown, lang: "en" | "ko" = "en") => {
    const v = validateSpec(s, { lang });
    return [...v.errors.map((e) => `E ${e.code}: ${e.message}`), ...v.warnings.map((w) => `W ${w.code}: ${w.message}`)];
  };

  it("the example and its aliases validate cleanly", () => {
    expect(issues(CHARTS.find((c) => c.type === "tileMap")!.example)).toEqual([]);
    expect(issues({ ...spec(tileMapSample), type: "cartogram" })).toEqual(['W alias: "cartogram" is drawn as "tileMap"']);
  });

  it("warns about rows that match no tile, with the closest name", () => {
    expect(issues(spec([sido("Seul", 1), sido("서울", 2), sido("Atlantis", 3)]))).toEqual(['W tile_unmatched: 2 regions match no tile and are left out: "Seul" (did you mean "Seoul"?), "Atlantis"']);
    expect(issues(spec([sido("부산광역", 1)]), "ko")).toEqual(['W tile_unmatched: 타일에 맞지 않는 지역 1개는 빼고 그려요: "부산광역"("부산광역시"인가요?)']);
  });

  it("points data with Gwangju and Jeonnam as separate regions to kr-sido-2025", () => {
    const old = [sido("광주", 1), sido("전라남도", 2), sido("서울", 3)];
    const [w] = issues(spec(old));
    expect(w).toMatch(/^W tile_merged_region: "광주", "전라남도" are drawn as no data: .*2026-07-01.*options\.map "kr-sido-2025"$/);
    expect(issues(spec(old, { map: "kr-sido-2025" }))).toEqual([]);
  });

  it("checks custom grids: duplicate cells and ids are errors, unknown names get a suggestion", () => {
    const grid = [
      { id: "CA", label: "California", row: 0, col: 0, aliases: ["Calif."] },
      { id: "NV", row: 0, col: 1 },
    ];
    expect(issues(spec([sido("Calif.", 1), sido("nv", 2)], { map: grid }))).toEqual([]);
    expect(issues(spec([sido("CA", 1)], { map: [...grid, { id: "OR", row: 0, col: 1 }] }))).toEqual(['E duplicate_tile_cell: Tiles "NV" and "OR" are both on row 0, col 1']);
    expect(issues(spec([sido("CA", 1)], { map: [...grid, { id: "ca", row: 2, col: 0 }] }))).toEqual(['E duplicate_tile_id: Tile id "ca" is used twice']);
    expect(issues(spec([sido("CA", 1)], { map: [{ id: "CA", row: -1, col: 0 }] }))[0]).toMatch(/^E bad_tile: /);
    expect(issues(spec([sido("CA", 1)], { map: "kr-sdio" }))[0]).toMatch(/^E unknown_tile_map: There is no tile grid "kr-sdio"\. Did you mean "kr-sido"\?/);
  });
});
