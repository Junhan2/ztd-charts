import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Chart } from "../src/charts/Chart";
import { renderSpecToSVG } from "../src/server";
import type { ChartSpec } from "../src/spec/types";
import { darkTheme, lightTheme } from "../src/theme/tokens";

/**
 * The card legend's colors (card.legend "auto") must match the color the chart paints each series with.
 * With 5 or 6 series the middle series are painted with mixed steps (midSwatch), and area (ramp), stream (layer order) and the highlight-only mode (emphasis) use colors other than categorical.
 * The legend colors and the drawn colors are compared in both themes on the server SVG (markup with the theme colors written in)
 */
const THEMES = ["light", "dark"] as const;
const COUNTS = [5, 6];
const names = (n: number) => Array.from({ length: n }, (_, i) => `S${i + 1}`);
const render = (spec: ChartSpec, theme: (typeof THEMES)[number]) => renderSpecToSVG({ ...spec, card: { title: "t", legend: "auto" } }, { width: 640, theme });
const attr = (el: string, a: string) => new RegExp(`\\s${a}="([^"]+)"`).exec(el)?.[1];
const tags = (body: string, tag: string) => [...body.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))].map((m) => m[0]);
const painted = (c?: string): c is string => !!c && c !== "none" && c !== "transparent";
/** Card background color (dot borders, line outlines, empty cells). It is not a series color, so it is left out */
const PANEL = { light: lightTheme.panel, dark: darkTheme.panel };
/** Legend (label → color) and chart body. The server legend places items from the right on each line, so it is read by pairing each item with its label */
function parts(svg: string) {
  const at = svg.indexOf("<svg x=");
  const legend = new Map([...svg.slice(0, at).matchAll(/<text [^>]*>([^<]*)<\/text>(?:<rect [^>]*fill="([^"]+)"|<line [^>]*stroke="([^"]+)")/g)].map((m) => [m[1], m[2] ?? m[3]]));
  return { legend, body: svg.slice(at) };
}
/** Fills of painted paths in drawing order (series order for a single-category bar, pie and marimekko) */
const pathFills = (body: string) => tags(body, "path").map((e) => attr(e, "fill")).filter(painted);
/** Chart body with only that series drawn, the rest hidden (colors are still assigned over all series) */
const only = (spec: ChartSpec, nm: string, all: string[], theme: (typeof THEMES)[number]) => parts(render({ ...spec, options: { ...spec.options, hidden: all.filter((x) => x !== nm) } }, theme)).body;

/** Whether the legend colors match the drawn colors in both themes, with 5 and 6 series. drawn gives the drawn colors in series order */
function expectSame(make: (all: string[]) => ChartSpec, drawn: (spec: ChartSpec, all: string[], theme: (typeof THEMES)[number], body: string) => (string | undefined)[]) {
  for (const n of COUNTS)
    for (const theme of THEMES) {
      const all = names(n);
      const spec = make(all);
      const { legend, body } = parts(render(spec, theme));
      expect(all.map((s) => legend.get(s)), `${theme} n=${n}`).toEqual(drawn(spec, all, theme, body));
    }
}

