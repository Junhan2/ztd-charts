/**
 * React 없이 쓰는 스펙 도구: 레지스트리, JSON Schema, 검증, 추천, 예시 데이터.
 * 글은 영어가 기본이고 한글은 localizeDef, chartsIn, specSchemaIn, schemaForIn, { lang: "ko" }로 받아요.
 * 한글 표(locales/ko)는 이 함수들만 불러서, validateSpec, specSchema만 쓰면 번들에 들어가지 않아요.
 * CLI와 MCP 서버, 문서가 같이 써요.
 */
export * from "./types";
export { CHARTS, CHART_TYPES, COMMON_OPTIONS, getChartDef, TYPE_ALIASES } from "./registry";
export { GROUPS, LEVELS, findGroup, findLevel, type LabelDef } from "./labels";
export { specLocale, specTemplate, downloadFields } from "./meta";
export { localizeDef, chartsIn, commonOptionsIn, specSchemaIn, schemaForIn } from "./localize";
export { VARIANTS, variantSpec, variantsIn, type ChartVariant } from "./variants";
export { specSchema, schemaFor, chartSchema, optionSchema, SCHEMA_ID, type JSONSchema, type SchemaText } from "./schema";
export { validateSpec, formatIssues, inlineRows, levenshtein, closest } from "./validate";
export { suggestCharts, profileData, type ColumnProfile, type DataProfile, type Suggestion, type ColumnKind } from "./suggest";
/** 예시 데이터: pieSample, lineSample … (네임스페이스 객체는 트리 셰이킹을 막아서 이름으로 내보내요) */
export * from "./samples";
export { parseCSV, toCSV, fromRows, fromObjects, melt, normalizeData } from "../data/parse";
export { percentile, percentiles, type PercentilesOptions } from "../data/percentile";
