import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { CHARTS, commonOptionsIn, downloadFields, FACET_TYPES, findGroup, findLevel, getChartDef, localizeDef, schemaForIn, specLocale, specSchemaIn, specTemplate, suggestCharts, validateSpec, variantsIn, type ChartDef, type ChartSpec, type JSONSchema, type Suggestion, type ValidationResult, TYPE_ALIASES } from "ztd-charts/spec";
import { inlineRows, normalizeData, parseCSV } from "ztd-charts/spec";
import { langOf, mapExportName, renderSpecToHTML, renderSpecToSVG, resolveDef, resolveSpecData, specMapName } from "ztd-charts/server";
import { CLI_TEXT, type CliText } from "./messages";

const require = createRequire(import.meta.url);

export type { ChartSpec, ValidationResult, Suggestion, ChartDef, JSONSchema };

export interface ChartSummary {
  type: string;
  component: string;
  name: string;
  nameEn: string;
  level: string;
  group: string;
  summary: string;
  useWhen: string;
  avoidWhen: string;
  encoding: { name: string; required: boolean; type: string; description: string }[];
}

export function summarize(def: ChartDef): ChartSummary {
  return {
    type: def.type,
    component: def.component,
    name: def.name,
    nameEn: def.nameEn,
    level: def.level,
    group: def.group,
    summary: def.summary,
    useWhen: def.useWhen,
    avoidWhen: def.avoidWhen,
    encoding: def.encoding.map((c) => ({ name: c.name, required: c.required, type: c.multi ? `${c.type} | ${c.type}[]` : c.type, description: c.description })),
  };
}

/**
 * Chart list. Filters group and level by id ("flow", "basic") or by English or Korean name ("흐름", "기본").
 * With locale "ko", names and descriptions are in Korean; English by default
 */
export function listCharts(filter: { group?: string; level?: string; locale?: string } = {}): ChartSummary[] {
  const group = filter.group ? findGroup(filter.group)?.id ?? filter.group : undefined;
  const level = filter.level ? findLevel(filter.level)?.id ?? filter.level : undefined;
  const lang = langOf(filter.locale);
  return CHARTS.filter((c) => (!group || c.group === group) && (!level || c.level === level)).map((c) => summarize(localizeDef(c, lang)));
}

export function resolveType(type: string): ChartDef | undefined {
  return getChartDef(type) ?? getChartDef(TYPE_ALIASES[type] ?? "");
}

/** Unknown chart error */
function unknownChart(type: string, locale?: string): Error {
  return new Error(CLI_TEXT[langOf(locale)].unknownChart(type));
}

/** JSON Schema for all charts or for one chart. With locale "ko", descriptions are in Korean */
export function getChartSchema(type?: string, locale?: string): JSONSchema {
  const lang = langOf(locale);
  if (!type) return specSchemaIn(lang);
  const def = resolveType(type);
  if (!def) throw unknownChart(type, locale);
  return schemaForIn(def.type, lang)!;
}

/** One chart's description, schema, example and React code. With locale "ko", the text and example are in Korean */
export function getChartInfo(type: string, locale?: string) {
  const found = resolveType(type);
  if (!found) throw unknownChart(type, locale);
  const lang = langOf(locale);
  const def = localizeDef(found, lang);
  return {
    ...summarize(def),
    why: def.why,
    options: [...def.options, ...commonOptionsIn(lang)].map((o) => ({ name: o.name, type: o.enum ? o.enum.map((e) => JSON.stringify(e)).join(" | ") : o.type, default: o.default, description: o.description })),
    schema: schemaForIn(def.type, lang),
    example: def.example,
    react: reactSnippet(def.example, { locale }),
    /** Named variants: options laid over the example's options, plus encoding for variants that add fields, such as a range band (ztd-charts example <type> --variant <id>) */
    variants: variantsIn(def.type, lang),
  };
}

/** Validates a spec. With locale "ko", messages are in Korean */
export function validate(spec: unknown, locale?: string): ValidationResult {
  return validateSpec(spec, { lang: langOf(locale) });
}

