import type { ChartLang } from "../core/i18n";

/** JSON으로 쓰는 차트 스펙. 함수 없이 직렬화할 수 있어요 */
export interface ChartSpec {
  $schema?: string;
  /** 차트 종류. `ztd-charts list`로 확인 */
  type: string;
  /** 객체 배열, 또는 { url }, { csv }, { values } */
  data: SpecData;
  /** 채널 -> 필드 이름. 예: { "label": "device", "value": "sales" } */
  encoding?: Record<string, string | string[]>;
  /** 차트 옵션 (highlight, format, height …) */
  options?: Record<string, unknown>;
  /** 카드로 감싸기 */
  card?: SpecCard;
  /** "dark" | "light" 또는 토큰 객체 */
  theme?: string | Record<string, unknown>;
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
  /** 수준 배지. "basic" | "intermediate" | "advanced". 예전 한글 값("기본" …)도 받아요 */
  level?: ChartLevel | "기본" | "중급" | "심화" | string;
  /** "auto"면 데이터로 범례를 만들어요. "toggle"이면 브라우저에서 범례를 눌러 계열을 켜고 꺼요(line, area, bar, scatter). 이미지와 정적 HTML에서는 "auto"와 같아요 */
  legend?: "auto" | "toggle" | { label: string; color?: string; shape?: "square" | "line" | "dash" | "circle" }[];
  /** 예시 데이터 표시 */
  sample?: boolean | string;
  /** 다시 재생 버튼. 기본 true */
  replay?: boolean;
  /** 차트 아래 출처 줄. "Source: "(한국어 "출처: ") 뒤에 붙어요 */
  source?: string;
  /** 출처 줄의 메모(기준일 등) */
  note?: string;
  /** 강조색으로 칠할 제목 속 낱말 */
  accent?: string;
  /** 브라우저의 내려받기 단추. true면 CSV, SVG, PNG, 배열이면 고른 것만. SVG, PNG, 정적 HTML에는 그리지 않아요 */
  download?: boolean | ("csv" | "svg" | "png")[];
}

export type FieldType = "string" | "number" | "date" | "any";

export interface ChannelDef {
  /** 스펙의 encoding 키 */
  name: string;
  /** 컴포넌트 프롭 이름 (다르면) */
  prop?: string;
  required: boolean;
  type: FieldType;
  /** 여러 필드(넓은 표) 허용 */
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
  /** 숫자 옵션의 범위. items가 "number"인 배열이면 항목마다의 범위예요 */
  min?: number;
  max?: number;
  /** 배열 항목 수가 정해진 경우(예: whiskers의 [낮은 쪽, 높은 쪽]). 숫자 배열이면 min, max와 함께 써요 */
  length?: number;
}

/** 레지스트리 글의 언어. 기본은 "en". 차트 글자의 언어(ChartLang)와 같아요 */
export type Lang = ChartLang;

/** 차트 묶음 id. 표시 이름은 GROUPS (labels.ts) */
export type ChartGroup = "proportion" | "trend" | "comparison" | "distribution" | "relationship" | "flow" | "hierarchy" | "kpi";

/** 수준 id. 표시 이름은 LEVELS (labels.ts) */
export type ChartLevel = "basic" | "intermediate" | "advanced";

export interface ChartDef {
  type: string;
  component: string;
  /** 표시 이름. 기본은 영어, localizeDef(def, "ko")면 한글 */
  name: string;
  /** 영어 이름 (언어와 상관없이 늘 영어) */
  nameEn: string;
  level: ChartLevel;
  group: ChartGroup;
  summary: string;
  useWhen: string;
  avoidWhen: string;
  /** 이 차트를 고른 이유 (docs/catalog.md) */
  why: string;
  encoding: ChannelDef[];
  options: OptionDef[];
  example: ChartSpec;
  /** 이 개수가 넘으면 캔버스로 그려요 */
  canvasAbove?: number;
  /** 10k 이상 점에서도 버티는지 */
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
