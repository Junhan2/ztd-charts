import { parseCSV } from "../data/parse";
import { hasField, numGetter, toNumber } from "../data/accessor";
import { markPercentile } from "../data/percentile";
import { HISTOGRAM_MAX_GROUPS, isPreBinned } from "../layout/stats";
import { DMY_RE, ISO_DATE_RE, TEMPLATE_NAMES, TEMPLATE_SLOT, isDateText, isoDay, toDate } from "../core/format";
import { plural } from "../core/i18n";
import { META, legendToggles, specTemplate } from "./meta";
import { ANNOTATION_TYPES, CHARTS, COMMON_OPTIONS, getChartDef, TYPE_ALIASES } from "./registry";
import type { ChartSpec, Lang, OptionDef, SpecIssue, ValidationResult } from "./types";

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

/** 숫자 o.length개가 모두 o.min~o.max 안인지. 스키마의 minItems, maxItems, minimum, maximum과 같은 규칙이에요 */
function isNumberTuple(a: number[], o: OptionDef): boolean {
  return a.length === o.length && a.every((x) => Number.isFinite(x) && x >= (o.min ?? -Infinity) && x <= (o.max ?? Infinity));
}

/** 주석 한 칸의 문제를 [영어, 한글]로. 문제가 없으면 null */
function annotationIssue(a: unknown): [string, string] | null {
  if (typeof a !== "object" || a === null || Array.isArray(a)) return ['must be an object such as { type: "line", y: 100 }', '{ type: "line", y: 100 } 같은 객체여야 해요'];
  const { type, x, y, from, label } = a as Record<string, unknown>;
  const pair = (q: unknown): q is unknown[] => Array.isArray(q) && q.length === 2;
  const list = ANNOTATION_TYPES.map((n) => `"${n}"`).join(" | ");
  if (!ANNOTATION_TYPES.includes(type as never)) return [`type must be one of ${list}`, `type 값은 ${list} 중 하나여야 해요`];
  if (label !== undefined && typeof label !== "string") return ["label must be a string", "label은 문자열이어야 해요"];
  if (type === "line" && !(typeof y === "number" && Number.isFinite(y))) return ['"line" needs a number y', '"line"에는 숫자 y가 있어야 해요'];
  if (type === "band" && !(pair(y) && y.every((n) => typeof n === "number" && Number.isFinite(n))) && !pair(x)) return ['"band" needs y: [low, high] or x: [from, to]', '"band"에는 y: [아래, 위]나 x: [시작, 끝]이 있어야 해요'];
  if (type === "event" && (x === undefined || !label)) return ['"event" needs x and label', '"event"에는 x와 label이 있어야 해요'];
  if (type === "forecast" && from === undefined) return ['"forecast" needs from (the x where the forecast starts)', '"forecast"에는 from(예측이 시작하는 x)이 있어야 해요'];
  return null;
}

/** 스카이라인만의 검사(음수, 기간 수, y 없는 front, 모두 0, 앞줄 계열 수, depth 범위). 문제를 report(오류인지, 경로, 코드, [영어, 한글])로 알려 줘요 */
function skylineIssues(rows: Record<string, unknown>[] | null, enc: Record<string, unknown>, options: unknown, fields: string[], report: (isError: boolean, path: string, code: string, msg: [string, string]) => void): void {
  const list = (v: unknown) => (Array.isArray(v) ? v : [v]).filter((f): f is string => typeof f === "string");
  const yFields = list(enc.y ?? (fields.includes("y") ? "y" : undefined));
  const frontFields = list(enc.front);
  // 데이터 필드를 모를 때(url 데이터나 빈 data)만 알려요. 필드를 알면 위 채널 검사가 missing_channel로 이미 알려요
  if (enc.front !== undefined && enc.y === undefined && !fields.length) report(true, "encoding.y", "skyline_front_without_y", ["y is required: front stands in front of the back row that y stacks", "y가 필요해요. front는 y로 쌓은 뒷줄 앞에 서요"]);
  if (frontFields.length >= 4) report(false, "encoding.front", "skyline_front_many", ["The front row reads best with 3 series or fewer", "앞줄은 3개까지 읽기 쉬워요"]);
  const depth = options && typeof options === "object" ? (options as Record<string, unknown>).depth : undefined;
  if (typeof depth === "number" && (depth < 0.1 || depth > 0.32)) report(false, "options.depth", "skyline_depth_range", ["depth is from 0.1 to 0.32, so it is pulled into that range", "depth는 0.1~0.32예요. 범위 안으로 묶어서 그려요"]);
  if (!rows || !rows.length) return;
  const xField = typeof enc.x === "string" ? enc.x : "x";
  const periods = new Set(rows.map((r) => String(r[xField] ?? ""))).size;
  const many: [string, string] = ["There are many periods, so neighboring periods are summed when drawn. bar or area may read better", "기간이 많아서 이웃 기간을 합쳐 그려요. bar나 area가 나을 수 있어요"];
  if (periods > 120) report(true, "data", "skyline_too_many_periods", many);
  else if (periods > 40) report(false, "data", "skyline_many_periods", many);
  const valueFields = [...yFields, ...frontFields];
  let negative: string | null = null;
  let positive = false;
  for (const r of rows)
    for (const f of valueFields) {
      const v = toNumber(r[f]);
      if (v < 0) negative ??= f;
      else if (v > 0) positive = true;
    }
  if (negative !== null) report(true, yFields.includes(negative) ? "encoding.y" : "encoding.front", "skyline_negative", ["Skyline stacks from 0. Use bar when there are negative values", "스카이라인은 0부터 쌓아요. 음수가 있으면 bar를 쓰세요"]);
  else if (!positive && valueFields.length) report(false, "data", "skyline_all_zero", ["Every value is 0, so there is nothing to draw", "모든 값이 0이라 그릴 값이 없어요"]);
}