/**
 * JSX attribute value. Quoted JSX attributes have no escapes such as \" and &amp; is decoded to a character,
 * so only strings that can be used as is go in "…"; everything else goes in as {"…"}
 */
function jsxValue(v: unknown): string {
  const j = JSON.stringify(v);
  return typeof v === "string" && j === `"${v}"` && !v.includes("&") ? j : `{${j}}`;
}

/** Only option keys that are valid JSX attribute names (characters such as spaces would break the code) */
const JSX_NAME = /^[A-Za-z_$][\w$-]*$/;

/** Chart props (JSX attribute text, the first one is data) as <ChartFacets> code. ChartFacets takes highlight and data; the rest go in the chartProps object */
function facetElement(component: string, type: string, facet: NonNullable<ChartSpec["facet"]>, props: string[]): string {
  const own: string[] = [props[0]];
  const fields: string[] = [];
  for (const p of props.slice(1)) {
    const at = p.indexOf("=");
    const name = p.slice(0, at);
    const value = p.slice(at + 1);
    if (name === "highlight") own.push(p);
    // JSX attribute value ("text" or {expression}, both made by jsxValue) as an object value (expression). A name with a - is quoted
    else fields.push(`${/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)}: ${value.startsWith("{") ? value.slice(1, -1) : value}`);
  }
  // The spec is untrusted input, so facet values also go through jsxValue only, like other props. columns only when a positive integer, scale only when one of the two values (otherwise left out of the code)
  const { columns, scale } = facet as { columns?: unknown; scale?: unknown };
  const head = [
    `chart={${component}}`,
    `type=${jsxValue(type)}`,
    own[0],
    `by=${jsxValue(facet.by)}`,
    ...(Number.isInteger(columns) && (columns as number) >= 1 ? [`columns=${jsxValue(columns)}`] : []),
    ...(scale === "shared" || scale === "free" ? [`scale=${jsxValue(scale)}`] : []),
    ...own.slice(1),
  ];
  return `<ChartFacets ${head.join(" ")} chartProps={{ ${fields.join(", ")} }} />`;
}

