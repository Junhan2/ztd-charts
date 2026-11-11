import type { Painter } from "../theme/context";
import type { PlacedLabel } from "./pointMap";

/** 지도 위 지점 이름표: 카드 바탕색 테두리(후광)를 둘러서 경계선과 원 위에서도 읽혀요. 포인터는 받지 않아요 */
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