type Report = (path: string, code: string, message: string) => void;

/** 범위 띠의 경계 필드 목록 (넓은 표는 y와 같은 순서의 배열, 긴 표는 하나) */
const fieldList = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);

/**
 * 범위 띠 검사 (라인, 영역). 한쪽 경계만 있음, 필드 수, 쌓은 영역(오류), 아래가 위보다 큰 행(바꿔서 그려요), 예측 주석 없는 bandFrom
 */
function checkBand(type: string, enc: Record<string, unknown>, opts: Record<string, unknown>, rows: Record<string, unknown>[] | null, t: (en: string, ko: string) => string, err: Report, warn: Report): void {
  const { lower, upper, y, series } = enc;
  if (lower === undefined && upper === undefined) return;
  if (lower === undefined || upper === undefined) {
    warn(`encoding.${lower === undefined ? "lower" : "upper"}`, "band_half", t("A range band needs both encoding.lower and encoding.upper, so nothing is drawn", "범위 띠에는 encoding.lower와 encoding.upper가 모두 있어야 해서 그리지 않아요"));
    return;
  }
  const lo = fieldList(lower);
  const hi = fieldList(upper);
  const wide = Array.isArray(y);
  const yCount = wide ? y.length : 1;
  if (wide ? lo.length !== yCount || hi.length !== yCount : lo.length > 1 || hi.length > 1)
    warn(
      "encoding.lower",
      "band_fields",
      wide
        ? t(`lower and upper need one field for each of the ${yCount} y fields. Series without one draw no band`, `lower와 upper에는 y 필드 ${yCount}개마다 필드가 하나씩 있어야 해요. 없는 계열은 띠를 그리지 않아요`)
        : t("lower and upper take one field each when y is one field. Only the first is used", "y가 필드 하나면 lower와 upper도 필드 하나씩이에요. 첫 필드만 써요"),
    );
  if (type === "area") {
    const many = yCount > 1 || (typeof series === "string" && (!rows || new Set(rows.map((r) => String(r?.[series]))).size > 1));
    if (opts.stack === "stacked" || opts.stack === "percent" || (opts.stack === undefined && many))
      err("options.stack", "band_stacked", t('A range band cannot go on stacked areas. Set options.stack to "none"', '쌓은 영역에는 범위 띠를 그릴 수 없어요. options.stack을 "none"으로 두세요'));
  }
  let crossed = 0;
  for (const r of rows ?? []) {
    for (let s = 0; s < lo.length; s++) {
      const fa = lo[s];
      const fb = hi[s];
      if (typeof fa === "string" && typeof fb === "string" && toNumber(r?.[fa]) > toNumber(r?.[fb])) crossed++;
    }
  }
  if (crossed) warn("encoding.lower", "band_crossed", t(`lower is above upper in ${crossed === 1 ? "1 row" : `${crossed} rows`}. They are swapped when drawn`, `${crossed}개 행에서 lower가 upper보다 커요. 바꿔서 그려요`));
  if (opts.bandFrom === "forecast" && !(Array.isArray(opts.annotations) && opts.annotations.some((a) => typeof a === "object" && a?.type === "forecast")))
    warn("options.bandFrom", "band_no_forecast", t('bandFrom "forecast" needs a forecast annotation. Without one no band is drawn', 'bandFrom "forecast"에는 forecast 주석이 있어야 해요. 없으면 띠를 그리지 않아요'));
}

