import { createContext } from "react";

/** Title of the ChartCard wrapping the chart. When the chart has no ariaLabel, screen readers read this title instead of "Bar chart" */
export const CardTitleContext = createContext<string | undefined>(undefined);
