import { langOf } from "./i18n";

/** 숫자, 날짜 포맷. 기본 로캘은 en-US이고 "ko"면 만, 억 단위와 원화를 써요 */
export type FormatName = "number" | "integer" | "percent" | "ratio" | "compact" | "currency" | "decimal";
export type ValueFormatter = (v: number) => string;

/** 값 뒤에 단위. 값이 없으면 "-"만 보여요 (단위를 붙이면 "-원"처럼 읽혀요). 차트와 StatCard가 같은 규칙을 써요 */
export const withUnit = (fmt: ValueFormatter, unit = ""): ValueFormatter => (v) => (Number.isFinite(v) ? `${fmt(v)}${unit}` : fmt(v));
export type FormatSpec = FormatName | ValueFormatter | (Intl.NumberFormatOptions & { suffix?: string; prefix?: string });

export const DEFAULT_LOCALE = "en-US";

const nfCache = new Map<string, Intl.NumberFormat>();
/** 최대 자릿수를 주지 않으면 소수 한 자리. 최소 자릿수가 더 크면 그만큼, 통화는 그 통화의 자릿수(USD 2)를 그대로 써요 */
function nf(locale: string, o: Intl.NumberFormatOptions): Intl.NumberFormat {
  const opts = o.maximumFractionDigits !== undefined || o.style === "currency" ? o : { ...o, maximumFractionDigits: Math.max(1, o.minimumFractionDigits ?? 0) };
  const key = locale + JSON.stringify(opts);
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, opts);
    nfCache.set(key, f);
  }
  return f;
}

/** 반올림하면 0이 되는 음수의 "-0"을 떼요 (-0.03 → "0", "-0%" → "0%"). 0이 아닌 숫자가 하나도 없으면 0이에요 */
function dropNegativeZero(s: string): string {
  return /^[-\u2212]/.test(s) && !/[1-9]/.test(s) ? s.slice(1) : s;
}

export function formatNumber(v: number, opts: Intl.NumberFormatOptions & { locale?: string } = {}): string {
  if (!Number.isFinite(v)) return "-";
  const { locale = DEFAULT_LOCALE, ...rest } = opts;
  return dropNegativeZero(nf(locale, rest).format(v));
}

/** 소수 한 자리로 줄이면 0이 되는 아주 작은 값 (0은 아님) */
const isTiny = (v: number) => v !== 0 && Math.abs(v) < 0.05;

/** 아주 작은 값은 유효 숫자 2자리로 ("0" 대신 "0.000012") */
const formatTiny = (v: number, locale: string, suffix = "") => `${formatNumber(v, { locale, maximumSignificantDigits: 2, maximumFractionDigits: 20 })}${suffix}`;

/** 0~100 값을 "42%"로. 1% 미만만 소수 한 자리, 0.05% 미만은 유효 숫자 2자리 */
export function formatPercent(v: number, opts: Intl.NumberFormatOptions & { locale?: string } = {}): string {
  if (!Number.isFinite(v)) return "-";
  if (isTiny(v) && opts.maximumFractionDigits === undefined) return formatTiny(v, opts.locale ?? DEFAULT_LOCALE, "%");
  const a = Math.abs(v);
  return `${formatNumber(v, { maximumFractionDigits: a > 0 && a < 1 ? 1 : 0, ...opts })}%`;
}

