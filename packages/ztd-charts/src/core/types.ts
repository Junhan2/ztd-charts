import type { CSSProperties, ReactNode } from "react";
import type { ChartTheme } from "../theme/tokens";
import type { FormatSpec } from "./format";
import type { EasingName } from "./motion";

/** 필드 이름(점 표기 가능) 또는 함수 */
export type Accessor<T, R = unknown> = string | ((d: T, i: number) => R);

/**
 * 강조할 항목.
 * 숫자(인덱스), 문자열(라벨), 배열, "max" | "min" | "first" | "last" | "none", 또는 판별 함수
 */
export type Highlight<T = unknown> = number | string | ReadonlyArray<number | string> | ((d: T, i: number) => boolean);

export interface ChartEvent<T = unknown> {
  /** 원본 데이터 항목. 합계나 계산된 항목이면 null */
  datum: T | null;
  /** 차트에 놓인 순서의 위치예요. 값으로 정렬하는 차트(롤리팝, 파레토, sort를 켠 막대)에서는 data의 줄 번호와 달라요. 원래 행은 datum으로 읽어요 */
  index: number;
  key: string;
  label: string;
  value: number | null;
  series?: string;
  /** 표시용 값 */
  formatted?: string;
}

export interface TooltipRow {
  label?: string;
  /** 굵게 쓰는 값. 범위 띠는 값 뒤에 흐린 범위 글을 붙여 넘겨요 */
  value: ReactNode;
  /** 칠한 색 (CSS 색) */
  color?: string;
  strong?: boolean;
}

export interface TooltipData {
  x: number;
  y: number;
  title: string;
  rows: TooltipRow[];
}

export interface AnimationProps {
  /** 등장, 전환 애니메이션. 기본 true */
  animate?: boolean;
  /** 길이(ms). 기본 900 */
  duration?: number;
  /** 기본 "spring" */
  easing?: EasingName;
  /** 항목 사이 지연(ms). 차트마다 기본값이 달라요 */
  stagger?: number;
  /** 바뀌면 처음부터 다시 재생 */
  replayKey?: string | number;
  /** "auto"면 OS 동작 줄이기 설정을 따라요. true면 항상 끄고, false면 항상 켜요. 기본 "auto" */
  reducedMotion?: "auto" | boolean;
  /** 화면에 들어올 때 재생. false면 마운트하자마자. 기본 true */
  animateOnView?: boolean;
}

export interface BaseChartProps<T = Record<string, unknown>> extends AnimationProps {
  /** 객체 배열 */
  data: readonly T[];
  /** 고정 폭(px). 없으면 부모 폭에 맞춰요 */
  width?: number;
  /** 높이(px) */
  height?: number;
  /** 강조할 항목. 기본은 차트마다 달라요(보통 가장 큰 값) */
  highlight?: Highlight<T>;
  /** 호버, 키보드 포커스가 바뀔 때 */
  onHover?: (e: ChartEvent<T> | null) => void;
  /** 클릭, Enter, Space */
  onClick?: (e: ChartEvent<T>) => void;
  /** 툴팁. false면 끄고, 함수면 내용을 직접 그려요. 기본 true */
  tooltip?: boolean | ((e: ChartEvent<T>) => ReactNode);
  /** 값 라벨 표시. 기본 true */
  showLabels?: boolean;
  /** 스크린리더용 이름 */
  ariaLabel?: string;
  /** 스크린리더용 설명. 없으면 데이터로 만들어요 */
  description?: string;
  /** 값 포맷: "number" | "integer" | "percent" | "ratio" | "compact" | "currency" | Intl 옵션 | 함수 */
  format?: FormatSpec;
  /** 값 뒤에 붙는 단위. 예: "%", "K", "명" */
  unit?: string;
  /**
   * 숫자, 날짜 형식과 차트 글자(툴팁, 스크린리더 문장)의 로캘. "ko"나 "ko-*"면 한국어(1.2만), 그 밖은 영어(1.2K).
   * 없으면 ThemeProvider의 locale, 그것도 없으면 "en-US"
   */
  locale?: string;
  /** 이 차트만 테마 토큰 바꾸기 */
  theme?: Partial<ChartTheme>;
  /** 같은 이름의 차트끼리 짚은 x를 함께 보여 줘요(대시보드에서 같은 날짜 맞춰 보기). ChartGrid의 sync로도 묶여요 */
  syncId?: string;
  className?: string;
  style?: CSSProperties;
}

export type Row = Record<string, unknown>;
