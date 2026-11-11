import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Chart } from "../src/charts/Chart";
import { renderSpecToSVG } from "../src/server";
import type { ChartSpec } from "../src/spec/types";
import { darkTheme, lightTheme } from "../src/theme/tokens";

/**
 * 카드 범례(card.legend "auto")의 색은 계열마다 차트가 그 계열을 칠한 색과 같아야 해요.
 * 계열이 5개, 6개면 중간 계열이 섞은 단계(midSwatch)로 칠해지고, 영역(ramp), 스트림(층 순서), 강조만 칠하는 모드(emphasis)는 categorical과 다른 색을 써요.
 * 서버 SVG(테마 색이 그대로 든 글자)로 두 테마에서 범례 색과 그린 색을 견줘요
 */
const THEMES = ["light", "dark"] as const;
const COUNTS = [5, 6];
const names = (n: number) => Array.from({ length: n }, (_, i) => `S${i + 1}`);
const render = (spec: ChartSpec, theme: (typeof THEMES)[number]) => renderSpecToSVG({ ...spec, card: { title: "t", legend: "auto" } }, { width: 640, theme });
const attr = (el: string, a: string) => new RegExp(`\\s${a}="([^"]+)"`).exec(el)?.[1];
const tags = (body: string, tag: string) => [...body.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))].map((m) => m[0]);
const painted = (c?: string): c is string => !!c && c !== "none" && c !== "transparent";
/** 카드 바탕색 (점 테두리, 선 외곽, 빈 칸). 계열 색이 아니라서 빼요 */
const PANEL = { light: lightTheme.panel, dark: darkTheme.panel };
/** 범례(이름표 → 색)와 차트 몸통. 서버 범례는 줄마다 오른쪽부터 놓아서 이름표와 짝지어 읽어요 */
function parts(svg: string) {
  const at = svg.indexOf("<svg x=");
  const legend = new Map([...svg.slice(0, at).matchAll(/<text [^>]*>([^<]*)<\/text>(?:<rect [^>]*fill="([^"]+)"|<line [^>]*stroke="([^"]+)")/g)].map((m) => [m[1], m[2] ?? m[3]]));
  return { legend, body: svg.slice(at) };
}
/** 칠한 path의 fill을 그린 순서대로 (범주 하나인 막대, 파이, 마리메코는 계열 순서) */
const pathFills = (body: string) => tags(body, "path").map((e) => attr(e, "fill")).filter(painted);
/** 나머지 계열을 숨겨 그 계열 하나만 그린 몸통 (숨겨도 색은 모든 계열로 정해요) */
const only = (spec: ChartSpec, nm: string, all: string[], theme: (typeof THEMES)[number]) => parts(render({ ...spec, options: { ...spec.options, hidden: all.filter((x) => x !== nm) } }, theme)).body;

/** 두 테마, 계열 5개와 6개에서 범례 색이 그린 색과 같은지. drawn은 계열 순서의 그린 색 */
function expectSame(make: (all: string[]) => ChartSpec, drawn: (spec: ChartSpec, all: string[], theme: (typeof THEMES)[number], body: string) => (string | undefined)[]) {
  for (const n of COUNTS)
    for (const theme of THEMES) {
      const all = names(n);
      const spec = make(all);
      const { legend, body } = parts(render(spec, theme));
      expect(all.map((s) => legend.get(s)), `${theme} n=${n}`).toEqual(drawn(spec, all, theme, body));
    }
}

