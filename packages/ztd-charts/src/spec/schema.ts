import { ANNOTATION_TYPES, CHARTS, COMMON_OPTIONS, getChartDef } from "./registry";
import type { ChartDef, OptionDef } from "./types";

export type JSONSchema = Record<string, unknown>;

export const SCHEMA_ID = "https://unpkg.com/ztd-charts/schema/chart-spec.schema.json";

const FORMAT_NAMES = ["number", "integer", "percent", "ratio", "compact", "currency", "decimal"];

/**
 * 스키마 설명에 들어가는 고정 글. 기본은 영어(SCHEMA_TEXT_EN)이고 한글은 locales/ko.ts의 SCHEMA_TEXT_KO예요.
 * 한글 스키마는 localize.ts의 specSchemaIn, schemaForIn이 만들어요 (이 파일은 한글 표를 불러오지 않아요).
 */
export interface SchemaText {
  /** 전체 스키마 설명 */
  spec: string;
  /** 차트 설명의 "쓸 때", "피할 때" */
  useWhen: string;
  avoidWhen: string;
  data: string;
  csv: string;
  url: string;
  select: string;
  card: string;
  number: string;
  takeaway: string;
  level: string;
  sample: string;
  theme: string;
  /** format 옵션의 Intl 객체 설명 */
  formatObject: string;
  /** annotations 항목의 필드 설명 */
  annotation: { type: string; x: string; y: string; from: string };
}

export const SCHEMA_TEXT_EN: SchemaText = {
  spec: "Declarative chart spec for ztd-charts: { type, data, encoding, options, card, theme }",
  useWhen: "Use when",
  avoidWhen: "Avoid when",
  data: "An array of objects, or one of { values }, { csv }, { url }",
  csv: "CSV text (the first line is the header)",
  url: "JSON or CSV address (REST API, Google Sheets CSV export and so on)",
  select: 'Path to the array inside the response JSON. For example "data.items"',
  card: "Wraps the chart in a card with a number, title, legend, one-line takeaway and level badge",
  number: 'For example "01"',
  takeaway: "Bold one-line takeaway at the bottom",
  level: '"basic" | "intermediate" | "advanced". The Korean "기본" | "중급" | "심화" also work',
  sample: "Marks the data as sample data",
  theme: 'Token overrides. For example { accent: "#00C2FF" }',
  formatObject: "Intl.NumberFormat options plus suffix and prefix",
  annotation: {
    type: '"band" shaded range | "line" reference line | "event" marker | "forecast" dashed from here on | "trend" least-squares line | "weekends" shading (date x)',
    x: "event: the x value. band: [from, to] on x",
    y: "line: the y value. band: [low, high] on y",
    from: "forecast: the x value where the forecast starts",
  },
};