/** A spec as React code (using the component directly). With locale "ko", the comments are in Korean */
export function reactSnippet(spec: ChartSpec, opts: { dataVar?: string; inlineData?: boolean; locale?: string } = {}): string {
  const ko = langOf(opts.locale) === "ko";
  const def = resolveType(spec.type);
  if (!def) return "";
  const rows = Array.isArray(spec.data) ? spec.data : null;
  const dataVar = opts.dataVar ?? "data";
  const props: string[] = [`data={${dataVar}}`];
  for (const c of def.encoding) {
    const v = spec.encoding?.[c.name];
    if (v !== undefined) props.push(`${c.prop ?? c.name}=${jsxValue(v)}`);
  }
  // The spec's tooltip template goes to the component as a templateTooltip(…) function (the component ignores a plain object)
  const template = specTemplate(spec);
  const tipLocale = specLocale(spec);
  // For a map chart's built-in map, pass the map imported from its entry point instead of the name (it draws without registerMap)
  const geo = specMapName(spec);
  for (const [k, v] of Object.entries(spec.options ?? {})) {
    if (!JSX_NAME.test(k) || (geo && k === "map")) continue;
    if (k === "tooltip" && template) props.push(`tooltip={templateTooltip(${JSON.stringify(template)}${tipLocale ? `, ${JSON.stringify(tipLocale)}` : ""})}`);
    else props.push(`${k}=${jsxValue(v)}`);
  }
  if (geo) props.push(`map={${mapExportName(geo)}}`);
  // Small multiples (spec.facet): <ChartFacets> draws one chart per cell for each by value. highlight picks the panel; other props go to every panel through chartProps
  // Diverging bars (layout "diverging") are not drawn as small multiples (the validator reports an error)
  const facet = spec.facet && typeof spec.facet.by === "string" && FACET_TYPES.includes(def.type) && !(def.type === "bar" && spec.options?.layout === "diverging") ? spec.facet : undefined;
  const chartEl = facet ? facetElement(def.component, def.type, facet, props) : `<${def.component} ${props.join(" ")} />`;
  const card = spec.card;
  const imports = [card && "ChartCard", card?.download && "DownloadButtons", facet && "ChartFacets", def.component, template && "templateTooltip"].filter(Boolean).join(", ");
  const more = rows && rows.length > 12 ? (ko ? ` // 외 ${rows.length - 12}행` : ` // and ${rows.length - 12} more rows`) : "";
  const dataLine = rows && opts.inlineData !== false ? `const ${dataVar} = ${JSON.stringify(rows.slice(0, 12), null, 2)}${more};\n\n` : `// ${dataVar}: ${ko ? "객체 배열 (REST, CSV, DB 행 등)" : "an array of objects (REST, CSV, database rows and so on)"}\n`;
  let body = chartEl;
  if (card) {
    const cp: string[] = [];
    for (const k of ["number", "title", "subtitle", "takeaway", "level", "source", "note", "accent"] as const) if (card[k]) cp.push(`${k}=${jsxValue(card[k])}`);
    if (Array.isArray(card.legend)) cp.push(`legend=${jsxValue(card.legend)}`);
    if (card.download) {
      // Only the columns the chart draws go into the CSV, as with <Chart spec>
      const cols = downloadFields(spec);
      const dp = [`data={${dataVar}}`, cols.length ? `columns=${jsxValue(cols)}` : "", card.title ? `filename=${jsxValue(card.title)}` : "", Array.isArray(card.download) ? `formats=${jsxValue(card.download)}` : ""];
      cp.push(`actions={<DownloadButtons ${dp.filter(Boolean).join(" ")} />}`);
    }
    cp.push("replay");
    body = `<ChartCard ${cp.join(" ")}>\n      ${chartEl}\n    </ChartCard>`;
  }
  const geoLine = geo ? `import { ${mapExportName(geo)} } from "ztd-charts/geo/${geo}";\n` : "";
  return `import { ${imports} } from "ztd-charts";\n${geoLine}\n${dataLine}export function ${def.component}Example() {\n  return (\n    ${body}\n  );\n}\n`;
}

/** React code that uses the spec as is. The ChartSpec annotation keeps values such as card.legend: "auto" from widening to string, so it compiles in TS as is */
export function specSnippet(spec: ChartSpec): string {
  // A map chart registers the map it draws once (options.map's "world" and "auto" look up registered maps)
  const geo = specMapName(spec);
  const name = geo && mapExportName(geo);
  const head = geo ? `import { Chart, registerMap, type ChartSpec } from "ztd-charts";\nimport { ${name} } from "ztd-charts/geo/${geo}";\n\nregisterMap(${name});\n` : `import { Chart, type ChartSpec } from "ztd-charts";\n`;
  return `${head}\nconst spec: ChartSpec = ${JSON.stringify({ ...spec, data: Array.isArray(spec.data) ? spec.data.slice(0, 8) : spec.data }, null, 2)};\n\nexport function SpecChart() {\n  return <Chart spec={spec} />;\n}\n`;
}

/** Font files to use for PNGs that contain Korean text */
export function findFonts(extra: string[] = []): string[] {
  const out: string[] = [];
  for (const f of extra) if (existsSync(f)) out.push(resolve(f));
  const dirs: string[] = [];
  if (process.env.ZTD_CHARTS_FONT_DIR) dirs.push(process.env.ZTD_CHARTS_FONT_DIR);
  try {
    const pkg = require.resolve("pretendard/package.json");
    dirs.push(join(dirname(pkg), "dist/public/static"));
  } catch {
    /* without pretendard, system fonts */
  }
  // The Pretendard shipped in the package is read only when the user gives no font, so fonts given with --font or ZTD_CHARTS_FONT_DIR win
  if (!extra.length && !process.env.ZTD_CHARTS_FONT_DIR) dirs.push(join(dirname(fileURLToPath(import.meta.url)), "../fonts"));
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (/^Pretendard-(Regular|Medium|SemiBold|Bold|ExtraBold)\.(otf|ttf)$/i.test(f) || (d === process.env.ZTD_CHARTS_FONT_DIR && /\.(otf|ttf|ttc)$/i.test(f))) out.push(join(d, f));
  }
  return out;
}

