import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Chart, autoLegend, resolveDef } from "../charts/Chart";
import { CARD_TEXT } from "../components/ChartCard";
import { ThemeProvider, makePainter, resolveThemeInput } from "../theme/context";
import { baseCss } from "../core/css";
import { DEFAULT_LOCALE } from "../core/format";
import { langOf, type ChartLang } from "../core/i18n";
import { textWidth, truncate } from "../core/text";
import { fetchChartData, readResponse } from "../data/useChartData";
import { themeToCss, type ChartTheme } from "../theme/tokens";
import { levelBadge } from "../spec/labels";
import { nameIn, specLocale } from "../spec/meta";
import { inlineRows, validateSpec } from "../spec/validate";
import type { ChartSpec } from "../spec/types";

export interface RenderOptions {
  /** 전체 폭(px). 기본 720 */
  width?: number;
  /** 차트 높이(px). 없으면 차트 기본값 */
  height?: number;
  /** "dark"(기본) | "light" | 토큰 객체 */
  theme?: "dark" | "light" | Partial<ChartTheme>;
  /** 카드 틀(번호, 제목, 범례, 요약, 배지)까지 그려요. 기본: spec.card가 있으면 true */
  frame?: boolean;
  /** 바깥 여백(px). 기본 24 */
  padding?: number;
  /** 페이지 바탕색을 칠해요. 기본 true */
  background?: boolean;
  /**
   * 차트와 카드 글자, 숫자 형식, 오류 문구의 로캘. "ko"나 "ko-*"면 한국어, 그 밖은 영어.
   * 없으면 스펙 options.locale, 그것도 없으면 "en-US"
   */
  locale?: string;
}

/** 스펙 검사. 틀리면 이유를 모아 던져요 */
/** { csv } 데이터만 미리 읽은 행으로 (검사와 그리기가 같은 행을 써서 CSV를 한 번만 읽어요). 다른 꼴은 검사가 직접 봐요 */
function csvRows(data: unknown): Record<string, unknown>[] | undefined {
  return typeof (data as { csv?: unknown } | null)?.csv === "string" ? (inlineRows(data) ?? undefined) : undefined;
}

