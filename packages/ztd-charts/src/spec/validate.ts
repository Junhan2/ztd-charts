import { parseCSV } from "../data/parse";
import { hasField, toNumber } from "../data/accessor";
import { toDate } from "../core/format";
import { META } from "./meta";
import { CHARTS, COMMON_OPTIONS, getChartDef, TYPE_ALIASES } from "./registry";
import type { ChartSpec, Lang, SpecIssue, ValidationResult } from "./types";

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

export function closest(word: string, list: readonly string[]): string | null {
  let best: string | null = null;
  let bs = Infinity;
  let bd = Infinity;
  const w = word.toLowerCase();
  for (const c of list) {
    const lc = c.toLowerCase();
    const d = levenshtein(w, lc);
    let prefix = 0;
    while (prefix < w.length && prefix < lc.length && w[prefix] === lc[prefix]) prefix++;
    // 거리가 같으면 앞부분이 더 많이 겹치는 쪽
    const score = d - prefix * 0.1;
    if (score < bs) {
      bs = score;
      bd = d;
      best = c;
    }
  }
  return best !== null && bd <= Math.max(2, Math.floor(word.length / 3)) ? best : null;
}

/** 스펙의 data를 행 배열로 (URL이면 null) */
export function inlineRows(data: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.values)) return o.values as Record<string, unknown>[];
    if (typeof o.csv === "string") return parseCSV(o.csv);
  }
  return null;
}

/** 테마 값과 범례 색에 쓰는 글자. CSS 선언이나 SVG 속성을 벗어나는 ; { } < > \ : 는 없어요 */
const SAFE_VALUE = /^[\p{L}\p{N}_\s#%(),./+'"-]*$/u;
/** 값에 쓸 수 있는 CSS 함수. url(), image() 같은 바깥 주소를 부르는 함수는 막아요 */
const CSS_FUNC = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|var|calc|min|max|clamp)$/i;