export interface FetchOptions {
  /** When false, blocks data URLs that point to a private network or this machine (addresses such as 127.0.0.1, 10.x, 192.168.x, 169.254.169.254). Default true; the MCP server uses false */
  allowPrivate?: boolean;
}

export interface RenderOptions extends FetchOptions {
  format?: "svg" | "png" | "html";
  width?: number;
  height?: number;
  theme?: "dark" | "light";
  /** PNG scale. Default 2 */
  scale?: number;
  /** Card frame. Default: true when spec.card is set */
  frame?: boolean;
  /** Embeds a script in the HTML that brings back animation and interaction */
  interactive?: boolean;
  fonts?: string[];
  /** Locale for chart text, number format and error messages. "ko" gives Korean (1.2만). Without it, the spec's options.locale, then "en-US" (1.2K) */
  locale?: string;
}

export interface RenderResult {
  format: "svg" | "png" | "html";
  svg?: string;
  png?: Buffer;
  html?: string;
  width?: number;
  height?: number;
  /** What was changed while rendering (such as emoji removed from the PNG). Shown like warnings */
  notes?: string[];
}

/** One emoji: a flag (two regional indicators), a keycap (#️⃣), a pictograph with skin tone, a ZWJ sequence. Symbols that default to text presentation, such as © and ™, are not removed */
const EMOJI = /\p{Regional_Indicator}{2}|[#*0-9]\p{Variation_Selector}?\p{Me}|(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\p{Variation_Selector})\p{Emoji_Modifier}?(?:\p{Join_Control}(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\p{Variation_Selector}?)\p{Emoji_Modifier}?)*/gu;

/**
 * Removes emoji from SVG text before converting to PNG. resvg cannot draw color emoji fonts, so a whole text run containing an emoji comes out as boxes.
 * Collapses the doubled spaces left where emoji were removed and trims leading and trailing spaces. Returns the number removed
 */
export function stripEmoji(svg: string): { svg: string; removed: number } {
  let removed = 0;
  // Looks only at drawn text (<text>, <tspan>). <title> and <desc> for screen readers are not drawn in the PNG, so they stay as is
  const out = svg.replace(/(<(?:text|tspan)\b[^>]*>)([^<]+)</g, (whole, open: string, text: string) => {
    const t = text.replace(EMOJI, () => {
      removed++;
      return "";
    });
    return t === text ? whole : `${open}${t.replace(/ {2,}/g, " ").trim()}<`;
  });
  return { svg: out, removed };
}

/**
 * Browser code for --interactive HTML: React plus that one chart (scripts/build-client.mjs builds it into dist/client). null when missing → static HTML.
 * A map chart puts the one built-in map its spec draws (geo-<name>.js) before the chart, so it hydrates with the same map as the server render
 */
function clientScript(type: string, map: string | null): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  // client/ next to it in the built dist/, ../dist/client/ when running from src/ under vitest
  for (const dir of [join(here, "client"), join(here, "../dist/client")]) {
    const files = [join(dir, "react.js"), ...(map ? [join(dir, `geo-${map}.js`)] : []), join(dir, `${type}.js`)];
    if (files.every((f) => existsSync(f))) return files.map((f) => readFileSync(f, "utf8")).join("\n");
  }
  return null;
}

/** Time and size limits for fetching a data URL */
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_FETCH_BYTES = 20 * 1024 * 1024;

const httpError = (status: number, text?: string) => new Error(`HTTP ${status}${text ? ` ${text}` : ""}`);

