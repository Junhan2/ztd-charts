import type { ChartLang } from "../core/i18n";

/** A chart spec written in JSON. Serializable, with no functions */
export interface ChartSpec {
  $schema?: string;
  /** Chart type. See `ztd-charts list` */
  type: string;
  /** An array of objects, or { url }, { csv }, { values } */
  data: SpecData;
  /** Channel -> field name. Example: { "label": "device", "value": "sales" } */
  encoding?: Record<string, string | string[]>;
  /** Chart options (highlight, format, height …) */
  options?: Record<string, unknown>;
  /** Wrap in a card */
  card?: SpecCard;
  /** "dark" | "light" or a token object */
  theme?: string | Record<string, unknown>;
  /** Small multiples: draws the same chart once per by value, one cell each (line, area, bar, scatter) */
  facet?: SpecFacet;
}

/** spec.facet: one panel per value of a field */
export interface SpecFacet {
  /** Field that splits the panels. In order of first appearance, up to 24 */
  by: string;
  /** Maximum panels per row. When omitted, as many as fit at 140px or more each */
  columns?: number;
  /** "shared" (default): every panel uses the same value axis (and the same date or numeric x), so heights are comparable. "free": each panel fits its own data and draws every value axis */
  scale?: "shared" | "free";
}

export type SpecData =
  | Record<string, unknown>[]
  | { values: Record<string, unknown>[] }
  | { csv: string }
  | { url: string; format?: "json" | "csv" | "auto"; select?: string };

export interface SpecCard {
  number?: string;
  title?: string;
  subtitle?: string;
  takeaway?: string;
  /** Level badge. "basic" | "intermediate" | "advanced". The old Korean values ("기본" …) are accepted too */
  level?: ChartLevel | "기본" | "중급" | "심화" | string;
  /** "auto" builds the legend from the data. "toggle" lets users press the legend in the browser to turn series on and off (the groups in line, area, bar, scatter, timeline). Same as "auto" in images and static HTML */
  legend?: "auto" | "toggle" | { label: string; color?: string; shape?: "square" | "line" | "dash" | "circle" }[];
  /** Sample data label */
  sample?: boolean | string;
  /** Replay button. Default true */
  replay?: boolean;
  /** Source line under the chart. Follows "Source: " (Korean "출처: ") */
  source?: string;
  /** Note on the source line (such as the as-of date) */
  note?: string;
  /** A word in the title to color with the accent color */
  accent?: string;
  /** Download buttons in the browser. true for CSV, SVG and PNG; an array for only the chosen ones. Not drawn in SVG, PNG or static HTML */
  download?: boolean | ("csv" | "svg" | "png")[];
}

export type FieldType = "string" | "number" | "date" | "any";

export interface ChannelDef {
  /** The encoding key in the spec */
  name: string;
  /** Component prop name (when different) */
  prop?: string;
  required: boolean;
  type: FieldType;
  /** Allows several fields (wide table) */
  multi?: boolean;
  description: string;
}

export type OptionType = "number" | "string" | "boolean" | "enum" | "array" | "object" | "highlight" | "format" | "annotations" | "tooltip" | "any";

export interface OptionDef {
  name: string;
  type: OptionType;
  enum?: readonly string[];
  items?: "number" | "string";
  default?: unknown;
  description: string;
  /** Range of a number option. For an array whose items are "number", the range of each item */
  min?: number;
  max?: number;
  /** Fixed number of array items (for example whiskers' [low, high]). For number arrays, used together with min and max */
  length?: number;
}

/** Language of the registry text. Default "en". Same as the language of chart text (ChartLang) */
export type Lang = ChartLang;

/** Chart group id. Display names are in GROUPS (labels.ts) */
export type ChartGroup = "proportion" | "trend" | "comparison" | "distribution" | "relationship" | "flow" | "hierarchy" | "map" | "kpi";

/** Level id. Display names are in LEVELS (labels.ts) */
export type ChartLevel = "basic" | "intermediate" | "advanced";

export interface ChartDef {
  type: string;
  component: string;
  /** Display name. English by default; Korean with localizeDef(def, "ko") */
  name: string;
  /** English name (always English, whatever the language) */
  nameEn: string;
  level: ChartLevel;
  group: ChartGroup;
  summary: string;
  useWhen: string;
  avoidWhen: string;
  /** Why this chart was chosen (docs/catalog.md) */
  why: string;
  encoding: ChannelDef[];
  options: OptionDef[];
  example: ChartSpec;
  /** Draws with canvas above this count */
  canvasAbove?: number;
  /** Whether it holds up with 10k or more points */
  scalable?: boolean;
}

export interface SpecIssue {
  path: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: SpecIssue[];
  warnings: SpecIssue[];
}
