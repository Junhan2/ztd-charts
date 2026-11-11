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
 * 차트 목록. group, level은 id("flow", "basic")나 영어, 한글 이름("흐름", "기본") 어느 것으로도 걸러요.
 * locale이 "ko"면 이름과 설명이 한글, 기본 영어
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

/** 모르는 차트 오류 */
function unknownChart(type: string, locale?: string): Error {
  return new Error(CLI_TEXT[langOf(locale)].unknownChart(type));
}

/** 전체 또는 차트 하나의 JSON Schema. locale "ko"면 설명이 한글 */
export function getChartSchema(type?: string, locale?: string): JSONSchema {
  const lang = langOf(locale);
  if (!type) return specSchemaIn(lang);
  const def = resolveType(type);
  if (!def) throw unknownChart(type, locale);
  return schemaForIn(def.type, lang)!;
}

/** 차트 하나의 설명, 스키마, 예시, React 코드. locale "ko"면 글과 예시가 한글 */
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
    /** 이름 붙은 꼴: 예시 options 위에 덮어쓰는 옵션, 범위 띠처럼 필드를 더하는 꼴은 encoding도 (ztd-charts example <type> --variant <id>) */
    variants: variantsIn(def.type, lang),
  };
}

/** 스펙 검사. locale "ko"면 메시지가 한글 */
export function validate(spec: unknown, locale?: string): ValidationResult {
  return validateSpec(spec, { lang: langOf(locale) });
}

/**
 * JSX 속성 값. JSX 따옴표 속성에는 \" 같은 이스케이프가 없고 &amp;는 글자로 풀려서,
 * 그대로 쓸 수 있는 문자열만 "…"로 두고 나머지는 {"…"} 식으로 넣어요
 */
function jsxValue(v: unknown): string {
  const j = JSON.stringify(v);
  return typeof v === "string" && j === `"${v}"` && !v.includes("&") ? j : `{${j}}`;
}

/** JSX 속성 이름으로 쓸 수 있는 옵션 키만 (공백 같은 글자가 있으면 코드가 깨져요) */
const JSX_NAME = /^[A-Za-z_$][\w$-]*$/;