/** Counts the size while receiving the body in chunks (content-length may be missing or wrong). Stops receiving once over the limit; when done, returns a Response holding only the body and content-type */
async function readCapped(body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, contentType: string | null | undefined, t: CliText): Promise<Response> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const c of body) {
    size += c.byteLength;
    if (size > MAX_FETCH_BYTES) throw new Error(t.tooLarge(MAX_FETCH_BYTES / 1024 / 1024));
    chunks.push(c);
  }
  return new Response(Buffer.concat(chunks, size), { headers: { "content-type": contentType ?? "" } });
}

/**
 * Fetches an http(s) URL within the time (FETCH_TIMEOUT_MS) and size (MAX_FETCH_BYTES) limits.
 * When allowPrivate is false, blocks URLs that point to a private network or this machine (MCP server). On failure, throws an error that includes the URL.
 * The returned Response holds only the fully received body and content-type
 */
export async function fetchUrl(url: string, locale?: string, opts: FetchOptions = {}): Promise<Response> {
  const t = CLI_TEXT[langOf(locale)];
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  try {
    if (!isHttpUrl(url)) throw new Error(t.httpOnly);
    if (opts.allowPrivate === false) {
      const { getPublic, decoded } = await import("./guard");
      const res = await getPublic(new URL(url), signal, t);
      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        // Close the connection without reading the body of an error response
        res.destroy();
        throw httpError(status, res.statusMessage);
      }
      return await readCapped(decoded(res), res.headers["content-type"], t);
    }
    const res = await fetch(url, { signal });
    if (!res.ok) throw httpError(res.status, res.statusText);
    return await readCapped((res.body as WebReadableStream<Uint8Array> | null) ?? [], res.headers.get("content-type"), t);
  } catch (e) {
    // Only the time limit aborts the signal. fetch reports it as TimeoutError, http.request as AbortError
    const timedOut = (e as Error).name === "TimeoutError" || signal.aborted;
    throw new Error(t.fetchFailed(url, timedOut ? t.timeout(FETCH_TIMEOUT_MS / 1000) : (e as Error).message), { cause: e });
  }
}

/** Spec errors, one per line */
function specError(v: ValidationResult): Error {
  return new Error(v.errors.map((e) => `${e.path}: ${e.message}`).join("\n"));
}

/**
 * Renders a spec to SVG, PNG or HTML. Validates the spec first (URL data without field checks), fetches { url } data, then validates again with the rows.
 * Fetching, validation and rendering use the same locale (locale, then the spec's options.locale)
 */
export async function render(input: ChartSpec, opts: RenderOptions = {}): Promise<RenderResult> {
  const locale = specLocale(input, opts.locale);
  const lang = langOf(locale);
  // { csv } is parsed once and shared by validation and rendering
  const csv = typeof (input.data as { csv?: unknown } | undefined)?.csv === "string" ? (inlineRows(input.data) ?? undefined) : undefined;
  // An invalid spec does not fetch the URL
  const first = validateSpec(input, { lang, rows: csv });
  if (!first.valid) throw specError(first);
  const url = (input.data as { url?: unknown } | undefined)?.url;
  let spec: ChartSpec;
  try {
    spec = csv ? { ...input, data: csv } : await resolveSpecData(input, undefined, locale, (u) => fetchUrl(u, locale, opts));
  } catch (e) {
    // fetchUrl errors already include the URL. Add the URL to the rest, such as JSON parse errors
    const m = (e as Error).message;
    throw typeof url !== "string" || m.includes(url) ? e : new Error(CLI_TEXT[lang].fetchFailed(url, m), { cause: e });
  }
  // Validate again with the fetched rows (field names, numeric columns)
  if (typeof url === "string") {
    const v = validateSpec(spec, { lang });
    if (!v.valid) throw specError(v);
  }
  const format = opts.format ?? "svg";
  if (format === "html") {
    // Resolve the chart actually drawn from aliases and channels (scatter with size becomes bubble) and include only that chart's code
    const type = opts.interactive ? resolveDef(spec.type, spec.encoding, spec.options)?.type : undefined;
    const script = type ? clientScript(type, specMapName(spec)) : null;
    const html = renderSpecToHTML(spec, { width: opts.width, height: opts.height, theme: opts.theme, frame: opts.frame, interactive: script ? { script } : false, locale });
    return { format, html };
  }
  const svg = renderSpecToSVG(spec, { width: opts.width, height: opts.height, theme: opts.theme, frame: opts.frame, locale });
  const m = /width="(\d+)" height="(\d+)"/.exec(svg);
  const width = m ? Number(m[1]) : undefined;
  const height = m ? Number(m[2]) : undefined;
  if (format === "svg") return { format, svg, width, height };
  return { format, svg, width, height, ...(await svgToPng(svg, { scale: opts.scale, fonts: opts.fonts, locale })) };
}

