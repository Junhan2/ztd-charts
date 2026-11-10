import type { ColorToken } from "../theme/tokens";
import type { ChartGroup, ChartLevel, Lang } from "./types";

/**
 * 묶음과 수준의 id와 표시 이름. 의존성이 없어서 ChartCard처럼 가벼워야 하는 곳에서도 불러요.
 */
export interface LabelDef<T extends string> {
  id: T;
  en: string;
  ko: string;
}

export const GROUPS: readonly LabelDef<ChartGroup>[] = [
  { id: "proportion", en: "Proportion", ko: "비율" },
  { id: "trend", en: "Trend", ko: "추이" },
  { id: "comparison", en: "Comparison", ko: "비교" },
  { id: "distribution", en: "Distribution", ko: "분포" },
  { id: "relationship", en: "Relationship", ko: "관계" },
  { id: "flow", en: "Flow", ko: "흐름" },
  { id: "hierarchy", en: "Hierarchy", ko: "계층" },
  { id: "map", en: "Map", ko: "지도" },
  { id: "kpi", en: "KPI", ko: "KPI" },
];

export const LEVELS: readonly LabelDef<ChartLevel>[] = [
  { id: "basic", en: "Basic", ko: "기본" },
  { id: "intermediate", en: "Intermediate", ko: "중급" },
  { id: "advanced", en: "Advanced", ko: "심화" },
];

/** 수준 배지의 바탕색과 글자색 토큰 */
const LEVEL_TONE: Record<ChartLevel, { bg: ColorToken; fg: ColorToken }> = {
  basic: { bg: "line2", fg: "ink" },
  intermediate: { bg: "tint", fg: "accentText" },
  advanced: { bg: "ink", fg: "onInk" },
};

function find<T extends string>(list: readonly LabelDef<T>[], value: string): LabelDef<T> | undefined {
  const v = value.trim().toLowerCase();
  return list.find((l) => l.id === v || l.en.toLowerCase() === v || l.ko === value.trim());
}

/** id, 영어 이름, 한글 이름 어느 것으로도 묶음을 찾아요. 예: findGroup("분포")?.id === "distribution" */
export function findGroup(value: string): LabelDef<ChartGroup> | undefined {
  return find(GROUPS, value);
}

/** id, 영어 이름, 한글 이름 어느 것으로도 수준을 찾아요. 예: findLevel("심화")?.en === "Advanced" */
export function findLevel(value: string): LabelDef<ChartLevel> | undefined {
  return find(LEVELS, value);
}

/** 수준 배지의 글자와 색 (ChartCard, 서버 렌더). 모르는 값은 글자 그대로 basic 색으로. 예: levelBadge("심화", "en").text === "Advanced" */
export function levelBadge(level: string, lang: Lang): { text: string; bg: ColorToken; fg: ColorToken } {
  const lv = findLevel(level);
  return { text: lv ? lv[lang] : level, ...LEVEL_TONE[lv?.id ?? "basic"] };
}