/**
 * 같은 x(긴 표는 같은 x와 계열)가 여러 행이면 차트는 더해서 그려요. 비율, 평균처럼 더하면 안 되는 값일 수 있어 알려요.
 * aggregate를 정했으면 묻지 않아요. 큰 표는 앞 10만 행만 봐요
 */
function checkDuplicates(enc: Record<string, unknown>, opts: Record<string, unknown>, rows: Record<string, unknown>[] | null, t: (en: string, ko: string) => string, warn: Report): void {
  if (!rows || rows.length < 2 || opts.aggregate !== undefined) return;
  const xf = fieldOf(enc, "x");
  const sf = !Array.isArray(enc.y) && typeof enc.series === "string" ? enc.series : null;
  const seen = new Map<string, number>();
  let firstKey: string | null = null;
  let firstX = "";
  let places = 0;
  for (let i = 0; i < Math.min(rows.length, 100_000); i++) {
    const r = rows[i];
    const xv = r?.[xf];
    if (isBlank(xv)) continue;
    const x = String(xv);
    // 계열이 있으면 x 길이를 앞에 붙여 이어요 (x와 계열 이름의 경계가 어디든 다른 짝과 겹치지 않게)
    const key = sf ? `${x.length}:${x}${String(r[sf] ?? "")}` : x;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n !== 2) continue;
    places++;
    if (firstKey === null) {
      firstKey = key;
      firstX = x;
    }
  }
  if (firstKey === null) return;
  const times = seen.get(firstKey) ?? 2;
  const what = sf ? `${xf}, ${sf}` : xf;
  warn(
    "encoding.x",
    "duplicate_x",
    t(
      `Rows with the same ${sf ? `${xf} and ${sf}` : xf} are added together (${plural(places, "place")}, first "${firstX}" ×${times}). If they should not add up, such as rates or averages, set options.aggregate to "mean", "last" or "count"`,
      `${what} 값이 같은 행은 더해서 그려요(${places}곳, 처음 "${firstX}" ${times}행). 비율, 평균처럼 더하면 안 되는 값이면 options.aggregate를 "mean", "last", "count" 중 하나로 정해 주세요`,
    ),
  );
}

/** 조각이 이보다 많으면 기타 묶기(options.other)를 권해요 */
const MANY_SLICES = 8;

/** 파이, 도넛: 0 이하 조각은 말없이 빠지고, 조각이 많으면 서로 구분하기 어려워요 */
function checkSlices(enc: Record<string, unknown>, opts: Record<string, unknown>, rows: Record<string, unknown>[] | null, t: (en: string, ko: string) => string, warn: Report): void {
  if (!rows) return;
  const lf = fieldOf(enc, "label");
  const vf = fieldOf(enc, "value");
  const shown: string[] = [];
  let n = 0;
  for (const r of rows) {
    const v = toNumber(r?.[vf]);
    if (!Number.isFinite(v) || v > 0) continue;
    n++;
    if (shown.length < 3) shown.push(`${cellText(r?.[lf])} ${v}`);
  }
  if (n) {
    const list = listText(shown, n, t);
    warn("encoding.value", "nonpositive_slice", t(`${plural(n, "slice is", "slices are")} 0 or less and left out (${list})`, `0 이하인 조각 ${n}개는 빼고 그려요(${list})`));
  }
  if (rows.length > MANY_SLICES && opts.other === undefined)
    warn("options.other", "many_slices", t(`${rows.length} slices are hard to tell apart. options.other: 6 keeps the 6 largest and groups the rest as "Other"`, `조각이 ${rows.length}개라 구분하기 어려워요. options.other: 6이면 큰 조각 6개만 두고 나머지를 "기타"로 묶어요`));
}