/**
 * SVG to PNG (resvg). Removes emoji and reports how many in notes, in the locale's language.
 * MCP uses this to convert an already rendered SVG when it is too large to send as text
 */
export async function svgToPng(svg: string, opts: { scale?: number; fonts?: string[]; locale?: string } = {}): Promise<{ png: Buffer; notes?: string[] }> {
  const { Resvg } = await import("@resvg/resvg-js");
  const fontFiles = findFonts(opts.fonts);
  const plain = stripEmoji(svg);
  const zoom = pngZoom(svg, opts.scale ?? 2);
  if (zoom === null) throw new Error(CLI_TEXT[langOf(opts.locale)].pngNoSize);
  const r = new Resvg(plain.svg, { fitTo: { mode: "zoom", value: zoom }, font: { fontFiles, loadSystemFonts: true, defaultFontFamily: fontFiles.length ? "Pretendard" : "sans-serif" } });
  return { png: Buffer.from(r.render().asPng()), ...(plain.removed ? { notes: [CLI_TEXT[langOf(opts.locale)].emojiRemoved(plain.removed)] } : {}) };
}

/**
 * Maximum pixel count of one PNG. Allows up to 10,000 × 5,000px, or a 2400 × 1000px chart at scale 4 (about 38 million); at 4 bytes per pixel the bitmap tops out at about 200MB
 */
export const PNG_MAX_PIXELS = 50_000_000;

/**
 * PNG scale. When the outer <svg> size of the SVG to render × scale² exceeds PNG_MAX_PIXELS, lowers the scale to stay within it (decided before the bitmap is allocated).
 * The size is measured unshrunk (some documents, such as small multiples or long legends, are larger than the per-side chart limit).
 * null, so nothing is drawn, when the outer <svg> has no pixel width and height, or they are 0 or less, or not finite (the limit cannot be proven)
 */
export function pngZoom(svg: string, scale: number): number | null {
  const tag = /<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
  const w = Number(/\swidth="([\d.]+)"/.exec(tag)?.[1]);
  const h = Number(/\sheight="([\d.]+)"/.exec(tag)?.[1]);
  if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) return null;
  return Math.min(scale, Math.sqrt(PNG_MAX_PIXELS / (w * h)));
}

/** Whether it is an http(s) URL. loadRows, CLI suggest and MCP suggest_chart use the same rule (case-insensitive) */
export function isHttpUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

/** A file path, URL, or CSV/JSON string to an array of rows */
export async function loadRows(source: string, locale?: string, opts: FetchOptions = {}): Promise<Record<string, unknown>[]> {
  let text: string;
  if (isHttpUrl(source)) text = await (await fetchUrl(source, locale, opts)).text();
  else if (existsSync(source)) text = readFileSync(source, "utf8");
  else text = source;
  const t = text.trim();
  if (t.startsWith("[") || t.startsWith("{")) return normalizeData(JSON.parse(t));
  return parseCSV(text);
}

/** Chart suggestions from data. With locale "ko", the reasons and card text are in Korean */
export function suggest(rows: Record<string, unknown>[], opts: { limit?: number; locale?: string } = {}) {
  return suggestCharts(rows, { limit: opts.limit, lang: langOf(opts.locale) });
}

export { CHARTS };