/** 짧게 줄인 숫자. 영어는 1.2K, 3.4M, 1.2B (Intl compact), 한국어는 1.2만, 3.4억 */
export function formatCompact(v: number, opts: Intl.NumberFormatOptions & { locale?: string } = {}): string {
  if (!Number.isFinite(v)) return "-";
  const { locale = DEFAULT_LOCALE, ...rest } = opts;
  if (langOf(locale) === "ko") {
    const a = Math.abs(v);
    const units: [number, string][] = [
      [1e12, "조"],
      [1e8, "억"],
      [1e4, "만"],
      [1, ""],
    ];
    let k = units.findIndex(([u]) => a >= u);
    if (k < 0) k = units.length - 1;
    for (;;) {
      const [u, name] = units[k];
      const q = a / u;
      const fd = Math.max(rest.minimumFractionDigits ?? 0, rest.maximumFractionDigits ?? (u === 1 || q < 100 ? 1 : 0));
      const rounded = Math.round(q * 10 ** fd) / 10 ** fd;
      // 반올림해서 윗단위가 되면 올려요 (9,999.96 → 1만, 99,995,000 → 1억)
      if (k > 0 && rounded >= units[k - 1][0] / u) {
        k--;
        continue;
      }
      const sign = v < 0 && rounded !== 0 ? "-" : "";
      return sign + formatNumber(rounded, { locale, ...rest, maximumFractionDigits: fd }) + name;
    }
  }
  return dropNegativeZero(nf(locale, { notation: "compact", ...rest }).format(v));
}

/** 통화 포맷 옵션. 통화가 없으면 한국어는 원화, 나머지는 달러이고 원화만 소수점 없이 써요 */
const currencyOptions = (locale?: string, currency = langOf(locale) === "ko" ? "KRW" : "USD"): Intl.NumberFormatOptions => ({ style: "currency", currency, maximumFractionDigits: currency === "KRW" ? 0 : 2 });

export function formatCurrency(v: number, opts: Intl.NumberFormatOptions & { locale?: string } = {}): string {
  const { currency, ...rest } = opts;
  return formatNumber(v, { ...currencyOptions(opts.locale, currency), ...rest });
}

/** 포맷 이름, Intl 옵션, 함수를 포맷터로. Intl 인스턴스는 한 번만 만들어요 */
export function makeFormatter(spec: FormatSpec | undefined, locale = DEFAULT_LOCALE, fallback?: FormatName): ValueFormatter {
  if (typeof spec === "function") return spec;
  const fixed = (opts: Intl.NumberFormatOptions, suffix = "", prefix = ""): ValueFormatter => {
    const f = nf(locale, opts);
    return (v) => (Number.isFinite(v) ? `${prefix}${dropNegativeZero(f.format(v))}${suffix}` : "-");
  };
  if (spec && typeof spec === "object") {
    const { suffix = "", prefix = "", ...o } = spec;
    return fixed(o, suffix, prefix);
  }
  switch (spec ?? fallback) {
    case "integer":
      return fixed({ maximumFractionDigits: 0 });
    case "decimal":
      return fixed({ minimumFractionDigits: 1, maximumFractionDigits: 2 });
    case "percent":
      return (v) => formatPercent(v, { locale });
    case "ratio":
      return (v) => formatPercent(v * 100, { locale });
    case "compact":
      return (v) => formatCompact(v, { locale });
    case "currency":
      return fixed(currencyOptions(locale));
    default: {
      const one = fixed({ maximumFractionDigits: 1 });
      return (v) => (isTiny(v) ? formatTiny(v, locale) : one(v));
    }
  }
}

/** 축 눈금용: 큰 수는 짧게 */
export function makeTickFormatter(spec: FormatSpec | undefined, locale = DEFAULT_LOCALE, maxAbs = 0): ValueFormatter {
  if (spec !== undefined) return makeFormatter(spec, locale);
  // 짧은 표기는 소수 한 자리라 0.05보다 작은 눈금이 "0"이 돼요. 그런 값은 유효숫자 두 자리로 (로그 축)
  if (maxAbs >= 1e5) return (v) => (isTiny(v) ? formatTiny(v, locale) : formatCompact(v, { locale }));
  return (v) => formatNumber(v, { locale });
}

/** 연, 월, 일로 로컬 자정. 없는 날("2024-02-30")은 다음 달로 넘기지 않고 null */
function ymd(y: string | number, m: string | number, d: string | number = 1): Date | null {
  const t = new Date(+y, +m - 1, +d);
  return t.getMonth() === +m - 1 && t.getDate() === +d ? t : null;
}