/** 슬로프(긴 표, encoding.x): 처음과 마지막 기간만 그리고, 둘 중 한쪽 값이 없는 항목은 빼요. 둘 다 말없이 일어나서 알려요 */
function checkSlope(enc: Record<string, unknown>, opts: Record<string, unknown>, rows: Record<string, unknown>[] | null, t: (en: string, ko: string) => string, warn: Report): void {
  if (!rows || !rows.length || opts.start !== undefined || opts.end !== undefined) return;
  const xf = fieldOf(enc, "x");
  const lf = fieldOf(enc, "label");
  const vf = fieldOf(enc, "value");
  const xs = [...new Set(rows.map((r) => String(r?.[xf] ?? "")))];
  const first = xs[0];
  const last = xs[xs.length - 1];
  if (xs.length > 2) {
    const list = listText(xs.slice(0, 4), xs.length, t);
    warn("encoding.x", "slope_periods", t(`Only the first and last periods are drawn (${xs.length} periods: ${list})`, `처음과 마지막 기간만 그려요(기간 ${xs.length}개: ${list})`));
  }
  const has = new Map<string, [boolean, boolean]>();
  for (const r of rows) {
    const l = String(r?.[lf] ?? "");
    const x = String(r?.[xf] ?? "");
    const e = has.get(l) ?? [false, false];
    if (Number.isFinite(toNumber(r?.[vf]))) {
      if (x === first) e[0] = true;
      if (x === last) e[1] = true;
    }
    has.set(l, e);
  }
  const missing = [...has].filter(([, [a, b]]) => !a || !b).map(([l]) => l);
  if (!missing.length) return;
  const names = listText(missing.slice(0, 3).map((l) => cellText(l)), missing.length, t);
  const n = missing.length;
  warn("encoding.label", "slope_incomplete", t(`${plural(n, "item lacks", "items lack")} a value in the first (${first}) or last (${last}) period and ${n === 1 ? "is" : "are"} left out (${names})`, `처음(${first})이나 마지막(${last}) 기간 값이 없는 항목 ${n}개는 빼고 그려요(${names})`));
}

/**
 * 날짜 x(캘린더는 date)를 읽는 차트: 글자 x가 새 날짜 표기라 시간 축이 되면(선, 영역, 스트림, xType 없을 때),
 * 그리고 "05/03/2024"처럼 일, 월 순서를 알 수 없으면 행 번호와 함께 알려요. 큰 표는 앞 10만 행만 봐요
 */
function checkDates(type: string, enc: Record<string, unknown>, opts: Record<string, unknown>, rows: Record<string, unknown>[] | null, t: (en: string, ko: string) => string, warn: Report): void {
  if (!rows || !rows.length) return;
  const channel = type === "calendar" ? "date" : "x";
  const field = typeof enc[channel] === "string" ? (enc[channel] as string) : type === "candlestick" ? "date" : channel;
  const xs = rows.slice(0, 100_000).map((r) => r?.[field]);
  // 한 번 훑어서: 모두 날짜 글자인지, ISO가 아닌 첫 값(odd)
  let allText = true;
  let odd: unknown;
  let any = false;
  for (const v of xs) {
    if (isBlank(v)) continue;
    any = true;
    const s = typeof v === "string" ? v.trim() : null;
    if (odd === undefined && !(s !== null && ISO_DATE_RE.test(s))) odd = v;
    if (allText && !(s !== null && isDateText(s))) allText = false;
    if (!allText && odd !== undefined) break;
  }
  if (!any || !(type === "calendar" || type === "candlestick" || opts.xType === "date" || (opts.xType === undefined && allText))) return;
  // 연이 끝인 날짜("05/03/2024"): 일, 월 순서의 근거(dayFirstOf와 같은 규칙)와 모호한 행을 한 번에. 모두 ISO면 볼 것이 없어요
  let evidence: boolean | undefined;
  const amb: number[] = [];
  for (let i = 0; odd !== undefined && i < xs.length && evidence !== true; i++) {
    const m = typeof xs[i] === "string" ? DMY_RE.exec((xs[i] as string).trim()) : null;
    if (!m) continue;
    if (+m[1] > 12) evidence = true;
    else if (+m[3] > 12) evidence = false;
    else if (+m[1] !== +m[3]) amb.push(i);
  }
  if ((type === "line" || type === "area" || type === "stream") && opts.xType === undefined && allText) {
    const d = odd === undefined ? null : toDate(odd, opts.dayFirst === true || (opts.dayFirst === undefined && evidence === true));
    if (d) {
      const ymd = isoDay(d.getTime());
      warn("encoding.x", "x_read_as_date", t(`x values such as ${cellText(odd)} are read as dates (${ymd}) and placed by time. Set options.xType to "date" to keep this without the warning, or to "band" to space them evenly as text`, `${cellText(odd)} 같은 x 값을 날짜(${ymd})로 읽어 시간 간격대로 놓아요. 이대로 두려면 options.xType을 "date"로, 글자로 고르게 놓으려면 "band"로 정해 주세요`));
    }
  }
  if (opts.dayFirst !== undefined || evidence !== undefined || !amb.length) return;
  const shown = amb.slice(0, 3).map((i) => i + 1);
  const more = amb.length > shown.length;
  const v = cellText(xs[amb[0]]);
  warn(
    `encoding.${channel}`,
    "date_order_ambiguous",
    t(
      `Dates such as ${v} (${shown.length === 1 ? "row" : "rows"} ${shown.join(", ")}${more ? ", …" : ""}) could be month first or day first, and are read month first. Set options.dayFirst to true if the day comes first`,
      `${v} 같은 날짜(${shown.join(", ")}행${more ? " 등" : ""})는 월이 앞인지 일이 앞인지 알 수 없어서 월을 앞으로 읽었어요. 일이 앞이면 options.dayFirst를 true로 정해 주세요`,
    ),
  );
}

