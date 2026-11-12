/**
 * Spec tools that work without React: registry, JSON Schema, validation, suggestions, sample data.
 * Text is English by default; get Korean through localizeDef, chartsIn, specSchemaIn, schemaForIn and { lang: "ko" }.
 * Only these functions load the Korean tables (locales/ko), so using just validateSpec and specSchema keeps them out of the bundle.
 * Shared by the CLI, the MCP server and the docs.
 */
export * from "./types";
export { CHARTS, CHART_TYPES, COMMON_OPTIONS, getChartDef, TYPE_ALIASES } from "./registry";
export { GROUPS, LEVELS, findGroup, findLevel, type LabelDef } from "./labels";
export { specLocale, specTemplate, downloadFields, FACET_TYPES, FACET_MAX, MAX_CHART_SIZE, capChartSize } from "./meta";
export { localizeDef, chartsIn, commonOptionsIn, specSchemaIn, schemaForIn } from "./localize";
export { VARIANTS, variantSpec, variantsIn, type ChartVariant } from "./variants";
export { specSchema, schemaFor, chartSchema, optionSchema, SCHEMA_ID, type JSONSchema, type SchemaText } from "./schema";
export { validateSpec, formatIssues, inlineRows, levenshtein, closest } from "./validate";
export { suggestCharts, profileData, type ColumnProfile, type DataProfile, type Suggestion, type ColumnKind } from "./suggest";
/** Sample data: pieSample, lineSample … (exported by name, because a namespace object would block tree shaking) */
export * from "./samples";
export { parseCSV, toCSV, fromRows, fromObjects, melt, normalizeData } from "../data/parse";
/** Names of the maps shipped in the package (ztd-charts/geo/<name>) */
export { BUILTIN_MAPS, mapExportName } from "../geo/registry";
export { percentile, percentiles, type PercentilesOptions } from "../data/percentile";