function assertValid(spec: ChartSpec, lang: ChartLang, rows?: Record<string, unknown>[]) {
  const v = validateSpec(spec, { lang, rows });
  if (!v.valid) throw new Error(`${lang === "ko" ? "스펙 오류" : "Invalid spec"}: ${v.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * { url } 데이터를 가져와 행 배열로 바꾼 스펙을 돌려줘요. locale은 오류 문구 언어예요.
 * fetcher를 주면 fetch 대신 그 함수로 받아요 (CLI는 시간과 크기 한도를 둔 fetch를 넘겨요)
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

function extractSvg(markup: string): { attrs: string; inner: string; vw: number; vh: number } | null {
  const m = /<svg([^>]*class="ztd-svg"[^>]*)>([\s\S]*?)<\/svg><\/div>/.exec(markup) ?? /<svg([^>]*)>([\s\S]*)<\/svg>/.exec(markup);
  if (!m) return null;
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(m[1]);
  return { attrs: m[1], inner: m[2], vw: vb ? Number(vb[1]) : 0, vh: vb ? Number(vb[2]) : 0 };
}

/** 스펙을 독립 SVG 문자열로. PNG 변환(resvg)에서도 그대로 써요 */
export function renderSpecToSVG(spec: ChartSpec, opts: RenderOptions = {}): string {
  const locale = specLocale(spec, opts.locale);
  const lang = langOf(locale);
  const csv = csvRows(spec.data);
  assertValid(spec, lang, csv);
  // { url } 데이터는 여기서 가져오지 않아요 (동기 함수라서). 그대로 그리면 로딩 화면만 남아요
  const rows = csv ?? inlineRows(spec.data);
  if (!rows) throw new Error(lang === "ko" ? "data.url 데이터는 먼저 가져와야 해요. renderSpecToSVG(await resolveSpecData(spec))처럼 resolveSpecData를 먼저 불러 주세요" : "data.url must be fetched first. Call resolveSpecData, as in renderSpecToSVG(await resolveSpecData(spec))");
  const theme = resolveThemeInput((opts.theme ?? (spec.theme as never)) || "dark");
  // 아래 문자열에 넣는 테마 값은 모두 이스케이프한 것만 써요 (검사를 거치지 않은 opts.theme도 속성을 벗어나지 못해요)
  const T = Object.fromEntries(Object.entries(theme).map(([k, v]) => [k, esc(v)])) as Record<keyof ChartTheme, string>;
  const W = Math.max(160, Math.round(opts.width ?? 720));
  // 속성에 들어가는 크기는 숫자로만 (문자열이 오면 그대로 붙지 않게)
  const pad = Number(opts.padding ?? 24) || 0;
  const frame = opts.frame ?? !!spec.card;
  const card = spec.card ?? {};
  const def = resolveDef(spec.type, spec.encoding);
  const inner = frame ? W - pad * 2 - 40 : W - pad * 2;
  // { csv }를 한 번만 읽도록 행으로 바꿔 넘겨요
  const markup = chartMarkup({ ...spec, data: rows }, inner, opts.height, theme, false, false, locale);
  const svg = extractSvg(markup);
  if (!svg) throw new Error(lang === "ko" ? "차트 SVG를 만들지 못했어요" : "Couldn't build the chart SVG");
  const chartH = svg.vh || Number(opts.height) || 240;
  const font = theme.fontFamily.replace(/"/g, "'");
  const mono = theme.monoFamily.replace(/"/g, "'");
  const bodyOpen = (x: number, y: number) => `<svg x="${x}" y="${y}" width="${inner}" height="${chartH}" viewBox="0 0 ${svg.vw || inner} ${chartH}" overflow="visible">`;

  if (!frame) {
    const H = Math.round(chartH + pad * 2);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(font)}" color="${T.ink}">${opts.background === false ? "" : `<rect width="${W}" height="${H}" fill="${T.panel}"/>`}${bodyOpen(pad, pad)}${svg.inner}</svg></svg>`;
  }

  // 카드 틀
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
  parts.push(`<text x="${cx0 + ip + numW}" y="${y + 19}" font-size="22" font-weight="800" letter-spacing="-0.5" fill="${T.ink}">${esc(title)}</text>`);
  y += 30;
  const legend = card.legend === "auto" ? autoLegend(spec, rows, locale ?? DEFAULT_LOCALE) : card.legend ?? [];
  if (card.subtitle || legend.length) {
    parts.push(`<text x="${cx0 + ip}" y="${y + 12}" font-size="12.5" fill="${T.muted}">${esc(card.subtitle ?? "")}</text>`);
    // 범례는 브라우저 카드처럼 줄을 바꾸고 오른쪽에 붙여요: 항목은 색 9px + 6px + 글자, 항목 사이 12px, 줄 사이 18px.
    // 한 줄에 들어가고 부제와 나란히 들어가면 부제 줄에, 아니면 부제 아래 줄부터 써요
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
      // 줄마다 오른쪽 끝에서 왼쪽으로 놓아요 (한 줄 범례는 예전과 같은 좌표, 같은 순서)
      let lx = cx0 + cw - ip;
      for (const { it, label, tw } of [...line].reverse()) {
        lx -= tw;
        parts.push(`<text x="${lx}" y="${ly + 12}" font-size="11.5" fill="${T.muted}">${esc(label)}</text>`);
        lx -= 15;
        // 토큰 이름("accent")만 테마 색으로 바꿔요 ("constructor" 같은 이름이 객체 속성을 꺼내지 않게)
        const col = esc(paint.raw(it.color));
        if (it.shape === "line" || it.shape === "dash") parts.push(`<line x1="${lx - 2}" x2="${lx + 11}" y1="${ly + 8}" y2="${ly + 8}" stroke="${col}" stroke-width="2"${it.shape === "dash" ? ' stroke-dasharray="3 2"' : ""}/><circle cx="${lx + 4.5}" cy="${ly + 8}" r="2.2" fill="${col}"/>`);
        // 원(circle)은 브라우저 카드 범례와 같게 둥근 모서리를 반지름까지 키워요
        else parts.push(`<rect x="${lx}" y="${ly + 3.5}" width="9" height="9" rx="${it.shape === "circle" ? 4.5 : 2.5}" fill="${col}"${it.color === "neutral" || !it.color ? ` stroke="${T.line2}"` : ""}/>`);
        lx -= 12;
      }
      ly += 18;
    }
    // 범례 마지막 줄(범례가 없으면 부제 줄) 아래로 8px
    y = ly + 8;
  }
  y += 6;
  const chartY = y;
  y += chartH + 14;
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
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(font)}" color="${T.ink}">` +
    (opts.background === false ? "" : `<rect width="${W}" height="${H}" fill="${T.bg}"/>`) +
    `<rect x="${cx0 + 0.5}" y="${cy0 + 0.5}" width="${cw - 1}" height="${ch - 1}" rx="${T.radius}" fill="${T.panel}" stroke="${T.line}"/>` +
    parts.join("") +
    bodyOpen(cx0 + ip, chartY) +
    svg.inner +
    `</svg></svg>`
  );
}