/** 4자리 정수라 연도로 읽는 값인지 */
export const isYear = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1000 && (v as number) <= 9999;

/** ISO 꼴 날짜 글자 ("2024-03", "2024-03-05", "2024-03-05 14:00", "2024-03-05T14:00Z") */
export const ISO_DATE_RE = /^\d{4}-\d{1,2}(-\d{1,2})?([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** 영어 월 이름(세 글자 넘는 앞부분도)의 월. 아니면 0 ("Marketing", "Mayday"는 월이 아니에요) */
export const monthOf = (w: string) => {
  const s = w.toLowerCase();
  return s.length < 3 ? 0 : MONTHS.findIndex((n) => n.startsWith(s)) + 1;
};
/** 두 자리 연도 (엑셀과 같게 00~29는 20xx, 30~99는 19xx) */
const yy = (s: string) => +s + (+s < 30 ? 2000 : 1900);

/** 날짜를 읽는 차트(선, 영역, 스트림, 스파크라인, 스카이라인, 캔들, 캘린더)의 dayFirst 프롭 */
export interface DayFirstProps {
  /** "05/03/2024"처럼 일, 월이 모두 될 수 있는 날짜를 일이 앞으로 읽어요. 없으면 열의 분명한 날짜가 정하고, 아니면 월이 앞 */
  dayFirst?: boolean;
}

/** 시각(ms)의 로컬 날짜 "YYYY-MM-DD" */
export function isoDay(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 날짜 글자의 [연, 월, 일, 종류]. 종류 1 날, 2 달, 3 분기. 날짜 표기가 아니면 null */
export type DateParts = [number, number, number, 1 | 2 | 3];

/** 연이 앞인 표기: ISO 날짜와 달, 점이나 빗금, 8자리 숫자, 한국식. 일이 없으면 달(종류 2) */
const YEAR_FIRST = [/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/, /^(\d{4})[./]\s*(\d{1,2})[./]\s*(\d{1,2})\.?$/, /^(19\d\d|20\d\d|2100)(\d\d)(\d\d)$/, /^(\d{4})년\s*(\d{1,2})월(?:\s*(\d{1,2})일)?$/];
/** 연이 끝에 있는 "05/03/2024" (같은 구분자 두 번). 1, 3번째 묶음이 일과 월 후보, 4번째가 연 */
export const DMY_RE = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})$/;
/** 툴팁 틀(options.tooltip.template)의 칸 {이름}. TEMPLATE_NAMES는 짚은 항목에서, 다른 이름은 그 행의 열에서 읽어요 (templateTooltip과 검사기가 같이 써요) */
export const TEMPLATE_SLOT = /\{([^{}]+)\}/g;
export const TEMPLATE_NAMES = ["label", "value", "series"];

/**
 * 표에서 흔한 날짜 표기를 엄격하게 읽어요 (시간이 붙은 ISO는 빼고).
 * "2024-03-05" "2024.03.05" "2024. 3. 5." "2024/03/05" 20240305 "2024년 3월 5일" "2024년 3월" "24.03.05"
 * "2024Q1" "Q1 2024" "2024년 1분기" "05/03/2024" "Mar 5, 2024" "5 Mar 2024" "Apr 2024".
 * 연이 끝에 있는 "05/03/2024"는 앞이 12보다 크면 일, 둘 다 12 이하면 dayFirst일 때만 일이 앞이에요
 */
export function dateParts(s: string, dayFirst?: boolean): DateParts | null {
  let m: RegExpExecArray | null;
  for (const re of YEAR_FIRST) if ((m = re.exec(s))) return [+m[1], +m[2], +(m[3] ?? 1), m[3] ? 1 : 2];
  // 시간이 붙은 ISO("2024-03-05T14:00Z")는 아래 표기 어느 것도 아니에요. 큰 표에서 정규식 여덟 개를 더 돌리지 않게 여기서 끝내요
  if (/^\d{4}-\d/.test(s)) return null;
  if ((m = /^(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/.exec(s))) return dayFirst ? [yy(m[3]), +m[2], +m[1], 1] : [yy(m[1]), +m[2], +m[3], 1];
  if ((m = /^(?:(\d{4})\s*-?\s*Q([1-4])|Q([1-4])\s*-?\s*(\d{4})|(\d{4})년\s*([1-4])분기)$/i.exec(s))) return [+(m[1] ?? m[4] ?? m[5]), +(m[2] ?? m[3] ?? m[6]) * 3 - 2, 1, 3];
  if ((m = DMY_RE.exec(s))) {
    const a = +m[1];
    const b = +m[3];
    const df = a > 12 || (b <= 12 && dayFirst === true);
    return [+m[4], df ? b : a, df ? a : b, 1];
  }
  if ((m = /^(\d{1,2})[\s-]+([a-z]{3,9})\.?[\s-]+(\d{4})$/i.exec(s))) {
    const mo = monthOf(m[2]);
    return mo ? [+m[3], mo, +m[1], 1] : null;
  }
  if ((m = /^([a-z]{3,9})\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})$/i.exec(s))) {
    const mo = monthOf(m[1]);
    return mo ? [+m[3], mo, +(m[2] ?? 1), m[2] ? 1 : 2] : null;
  }
  return null;
}

