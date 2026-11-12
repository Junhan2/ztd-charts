/**
 * Language of the text charts generate themselves (tooltip names, screen reader sentences, buttons).
 * English is the source; Korean is used when the locale is "ko" or "ko-*".
 * Only text shared by all charts lives here; text used by a single chart stays in that chart's file (keeping each chart's bundle light)
 */
export type ChartLang = "en" | "ko";

/** Maps a locale to a text language. "ko" for "ko" or "ko-*", "en" for everything else (including none) */
export function langOf(locale?: string): ChartLang {
  return locale !== undefined && /^ko([-_]|$)/i.test(locale) ? "ko" : "en";
}

/** English plural. plural(3, "item") → "3 items" */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Text used by all charts (English source). Wording used by only some charts stays in those chart files */
export const en = {
  /** aria-roledescription */
  chart: "chart",
  /** Title of the screen reader table */
  table: (label: string) => `${label} data`,
  /** Last row when the table is cut short */
  more: (n: number) => `and ${n} more`,
  /** Name of the value in tooltips */
  value: "Value",
  /** Screen reader description when there is no data */
  empty: "No data.",
};

export type ChartMessages = typeof en;

export const ko: ChartMessages = {
  chart: "차트",
  table: (label) => `${label} 데이터`,
  more: (n) => `외 ${n}개`,
  value: "값",
  empty: "데이터가 없어요.",
};
