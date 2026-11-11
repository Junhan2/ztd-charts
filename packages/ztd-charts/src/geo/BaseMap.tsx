import { useMemo } from "react";
import type { Painter } from "../theme/context";
import type { GeoFrame } from "./view";

/**
 * 옅은 바탕 지도: 고른 지역의 길을 하나로 합쳐 옅게 칠하고 경계는 카드 바탕색 선으로 그려요 (값으로 칠하지 않아요).
 * 단계구분도는 집중한 묶음 밖의 나라에, 지점을 놓는 지도는 지도 전체에 써요. 포인터는 받지 않아요
 */
export function BaseMap({ p, frame, regions, opacity }: { p: Painter; frame: GeoFrame; regions: readonly number[]; opacity?: number }) {
  // 합친 길은 크기나 지역이 바뀔 때만 다시 만들어요 (호버마다 수십 KB 글자를 새로 잇지 않게)
  const d = useMemo(() => regions.map((i) => frame.paths[i]).join(""), [frame, regions]);
  return d ? <path d={d} fill={p.paint("neutralSoft")} fillOpacity={opacity} stroke={p.paint("panel")} strokeWidth={0.6} strokeLinejoin="round" fillRule="evenodd" pointerEvents="none" /> : null;
}