/** 차트 프롭(JSX 속성 글, 첫 번째는 data)을 <ChartFacets> 코드로. highlight와 data는 ChartFacets가 받고 나머지는 chartProps 객체로 */
function facetElement(component: string, type: string, facet: NonNullable<ChartSpec["facet"]>, props: string[]): string {
  const own: string[] = [props[0]];
  const fields: string[] = [];
  for (const p of props.slice(1)) {
    const at = p.indexOf("=");
    const name = p.slice(0, at);
    const value = p.slice(at + 1);
    if (name === "highlight") own.push(p);
    // JSX 속성 값("글" 또는 {식}, 둘 다 jsxValue가 만든 것)을 객체 값(식)으로. 이름에 -가 있으면 따옴표로 감싸요
    else fields.push(`${/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)}: ${value.startsWith("{") ? value.slice(1, -1) : value}`);
  }
  // 스펙은 믿을 수 없는 입력이라 facet 값도 다른 프롭처럼 jsxValue로만 써요. columns는 양의 정수, scale은 두 값 중 하나일 때만 (아니면 코드에서 빼요)
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

/** 스펙을 React 코드로 (컴포넌트를 직접 쓰는 방식). locale "ko"면 주석이 한글 */
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
  // 스펙 툴팁 틀은 컴포넌트에 templateTooltip(…) 함수로 넘겨요 (객체 그대로면 컴포넌트가 무시해요)
  const template = specTemplate(spec);
  const tipLocale = specLocale(spec);
  // 지도 차트의 내장 지도는 이름 대신 그 입구에서 불러온 지도를 넘겨요 (registerMap 없이 그려요)
  const geo = specMapName(spec);
  for (const [k, v] of Object.entries(spec.options ?? {})) {
    if (!JSX_NAME.test(k) || (geo && k === "map")) continue;
    if (k === "tooltip" && template) props.push(`tooltip={templateTooltip(${JSON.stringify(template)}${tipLocale ? `, ${JSON.stringify(tipLocale)}` : ""})}`);
    else props.push(`${k}=${jsxValue(v)}`);
  }
  if (geo) props.push(`map={${mapExportName(geo)}}`);
  // 작은 여러 개(spec.facet)는 <ChartFacets>가 by 값마다 차트를 한 칸씩 그려요. highlight는 패널을 고르고, 다른 프롭은 chartProps로 패널마다 넘겨요
  // 양쪽 막대(layout "diverging")는 작은 여러 개로 그리지 않아요 (검사기가 오류로 알려요)
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
      // <Chart spec>처럼 차트가 그리는 열만 CSV로
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

/** 스펙 그대로 쓰는 React 코드. ChartSpec 타입을 달아야 card.legend: "auto" 같은 값이 string으로 넓어지지 않아 TS에서 바로 컴파일돼요 */
export function specSnippet(spec: ChartSpec): string {
  // 지도 차트는 그리는 지도를 한 번 등록해요 (options.map의 "world"와 "auto"가 등록한 지도를 찾아요)
  const geo = specMapName(spec);
  const name = geo && mapExportName(geo);
  const head = geo ? `import { Chart, registerMap, type ChartSpec } from "ztd-charts";\nimport { ${name} } from "ztd-charts/geo/${geo}";\n\nregisterMap(${name});\n` : `import { Chart, type ChartSpec } from "ztd-charts";\n`;
  return `${head}\nconst spec: ChartSpec = ${JSON.stringify({ ...spec, data: Array.isArray(spec.data) ? spec.data.slice(0, 8) : spec.data }, null, 2)};\n\nexport function SpecChart() {\n  return <Chart spec={spec} />;\n}\n`;
}

/** 한글이 들어간 PNG를 위해 쓸 글꼴 파일 */
export function findFonts(extra: string[] = []): string[] {
  const out: string[] = [];
  for (const f of extra) if (existsSync(f)) out.push(resolve(f));
  const dirs: string[] = [];
  if (process.env.ZTD_CHARTS_FONT_DIR) dirs.push(process.env.ZTD_CHARTS_FONT_DIR);
  try {
    const pkg = require.resolve("pretendard/package.json");
    dirs.push(join(dirname(pkg), "dist/public/static"));
  } catch {
    /* pretendard가 없으면 시스템 글꼴 */
  }
  // 패키지에 실은 Pretendard는 사용자가 글꼴을 주지 않았을 때만 읽어요. --font나 ZTD_CHARTS_FONT_DIR로 준 글꼴이 이기게요
  if (!extra.length && !process.env.ZTD_CHARTS_FONT_DIR) dirs.push(join(dirname(fileURLToPath(import.meta.url)), "../fonts"));
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (/^Pretendard-(Regular|Medium|SemiBold|Bold|ExtraBold)\.(otf|ttf)$/i.test(f) || (d === process.env.ZTD_CHARTS_FONT_DIR && /\.(otf|ttf|ttc)$/i.test(f))) out.push(join(d, f));
  }
  return out;
}

export interface FetchOptions {
  /** false면 데이터 주소가 내부망이나 이 컴퓨터(127.0.0.1, 10.x, 192.168.x, 169.254.169.254 같은 주소)를 가리킬 때 막아요. 기본 true, MCP 서버는 false로 써요 */
  allowPrivate?: boolean;
}

export interface RenderOptions extends FetchOptions {
  format?: "svg" | "png" | "html";
  width?: number;
  height?: number;
  theme?: "dark" | "light";
  /** PNG 배율. 기본 2 */
  scale?: number;
  /** 카드 틀. 기본: spec.card가 있으면 true */
  frame?: boolean;
  /** HTML에 애니메이션과 인터랙션을 살리는 스크립트를 넣어요 */
  interactive?: boolean;
  fonts?: string[];
  /** 차트 글자, 숫자 형식, 오류 문구의 로캘. "ko"면 한국어(1.2만). 없으면 스펙 options.locale, 그다음 "en-US"(1.2K) */
  locale?: string;
}

export interface RenderResult {
  format: "svg" | "png" | "html";
  svg?: string;
  png?: Buffer;
  html?: string;
  width?: number;
  height?: number;
  /** 그리면서 바꾼 것 (PNG에서 뺀 이모지 등). 경고처럼 보여 줘요 */
  notes?: string[];
}