/** 경고 문구에 넣는 칸 값 (길면 줄여요) */
function cellText(v: unknown): string {
  const s = typeof v === "string" ? JSON.stringify(v) : String(v);
  return s.length > 24 ? `${s.slice(0, 23)}…` : s;
}

/** 경고 문구의 목록: 보여 줄 것을 쉼표로 잇고, 전체가 더 많으면 영어 ", …", 한국어 " 등"을 붙여요 */
function listText(shown: string[], total: number, t: (en: string, ko: string) => string): string {
  return `${shown.join(", ")}${total > shown.length ? t(", …", " 등") : ""}`;
}

/**
 * 로그 눈금(yScale "log"): 0 이하 y 값은 빼고 그려서 그 수와 앞의 행 3개까지 알려요(앞 10만 행, 넓은 표는 y 필드마다).
 * 양 끝이 0보다 크지 않은 yDomain과 추세선(fit)은 쓰지 않아요
 */
function checkLogScale(enc: Record<string, unknown>, o: Record<string, unknown>, rows: Record<string, unknown>[] | null, t: (en: string, ko: string) => string, warn: Report) {
  if (o.yScale !== "log") return;
  const yd = o.yDomain;
  if (Array.isArray(yd) && !((yd[0] as number) > 0 && (yd[1] as number) > 0)) warn("options.yDomain", "ignored_option", t('yDomain needs both ends above 0 with yScale "log", so it is not used', 'yScale이 "log"면 yDomain 양 끝이 0보다 커야 해서 쓰지 않아요'));
  if (o.fit !== undefined) warn("options.fit", "ignored_option", t('The trend line (fit) is not drawn with yScale "log"', 'yScale이 "log"면 추세선(fit)을 그리지 않아요'));
  if (!rows?.length) return;
  const ys = fieldList(enc.y ?? "y").filter((f): f is string => typeof f === "string");
  let n = 0;
  const shown: string[] = [];
  rows.slice(0, 100_000).forEach((r, i) => {
    for (const f of ys) {
      const v = toNumber(r?.[f]);
      if (!(v <= 0)) continue;
      n++;
      if (shown.length < 3) shown.push(t(`row ${i + 1} ${cellText(r[f])}`, `${i + 1}행 ${cellText(r[f])}`));
    }
  });
  if (n) warn("options.yScale", "nonpositive_log", t(`${plural(n, "value")} at or below 0 ${n === 1 ? "is" : "are"} left out, because a log scale cannot show them (${listText(shown, n, t)})`, `로그 눈금은 0 이하를 그릴 수 없어서 0 이하 값 ${n}개는 빼고 그려요(${listText(shown, n, t)})`));
}

/** 인코딩의 필드 이름. 문자열이 아니면 기본 이름(x, label, value 등) */
function fieldOf(enc: Record<string, unknown>, k: string): string {
  return typeof enc[k] === "string" ? (enc[k] as string) : k;
}

/** 빈 칸: 없음, null, 빈 글자 */
function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/**
 * 히스토그램만의 옵션 검사. log면 모든 값(미리 나눈 행은 구간 시작, 경계)이 0보다 커야 해요. 그룹은 2개까지 겹쳐요.
 * 필요한 채널(원시 행은 value, 미리 나눈 행은 x0, x1, count)은 채널 검사가 봐요
 */
