import { parseCSV } from "../data/parse";
import { hasField, numGetter, strGetter, toNumber, uniq } from "../data/accessor";
import { markPercentile } from "../data/percentile";
import { HISTOGRAM_MAX_GROUPS, isPreBinned } from "../layout/stats";
import { ARC_MAX_DOTS } from "../layout/seats";
import { r2 } from "../core/geometry";
import { gridName, mergedAway, resolveGrid, TILE_MAPS, tileMatcher, tileNames, type TileDef } from "../layout/tileGrid";
import { readTimeline, timelineDomain } from "../layout/timeline";
import { findNodes, preorder, stratify } from "../layout/tree";
import { nameMatcher } from "../layout/regions";
import { GEOJSON_LIMITS, geojsonShapes, geojsonSize } from "../geo/codec";
import { BUILTIN_MAPS, chooseMap, isFeatureCollection, isGeoMap, mapExportName, mapMatcher, regionKeys, registeredMaps, type MapChoice } from "../geo/registry";
import { MAX_FLOWS, MAX_POINTS, choosePlaceMap, flowPlace, placeDomain, placeEntry, placeIn, symbolPlace, validLonLat, type PlaceDomain } from "../geo/places";
import type { GeoJSONFeatureCollection, GeoMap } from "../geo/types";
import { HIGHLIGHT_KEYWORDS } from "../core/highlight";
import { DMY_RE, ISO_DATE_RE, TEMPLATE_NAMES, TEMPLATE_SLOT, isDateText, isoDay, toDate } from "../core/format";
import { plural } from "../core/i18n";
import { FACET_MAX, FACET_TYPES, META, hexBinned, legendToggles, specTemplate } from "./meta";
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
  // NaN, Infinity는 typeof가 "number"라 "숫자여야 해요(지금 number)"처럼 읽혀서 값 그대로 적어요
  return typeof v === "number" && !Number.isFinite(v) ? String(v) : typeof v;
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
function checkDuplicates(enc: Record<string, unknown>, opts: Record<string, unknown>, rows: Record<string, unknown>[] | null, t: (en: string, ko: string) => string, warn: Report, facetBy?: string, path = "encoding.x"): void {
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
    // facet이 있으면 패널마다 따로 그려서 패널 값도 키 앞에 붙여요 (지역마다 같은 주는 더하지 않아요)
    const panel = facetBy ? String(r[facetBy] ?? "") : "";
    const key = `${facetBy ? `${panel.length}:${panel}` : ""}${sf ? `${x.length}:${x}${String(r[sf] ?? "")}` : x}`;
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
    path,
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
  // 날짜를 읽는 채널: 캘린더는 date, 타임라인은 start와 end(차트처럼 두 열을 함께 봐요), 나머지는 x
  const channels = type === "calendar" ? ["date"] : type === "timeline" ? ["start", "end"] : ["x"];
  const channel = channels[0];
  const head = rows.slice(0, 100_000);
  const xs = channels.flatMap((ch) => {
    const field = typeof enc[ch] === "string" ? (enc[ch] as string) : type === "candlestick" ? "date" : ch;
    return head.map((r) => r?.[field]);
  });
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
  // 두 열을 이어 봤으면 행 번호는 열 길이로 나눈 나머지예요 (같은 행이 두 번 나오지 않게)
  const ambRows = uniq(amb.map((i) => String((i % head.length) + 1)));
  const shown = ambRows.slice(0, 3);
  const more = ambRows.length > shown.length;
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

/**
 * 막대의 sort 값과 양쪽 막대(layout "diverging") 검사. negative, neutral 이름이 계열(넓은 표는 y 필드, 긴 표는 series 값)에 없으면 오류예요.
 * diverging이 아닌데 쓴 negative, neutral, percent, 쪽 정렬과 diverging에 그리지 않는 주석, 선은 알려요
 */
function checkDiverging(enc: Record<string, unknown>, o: Record<string, unknown>, rows: Record<string, unknown>[] | null, t: (en: string, ko: string) => string, err: Report, warn: Report): void {
  const side = o.sort === "positive" || o.sort === "negative";
  if (o.sort !== undefined && typeof o.sort !== "boolean" && !side) err("options.sort", "bad_option_type", t('options.sort must be true, false, "positive" or "negative"', 'options.sort 값은 true, false, "positive", "negative" 중 하나여야 해요'));
  if (o.layout !== "diverging") {
    for (const k of ["negative", "neutral", "percent"]) if (o[k] !== undefined) warn(`options.${k}`, "ignored_option", t(`options.${k} is used only with layout "diverging"`, `options.${k} 옵션은 layout "diverging"에서만 써요`));
    if (side) warn("options.sort", "ignored_option", t(`sort "${o.sort}" is used only with layout "diverging"`, `sort "${o.sort}" 값은 layout "diverging"에서만 써요`));
    return;
  }
  if (o.orientation !== "horizontal" && Array.isArray(o.annotations) && o.annotations.length) warn("options.annotations", "annotations_ignored", t('Annotations are not drawn with layout "diverging"', '주석은 layout "diverging"에서 그리지 않아요'));
  if (o.orientation !== "horizontal" && ([] as unknown[]).concat(enc.line ?? []).length) warn("encoding.line", "line_ignored", t('encoding.line is not drawn with layout "diverging"', 'encoding.line 선은 layout "diverging"에서 그리지 않아요'));
  const sf = typeof enc.series === "string" ? enc.series : null;
  if (!Array.isArray(enc.y) && !rows?.length) return;
  const series = Array.isArray(enc.y) ? enc.y.map(String) : sf ? uniq((rows ?? []).map((r) => String(r?.[sf] ?? ""))) : [];
  const names: [string, unknown][] = [...(Array.isArray(o.negative) ? o.negative.map((n, i): [string, unknown] => [`options.negative[${i}]`, n]) : []), ...(typeof o.neutral === "string" ? [["options.neutral", o.neutral] as [string, unknown]] : [])];
  for (const [path, raw] of names) {
    const name = String(raw);
    // 가운데 계열은 0선 양쪽에 반씩이라 negative에 같이 넣으면 다른 계열 자리가 어긋나요
    if (path !== "options.neutral" && name === o.neutral) {
      err(path, "neutral_in_negative", t(`"${name}" is the neutral series, so it cannot also be in options.negative. Remove it from one of them`, `"${name}" 계열은 neutral이라 options.negative에 함께 넣을 수 없어요. 한쪽에서 빼 주세요`));
      continue;
    }
    if (series.includes(name)) continue;
    const near = closest(name, series);
    const list = listText(series.slice(0, 8), series.length, t);
    err(
      path,
      "series_not_found",
      series.length
        ? t(`"${name}" is not a series.${near ? ` Did you mean "${near}"?` : ""} Series: ${list}`, `"${name}" 계열이 없어요.${near ? ` "${near}"인가요?` : ""} 있는 계열: ${list}`)
        : t(`"${name}" is not a series: this chart has one series. Set encoding.series, or y as an array of fields`, `"${name}" 계열이 없어요. 계열이 하나뿐이라 encoding.series나 y 필드 배열을 정해 주세요`),
    );
  }
}

/**
 * 와플 반원(shape "arc") 검사. 격자에서 쓴 referenceLines, 반원에서 쓴 cells, columns는 쓰지 않는다고 알려요.
 * 반원: 음수는 0으로, total이 0 이하이거나 합보다 작으면 합으로 그리고, ARC_MAX_DOTS를 넘는 단위는 점 하나가 여러 단위, 0과 전체 밖의 기준선은 그리지 않아요
 */
function checkWaffle(enc: Record<string, unknown>, o: Record<string, unknown>, rows: Record<string, unknown>[] | null, t: (en: string, ko: string) => string, warn: Report): void {
  if (o.shape !== "arc") {
    if (o.referenceLines !== undefined) warn("options.referenceLines", "ignored_option", t('options.referenceLines is used only with shape "arc"', 'options.referenceLines 옵션은 shape "arc"에서만 써요'));
    return;
  }
  for (const k of ["cells", "columns"]) if (o[k] !== undefined) warn(`options.${k}`, "ignored_option", t(`options.${k} is not used with shape "arc": each dot is one unit`, `shape "arc"에서는 점 하나가 한 단위라 options.${k} 옵션을 쓰지 않아요`));
  const tot = typeof o.total === "number" && Number.isFinite(o.total) ? o.total : undefined;
  if (tot !== undefined && tot <= 0) warn("options.total", "bad_total", t("options.total must be above 0, so the sum of the values is used", "options.total 값은 0보다 커야 해요. 값의 합으로 그려요"));
  if (!rows) return;
  const vf = fieldOf(enc, "value");
  let s = 0;
  let neg = 0;
  rows.forEach((r) => {
    const v = toNumber(r?.[vf]);
    if (v < 0) neg++;
    if (Number.isFinite(v) && v > 0) s += v;
  });
  if (neg) warn("encoding.value", "negative_value", t(`${plural(neg, "negative value")} ${neg === 1 ? "is" : "are"} drawn as 0`, `음수 ${neg}개는 0으로 그려요`));
  const shown = (v: number) => String(r2(v));
  if (tot !== undefined && tot > 0 && tot < s) warn("options.total", "total_below_sum", t(`options.total (${shown(tot)}) is less than the sum of the values (${shown(s)}), so the sum is used`, `options.total(${shown(tot)})이 값의 합(${shown(s)})보다 작아서 합으로 그려요`));
  const whole = tot !== undefined && tot >= s && tot > 0 ? tot : s;
  const units = Math.round(whole);
  if (units > ARC_MAX_DOTS) warn(tot === whole ? "options.total" : "data", "too_many_units", t(`${shown(units)} units are more than ${ARC_MAX_DOTS} dots, so each dot stands for about ${shown(units / ARC_MAX_DOTS)} units`, `단위 ${shown(units)}개는 점 ${ARC_MAX_DOTS}개보다 많아서 점 하나가 약 ${shown(units / ARC_MAX_DOTS)}이에요`));
  if (Array.isArray(o.referenceLines))
    o.referenceLines.forEach((r, i) => {
      const v = r && typeof r === "object" ? (r as Record<string, unknown>).value : undefined;
      if (typeof v === "number" && Number.isFinite(v) && (v < 0 || v > whole)) warn(`options.referenceLines[${i}]`, "reference_out_of_range", t(`A reference line at ${shown(v)} is outside 0 to ${shown(whole)}, so it is not drawn`, `${shown(v)} 기준선은 0~${shown(whole)} 밖이라 그리지 않아요`));
    });
}

/**
 * 산점도 육각 밀도(bin "hex") 검사. 칸은 모든 점의 수라 계열, 크기, 점 이름, 흔들림, 숨김, 점 라벨 수, 강조를 쓰지 않고, 칸은 SVG 경로라 캔버스로 바꾸지 않아요.
 * bin 없이 쓴 binSize, colorSteps도 알려요. 작은 여러 개는 패널을 고르는 강조를 쓰니 강조는 facet이 없을 때만 알려요
 */
function checkHexbin(enc: Record<string, unknown>, o: Record<string, unknown>, faceted: boolean, t: (en: string, ko: string) => string, warn: Report): void {
  if (!hexBinned(o)) {
    for (const k of ["binSize", "colorSteps"]) if (o[k] !== undefined) warn(`options.${k}`, "ignored_option", t(`options.${k} is used only with bin "hex"`, `options.${k} 옵션은 bin "hex"에서만 써요`));
    return;
  }
  const channels: [string, string, string][] = [
    ["series", 'Each hexagon counts every dot, so series are not colored. To compare series, split them with facet: { by }', "칸은 모든 점의 수라 계열을 색으로 나누지 않아요. 계열끼리 견주려면 facet: { by }로 나눠 주세요"],
    ["size", "Hexagons are shaded by count, so size is not used and the chart is not drawn as a bubble chart", "칸은 점 수로 칠해서 크기는 쓰지 않고 버블 차트로 그리지 않아요"],
    ["label", "Dots are not drawn one by one, so their names are not shown", "점을 하나씩 그리지 않아서 점 이름은 보이지 않아요"],
  ];
  for (const [k, en, ko] of channels) if (enc[k] !== undefined) warn(`encoding.${k}`, "ignored_option", t(`encoding.${k} is not used with bin "hex". ${en}`, `bin "hex"에서는 encoding.${k} 채널을 쓰지 않아요. ${ko}`));
  const ignored = ["jitter", "hidden", "maxLabels", ...(faceted ? [] : ["highlight"])];
  for (const k of ignored) if (o[k] !== undefined) warn(`options.${k}`, "ignored_option", t(`options.${k} is not used with bin "hex", which draws counts per hexagon instead of dots`, `bin "hex"는 점 대신 칸마다 점 수를 그려서 options.${k} 옵션을 쓰지 않아요`));
  if (o.canvasThreshold !== undefined) warn("options.canvasThreshold", "ignored_option", t('options.canvasThreshold is not used with bin "hex": hexagons are a few SVG paths at any dot count, so the chart never switches to canvas', 'bin "hex"에서는 options.canvasThreshold를 쓰지 않아요. 점이 아무리 많아도 칸은 SVG 경로 몇 개라 캔버스로 바꾸지 않아요'));
}

/**
 * 산점도 고정 범위(xDomain, yDomain) 검사. 두 끝이 유한한 숫자 [작은 값, 큰 값]이 아니면 오류이고, 차트는 그 범위 대신 데이터 범위를 써요.
 * 로그 눈금에서 0 이하에 닿는 yDomain과, 범위 안에 점이 하나도 없는 경우(빈 그림)는 알려요
 */
function checkPointRanges(enc: Record<string, unknown>, o: Record<string, unknown>, rows: Record<string, unknown>[] | null, t: (en: string, ko: string) => string, err: Report, warn: Report): void {
  const ok: Record<string, [number, number]> = {};
  for (const k of ["xDomain", "yDomain"]) {
    const v = o[k];
    if (v === undefined || !Array.isArray(v)) continue;
    if (v.length !== 2 || !v.every((x) => typeof x === "number" && Number.isFinite(x))) err(`options.${k}`, "bad_domain", t(`options.${k} must be two finite numbers [start, end], such as [0, 100]. The data range is used instead`, `options.${k} 값은 [0, 100]처럼 유한한 숫자 두 개 [처음, 끝]이어야 해요. 대신 데이터 범위를 써요`));
    else if (v[0] >= v[1]) err(`options.${k}`, "bad_domain", t(`options.${k} must have the smaller value first and two different ends (got [${v[0]}, ${v[1]}]). The data range is used instead`, `options.${k} 값은 작은 값이 먼저이고 두 끝이 달라야 해요(지금 [${v[0]}, ${v[1]}]). 대신 데이터 범위를 써요`));
    else ok[k] = v as [number, number];
  }
  if (o.yScale === "log" && ok.yDomain && ok.yDomain[0] <= 0) {
    warn("options.yDomain", "ignored_option", t("options.yDomain is not used on a log scale because it reaches 0 or below", "로그 눈금은 0 이하를 그릴 수 없어서 0 이하에 닿는 options.yDomain은 쓰지 않아요"));
    delete ok.yDomain;
  }
  if (!rows?.length || (!ok.xDomain && !ok.yDomain)) return;
  const gx = numGetter<Record<string, unknown>>(fieldOf(enc, "x"), "x");
  const gy = numGetter<Record<string, unknown>>(fieldOf(enc, "y"), "y");
  const inside = (v: number, d?: [number, number]) => !d || (v >= d[0] && v <= d[1]);
  let finite = 0;
  for (let i = 0; i < rows.length; i++) {
    const x = gx(rows[i], i);
    const y = gy(rows[i], i);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (inside(x, ok.xDomain) && inside(y, ok.yDomain)) return;
    finite++;
  }
  if (finite) warn(ok.xDomain ? "options.xDomain" : "options.yDomain", "domain_empty", t(`None of the ${plural(finite, "dot")} fall inside the fixed range, so the chart says "No points in this range."`, `점 ${finite}개 중 고정 범위 안에 드는 점이 없어서 차트에 "이 범위에는 점이 없어요."라고 적어요`));
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
 * 트리 검사: id/parent 행의 겹친 id, 없는 부모, 고리(모두 뿌리 아래에 그려요), 음수 값(0으로 셈),
 * 강조와 접기의 이름이나 경로가 노드에 없는지. id/parent 행은 차트와 같은 stratify로 트리를 만들어 봐요.
 * 다른 모양(group, path, children)은 buildTree를 부르지 않고 같은 이름 경로를 직접 만들어요 (부르면 트리맵, 선버스트 번들이 커져요)
 */
function checkTree(rows: Record<string, unknown>[] | null, enc: Record<string, unknown>, o: Record<string, unknown>, warn: Report, t: (en: string, ko: string) => string) {
  if (!rows?.length) return;
  const str = (k: string) => (typeof enc[k] === "string" ? (enc[k] as string) : undefined);
  const path = Array.isArray(o.path) ? o.path.filter((x): x is string => typeof x === "string") : undefined;
  const parent = str("parent");
  const group = str("group");
  if (parent && (group || path?.length)) warn("encoding.parent", "tree_parent_wins", t("encoding.parent is set, so group and path are ignored: each row is one node under its parent", "encoding.parent가 있어서 group과 path는 쓰지 않아요. 행마다 노드 하나이고 부모 아래에 달려요"));
  const issues: Record<string, string[]> = { duplicate_id: [], missing_parent: [], cycle: [] };
  const lf = fieldOf(enc, "label");
  // 노드의 { id, label }: id/parent 행은 차트와 같은 stratify로, 다른 모양은 buildTree와 같은 이름 경로(id)를 여기서 만들어요
  // (buildTree를 부르면 트리맵, 선버스트 번들이 커져요). 찾기는 차트와 같은 findNodes예요
  let nodes: { id: string; label: string }[];
  if (parent) nodes = preorder(stratify(rows, { label: lf, id: str("id"), parent }, "", (x) => issues[x.code].push(x.id)));
  else {
    nodes = [];
    // 빈칸만 있는 이름은 빈 이름이에요 (차트의 dropBlankNames와 같아요)
    const text = (v: unknown) => (isBlank(v) || !String(v).trim() ? "" : String(v));
    const add = (id: string, label: string) => nodes.push({ id, label });
    const walk = (list: unknown[], at: string) =>
      list.forEach((r, i) => {
        const row = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
        const label = text(row[lf]) || `#${i + 1}`;
        const id = at ? `${at}/${label}` : label;
        add(id, label);
        if (Array.isArray(row.children)) walk(row.children, id);
      });
    if (rows.some((r) => r && typeof r === "object" && Array.isArray(r.children))) walk(rows, "");
    else
      rows.forEach((row, i) => {
        const steps = path?.length ? path.map((k) => text(row[k])).filter(Boolean) : group && text(row[group]) ? [text(row[group])] : [];
        steps.forEach((label, k) => add(steps.slice(0, k + 1).join("/"), label));
        const label = text(row[lf]) || `#${i + 1}`;
        add([...steps, label].join("/"), label);
      });
  }
  const n = (k: string) => issues[k].length;
  if (n("duplicate_id")) warn("encoding.id", "tree_duplicate_id", t(`${plural(n("duplicate_id"), "row repeats an id", "rows repeat an id")} (${quoted(issues.duplicate_id, t)}). Each is drawn as its own node, and children go under the first row with that id`, `id가 겹치는 행 ${n("duplicate_id")}개(${quoted(issues.duplicate_id, t)})는 따로 노드로 그리고, 자식은 그 id의 첫 행 아래에 달아요`));
  if (n("missing_parent")) warn("encoding.parent", "tree_missing_parent", t(`${plural(n("missing_parent"), "row names a parent", "rows name a parent")} that no row has (${quoted(issues.missing_parent, t)}), so ${n("missing_parent") === 1 ? "it hangs" : "they hang"} under the root`, `없는 부모를 가리키는 행 ${n("missing_parent")}개(${quoted(issues.missing_parent, t)})는 뿌리 아래에 달아요`));
  if (n("cycle")) warn("encoding.parent", "tree_cycle", t(`Parent links loop back (${quoted(issues.cycle, t)}). The loop is cut there and that row hangs under the root`, `부모를 따라가면 제자리로 돌아오는 행(${quoted(issues.cycle, t)})이 있어요. 그 자리에서 끊어 뿌리 아래에 달아요`));
  const vf = str("value");
  if (vf && rows.some((r) => r && typeof r === "object" && toNumber(r[vf]) < 0)) warn("encoding.value", "tree_negative_value", t(`Negative values in "${vf}" count as 0 (values add up from the leaves)`, `"${vf}"의 음수 값은 0으로 세요(값은 잎에서 위로 더해요)`));
  const names = [...new Set(nodes.map((nd) => nd.label))];
  // 더한 뿌리는 이름표(rootLabel, 없으면 "All" 또는 "전체")로 찾아요. 차트도 같아요
  const rootNames = typeof o.rootLabel === "string" && o.rootLabel ? [o.rootLabel] : ["All", "전체"];
  const found = (x: string) => rootNames.includes(x) || findNodes(nodes, x).length > 0;
  const lookFor = (key: "highlight" | "collapsed", list: unknown[]) => {
    const missing = list.filter((x): x is string => typeof x === "string" && !(key === "highlight" && HIGHLIGHT_KEYWORDS.includes(x)) && !found(x));
    if (!missing.length) return;
    const near = closest(missing[0], names);
    warn(`options.${key}`, key === "highlight" ? "highlight_not_found" : "collapsed_not_found", t(`No node is named ${quoted(missing, t)}.${near ? ` Did you mean "${near}"?` : ""} Use a node name or a path such as "Parent/Child"`, `${quoted(missing, t)} 노드가 없어요.${near ? ` "${near}"인가요?` : ""} 노드 이름이나 "부모/자식" 같은 경로를 써 주세요`));
  };
  if (o.highlight !== undefined) lookFor("highlight", Array.isArray(o.highlight) ? o.highlight : [o.highlight]);
  if (Array.isArray(o.collapsed)) lookFor("collapsed", o.collapsed);
}

/** 글자 체계: 한글, 라틴 문자, 숫자, 그 밖 (지역 이름을 권할 때 다른 체계 이름은 권하지 않아요) */
const scriptOf = (s: string) => (/[가-힣ㄱ-ㆎ]/.test(s) ? "hangul" : /[A-Za-z]/.test(s) ? "latin" : /\d/.test(s) ? "digit" : "other");

/**
 * 맞지 않는 지역 이름에 권할 이름: 같은 글자 체계이고, 편집 거리가 길이에 비해 작은 이름만 (3글자는 1, 그보다 길면 길이의 1/3, 적어도 2).
 * "서울"에 "AK"를 권하지 않아요. 없으면 null
 */
function regionSuggestion(name: string, names: readonly string[]): string | null {
  const script = scriptOf(name);
  // 두 글자 이하 코드("CA", "06")는 한 글자만 달라도 다른 지역이라 권하지 않아요. 두 글자 한글 이름("서을" → "서울")은 권해요.
  // 64자보다 긴 이름은 지역 이름이 아니에요 (편집 거리가 길이의 곱이라, 남이 쓴 스펙의 아주 긴 이름에 시간을 쓰지 않아요)
  if ((name.trim().length <= 2 && script !== "hangul") || name.length > 64) return null;
  const near = closest(name, names.filter((n) => scriptOf(n) === script));
  if (near === null) return null;
  const limit = name.length <= 3 ? 1 : Math.max(2, Math.floor(name.length / 3));
  return levenshtein(name.toLowerCase(), near.toLowerCase()) <= limit ? near : null;
}

/** 글자 목록을 따옴표로 묶어 앞 5개만 (나머지는 개수로) */
function quoted(names: string[], t: (en: string, ko: string) => string): string {
  return listText(names.slice(0, 5).map(cellText), names.length, t);
}

/**
 * 타일 격자 지도 검사: options.map("auto", 내장 이름이나 타일 배열), 타일에 맞지 않는 행(가장 가까운 이름을 제안), kr-sido 데이터의 광주, 전남(2026-07-01 통합),
 * 같은 타일에 맞는 행이 여럿, 강조할 지역 이름
 */
function checkTileMap(rows: Record<string, unknown>[] | null, enc: Record<string, unknown>, o: Record<string, unknown>, err: Report, warn: Report, t: (en: string, ko: string) => string) {
  const field = fieldOf(enc, "region");
  // "auto"(기본)는 차트와 같이 지역 값이 가장 많이 맞는 내장 격자로 봐요
  const map = gridName(o.map, () => (rows ?? []).map((r) => (r && typeof r === "object" ? r[field] : undefined)));
  const builtins = TILE_MAPS.map((m) => `"${m}"`).join(", ");
  if (typeof map === "string") {
    if (!TILE_MAPS.includes(map)) {
      const near = closest(map, TILE_MAPS);
      err("options.map", "unknown_tile_map", t(`There is no tile grid "${map}".${near ? ` Did you mean "${near}"?` : ""} Built-in grids: ${builtins}, or pass your own tiles [{ id, label, row, col }]`, `"${map}" 타일 격자는 없어요.${near ? ` "${near}"인가요?` : ""} 내장 격자: ${builtins}. 직접 만든 타일 [{ id, label, row, col }]도 받아요`));
      return;
    }
  } else if (!Array.isArray(map) || !map.length) {
    err("options.map", "bad_tile_map", t(`options.map must be a built-in grid (${builtins}) or a non-empty array of tiles [{ id, label, row, col }]`, `options.map 값은 내장 격자(${builtins})나 타일 배열 [{ id, label, row, col }]이어야 해요`));
    return;
  }
  // 사용자 격자에서 차트가 빼는 타일을 그대로 오류로 알려요 (빼는 규칙은 resolveGrid 한 곳에 있어요)
  let dropped = false;
  const grid =
    resolveGrid(map, ({ index: i, reason, other }) => {
      dropped = true;
      const tile = (map as TileDef[])[i];
      if (reason === "shape") err(`options.map[${i}]`, "bad_tile", t("Each tile must be { id: string, row: integer from 0, col: integer from 0, label?: string, aliases?: string[] }", "타일마다 { id: 문자열, row: 0 이상 정수, col: 0 이상 정수, label?: 문자열, aliases?: 문자열 배열 } 꼴이어야 해요"));
      else if (reason === "id") err(`options.map[${i}].id`, "duplicate_tile_id", t(`Tile id "${tile.id}" is used twice`, `타일 id "${tile.id}"가 두 번 나와요`));
      else err(`options.map[${i}]`, "duplicate_tile_cell", t(`Tiles "${other}" and "${tile.id}" are both on row ${tile.row}, col ${tile.col}`, `"${other}" 타일과 "${tile.id}" 타일이 모두 ${tile.row}행 ${tile.col}열에 있어요`));
    }) ?? [];
  if (dropped) return;
  const match = tileMatcher(grid);
  const h = o.highlight;
  if (typeof h === "string" && !HIGHLIGHT_KEYWORDS.includes(h) && match(h) < 0) warn("options.highlight", "highlight_not_found", t(`Could not find a tile named "${h}" to highlight`, `강조할 "${h}" 타일을 찾지 못했어요`));
  if (!rows?.length) return;
  // 이 격자에서 합쳐져 사라진 지역(kr-sido의 광주, 전남): 맞지 않는 행 대신 통합을 알려요
  const merger = mergedAway(map);
  const counts = new Array<number>(grid.length).fill(0);
  const unmatched = new Set<string>();
  const merged = new Set<string>();
  for (const r of rows) {
    const name = r && typeof r === "object" ? r[field] : undefined;
    if (isBlank(name)) continue;
    const k = match(name);
    if (k >= 0) counts[k]++;
    else if (merger?.is(name)) merged.add(String(name));
    else unmatched.add(String(name));
  }
  if (merged.size)
    warn(
      "encoding.region",
      "tile_merged_region",
      t(
        `${quoted([...merged], t)} ${merged.size === 1 ? "is" : "are"} drawn as no data: Gwangju and Jeollanam-do merged into Jeonnam-Gwangju (전남광주통합특별시) on 2026-07-01, so "kr-sido" has one tile for both. For data from before the merger, use options.map "${merger!.before}"`,
        `${quoted([...merged], t)} 행은 빈 타일로 그려요. 광주와 전남은 2026-07-01에 전남광주통합특별시로 합쳐져서 "kr-sido"에는 타일이 하나예요. 통합 전 데이터면 options.map을 "${merger!.before}"로 정해 주세요`,
      ),
    );
  if (unmatched.size) {
    const names = grid.flatMap(tileNames);
    // 이름을 권하는 것은 보여 줄 앞 5개만, 정말 가까운 이름만 (regionSuggestion)
    const list = [...unmatched].slice(0, 5).map((name) => {
      const near = regionSuggestion(name, names);
      return near ? t(`${cellText(name)} (did you mean "${near}"?)`, `${cellText(name)}("${near}"인가요?)`) : cellText(name);
    });
    const n = unmatched.size;
    warn("encoding.region", "tile_unmatched", t(`${plural(n, "region matches", "regions match")} no tile and ${n === 1 ? "is" : "are"} left out: ${listText(list, n, t)}`, `타일에 맞지 않는 지역 ${n}개는 빼고 그려요: ${listText(list, n, t)}`));
  }
  const twice = grid.filter((_, i) => counts[i] > 1).map((tile) => tile.labelKo ?? tile.label ?? tile.id);
  if (twice.length) warn("encoding.region", "tile_duplicate", t(`More than one row matches ${quoted(twice, t)}. The last row is drawn`, `${quoted(twice, t)}에 맞는 행이 여럿이에요. 마지막 행으로 그려요`));
}

/**
 * 타임라인 검사: 차트와 같은 규칙(readTimeline)으로 읽고 고친 것, 뺀 것을 알려요. 끝이 시작보다 앞(바꿔 그려요), 끝이 빈 항목(열린 항목),
 * 시작이 없거나 끝을 못 읽는 항목(빼요), 축과 다른 종류의 칸(빼요), 똑같은 항목, 기준선과 now(x를 못 읽으면 오류, 범위 밖이면 경고)
 */
function checkTimeline(rows: Record<string, unknown>[] | null, enc: Record<string, unknown>, o: Record<string, unknown>, err: Report, warn: Report, t: (en: string, ko: string) => string) {
  const xType = o.xType === "number" || o.xType === "date" ? o.xType : undefined;
  // 차트가 받는 프롭과 같게: group, status는 encoding에 있을 때만, dayFirst는 true와 false 모두 그대로
  const opt = (k: string) => (typeof enc[k] === "string" ? (enc[k] as string) : undefined);
  const m = readTimeline(rows ?? [], { label: fieldOf(enc, "label"), start: fieldOf(enc, "start"), end: fieldOf(enc, "end"), group: opt("group"), status: opt("status") }, { xType, dayFirst: typeof o.dayFirst === "boolean" ? o.dayFirst : undefined, now: o.now });
  const s = m.issues;
  const its = (k: number) => (k === 1 ? "it" : "they");
  if (s.swapped) warn("encoding.end", "timeline_end_before_start", t(`${plural(s.swapped, "item ends", "items end")} before ${its(s.swapped)} start${s.swapped === 1 ? "s" : ""}, so start and end are swapped`, `끝이 시작보다 앞인 항목 ${s.swapped}개는 시작과 끝을 바꿔 그려요`));
  if (s.open) warn("encoding.end", "timeline_open_end", t(`${plural(s.open, "item has", "items have")} no end, so ${its(s.open)} run${s.open === 1 ? "s" : ""} to options.now (or the latest time in the data) and ${s.open === 1 ? "is" : "are"} drawn as still open`, `끝이 빈 항목 ${s.open}개는 options.now(없으면 데이터의 가장 늦은 시각)까지 이어지는 진행 중 항목으로 그려요`));
  if (s.noStart) warn("encoding.start", "timeline_missing_start", t(`${plural(s.noStart, "item has", "items have")} no start that reads as a time and ${s.noStart === 1 ? "is" : "are"} left out`, `시작이 없거나 시각으로 읽히지 않는 항목 ${s.noStart}개는 빼고 그려요`));
  if (s.badEnd) warn("encoding.end", "timeline_bad_end", t(`${plural(s.badEnd, "item has", "items have")} an end that does not read as a time and ${s.badEnd === 1 ? "is" : "are"} left out. Leave the end empty for an item that is still running`, `끝을 시각으로 읽을 수 없는 항목 ${s.badEnd}개는 빼고 그려요. 아직 이어지는 항목은 끝을 비워 두세요`));
  if (s.mixed) {
    const axis = m.kind === "date" ? t("dates", "날짜") : t("numbers", "숫자");
    warn("encoding.start", "timeline_mixed_kinds", t(`The time axis reads ${axis}, and ${plural(s.mixed, "item uses", "items use")} the other kind (a number on a date axis or a date on a number axis), so ${s.mixed === 1 ? "it is" : "they are"} left out. Set options.xType to choose`, `시간 축은 ${axis}로 읽는데 다른 종류(날짜 축의 숫자, 숫자 축의 날짜)를 쓴 항목 ${s.mixed}개는 빼고 그려요. options.xType으로 정할 수 있어요`));
  }
  if (s.duplicate) warn("data", "timeline_duplicate", t(`${plural(s.duplicate, "item repeats", "items repeat")} another item exactly (same label, start, end and group). Both are drawn, in separate lanes`, `이름, 시작, 끝, 묶음이 모두 같은 항목이 ${s.duplicate}개 있어요. 둘 다 칸을 나눠 그려요`));
  const [lo, hi] = timelineDomain(m);
  /** 시각으로 읽히면 true (범위 밖이면 경고도). 데이터가 없으면(URL) 축 종류를 몰라서 값이 있는지만 봐요 */
  const readable = (path: string, v: unknown) => {
    if (!m.items.length) return !isBlank(v);
    const x = m.read(v);
    if (!Number.isFinite(x)) return false;
    if (x < lo || x > hi) warn(path, "reference_line_outside", t("This line is outside the time range of the data, so it is not drawn", "이 선은 데이터의 시간 범위 밖이라 그리지 않아요"));
    return true;
  };
  if (Array.isArray(o.referenceLines))
    o.referenceLines.forEach((r, i) => {
      const x = r && typeof r === "object" ? (r as { x?: unknown }).x : undefined;
      if (!readable(`options.referenceLines[${i}]`, x))
        err(`options.referenceLines[${i}]`, "bad_reference_line", t('A timeline reference line needs x on the time axis, such as { x: 30, label: "Target" } or { x: "2026-03-01" }, so this one is not drawn', '타임라인 기준선에는 { x: 30, label: "목표" }나 { x: "2026-03-01" }처럼 시간 축의 x가 있어야 해요. 이 기준선은 그리지 않아요'));
    });
  if (o.now !== undefined && !readable("options.now", o.now)) err("options.now", "bad_now", t("options.now must be a time in the same form as the data (a number or a date), so the now line is not drawn", "options.now 값은 데이터와 같은 꼴의 시각(숫자나 날짜)이어야 해요. 지금 선은 그리지 않아요"));
}

/**
 * 지도 차트(단계구분도, 기호 지도, 흐름 지도) 공통: options.map을 지도로 고르고(choose), 스펙에 넣은 지도 객체, 너무 큰 GeoJSON, 지도가 아닌 값,
 * 등록하지 않은 지도와 없는 지도, GeoJSON의 빈 지물과 범위 밖 좌표와 겹치는 id를 알려요. 그릴 지도가 없으면 null
 */
function checkMapSource(o: Record<string, unknown>, choose: () => MapChoice | null, err: Report, warn: Report, t: (en: string, ko: string) => string): { src: GeoMap | GeoJSONFeatureCollection; keys: (readonly string[])[]; ids: string[]; geoMap: GeoMap | null } | null {
  // 압축한 지도 객체는 코드(map 프롭, registerMap)로만 받아요. 스펙은 등록한 지도 이름이나 GeoJSON이에요
  if (isGeoMap(o.map)) {
    err("options.map", "map_object_in_spec", t(`A JSON spec cannot carry a packed map object. Name a registered map (for example ${cellText(o.map.name)}) or pass a GeoJSON FeatureCollection; pass map objects from code through the map prop or registerMap`, `JSON 스펙에는 압축한 지도 객체를 넣을 수 없어요. 등록한 지도 이름(예: ${cellText(o.map.name)})이나 GeoJSON FeatureCollection을 넣어 주세요. 지도 객체는 코드에서 map 프롭이나 registerMap으로 넘겨요`));
    return null;
  }
  if (isFeatureCollection(o.map)) {
    const size = geojsonSize(o.map);
    const { features: maxF, points: maxP } = GEOJSON_LIMITS;
    if (size.features > maxF || size.points > maxP) {
      err("options.map", "map_too_large", t(`The GeoJSON is too large for a spec: ${size.features > maxF ? `${size.features} features (the limit is ${maxF})` : `more than ${maxP} coordinates`}. Simplify it first (for example with mapshaper), or pass it from code through the map prop`, `스펙에 넣기에는 GeoJSON이 너무 커요: ${size.features > maxF ? `지물 ${size.features}개(상한 ${maxF}개)` : `좌표 ${maxP}개 넘음`}. 먼저 단순화(예: mapshaper)하거나 코드에서 map 프롭으로 넘겨 주세요`));
      return null;
    }
  }
  const choice = choose();
  const known = [...new Set([...registeredMaps(), ...BUILTIN_MAPS])];
  const names = known.map((m) => `"${m}"`).join(", ");
  if (!choice) {
    err("options.map", "bad_map", t(`options.map must be "auto", a map name (${names}), a map from ztd-charts/geo or a GeoJSON FeatureCollection`, `options.map 값은 "auto", 지도 이름(${names}), ztd-charts/geo의 지도, GeoJSON FeatureCollection 중 하나여야 해요`));
    return null;
  }
  if ("missing" in choice) {
    const m = choice.missing;
    const how = (x: string) => `import { ${mapExportName(x)} } from "ztd-charts/geo/${x}"; registerMap(${mapExportName(x)})`;
    if (m === "auto") err("options.map", "map_not_loaded", t(`No map is registered, so "auto" has nothing to choose from. Register the map you draw first, for example ${how("world")}. ztd-charts/server, the CLI and the MCP server register every built-in map`, `등록한 지도가 없어서 "auto"가 고를 지도가 없어요. 그릴 지도를 먼저 등록해 주세요. 예: ${how("world")}. ztd-charts/server, CLI, MCP 서버는 내장 지도를 모두 등록해 둬요`));
    else if (BUILTIN_MAPS.includes(m)) err("options.map", "map_not_loaded", t(`The "${m}" map is not registered. Register it before drawing: ${how(m)}`, `"${m}" 지도를 등록하지 않았어요. 그리기 전에 등록해 주세요: ${how(m)}`));
    else {
      const near = closest(m, known);
      err("options.map", "unknown_map", t(`There is no map "${m}".${near ? ` Did you mean "${near}"?` : ""} Maps: ${names}, or pass a GeoJSON FeatureCollection`, `"${m}" 지도는 없어요.${near ? ` "${near}"인가요?` : ""} 지도: ${names}. GeoJSON FeatureCollection도 받아요`));
    }
    return null;
  }
  const src = choice.map;
  let keys: (readonly string[])[];
  let ids: string[];
  let geoMap: GeoMap | null = null;
  if (isFeatureCollection(src)) {
    const g = geojsonShapes(src, typeof o.featureId === "string" ? o.featureId : undefined, typeof o.featureName === "string" ? o.featureName : undefined);
    if (!g.shapes.length) {
      err("options.map", "map_empty", t("The GeoJSON has no Polygon or MultiPolygon feature with coordinates to draw", "GeoJSON에 그릴 좌표가 있는 Polygon, MultiPolygon 지물이 없어요"));
      return null;
    }
    const k = g.skipped.length;
    if (k) warn("options.map", "map_feature_skipped", t(`${plural(k, "feature has", "features have")} no Polygon or MultiPolygon to draw and ${k === 1 ? "is" : "are"} left out (${listText(g.skipped.slice(0, 5).map((i) => `features[${i}]`), k, t)})`, `그릴 Polygon, MultiPolygon이 없는 지물 ${k}개는 빼요(${listText(g.skipped.slice(0, 5).map((i) => `features[${i}]`), k, t)})`));
    if (g.outOfRange) warn("options.map", "map_out_of_range", t(`${plural(g.outOfRange, "coordinate is", "coordinates are")} outside longitude -180 to 180 or latitude -90 to 90. GeoJSON must be in longitude and latitude degrees (EPSG:4326), not projected meters. Latitudes are clamped and longitudes wrapped`, `좌표 ${g.outOfRange}개가 경도 -180~180, 위도 -90~90 밖이에요. GeoJSON은 투영한 미터가 아니라 경위도(도, EPSG:4326)여야 해요. 위도는 범위 안으로 묶고 경도는 감아서 그려요`));
    ids = g.shapes.map((s) => s.id);
    const seen = new Set<string>();
    const twice = [...new Set(ids.filter((id) => seen.size === seen.add(id).size))];
    if (twice.length) warn("options.map", "map_duplicate_id", t(`More than one feature has the id ${quoted(twice, t)}. Rows match the first one. Set options.featureId to a property that is unique`, `id가 ${quoted(twice, t)}인 지물이 여럿이에요. 행은 앞 지물에 맞춰요. 겹치지 않는 속성을 options.featureId로 정해 주세요`));
    keys = g.shapes.map((s) => s.keys);
  } else {
    geoMap = src;
    keys = regionKeys(src);
    ids = src.regions.map((r) => r[0]);
  }
  return { src, keys, ids, geoMap };
}

/**
 * 단계구분도 검사: options.map("auto", 지도 이름, 지도 객체, GeoJSON)과 등록하지 않은 지도, GeoJSON의 빈 지물과 범위 밖 좌표, focus,
 * 지도에 맞지 않는 행(가까운 이름을 제안), 묶음 밖 행과 그리지 않는 지역(남극), kr-sido의 광주와 전남, 같은 지역에 맞는 행이 여럿, 강조할 지역 이름.
 * 경계를 도법에 올리지 않고 지역 이름표만 봐요 (검사기 번들에 도법 코드가 들지 않아요)
 */
function checkChoropleth(rows: Record<string, unknown>[] | null, enc: Record<string, unknown>, o: Record<string, unknown>, err: Report, warn: Report, t: (en: string, ko: string) => string) {
  const field = fieldOf(enc, "region");
  const m = checkMapSource(o, () => chooseMap(o.map, () => (rows ?? []).map((r) => (r && typeof r === "object" ? r[field] : undefined))), err, warn, t);
  if (!m) return;
  const { keys, ids, geoMap } = m;
  const focusName = pointFocus(o, geoMap, warn, t);
  const focus = focusName !== undefined ? geoMap?.focus?.[focusName] : undefined;
  const match = geoMap ? mapMatcher(geoMap) : nameMatcher(keys);
  const h = o.highlight;
  if (typeof h === "string" && !HIGHLIGHT_KEYWORDS.includes(h) && match(h) < 0) warn("options.highlight", "highlight_not_found", t(`Could not find a region named "${h}" to highlight`, `강조할 "${h}" 지역을 찾지 못했어요`));
  if (!rows?.length) return;
  const hidden = new Set(geoMap?.hidden ?? []);
  const members = focus ? new Set(focus.ids.split(" ")) : null;
  const merger = mergedAway(geoMap?.name);
  const counts = new Array<number>(ids.length).fill(0);
  const unmatched = new Set<string>();
  const merged = new Set<string>();
  const outside = new Set<string>();
  for (const r of rows) {
    const name = r && typeof r === "object" ? r[field] : undefined;
    if (isBlank(name)) continue;
    const k = match(name);
    if (k < 0) (merger?.is(name) ? merged : unmatched).add(String(name));
    else if (hidden.has(ids[k]) || (members && !members.has(ids[k]))) outside.add(String(name));
    else counts[k]++;
  }
  if (merged.size) warn("encoding.region", "region_merged", t(`${quoted([...merged], t)} ${merged.size === 1 ? "is" : "are"} left out: Gwangju and Jeollanam-do merged into Jeonnam-Gwangju (전남광주통합특별시) on 2026-07-01, so "kr-sido" has one region for both. Combine the two into one row, or for data from before the merger use the tileMap chart with map "kr-sido-2025"`, `${quoted([...merged], t)} 행은 빼고 그려요. 광주와 전남은 2026-07-01에 전남광주통합특별시로 합쳐져서 "kr-sido"에는 지역이 하나예요. 두 값을 한 행으로 합치거나, 통합 전 데이터면 tileMap 차트의 "kr-sido-2025" 격자를 써 주세요`));
  if (outside.size) warn("encoding.region", "region_outside_map", t(`${quoted([...outside], t)} ${outside.size === 1 ? "is" : "are"} not drawn on this map${focus ? ` (outside options.focus "${o.focus}")` : " (Antarctica is left out of the world map)"}, so ${outside.size === 1 ? "it is" : "they are"} left out`, `${quoted([...outside], t)} 행은 이 지도에 그리지 않는 지역이라 빼요${focus ? `(options.focus "${o.focus}" 밖)` : "(세계 지도에서 남극은 빼요)"}`));
  if (unmatched.size) {
    const all = keys.flat();
    // 이름을 권하는 것은 보여 줄 앞 5개만 (거리 계산이 이름표 전체와 견줘서 비싸요)
    const list = [...unmatched].slice(0, 5).map((name) => {
      const near = regionSuggestion(name, all);
      return near ? t(`${cellText(name)} (did you mean "${near}"?)`, `${cellText(name)}("${near}"인가요?)`) : cellText(name);
    });
    const n = unmatched.size;
    warn("encoding.region", "region_unmatched", t(`${plural(n, "region matches", "regions match")} nothing on the map and ${n === 1 ? "is" : "are"} left out: ${listText(list, n, t)}`, `지도에 맞지 않는 지역 ${n}개는 빼고 그려요: ${listText(list, n, t)}`));
  }
  const twice = ids.flatMap((id, i) => (counts[i] > 1 ? [keys[i][1] ?? id] : []));
  if (twice.length) warn("encoding.region", "region_duplicate", t(`More than one row matches ${quoted(twice, t)}. The last row is drawn`, `${quoted(twice, t)}에 맞는 행이 여럿이에요. 마지막 행으로 그려요`));
}

/** 지도 차트의 focus 검사: 세계 지도의 묶음이 아니면 알려요. 쓸 수 있는 focus면 그 이름 */
function pointFocus(o: Record<string, unknown>, geoMap: GeoMap | null, warn: Report, t: (en: string, ko: string) => string): string | undefined {
  const ok = typeof o.focus === "string" && geoMap?.focus && Object.hasOwn(geoMap.focus, o.focus);
  if (o.focus !== undefined && !ok) warn("options.focus", "focus_unsupported", t(`options.focus works on the world map only, so it is not used here`, `options.focus는 세계 지도에서만 써서 여기서는 쓰지 않아요`));
  return ok ? (o.focus as string) : undefined;
}

/** 지도에 맞지 않는 이름 경고 (단계구분도와 같은 꼴에 다음 할 일을 붙여요). 이름을 권하는 것은 보여 줄 앞 5개만 */
function unmatchedNames(names: Set<string>, d: PlaceDomain, path: string, tail: [string, string], warn: Report, t: (en: string, ko: string) => string) {
  if (!names.size) return;
  const all = d.shapes.flatMap((sh) => sh.keys);
  const list = [...names].slice(0, 5).map((name) => {
    const near = regionSuggestion(name, all);
    return near ? t(`${cellText(name)} (did you mean "${near}"?)`, `${cellText(name)}("${near}"인가요?)`) : cellText(name);
  });
  const n = names.size;
  warn(path, "region_unmatched", t(`${plural(n, "name matches", "names match")} nothing on the map and ${n === 1 ? "is" : "are"} left out: ${listText(list, n, t)}. ${tail[0]}`, `지도에 맞지 않는 이름 ${n}개는 빼고 그려요: ${listText(list, n, t)}. ${tail[1]}`));
}

const domainOf = (src: GeoMap | GeoJSONFeatureCollection, o: Record<string, unknown>, focus: string | undefined) =>
  placeDomain(src, { focus, featureId: typeof o.featureId === "string" ? o.featureId : undefined, featureName: typeof o.featureName === "string" ? o.featureName : undefined });

/**
 * 기호 지도 검사: 자리(경위도나 지역 이름)가 없는 데이터, options.map과 focus(단계구분도와 같은 검사), 범위 밖이거나 숫자가 아닌 경위도(경도와 위도가 바뀐 듯하면 알려요),
 * 지도 밖 지점, 지도에 맞지 않는 지역 이름(도시 목록은 없어요), 0 이하인 값, 따로 그리는 원 상한, 강조할 이름
 */
function checkSymbolMap(rows: Record<string, unknown>[] | null, enc: Record<string, unknown>, o: Record<string, unknown>, err: Report, warn: Report, t: (en: string, ko: string) => string) {
  const list = (rows ?? []).filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  const has = (f: string) => list.slice(0, 200).some((r) => hasField(r, f));
  const lonF = fieldOf(enc, "lon");
  const latF = fieldOf(enc, "lat");
  const regF = fieldOf(enc, "region");
  if (list.length && !(has(lonF) && has(latF)) && !has(regF)) {
    err("encoding.lon", "no_location", t(`A symbol map needs a place for each row: longitude and latitude fields (encoding.lon and encoding.lat, "lon" and "lat" by default), or a region field (encoding.region) with names of the map such as countries or US states`, `기호 지도는 행마다 자리가 필요해요: 경도와 위도 필드(encoding.lon, encoding.lat, 기본 "lon", "lat")나 나라, 미국 주 같은 지도의 지역 이름 필드(encoding.region)`));
    return;
  }
  const places = list.map((r) => symbolPlace(toNumber(r[lonF]), toNumber(r[latF]), isBlank(r[regF]) ? "" : String(r[regF])));
  const m = checkMapSource(o, () => choosePlaceMap(o.map, () => places), err, warn, t);
  if (!m) return;
  const focus = pointFocus(o, m.geoMap, warn, t);
  const d = domainOf(m.src, o, focus);
  const sized = typeof enc.size === "string" || has("size");
  const sizeF = fieldOf(enc, "size");
  const labelF = typeof enc.label === "string" ? enc.label : has("label") ? "label" : "name";
  const nameOf = (r: Record<string, unknown>, i: number) => (isBlank(r[labelF]) ? t(`row ${i + 1}`, `${i + 1}행`) : cellText(r[labelF]));
  const invalid: string[] = [];
  let invalidN = 0;
  let swapped = 0;
  const outside: string[] = [];
  let outsideN = 0;
  const unmatched = new Set<string>();
  const outsideRegions = new Set<string>();
  let notPositive = 0;
  let drawn = 0;
  list.forEach((r, i) => {
    const pl = places[i];
    const at = placeIn(d, pl);
    if ("miss" in at) {
      if ("name" in pl) (at.miss === "unmatched" ? unmatched : outsideRegions).add(String(pl.name));
      else if (at.miss === "invalid") {
        if (invalidN++ < 5) invalid.push(nameOf(r, i));
        // 위도가 범위 밖인데 둘을 바꾸면 맞는 값이면 바뀐 듯해요
        if (validLonLat(pl.lat, pl.lon)) swapped++;
      } else if (outsideN++ < 5) outside.push(nameOf(r, i));
      return;
    }
    const v = sized ? toNumber(r[sizeF]) : 1;
    if (Number.isFinite(v) && v <= 0) notPositive++;
    else if (Number.isFinite(v)) drawn++;
  });
  if (invalidN) {
    const n = invalidN;
    const hint = swapped === n ? t(" Longitude and latitude look swapped: longitude (east-west, -180 to 180) goes in lon and latitude (-90 to 90) in lat", " 경도와 위도가 바뀐 것 같아요: 경도(동서, -180~180)는 lon, 위도(-90~90)는 lat에 넣어 주세요") : "";
    warn("encoding.lat", "point_invalid", t(`${plural(n, "row has", "rows have")} no valid longitude and latitude (longitude -180 to 180, latitude -90 to 90, as numbers) and ${n === 1 ? "is" : "are"} left out: ${listText(invalid, n, t)}.${hint}`, `올바른 경도와 위도(경도 -180~180, 위도 -90~90 숫자)가 없는 행 ${n}개는 빼요: ${listText(invalid, n, t)}.${hint}`));
  }
  if (outsideN) {
    const n = outsideN;
    warn("encoding.lon", "point_outside_map", t(`${plural(n, "point falls", "points fall")} outside the map${focus ? ` (outside options.focus "${focus}")` : ""} and ${n === 1 ? "is" : "are"} left out: ${listText(outside, n, t)}`, `지도 밖 지점 ${n}개는 빼요${focus ? `(options.focus "${focus}" 밖)` : ""}: ${listText(outside, n, t)}`));
  }
  unmatchedNames(unmatched, d, "encoding.region", ["No list of cities ships: give cities longitude and latitude (encoding.lon, encoding.lat)", "도시 목록은 없어요: 도시는 경도와 위도(encoding.lon, encoding.lat)를 넣어 주세요"], warn, t);
  if (outsideRegions.size) warn("encoding.region", "region_outside_map", t(`${quoted([...outsideRegions], t)} ${outsideRegions.size === 1 ? "is" : "are"} not drawn on this map${focus ? ` (outside options.focus "${focus}")` : ""}, so ${outsideRegions.size === 1 ? "it is" : "they are"} left out`, `${quoted([...outsideRegions], t)} 행은 이 지도에 그리지 않는 지역이라 빼요${focus ? `(options.focus "${focus}" 밖)` : ""}`));
  if (notPositive) warn("encoding.size", "size_not_positive", t(`${plural(notPositive, "row has", "rows have")} a size of 0 or less and ${notPositive === 1 ? "is" : "are"} not drawn (circle area follows the value)`, `값이 0 이하인 행 ${notPositive}개는 그리지 않아요(원의 넓이가 값을 따라요)`));
  if (drawn > MAX_POINTS) warn("data", "too_many_points", t(`${drawn} places can be drawn, but only the ${MAX_POINTS} largest are, to keep the SVG small. The total, shares and ranks still count every place. Aggregate nearby places first`, `놓을 수 있는 지점이 ${drawn}곳인데 SVG를 작게 두려고 큰 ${MAX_POINTS}곳만 그려요. 합계, 비율, 순위는 모두로 세요. 가까운 지점은 먼저 묶어 주세요`));
  const sr = o.sizeRange;
  if (sr !== undefined && !(Array.isArray(sr) && sr.length === 2 && sr.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0.5 && x <= 200) && sr[0] <= sr[1]))
    warn("options.sizeRange", "bad_size_range", t("options.sizeRange must be two radii in px, smallest first, each from 0.5 to 200, for example [3, 24]. The radii are clamped, and the largest is at most an eighth of the chart's shorter side", "options.sizeRange는 작은 값부터 반지름 두 개(px, 각각 0.5~200)여야 해요. 예: [3, 24]. 범위 안으로 묶고, 가장 큰 반지름은 차트 짧은 변의 1/8까지예요"));
  const h = o.highlight;
  if (typeof h === "string" && !HIGHLIGHT_KEYWORDS.includes(h) && list.length && !list.some((r) => !isBlank(r[labelF]) && String(r[labelF]) === h)) warn("options.highlight", "highlight_not_found", t(`Could not find a place named "${h}" to highlight`, `강조할 "${h}" 지점을 찾지 못했어요`));
}

/**
 * 흐름 지도 검사: options.places 꼴, options.map과 focus, 빈 이름, 같은 곳으로 가는 흐름, 0 이하인 값, 자리가 없는 이름(places에도 지도에도 없음),
 * 지도 밖 자리, 따로 그리는 흐름 상한, 강조할 자리. 같은 방향의 같은 쌍은 더해서 그려요 (네트워크, 코드와 같아요)
 */
function checkFlowMap(rows: Record<string, unknown>[] | null, enc: Record<string, unknown>, o: Record<string, unknown>, err: Report, warn: Report, t: (en: string, ko: string) => string) {
  const pl = o.places;
  if (pl !== undefined && (!pl || typeof pl !== "object" || Array.isArray(pl))) err("options.places", "bad_places", t(`options.places must be an object of { name: [longitude, latitude] }`, `options.places는 { 이름: [경도, 위도] } 객체여야 해요`));
  const placesObj = pl && typeof pl === "object" && !Array.isArray(pl) ? (pl as Record<string, unknown>) : undefined;
  const list = (rows ?? []).filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  const has = (k: string) => list.slice(0, 200).some((r) => hasField(r, k));
  const sf = typeof enc.source === "string" ? enc.source : has("source") ? "source" : "from";
  const tf = typeof enc.target === "string" ? enc.target : has("target") ? "target" : "to";
  const vf = typeof enc.value === "string" ? enc.value : has("value") ? "value" : null;
  let blank = 0;
  let self = 0;
  let notPositive = 0;
  const pairs: [string, string][] = [];
  const seenPair = new Set<string>();
  const names = new Set<string>();
  for (const r of list) {
    const s = isBlank(r[sf]) ? "" : String(r[sf]).trim();
    const d = isBlank(r[tf]) ? "" : String(r[tf]).trim();
    if (!s || !d) {
      blank++;
      continue;
    }
    if (s === d) {
      self++;
      continue;
    }
    const v = vf ? toNumber(r[vf]) : 1;
    if (Number.isFinite(v) && v <= 0) notPositive++;
    if (!(v > 0) || !Number.isFinite(v)) continue;
    names.add(s).add(d);
    const key = JSON.stringify([s, d]);
    if (!seenPair.has(key)) {
      seenPair.add(key);
      pairs.push([s, d]);
    }
  }
  // 데이터에 나오는 이름만 봐요 (쓰지 않는 자리는 그리지 않아요)
  if (placesObj) {
    const bad = [...names].filter((k) => {
      const e = placeEntry(placesObj, k);
      return e !== null && !validLonLat(e.lon, e.lat);
    });
    if (bad.length) warn("options.places", "bad_place", t(`${quoted(bad, t)} ${bad.length === 1 ? "is" : "are"} not [longitude, latitude] in degrees (longitude -180 to 180, latitude -90 to 90), so ${bad.length === 1 ? "its flows are" : "their flows are"} left out`, `${quoted(bad, t)} 값이 [경도, 위도](경도 -180~180, 위도 -90~90)가 아니라서 그 흐름은 빼요`));
  }
  if (self) warn("encoding.target", "flow_self_link", t(`${plural(self, "row goes", "rows go")} from a place to itself and ${self === 1 ? "is" : "are"} not drawn`, `같은 곳으로 가는 행 ${self}개는 그리지 않아요`));
  if (blank) warn("encoding.source", "flow_blank_place", t(`${plural(blank, "row has", "rows have")} an empty source or target and ${blank === 1 ? "is" : "are"} left out`, `출발지나 도착지가 빈 행 ${blank}개는 빼고 그려요`));
  if (notPositive) warn("encoding.value", "flow_value_not_positive", t(`${plural(notPositive, "row has", "rows have")} a value of 0 or less and ${notPositive === 1 ? "is" : "are"} not drawn`, `값이 0 이하인 행 ${notPositive}개는 그리지 않아요`));
  const m = checkMapSource(o, () => choosePlaceMap(o.map, () => [...names].map((n) => flowPlace(placesObj, n))), err, warn, t);
  if (!m) return;
  const focus = pointFocus(o, m.geoMap, warn, t);
  const d = domainOf(m.src, o, focus);
  const unknown = new Set<string>();
  const outside = new Set<string>();
  const ok = new Set<string>();
  for (const n of names) {
    const at = placeIn(d, flowPlace(placesObj, n));
    if (!("miss" in at)) ok.add(n);
    else if (at.miss === "unmatched") unknown.add(n);
    else if (at.miss === "outside") outside.add(n);
  }
  unmatchedNames(unknown, d, "options.places", ["Add each to options.places as [longitude, latitude], or use region names of the map", "options.places에 [경도, 위도]로 넣거나 지도의 지역 이름을 써 주세요"], warn, t);
  if (outside.size) warn("options.places", "place_outside_map", t(`${quoted([...outside], t)} ${outside.size === 1 ? "is" : "are"} outside the map${focus ? ` (outside options.focus "${focus}")` : ""}, so ${outside.size === 1 ? "its flows are" : "their flows are"} left out`, `${quoted([...outside], t)} 자리는 지도 밖이라${focus ? `(options.focus "${focus}" 밖)` : ""} 그 흐름은 빼요`));
  const drawn = pairs.filter(([s, e]) => ok.has(s) && ok.has(e)).length;
  if (drawn > MAX_FLOWS) warn("data", "too_many_flows", t(`${drawn} flows can be drawn, but only the ${MAX_FLOWS} largest are, to keep the SVG small. The total and shares still count every flow. Combine small flows first`, `그릴 수 있는 흐름이 ${drawn}개인데 SVG를 작게 두려고 큰 ${MAX_FLOWS}개만 그려요. 합계와 비율은 모두로 세요. 작은 흐름은 먼저 묶어 주세요`));
  const h = o.highlight;
  if (typeof h === "string" && !HIGHLIGHT_KEYWORDS.includes(h) && names.size && !names.has(h) && !pairs.some(([s, e]) => `${s} → ${e}` === h)) warn("options.highlight", "highlight_not_found", t(`Could not find a place or flow named "${h}" to highlight`, `강조할 "${h}" 자리나 흐름을 찾지 못했어요`));
}

/**
 * spec.facet 검사: 객체 꼴, 그릴 수 있는 차트(line, area, bar, scatter), by 필드가 데이터에 있는지(가까운 이름을 권해요),
 * columns, scale, 패널이 24개를 넘으면 빠지는 수. 쓸 수 있는 by 필드 이름을 돌려줘요 (중복 x 검사가 패널마다 봐요)
 */
function checkFacet(facet: unknown, type: string, opts: Record<string, unknown>, rows: Record<string, unknown>[] | null, fields: string[], t: (en: string, ko: string) => string, err: Report, warn: Report): string | undefined {
  // 양쪽 막대는 양쪽을 각자 데이터 끝에 맞춰서 같은 값 축이 정해지지 않아요. 작은 여러 개는 쓰지 않아요 (<Chart>도 차트 하나로 그려요)
  if (type === "bar" && opts.layout === "diverging") err("facet", "facet_unsupported", t('facet does not work with layout "diverging". Draw one diverging bar chart, or split by series', 'facet은 layout "diverging"과 함께 쓰지 않아요. 양쪽 막대 하나로 그리거나 계열로 나눠 주세요'));
  if (!facet || typeof facet !== "object" || Array.isArray(facet)) {
    err("facet", "bad_facet", t('facet must be an object such as { by: "region" }', 'facet은 { by: "region" } 같은 객체여야 해요'));
    return undefined;
  }
  const list = FACET_TYPES.join(", ");
  if (!FACET_TYPES.includes(type)) err("facet", "facet_unsupported", t(`facet works on ${list} charts, not on ${type}`, `facet은 ${list} 차트에서만 써요(지금 ${type})`));
  const { by, columns, scale, ...rest } = facet as Record<string, unknown>;
  for (const k of Object.keys(rest)) warn(`facet.${k}`, "unknown_facet_key", t(`facet has no key "${k}". Keys: by, columns, scale`, `facet에는 "${k}" 키가 없어요. 키: by, columns, scale`));
  if (columns !== undefined && !(Number.isInteger(columns) && (columns as number) >= 1)) err("facet.columns", "bad_facet", t("facet.columns must be a whole number of 1 or more", "facet.columns 값은 1 이상의 정수여야 해요"));
  if (scale !== undefined && scale !== "shared" && scale !== "free") err("facet.scale", "bad_enum", t('facet.scale must be "shared" or "free"', 'facet.scale 값은 "shared"나 "free"여야 해요'));
  if (typeof by !== "string" || !by) {
    err("facet.by", "bad_field", t("facet.by must be a field name (string)", "facet.by 값은 필드 이름(문자열)이어야 해요"));
    return undefined;
  }
  if (!rows?.length) return by;
  if (!rows.slice(0, 200).some((r) => r && typeof r === "object" && hasField(r, by))) {
    const near = closest(by, fields);
    err("facet.by", "field_not_found", t(`Field "${by}" is not in the data.${near ? ` Did you mean "${near}"?` : ""} Available fields: ${fields.join(", ")}`, `"${by}" 필드가 데이터에 없어요.${near ? ` "${near}"인가요?` : ""} 있는 필드: ${fields.join(", ")}`));
    return undefined;
  }
  // 그리는 쪽(facetGroups)과 같은 읽기로 세요 (점 경로, 날짜 값)
  // 빈 값("", null, 필드 없음)은 한 패널("(blank)")로 묶여요. 행이 빠지는 건 패널이 24개를 넘을 때뿐이라 그때 빠지는 값과 행 수를 알려요
  const read = strGetter<Record<string, unknown>>(by, by);
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const v = read(r ?? {}, i);
    seen.set(v, (seen.get(v) ?? 0) + 1);
  });
  const n = seen.size;
  if (n > FACET_MAX) {
    const left = [...seen.values()].slice(FACET_MAX).reduce((s, c) => s + c, 0);
    warn("facet.by", "facet_many_panels", t(`"${by}" has ${n} values. Only the first ${FACET_MAX} panels are drawn, so ${plural(n - FACET_MAX, "value is", "values are")} (${plural(left, "row")}) left out`, `"${by}" 값이 ${n}개예요. 앞의 ${FACET_MAX}개 패널만 그려서 ${n - FACET_MAX}개 값(${left}행)은 빠져요`));
  }
  return by;
}