/** 색, 길이, 글꼴 이름으로 안전한 값인지 (#hex, rgb(), oklch(), 이름 색, var(--x), 18). 따옴표는 글꼴 이름에만 */
function isSafeStyleValue(v: unknown, font = false): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v !== "string" || !SAFE_VALUE.test(v) || (!font && /['"]/.test(v))) return false;
  for (const m of v.matchAll(/([\w-]+)\s*\(/g)) if (!CSS_FUNC.test(m[1])) return false;
  return true;
}

function typeOf(v: unknown): string {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  return typeof v;
}

/**
 * 스펙 검사. 오류(렌더 불가)와 경고(동작은 하지만 의심)를 나눠 돌려줘요.
 * 메시지는 영어, { lang: "ko" }면 한글. code와 path는 언어와 상관없이 같아요.
 * 한글 메시지는 이 파일의 문구와 META의 nameKo만 써요. 큰 한글 표(locales/ko)를 기본 번들에 넣지 않으려고요.
 */
export function validateSpec(input: unknown, opts: { rows?: Record<string, unknown>[]; lang?: Lang } = {}): ValidationResult {
  const errors: SpecIssue[] = [];
  const warnings: SpecIssue[] = [];
  const err = (path: string, code: string, message: string) => errors.push({ path, code, message });
  const warn = (path: string, code: string, message: string) => warnings.push({ path, code, message });
  const lang = opts.lang ?? "en";
  /** 같은 메시지의 영어와 한글 */
  const t = (en: string, ko: string) => (lang === "ko" ? ko : en);

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    err("", "not_object", t("The spec must be an object shaped like { type, data, encoding }", "스펙은 { type, data, encoding } 모양의 객체여야 해요"));
    return { valid: false, errors, warnings };
  }
  const spec = input as Partial<ChartSpec> & Record<string, unknown>;
  for (const k of Object.keys(spec)) {
    if (!["$schema", "type", "data", "encoding", "options", "card", "theme"].includes(k)) warn(k, "unknown_key", t(`Unknown key "${k}" is ignored`, `"${k}" 키는 알 수 없어서 무시해요`));
  }

  const types = CHARTS.map((c) => c.type).join(", ");
  if (typeof spec.type !== "string" || !spec.type) {
    err("type", "missing_type", t(`type is required. Possible values: ${types}`, `type이 필요해요. 가능한 값: ${types}`));
    return { valid: false, errors, warnings };
  }
  let def = getChartDef(spec.type);
  if (!def && TYPE_ALIASES[spec.type]) {
    def = getChartDef(TYPE_ALIASES[spec.type]);
    warn("type", "alias", t(`"${spec.type}" is drawn as "${def?.type}"`, `"${spec.type}" 타입은 "${def?.type}" 차트로 그려요`));
  }
  if (!def) {
    const near = closest(spec.type, [...CHARTS.map((c) => c.type), ...Object.keys(TYPE_ALIASES)]);
    const guess = near ? (TYPE_ALIASES[near] ?? near) : null;
    err("type", "unknown_type", t(`Unknown chart "${spec.type}".${guess ? ` Did you mean "${guess}"?` : ""} Possible values: ${types}`, `"${spec.type}" 차트는 없어요.${guess ? ` "${guess}"인가요?` : ""} 가능한 값: ${types}`));
    return { valid: false, errors, warnings };
  }
  const chartName = lang === "ko" ? (META[def.type]?.nameKo ?? def.name) : def.name;

  // data
  /** 행이 모두 객체인지. 아니면 첫 번째 틀린 행을 알려 줘요 */
  const shaped = (list: unknown[], path: string) => {
    const bad = list.findIndex((r) => !r || typeof r !== "object" || Array.isArray(r));
    if (bad >= 0) err(`${path}[${bad}]`, "bad_row", t("Each row of data must be an object. Convert 2D arrays with fromRows() or use { csv }", "data의 각 행은 객체여야 해요. 2차원 배열은 fromRows()로 바꾸거나 { csv }를 써 주세요"));
    return list as Record<string, unknown>[];
  };
  let rows: Record<string, unknown>[] | null = opts.rows ?? null;
  if (spec.data === undefined) err("data", "missing_data", t("data is required: an array of objects, { values }, { csv } or { url }", "data가 필요해요: 객체 배열, { values }, { csv }, { url } 중 하나"));
  else if (!rows) {
    const d = spec.data as unknown;
    if (Array.isArray(d)) rows = shaped(d, "data");
    else if (d && typeof d === "object") {
      const o = d as Record<string, unknown>;
      if ("url" in o) {
        if (typeof o.url !== "string" || !/^(https?:|\/|\.\/|data:)/.test(o.url)) err("data.url", "bad_url", t("data.url must be an http(s) address or a path", "data.url은 http(s) 주소나 경로여야 해요"));
        if (o.format !== undefined && !["json", "csv", "auto"].includes(String(o.format))) err("data.format", "bad_format", t('data.format must be "json" | "csv" | "auto"', 'data.format은 "json" | "csv" | "auto" 중 하나여야 해요'));
      } else if ("csv" in o) {
        if (typeof o.csv !== "string") err("data.csv", "bad_csv", t("data.csv must be a string", "data.csv는 문자열이어야 해요"));
        else rows = parseCSV(o.csv);
      } else if ("values" in o) {
        if (!Array.isArray(o.values)) err("data.values", "bad_values", t("data.values must be an array", "data.values는 배열이어야 해요"));
        else rows = shaped(o.values, "data.values");
      } else err("data", "bad_data", t("data must be an array of objects, { values }, { csv } or { url }", "data는 객체 배열, { values }, { csv }, { url } 중 하나여야 해요"));
    } else err("data", "bad_data", t(`data has the wrong shape (${typeOf(d)})`, `data 형식이 맞지 않아요(${typeOf(d)})`));
  }
  if (rows && rows.length === 0) warn("data", "empty", t("data is empty. The chart draws its empty state", "data가 비어 있어요. 빈 상태로 그려요"));

  // encoding
  const enc = (spec.encoding ?? {}) as Record<string, unknown>;
  if (spec.encoding !== undefined && (typeof spec.encoding !== "object" || Array.isArray(spec.encoding))) err("encoding", "bad_encoding", t("encoding must be an object of { channel: field name }", "encoding은 { 채널: 필드 이름 } 객체여야 해요"));
  const fields = rows && rows.length ? Array.from(new Set(rows.slice(0, 200).flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : [])))) : [];
  const names = def.encoding.map((c) => c.name);
  for (const k of Object.keys(enc)) {
    if (!names.includes(k)) {
      const near = closest(k, names);
      warn(`encoding.${k}`, "unknown_channel", t(`${chartName} has no channel "${k}".${near ? ` Did you mean "${near}"?` : ""} Available channels: ${names.join(", ")}`, `${chartName}에는 "${k}" 채널이 없어요.${near ? ` "${near}"인가요?` : ""} 가능한 채널: ${names.join(", ")}`));
    }
  }
  for (const c of def.encoding) {
    const v = enc[c.name];
    if (v === undefined) {
      if (c.required) {
        // 기본 필드 이름(채널 이름)과 같으면 생략해도 돼요
        if (fields.includes(c.name)) continue;
        if (!fields.length) warn(`encoding.${c.name}`, "missing_channel_default", t(`encoding.${c.name} is missing, so the "${c.name}" field is used`, `encoding.${c.name} 값이 없어서 "${c.name}" 필드를 써요`));
        else err(`encoding.${c.name}`, "missing_channel", t(`encoding.${c.name} (${c.description}) is required. Data fields: ${fields.join(", ")}`, `encoding.${c.name} 값이 필요해요. 데이터 필드: ${fields.join(", ")}`));
      }
      continue;
    }
    const list = Array.isArray(v) ? v : [v];
    if (Array.isArray(v) && !c.multi) err(`encoding.${c.name}`, "not_multi", t(`encoding.${c.name} takes a single field`, `encoding.${c.name}에는 필드 하나만 넣어요`));
    for (const f of list) {
      if (typeof f !== "string" || !f) {
        err(`encoding.${c.name}`, "bad_field", t(`encoding.${c.name} must be a field name (string)`, `encoding.${c.name} 값은 필드 이름(문자열)이어야 해요`));
        continue;
      }
      if (!rows || !rows.length) continue;
      const sample = rows.slice(0, 200);
      const present = sample.filter((r) => r && typeof r === "object" && hasField(r, f));
      if (!present.length) {
        const near = closest(f, fields);
        err(`encoding.${c.name}`, "field_not_found", t(`Field "${f}" is not in the data.${near ? ` Did you mean "${near}"?` : ""} Available fields: ${fields.join(", ")}`, `"${f}" 필드가 데이터에 없어요.${near ? ` "${near}"인가요?` : ""} 있는 필드: ${fields.join(", ")}`));
        continue;
      }
      const vals = present.map((r) => r[f]).filter((x) => x !== null && x !== undefined && x !== "");
      if (c.type === "number" && vals.length) {
        const ok = vals.filter((x) => Number.isFinite(toNumber(x))).length / vals.length;
        if (ok < 0.8) err(`encoding.${c.name}`, "not_numeric", t(`Field "${f}" must be numeric (${Math.round(ok * 100)}% of values read as numbers)`, `"${f}" 필드는 숫자여야 해요(숫자로 읽히는 값 ${Math.round(ok * 100)}%)`));
      }
      if (c.type === "date" && vals.length) {
        const ok = vals.filter((x) => toDate(x)).length / vals.length;
        if (ok < 0.8) err(`encoding.${c.name}`, "not_date", t(`Field "${f}" must be a date (for example "2025-03-15")`, `"${f}" 필드는 날짜여야 해요(예: "2025-03-15")`));
      }
    }
  }

  // options
  const options = spec.options;
  if (options !== undefined && (typeof options !== "object" || options === null || Array.isArray(options))) err("options", "bad_options", t("options must be an object", "options는 객체여야 해요"));
  else if (options) {
    const defs = [...def.options, ...COMMON_OPTIONS];
    const optNames = defs.map((o) => o.name);
    for (const [k, v] of Object.entries(options)) {
      const o = defs.find((d) => d.name === k);
      if (!o) {
        const near = closest(k, optNames);
        warn(`options.${k}`, "unknown_option", t(`${chartName} has no option "${k}"${near ? `. Did you mean "${near}"?` : ""}`, `${chartName}에는 "${k}" 옵션이 없어요${near ? `. "${near}"인가요?` : ""}`));
        continue;
      }
      const vt = typeOf(v);
      const bad = (en: string, ko: string) => err(`options.${k}`, "bad_option_type", t(`options.${k} must be ${en} (got ${vt})`, `options.${k} 값은 ${ko} 해요(지금 ${vt})`));
      if (o.type === "number") {
        if (vt !== "number" || !Number.isFinite(v as number)) bad("a number", "숫자여야");
        else {
          if (o.min !== undefined && (v as number) < o.min) err(`options.${k}`, "out_of_range", t(`options.${k} must be at least ${o.min}`, `options.${k} 값은 ${o.min} 이상이어야 해요`));
          if (o.max !== undefined && (v as number) > o.max) err(`options.${k}`, "out_of_range", t(`options.${k} must be at most ${o.max}`, `options.${k} 값은 ${o.max} 이하여야 해요`));
        }
      } else if (o.type === "string" && vt !== "string") bad("a string", "문자열이어야");
      // upColor, downColor 같은 색 옵션은 범례에도 들어가서 범례 색과 같은 검사를 거쳐요
      else if (o.type === "string" && /Color$/.test(k) && !isSafeStyleValue(v)) err(`options.${k}`, "bad_option_color", t(`options.${k} must be a theme token ("accent") or a CSS color`, `options.${k} 값은 테마 토큰("accent")이나 CSS 색이어야 해요`));
      else if (o.type === "boolean" && vt !== "boolean") bad("true or false", "true나 false여야");
      else if (o.type === "array" && vt !== "array") bad("an array", "배열이어야");
      else if (o.type === "object" && vt !== "object") bad("an object", "객체여야");
      else if (o.type === "enum" && !(o.enum ?? []).includes(String(v))) {
        const choices = (o.enum ?? []).map((e) => `"${e}"`).join(" | ");
        err(`options.${k}`, "bad_enum", t(`options.${k} must be one of ${choices}`, `options.${k} 값은 ${choices} 중 하나여야 해요`));
      } else if (o.type === "format" && !(vt === "object" || ["number", "integer", "percent", "ratio", "compact", "currency", "decimal"].includes(String(v)))) err(`options.${k}`, "bad_format", t('format must be "number" | "integer" | "percent" | "ratio" | "compact" | "currency" | "decimal" or an Intl options object', 'format 값은 "number" | "integer" | "percent" | "ratio" | "compact" | "currency" | "decimal" 중 하나이거나 Intl 옵션 객체여야 해요'));
      else if (o.type === "format" && vt === "object") {
        // Intl이 거절하는 옵션(통화 코드 없는 style: "currency" 등)은 그릴 때 던지기 전에 여기서 알려 줘요
        const { prefix: _p, suffix: _s, ...nfo } = v as Record<string, unknown>;
        try {
          new Intl.NumberFormat("en-US", nfo as Intl.NumberFormatOptions);
        } catch (e) {
          err(`options.${k}`, "bad_format", t(`options.${k} is not valid Intl.NumberFormat options: ${(e as Error).message}`, `options.${k} 값을 Intl.NumberFormat 옵션으로 쓸 수 없어요: ${(e as Error).message}`));
        }
      } else if (o.type === "highlight" && !(vt === "number" || vt === "string" || (vt === "array" && (v as unknown[]).every((x) => typeof x === "number" || typeof x === "string")))) bad("an index, a name or an array of them", "인덱스나 이름, 또는 그 배열이어야");
    }
    if (typeof options.locale === "string") {
      try {
        Intl.getCanonicalLocales(options.locale.replace(/_/g, "-"));
      } catch {
        err("options.locale", "bad_locale", t(`options.locale "${options.locale}" is not a locale. Use a tag such as "en-US" or "ko-KR"`, `options.locale "${options.locale}" 값은 로캘이 아니에요. "en-US", "ko-KR" 같은 값을 써 주세요`));
      }
    }
    if (rows && rows.length && typeof options.highlight === "string" && !["max", "min", "first", "last", "none"].includes(options.highlight)) {
      const h = options.highlight;
      const seen = rows.slice(0, 2000).some((r) => r && typeof r === "object" && Object.values(r).some((x) => String(x) === h));
      if (!seen) warn("options.highlight", "highlight_not_found", t(`Could not find "${h}" to highlight among the data values`, `강조할 "${h}" 값을 데이터에서 찾지 못했어요`));
    }
  }

  // card
  if (spec.card !== undefined) {
    if (!spec.card || typeof spec.card !== "object" || Array.isArray(spec.card)) err("card", "bad_card", t("card must be an object", "card는 객체여야 해요"));
    else {
      const allowed = ["number", "title", "subtitle", "takeaway", "level", "legend", "sample", "replay"];
      for (const [k, v] of Object.entries(spec.card)) {
        if (!allowed.includes(k)) warn(`card.${k}`, "unknown_card_key", t(`card has no key "${k}"`, `card에는 "${k}" 키가 없어요`));
        else if (["number", "title", "subtitle", "takeaway", "level"].includes(k) && typeof v !== "string") err(`card.${k}`, "bad_card_value", t(`card.${k} must be a string`, `card.${k} 값은 문자열이어야 해요`));
        else if (k === "legend" && v !== "auto" && !Array.isArray(v)) err("card.legend", "bad_legend", t('card.legend must be "auto" or an array of [{ label, color }]', 'card.legend는 "auto" 또는 [{ label, color }] 배열이어야 해요'));
        else if (k === "legend" && Array.isArray(v))
          v.forEach((it, i) => {
            const c = it && typeof it === "object" ? (it as { color?: unknown }).color : undefined;
            if (c !== undefined && (typeof c !== "string" || !isSafeStyleValue(c))) err(`card.legend[${i}].color`, "bad_legend_color", t('A legend color must be a theme token ("accent") or a CSS color', '범례 색은 테마 토큰("accent")이나 CSS 색이어야 해요'));
          });
      }
    }
  }
  if (spec.theme && typeof spec.theme === "object" && !Array.isArray(spec.theme)) {
    for (const [k, v] of Object.entries(spec.theme)) {
      // name은 이름표라 글자 제한이 없어요 (React가 이스케이프하고 서버 SVG에는 안 들어가요)
      if (k === "name" ? typeof v !== "string" : !isSafeStyleValue(v, /family/i.test(k))) err(`theme.${k}`, "bad_theme_value", t(`theme.${k} must be a CSS color, length or font list such as "#0B8FD8", "oklch(…)", "var(--x)" or 18`, `theme.${k} 값은 "#0B8FD8", "oklch(…)", "var(--x)", 18 같은 CSS 색, 길이, 글꼴 목록이어야 해요`));
    }
  } else if (spec.theme !== undefined && spec.theme !== "dark" && spec.theme !== "light") err("theme", "bad_theme", t('theme must be "dark" | "light" or a token object', 'theme은 "dark" | "light" 또는 토큰 객체여야 해요'));

  return { valid: errors.length === 0, errors, warnings };
}

/** 오류를 사람이 읽는 줄로 */
export function formatIssues(r: ValidationResult): string {
  const lines: string[] = [];
  for (const e of r.errors) lines.push(`✗ ${e.path || "(spec)"}: ${e.message}`);
  for (const w of r.warnings) lines.push(`! ${w.path || "(spec)"}: ${w.message}`);
  return lines.join("\n");
}
