import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { Chart, autoLegend, encodingToProps, facetPropsOf, resolveDef, specFacet } from "../charts/Chart";
import { FACET_GAP, FACET_LEGEND_H, FACET_ROW_GAP, FACET_TITLE_H, FACET_TITLE_SIZE, planFacets, type FacetInput } from "../core/facet";
import { CARD_INSET, CARD_TEXT } from "../components/ChartCard";
import { ThemeProvider, makePainter, resolveThemeInput } from "../theme/context";
import { baseCss } from "../core/css";
import { legendFill } from "../core/palette";
import { DEFAULT_LOCALE } from "../core/format";
import { langOf, type ChartLang } from "../core/i18n";
import { textWidth, truncate } from "../core/text";
import { fetchChartData, readResponse } from "../data/useChartData";
import { themeToCss, type ChartTheme } from "../theme/tokens";
import { levelBadge } from "../spec/labels";
import { capChartSize, nameIn, specLocale, type ChartMeta } from "../spec/meta";
import { inlineRows, validateSpec } from "../spec/validate";
import type { ChartSpec, SpecFacet } from "../spec/types";
import { registerMap } from "../geo/registry";
import { krSido } from "../geo/kr-sido";
import { usStates } from "../geo/us-states";
import { world } from "../geo/world";

// On the server, every built-in map is registered up front: renderSpecToSVG, the CLI and MCP draw "map": "world" with no setup (not included in the browser bundle)
registerMap(world, usStates, krSido);

export interface RenderOptions {
  /** Total width (px). Default 720 */
  width?: number;
  /** Chart height (px). The chart's default when omitted */
  height?: number;
  /** "dark" (default) | "light" | a token object */
  theme?: "dark" | "light" | Partial<ChartTheme>;
  /** Also draws the card frame (number, title, legend, summary, badge). Default: true when spec.card is set */
  frame?: boolean;
  /** Outer margin (px). Default 24 */
  padding?: number;
  /** Paints the page background color. Default true */
  background?: boolean;
  /**
   * Locale for chart and card text, number format and error messages. "ko" or "ko-*" gives Korean; anything else English.
   * When omitted, the spec's options.locale; failing that, "en-US"
   */
  locale?: string;
}

/** Spec validation. Throws with the collected reasons when invalid */
/** Only { csv } data becomes pre-parsed rows (validation and rendering share the rows, so the CSV is parsed once). Validation reads other shapes directly */
function csvRows(data: unknown): Record<string, unknown>[] | undefined {
  return typeof (data as { csv?: unknown } | null)?.csv === "string" ? (inlineRows(data) ?? undefined) : undefined;
}

