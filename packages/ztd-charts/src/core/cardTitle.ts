import { createContext } from "react";

/** 차트를 감싼 ChartCard의 제목. 차트에 ariaLabel이 없으면 화면 낭독기가 "Bar chart" 대신 이 제목으로 읽어요 */
export const CardTitleContext = createContext<string | undefined>(undefined);
