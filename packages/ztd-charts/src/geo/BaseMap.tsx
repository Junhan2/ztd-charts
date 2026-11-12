import { useMemo } from "react";
import type { Painter } from "../theme/context";
import type { GeoFrame } from "./view";

/**
 * Faint base map: merges the chosen regions' paths into one, fills it faintly and draws borders as lines in the card background color (no value coloring).
 * The choropleth uses it for countries outside the focused group, and point maps use it for the whole map. It takes no pointer events
 */
export function BaseMap({ p, frame, regions, opacity }: { p: Painter; frame: GeoFrame; regions: readonly number[]; opacity?: number }) {
  // Rebuild the merged path only when the size or regions change (so tens of KB of text are not re-joined on every hover)
  const d = useMemo(() => regions.map((i) => frame.paths[i]).join(""), [frame, regions]);
  return d ? <path d={d} fill={p.paint("neutralSoft")} fillOpacity={opacity} stroke={p.paint("panel")} strokeWidth={0.6} strokeLinejoin="round" fillRule="evenodd" pointerEvents="none" /> : null;
}