function checkHistogram(rows: Record<string, unknown>[] | null, enc: Record<string, unknown>, o: Record<string, unknown>, binned: boolean, err: Report, warn: Report, t: (en: string, ko: string) => string) {
  const log = o.log === true;
  if (log && rows?.length) {
    const k = binned ? "x0" : "value";
    const f = enc[k];
    const read = numGetter<Record<string, unknown>>(typeof f === "string" ? f : undefined, k);
    const bad = rows.filter((r, i) => read(r, i) <= 0).length;
    if (bad) err("options.log", "log_not_positive", t(`log needs every value above 0, and ${bad} ${binned ? "bins start" : "values are"} at or below 0`, `log를 쓰려면 모든 값이 0보다 커야 해요(0 이하 ${bad}개)`));
  }
  if (Array.isArray(o.edges)) {
    const e = o.edges.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    if (!(e.length >= 2 && e.length === o.edges.length && e.every((x, i) => i === 0 || x > e[i - 1]))) err("options.edges", "bad_edges", t("options.edges must be 2 or more numbers, smallest first", "options.edges 값은 작은 것부터 늘어놓은 숫자 2개 이상이어야 해요"));
    else if (log && e[0] <= 0) err("options.edges", "log_not_positive", t("With log, every edge must be above 0", "log면 모든 경계가 0보다 커야 해요"));
  }
  if (typeof o.binWidth === "number" && !(o.binWidth > 0)) err("options.binWidth", "out_of_range", t("options.binWidth must be above 0", "options.binWidth 값은 0보다 커야 해요"));
  else if (o.binWidth !== undefined && log) warn("options.binWidth", "ignored_option", t("binWidth is not used with log: true. Use bins or edges", "log: true면 binWidth를 쓰지 않아요. bins나 edges를 써 주세요"));
  const th = o.threshold;
  if (th && typeof th === "object" && !Array.isArray(th)) {
    const { value, side, label } = th as Record<string, unknown>;
    if (!(typeof value === "number" && Number.isFinite(value)) || (side !== undefined && side !== "above" && side !== "below") || (label !== undefined && typeof label !== "string"))
      err("options.threshold", "bad_threshold", t('options.threshold must be { value: number, label?: string, side?: "above" | "below" }', 'options.threshold 값은 { value: 숫자, label?: 문자열, side?: "above" | "below" } 꼴이어야 해요'));
  }
  if (Array.isArray(o.marks)) {
    const bad = o.marks.filter((m) => !(typeof m === "string" && Number.isFinite(markPercentile(m))));
    if (bad.length) err("options.marks", "bad_marks", t(`options.marks takes percentiles from "p0" to "p100", such as "p95" (got ${bad.map(String).join(", ")})`, `options.marks 값은 "p95"처럼 "p0"~"p100" 사이 분위여야 해요(지금 ${bad.map(String).join(", ")})`));
  }
  if (rows?.length && typeof enc.group === "string") {
    const g = enc.group;
    const groups = new Set(rows.map((r) => (r && typeof r === "object" ? String(r[g] ?? "") : "")));
    const k = HISTOGRAM_MAX_GROUPS;
    if (groups.size > k) warn("encoding.group", "too_many_groups", t(`A histogram overlays up to ${k} groups, and the data has ${groups.size}, so only the first ${k} are drawn. Use ridgeline for more`, `히스토그램은 그룹을 ${k}개까지 겹쳐요. 데이터에 ${groups.size}개가 있어서 앞의 ${k}개만 그려요. 더 많으면 ridgeline을 써 주세요`));
  }
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
  // 0.4까지 scatter는 bubble의 별칭이라, size 채널이 있으면 그때처럼 bubble로 그려요 (resolveDef와 같은 규칙)
  if (def?.type === "scatter" && spec.encoding && typeof spec.encoding === "object" && (spec.encoding as Record<string, unknown>).size !== undefined) {
    def = getChartDef("bubble");
    warn("type", "alias", t('"scatter" with a size channel is drawn as "bubble"', 'size 채널이 있는 "scatter"는 "bubble" 차트로 그려요'));
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
  // 히스토그램은 행 모양에 따라 필요한 채널이 달라요: 원시 행은 value, 미리 나눈 행은 x0, x1, count
  const binned = def.type === "histogram" && isPreBinned(rows?.find((r) => r && typeof r === "object"), enc.value, enc.count);
  const needed = def.type !== "histogram" ? null : binned ? ["x0", "x1", "count"] : ["value"];
  for (const c of def.encoding) {
    const v = enc[c.name];
    if (v === undefined) {
      if (c.required || needed?.includes(c.name)) {
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
        // 숫자로 못 읽는 칸("n/a", "#N/A", "-")은 빈 칸으로 그려요. 절반 넘게 글자일 때만 숫자 열이 아니라고 봐요
        let bad = 0;
        const examples: string[] = [];
        sample.forEach((r, i) => {
          const x = r && typeof r === "object" ? r[f] : undefined;
          if (isBlank(x) || Number.isFinite(toNumber(x))) return;
          bad++;
          if (examples.length < 3) examples.push(t(`row ${i + 1} ${cellText(x)}`, `${i + 1}행 ${cellText(x)}`));
        });
        const ok = 1 - bad / vals.length;
        if (ok < 0.5) err(`encoding.${c.name}`, "not_numeric", t(`Field "${f}" must be numeric (${Math.round(ok * 100)}% of values read as numbers)`, `"${f}" 필드는 숫자여야 해요(숫자로 읽히는 값 ${Math.round(ok * 100)}%)`));
        else if (bad) {
          const list = listText(examples, bad, t);
          const part = rows.length > sample.length;
          warn(
            `encoding.${c.name}`,
            "some_not_numeric",
            t(
              `${plural(bad, "value")} in "${f}"${part ? ` (first ${sample.length} rows)` : ""} ${bad === 1 ? "is" : "are"} not a number and drawn as a gap (${list})`,
              `${part ? `앞 ${sample.length}행 중 ` : ""}"${f}" 값 ${bad}개는 숫자가 아니라 빈 칸으로 그려요(${list})`,
            ),
          );
        }
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
      if (!o && k === "yScale" && (def.type === "area" || def.type === "bar")) {
        warn(`options.${k}`, "unknown_option", t(`${chartName} has no option "yScale": its length from 0 is the value, so it has no log scale. Use line, scatter or bubble with yScale "log"`, `${chartName}에는 "yScale" 옵션이 없어요. 0부터의 길이가 값이라 로그 눈금을 쓰지 않아요. 로그 눈금은 line, scatter, bubble에서 yScale "log"로 써요`));
        continue;
      }
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
      else if (o.type === "tooltip" && vt !== "boolean" && !(vt === "object" && Object.keys(v as object).length === 1 && typeof (v as { template?: unknown }).template === "string"))
        bad('true, false or { template: "…" }', 'true, false, { template: "…" } 중 하나여야');
      else if (o.type === "array" && vt !== "array") bad("an array", "배열이어야");
      // 항목 수가 정해진 숫자 배열(상자 그림 whiskers 등)은 개수와 범위를 봐요. 순서는 쓰는 쪽에서 맞춰요
      else if (o.type === "array" && o.length !== undefined && !isNumberTuple(v as number[], o))
        err(`options.${k}`, "bad_option_items", t(`options.${k} must be ${o.length} numbers from ${o.min} to ${o.max}`, `options.${k} 값은 ${o.min}~${o.max} 사이 숫자 ${o.length}개여야 해요`));
      else if (o.type === "object" && vt !== "object") bad("an object", "객체여야");
      else if (o.type === "annotations" && vt !== "array") bad("an array", "배열이어야");
      else if (o.type === "annotations")
        (v as unknown[]).forEach((a, i) => {
          const issue = annotationIssue(a);
          if (issue) err(`options.${k}[${i}]`, "bad_annotation", t(...issue));
        });
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
    if (def.type === "bar" && options.orientation === "horizontal" && Array.isArray(options.annotations) && options.annotations.length)
      warn("options.annotations", "annotations_ignored", t("Annotations are drawn on vertical bars only", "주석은 세로 막대에서만 그려요"));
    // 툴팁 틀의 {이름}이 데이터 열에 없으면 그 줄은 늘 빠져요
    const template = specTemplate(spec);
    if (template && fields.length)
      for (const [, raw] of template.matchAll(TEMPLATE_SLOT)) {
        const n = raw.trim();
        if (TEMPLATE_NAMES.includes(n) || fields.includes(n)) continue;
        const near = closest(n, fields);
        warn("options.tooltip", "tooltip_field_not_found", t(`{${n}} is not a column of data, so lines with it are left out.${near ? ` Did you mean {${near}}?` : ""}`, `{${n}} 열이 데이터에 없어서 그 칸이 든 줄은 빼요.${near ? ` {${near}}인가요?` : ""}`));
      }
    if (def.type === "bar" && (enc.line as string[] | undefined)?.length && (options.orientation === "horizontal" || options.layout === "percent"))
      warn("encoding.line", "line_ignored", t('encoding.line is drawn on vertical bars only, not with layout "percent"', 'encoding.line 선은 세로 막대에만 그리고 layout "percent"에는 그리지 않아요'));
    if (typeof options.locale === "string") {
      try {
        Intl.getCanonicalLocales(options.locale.replace(/_/g, "-"));
      } catch {
        err("options.locale", "bad_locale", t(`options.locale "${options.locale}" is not a locale. Use a tag such as "en-US" or "ko-KR"`, `options.locale "${options.locale}" 값은 로캘이 아니에요. "en-US", "ko-KR" 같은 값을 써 주세요`));
      }
    }
    if (rows && rows.length && typeof options.highlight === "string" && !["max", "min", "first", "last", "none"].includes(options.highlight)) {
      const h = options.highlight;
      // 넓은 표(y가 열 배열)에서는 열 이름이 계열 이름이에요. 데이터 값에 없어도 강조돼요
      const seriesColumn = Object.values(enc).some((v) => Array.isArray(v) && v.includes(h));
      const seen = seriesColumn || rows.slice(0, 2000).some((r) => r && typeof r === "object" && Object.values(r).some((x) => String(x) === h));
      if (!seen) warn("options.highlight", "highlight_not_found", t(`Could not find "${h}" to highlight among the data values`, `강조할 "${h}" 값을 데이터에서 찾지 못했어요`));
    }
  }

  if (def.type === "skyline")
    skylineIssues(rows, enc, options, fields, (isError, path, code, [en, ko]) => (isError ? err : warn)(path, code, t(en, ko)));

  const optsObj = options && typeof options === "object" && !Array.isArray(options) ? (options as Record<string, unknown>) : {};
  if (def.type === "line" || def.type === "area") checkBand(def.type, enc, optsObj, rows, t, err, warn);
  // 같은 x를 합쳐 그리는 차트는 aggregate 옵션이 있는 차트예요
  if (def.options.some((o) => o.name === "aggregate")) checkDuplicates(enc, optsObj, rows, t, warn);
  if (def.type === "pie" || def.type === "donut") checkSlices(enc, optsObj, rows, t, warn);
  if (def.type === "slope") checkSlope(enc, optsObj, rows, t, warn);
  // 날짜를 읽는 차트는 dayFirst 옵션이 있는 차트예요
  if (def.options.some((o) => o.name === "dayFirst")) checkDates(def.type, enc, optsObj, rows, t, warn);
  if (def.type === "histogram") checkHistogram(rows, enc, optsObj, binned, err, warn, t);
  if (def.options.some((o) => o.name === "yScale")) checkLogScale(enc, optsObj, rows, t, warn);

  // card
  if (spec.card !== undefined) {
    if (!spec.card || typeof spec.card !== "object" || Array.isArray(spec.card)) err("card", "bad_card", t("card must be an object", "card는 객체여야 해요"));
    else {
      const allowed = ["number", "title", "subtitle", "takeaway", "level", "legend", "sample", "replay", "source", "note", "accent", "download"];
      for (const [k, v] of Object.entries(spec.card)) {
        if (!allowed.includes(k)) warn(`card.${k}`, "unknown_card_key", t(`card has no key "${k}"`, `card에는 "${k}" 키가 없어요`));
        else if (["number", "title", "subtitle", "takeaway", "level", "source", "note", "accent"].includes(k) && typeof v !== "string") err(`card.${k}`, "bad_card_value", t(`card.${k} must be a string`, `card.${k} 값은 문자열이어야 해요`));
        else if (k === "download" && typeof v !== "boolean" && !(Array.isArray(v) && v.length && v.every((f) => f === "csv" || f === "svg" || f === "png")))
          err("card.download", "bad_card_value", t('card.download must be true or an array of "csv", "svg", "png"', 'card.download 값은 true 또는 "csv", "svg", "png" 배열이어야 해요'));
        else if (k === "legend" && v !== "auto" && v !== "toggle" && !Array.isArray(v)) err("card.legend", "bad_legend", t('card.legend must be "auto", "toggle" or an array of [{ label, color }]', 'card.legend는 "auto", "toggle" 또는 [{ label, color }] 배열이어야 해요'));
        // 켜고 끄는 범례는 계열을 숨길 수 있는(hidden) 차트에서만. 막대 위 선이 있으면 선은 숨길 수 없어서 보통 범례로 그려요
        else if (k === "legend" && v === "toggle" && !legendToggles(def.type, enc, optsObj))
          warn("card.legend", "legend_toggle_ignored", t('card.legend "toggle" works on line, area, bar and scatter, so this chart draws a plain legend', 'card.legend "toggle"은 line, area, bar, scatter에서만 켜고 꺼요. 이 차트는 보통 범례로 그려요'));
        else if (k === "legend" && Array.isArray(v))
          v.forEach((it, i) => {
            const c = it && typeof it === "object" ? (it as { color?: unknown }).color : undefined;
            if (c !== undefined && (typeof c !== "string" || !isSafeStyleValue(c))) err(`card.legend[${i}].color`, "bad_legend_color", t('A legend color must be a theme token ("accent") or a CSS color', '범례 색은 테마 토큰("accent")이나 CSS 색이어야 해요'));
          });
      }
      const { accent, title } = spec.card as { accent?: unknown; title?: unknown };
      if (typeof accent === "string" && typeof title === "string" && !title.includes(accent))
        warn("card.accent", "accent_not_in_title", t(`card.accent "${accent}" is not in the title, so nothing is colored. Use a word from the title`, `card.accent의 "${accent}" 단어가 제목에 없어서 칠하지 않아요. 제목 속 단어를 넣어 주세요`));
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
