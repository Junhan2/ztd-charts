import type { ColorToken } from "../theme/tokens";
import type { ChartGroup, ChartLevel, Lang } from "./types";

/**
 * Ids and display names of groups and levels. It has no dependencies, so lightweight places such as ChartCard import it too.
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

/** Background and text color tokens of the level badge */
const LEVEL_TONE: Record<ChartLevel, { bg: ColorToken; fg: ColorToken }> = {
  basic: { bg: "line2", fg: "ink" },
  intermediate: { bg: "tint", fg: "accentText" },
  advanced: { bg: "ink", fg: "onInk" },
};

function find<T extends string>(list: readonly LabelDef<T>[], value: string): LabelDef<T> | undefined {
  const v = value.trim().toLowerCase();
  return list.find((l) => l.id === v || l.en.toLowerCase() === v || l.ko === value.trim());
}

/** Finds a group by id, English name or Korean name. Example: findGroup("분포")?.id === "distribution" */
export function findGroup(value: string): LabelDef<ChartGroup> | undefined {
  return find(GROUPS, value);
}

/** Finds a level by id, English name or Korean name. Example: findLevel("심화")?.en === "Advanced" */
export function findLevel(value: string): LabelDef<ChartLevel> | undefined {
  return find(LEVELS, value);
}

/** Text and colors of the level badge (ChartCard, server render). An unknown value keeps its text with the basic colors. Example: levelBadge("심화", "en").text === "Advanced" */
export function levelBadge(level: string, lang: Lang): { text: string; bg: ColorToken; fg: ColorToken } {
  const lv = findLevel(level);
  return { text: lv ? lv[lang] : level, ...LEVEL_TONE[lv?.id ?? "basic"] };
}