/** data, card, theme 정의 */
function sharedDefs(t: SchemaText): Record<"data" | "card" | "theme", JSONSchema> {
  return {
    data: {
      description: t.data,
      anyOf: [
        { type: "array", items: { type: "object" } },
        { type: "object", required: ["values"], properties: { values: { type: "array", items: { type: "object" } } }, additionalProperties: false },
        { type: "object", required: ["csv"], properties: { csv: { type: "string", description: t.csv } }, additionalProperties: false },
        {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", description: t.url },
            format: { enum: ["json", "csv", "auto"], default: "auto" },
            select: { type: "string", description: t.select },
          },
          additionalProperties: false,
        },
      ],
    },
    card: {
      type: "object",
      description: t.card,
      properties: {
        number: { type: "string", description: t.number },
        title: { type: "string" },
        subtitle: { type: "string" },
        takeaway: { type: "string", description: t.takeaway },
        level: { type: "string", description: t.level },
        legend: {
          anyOf: [
            { const: "auto" },
            {
              type: "array",
              items: { type: "object", required: ["label"], properties: { label: { type: "string" }, color: { type: "string" }, shape: { enum: ["square", "line", "dash", "circle"] } }, additionalProperties: false },
            },
          ],
        },
        sample: { anyOf: [{ type: "boolean" }, { type: "string" }], description: t.sample },
        replay: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
    theme: {
      anyOf: [{ enum: ["dark", "light"] }, { type: "object", description: t.theme, additionalProperties: { type: ["string", "number"] } }],
    },
  };
}

export function optionSchema(o: OptionDef, t: SchemaText = SCHEMA_TEXT_EN): JSONSchema {
  const base: JSONSchema = { description: o.description };
  if (o.default !== undefined) base.default = o.default;
  // 숫자 옵션과 숫자 배열의 항목이 같이 써요
  const range = { ...(o.min !== undefined ? { minimum: o.min } : {}), ...(o.max !== undefined ? { maximum: o.max } : {}) };
  switch (o.type) {
    case "number":
      return { ...base, type: "number", ...range };
    case "string":
      return { ...base, type: "string" };
    case "boolean":
      return { ...base, type: "boolean" };
    case "enum":
      return { ...base, enum: [...(o.enum ?? [])] };
    case "array":
      return {
        ...base,
        type: "array",
        ...(o.items ? { items: { type: o.items, ...range } } : {}),
        ...(o.length !== undefined ? { minItems: o.length, maxItems: o.length } : {}),
      };
    case "object":
      return { ...base, type: "object" };
    case "highlight":
      return { ...base, anyOf: [{ type: "number" }, { type: "string" }, { type: "array", items: { type: ["number", "string"] } }] };
    case "format":
      return { ...base, anyOf: [{ enum: FORMAT_NAMES }, { type: "object", description: t.formatObject }] };
    case "annotations":
      return {
        ...base,
        type: "array",
        items: {
          type: "object",
          required: ["type"],
          properties: {
            type: { enum: [...ANNOTATION_TYPES], description: t.annotation.type },
            x: { description: t.annotation.x },
            y: { description: t.annotation.y, anyOf: [{ type: "number" }, { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }] },
            from: { description: t.annotation.from },
            label: { type: "string" },
          },
          additionalProperties: false,
        },
      };
    default:
      return base;
  }
}

/** 차트 하나의 스펙 스키마. def, 공통 옵션, 글은 같은 언어로 맞춘 것을 넘겨요 */
export function chartSchema(def: ChartDef, common: OptionDef[] = COMMON_OPTIONS, t: SchemaText = SCHEMA_TEXT_EN): JSONSchema {
  const enc: Record<string, JSONSchema> = {};
  for (const c of def.encoding) {
    enc[c.name] = c.multi
      ? { description: `${c.description} (${c.type})`, anyOf: [{ type: "string" }, { type: "array", items: { type: "string" }, minItems: 1 }] }
      : { type: "string", description: `${c.description} (${c.type})` };
  }
  const opts: Record<string, JSONSchema> = {};
  for (const o of [...def.options, ...common]) opts[o.name] = optionSchema(o, t);
  const required = def.encoding.filter((c) => c.required).map((c) => c.name);
  return {
    title: def.name === def.nameEn ? def.name : `${def.name} (${def.nameEn})`,
    description: `${def.summary}. ${t.useWhen}: ${def.useWhen}. ${t.avoidWhen}: ${def.avoidWhen}`,
    type: "object",
    required: ["type", "data"],
    properties: {
      $schema: { type: "string" },
      type: { const: def.type },
      data: { $ref: "#/$defs/data" },
      encoding: { type: "object", properties: enc, ...(required.length ? { required } : {}), additionalProperties: false },
      options: { type: "object", properties: opts, additionalProperties: false },
      card: { $ref: "#/$defs/card" },
      theme: { $ref: "#/$defs/theme" },
    },
    additionalProperties: false,
  };
}

/** 차트 목록, 공통 옵션, 글로 전체 스키마를 만들어요. specSchema와 specSchemaIn이 같이 써요 */
export function buildSpecSchema(charts: ChartDef[], common: OptionDef[], t: SchemaText): JSONSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: SCHEMA_ID,
    title: "ztd charts spec",
    description: t.spec,
    type: "object",
    required: ["type", "data"],
    properties: { type: { enum: charts.map((c) => c.type) } },
    oneOf: charts.map((c) => chartSchema(c, common, t)),
    $defs: sharedDefs(t),
  };
}

/** 차트 하나의 독립 스키마를 만들어요. schemaFor와 schemaForIn이 같이 써요 */
export function buildSchemaFor(def: ChartDef, common: OptionDef[], t: SchemaText): JSONSchema {
  return { $schema: "https://json-schema.org/draft/2020-12/schema", $id: SCHEMA_ID.replace(/chart-spec\.schema\.json$/, `charts/${def.type}.schema.json`), ...chartSchema(def, common, t), $defs: sharedDefs(t) };
}

/** 모든 차트를 담은 스펙 JSON Schema (draft 2020-12). 설명은 영어, 한글은 specSchemaIn("ko") */
export function specSchema(): JSONSchema {
  return buildSpecSchema(CHARTS, COMMON_OPTIONS, SCHEMA_TEXT_EN);
}

/** 차트 한 종류의 독립 스키마. 설명은 영어, 한글은 schemaForIn(type, "ko") */
export function schemaFor(type: string): JSONSchema | null {
  const def = getChartDef(type);
  return def ? buildSchemaFor(def, COMMON_OPTIONS, SCHEMA_TEXT_EN) : null;
}