/** 날짜 축으로 읽는 글자인지 (ISO, 시간이 붙은 ISO, 위 표기) */
export const isDateText = (s: string): boolean => ISO_DATE_RE.test(s) || dateParts(s) !== null;

/**
 * 연이 끝에 있는 날짜("05/03/2024") 열의 일, 월 순서. 앞이 12보다 큰 값이 있으면 true(일이 앞),
 * 뒤가 12보다 큰 값이 있으면 false, 둘 다 없으면(모두 모호) undefined
 */
export function dayFirstOf(values: readonly unknown[]): boolean | undefined {
  let out: boolean | undefined;
  for (const v of values) {
    const m = typeof v === "string" ? DMY_RE.exec(v.trim()) : null;
    if (!m) continue;
    if (+m[1] > 12) return true;
    if (+m[3] > 12) out = false;
  }
  return out;
}

/**
 * 날짜로 바꿔요. 위 날짜 표기, 20240315(YYYYMMDD), 타임스탬프(10자리는 유닉스 초, 13자리는 ms), Date.
 * dayFirst는 "05/03/2024"처럼 일, 월이 모두 될 수 있을 때 일을 앞으로 읽을지예요
 */
export function toDate(v: unknown, dayFirst?: boolean): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    if (Number.isInteger(v)) {
      // 4자리 숫자는 연도로
      if (isYear(v)) return new Date(v, 0, 1);
      // 8자리 19000101~21001231은 YYYYMMDD로 (그 범위의 ms는 1970-01-01 새벽이라 실제 타임스탬프와 겹치지 않아요)
      if (v >= 19000101 && v <= 21001231) return toDate(`${v}`);
    }
    // 10자리는 유닉스 초 (10자리 ms는 1970년 1~4월뿐이라 실제 데이터와 겹치지 않아요)
    return new Date(Math.abs(v) >= 1e9 && Math.abs(v) < 1e10 ? v * 1000 : v);
  }
  if (typeof v === "string" && v.trim()) {
    const s = v.trim();
    const p = dateParts(s, dayFirst);
    if (p) return ymd(p[0], p[1], p[2]);
    if (/^\d{4}$/.test(s)) return new Date(Number(s), 0, 1);
    if (!/\d{4}/.test(s)) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const dfCache = new Map<string, Intl.DateTimeFormat>();
export function formatDate(v: unknown, opts: Intl.DateTimeFormatOptions & { locale?: string } = { month: "short", day: "numeric" }): string {
  const d = toDate(v);
  if (!d) return "-";
  const { locale = DEFAULT_LOCALE, ...rest } = opts;
  const key = locale + JSON.stringify(rest);
  let f = dfCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, rest);
    dfCache.set(key, f);
  }
  return f.format(d);
}
