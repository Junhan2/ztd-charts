import { createContext, useContext } from "react";

/** ChartCard's replay button passes replayKey down to the chart inside */
export const ReplayContext = createContext<number | undefined>(undefined);

export function useReplayKey(own: string | number | undefined): string | number | undefined {
  const ctx = useContext(ReplayContext);
  if (own !== undefined && ctx !== undefined) return `${own}:${ctx}`;
  return own ?? ctx;
}
