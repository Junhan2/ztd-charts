import { FACET_TYPES } from "./meta";
import { ANNOTATION_TYPES, CHARTS, COMMON_OPTIONS, getChartDef } from "./registry";
import type { ChartDef, OptionDef } from "./types";

export type JSONSchema = Record<string, unknown>;

export const SCHEMA_ID = "https://unpkg.com/ztd-charts/schema/chart-spec.schema.json";

const FORMAT_NAMES = ["number", "integer", "percent", "ratio", "compact", "currency", "decimal"];

/**
 * Fixed text used in schema descriptions. English by default (SCHEMA_TEXT_EN); Korean is SCHEMA_TEXT_KO in locales/ko.ts.
 * The Korean schemas are built by specSchemaIn and schemaForIn in localize.ts (this file does not load the Korean tables).
 */
export interface SchemaText {
  /** Description of the whole schema */
  spec: string;
  /** The "Use when" and "Avoid when" labels of a chart description */
  useWhen: string;
  avoidWhen: string;
  data: string;
  csv: string;
  url: string;
  select: string;
  card: string;
  number: string;
  source: string;
  note: string;
  accent: string;
  download: string;
  legend: string;
  takeaway: string;
  level: string;
  sample: string;
  theme: string;
  /** Description of the format option's Intl object */
  formatObject: string;
  /** Field descriptions of annotations items */
  annotation: { type: string; x: string; y: string; from: string };
  /** Descriptions of spec.facet (small multiples) and its keys */
  facet: { spec: string; by: string; columns: string; scale: string };
}

export const SCHEMA_TEXT_EN: SchemaText = {
  spec: "Declarative chart spec for ztd-charts: { type, data, encoding, options, card, theme }",
  useWhen: "Use when",
  avoidWhen: "Avoid when",
  data: "An array of objects, or one of { values }, { csv }, { url }",
  csv: "CSV text (the first line is the header)",
  url: "JSON or CSV address (REST API, Google Sheets CSV export and so on)",
  select: 'Path to the array inside the response JSON. For example "data.items"',
  card: "Wraps the chart in a card with a number, title, legend, one-line takeaway, level badge, source line and download buttons",
  number: 'For example "01"',
  source: 'Source line under the chart, after "Source: "',
  note: "Note on the same line, such as the as-of date",
  accent: "A word of the title to color with the accent color, used instead of a legend",
  download: "Download buttons in the browser: true for CSV, SVG and PNG, or a list. Not drawn in SVG, PNG or static HTML",
  legend: '"auto" builds the legend from the data. "toggle" also lets viewers click it to show and hide series in the browser (line, area, bar, scatter, and timeline groups). Images and static HTML draw it like "auto"',
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
  facet: {
    spec: "Small multiples: the same chart once per value of one field, in a grid, with hover shared across panels. For when one chart would hold too many series to read",
    by: 'Field to split by, for example "region". One panel per value in first-appearance order, up to 24',
    columns: "Most panels per row. Without it, as many as fit at a panel width of 140px or more",
    scale: '"shared" (default) puts every panel on one value scale (and one date or number x range) so heights compare. "free" fits each panel to its own data and labels every value axis',
  },
};

/** The spec.facet schema. Added only to the schemas of charts that draw facets (line, area, bar, scatter) */
function facetSchema(t: SchemaText): JSONSchema {
  return {
    type: "object",
    description: t.facet.spec,
    required: ["by"],
    properties: {
      by: { type: "string", description: t.facet.by },
      columns: { type: "integer", minimum: 1, description: t.facet.columns },
      scale: { enum: ["shared", "free"], default: "shared", description: t.facet.scale },
    },
    additionalProperties: false,
  };
}