/** 이모지 한 개: 국기(지역 문자 두 개), 키캡(#️⃣), 그림 문자와 피부색, ZWJ로 이은 묶음. ©, ™ 같은 글자 표시 기본 기호는 빼지 않아요 */
const EMOJI = /\p{Regional_Indicator}{2}|[#*0-9]\p{Variation_Selector}?\p{Me}|(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\p{Variation_Selector})\p{Emoji_Modifier}?(?:\p{Join_Control}(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\p{Variation_Selector}?)\p{Emoji_Modifier}?)*/gu;

/**
 * PNG로 바꾸기 전에 SVG 글자에서 이모지를 빼요. resvg는 컬러 이모지 글꼴을 못 그려서, 이모지가 든 글자 덩어리 전체가 네모로 나와요.
 * 이모지를 뺀 자리의 겹친 공백은 하나로 줄이고 앞뒤 공백은 지워요. 뺀 개수를 돌려줘요
 */
export function stripEmoji(svg: string): { svg: string; removed: number } {
  let removed = 0;
  // 그려지는 글자(<text>, <tspan>)만 봐요. 화면 낭독용 <title>, <desc>는 PNG에 안 그려져서 그대로 둬요
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
 * --interactive HTML의 브라우저 코드: React와 그 차트 하나 (scripts/build-client.mjs 가 dist/client 에 만들어요). 없으면 null → 정적 HTML.
 * 지도 차트는 그 스펙이 그리는 내장 지도 하나(geo-<이름>.js)를 차트 앞에 넣어요. 서버 그림과 같은 지도로 이어받아요
 */
function clientScript(type: string, map: string | null): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  // 빌드한 dist/ 에서는 옆의 client/, vitest 로 src/ 에서 돌 때는 ../dist/client/
  for (const dir of [join(here, "client"), join(here, "../dist/client")]) {
    const files = [join(dir, "react.js"), ...(map ? [join(dir, `geo-${map}.js`)] : []), join(dir, `${type}.js`)];
    if (files.every((f) => existsSync(f))) return files.map((f) => readFileSync(f, "utf8")).join("\n");
  }
  return null;
}

/** 데이터 주소를 가져올 때 기다리는 시간과 받는 크기의 한도 */
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_FETCH_BYTES = 20 * 1024 * 1024;

const httpError = (status: number, text?: string) => new Error(`HTTP ${status}${text ? ` ${text}` : ""}`);

/** 본문을 조각으로 받으면서 크기를 세요 (content-length는 없거나 틀릴 수 있어요). 한도를 넘으면 받기를 멈추고, 다 받으면 본문과 content-type만 든 Response를 돌려줘요 */
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
 * http(s) 주소를 시간(FETCH_TIMEOUT_MS)과 크기(MAX_FETCH_BYTES) 한도 안에서 가져와요.
 * allowPrivate가 false면 내부망과 이 컴퓨터를 가리키는 주소를 막아요(MCP 서버). 실패하면 주소가 들어간 오류를 던져요.
 * 돌려주는 Response는 다 받은 본문과 content-type만 가져요
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
        // 오류 응답의 본문은 읽지 않고 연결을 끊어요
        res.destroy();
        throw httpError(status, res.statusMessage);
      }
      return await readCapped(decoded(res), res.headers["content-type"], t);
    }
    const res = await fetch(url, { signal });
    if (!res.ok) throw httpError(res.status, res.statusText);
    return await readCapped((res.body as WebReadableStream<Uint8Array> | null) ?? [], res.headers.get("content-type"), t);
  } catch (e) {
    // signal을 멈추는 건 시간 한도뿐이에요. fetch는 TimeoutError로, http.request는 AbortError로 알려요
    const timedOut = (e as Error).name === "TimeoutError" || signal.aborted;
    throw new Error(t.fetchFailed(url, timedOut ? t.timeout(FETCH_TIMEOUT_MS / 1000) : (e as Error).message), { cause: e });
  }
}

/** 스펙 오류를 한 줄씩 */
function specError(v: ValidationResult): Error {
  return new Error(v.errors.map((e) => `${e.path}: ${e.message}`).join("\n"));
}

/**
 * 스펙을 SVG, PNG, HTML로. 스펙을 먼저 검사하고(주소 데이터는 필드 검사 없이), { url } 데이터를 가져온 뒤 행으로 다시 검사해요.
 * 가져오기, 검사, 그리기가 같은 로캘(locale, 그다음 스펙 options.locale)을 써요
 */