describe("card legend color = drawn color (5 and 6 series, both themes)", () => {
  it("bar: stacked, grouped, 100%, line over bars, small multiples. The browser card legend uses the same colors", () => {
    const one = (all: string[]) => all.map((s, i) => ({ x: "A", s, v: 10 + i, goal: 20 }));
    for (const options of [{ layout: "stacked" }, { layout: "grouped" }, { layout: "percent", highlight: "none" }]) expectSame((all) => ({ type: "bar", data: one(all), encoding: { x: "x", y: "v", series: "s" }, options }), (_s, all, _t, body) => pathFills(body).slice(0, all.length));
    expectSame((all) => ({ type: "bar", data: one(all), encoding: { x: "x", y: "v", series: "s", line: "goal" } }), (_s, all, _t, body) => pathFills(body).slice(0, all.length));
    expectSame((all) => ({ type: "bar", data: ["P", "Q"].flatMap((f) => one(all).map((r) => ({ ...r, f }))), encoding: { x: "x", y: "v", series: "s" }, facet: { by: "f" }, options: { layout: "stacked" } }), (_s, all, _t, body) => pathFills(body).slice(0, all.length));
    // Browser card: the legend swatch background and the segment path fill are the same text (CSS variables, color-mix)
    const html = renderToStaticMarkup(<Chart spec={{ type: "bar", data: one(names(6)), encoding: { x: "x", y: "v", series: "s" }, options: { layout: "stacked" }, card: { title: "t", legend: "auto" } }} width={640} animate={false} />).replace(/&quot;/g, '"');
    const swatches = [...html.matchAll(/<span aria-hidden="true" style="[^"]*background:([^;"]+)/g)].map((m) => m[1].trim());
    const fills = [...html.matchAll(/<path d="M[^"]+" fill="([^"]+)" stroke=/g)].map((m) => m[1]).slice(0, 6);
    expect(swatches).toEqual(fills);
    expect(new Set(fills).size).toBe(6);
  });
  it("area (default ramp, colorMode categorical) and colorMode categorical line", () => {
    const rows = (all: string[]) => ["A", "B", "C"].flatMap((x, k) => all.map((s, i) => ({ x, s, v: 10 + i * 3 + k })));
    const areaFill = (body: string) => pathFills(body)[0];
    const lineStroke = (body: string, theme: (typeof THEMES)[number]) => tags(body, "path").filter((e) => attr(e, "fill") === "none").map((e) => attr(e, "stroke")).find((s) => painted(s) && s !== PANEL[theme]);
    for (const options of [{}, { stack: "none" }, { colorMode: "categorical" }]) expectSame((all) => ({ type: "area", data: rows(all), encoding: { x: "x", y: "v", series: "s" }, options }), (spec, all, theme) => all.map((nm) => areaFill(only(spec, nm, all, theme))));
    expectSame((all) => ({ type: "line", data: rows(all), encoding: { x: "x", y: "v", series: "s" }, options: { colorMode: "categorical" } }), (spec, all, theme) => all.map((nm) => lineStroke(only(spec, nm, all, theme), theme)));
  });
  it("stream: the same down to layer order (inside-out) and default highlight (the series with the largest total)", () => {
    // Each series is a band of a different thickness, so the thickness order tells which series a layer belongs to
    const rows = (all: string[]) => ["A", "B", "C", "D"].flatMap((x) => all.map((s, i) => ({ x, s, v: 10 * (i + 1) })));
    const thick = (d: string) => {
      const ys = [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => +m[2]);
      return Math.max(...ys) - Math.min(...ys);
    };
    for (const options of [{}, { reorder: false }]) expectSame((all) => ({ type: "stream", data: rows(all), encoding: { x: "x", y: "v", series: "s" }, options }), (_s, all, _t, body) => tags(body, "path").filter((e) => painted(attr(e, "fill"))).map((e) => ({ f: attr(e, "fill"), t: thick(attr(e, "d")!) })).sort((a, b) => a.t - b.t).map((l) => l.f).slice(0, all.length));
  });
  it("pie and donut: categorical, and colorMode emphasis, which paints only the highlight", () => {
    for (const type of ["pie", "donut"]) for (const colorMode of [undefined, "emphasis"]) expectSame((all) => ({ type, data: all.map((label, i) => ({ label, value: 40 - i * 3 })), encoding: { label: "label", value: "value" }, options: { ...(type === "donut" && { legend: "none" }), ...(colorMode && { colorMode }) } }), (_s, all, _t, body) => pathFills(body).slice(0, all.length));
  });
  it("waffle", () => {
    expectSame((all) => ({ type: "waffle", data: all.map((label, i) => ({ label, value: 40 - i * 3 })), encoding: { label: "label", value: "value" } }), (_s, all, theme, body) => [...new Set(tags(body, "rect").map((e) => attr(e, "fill")).filter((f) => painted(f) && f !== PANEL[theme]))].slice(0, all.length));
  });
  it("semicircle waffle (dots, starting from the left group)", () => {
    expectSame((all) => ({ type: "waffle", data: all.map((label, i) => ({ label, value: 40 - i * 3 })), encoding: { label: "label", value: "value" }, options: { shape: "arc" } }), (_s, all, theme, body) => [...new Set(tags(body, "circle").map((e) => attr(e, "fill")).filter((f) => painted(f) && f !== PANEL[theme]))].slice(0, all.length));
  });
  it("marimekko", () => {
    expectSame((all) => ({ type: "marimekko", data: all.map((s, i) => ({ x: "A", s, v: 10 + i })), encoding: { x: "x", series: "s", value: "v" } }), (_s, all, _t, body) => pathFills(body).slice(0, all.length));
  });
  it("scatter with series (dots use categoricalDots, which goes one lighter step further)", () => {
    const pts = (all: string[]) => all.flatMap((s, i) => [0, 1, 2].map((k) => ({ x: k + i, y: k * 2 + i, s })));
    const dot = (body: string, theme: (typeof THEMES)[number]) => tags(body, "circle").map((e) => attr(e, "fill")).find((f) => painted(f) && f !== PANEL[theme]);
    expectSame((all) => ({ type: "scatter", data: pts(all), encoding: { x: "x", y: "y", series: "s" } }), (spec, all, theme) => all.map((nm) => dot(only(spec, nm, all, theme), theme)));
  });
});