describe("카드 범례 색 = 그린 색 (계열 5, 6개, 두 테마)", () => {
  it("막대: 쌓은, 묶은, 100%, 막대 위 선, 작은 여러 개. 브라우저 카드 범례도 같은 색이에요", () => {
    const one = (all: string[]) => all.map((s, i) => ({ x: "A", s, v: 10 + i, goal: 20 }));
    for (const options of [{ layout: "stacked" }, { layout: "grouped" }, { layout: "percent", highlight: "none" }]) expectSame((all) => ({ type: "bar", data: one(all), encoding: { x: "x", y: "v", series: "s" }, options }), (_s, all, _t, body) => pathFills(body).slice(0, all.length));
    expectSame((all) => ({ type: "bar", data: one(all), encoding: { x: "x", y: "v", series: "s", line: "goal" } }), (_s, all, _t, body) => pathFills(body).slice(0, all.length));
    expectSame((all) => ({ type: "bar", data: ["P", "Q"].flatMap((f) => one(all).map((r) => ({ ...r, f }))), encoding: { x: "x", y: "v", series: "s" }, facet: { by: "f" }, options: { layout: "stacked" } }), (_s, all, _t, body) => pathFills(body).slice(0, all.length));
    // 브라우저 카드: 범례 색 칸의 background와 조각 path의 fill이 같은 글자(CSS 변수, color-mix)예요
    const html = renderToStaticMarkup(<Chart spec={{ type: "bar", data: one(names(6)), encoding: { x: "x", y: "v", series: "s" }, options: { layout: "stacked" }, card: { title: "t", legend: "auto" } }} width={640} animate={false} />).replace(/&quot;/g, '"');
    const swatches = [...html.matchAll(/<span aria-hidden="true" style="[^"]*background:([^;"]+)/g)].map((m) => m[1].trim());
    const fills = [...html.matchAll(/<path d="M[^"]+" fill="([^"]+)" stroke=/g)].map((m) => m[1]).slice(0, 6);
    expect(swatches).toEqual(fills);
    expect(new Set(fills).size).toBe(6);
  });
  it("영역(기본 ramp, colorMode categorical)과 colorMode categorical 라인", () => {
    const rows = (all: string[]) => ["A", "B", "C"].flatMap((x, k) => all.map((s, i) => ({ x, s, v: 10 + i * 3 + k })));
    const areaFill = (body: string) => pathFills(body)[0];
    const lineStroke = (body: string, theme: (typeof THEMES)[number]) => tags(body, "path").filter((e) => attr(e, "fill") === "none").map((e) => attr(e, "stroke")).find((s) => painted(s) && s !== PANEL[theme]);
    for (const options of [{}, { stack: "none" }, { colorMode: "categorical" }]) expectSame((all) => ({ type: "area", data: rows(all), encoding: { x: "x", y: "v", series: "s" }, options }), (spec, all, theme) => all.map((nm) => areaFill(only(spec, nm, all, theme))));
    expectSame((all) => ({ type: "line", data: rows(all), encoding: { x: "x", y: "v", series: "s" }, options: { colorMode: "categorical" } }), (spec, all, theme) => all.map((nm) => lineStroke(only(spec, nm, all, theme), theme)));
  });
  it("스트림: 층 순서(inside-out)와 기본 강조(합이 가장 큰 계열)까지 같아요", () => {
    // 계열마다 두께가 다른 띠: 두께 순서로 어느 계열의 층인지 알아요
    const rows = (all: string[]) => ["A", "B", "C", "D"].flatMap((x) => all.map((s, i) => ({ x, s, v: 10 * (i + 1) })));
    const thick = (d: string) => {
      const ys = [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => +m[2]);
      return Math.max(...ys) - Math.min(...ys);
    };
    for (const options of [{}, { reorder: false }]) expectSame((all) => ({ type: "stream", data: rows(all), encoding: { x: "x", y: "v", series: "s" }, options }), (_s, all, _t, body) => tags(body, "path").filter((e) => painted(attr(e, "fill"))).map((e) => ({ f: attr(e, "fill"), t: thick(attr(e, "d")!) })).sort((a, b) => a.t - b.t).map((l) => l.f).slice(0, all.length));
  });
  it("파이와 도넛: categorical과 강조만 칠하는 colorMode emphasis", () => {
    for (const type of ["pie", "donut"]) for (const colorMode of [undefined, "emphasis"]) expectSame((all) => ({ type, data: all.map((label, i) => ({ label, value: 40 - i * 3 })), encoding: { label: "label", value: "value" }, options: { ...(type === "donut" && { legend: "none" }), ...(colorMode && { colorMode }) } }), (_s, all, _t, body) => pathFills(body).slice(0, all.length));
  });
  it("와플", () => {
    expectSame((all) => ({ type: "waffle", data: all.map((label, i) => ({ label, value: 40 - i * 3 })), encoding: { label: "label", value: "value" } }), (_s, all, theme, body) => [...new Set(tags(body, "rect").map((e) => attr(e, "fill")).filter((f) => painted(f) && f !== PANEL[theme]))].slice(0, all.length));
  });
  it("반원 와플 (점, 왼쪽 묶음부터)", () => {
    expectSame((all) => ({ type: "waffle", data: all.map((label, i) => ({ label, value: 40 - i * 3 })), encoding: { label: "label", value: "value" }, options: { shape: "arc" } }), (_s, all, theme, body) => [...new Set(tags(body, "circle").map((e) => attr(e, "fill")).filter((f) => painted(f) && f !== PANEL[theme]))].slice(0, all.length));
  });
  it("마리메코", () => {
    expectSame((all) => ({ type: "marimekko", data: all.map((s, i) => ({ x: "A", s, v: 10 + i })), encoding: { x: "x", series: "s", value: "v" } }), (_s, all, _t, body) => pathFills(body).slice(0, all.length));
  });
  it("계열이 있는 산점도 (점은 한 칸 옅은 단계까지 쓰는 categoricalDots)", () => {
    const pts = (all: string[]) => all.flatMap((s, i) => [0, 1, 2].map((k) => ({ x: k + i, y: k * 2 + i, s })));
    const dot = (body: string, theme: (typeof THEMES)[number]) => tags(body, "circle").map((e) => attr(e, "fill")).find((f) => painted(f) && f !== PANEL[theme]);
    expectSame((all) => ({ type: "scatter", data: pts(all), encoding: { x: "x", y: "y", series: "s" } }), (spec, all, theme) => all.map((nm) => dot(only(spec, nm, all, theme), theme)));
  });
});
