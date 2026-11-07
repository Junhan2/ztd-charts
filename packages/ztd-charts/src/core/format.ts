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

/** 0~100 값을 "42%"로. 1% 미만만 소수 한 자리 */
export function formatPercent(v: number, opts: Intl.NumberFormatOptions & { locale?: string } = {}): string {
  if (!Number.isFinite(v)) return "-";
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
    default:
      return fixed({ maximumFractionDigits: 1 });
  }
}

/** 축 눈금용: 큰 수는 짧게 */
export function makeTickFormatter(spec: FormatSpec | undefined, locale = DEFAULT_LOCALE, maxAbs = 0): ValueFormatter {
  if (spec !== undefined) return makeFormatter(spec, locale);
  if (maxAbs >= 1e5) return (v) => formatCompact(v, { locale });
  return (v) => formatNumber(v, { locale });
}

/** 연, 월, 일로 로컬 자정. 없는 날("2024-02-30")은 다음 달로 넘기지 않고 null */
function ymd(y: string | number, m: string | number, d: string | number = 1): Date | null {
  const t = new Date(+y, +m - 1, +d);
  return t.getMonth() === +m - 1 && t.getDate() === +d ? t : null;
}

/** 4자리 정수라 연도로 읽는 값인지 */
export const isYear = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1000 && (v as number) <= 9999;

/** 날짜로 바꿔요. "2024-03", "2024-03-15", 20240315(YYYYMMDD), 타임스탬프, Date */
export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    if (Number.isInteger(v)) {
      // 4자리 숫자는 연도로
      if (isYear(v)) return new Date(v, 0, 1);
      // 8자리 19000101~21001231은 YYYYMMDD로 (그 범위의 ms는 1970-01-01 새벽이라 실제 타임스탬프와 겹치지 않아요)
      if (v >= 19000101 && v <= 21001231) return toDate(`${v}`);
    }
    return new Date(v);
  }
  if (typeof v === "string" && v.trim()) {
    const s = v.trim();
    const m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(s) ?? /^(\d{4})[./](\d{1,2})[./](\d{1,2})\.?$/.exec(s) ?? /^(19\d\d|20\d\d|2100)(\d\d)(\d\d)$/.exec(s);
    if (m) return ymd(m[1], m[2], m[3]);
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
