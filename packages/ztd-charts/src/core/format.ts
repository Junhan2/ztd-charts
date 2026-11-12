import { langOf } from "./i18n";

/** Number and date formats. The default locale is en-US; "ko" uses the 만 and 억 units (10^4 and 10^8) and the won */
export type FormatName = "number" | "integer" | "percent" | "ratio" | "compact" | "currency" | "decimal";
export type ValueFormatter = (v: number) => string;

/** Unit after the value. A missing value shows only "-" (with the unit it would read like "-원"). Charts and StatCard follow the same rule */
export const withUnit = (fmt: ValueFormatter, unit = ""): ValueFormatter => (v) => (Number.isFinite(v) ? `${fmt(v)}${unit}` : fmt(v));
export type FormatSpec = FormatName | ValueFormatter | (Intl.NumberFormatOptions & { suffix?: string; prefix?: string });

export const DEFAULT_LOCALE = "en-US";

const nfCache = new Map<string, Intl.NumberFormat>();
/** One decimal place unless a maximum is given. A larger minimum wins, and a currency keeps its own digits (USD 2) */
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

/** Drops the "-0" of a negative number that rounds to 0 (-0.03 → "0", "-0%" → "0%"). Text without any nonzero digit counts as 0 */
function dropNegativeZero(s: string): string {
  return /^[-\u2212]/.test(s) && !/[1-9]/.test(s) ? s.slice(1) : s;
}

export function formatNumber(v: number, opts: Intl.NumberFormatOptions & { locale?: string } = {}): string {
  if (!Number.isFinite(v)) return "-";
  const { locale = DEFAULT_LOCALE, ...rest } = opts;
  return dropNegativeZero(nf(locale, rest).format(v));
}

/** A very small value that becomes 0 at one decimal place (but not 0 itself) */
const isTiny = (v: number) => v !== 0 && Math.abs(v) < 0.05;

/** Very small values get 2 significant digits ("0.000012" instead of "0") */
const formatTiny = (v: number, locale: string, suffix = "") => `${formatNumber(v, { locale, maximumSignificantDigits: 2, maximumFractionDigits: 20 })}${suffix}`;

/** Formats a 0 to 100 value as "42%". One decimal place only below 1%, 2 significant digits below 0.05% */
export function formatPercent(v: number, opts: Intl.NumberFormatOptions & { locale?: string } = {}): string {
  if (!Number.isFinite(v)) return "-";
  if (isTiny(v) && opts.maximumFractionDigits === undefined) return formatTiny(v, opts.locale ?? DEFAULT_LOCALE, "%");
  const a = Math.abs(v);
  return `${formatNumber(v, { maximumFractionDigits: a > 0 && a < 1 ? 1 : 0, ...opts })}%`;
}

/** Compact number. English gives 1.2K, 3.4M, 1.2B (Intl compact); Korean gives 1.2만, 3.4억 */
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
      // When rounding reaches the next unit, move up to it (9,999.96 → 1만, 99,995,000 → 1억)
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

/** Currency format options. Without a currency, Korean uses the won and every other language the dollar; only the won is written without decimals */
const currencyOptions = (locale?: string, currency = langOf(locale) === "ko" ? "KRW" : "USD"): Intl.NumberFormatOptions => ({ style: "currency", currency, maximumFractionDigits: currency === "KRW" ? 0 : 2 });

export function formatCurrency(v: number, opts: Intl.NumberFormatOptions & { locale?: string } = {}): string {
  const { currency, ...rest } = opts;
  return formatNumber(v, { ...currencyOptions(opts.locale, currency), ...rest });
}

/** Turns a format name, Intl options or a function into a formatter. The Intl instance is created only once */
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

/** For axis ticks: large numbers in compact form */
export function makeTickFormatter(spec: FormatSpec | undefined, locale = DEFAULT_LOCALE, maxAbs = 0): ValueFormatter {
  if (spec !== undefined) return makeFormatter(spec, locale);
  // Compact notation has one decimal place, so ticks below 0.05 become "0". Such values get two significant digits (log axis)
  if (maxAbs >= 1e5) return (v) => (isTiny(v) ? formatTiny(v, locale) : formatCompact(v, { locale }));
  return (v) => formatNumber(v, { locale });
}

/** Local midnight from year, month and day. A nonexistent day ("2024-02-30") gives null instead of rolling into the next month */
function ymd(y: string | number, m: string | number, d: string | number = 1): Date | null {
  const t = new Date(+y, +m - 1, +d);
  return t.getMonth() === +m - 1 && t.getDate() === +d ? t : null;
}

/** Whether the value is a 4-digit integer and so read as a year */
export const isYear = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1000 && (v as number) <= 9999;