export async function render(input: ChartSpec, opts: RenderOptions = {}): Promise<RenderResult> {
  const locale = specLocale(input, opts.locale);
  const lang = langOf(locale);
  // { csv }는 한 번만 읽어서 검사와 그리기에 같이 써요
  const csv = typeof (input.data as { csv?: unknown } | undefined)?.csv === "string" ? (inlineRows(input.data) ?? undefined) : undefined;
  // 틀린 스펙이면 주소를 가져오지 않아요
  const first = validateSpec(input, { lang, rows: csv });
  if (!first.valid) throw specError(first);
  const url = (input.data as { url?: unknown } | undefined)?.url;
  let spec: ChartSpec;
  try {
    spec = csv ? { ...input, data: csv } : await resolveSpecData(input, undefined, locale, (u) => fetchUrl(u, locale, opts));
  } catch (e) {
    // fetchUrl 오류에는 이미 주소가 있어요. JSON을 못 읽는 오류 같은 나머지에 주소를 붙여요
    const m = (e as Error).message;
    throw typeof url !== "string" || m.includes(url) ? e : new Error(CLI_TEXT[lang].fetchFailed(url, m), { cause: e });
  }
  // 가져온 행으로 다시 검사해요 (필드 이름, 숫자 열)
  if (typeof url === "string") {
    const v = validateSpec(spec, { lang });
    if (!v.valid) throw specError(v);
  }
  const format = opts.format ?? "svg";
  if (format === "html") {
    // 별칭과 채널로 실제 그릴 차트를 골라(scatter 에 size 가 있으면 bubble) 그 차트의 코드만 넣어요
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
 * SVG를 PNG로 (resvg). 이모지는 빼고, 뺀 수를 locale 언어로 notes에 알려요.
 * MCP는 SVG가 너무 커서 글자로 못 보낼 때 이미 그린 SVG를 이걸로 바꿔 보내요
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
 * PNG 한 장의 최대 픽셀 수. 10,000 × 5,000px 또는 2400 × 1000px 차트의 배율 4(약 3,800만)까지 그대로이고, 비트맵은 4바이트씩이라 약 200MB가 상한이에요
 */
export const PNG_MAX_PIXELS = 50_000_000;

/**
 * PNG 배율. 실제로 그릴 SVG의 바깥 <svg> 크기 × 배율²이 PNG_MAX_PIXELS를 넘으면 넘지 않게 배율을 낮춰요(비트맵을 잡기 전에 정해요).
 * 크기는 줄이지 않은 그대로 재요(작은 여러 개, 긴 범례처럼 차트 한 변 한도보다 큰 문서도 있어요).
 * 바깥 <svg>에 픽셀 폭과 높이가 없거나 0 이하, 유한하지 않으면 null이라 그리지 않아요(한도를 증명할 수 없어서)
 */
export function pngZoom(svg: string, scale: number): number | null {
  const tag = /<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
  const w = Number(/\swidth="([\d.]+)"/.exec(tag)?.[1]);
  const h = Number(/\sheight="([\d.]+)"/.exec(tag)?.[1]);
  if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) return null;
  return Math.min(scale, Math.sqrt(PNG_MAX_PIXELS / (w * h)));
}

/** http(s) 주소인지. loadRows, CLI suggest, MCP suggest_chart가 같은 규칙(대소문자 무시)을 써요 */
export function isHttpUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

/** 파일 경로나 URL, CSV/JSON 문자열을 행 배열로 */
export async function loadRows(source: string, locale?: string, opts: FetchOptions = {}): Promise<Record<string, unknown>[]> {
  let text: string;
  if (isHttpUrl(source)) text = await (await fetchUrl(source, locale, opts)).text();
  else if (existsSync(source)) text = readFileSync(source, "utf8");
  else text = source;
  const t = text.trim();
  if (t.startsWith("[") || t.startsWith("{")) return normalizeData(JSON.parse(t));
  return parseCSV(text);
}

/** 데이터로 차트 추천. locale "ko"면 이유와 카드 글이 한글 */
export function suggest(rows: Record<string, unknown>[], opts: { limit?: number; locale?: string } = {}) {
  return suggestCharts(rows, { limit: opts.limit, lang: langOf(opts.locale) });
}

export { CHARTS };
