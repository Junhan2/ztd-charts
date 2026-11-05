/**
 * 차트가 직접 만드는 글자(툴팁 이름, 스크린리더 문장, 버튼)의 언어.
 * 영어가 원본이고 한국어는 로캘이 "ko" 또는 "ko-*"일 때 써요.
 * 여기에는 모든 차트가 함께 쓰는 문구만 두고, 차트 하나만 쓰는 문구는 그 차트 파일에 둬요 (번들이 차트마다 가벼워요)
 */
export type ChartLang = "en" | "ko";

/** 로캘을 글자 언어로. "ko"나 "ko-*"면 "ko", 나머지(없음 포함)는 "en" */
export function langOf(locale?: string): ChartLang {
  return locale !== undefined && /^ko([-_]|$)/i.test(locale) ? "ko" : "en";
}

/** 영어 복수형. plural(3, "item") → "3 items" */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** 모든 차트가 쓰는 문구 (영어 원본). 일부 차트만 쓰는 말은 그 차트 파일에 둬요 */
export const en = {
  /** aria-roledescription */
  chart: "chart",
  /** 스크린리더 표 제목 */
  table: (label: string) => `${label} data`,
  /** 표가 잘렸을 때 마지막 줄 */
  more: (n: number) => `and ${n} more`,
  /** 툴팁의 값 이름 */
  value: "Value",
  /** 데이터가 없을 때 스크린리더 설명 */
  empty: "No data.",
};

export type ChartMessages = typeof en;

export const ko: ChartMessages = {
  chart: "차트",
  table: (label) => `${label} 데이터`,
  more: (n) => `외 ${n}개`,
  value: "값",
  empty: "데이터가 없어요.",
};
