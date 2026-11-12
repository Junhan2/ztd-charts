import type { Painter } from "../theme/context";
import type { PlacedLabel } from "./pointMap";

/** Place label on a map: wrapped in a card-background outline (halo) so it reads over borders and circles. It takes no pointer events */
export function MapLabel({ p, l, dim }: { p: Painter; l: PlacedLabel; dim?: boolean }) {
  return (
    <text
      x={Math.round(l.x * 10) / 10}
      y={Math.round(l.y * 10) / 10}
      dy="0.35em"
      fontSize={11}
      fontWeight={l.weight}
      textAnchor={l.anchor}
      fill={p.paint("ink")}
      stroke={p.paint("panel")}
      strokeWidth={3}
      strokeLinejoin="round"
      paintOrder="stroke"
      opacity={dim ? 0.45 : undefined}
      className="ztd-mark"
      style={{ pointerEvents: "none" }}
    >
      {l.text}
    </text>
  );
}