/** 막대 레이스 검사: 시점이 하나뿐이면 움직이지 않아요, startFrame이 시점에 없으면 마지막 시점을 그려요 */
function checkBarRace(rows: Record<string, unknown>[] | null, enc: Record<string, unknown>, o: Record<string, unknown>, warn: Report, t: (en: string, ko: string) => string) {
  if (!rows?.length) return;
  const field = fieldOf(enc, "frame");
  const frames = new Set<string>();
  const nums = new Set<number>();
  for (const r of rows.slice(0, 100_000)) {
    const v = r && typeof r === "object" ? r[field] : undefined;
    if (isBlank(v)) continue;
    // 시점은 글자로도, 숫자나 날짜(차트가 그 순서로 읽어요)로도 맞춰 봐요
    frames.add(String(v));
    nums.add(toNumber(v));
    nums.add(toDate(v)?.getTime() ?? NaN);
  }
  if (frames.size === 1) warn("encoding.frame", "single_frame", t(`There is only one step (${cellText([...frames][0])}), so the bars do not move. A bar chart may fit better`, `시점이 하나뿐이라(${cellText([...frames][0])}) 막대가 움직이지 않아요. 막대 차트가 더 맞을 수 있어요`));
  const s = o.startFrame;
  if (s !== undefined && frames.size && !frames.has(String(s)) && !nums.has(toDate(s)?.getTime() ?? NaN) && !nums.has(toNumber(s)))
    warn("options.startFrame", "frame_not_found", t(`options.startFrame ${cellText(s)} is not a step in the data, so the last step is shown first`, `options.startFrame ${cellText(s)} 값이 데이터의 시점에 없어서 마지막 시점을 먼저 보여 줘요`));
}