export interface HTMLOptions extends RenderOptions {
  /** 문서 제목 */
  title?: string;
  /**
   * 브라우저에서 다시 그려 애니메이션과 인터랙션을 살려요.
   * 값은 ztd-charts ESM 번들 주소 또는 내용(data: URL)이에요. 없으면 정적 SSR만.
   */
  interactive?: { libraryUrl: string; reactVersion?: string } | false;
}

/** 서버 렌더한 카드와 차트를 담은 HTML 문서 */
export function renderSpecToHTML(spec: ChartSpec, opts: HTMLOptions = {}): string {
  const locale = specLocale(spec, opts.locale);
  const lang = langOf(locale);
  assertValid(spec, lang);
  const theme = resolveThemeInput((opts.theme ?? (spec.theme as never)) || "dark");
  const W = Math.max(240, Math.round(opts.width ?? 720));
  const withCard = opts.frame ?? true;
  // 정적 HTML 에는 스크립트가 없어 다시 재생 버튼이 눌러도 아무 일도 안 해요. 그래서 interactive 일 때만 버튼을 그려요
  const shown = withCard ? (opts.interactive || !spec.card ? spec : { ...spec, card: { ...spec.card, replay: false } }) : { ...spec, card: undefined };
  const markup = renderToStaticMarkup(createElement(ThemeProvider, { theme, cssVars: true }, createElement(Chart, { spec: shown, height: opts.height, animate: false, locale })));
  const def = resolveDef(spec.type, spec.encoding);
  const title = opts.title ?? spec.card?.title ?? (def ? nameIn(def, lang) : "Chart");
  const rv = opts.interactive ? opts.interactive.reactVersion ?? "19" : "19";
  const script = opts.interactive
    ? `<script type="importmap">${JSON.stringify({ imports: { react: `https://esm.sh/react@${rv}`, "react/jsx-runtime": `https://esm.sh/react@${rv}/jsx-runtime`, "react-dom/client": `https://esm.sh/react-dom@${rv}/client?deps=react@${rv}`, "ztd-charts": opts.interactive.libraryUrl } })}</script>
<script type="module">
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { Chart, ThemeProvider } from "ztd-charts";
const spec = ${JSON.stringify(withCard ? spec : { ...spec, card: undefined }).replace(/</g, "\\u003c")};
const el = document.getElementById("chart");
el.innerHTML = "";
createRoot(el).render(h(ThemeProvider, { theme: ${JSON.stringify(theme).replace(/</g, "\\u003c")} }, h(Chart, { spec${opts.height ? `, height: ${opts.height}` : ""}${locale ? `, locale: ${JSON.stringify(locale).replace(/</g, "\\u003c")}` : ""} })));
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

export { validateSpec } from "../spec/validate";
export { langOf, plural, type ChartLang } from "../core/i18n";
export { DEFAULT_LOCALE } from "../core/format";
export { specSchema, schemaFor } from "../spec/schema";
export { CHARTS, getChartDef } from "../spec/registry";
export { suggestCharts } from "../spec/suggest";
export type { ChartSpec } from "../spec/types";
