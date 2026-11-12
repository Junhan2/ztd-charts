import { findLevel } from "./labels";
import { KO_CHARTS, KO_COMMON_OPTIONS, SCHEMA_TEXT_KO } from "./locales/ko";
import { META } from "./meta";
import { CHARTS, COMMON_OPTIONS, getChartDef } from "./registry";
import { buildSchemaFor, buildSpecSchema, schemaFor, specSchema, type JSONSchema } from "./schema";
import type { ChartDef, ChartSpec, Lang, OptionDef } from "./types";

/** The locale that Korean examples and suggested specs write to options.locale, so the text charts generate (tooltips, legends, badges) is Korean too with no extra setting */
const KO_LOCALE = "ko-KR";

/** Writes options.locale into a Korean spec. The key order stays type, data, encoding, options, card */
export function withKoLocale(spec: ChartSpec): ChartSpec {
  const { card, ...rest } = spec;
  return { ...rest, options: { locale: KO_LOCALE, ...rest.options }, ...(card ? { card } : {}) };
}

/**
 * Registry text in one language. "en" returns it as is; "ko" gives Korean names, descriptions, channel and option descriptions and example specs, with "ko-KR" as the example's options.locale.
 * Language-independent values such as nameEn, type, component, option names and defaults stay as they are.
 */
export function localizeDef(def: ChartDef, lang: Lang): ChartDef {
  const ko = lang === "ko" ? KO_CHARTS[def.type] : undefined;
  if (!ko) return def;
  const name = META[def.type]?.nameKo ?? def.name;
  // The example's type, card number, title and level are filled by the same rules as fill() in registry.ts. The key order matches the English example too
  const { card, ...spec } = ko.example;
  const { legend, ...text } = card;
  return {
    ...def,
    name,
    summary: ko.summary,
    useWhen: ko.useWhen,
    avoidWhen: ko.avoidWhen,
    why: ko.why,
    encoding: def.encoding.map((c) => ({ ...c, description: ko.channels[c.name] ?? c.description })),
    options: def.options.map((o) => ({ ...o, description: ko.options[o.name] ?? o.description })),
    example: withKoLocale({ type: def.type, ...spec, card: { number: def.example.card?.number, title: name, ...text, level: findLevel(def.level)?.ko, ...(legend && { legend }) } }),
  };
}

/** The 44 charts in one language. Example: chartsIn("ko")[0].name === "파이 차트" */
export function chartsIn(lang: Lang): ChartDef[] {
  return lang === "ko" ? CHARTS.map((c) => localizeDef(c, "ko")) : CHARTS;
}

/** Common options in one language */
export function commonOptionsIn(lang: Lang): OptionDef[] {
  return lang === "ko" ? COMMON_OPTIONS.map((o) => ({ ...o, description: KO_COMMON_OPTIONS[o.name] ?? o.description })) : COMMON_OPTIONS;
}

/** The full spec JSON Schema in one language. "en" is the same as specSchema() */
export function specSchemaIn(lang: Lang): JSONSchema {
  return lang === "ko" ? buildSpecSchema(chartsIn("ko"), commonOptionsIn("ko"), SCHEMA_TEXT_KO) : specSchema();
}

/** The standalone schema of one chart type in one language. "en" is the same as schemaFor(type) */
export function schemaForIn(type: string, lang: Lang): JSONSchema | null {
  if (lang !== "ko") return schemaFor(type);
  const def = getChartDef(type);
  return def ? buildSchemaFor(localizeDef(def, "ko"), commonOptionsIn("ko"), SCHEMA_TEXT_KO) : null;
}