/** ISO-style date text ("2024-03", "2024-03-05", "2024-03-05 14:00", "2024-03-05T14:00Z") */
export const ISO_DATE_RE = /^\d{4}-\d{1,2}(-\d{1,2})?([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** Month of an English month name (prefixes longer than three letters too). 0 otherwise ("Marketing" and "Mayday" are not months) */
export const monthOf = (w: string) => {
  const s = w.toLowerCase();
  return s.length < 3 ? 0 : MONTHS.findIndex((n) => n.startsWith(s)) + 1;
};
/** Two-digit year (as in Excel, 00 to 29 is 20xx and 30 to 99 is 19xx) */
const yy = (s: string) => +s + (+s < 30 ? 2000 : 1900);

/** The dayFirst prop of charts that read dates (line, area, stream, sparkline, skyline, candlestick, calendar) */
export interface DayFirstProps {
  /** Reads a date like "05/03/2024", where either part could be the day or the month, as day first. When unset, the unambiguous dates in the column decide; failing that, month first */
  dayFirst?: boolean;
}

/** Local date "YYYY-MM-DD" of a timestamp (ms) */
export function isoDay(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** [year, month, day, kind] of a date text. Kind 1 day, 2 month, 3 quarter. null when the text is not a date */
export type DateParts = [number, number, number, 1 | 2 | 3];

/** Year-first notations: ISO dates and months, dots or slashes, 8-digit numbers, Korean style. Without a day it is a month (kind 2) */
const YEAR_FIRST = [/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/, /^(\d{4})[./]\s*(\d{1,2})[./]\s*(\d{1,2})\.?$/, /^(19\d\d|20\d\d|2100)(\d\d)(\d\d)$/, /^(\d{4})년\s*(\d{1,2})월(?:\s*(\d{1,2})일)?$/];
/** Year-last "05/03/2024" (the same separator twice). Groups 1 and 3 are the day and month candidates, group 4 the year */
export const DMY_RE = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})$/;
/** A {name} slot in a tooltip template (options.tooltip.template). TEMPLATE_NAMES are read from the pointed item, other names from that row's columns (shared by templateTooltip and the validator) */
export const TEMPLATE_SLOT = /\{([^{}]+)\}/g;
export const TEMPLATE_NAMES = ["label", "value", "series"];

/**
 * Strictly reads the date notations common in tables (except ISO with a time).
 * "2024-03-05" "2024.03.05" "2024. 3. 5." "2024/03/05" 20240305 "2024년 3월 5일" "2024년 3월" "24.03.05"
 * "2024Q1" "Q1 2024" "2024년 1분기" "05/03/2024" "Mar 5, 2024" "5 Mar 2024" "Apr 2024".
 * In a year-last "05/03/2024", the first part is the day when it is above 12; when both are 12 or less, the day comes first only with dayFirst
 */
export function dateParts(s: string, dayFirst?: boolean): DateParts | null {
  let m: RegExpExecArray | null;
  for (const re of YEAR_FIRST) if ((m = re.exec(s))) return [+m[1], +m[2], +(m[3] ?? 1), m[3] ? 1 : 2];
  // ISO with a time ("2024-03-05T14:00Z") matches none of the notations below. Stop here so large tables do not run eight more regexes
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

/** Whether the text is read on a date axis (ISO, ISO with a time, the notations above) */
export const isDateText = (s: string): boolean => ISO_DATE_RE.test(s) || dateParts(s) !== null;

/**
 * Day and month order of a column of year-last dates ("05/03/2024"). true (day first) when some first part is above 12,
 * false when some second part is above 12, undefined when neither (all ambiguous)
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
 * Converts to a Date. Accepts the date notations above, 20240315 (YYYYMMDD), timestamps (10 digits are Unix seconds, 13 digits ms) and Date.
 * dayFirst says whether to read the day first when either part could be the day or the month, as in "05/03/2024"
 */
export function toDate(v: unknown, dayFirst?: boolean): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    if (Number.isInteger(v)) {
      // A 4-digit number is a year
      if (isYear(v)) return new Date(v, 0, 1);
      // 8 digits from 19000101 to 21001231 are YYYYMMDD (as ms, that range falls in the early hours of 1970-01-01, so it does not clash with real timestamps)
      if (v >= 19000101 && v <= 21001231) return toDate(`${v}`);
    }
    // 10 digits are Unix seconds (10-digit ms covers only January to April 1970, so it does not clash with real data)
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

/** Units for formatDuration: the Intl unit name and length (ms), largest first */
const DURATION_UNITS: [string, number][] = [
  ["day", 86400000],
  ["hour", 3600000],
  ["minute", 60000],
  ["second", 1000],
];

/**
 * Formats a duration (ms) as short text for the locale: "7 min", "2d 4h", "45 sec", "120 ms", and "1.5 yrs" beyond a year.
 * When the larger unit is under 10, the next unit is added (Korean "2일 4시간"). Unit text uses Intl.NumberFormat's unit style
 */
export function formatDuration(ms: number, locale = DEFAULT_LOCALE): string {
  if (!Number.isFinite(ms)) return "-";
  const a = Math.abs(ms);
  const sign = ms < 0 ? "-" : "";
  const unit = (u: string, v: number, display: "short" | "narrow" = "short", digits = 0) => formatNumber(v, { locale, style: "unit", unit: u, unitDisplay: display, maximumFractionDigits: digits });
  if (a >= 86400000 * 365) return sign + unit("year", a / (86400000 * 365.25), "short", 1);
  for (let k = 0; k < DURATION_UNITS.length; k++) {
    const [u, len] = DURATION_UNITS[k];
    if (a < len) continue;
    let q = Math.floor(a / len);
    const next = DURATION_UNITS[k + 1];
    if (q >= 10 || !next) return sign + unit(u, u === "second" && q < 10 ? a / len : Math.round(a / len), "short", u === "second" ? 1 : 0);
    let r = Math.round((a - q * len) / next[1]);
    if (r * next[1] >= len) {
      q++;
      r = 0;
    }
    return sign + (r ? `${unit(u, q, "narrow")} ${unit(next[0], r, "narrow")}` : unit(u, q));
  }
  return sign + unit("millisecond", a);
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
