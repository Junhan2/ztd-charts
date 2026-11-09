import { findLevel } from "./labels";
import { KO_CHARTS, KO_COMMON_OPTIONS, SCHEMA_TEXT_KO } from "./locales/ko";
import { META } from "./meta";
import { CHARTS, COMMON_OPTIONS, getChartDef } from "./registry";
import { buildSchemaFor, buildSpecSchema, schemaFor, specSchema, type JSONSchema } from "./schema";
import type { ChartDef, ChartSpec, Lang, OptionDef } from "./types";

/** 한글 예시와 추천 스펙이 options.locale에 적는 로캘. 그래서 차트가 만드는 글자(툴팁, 범례, 배지)도 따로 정하지 않아도 한국어예요 */
const KO_LOCALE = "ko-KR";

/** 한글 스펙에 options.locale을 적어요. 키 순서는 type, data, encoding, options, card 그대로예요 */
export function withKoLocale(spec: ChartSpec): ChartSpec {
  const { card, ...rest } = spec;
  return { ...rest, options: { locale: KO_LOCALE, ...rest.options }, ...(card ? { card } : {}) };
}

/**
 * 레지스트리 글을 한 언어로. "en"이면 그대로, "ko"면 이름, 설명, 채널과 옵션 설명, 예시 스펙이 한글이고 예시의 options.locale은 "ko-KR"이에요.
 * nameEn, type, component, 옵션 이름과 기본값처럼 언어와 상관없는 값은 그대로 둬요.
 */
export function localizeDef(def: ChartDef, lang: Lang): ChartDef {
  const ko = lang === "ko" ? KO_CHARTS[def.type] : undefined;
  if (!ko) return def;
  const name = META[def.type]?.nameKo ?? def.name;
  // 예시의 type, 카드 번호, 제목, 수준은 registry.ts의 fill()과 같은 규칙으로 채워요. 키 순서도 영어 예시와 같아요
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

/** 차트 34종을 한 언어로. 예: chartsIn("ko")[0].name === "파이 차트" */
export function chartsIn(lang: Lang): ChartDef[] {
  return lang === "ko" ? CHARTS.map((c) => localizeDef(c, "ko")) : CHARTS;
}

/** 공통 옵션을 한 언어로 */
export function commonOptionsIn(lang: Lang): OptionDef[] {
  return lang === "ko" ? COMMON_OPTIONS.map((o) => ({ ...o, description: KO_COMMON_OPTIONS[o.name] ?? o.description })) : COMMON_OPTIONS;
}

/** 전체 스펙 JSON Schema를 한 언어로. "en"이면 specSchema()와 같아요 */
export function specSchemaIn(lang: Lang): JSONSchema {
  return lang === "ko" ? buildSpecSchema(chartsIn("ko"), commonOptionsIn("ko"), SCHEMA_TEXT_KO) : specSchema();
}

/** 차트 한 종류의 독립 스키마를 한 언어로. "en"이면 schemaFor(type)와 같아요 */
export function schemaForIn(type: string, lang: Lang): JSONSchema | null {
  if (lang !== "ko") return schemaFor(type);
  const def = getChartDef(type);
  return def ? buildSchemaFor(localizeDef(def, "ko"), commonOptionsIn("ko"), SCHEMA_TEXT_KO) : null;
}