function assertValid(spec: ChartSpec, lang: ChartLang, rows?: Record<string, unknown>[]) {
  const v = validateSpec(spec, { lang, rows });
  if (!v.valid) throw new Error(`${lang === "ko" ? "스펙 오류" : "Invalid spec"}: ${v.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Fetches { url } data and returns the spec with it turned into an array of rows. locale is the language of error messages.
 * When fetcher is given, it is used instead of fetch (the CLI passes a fetch with time and size limits)
 */
export async function resolveSpecData(spec: ChartSpec, init?: RequestInit, locale?: string, fetcher?: (url: string) => Promise<Response>): Promise<ChartSpec> {
  const inline = inlineRows(spec.data);
  if (inline) return { ...spec, data: inline };
  const d = spec.data as { url?: string; format?: "json" | "csv" | "auto"; select?: string };
  if (d && typeof d.url === "string") {
    const url = d.url;
    const parse = d.format ?? "auto";
    const rows = await fetchChartData(fetcher ? async () => readResponse(await fetcher(url), parse, url, locale) : url, { parse, select: d.select, init, locale });
    return { ...spec, data: rows as Record<string, unknown>[] };
  }
  return spec;
}

function chartMarkup(spec: ChartSpec, width: number, height: number | undefined, theme: ChartTheme, cssVars: boolean, withCard: boolean, locale: string | undefined): string {
  const s: ChartSpec = withCard ? spec : { ...spec, card: undefined };
  return renderToStaticMarkup(createElement(ThemeProvider, { theme, cssVars }, createElement(Chart, { spec: s, width, height, animate: false, locale })));
}

/** Wraps lines word by word to fit within max width (a longer word gets a line of its own). Kept separate because wrapLines truncates a long word (a source URL) with an ellipsis and drops the rest */
function wrapWords(s: string, max: number, size: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of s.split(/\s+/)) {
    const next = line ? `${line} ${w}` : w;
    if (line && textWidth(next, size) > max) {
      out.push(line);
      line = w;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** Inner markup and viewBox size of each chart svg (class="ztd-svg") in the markup. Small multiples have one per panel. The closing tag is found by counting pairs, nested svgs included */
function extractPanels(markup: string): { inner: string; vw: number; vh: number }[] {
  const out: { inner: string; vw: number; vh: number }[] = [];
  const open = /<svg\b[^>]*class="ztd-svg"[^>]*>/g;
  const tag = /<svg\b|<\/svg>/g;
  for (let m = open.exec(markup); m; m = open.exec(markup)) {
    let depth = 1;
    let t: RegExpExecArray | null = null;
    tag.lastIndex = open.lastIndex;
    while (depth && (t = tag.exec(markup))) depth += t[0] === "</svg>" ? -1 : 1;
    if (!t) break;
    const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(m[0]);
    out.push({ inner: markup.slice(open.lastIndex, t.index), vw: vb ? Number(vb[1]) : 0, vh: vb ? Number(vb[2]) : 0 });
    open.lastIndex = tag.lastIndex;
  }
  return out;
}

/**
 * Small multiples (spec.facet) as an SVG fragment: places the panel title rows and panel charts with the same layout as the browser's <ChartFacets> (planFacets).
 * Panel charts are taken from markup rendered in one pass, so gradient and clip ids do not collide across panels. at(x, y) is the markup drawn at that position
 */
function facetBody(spec: ChartSpec, facet: SpecFacet, def: ChartMeta, rows: Record<string, unknown>[], width: number, height: number | undefined, theme: ChartTheme, locale: string | undefined, T: Record<keyof ChartTheme, string>): { height: number; at: (x: number, y: number) => string } {
  const type = def.type;
  const markup = chartMarkup({ ...spec, data: rows }, width, height, theme, false, false, locale);
  const panels = extractPanels(markup);
  // The legend shared by all panels (FacetPlan.legend) appears once at the top right of the grid, as in the browser
  const legend = /<svg class="ztd-facet-legend" width="([\d.]+)" height="([\d.]+)"[^>]*>([\s\S]*?)<\/svg>/.exec(markup);
  const top = legend ? FACET_LEGEND_H : 0;
  const loc = locale ?? DEFAULT_LOCALE;
  // Same order as the chart props <Chart> builds: channels, options, rows, width (height) props, locale
  const chartProps = { ...encodingToProps(def, spec.encoding), ...(spec.options ?? {}), data: rows, width, ...(height !== undefined ? { height } : {}), locale };
  const plan = planFacets({ ...facetPropsOf(type, facet, chartProps), width, locale: loc, lang: langOf(loc) } as FacetInput);
  const rowsN = Math.ceil(plan.panels.length / plan.cols);
  const at = (ox: number, oy: number) =>
    (legend ? `<svg x="${ox + width - Number(legend[1])}" y="${oy}" width="${legend[1]}" height="${legend[2]}" overflow="visible">${legend[3]}</svg>` : "") +
    plan.panels
      .map((pn, i) => {
        const x = ox + (i % plan.cols) * (plan.pw + FACET_GAP);
        const y = oy + top + Math.floor(i / plan.cols) * (FACET_TITLE_H + plan.ph + FACET_ROW_GAP);
        const fill = pn.isPicked ? T.accentText : plan.isPanelPick ? T.muted : T.ink;
        const lastW = pn.last !== undefined ? textWidth(pn.last, FACET_TITLE_SIZE, 700) + 8 : 0;
        const svg = panels[i];
        const text = (tx: number, s: string, end?: boolean) => `<text x="${tx}" y="${y + 14}"${end ? ' text-anchor="end"' : ""} font-size="${FACET_TITLE_SIZE}" font-weight="700" fill="${fill}">${esc(s)}</text>`;
        return (
          `<g data-facet="${esc(pn.value)}">` +
          text(x, truncate(pn.label, plan.pw - lastW, FACET_TITLE_SIZE, 700)) +
          (pn.last !== undefined ? text(x + plan.pw, pn.last, true) : "") +
          (svg ? `<svg x="${x}" y="${y + FACET_TITLE_H}" width="${plan.pw}" height="${plan.ph}" viewBox="0 0 ${svg.vw || plan.pw} ${svg.vh || plan.ph}" overflow="visible">${svg.inner}</svg>` : "") +
          `</g>`
        );
      })
      .join("");
  return { height: top + rowsN * (FACET_TITLE_H + plan.ph) + Math.max(0, rowsN - 1) * FACET_ROW_GAP, at };
}

/** One chart svg. The closing tag is found by counting pairs, so it does not run on into icon svgs inside HTML buttons outside the chart (the bar race's play button) */
function extractSvg(markup: string): { inner: string; vw: number; vh: number } | null {
  const panel = extractPanels(markup)[0];
  if (panel) return panel;
  const m = /<svg([^>]*)>([\s\S]*)<\/svg>/.exec(markup);
  if (!m) return null;
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(m[1]);
  return { inner: m[2], vw: vb ? Number(vb[1]) : 0, vh: vb ? Number(vb[2]) : 0 };
}

/** Upper limit of the padding render option (px) */
const MAX_PADDING = 200;

/**
 * Per-side limit of a standalone SVG document (px). One side of a chart is at most MAX_CHART_SIZE (10,000), but the document can be larger: small multiples with 24 cells, one per row (up to about 240,800px),
 * charts that grow with the data (a row per horizontal bar), long legends and note lines. Above 250,000px, which even the largest small multiples stay under,
 * the viewBox stays as is and only width and height shrink proportionally, so the whole drawing fits at a smaller size. Below that, the output is the same text as before
 */
export const MAX_DOCUMENT_SIZE = 250_000;

/** The start of the outer <svg> opening tag (size and viewBox). The caller appends the closing ">" and the other attributes */
function svgOpen(W: number, H: number): string {
  const k = Math.min(1, MAX_DOCUMENT_SIZE / Math.max(W, H));
  const fit = (v: number) => (k < 1 ? Math.max(1, Math.floor(v * k)) : v);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fit(W)}" height="${fit(H)}" viewBox="0 0 ${W} ${H}"`;
}

/** A spec as a standalone SVG string. PNG conversion (resvg) uses it as is */
export function renderSpecToSVG(spec: ChartSpec, opts: RenderOptions = {}): string {
  const locale = specLocale(spec, opts.locale);
  const lang = langOf(locale);
  const csv = csvRows(spec.data);
  assertValid(spec, lang, csv);
  // { url } data is not fetched here (this is a synchronous function). Drawn as is, only the loading state would remain
  const rows = csv ?? inlineRows(spec.data);
  if (!rows) throw new Error(lang === "ko" ? "data.url 데이터는 먼저 가져와야 해요. renderSpecToSVG(await resolveSpecData(spec))처럼 resolveSpecData를 먼저 불러 주세요" : "data.url must be fetched first. Call resolveSpecData, as in renderSpecToSVG(await resolveSpecData(spec))");
  const theme = resolveThemeInput((opts.theme ?? (spec.theme as never)) || "dark");
  // Theme values inserted into the strings below are all escaped (even an unvalidated opts.theme cannot break out of an attribute)
  const T = Object.fromEntries(Object.entries(theme).map(([k, v]) => [k, esc(v)])) as Record<keyof ChartTheme, string>;
  // Render option sizes are taken unvalidated and reduced to MAX_CHART_SIZE per side (validateSpec guards the spec's options.width and height)
  const W = capChartSize(Math.max(160, Math.round(opts.width ?? 720)));
  const optH = capChartSize(opts.height);
  // Sizes that go into attributes are numbers only (so a string is never pasted in as is). Padding is also taken unvalidated and capped at MAX_PADDING
  const pad = Math.min(MAX_PADDING, Number(opts.padding ?? 24) || 0);
  const frame = opts.frame ?? !!spec.card;
  const card = spec.card ?? {};
  const def = resolveDef(spec.type, spec.encoding, spec.options);
  const inner = frame ? W - pad * 2 - 40 : W - pad * 2;
  // Small multiples (spec.facet) are a fragment with panels laid out in a grid. Without facet, the output is the same text as before
  const facet = def ? specFacet(spec, def.type) : undefined;
  const grid = facet && def ? facetBody(spec, facet, def, rows, inner, optH, theme, locale, T) : null;
  // Pass rows so { csv } is parsed only once
  const svg = grid ? { inner: "", vw: inner, vh: grid.height } : extractSvg(chartMarkup({ ...spec, data: rows }, inner, optH, theme, false, false, locale));
  if (!svg) throw new Error(lang === "ko" ? "차트 SVG를 만들지 못했어요" : "Couldn't build the chart SVG");
  const chartH = svg.vh || Number(optH) || 240;
  const font = theme.fontFamily.replace(/"/g, "'");
  const mono = theme.monoFamily.replace(/"/g, "'");
  const body = (x: number, y: number) => (grid ? grid.at(x, y) : `<svg x="${x}" y="${y}" width="${inner}" height="${chartH}" viewBox="0 0 ${svg.vw || inner} ${chartH}" overflow="visible">${svg.inner}</svg>`);

  if (!frame) {
    const H = Math.round(chartH + pad * 2);
    return `${svgOpen(W, H)} font-family="${esc(font)}" color="${T.ink}">${opts.background === false ? "" : `<rect width="${W}" height="${H}" fill="${T.panel}"/>`}${body(pad, pad)}</svg>`;
  }

  // Card frame
  const cx0 = pad;
  const cy0 = pad;
  const cw = W - pad * 2;
  const ip = 20;
  let y = cy0 + ip;
  const parts: string[] = [];
  const title = card.title ?? (def ? nameIn(def, lang) : spec.type);
  const num = card.number ? `${card.number}` : "";
  const numW = num ? textWidth(num, 17, 700) + 10 : 0;
  parts.push(`<text x="${cx0 + ip}" y="${y + 18}" font-family="${esc(mono)}" font-size="17" font-weight="700" fill="${T.accentText}">${esc(num)}</text>`);
  // The card.accent word in the title gets the accent color. Every piece goes in a tspan (emoji removal for PNG looks at each piece)
  const at = card.accent ? title.indexOf(card.accent) : -1;
  const titleBody = at < 0 || !card.accent ? esc(title) : `<tspan>${esc(title.slice(0, at))}</tspan><tspan fill="${T.accentText}">${esc(card.accent)}</tspan><tspan>${esc(title.slice(at + card.accent.length))}</tspan>`;
  parts.push(`<text x="${cx0 + ip + numW}" y="${y + 19}" font-size="22" font-weight="800" letter-spacing="-0.5" fill="${T.ink}">${titleBody}</text>`);
  y += 30;
  // A toggleable legend (toggle) is the same as "auto" in an image (hidden series drop out of the chart and the legend)
  const legend = card.legend === "auto" || card.legend === "toggle" ? autoLegend(spec, rows, locale ?? DEFAULT_LOCALE) : card.legend ?? [];
  if (card.subtitle || legend.length) {
    parts.push(`<text x="${cx0 + ip}" y="${y + 12}" font-size="12.5" fill="${T.muted}">${esc(card.subtitle ?? "")}</text>`);
    // Like the browser card, the legend wraps and aligns right: each item is a 9px swatch + 6px + text, 12px between items, 18px between lines.
    // If it fits on one line beside the subtitle, it goes on the subtitle line; otherwise it starts on the line below the subtitle
    const lineMax = cw - ip * 2;
    const items = legend.map((it) => {
      const label = truncate(it.label, lineMax - 15, 11.5);
      const tw = textWidth(label, 11.5);
      return { it, label, tw, w: 15 + tw };
    });
    const lineW = (line: typeof items) => line.reduce((s, x) => s + x.w, 0) + Math.max(0, line.length - 1) * 12;
    const lines: (typeof items)[] = [];
    for (const item of items) {
      const last = lines[lines.length - 1];
      if (last && lineW(last) + 12 + item.w <= lineMax) last.push(item);
      else lines.push([item]);
    }
    const subW = card.subtitle ? textWidth(card.subtitle, 12.5) : 0;
    const besideSubtitle = lines.length === 1 && (!card.subtitle || subW + 12 + lineW(lines[0]) <= lineMax);
    const paint = makePainter(theme, false);
    let ly = besideSubtitle || !card.subtitle ? y : y + 18;
    for (const line of lines) {
      // Each line is laid out from the right edge leftward (a one-line legend keeps the same coordinates and order as before)
      let lx = cx0 + cw - ip;
      for (const { it, label, tw } of [...line].reverse()) {
        lx -= tw;
        parts.push(`<text x="${lx}" y="${ly + 12}" font-size="11.5" fill="${T.muted}">${esc(label)}</text>`);
        lx -= 15;
        // Only token names ("accent") become theme colors (so a name like "constructor" cannot pull out an object property). Mixed colors ("mix:ratio") match the chart marks.
        // This painter uses no CSS variables, so legendFill returns the same theme color as raw
        const col = esc(legendFill(paint, it.color));
        if (it.shape === "line" || it.shape === "dash") parts.push(`<line x1="${lx - 2}" x2="${lx + 11}" y1="${ly + 8}" y2="${ly + 8}" stroke="${col}" stroke-width="2"${it.shape === "dash" ? ' stroke-dasharray="3 2"' : ""}/><circle cx="${lx + 4.5}" cy="${ly + 8}" r="2.2" fill="${col}"/>`);
        // A circle rounds its corners up to the full radius, as in the browser card legend
        else parts.push(`<rect x="${lx}" y="${ly + 3.5}" width="9" height="9" rx="${it.shape === "circle" ? 4.5 : 2.5}" fill="${col}"${it.color === "neutral" || !it.color ? ` stroke="${T.line2}"` : ""}/>`);
        lx -= 12;
      }
      ly += 18;
    }
    // 8px below the last legend line (the subtitle line when there is no legend)
    y = ly + 8;
  }
  y += 6;
  const chartY = y;
  y += chartH + 14;
  // Source line: "Source: <source> · <note>", wrapped word by word to the card width (17px between lines)
  const sourceLine = [card.source ? `${CARD_TEXT[lang].source}: ${card.source}` : "", card.note ?? ""].filter(Boolean).join(" · ");
  if (sourceLine) {
    const lines = wrapWords(sourceLine, cw - ip * 2, 12);
    lines.forEach((l, i) => parts.push(`<text x="${cx0 + ip}" y="${y + 12 + 17 * i}" font-size="12" fill="${T.muted}">${esc(l)}</text>`));
    y += 17 * lines.length + 10;
  }
  const hasFooter = !!(card.takeaway || card.level || card.sample);
  if (hasFooter) {
    parts.push(`<text x="${cx0 + ip}" y="${y + 17}" font-size="17" font-weight="800" letter-spacing="-0.3" fill="${T.ink}">${esc(card.takeaway ?? "")}</text>`);
    let bx = cx0 + cw - ip;
    if (card.level) {
      const b = levelBadge(card.level, lang);
      const bw = textWidth(b.text, 12.5, 700) + 18;
      bx -= bw;
      parts.push(`<rect x="${bx}" y="${y + 1}" width="${bw}" height="24" rx="8" fill="${T[b.bg]}"/><text x="${bx + bw / 2}" y="${y + 17.5}" text-anchor="middle" font-size="12.5" font-weight="700" fill="${T[b.fg]}">${esc(b.text)}</text>`);
      bx -= 8;
    }
    if (card.sample) {
      const t = typeof card.sample === "string" ? card.sample : CARD_TEXT[lang].sample;
      parts.push(`<text x="${bx}" y="${y + 17}" text-anchor="end" font-size="11.5" fill="${T.muted}">${esc(t)}</text>`);
    }
    y += 30;
  }
  y += 12;
  const ch = y - cy0;
  const H = Math.round(ch + pad * 2);
  return (
    `${svgOpen(W, H)} font-family="${esc(font)}" color="${T.ink}">` +
    (opts.background === false ? "" : `<rect width="${W}" height="${H}" fill="${T.bg}"/>`) +
    `<rect x="${cx0 + 0.5}" y="${cy0 + 0.5}" width="${cw - 1}" height="${ch - 1}" rx="${T.radius}" fill="${T.panel}" stroke="${T.line}"/>` +
    parts.join("") +
    body(cx0 + ip, chartY) +
    `</svg>`
  );
}

export interface HTMLOptions extends RenderOptions {
  /** Document title */
  title?: string;
  /**
   * Makes the chart interactive in the browser. Static SSR only when omitted.
   * `{ script }`: code that hydrates the server-drawn chart in place (the CLI embeds React and that one chart). No flicker, and no network needed except for fonts.
   * `{ libraryUrl }`: the older way. Clears and redraws from the ztd-charts ESM bundle URL (or a data: URL).
   */
  interactive?: { script: string } | { libraryUrl: string; reactVersion?: string } | false;
}

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** An HTML document holding the server-rendered card and chart */
export function renderSpecToHTML(spec: ChartSpec, opts: HTMLOptions = {}): string {
  const locale = specLocale(spec, opts.locale);
  const lang = langOf(locale);
  assertValid(spec, lang);
  const theme = resolveThemeInput((opts.theme ?? (spec.theme as never)) || "dark");
  const W = capChartSize(Math.max(240, Math.round(opts.width ?? 720)));
  const optH = capChartSize(opts.height);
  const withCard = opts.frame ?? true;
  // Static HTML has no script, so the replay and download buttons would do nothing when pressed. So the buttons are drawn only when interactive
  // A toggleable legend also needs the script, so static HTML draws it as "auto"
  const shown = withCard ? (opts.interactive || !spec.card ? spec : { ...spec, card: { ...spec.card, replay: false, download: undefined, ...(spec.card.legend === "toggle" ? { legend: "auto" as const } : {}) } }) : { ...spec, card: undefined };
  const hydrate = opts.interactive && "script" in opts.interactive ? opts.interactive.script : null;
  if (hydrate !== null && /<\/script|<!--/i.test(hydrate)) throw new Error(lang === "ko" ? "interactive.script에는 </script나 <!--가 들어갈 수 없어요" : "interactive.script must not contain </script or <!--");
  // A chart to be hydrated is drawn at .wrap's content width (W). The browser's first paint uses the same width, so the drawing does not shift (renderToStaticMarkup output cannot be hydrated).
  // Small multiples set their cell count from that width in static HTML too (without the script they cannot measure again)
  const def = resolveDef(spec.type, spec.encoding, spec.options);
  const isFacet = !!def && !!specFacet(spec, def.type);
  const width = (hydrate !== null || isFacet) && spec.options?.width === undefined ? W - (shown.card ? CARD_INSET : 0) : undefined;
  const tree = createElement(ThemeProvider, { theme, cssVars: true }, createElement(Chart, { spec: shown, width, height: optH, animate: false, locale }));
  const markup = hydrate !== null ? renderToString(tree) : renderToStaticMarkup(tree);
  const title = opts.title ?? spec.card?.title ?? (def ? nameIn(def, lang) : "Chart");
  const legacy = opts.interactive && "libraryUrl" in opts.interactive ? opts.interactive : null;
  const rv = legacy?.reactVersion ?? "19";
  const script = hydrate !== null
    ? `<script type="application/json" id="ztd-chart-config">${json({ spec: shown, theme, width, height: optH, locale })}</script>
<script type="module">${hydrate}</script>`
    : legacy
    ? `<script type="importmap">${JSON.stringify({ imports: { react: `https://esm.sh/react@${rv}`, "react/jsx-runtime": `https://esm.sh/react@${rv}/jsx-runtime`, "react-dom/client": `https://esm.sh/react-dom@${rv}/client?deps=react@${rv}`, "ztd-charts": legacy.libraryUrl } })}</script>
<script type="module">
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { Chart, ThemeProvider } from "ztd-charts";
const spec = ${json(withCard ? spec : { ...spec, card: undefined })};
const el = document.getElementById("chart");
el.innerHTML = "";
createRoot(el).render(h(ThemeProvider, { theme: ${json(theme)} }, h(Chart, { spec${optH ? `, height: ${optH}` : ""}${locale ? `, locale: ${json(locale)}` : ""} })));
</script>`
    : "";
  return `<!doctype html>
<html lang="${esc(locale ?? DEFAULT_LOCALE)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
<style>
${themeToCss(theme)}
html,body{margin:0;background:var(--ztd-bg);color:var(--ztd-ink);font-family:var(--ztd-font)}
.wrap{max-width:${W}px;margin:32px auto;padding:0 16px}
${baseCss}
</style>
</head>
<body>
<main class="wrap"><div id="chart">${markup}</div></main>
${script}
</body>
</html>
`;
}

export { registerMap, registeredMaps, mapExportName } from "../geo/registry";
export { specMapName } from "../geo/spec";
export { validateSpec } from "../spec/validate";
export { resolveDef } from "../charts/Chart";
export { langOf, plural, type ChartLang } from "../core/i18n";
export { DEFAULT_LOCALE } from "../core/format";
export { specSchema, schemaFor } from "../spec/schema";
export { MAX_CHART_SIZE } from "../spec/meta";
export { CHARTS, getChartDef } from "../spec/registry";
export { suggestCharts } from "../spec/suggest";
export type { ChartSpec } from "../spec/types";