/**
 * 네트워크 검사: 차트가 링크로 그리지 않는 행(자기 자신으로 가는 행, 이름이 빈 행, 값이 0보다 작은 행)과
 * options.groups(묶음 이름이 글자인지, 노드에 없는 이름). 숫자가 아닌 값은 encoding 공통 검사가 알려요
 */
function checkNetwork(rows: Record<string, unknown>[] | null, enc: Record<string, unknown>, o: Record<string, unknown>, warn: Report, t: (en: string, ko: string) => string) {
  const g = o.groups;
  const groups = g && typeof g === "object" && !Array.isArray(g) ? (g as Record<string, unknown>) : null;
  if (groups) {
    const bad = Object.keys(groups).filter((k) => typeof groups[k] !== "string");
    if (bad.length) warn("options.groups", "network_bad_group", t(`Group names must be strings, so ${quoted(bad, t)} ${bad.length === 1 ? "has" : "have"} no group`, `묶음 이름은 글자여야 해요. ${quoted(bad, t)}에는 묶음이 없어요`));
  }
  if (!rows?.length) return;
  const has = (k: string) => rows.slice(0, 200).some((r) => r && typeof r === "object" && hasField(r, k));
  const sf = typeof enc.source === "string" ? enc.source : has("source") ? "source" : "from";
  const tf = typeof enc.target === "string" ? enc.target : has("target") ? "target" : "to";
  const vf = typeof enc.value === "string" ? enc.value : has("value") ? "value" : null;
  let self = 0;
  let blank = 0;
  let negative = 0;
  const names = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    // 차트와 같이 앞뒤 빈칸을 떼고 봐요
    const s = isBlank(r[sf]) ? "" : String(r[sf]).trim();
    const d = isBlank(r[tf]) ? "" : String(r[tf]).trim();
    if (!s || !d) {
      blank++;
      continue;
    }
    names.add(s).add(d);
    if (s === d) self++;
    else if (vf && toNumber(r[vf]) < 0) negative++;
  }
  if (self) warn("encoding.target", "network_self_link", t(`${plural(self, "row links", "rows link")} a node to itself and ${self === 1 ? "is" : "are"} not drawn`, `노드가 자기 자신으로 가는 행 ${self}개는 그리지 않아요`));
  if (blank) warn("encoding.source", "network_blank_node", t(`${plural(blank, "row has", "rows have")} an empty source or target and ${blank === 1 ? "is" : "are"} left out`, `출발이나 도착이 빈 행 ${blank}개는 빼고 그려요`));
  if (negative) warn("encoding.value", "network_negative_value", t(`${plural(negative, "link has", "links have")} a value below 0 and ${negative === 1 ? "is" : "are"} not drawn. The nodes stay`, `값이 0보다 작은 링크 ${negative}개는 그리지 않아요. 노드는 남아요`));
  if (groups) {
    const unknown = Object.keys(groups).filter((k) => !names.has(k));
    if (unknown.length) warn("options.groups", "network_group_not_found", t(`${quoted(unknown, t)} ${unknown.length === 1 ? "is" : "are"} not a node in the data`, `${quoted(unknown, t)} 노드가 데이터에 없어요`));
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
    if (!["$schema", "type", "data", "encoding", "options", "card", "theme", "facet"].includes(k)) warn(k, "unknown_key", t(`Unknown key "${k}" is ignored`, `"${k}" 키는 알 수 없어서 무시해요`));
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
  // 0.4까지 scatter는 bubble의 별칭이라, size 채널이 있으면 그때처럼 bubble로 그려요 (resolveDef와 같은 규칙). 육각 밀도는 크기를 쓰지 않아 산점도 그대로예요(checkHexbin이 알려요)
  const hexBin = hexBinned(spec.options);
  if (def?.type === "scatter" && !hexBin && spec.encoding && typeof spec.encoding === "object" && (spec.encoding as Record<string, unknown>).size !== undefined) {
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
    if (!names.includes(k) && !(hexBin && def.type === "scatter" && k === "size")) {
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
    // 기준선은 숫자 y(와플 반원은 단위 수 value)가 있어야 그려요 ({ value: 30 }처럼 키를 틀리면 그리지 않아요)
    // 타임라인의 기준선은 시간 축의 x예요 (checkTimeline)
    if (Array.isArray(options.referenceLines) && def.type !== "timeline" && def.options.some((o) => o.name === "referenceLines")) {
      const key = def.type === "waffle" ? "value" : "y";
      options.referenceLines.forEach((r, i) => {
        const y = r && typeof r === "object" ? (r as Record<string, unknown>)[key] : undefined;
        if (!(typeof y === "number" && Number.isFinite(y))) err(`options.referenceLines[${i}]`, "bad_reference_line", t(`A reference line needs a number ${key}, such as { ${key}: 30, label: "Target" }, so this one is not drawn`, `기준선에는 { ${key}: 30, label: "목표" }처럼 숫자 ${key}가 있어야 해요. 이 기준선은 그리지 않아요`));
      });
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
    // 지도 차트는 지역 이름표로 강조할 지역을 찾아요 (checkTileMap, checkChoropleth). 트리는 노드 이름과 경로로 찾아요 (checkTree)
    if (rows && rows.length && def.group !== "map" && def.type !== "tree" && typeof options.highlight === "string" && !HIGHLIGHT_KEYWORDS.includes(options.highlight)) {
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
  const facetBy = spec.facet === undefined ? undefined : checkFacet(spec.facet, def.type, optsObj, rows, fields, t, err, warn);
  if (def.type === "line" || def.type === "area") checkBand(def.type, enc, optsObj, rows, t, err, warn);
  // 같은 x를 합쳐 그리는 차트는 aggregate 옵션이 있는 차트예요
  // 막대 레이스는 시점(frame)과 항목(label)이 같은 행을 더해요
  if (def.type === "barRace") checkDuplicates({ x: fieldOf(enc, "frame"), series: fieldOf(enc, "label") }, optsObj, rows, t, warn, undefined, "encoding.frame");
  else if (def.options.some((o) => o.name === "aggregate")) checkDuplicates(enc, optsObj, rows, t, warn, facetBy);
  if (def.type === "pie" || def.type === "donut") checkSlices(enc, optsObj, rows, t, warn);
  if (def.type === "slope") checkSlope(enc, optsObj, rows, t, warn);
  // 날짜를 읽는 차트는 dayFirst 옵션이 있는 차트예요
  if (def.options.some((o) => o.name === "dayFirst")) checkDates(def.type, enc, optsObj, rows, t, warn);
  if (def.type === "histogram") checkHistogram(rows, enc, optsObj, binned, err, warn, t);
  if (def.type === "tileMap") checkTileMap(rows, enc, optsObj, err, warn, t);
  if (def.type === "barRace") checkBarRace(rows, enc, optsObj, warn, t);
  if (def.type === "network") checkNetwork(rows, enc, optsObj, warn, t);
  if (def.type === "timeline") checkTimeline(rows, enc, optsObj, err, warn, t);
  if (def.type === "tree") checkTree(rows, enc, optsObj, warn, t);
  if (def.type === "choropleth") checkChoropleth(rows, enc, optsObj, err, warn, t);
  if (def.type === "symbolMap") checkSymbolMap(rows, enc, optsObj, err, warn, t);
  if (def.type === "flowMap") checkFlowMap(rows, enc, optsObj, err, warn, t);
  if (def.type === "bar") checkDiverging(enc, optsObj, rows, t, err, warn);
  if (def.type === "waffle") checkWaffle(enc, optsObj, rows, t, warn);
  if (def.type === "scatter") {
    checkHexbin(enc, optsObj, facetBy !== undefined, t, warn);
    checkPointRanges(enc, optsObj, rows, t, err, warn);
  }
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
          warn("card.legend", "legend_toggle_ignored", t('card.legend "toggle" works on line, area, bar, scatter and timeline, so this chart draws a plain legend', 'card.legend "toggle"은 line, area, bar, scatter, timeline에서만 켜고 꺼요. 이 차트는 보통 범례로 그려요'));
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