/** Definitions of data, card, theme and tooltip. All 44 charts point to the same tooltip (writing it per chart would grow the full schema by about 24KB) */
function sharedDefs(t: SchemaText, common: OptionDef[]): Record<"data" | "card" | "theme" | "tooltip", JSONSchema> {
  const tip = common.find((o) => o.type === "tooltip");
  return {
    tooltip: tip ? optionSchema(tip, t) : { type: "boolean" },
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
          description: t.legend,
          anyOf: [
            { enum: ["auto", "toggle"] },
            {
              type: "array",
              items: { type: "object", required: ["label"], properties: { label: { type: "string" }, color: { type: "string" }, shape: { enum: ["square", "line", "dash", "circle"] } }, additionalProperties: false },
            },
          ],
        },
        sample: { anyOf: [{ type: "boolean" }, { type: "string" }], description: t.sample },
        replay: { type: "boolean", default: true },
        source: { type: "string", description: t.source },
        note: { type: "string", description: t.note },
        accent: { type: "string", description: t.accent },
        download: { anyOf: [{ type: "boolean" }, { type: "array", items: { enum: ["csv", "svg", "png"] }, minItems: 1 }], description: t.download },
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
  // Shared by number options and the items of number arrays
  const range = { ...(o.min !== undefined ? { minimum: o.min } : {}), ...(o.max !== undefined ? { maximum: o.max } : {}) };
  switch (o.type) {
    case "number":
      return { ...base, type: "number", ...range };
    case "string":
      return { ...base, type: "string" };
    case "boolean":
      return { ...base, type: "boolean" };
    case "tooltip":
      return { ...base, anyOf: [{ type: "boolean" }, { type: "object", required: ["template"], properties: { template: { type: "string" } }, additionalProperties: false }] };
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

/** The spec schema of one chart. Pass def, common options and text in the same language. With shared, tooltip points into $defs (for the full and per-chart schemas, which carry $defs) */
export function chartSchema(def: ChartDef, common: OptionDef[] = COMMON_OPTIONS, t: SchemaText = SCHEMA_TEXT_EN, shared = false): JSONSchema {
  const enc: Record<string, JSONSchema> = {};
  for (const c of def.encoding) {
    enc[c.name] = c.multi
      ? { description: `${c.description} (${c.type})`, anyOf: [{ type: "string" }, { type: "array", items: { type: "string" }, minItems: 1 }] }
      : { type: "string", description: `${c.description} (${c.type})` };
  }
  const opts: Record<string, JSONSchema> = {};
  for (const o of [...def.options, ...common]) opts[o.name] = shared && o.type === "tooltip" ? { $ref: "#/$defs/tooltip" } : optionSchema(o, t);
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
      ...(FACET_TYPES.includes(def.type) ? { facet: facetSchema(t) } : {}),
    },
    additionalProperties: false,
  };
}

/** Builds the full schema from a chart list, common options and text. Shared by specSchema and specSchemaIn */
export function buildSpecSchema(charts: ChartDef[], common: OptionDef[], t: SchemaText): JSONSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: SCHEMA_ID,
    title: "ztd charts spec",
    description: t.spec,
    type: "object",
    required: ["type", "data"],
    properties: { type: { enum: charts.map((c) => c.type) } },
    oneOf: charts.map((c) => chartSchema(c, common, t, true)),
    $defs: sharedDefs(t, common),
  };
}

/** Builds the standalone schema of one chart. Shared by schemaFor and schemaForIn */
export function buildSchemaFor(def: ChartDef, common: OptionDef[], t: SchemaText): JSONSchema {
  return { $schema: "https://json-schema.org/draft/2020-12/schema", $id: SCHEMA_ID.replace(/chart-spec\.schema\.json$/, `charts/${def.type}.schema.json`), ...chartSchema(def, common, t, true), $defs: sharedDefs(t, common) };
}

/** Spec JSON Schema covering every chart (draft 2020-12). Descriptions are English; Korean through specSchemaIn("ko") */
export function specSchema(): JSONSchema {
  return buildSpecSchema(CHARTS, COMMON_OPTIONS, SCHEMA_TEXT_EN);
}

/** The standalone schema of one chart type. Descriptions are English; Korean through schemaForIn(type, "ko") */
export function schemaFor(type: string): JSONSchema | null {
  const def = getChartDef(type);
  return def ? buildSchemaFor(def, COMMON_OPTIONS, SCHEMA_TEXT_EN) : null;
}
